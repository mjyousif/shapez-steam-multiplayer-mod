const fs = require("fs");
const path = require("path");
const net = require("net");
const os = require("os");
const { ipcMain } = require("electron");

let greenworks = null;
let appId = null;
let initialized = false;
let mainWindow = null;
let currentLobbyId = null;
let fallbackProfile = null;

try {
    greenworks = require("shapez.io-private-artifacts/steam/greenworks");
    const appIdPath = path.join(__dirname, "steam_appid.txt");
    appId = fs.existsSync(appIdPath) ? parseInt(fs.readFileSync(appIdPath, "utf8")) : 1318690;
} catch (err) {
    // greenworks is not installed
    console.warn("Failed to load steam api:", err);
}

console.log("App ID:", appId);

function setMainWindow(win) {
    mainWindow = win;
}

function sendToRenderer(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        try {
            mainWindow.webContents.send(channel, payload);
        } catch (err) {
            console.warn("Failed to send IPC to renderer:", err);
        }
    }
}

function normalizeSteamId(val) {
    if (!val) return "";
    if (typeof val === "string") return val;
    if (typeof val.getRawSteamID === "function") {
        try {
            return String(val.getRawSteamID());
        } catch (e) {}
    }
    if (val.steamId) return String(val.steamId);
    if (val.staticAccountId) return String(val.staticAccountId);
    return String(val);
}

function getLocalSteamProfile() {
    if (initialized && greenworks && typeof greenworks.getSteamId === "function") {
        try {
            const info = greenworks.getSteamId();
            const steamId = normalizeSteamId(info);
            return {
                steamId: steamId || "steam_local",
                name: info.screenName || (typeof info.getPersonaName === "function" ? info.getPersonaName() : "Steam Player"),
                accountId: info.accountId || 0,
                level: info.level || 1,
                isSteam: true,
            };
        } catch (err) {
            console.warn("Error reading greenworks.getSteamId():", err);
        }
    }
    if (!fallbackProfile) {
        const suffix = Math.floor(1000 + Math.random() * 9000);
        fallbackProfile = {
            steamId: "local_" + process.pid + "_" + suffix,
            name: (os.userInfo().username || "Player") + "#" + suffix,
            accountId: suffix,
            level: 1,
            isSteam: false,
        };
    }
    return fallbackProfile;
}

function init(isDev, allowMultiInstance = false) {
    if (!greenworks) {
        return;
    }

    if (!isDev && !allowMultiInstance) {
        try {
            if (greenworks.restartAppIfNecessary(appId)) {
                console.log("Restarting ...");
                process.exit(0);
            }
        } catch (err) {
            console.warn("restartAppIfNecessary check failed:", err);
        }
    }

    try {
        if (!greenworks.init()) {
            console.warn("Failed to initialize greenworks");
            if (!isDev && !allowMultiInstance) {
                process.exit(1);
            }
            return;
        }
        initialized = true;
        console.log("Steam (greenworks) initialized successfully.");

        if (typeof greenworks.setListenForFriendsMessage === "function") {
            try {
                greenworks.setListenForFriendsMessage(true);
            } catch (e) {
                console.warn("Could not enable setListenForFriendsMessage:", e);
            }
        }

        setupSteamEventListeners();
    } catch (err) {
        console.warn("Steam initialization threw error (continuing in local/LAN fallback mode):", err.message || err);
        if (!isDev && !allowMultiInstance) {
            // Still allow running if launched directly for modding/testing
            initialized = false;
        }
    }
}

