const fs = require("fs");
const path = require("path");
const net = require("net");
const dgram = require("dgram");
const http = require("http");
const zlib = require("zlib");
const os = require("os");
let ipcMain = { handle: () => {}, on: () => {} };
try {
    const electron = require("electron");
    if (electron && electron.ipcMain) {
        ipcMain = electron.ipcMain;
    }
} catch {}

let greenworks = null;
let steamP2P = null;
let p2pInitialized = false;
let p2pPollTimer = null;
let appId = null;
let initialized = false;
let mainWindow = null;
let currentLobbyId = null;
let currentLobbyHostId = null;
let lobbyRole = "none"; // "none" | "host" | "client"
let fallbackProfile = null;

// Persistent Logging
const ROAMING_DIR =
    process.env.APPDATA ||
    (process.platform === "darwin"
        ? path.join(process.env.HOME || "", "Library", "Preferences")
        : path.join(process.env.HOME || "", ".local", "share"));
const LOG_DIR = path.join(ROAMING_DIR || os.tmpdir(), "shapez.io");
const LOG_FILE_PATH = path.join(LOG_DIR, "coop-multiplayer.log");
const recentLogs = [];

function writeMpLog(source, level, message) {
    const line = `[${new Date().toISOString()}] [${source}] [${level}] ${message}`;
    recentLogs.push(line);
    if (recentLogs.length > 200) {
        recentLogs.shift();
    }
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        if (fs.existsSync(LOG_FILE_PATH)) {
            const stat = fs.statSync(LOG_FILE_PATH);
            if (stat.size > 2 * 1024 * 1024) {
                fs.writeFileSync(LOG_FILE_PATH, line + "\n", "utf8");
                return;
            }
        }
        fs.appendFileSync(LOG_FILE_PATH, line + "\n", "utf8");
    } catch (e) {}
}

function logInfo(msg) {
    console.log("[Steam MP]", msg);
    writeMpLog("MAIN", "INFO", msg);
}

function logWarn(msg) {
    console.warn("[Steam MP]", msg);
    writeMpLog("MAIN", "WARN", msg);
}

try {
    greenworks = require("shapez.io-private-artifacts/steam/greenworks");
    const appIdPath = path.join(__dirname, "steam_appid.txt");
    appId = fs.existsSync(appIdPath) ? parseInt(fs.readFileSync(appIdPath, "utf8")) : 1318690;
} catch (err) {
    // greenworks is not installed
    logWarn("Failed to load steam api: " + (err && err.message ? err.message : err));
}

function loadNativeSteamP2P() {
    if (steamP2P) return steamP2P;
    const candidates = [
        process.resourcesPath
            ? path.join(
                  process.resourcesPath,
                  "app.asar.unpacked",
                  "node_modules",
                  "shapez.io-private-artifacts",
                  "steam",
                  "lib",
                  "win64",
                  "steam_p2p_win64.node"
              )
            : "",
        path.join(
            __dirname,
            "..",
            "app.asar.unpacked",
            "node_modules",
            "shapez.io-private-artifacts",
            "steam",
            "lib",
            "win64",
            "steam_p2p_win64.node"
        ),
        path.join(__dirname, "steam_p2p_win64.node"),
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                steamP2P = require(candidate);
                logInfo("Loaded native Steam P2P bridge: " + candidate);
                return steamP2P;
            }
        } catch (err) {
            logWarn("Failed to load steam_p2p_win64.node from " + candidate + ": " + (err.message || err));
        }
    }
    return null;
}

function steamIdToBuffer8(idStr) {
    const s = String(idStr || "").trim();
    if (!/^\d{15,20}$/.test(s)) return null;
    try {
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigUInt64LE(BigInt(s), 0);
        return buf;
    } catch (e) {
        return null;
    }
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
            logWarn("Failed to send IPC to renderer: " + (err.message || err));
        }
    }
}

function normalizeSteamId(val) {
    if (!val) return "";
    if (typeof val === "string") return val;
    if (typeof val === "number") return String(val);
    if (typeof val.getRawSteamID === "function") {
        try {
            return String(val.getRawSteamID());
        } catch (e) {}
    }
    if (val.steamId) return String(val.steamId);
    if (val.staticAccountId) return String(val.staticAccountId);
    return String(val);
}

function isRealSteamLobbyId(id) {
    const s = String(id || "").trim();
    if (!s || s === "0" || s.startsWith("steam_lobby_")) return false;
    return /^109\d{14,15}$/.test(s);
}

