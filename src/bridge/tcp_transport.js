/**
 * @file src/bridge/tcp_transport.js
 * @description TCP networking layer, length-prefixed streaming protocol parser, and UPnP port forwarder.
 * 
 * Provides:
 * 1. 4-byte Big-Endian length-prefixed packet framing (`createFrameBuffer`, `attachFrameParser`).
 * 2. Protection against malformed packets and corrupted streams (64 MB upper payload guard).
 * 3. Fast non-blocking UPnP automatic router port forwarding via SSDP discovery and SOAP WANIP/WANPPP.
 * 4. Resilient TCP Host server with automatic `EADDRINUSE` port conflict resolution (auto-incrementing port).
 * 5. TCP Client with connection timeouts and socket lifecycle management.
 * 
 * Invariants:
 * - Frame headers are strictly 4-byte Big-Endian integers encoding payload byte length.
 * - Sockets are configured with `setNoDelay(true)` to disable Nagle's algorithm for low-latency transmission.
 * - Sockets maintain keep-alive heartbeats to detect disconnected peers promptly.
 */

const net = require("net");
const dgram = require("dgram");
const http = require("http");
const os = require("os");
const { logInfo, logWarn } = require("./logger");

/**
 * Maximum allowable frame payload size before terminating socket to protect memory (64 Megabytes).
 * @type {number}
 */
const MAX_FRAME_PAYLOAD_BYTES = 64 * 1024 * 1024;

/**
 * Active TCP Server instance when hosting a session.
 * @type {net.Server | null}
 */
let tcpServer = null;

/**
 * Port number to which the active TCP server is currently bound.
 * @type {number}
 */
let tcpServerPort = 0;

/**
 * Connected client peer sockets indexed by peer ID.
 * peerId -> net.Socket
 * @type {Map<string, net.Socket>}
 */
const hostClients = new Map();

/**
 * Monotonically increasing peer identifier counter.
 * @type {number}
 */
let nextPeerSeq = 1;

/**
 * Active client socket when connected to a remote host.
 * @type {net.Socket | null}
 */
let clientSocket = null;

/**
 * Optional external delegate for dispatching events to the Electron Renderer process.
 * @type {((channel: string, payload: any) => void) | null}
 */
let rendererSender = null;

/**
 * Configures the renderer event dispatcher callback.
 * @param {(channel: string, payload: any) => void} fn - Dispatch function.
 */
function setRendererSender(fn) {
    rendererSender = fn;
}

/**
 * Dispatches an event to the renderer process.
 * @param {string} channel - Channel name.
 * @param {any} payload - Event data payload.
 */
function sendToRenderer(channel, payload) {
    if (typeof rendererSender === "function") {
        rendererSender(channel, payload);
    }
}

/**
 * Serializes a JavaScript object into a 4-byte Big-Endian length-prefixed Buffer.
 *
 * Header (4 bytes, Big-Endian): Length of JSON payload in bytes.
 * Payload (N bytes): UTF-8 encoded JSON string.
 *
 * @param {object | string} obj - Message object or string to serialize.
 * @returns {Buffer} Formatted binary packet.
 */
function createFrameBuffer(obj) {
    const payload = Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj), "utf8");
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(payload.length, 0);
    return Buffer.concat([header, payload]);
}

/**
 * Attaches a stateful 4-byte Big-Endian framing stream parser to a readable stream / socket.
 * Handles packet fragmentation across chunk boundaries and concatenated multiple frames.
 *
 * @param {net.Socket | import("events").EventEmitter} socket - Readable network socket.
 * @param {(message: any) => void} onMessage - Invoked for each complete, parsed JSON frame.
 * @param {(err: Error) => void} [onError] - Invoked on parse failure (optional).
 */
function attachFrameParser(socket, onMessage, onError) {
    let buffer = Buffer.alloc(0);

    socket.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= 4) {
            const msgLen = buffer.readUInt32BE(0);

            // Guard against corrupt or malicious oversize payloads
            if (msgLen > MAX_FRAME_PAYLOAD_BYTES) {
                if (typeof socket.destroy === "function") {
                    socket.destroy();
                }
                return;
            }

            // Await remaining bytes of fragmented frame
            if (buffer.length < 4 + msgLen) {
                break;
            }

            const jsonSlice = buffer.subarray(4, 4 + msgLen).toString("utf8");
            buffer = buffer.subarray(4 + msgLen);

            try {
                const parsed = JSON.parse(jsonSlice);
                onMessage(parsed);
            } catch (err) {
                logWarn("Failed to parse framed JSON message: " + (err.message || err));
                if (typeof onError === "function") {
                    onError(err);
                }
            }
        }
    });
}

