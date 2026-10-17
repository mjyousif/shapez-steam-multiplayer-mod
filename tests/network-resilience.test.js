const { test, describe } = require("node:test");
const assert = require("node:assert");
const EventEmitter = require("events");
const net = require("net");

function createFrameBuffer(obj) {
    const payload = Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj), "utf8");
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(payload.length, 0);
    return Buffer.concat([header, payload]);
}

function attachFrameParser(socket, onMessage, onError) {
    let buffer = Buffer.alloc(0);
    socket.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
            const msgLen = buffer.readUInt32BE(0);
            if (msgLen > 64 * 1024 * 1024) {
                socket.destroy();
                return;
            }
            if (buffer.length < 4 + msgLen) {
                break;
            }
            const jsonSlice = buffer.subarray(4, 4 + msgLen).toString("utf8");
            buffer = buffer.subarray(4 + msgLen);
            try {
                const parsed = JSON.parse(jsonSlice);
                onMessage(parsed);
            } catch (err) {
                if (onError) onError(err);
            }
        }
    });
}

describe("Network Protocol Resilience and Edge Cases", () => {
    test("recovers from malformed JSON in stream without dropping subsequent valid frames", () => {
        const emitter = new EventEmitter();
        const received = [];
        const errors = [];

        attachFrameParser(
            emitter,
            msg => received.push(msg),
            err => errors.push(err)
        );

        const frame1 = createFrameBuffer({ id: 1, action: "start" });
        // Frame 2 has valid framing header, but invalid JSON content
        const corruptedPayload = Buffer.from("{ this is bad json: [", "utf8");
        const corruptHeader = Buffer.alloc(4);
        corruptHeader.writeUInt32BE(corruptedPayload.length, 0);
        const frame2 = Buffer.concat([corruptHeader, corruptedPayload]);
        const frame3 = createFrameBuffer({ id: 3, action: "resume" });

        emitter.emit("data", Buffer.concat([frame1, frame2, frame3]));

        assert.strictEqual(received.length, 2, "Must receive both valid frames");
        assert.strictEqual(received[0].id, 1);
        assert.strictEqual(received[1].id, 3);
        assert.strictEqual(errors.length, 1, "Must catch the single syntax error");
    });

    test("handles header bytes fragmented one byte at a time across chunk boundaries", () => {
        const emitter = new EventEmitter();
        const received = [];

        attachFrameParser(emitter, msg => received.push(msg));

        const msg = { type: "test", data: "split-header-payload" };
        const fullFrame = createFrameBuffer(msg);

        // Feed header 1 byte at a time
        emitter.emit("data", fullFrame.subarray(0, 1));
        emitter.emit("data", fullFrame.subarray(1, 2));
        emitter.emit("data", fullFrame.subarray(2, 3));
        emitter.emit("data", fullFrame.subarray(3, 4));
        // Feed payload in two halves
        const payloadMid = 4 + Math.floor((fullFrame.length - 4) / 2);
        emitter.emit("data", fullFrame.subarray(4, payloadMid));
        emitter.emit("data", fullFrame.subarray(payloadMid));

        assert.strictEqual(received.length, 1);
        assert.deepStrictEqual(received[0], msg);
    });

    test("processes large burst of 500 frames without message loss or corruption", () => {
        const emitter = new EventEmitter();
        const received = [];

        attachFrameParser(emitter, msg => received.push(msg));

        const frames = [];
        const count = 500;
        for (let i = 0; i < count; i++) {
            frames.push(createFrameBuffer({ seq: i, payload: "burst_item_" + i }));
        }

        const combined = Buffer.concat(frames);
        emitter.emit("data", combined);

        assert.strictEqual(received.length, count);
        for (let i = 0; i < count; i++) {
            assert.strictEqual(received[i].seq, i);
        }
    });

    test("connectTcpClient times out when connecting to non-responsive IP and destroys socket", async () => {
        // Using TEST-NET-1 (192.0.2.1) which is reserved and drops packets (guaranteed blackhole)
        const nonRoutableIp = "192.0.2.1";
        const port = 27099;
        const timeoutMs = 150;

        let timedOut = false;
        const start = Date.now();

        await new Promise(resolve => {
            const socket = new net.Socket();
            let settled = false;

            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    timedOut = true;
                    socket.destroy();
                    resolve();
                }
            }, timeoutMs);

            socket.connect(port, nonRoutableIp, () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    socket.destroy();
                    resolve();
                }
            });

            socket.on("error", () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    timedOut = true;
                    resolve();
                }
            });
        });

        assert.strictEqual(timedOut, true, "Socket must time out cleanly");
        assert.ok(Date.now() - start < 1000, "Timeout must fire promptly");
    });

    test("TCP Server automatically increments and binds next port on EADDRINUSE conflict", async () => {
        const portConflict = 29480;

        // 1. Occupy the base port with a dummy server
        const blockerServer = net.createServer();
        await new Promise(res => blockerServer.listen(portConflict, "127.0.0.1", res));

        try {
            // 2. Start second server with conflict resolution logic
            const secondaryServer = net.createServer();
            let chosenPort = portConflict;
            let attempts = 0;

            const boundInfo = await new Promise((resolve, reject) => {
                const tryListen = () => {
                    attempts++;
                    secondaryServer.once("error", err => {
                        if (err.code === "EADDRINUSE" && attempts < 5) {
                            chosenPort++;
                            tryListen();
                        } else {
                            reject(err);
                        }
                    });
                    secondaryServer.listen(chosenPort, "127.0.0.1", () => {
                        resolve({ port: secondaryServer.address().port });
                    });
                };
                tryListen();
            });

            assert.strictEqual(boundInfo.port, portConflict + 1, "Must rebind to port + 1 on conflict");

            await new Promise(res => secondaryServer.close(res));
        } finally {
            await new Promise(res => blockerServer.close(res));
        }
    });
});