function setupSteamEventListeners() {
    if (!greenworks || typeof greenworks.on !== "function") {
        return;
    }

    greenworks.on("lobby-created", (result, lobbyId) => {
        const idStr = normalizeSteamId(lobbyId || result);
        console.log("[Steam MP] lobby-created:", result, idStr);
        if (idStr) {
            currentLobbyId = idStr;
        }
        sendToRenderer("steam:mp:event", {
            type: "lobby-created",
            result,
            lobbyId: idStr,
        });
    });

    greenworks.on("lobby-enter", (lobbyId, chatPermissions, locked, response) => {
        const idStr = normalizeSteamId(lobbyId);
        console.log("[Steam MP] lobby-enter:", idStr, response);
        if (idStr) {
            currentLobbyId = idStr;
        }
        sendToRenderer("steam:mp:event", {
            type: "lobby-enter",
            lobbyId: idStr,
            chatPermissions,
            locked,
            response,
        });
    });

    greenworks.on("lobby-data-update", (success, lobbyId, memberId) => {
        sendToRenderer("steam:mp:event", {
            type: "lobby-data-update",
            success,
            lobbyId: normalizeSteamId(lobbyId),
            memberId: normalizeSteamId(memberId),
        });
    });

    greenworks.on("lobby-invite", (inviterId, lobbyId, gameId) => {
        const fromId = normalizeSteamId(inviterId);
        let fromName = fromId;
        try {
            if (greenworks.getFriendPersonaName) {
                fromName = greenworks.getFriendPersonaName(fromId) || fromId;
            }
        } catch (e) {}
        sendToRenderer("steam:mp:event", {
            type: "lobby-invite",
            inviterId: fromId,
            inviterName: fromName,
            lobbyId: normalizeSteamId(lobbyId),
            gameId: String(gameId || ""),
        });
    });

    greenworks.on("lobby-join-requested", (lobbyId, friendId) => {
        const targetLobby = normalizeSteamId(lobbyId);
        const fromFriend = normalizeSteamId(friendId);
        console.log("[Steam MP] lobby-join-requested:", targetLobby, "from", fromFriend);
        sendToRenderer("steam:mp:event", {
            type: "lobby-join-requested",
            lobbyId: targetLobby,
            friendId: fromFriend,
        });
    });

    greenworks.on("rich-presence-join-requested", (friendId, connectStr) => {
        const fromFriend = normalizeSteamId(friendId);
        console.log("[Steam MP] rich-presence-join-requested:", fromFriend, connectStr);
        sendToRenderer("steam:mp:event", {
            type: "rich-presence-join-requested",
            friendId: fromFriend,
            connect: String(connectStr || ""),
        });
    });

    greenworks.on("game-connected-friend-chat-message", (friendId, messageIndex) => {
        const fromFriend = normalizeSteamId(friendId);
        try {
            if (typeof greenworks.getFriendMessage === "function") {
                const msgData = greenworks.getFriendMessage(fromFriend, messageIndex, 16384);
                const text = msgData && typeof msgData === "object" ? msgData.message : String(msgData || "");
                if (text && text.startsWith("[SHAPEZ_MP]:")) {
                    const rawJson = text.slice("[SHAPEZ_MP]:".length);
                    const parsed = JSON.parse(rawJson);
                    sendToRenderer("steam:mp:event", {
                        type: "steam-friend-signal",
                        fromSteamId: fromFriend,
                        fromName: greenworks.getFriendPersonaName
                            ? greenworks.getFriendPersonaName(fromFriend)
                            : fromFriend,
                        data: parsed,
                    });
                }
            }
        } catch (err) {
            console.warn("[Steam MP] Error handling friend chat message:", err);
        }
    });
}

// ============================================================================
// TCP / LAN / Direct P2P Socket Framing Layer (Main Process)
// ============================================================================

let tcpServer = null;
let tcpServerPort = 0;
const hostClients = new Map(); // peerId -> net.Socket
let nextPeerSeq = 1;
let clientSocket = null;

function createFrameBuffer(obj) {
    const payload = Buffer.from(JSON.stringify(obj), "utf8");
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(payload.length, 0);
    return Buffer.concat([header, payload]);
}

function attachFrameParser(socket, onMessage) {
    let buffer = Buffer.alloc(0);
    socket.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
            const msgLen = buffer.readUInt32BE(0);
            if (msgLen > 64 * 1024 * 1024) {
                // Corrupt frame guard (64MB max)
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
                console.warn("[MP Net] Failed to parse framed JSON message:", err);
            }
        }
    });
}

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
    } catch (e) {}
    return results;
}