function getLocalSteamProfile() {
    if (initialized && greenworks && typeof greenworks.getSteamId === "function") {
        try {
            const info = greenworks.getSteamId();
            const steamId = normalizeSteamId(info);
            return {
                steamId: steamId || "steam_local",
                name:
                    info.screenName ||
                    (typeof info.getPersonaName === "function" ? info.getPersonaName() : "Steam Player"),
                accountId: info.accountId || 0,
                level: info.level || 1,
                isSteam: true,
            };
        } catch (err) {
            logWarn("Error reading greenworks.getSteamId(): " + (err.message || err));
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
            logWarn("restartAppIfNecessary check failed: " + (err.message || err));
        }
    }

    try {
        if (!greenworks.init()) {
            logWarn("Failed to initialize greenworks");
            if (!isDev && !allowMultiInstance) {
                process.exit(1);
            }
            return;
        }
        initialized = true;
        console.log("Steam (greenworks) initialized successfully.");
        writeMpLog("MAIN", "INFO", "Steam (greenworks) initialized successfully.");

        const nativeP2P = loadNativeSteamP2P();
        if (nativeP2P && typeof nativeP2P.init === "function") {
            try {
                p2pInitialized = Boolean(nativeP2P.init());
                logInfo("Native ISteamNetworking P2P initialized: " + p2pInitialized);
                if (p2pInitialized) {
                    startP2PPollTimer();
                }
            } catch (err) {
                p2pInitialized = false;
                logWarn("Native Steam P2P init failed: " + (err.message || err));
            }
        }

        setupSteamEventListeners();
    } catch (err) {
        logWarn("Steam initialization threw error (continuing in local/LAN fallback mode): " + (err.message || err));
        if (!isDev && !allowMultiInstance) {
            initialized = false;
        }
    }
}

// ============================================================================
// Native ISteamNetworking P2P Packet Transport + Single-Lobby Metadata Channel
// ============================================================================

const acceptedP2PPeers = new Set();
let lobbyPollTimer = null;
let txSeqCounter = 0;
const txQueues = new Map(); // targetSteamId -> Array<{ seq, ts, data }>
const rxLastSeq = new Map(); // fromSteamId -> number
const peerAckSeq = new Map(); // peerSteamId -> number
const knownLobbyMembers = new Set();

function ensureP2PSessionAccepted(steamIdStr) {
    if (!p2pInitialized || !steamP2P || !steamIdStr) return;
    if (acceptedP2PPeers.has(steamIdStr)) return;
    const idBuf = steamIdToBuffer8(steamIdStr);
    if (!idBuf) return;
    try {
        steamP2P.acceptP2PSession(idBuf);
        acceptedP2PPeers.add(steamIdStr);
    } catch (e) {}
}

function drainP2PChannel(channel) {
    if (!p2pInitialized || !steamP2P || typeof steamP2P.readP2PPacket !== "function") return;
    let guard = 0;
    while (guard++ < 64) {
        let pkt = null;
        try {
            pkt = steamP2P.readP2PPacket(channel);
        } catch (e) {
            break;
        }
        if (!pkt || pkt.length <= 8) break;

        let fromId = "";
        try {
            fromId = pkt.readBigUInt64LE(0).toString();
        } catch (e) {
            continue;
        }
        ensureP2PSessionAccepted(fromId);

        let parsed = null;
        try {
            parsed = JSON.parse(pkt.subarray(8).toString("utf8"));
        } catch (e) {
            continue;
        }
        if (!parsed || typeof parsed !== "object") continue;

        let fromName = fromId;
        try {
            if (greenworks && typeof greenworks.getFriendPersonaName === "function") {
                fromName = greenworks.getFriendPersonaName(fromId) || fromId;
            }
        } catch (e) {}

        const dataObj = parsed.kind ? parsed : { kind: "STEAM_PACKET", packet: parsed };
        if (channel === 0 && (!dataObj.packet || dataObj.packet.type !== "CURSOR")) {
            logInfo(
                `Received Steam P2P packet kind=${dataObj.kind}${
                    dataObj.packet && dataObj.packet.type ? ":" + dataObj.packet.type : ""
                } from=${fromName} (${fromId})`
            );
        }

        sendToRenderer("steam:mp:event", {
            type: "steam-friend-signal",
            fromSteamId: fromId,
            fromName,
            data: dataObj,
        });
    }
}

function startP2PPollTimer() {
    if (p2pPollTimer) clearInterval(p2pPollTimer);
    p2pPollTimer = setInterval(() => {
        drainP2PChannel(0);
        drainP2PChannel(1);
    }, 15);
    if (typeof p2pPollTimer.unref === "function") {
        p2pPollTimer.unref();
    }
}