/**
 * Enumerates all non-internal IPv4 network interfaces on the host machine.
 *
 * @returns {Array<{ interface: string, address: string }>} List of detected local IPv4 addresses.
 */
function getLocalIPv4Addresses() {
    const results = [];
    try {
        const nets = os.networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const netInfo of nets[name] || []) {
                if (netInfo.family === "IPv4" && !netInfo.internal) {
                    results.push({
                        interface: name,
                        address: netInfo.address,
                    });
                }
            }
        }
    } catch {}
    return results;
}

/**
 * Performs a lightweight HTTP request with a timeout.
 *
 * @param {string} urlStr - Target URL.
 * @param {http.RequestOptions} [options={}] - HTTP options.
 * @param {string | Buffer | null} [body=null] - Request payload body.
 * @param {number} [timeoutMs=600] - Timeout in milliseconds.
 * @returns {Promise<string>} Response body text.
 */
function httpRequestSimple(urlStr, options = {}, body = null, timeoutMs = 600) {
    return new Promise((resolve, reject) => {
        try {
            const parsed = new URL(urlStr);
            const req = http.request(
                {
                    hostname: parsed.hostname,
                    port: parsed.port || 80,
                    path: parsed.pathname + parsed.search,
                    method: options.method || "GET",
                    headers: options.headers || {},
                    timeout: timeoutMs,
                },
                res => {
                    const chunks = [];
                    res.on("data", c => chunks.push(c));
                    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
                }
            );
            req.on("error", reject);
            req.on("timeout", () => {
                req.destroy();
                reject(new Error("HTTP timeout"));
            });
            if (body) req.write(body);
            req.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Attempts automatic non-blocking UPnP IGD port forwarding via SSDP broadcast (UDP 1900).
 *
 * @param {string} internalIp - Local IPv4 address to forward to.
 * @param {number} port - TCP port to map.
 * @param {number} [timeoutMs=900] - Maximum duration to await gateway response.
 * @returns {Promise<string | null>} Public IPv4 address if mapping succeeded, null otherwise.
 */
function tryUpnpPortMapping(internalIp, port, timeoutMs = 900) {
    if (!internalIp || !port) return Promise.resolve(null);

    return new Promise(resolve => {
        let done = false;
        const finish = extIp => {
            if (!done) {
                done = true;
                try {
                    udp.close();
                } catch {}
                resolve(extIp || null);
            }
        };

        const timer = setTimeout(() => finish(null), timeoutMs);
        const udp = dgram.createSocket("udp4");

        udp.on("error", () => {
            clearTimeout(timer);
            finish(null);
        });

        udp.on("message", async msg => {
            const text = msg.toString("utf8");
            const locMatch = text.match(/LOCATION:\s*(http:\/\/[^\r\n]+)/i);
            if (!locMatch || !locMatch[1]) return;
            const descUrl = locMatch[1].trim();

            try {
                const xml = await httpRequestSimple(descUrl, {}, null, 500);
                const svcMatch = xml.match(
                    /<serviceType>(urn:schemas-upnp-org:service:WAN(?:IP|PPP)Connection:1)<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/i
                );
                if (!svcMatch) return;

                const serviceType = svcMatch[1].trim();
                const controlPath = svcMatch[2].trim();
                const controlUrl = new URL(controlPath, descUrl).toString();

                const soapAdd = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:AddPortMapping xmlns:u="${serviceType}"><NewRemoteHost></NewRemoteHost><NewExternalPort>${port}</NewExternalPort><NewProtocol>TCP</NewProtocol><NewInternalPort>${port}</NewInternalPort><NewInternalClient>${internalIp}</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>shapez Steam Co-op</NewPortMappingDescription><NewLeaseDuration>0</NewLeaseDuration></u:AddPortMapping></s:Body></s:Envelope>`;
                await httpRequestSimple(
                    controlUrl,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": 'text/xml; charset="utf-8"',
                            SOAPAction: `"${serviceType}#AddPortMapping"`,
                            "Content-Length": Buffer.byteLength(soapAdd),
                        },
                    },
                    soapAdd,
                    500
                );

                const soapIp = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetExternalIPAddress xmlns:u="${serviceType}"></u:GetExternalIPAddress></s:Body></s:Envelope>`;
                const ipXml = await httpRequestSimple(
                    controlUrl,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": 'text/xml; charset="utf-8"',
                            SOAPAction: `"${serviceType}#GetExternalIPAddress"`,
                            "Content-Length": Buffer.byteLength(soapIp),
                        },
                    },
                    soapIp,
                    500
                );

                const extMatch = ipXml.match(/<NewExternalIPAddress>(\d+\.\d+\.\d+\.\d+)<\/NewExternalIPAddress>/i);
                if (extMatch && extMatch[1] && !extMatch[1].startsWith("10.") && !extMatch[1].startsWith("192.168.")) {
                    clearTimeout(timer);
                    logInfo(`UPnP mapped TCP port ${port} -> ${extMatch[1]}:${port}`);
                    finish(extMatch[1]);
                }
            } catch {}
        });

        udp.bind(0, () => {
            for (const st of [
                "urn:schemas-upnp-org:service:WANIPConnection:1",
                "urn:schemas-upnp-org:service:WANPPPConnection:1",
            ]) {
                const req = Buffer.from(
                    `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ${st}\r\n\r\n`,
                    "utf8"
                );
                try {
                    udp.send(req, 0, req.length, 1900, "239.255.255.250");
                } catch {}
            }
        });
    });
}

/**
 * Terminates the TCP hosting server and disconnects all active peers.
 */
function stopTcpHost() {
    for (const [, sock] of hostClients) {
        try {
            sock.destroy();
        } catch {}
    }
    hostClients.clear();

    if (tcpServer) {
        try {
            tcpServer.close();
        } catch {}
        tcpServer = null;
        tcpServerPort = 0;
    }
}

/**
 * Disconnects the active TCP client socket if connected.
 */
function disconnectTcpClient() {
    if (clientSocket) {
        try {
            clientSocket.destroy();
        } catch {}
        clientSocket = null;
    }
}

/**
 * Starts a TCP server for hosting a multiplayer session. Automatically increments port
 * on `EADDRINUSE` conflicts up to 15 times to guarantee seamless multi-instance hosting.
 *
 * @param {number} [preferredPort=27080] - Desired initial port.
 * @returns {Promise<{ port: number, ips: Array<{ interface: string, address: string }>, endpoints: string[] }>}
 */
function startTcpHost(preferredPort = 27080) {
    stopTcpHost();

    return new Promise((resolve, reject) => {
        const server = net.createServer(socket => {
            socket.setNoDelay(true);
            socket.setKeepAlive(true, 5000);

            const peerId = "peer_" + nextPeerSeq++;
            hostClients.set(peerId, socket);
            logInfo(`TCP peer connected: ${peerId} (${socket.remoteAddress}:${socket.remotePort})`);

            sendToRenderer("mp:net:event", {
                type: "host-peer-connected",
                peerId,
                remoteAddress: socket.remoteAddress,
                remotePort: socket.remotePort,
            });

            attachFrameParser(socket, msg => {
                sendToRenderer("mp:net:event", {
                    type: "host-peer-message",
                    peerId,
                    message: msg,
                });
            });

            socket.on("close", () => {
                hostClients.delete(peerId);
                sendToRenderer("mp:net:event", {
                    type: "host-peer-disconnected",
                    peerId,
                });
            });

            socket.on("error", err => {
                logWarn("Host peer socket error (" + peerId + "): " + err.message);
            });
        });

        let portToTry = preferredPort;
        let attempts = 0;

        const tryListen = () => {
            attempts++;
            server.once("error", err => {
                if (err.code === "EADDRINUSE" && attempts < 15) {
                    portToTry++;
                    tryListen();
                } else {
                    reject(err);
                }
            });

            server.listen(portToTry, "0.0.0.0", async () => {
                tcpServer = server;
                tcpServerPort = server.address().port;
                const ips = getLocalIPv4Addresses();
                const endpoints = ips.map(i => i.address + ":" + tcpServerPort);
                endpoints.push("127.0.0.1:" + tcpServerPort);

                // Attempt non-blocking UPnP mapping if LAN IP exists
                if (ips.length > 0) {
                    try {
                        const extIp = await tryUpnpPortMapping(ips[0].address, tcpServerPort, 850);
                        if (extIp) {
                            endpoints.unshift(extIp + ":" + tcpServerPort);
                        }
                    } catch {}
                }

                resolve({
                    port: tcpServerPort,
                    ips,
                    endpoints,
                });
            });
        };

        tryListen();
    });
}

/**
 * Connects as a TCP client to a remote shapez.io host.
 *
 * @param {string} host - Target host IP or hostname.
 * @param {number} port - Target host TCP port.
 * @param {number} [timeoutMs=6000] - Connection timeout in milliseconds.
 * @returns {Promise<{ connected: boolean, host: string, port: number }>} Connection summary.
 */
function connectTcpClient(host, port, timeoutMs = 6000) {
    disconnectTcpClient();

    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 5000);

        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                socket.destroy();
                reject(new Error("Connection timed out to " + host + ":" + port));
            }
        }, timeoutMs);

        socket.connect(Number(port), host, () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clientSocket = socket;
            logInfo(`TCP client connected to ${host}:${port}`);

            attachFrameParser(socket, msg => {
                sendToRenderer("mp:net:event", {
                    type: "client-message",
                    message: msg,
                });
            });

            socket.on("close", () => {
                if (clientSocket === socket) {
                    clientSocket = null;
                }
                sendToRenderer("mp:net:event", {
                    type: "client-disconnected",
                });
            });

            resolve({ connected: true, host, port: Number(port) });
        });

        socket.on("error", err => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(err);
            } else {
                logWarn("Client socket error: " + err.message);
            }
        });
    });
}