function stopTcpHost() {
    for (const [, sock] of hostClients) {
        try {
            sock.destroy();
        } catch (e) {}
    }
    hostClients.clear();
    if (tcpServer) {
        try {
            tcpServer.close();
        } catch (e) {}
        tcpServer = null;
        tcpServerPort = 0;
    }
}

function disconnectTcpClient() {
    if (clientSocket) {
        try {
            clientSocket.destroy();
        } catch (e) {}
        clientSocket = null;
    }
}

function startTcpHost(preferredPort = 27080) {
    stopTcpHost();

    return new Promise((resolve, reject) => {
        const server = net.createServer(socket => {
            socket.setNoDelay(true);
            socket.setKeepAlive(true, 5000);

            const peerId = "peer_" + nextPeerSeq++;
            hostClients.set(peerId, socket);

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
                console.warn("[MP Net] Host peer socket error (" + peerId + "):", err.message);
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
            server.listen(portToTry, "0.0.0.0", () => {
                tcpServer = server;
                tcpServerPort = server.address().port;
                const ips = getLocalIPv4Addresses();
                const endpoints = ips.map(i => i.address + ":" + tcpServerPort);
                endpoints.push("127.0.0.1:" + tcpServerPort);
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
                console.warn("[MP Net] Client socket error:", err.message);
            }
        });
    });
}

// ============================================================================
// IPC Registration
// ============================================================================

function listen() {
    ipcMain.handle("steam:is-initialized", isInitialized);
    ipcMain.handle("steam:get-achievement-names", getAchievementNames);
    ipcMain.handle("steam:activate-achievement", activateAchievement);

    function bufferToHex(buffer) {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    }

    ipcMain.handle("steam:get-ticket", (event, arg) => {
        if (!initialized || !greenworks) {
            return Promise.reject("Steam not initialized");
        }
        console.log("Requested steam ticket ...");
        return new Promise((resolve, reject) => {
            greenworks.getAuthSessionTicket(
                success => {
                    const ticketHex = bufferToHex(success.ticket);
                    resolve(ticketHex);
                },
                error => {
                    console.error("Failed to get steam ticket:", error);
                    reject(error);
                }
            );
        });
    });

    ipcMain.handle("steam:check-app-ownership", (event, dlcAppId) => {
        if (!initialized || !greenworks) {
            return Promise.resolve(false);
        }
        try {
            return Promise.resolve(greenworks.isDLCInstalled(dlcAppId));
        } catch (e) {
            return Promise.resolve(false);
        }
    });

    // ---- Steam Multiplayer IPC Handlers ----

    ipcMain.handle("steam:mp:get-status", async () => {
        let launchCmd = "";
        if (initialized && greenworks && typeof greenworks.getLaunchCommandLine === "function") {
            try {
                launchCmd = greenworks.getLaunchCommandLine() || "";
            } catch (e) {}
        }
        return {
            initialized: Boolean(initialized && greenworks),
            profile: getLocalSteamProfile(),
            launchCmd,
            activeLobbyId: currentLobbyId,
            localIps: getLocalIPv4Addresses(),
            hostPort: tcpServerPort,
        };
    });

    ipcMain.handle("steam:mp:get-friends", async () => {
        if (!initialized || !greenworks || typeof greenworks.getFriends !== "function") {
            return [];
        }
        try {
            const flag =
                greenworks.FriendFlags && greenworks.FriendFlags.Immediate !== undefined
                    ? greenworks.FriendFlags.Immediate
                    : 4;
            const rawFriends = greenworks.getFriends(flag) || [];
            const list = [];
            for (const f of rawFriends) {
                const steamId = normalizeSteamId(f);
                if (!steamId) continue;
                let name = "";
                try {
                    name =
                        typeof f.getPersonaName === "function"
                            ? f.getPersonaName()
                            : greenworks.getFriendPersonaName
                            ? greenworks.getFriendPersonaName(steamId)
                            : steamId;
                } catch (e) {
                    name = steamId;
                }
                let connect = "";
                let mpEndpoint = "";
                let mpLobby = "";
                let mpMode = "";
                if (typeof greenworks.getFriendRichPresence === "function") {
                    try {
                        if (typeof greenworks.requestUserInformation === "function") {
                            greenworks.requestUserInformation(steamId, true);
                        }
                        connect = greenworks.getFriendRichPresence(steamId, "connect") || "";
                        mpEndpoint = greenworks.getFriendRichPresence(steamId, "shapez_mp_endpoint") || "";
                        mpLobby = greenworks.getFriendRichPresence(steamId, "shapez_mp_lobby") || "";
                        mpMode = greenworks.getFriendRichPresence(steamId, "shapez_mp_mode") || "";
                    } catch (e) {}
                }
                list.push({
                    steamId,
                    name: name || steamId,
                    connect,
                    mpEndpoint,
                    mpLobby,
                    mpMode,
                });
            }
            return list;
        } catch (err) {
            console.warn("[Steam MP] get-friends failed:", err);
            return [];
        }
    });

    ipcMain.handle("steam:mp:create-lobby", async (event, options = {}) => {
        const maxPlayers = options.maxPlayers || 8;
        const mode = options.mode || "coop";
        const endpointStr = options.endpoint || "";
        const profile = getLocalSteamProfile();

        // Try native Steam Matchmaking createLobby if available
        let lobbyId = null;
        if (initialized && greenworks && typeof greenworks.createLobby === "function") {
            try {
                const lobbyType =
                    greenworks.LobbyType && greenworks.LobbyType.FriendsOnly !== undefined
                        ? greenworks.LobbyType.FriendsOnly
                        : 1;
                lobbyId = await new Promise(resolve => {
                    let done = false;
                    const finish = id => {
                        if (!done) {
                            done = true;
                            resolve(id ? normalizeSteamId(id) : null);
                        }
                    };
                    const timer = setTimeout(() => finish(null), 2500);
                    const onCreated = (res, createdLobbyId) => {
                        clearTimeout(timer);
                        finish(createdLobbyId || res);
                    };
                    if (typeof greenworks.once === "function") {
                        greenworks.once("lobby-created", onCreated);
                    }
                    try {
                        const ret = greenworks.createLobby(lobbyType, maxPlayers, id => {
                            clearTimeout(timer);
                            finish(id);
                        });
                        if (ret && typeof ret === "string") {
                            clearTimeout(timer);
                            finish(ret);
                        }
                    } catch (e) {
                        clearTimeout(timer);
                        finish(null);
                    }
                });
            } catch (err) {
                console.warn("[Steam MP] createLobby fallback:", err);
            }
        }

        if (!lobbyId) {
            lobbyId = "steam_lobby_" + profile.steamId;
        }
        currentLobbyId = lobbyId;

        // Populate Lobby Data & Steam Rich Presence so friends can discover & join immediately
        if (initialized && greenworks) {
            try {
                if (typeof greenworks.setLobbyData === "function" && !lobbyId.startsWith("steam_lobby_")) {
                    greenworks.setLobbyData(lobbyId, "host_id", profile.steamId);
                    greenworks.setLobbyData(lobbyId, "host_name", profile.name);
                    greenworks.setLobbyData(lobbyId, "mp_mode", mode);
                    if (endpointStr) {
                        greenworks.setLobbyData(lobbyId, "mp_endpoints", endpointStr);
                    }
                }
            } catch (e) {}

            try {
                if (typeof greenworks.setRichPresence === "function") {
                    greenworks.setRichPresence("status", "Hosting shapez Co-op Factory");
                    greenworks.setRichPresence(
                        "connect",
                        "+connect_lobby " + lobbyId + (endpointStr ? " +connect_ip " + endpointStr : "")
                    );
                    greenworks.setRichPresence("shapez_mp_lobby", lobbyId);
                    greenworks.setRichPresence("shapez_mp_mode", mode);
                    if (endpointStr) {
                        greenworks.setRichPresence("shapez_mp_endpoint", endpointStr);
                    }
                }
            } catch (e) {}
        }

        return {
            lobbyId,
            hostId: profile.steamId,
            hostName: profile.name,
            mode,
        };
    });

    ipcMain.handle("steam:mp:join-lobby", async (event, lobbyId) => {
        if (!lobbyId) throw new Error("Missing lobbyId");
        currentLobbyId = String(lobbyId);

        if (
            initialized &&
            greenworks &&
            typeof greenworks.joinLobby === "function" &&
            !currentLobbyId.startsWith("steam_lobby_")
        ) {
            try {
                await new Promise(resolve => {
                    const timer = setTimeout(() => resolve(), 2500);
                    if (typeof greenworks.once === "function") {
                        greenworks.once("lobby-enter", () => {
                            clearTimeout(timer);
                            resolve();
                        });
                    }
                    try {
                        greenworks.joinLobby(currentLobbyId, () => {
                            clearTimeout(timer);
                            resolve();
                        });
                    } catch (e) {
                        clearTimeout(timer);
                        resolve();
                    }
                });
            } catch (e) {}
        }

        let endpoints = "";
        let hostId = "";
        let hostName = "";
        if (
            initialized &&
            greenworks &&
            typeof greenworks.getLobbyData === "function" &&
            !currentLobbyId.startsWith("steam_lobby_")
        ) {
            try {
                endpoints = greenworks.getLobbyData(currentLobbyId, "mp_endpoints") || "";
                hostId = greenworks.getLobbyData(currentLobbyId, "host_id") || "";
                hostName = greenworks.getLobbyData(currentLobbyId, "host_name") || "";
            } catch (e) {}
        }

        return {
            lobbyId: currentLobbyId,
            hostId,
            hostName,
            endpoints,
        };
    });

    ipcMain.handle("steam:mp:leave-lobby", async () => {
        if (initialized && greenworks) {
            try {
                if (
                    currentLobbyId &&
                    !currentLobbyId.startsWith("steam_lobby_") &&
                    typeof greenworks.leaveLobby === "function"
                ) {
                    greenworks.leaveLobby(currentLobbyId);
                }
            } catch (e) {}
            try {
                if (typeof greenworks.clearRichPresence === "function") {
                    greenworks.clearRichPresence();
                }
            } catch (e) {}
        }
        currentLobbyId = null;
        return { ok: true };
    });

    ipcMain.handle("steam:mp:set-lobby-data", async (event, { lobbyId, key, value }) => {
        const target = lobbyId || currentLobbyId;
        if (
            initialized &&
            greenworks &&
            target &&
            !target.startsWith("steam_lobby_") &&
            typeof greenworks.setLobbyData === "function"
        ) {
            try {
                return Boolean(greenworks.setLobbyData(target, String(key), String(value)));
            } catch (e) {}
        }
        return false;
    });

    ipcMain.handle("steam:mp:get-lobby-data", async (event, { lobbyId, key }) => {
        const target = lobbyId || currentLobbyId;
        if (
            initialized &&
            greenworks &&
            target &&
            !target.startsWith("steam_lobby_") &&
            typeof greenworks.getLobbyData === "function"
        ) {
            try {
                return greenworks.getLobbyData(target, String(key)) || "";
            } catch (e) {}
        }
        return "";
    });

    ipcMain.handle("steam:mp:set-rich-presence", async (event, kvMap = {}) => {
        if (!initialized || !greenworks || typeof greenworks.setRichPresence !== "function") {
            return false;
        }
        try {
            for (const [k, v] of Object.entries(kvMap)) {
                greenworks.setRichPresence(String(k), String(v || ""));
            }
            return true;
        } catch (e) {
            return false;
        }
    });

    ipcMain.handle("steam:mp:invite-overlay", async (event, lobbyId) => {
        if (!initialized || !greenworks) {
            return { opened: false, reason: "steam-not-initialized" };
        }
        const target = lobbyId || currentLobbyId || "";
        try {
            if (
                target &&
                !target.startsWith("steam_lobby_") &&
                typeof greenworks.activateGameOverlayInviteDialog === "function"
            ) {
                greenworks.activateGameOverlayInviteDialog(target);
                return { opened: true, mode: "invite-dialog" };
            }
            if (typeof greenworks.activateGameOverlay === "function") {
                greenworks.activateGameOverlay("Friends");
                return { opened: true, mode: "friends-overlay" };
            }
        } catch (err) {
            console.warn("[Steam MP] Failed to activate Steam overlay:", err);
        }
        return { opened: false, reason: "overlay-unavailable" };
    });

    ipcMain.handle("steam:mp:invite-friend", async (event, { friendSteamId, lobbyId, joinCode }) => {
        if (!initialized || !greenworks || !friendSteamId) {
            return { sent: false };
        }
        const targetLobby = lobbyId || currentLobbyId || "";
        let sent = false;
        try {
            if (
                targetLobby &&
                !targetLobby.startsWith("steam_lobby_") &&
                typeof greenworks.inviteUserToLobby === "function"
            ) {
                sent = Boolean(greenworks.inviteUserToLobby(targetLobby, friendSteamId));
            }
        } catch (e) {}

        // Also send a structured signal via Steam Friends Chat so the friend's in-game mod sees an instant invite popup!
        try {
            if (typeof greenworks.replyToFriendMessage === "function") {
                const profile = getLocalSteamProfile();
                const payload = JSON.stringify({
                    kind: "INVITE",
                    lobbyId: targetLobby,
                    joinCode: joinCode || "",
                    hostId: profile.steamId,
                    hostName: profile.name,
                });
                const msgSent = greenworks.replyToFriendMessage(
                    friendSteamId,
                    "[SHAPEZ_MP]:" + payload
                );
                sent = sent || Boolean(msgSent);
            }
        } catch (e) {}

        return { sent };
    });

    ipcMain.handle("steam:mp:send-friend-signal", async (event, { friendSteamId, data }) => {
        if (!initialized || !greenworks || !friendSteamId || typeof greenworks.replyToFriendMessage !== "function") {
            return { sent: false };
        }
        try {
            const payload = JSON.stringify(data);
            const ok = greenworks.replyToFriendMessage(friendSteamId, "[SHAPEZ_MP]:" + payload);
            return { sent: Boolean(ok) };
        } catch (err) {
            console.warn("[Steam MP] send-friend-signal error:", err);
            return { sent: false };
        }
    });

    // ---- TCP / Direct / LAN Networking IPC Handlers ----

    ipcMain.handle("mp:net:host-start", async (event, { port } = {}) => {
        return await startTcpHost(port || 27080);
    });

    ipcMain.handle("mp:net:host-stop", async () => {
        stopTcpHost();
        return { stopped: true };
    });

    ipcMain.handle("mp:net:host-send", async (event, { peerId, message }) => {
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
        for (const [id, sock] of hostClients) {
            if (sock && !sock.destroyed) {
                sock.write(frame);
                count++;
            }
        }
        return { sent: count };
    });

    ipcMain.handle("mp:net:host-broadcast-except", async (event, { excludePeerId, message }) => {
        const frame = createFrameBuffer(message);
        let count = 0;
        for (const [id, sock] of hostClients) {
            if (id !== excludePeerId && sock && !sock.destroyed) {
                sock.write(frame);
                count++;
            }
        }
        return { sent: count };
    });

    ipcMain.handle("mp:net:client-connect", async (event, { host, port, timeoutMs }) => {
        return await connectTcpClient(host, port, timeoutMs || 6000);
    });

    ipcMain.handle("mp:net:client-send", async (event, { message }) => {
        if (clientSocket && !clientSocket.destroyed) {
            const frame = createFrameBuffer(message);
            clientSocket.write(frame);
            return { sent: true };
        }
        return { sent: false };
    });

    ipcMain.handle("mp:net:client-disconnect", async () => {
        disconnectTcpClient();
        return { disconnected: true };
    });
}

function isInitialized(event) {
    return Promise.resolve(initialized);
}

function getAchievementNames(event) {
    if (!initialized || !greenworks) {
        return Promise.resolve([]);
    }
    return new Promise((resolve, reject) => {
        try {
            const achievements = greenworks.getAchievementNames();
            resolve(achievements);
        } catch (err) {
            reject(err);
        }
    });
}

function activateAchievement(event, id) {
    if (!initialized || !greenworks) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        greenworks.activateAchievement(
            id,
            () => resolve(),
            err => reject(err)
        );
    });
}

module.exports = {
    init,
    listen,
    setMainWindow,
};