function sendViaSteamP2P(targetSteamId, dataObj) {
    if (!p2pInitialized || !steamP2P || typeof steamP2P.sendP2PPacket !== "function") {
        return false;
    }
    const idBuf = steamIdToBuffer8(targetSteamId);
    if (!idBuf) return false;

    ensureP2PSessionAccepted(targetSteamId);

    const isUnreliableCursor =
        dataObj &&
        dataObj.kind === "STEAM_PACKET" &&
        dataObj.packet &&
        dataObj.packet.type === "CURSOR";
    const sendType = isUnreliableCursor ? 0 : 2; // 0 = k_EP2PSendUnreliable, 2 = k_EP2PSendReliable (up to 1MB)
    const channel = isUnreliableCursor ? 1 : 0;

    try {
        const payloadBuf = Buffer.from(JSON.stringify(dataObj), "utf8");
        const ok = Boolean(steamP2P.sendP2PPacket(idBuf, payloadBuf, sendType, channel));
        if (channel === 0) {
            logInfo(
                `Sent Steam P2P packet (${payloadBuf.length}B, ok=${ok}) kind=${dataObj.kind}${
                    dataObj.packet && dataObj.packet.type ? ":" + dataObj.packet.type : ""
                } to=${targetSteamId}`
            );
        }
        return ok;
    } catch (err) {
        logWarn("sendP2PPacket failed: " + (err.message || err));
        return false;
    }
}

function encodeLobbyWindow(windowObj) {
    try {
        const json = JSON.stringify(windowObj);
        const compressed = zlib.deflateRawSync(Buffer.from(json, "utf8")).toString("base64");
        return "Z:" + compressed;
    } catch (e) {
        return "";
    }
}

function decodeLobbyWindow(rawStr) {
    if (!rawStr || typeof rawStr !== "string") return null;
    try {
        if (rawStr.startsWith("Z:")) {
            const json = zlib.inflateRawSync(Buffer.from(rawStr.slice(2), "base64")).toString("utf8");
            return JSON.parse(json);
        }
        return JSON.parse(rawStr);
    } catch (e) {
        return null;
    }
}

function resetLobbyChannelState() {
    if (lobbyPollTimer) {
        clearInterval(lobbyPollTimer);
        lobbyPollTimer = null;
    }
    txQueues.clear();
    rxLastSeq.clear();
    peerAckSeq.clear();
    knownLobbyMembers.clear();
    acceptedP2PPeers.clear();
}

function startLobbyPollTimer() {
    if (lobbyPollTimer) {
        clearInterval(lobbyPollTimer);
    }
    lobbyPollTimer = setInterval(() => {
        try {
            pollLobbyChannel();
        } catch (e) {}
    }, 250);
    if (typeof lobbyPollTimer.unref === "function") {
        lobbyPollTimer.unref();
    }
}

function getLobbyOwnerSteamId(lobbyId) {
    if (!initialized || !greenworks || !isRealSteamLobbyId(lobbyId) || typeof greenworks.getLobbyOwner !== "function") {
        return "";
    }
    try {
        return normalizeSteamId(greenworks.getLobbyOwner(lobbyId));
    } catch (e) {
        return "";
    }
}

function buildEncodedWindowForTarget(targetSteamId, fromSteamId) {
    const queue = txQueues.get(targetSteamId) || [];
    const acked = peerAckSeq.get(targetSteamId) || 0;
    const now = Date.now();

    const remaining = queue.filter(item => item.seq > acked && now - item.ts < 25000);
    txQueues.set(targetSteamId, remaining);

    const activeItems = [];
    let encoded = encodeLobbyWindow({
        from: fromSteamId,
        ack: rxLastSeq.get(targetSteamId) || 0,
        items: activeItems,
    });

    for (const item of remaining) {
        activeItems.push({ seq: item.seq, data: item.data });
        const candidate = encodeLobbyWindow({
            from: fromSteamId,
            ack: rxLastSeq.get(targetSteamId) || 0,
            items: activeItems,
        });
        if (candidate.length > 2800 && activeItems.length > 1) {
            activeItems.pop();
            break;
        }
        encoded = candidate;
    }

    return encoded;
}

function flushLobbyChannel() {
    if (!initialized || !greenworks || typeof greenworks.setLobbyData !== "function" || !isRealSteamLobbyId(currentLobbyId)) {
        return false;
    }
    const localId = getLocalSteamProfile().steamId;

    if (lobbyRole === "host") {
        let wroteAny = false;
        for (const [targetSteamId] of txQueues) {
            const encoded = buildEncodedWindowForTarget(targetSteamId, localId);
            if (encoded) {
                try {
                    greenworks.setLobbyData(currentLobbyId, "mp_h2c_" + targetSteamId, encoded);
                    greenworks.setLobbyData(
                        currentLobbyId,
                        "ack_" + targetSteamId,
                        String(rxLastSeq.get(targetSteamId) || 0)
                    );
                    wroteAny = true;
                } catch (e) {}
            }
        }
        return wroteAny;
    }

    if (lobbyRole === "client") {
        const targetHost = currentLobbyHostId || "host";
        const encoded = buildEncodedWindowForTarget(targetHost, localId);
        const ackStr = String(rxLastSeq.get(targetHost) || 0);
        try {
            if (encoded) {
                greenworks.setLobbyData(currentLobbyId, "mp_c2h_" + localId, encoded);
            }
            greenworks.setLobbyData(currentLobbyId, "ack_" + localId, ackStr);
            return true;
        } catch (e) {}
    }

    return false;
}