/**
 * Transmits a framed message to a single host peer or all connected host peers.
 *
 * @param {string | null} peerId - Target peer ID, or null to broadcast to all peers.
 * @param {any} message - Message payload to frame and transmit.
 * @returns {{ sent: number }} Count of sockets successfully written to.
 */
function sendFromHost(peerId, message) {
    const frame = createFrameBuffer(message);
    if (peerId) {
        const sock = hostClients.get(peerId);
        if (sock && !sock.destroyed) {
            sock.write(frame);
            return { sent: 1 };
        }
        return { sent: 0 };
    }

    let count = 0;
    for (const [, sock] of hostClients) {
        if (sock && !sock.destroyed) {
            sock.write(frame);
            count++;
        }
    }
    return { sent: count };
}

/**
 * Broadcasts a framed message to all host peers except a designated peer ID.
 *
 * @param {string} excludePeerId - Peer ID to exclude.
 * @param {any} message - Message payload.
 * @returns {{ sent: number }} Count of sockets written to.
 */
function broadcastExcept(excludePeerId, message) {
    const frame = createFrameBuffer(message);
    let count = 0;
    for (const [id, sock] of hostClients) {
        if (id !== excludePeerId && sock && !sock.destroyed) {
            sock.write(frame);
            count++;
        }
    }
    return { sent: count };
}

/**
 * Transmits a framed message from the client socket to the host.
 *
 * @param {any} message - Message payload.
 * @returns {{ sent: boolean }} True if successfully written, false otherwise.
 */
function sendFromClient(message) {
    if (clientSocket && !clientSocket.destroyed) {
        const frame = createFrameBuffer(message);
        clientSocket.write(frame);
        return { sent: true };
    }
    return { sent: false };
}

/**
 * Gets the current TCP server port.
 * @returns {number} Bound port number.
 */
function getTcpServerPort() {
    return tcpServerPort;
}

module.exports = {
    createFrameBuffer,
    attachFrameParser,
    getLocalIPv4Addresses,
    httpRequestSimple,
    tryUpnpPortMapping,
    startTcpHost,
    stopTcpHost,
    connectTcpClient,
    disconnectTcpClient,
    sendFromHost,
    broadcastExcept,
    sendFromClient,
    getTcpServerPort,
    setRendererSender,
    hostClients,
};