function processIncomingEncodedWindow(expectedFromSteamId, rawStr) {
    if (!rawStr) return;
    const decoded = decodeLobbyWindow(rawStr);
    if (!decoded || typeof decoded !== "object") return;

    const fromId = normalizeSteamId(decoded.from || expectedFromSteamId);
    if (!fromId) return;

    if (typeof decoded.ack === "number" && decoded.ack > (peerAckSeq.get(fromId) || 0)) {
        peerAckSeq.set(fromId, decoded.ack);
    }

    if (!Array.isArray(decoded.items) || decoded.items.length === 0) return;

    let highestSeq = rxLastSeq.get(fromId) || 0;
    const sorted = decoded.items.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
    let receivedNew = false;

    for (const item of sorted) {
        if (!item || typeof item.seq !== "number" || item.seq <= highestSeq) continue;
        highestSeq = item.seq;
        rxLastSeq.set(fromId, highestSeq);
        receivedNew = true;

        let fromName = fromId;
        try {
            if (greenworks && typeof greenworks.getFriendPersonaName === "function") {
                fromName = greenworks.getFriendPersonaName(fromId) || fromId;
            }
        } catch (e) {}

        logInfo(`Received lobby signal seq=${item.seq} kind=${item.data && item.data.kind} from=${fromName} (${fromId})`);
        sendToRenderer("steam:mp:event", {
            type: "steam-friend-signal",
            fromSteamId: fromId,
            fromName,
            data: item.data,
        });
    }

    if (receivedNew) {
        flushLobbyChannel();
    }
}

function pollLobbyChannel() {
    if (!initialized || !greenworks || !isRealSteamLobbyId(currentLobbyId)) return;
    const localId = getLocalSteamProfile().steamId;

    if (lobbyRole === "host") {
        let memberCount = 0;
        try {
            if (typeof greenworks.getNumLobbyMembers === "function") {
                memberCount = Number(greenworks.getNumLobbyMembers(currentLobbyId)) || 0;
            }
        } catch (e) {}

        const currentMembers = new Set();
        for (let i = 0; i < memberCount; i++) {
            try {
                const mObj = greenworks.getLobbyMemberByIndex(currentLobbyId, i);
                const mId = normalizeSteamId(mObj);
                if (mId && mId !== localId) {
                    currentMembers.add(mId);
                    ensureP2PSessionAccepted(mId);
                    if (!knownLobbyMembers.has(mId)) {
                        knownLobbyMembers.add(mId);
                        let mName = mId;
                        try {
                            if (greenworks.getFriendPersonaName) {
                                mName = greenworks.getFriendPersonaName(mId) || mId;
                            }
                        } catch (e) {}
                        logInfo(`Lobby member joined host lobby ${currentLobbyId}: ${mName} (${mId})`);
                        sendToRenderer("steam:mp:event", {
                            type: "lobby-member-joined",
                            lobbyId: currentLobbyId,
                            memberId: mId,
                            memberName: mName,
                        });
                    }
                }
            } catch (e) {}
        }

        for (const [targetId] of txQueues) {
            if (targetId && targetId !== localId) {
                currentMembers.add(targetId);
            }
        }

        for (const memberId of currentMembers) {
            try {
                const ackVal = Number(greenworks.getLobbyData(currentLobbyId, "ack_" + memberId) || 0);
                if (ackVal > (peerAckSeq.get(memberId) || 0)) {
                    peerAckSeq.set(memberId, ackVal);
                }
                const rawOnHostLobby = greenworks.getLobbyData(currentLobbyId, "mp_c2h_" + memberId);
                if (rawOnHostLobby) {
                    processIncomingEncodedWindow(memberId, rawOnHostLobby);
                }
            } catch (e) {}
        }

        flushLobbyChannel();
    } else if (lobbyRole === "client") {
        if (!currentLobbyHostId) {
            try {
                const hId =
                    greenworks.getLobbyData(currentLobbyId, "host_id") || getLobbyOwnerSteamId(currentLobbyId);
                if (hId && hId !== localId) {
                    currentLobbyHostId = hId;
                    ensureP2PSessionAccepted(hId);
                }
            } catch (e) {}
        }

        const hostKey = currentLobbyHostId || "host";
        try {
            const ackVal = Number(greenworks.getLobbyData(currentLobbyId, "ack_" + localId) || 0);
            if (ackVal > (peerAckSeq.get(hostKey) || 0)) {
                peerAckSeq.set(hostKey, ackVal);
            }
            const rawDirect = greenworks.getLobbyData(currentLobbyId, "mp_h2c_" + localId);
            if (rawDirect) {
                processIncomingEncodedWindow(hostKey, rawDirect);
            }
            const rawAll = greenworks.getLobbyData(currentLobbyId, "mp_h2c_all");
            if (rawAll) {
                processIncomingEncodedWindow(hostKey, rawAll);
            }
        } catch (e) {}

        flushLobbyChannel();
    }
}

function createSteamLobbyInternal(maxPlayers = 8) {
    if (!initialized || !greenworks || typeof greenworks.createLobby !== "function") {
        return Promise.resolve(null);
    }
    const lobbyType =
        greenworks.LobbyType && greenworks.LobbyType.Public !== undefined
            ? greenworks.LobbyType.Public
            : greenworks.LobbyType && greenworks.LobbyType.FriendsOnly !== undefined
            ? greenworks.LobbyType.FriendsOnly
            : 2;

    return new Promise(resolve => {
        let done = false;
        const finish = id => {
            if (!done) {
                done = true;
                resolve(id && isRealSteamLobbyId(id) ? normalizeSteamId(id) : null);
            }
        };
        const timer = setTimeout(() => finish(null), 3000);
        const onCreated = (res, createdLobbyId) => {
            clearTimeout(timer);
            const actualId = createdLobbyId
                ? normalizeSteamId(createdLobbyId)
                : typeof res === "string"
                ? normalizeSteamId(res)
                : null;
            finish(actualId);
        };
        if (typeof greenworks.once === "function") {
            greenworks.once("lobby-created", onCreated);
        }
        try {
            greenworks.createLobby(lobbyType, maxPlayers, id => {
                if (id) {
                    clearTimeout(timer);
                    finish(id);
                }
            });
        } catch (e) {
            clearTimeout(timer);
            finish(null);
        }
    });
}

function setupSteamEventListeners() {
    if (!greenworks || typeof greenworks.on !== "function") {
        return;
    }

    greenworks.on("lobby-created", (result, lobbyId) => {
        const idStr = normalizeSteamId(lobbyId || (typeof result === "string" ? result : ""));
        logInfo(`lobby-created event: result=${result} lobbyId=${idStr}`);
        if (idStr && isRealSteamLobbyId(idStr)) {
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
        logInfo(`lobby-enter event: lobbyId=${idStr} response=${response}`);
        if (idStr && isRealSteamLobbyId(idStr)) {
            currentLobbyId = idStr;
        }
        sendToRenderer("steam:mp:event", {
            type: "lobby-enter",
            lobbyId: idStr,
            chatPermissions,
            locked,
            response,
        });
        try {
            pollLobbyChannel();
        } catch (e) {}
    });

    greenworks.on("lobby-data-update", (arg1, arg2, arg3) => {
        // greenworks-win64.node passes (lobbyId, memberId, success)
        const isFirstBool = typeof arg1 === "boolean";
        const success = isFirstBool ? arg1 : Boolean(arg3);
        const lobbyId = normalizeSteamId(isFirstBool ? arg2 : arg1);
        const memberId = normalizeSteamId(isFirstBool ? arg3 : arg2);

        try {
            pollLobbyChannel();
        } catch (e) {}

        sendToRenderer("steam:mp:event", {
            type: "lobby-data-update",
            success,
            lobbyId,
            memberId,
        });
    });

    greenworks.on("lobby-invite", (inviterId, lobbyId, gameId) => {
        const fromId = normalizeSteamId(inviterId);
        const targetLobby = normalizeSteamId(lobbyId);
        ensureP2PSessionAccepted(fromId);
        let fromName = fromId;
        try {
            if (greenworks.getFriendPersonaName) {
                fromName = greenworks.getFriendPersonaName(fromId) || fromId;
            }
        } catch (e) {}
        logInfo(`lobby-invite from ${fromName} (${fromId}) to lobby ${targetLobby}`);
        sendToRenderer("steam:mp:event", {
            type: "lobby-invite",
            inviterId: fromId,
            inviterName: fromName,
            lobbyId: targetLobby,
            gameId: String(gameId || ""),
        });
    });

    greenworks.on("lobby-join-requested", (lobbyId, friendId) => {
        const targetLobby = normalizeSteamId(lobbyId);
        const fromFriend = normalizeSteamId(friendId);
        ensureP2PSessionAccepted(fromFriend);
        logInfo(`lobby-join-requested: lobby=${targetLobby} from=${fromFriend}`);
        sendToRenderer("steam:mp:event", {
            type: "lobby-join-requested",
            lobbyId: targetLobby,
            friendId: fromFriend,
        });
    });

    greenworks.on("rich-presence-join-requested", (friendId, connectStr) => {
        const fromFriend = normalizeSteamId(friendId);
        ensureP2PSessionAccepted(fromFriend);
        logInfo(`rich-presence-join-requested: from=${fromFriend} connect=${connectStr}`);
        sendToRenderer("steam:mp:event", {
            type: "rich-presence-join-requested",
            friendId: fromFriend,
            connect: String(connectStr || ""),
        });
    });
}

// ============================================================================
// TCP / LAN / UPnP / Direct P2P Socket Framing Layer (Main Process)
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
                logWarn("Failed to parse framed JSON message: " + (err.message || err));
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

function tryUpnpPortMapping(internalIp, port, timeoutMs = 900) {
    if (!internalIp || !port) return Promise.resolve(null);
    return new Promise(resolve => {
        let done = false;
        const finish = extIp => {
            if (!done) {
                done = true;
                try {
                    udp.close();
                } catch (e) {}
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
            } catch (e) {}
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
                } catch (e) {}
            }
        });
    });
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

                // Attempt fast non-blocking UPnP port mapping if we have a LAN IP
                if (ips.length > 0) {
                    try {
                        const extIp = await tryUpnpPortMapping(ips[0].address, tcpServerPort, 850);
                        if (extIp) {
                            endpoints.unshift(extIp + ":" + tcpServerPort);
                        }
                    } catch (e) {}
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

    ipcMain.handle("steam:mp:log", async (event, { level, message } = {}) => {
        writeMpLog("RENDERER", level || "INFO", String(message || ""));
        return { ok: true };
    });

    ipcMain.handle("steam:mp:get-logs", async () => {
        return {
            logPath: LOG_FILE_PATH,
            lines: recentLogs.slice(-80),
        };
    });

    ipcMain.handle("steam:mp:get-status", async () => {
        let launchCmd = "";
        if (initialized && greenworks && typeof greenworks.getLaunchCommandLine === "function") {
            try {
                launchCmd = greenworks.getLaunchCommandLine() || "";
            } catch (e) {}
        }
        return {
            initialized: Boolean(initialized && greenworks),
            p2pInitialized,
            profile: getLocalSteamProfile(),
            launchCmd,
            activeLobbyId: currentLobbyId,
            localIps: getLocalIPv4Addresses(),
            hostPort: tcpServerPort,
            logPath: LOG_FILE_PATH,
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
            const targetAppStr = String(appId || "1318690");

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
                let isPlayingShapez = false;
                let isInGame = false;

                if (p2pInitialized && steamP2P && typeof steamP2P.requestFriendRichPresence === "function") {
                    const idBuf = steamIdToBuffer8(steamId);
                    if (idBuf) {
                        try {
                            steamP2P.requestFriendRichPresence(idBuf);
                        } catch (e) {}
                    }
                }

                if (typeof greenworks.getFriendGamePlayed === "function") {
                    try {
                        const gp = greenworks.getFriendGamePlayed(steamId);
                        if (gp && gp.m_gameID && String(gp.m_gameID) !== "0") {
                            isInGame = true;
                            if (String(gp.m_gameID) === targetAppStr) {
                                isPlayingShapez = true;
                                const gpLobby = gp.m_steamIDLobby ? normalizeSteamId(gp.m_steamIDLobby) : "";
                                if (isRealSteamLobbyId(gpLobby)) {
                                    mpLobby = gpLobby;
                                }
                            }
                        }
                    } catch (e) {}
                }

                if (typeof greenworks.getFriendRichPresence === "function") {
                    try {
                        if (typeof greenworks.requestUserInformation === "function") {
                            greenworks.requestUserInformation(steamId, true);
                        }
                        connect = greenworks.getFriendRichPresence(steamId, "connect") || "";
                        mpEndpoint = greenworks.getFriendRichPresence(steamId, "shapez_mp_endpoint") || "";
                        const rpLobby = greenworks.getFriendRichPresence(steamId, "shapez_mp_lobby") || "";
                        if (isRealSteamLobbyId(rpLobby)) {
                            mpLobby = rpLobby;
                        }
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
                    isPlayingShapez,
                    isInGame,
                });
            }

            // Sort friends so those hosting shapez Co-op or playing shapez appear at the very top
            list.sort((a, b) => {
                const aHost = a.mpLobby || a.mpEndpoint ? 1 : 0;
                const bHost = b.mpLobby || b.mpEndpoint ? 1 : 0;
                if (aHost !== bHost) return bHost - aHost;
                if (a.isPlayingShapez !== b.isPlayingShapez) return (b.isPlayingShapez ? 1 : 0) - (a.isPlayingShapez ? 1 : 0);
                if (a.isInGame !== b.isInGame) return (b.isInGame ? 1 : 0) - (a.isInGame ? 1 : 0);
                return String(a.name).localeCompare(String(b.name));
            });

            return list;
        } catch (err) {
            logWarn("get-friends failed: " + (err.message || err));
            return [];
        }
    });

    ipcMain.handle("steam:mp:create-lobby", async (event, options = {}) => {
        const maxPlayers = options.maxPlayers || 8;
        const mode = options.mode || "coop";
        const endpointStr = options.endpoint || "";
        const profile = getLocalSteamProfile();

        resetLobbyChannelState();

        // Create native Steam Matchmaking Lobby and wait for "lobby-created"
        let lobbyId = await createSteamLobbyInternal(maxPlayers);

        if (!lobbyId) {
            lobbyId = "steam_lobby_" + profile.steamId;
        }
        currentLobbyId = lobbyId;
        currentLobbyHostId = profile.steamId;
        lobbyRole = "host";

        logInfo(`Created host lobby: ${lobbyId} (host=${profile.name} [${profile.steamId}], endpoints=${endpointStr})`);

        // Populate Lobby Data & Steam Rich Presence so friends can discover & join immediately
        if (initialized && greenworks) {
            try {
                if (typeof greenworks.setLobbyData === "function" && isRealSteamLobbyId(lobbyId)) {
                    greenworks.setLobbyData(lobbyId, "host_id", profile.steamId);
                    greenworks.setLobbyData(lobbyId, "host_name", profile.name);
                    greenworks.setLobbyData(lobbyId, "mp_mode", mode);
                    if (endpointStr) {
                        greenworks.setLobbyData(lobbyId, "mp_endpoints", endpointStr);
                    }
                    if (typeof greenworks.setLobbyJoinable === "function") {
                        greenworks.setLobbyJoinable(lobbyId, true);
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

            if (isRealSteamLobbyId(lobbyId)) {
                startLobbyPollTimer();
            }
        }

        return {
            lobbyId,
            hostId: profile.steamId,
            hostName: profile.name,
            mode,
        };
    });

    ipcMain.handle("steam:mp:join-lobby", async (event, arg) => {
        const lobbyIdArg = typeof arg === "object" && arg !== null ? arg.lobbyId : arg;
        const hostSteamIdArg = typeof arg === "object" && arg !== null ? normalizeSteamId(arg.hostSteamId) : "";

        let targetLobby = String(lobbyIdArg || "").trim();

        // If targetLobby is missing or a synthetic fallback, try discovering the friend's active Steam lobby via getFriendGamePlayed
        if (!isRealSteamLobbyId(targetLobby) && hostSteamIdArg && initialized && greenworks) {
            try {
                if (typeof greenworks.getFriendGamePlayed === "function") {
                    const gp = greenworks.getFriendGamePlayed(hostSteamIdArg);
                    const gpLobby = gp && gp.m_steamIDLobby ? normalizeSteamId(gp.m_steamIDLobby) : "";
                    if (isRealSteamLobbyId(gpLobby)) {
                        targetLobby = gpLobby;
                    }
                }
            } catch (e) {}
        }

        if (!targetLobby && hostSteamIdArg) {
            targetLobby = "steam_lobby_" + hostSteamIdArg;
        }
        if (!targetLobby) throw new Error("Missing lobbyId");

        resetLobbyChannelState();
        currentLobbyId = targetLobby;
        currentLobbyHostId = hostSteamIdArg || "";
        lobbyRole = "client";

        if (currentLobbyHostId) {
            ensureP2PSessionAccepted(currentLobbyHostId);
        }

        const joinSingleLobby = idToJoin => {
            if (!initialized || !greenworks || typeof greenworks.joinLobby !== "function" || !isRealSteamLobbyId(idToJoin)) {
                return Promise.resolve();
            }
            if (p2pInitialized && steamP2P && typeof steamP2P.requestLobbyData === "function") {
                const lobbyBuf = steamIdToBuffer8(idToJoin);
                if (lobbyBuf) {
                    try {
                        steamP2P.requestLobbyData(lobbyBuf);
                    } catch (e) {}
                }
            }
            return new Promise(resolve => {
                let settled = false;
                const done = () => {
                    if (!settled) {
                        settled = true;
                        resolve();
                    }
                };
                const timer = setTimeout(done, 2500);
                if (typeof greenworks.once === "function") {
                    greenworks.once("lobby-enter", () => {
                        clearTimeout(timer);
                        done();
                    });
                }
                try {
                    greenworks.joinLobby(idToJoin, () => {
                        clearTimeout(timer);
                        done();
                    });
                } catch (e) {
                    clearTimeout(timer);
                    done();
                }
            });
        };

        await joinSingleLobby(currentLobbyId);

        let endpoints = "";
        let hostId = currentLobbyHostId;
        let hostName = "";

        if (
            initialized &&
            greenworks &&
            typeof greenworks.getLobbyData === "function" &&
            isRealSteamLobbyId(currentLobbyId)
        ) {
            try {
                endpoints = greenworks.getLobbyData(currentLobbyId, "mp_endpoints") || "";
                hostId =
                    greenworks.getLobbyData(currentLobbyId, "host_id") ||
                    getLobbyOwnerSteamId(currentLobbyId) ||
                    hostId;
                hostName = greenworks.getLobbyData(currentLobbyId, "host_name") || "";
            } catch (e) {}
        }

        currentLobbyHostId = hostId;
        if (hostId) {
            ensureP2PSessionAccepted(hostId);
        }
        if (!hostName && hostId && initialized && greenworks && typeof greenworks.getFriendPersonaName === "function") {
            try {
                hostName = greenworks.getFriendPersonaName(hostId) || "";
            } catch (e) {}
        }

        if (initialized && greenworks && isRealSteamLobbyId(currentLobbyId)) {
            startLobbyPollTimer();
            pollLobbyChannel();
        }

        logInfo(`Joined lobby ${currentLobbyId}: hostId=${hostId} hostName=${hostName} endpoints=${endpoints}`);

        return {
            lobbyId: currentLobbyId,
            hostId,
            hostName,
            endpoints,
        };
    });

    ipcMain.handle("steam:mp:leave-lobby", async () => {
        resetLobbyChannelState();
        if (initialized && greenworks) {
            try {
                if (currentLobbyId && isRealSteamLobbyId(currentLobbyId) && typeof greenworks.leaveLobby === "function") {
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
        currentLobbyHostId = null;
        lobbyRole = "none";
        return { ok: true };
    });

    ipcMain.handle("steam:mp:set-lobby-data", async (event, { lobbyId, key, value }) => {
        const target = lobbyId || currentLobbyId;
        if (
            initialized &&
            greenworks &&
            target &&
            isRealSteamLobbyId(target) &&
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
            isRealSteamLobbyId(target) &&
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
                isRealSteamLobbyId(target) &&
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
            logWarn("Failed to activate Steam overlay: " + (err.message || err));
        }
        return { opened: false, reason: "overlay-unavailable" };
    });

    ipcMain.handle("steam:mp:invite-friend", async (event, { friendSteamId, lobbyId }) => {
        if (!initialized || !greenworks || !friendSteamId) {
            return { sent: false };
        }
        const targetLobby = lobbyId || currentLobbyId || "";
        let sent = false;
        ensureP2PSessionAccepted(normalizeSteamId(friendSteamId));
        try {
            if (targetLobby && isRealSteamLobbyId(targetLobby) && typeof greenworks.inviteUserToLobby === "function") {
                sent = Boolean(greenworks.inviteUserToLobby(targetLobby, friendSteamId));
                logInfo(`Sent native Steam lobby invite to ${friendSteamId} for lobby ${targetLobby} (sent=${sent})`);
            }
        } catch (e) {
            logWarn("inviteUserToLobby error: " + (e.message || e));
        }
        return { sent };
    });

    ipcMain.handle("steam:mp:send-friend-signal", async (event, { friendSteamId, lobbyId, data }) => {
        if (!initialized || !greenworks || !data) {
            return { sent: false };
        }
        if (lobbyId && isRealSteamLobbyId(lobbyId) && !currentLobbyId) {
            currentLobbyId = normalizeSteamId(lobbyId);
        }

        let targetId = normalizeSteamId(friendSteamId || currentLobbyHostId || "");
        if ((!targetId || targetId === "host") && isRealSteamLobbyId(currentLobbyId)) {
            const ownerId = getLobbyOwnerSteamId(currentLobbyId);
            if (ownerId) {
                targetId = ownerId;
                if (lobbyRole === "client") currentLobbyHostId = ownerId;
            }
        }
        if (!targetId) {
            return { sent: false };
        }

        // Primary transport: Native Steamworks ISteamNetworking::SendP2PPacket
        if (sendViaSteamP2P(targetId, data)) {
            return { sent: true, transport: "steam-p2p" };
        }

        // Fallback transport (when native P2P is unavailable, e.g. in unit test mocks): Single-Lobby Metadata
        const queueKey = lobbyRole === "client" ? currentLobbyHostId || targetId : targetId;
        if (!txQueues.has(queueKey)) {
            txQueues.set(queueKey, []);
        }
        const seq = ++txSeqCounter;
        txQueues.get(queueKey).push({
            seq,
            ts: Date.now(),
            data,
        });

        logInfo(`Queued lobby signal seq=${seq} kind=${data.kind} to=${queueKey}`);
        const flushed = flushLobbyChannel();
        if (!lobbyPollTimer && isRealSteamLobbyId(currentLobbyId)) {
            startLobbyPollTimer();
        }
        return { sent: true, flushed, seq, transport: "lobby-data" };
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
        for (const [, sock] of hostClients) {
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
    createFrameBuffer,
    attachFrameParser,
    startTcpHost,
    stopTcpHost,
    connectTcpClient,
    disconnectTcpClient,
    isRealSteamLobbyId,
    steamIdToBuffer8,
    loadNativeSteamP2P,
    encodeLobbyWindow,
    decodeLobbyWindow,
    LOG_FILE_PATH,
};

