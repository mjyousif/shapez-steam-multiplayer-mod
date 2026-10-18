/**
 * @file src/bridge/native_p2p.js
 * @description Low-level wrapper and session orchestrator for the native Steamworks P2P C++ addon (`steam_p2p_win64.node`).
 * 
 * Provides:
 * 1. Dynamic discovery and loading of `steam_p2p_win64.node` across unpacked ASAR and development paths.
 * 2. 64-bit Steam ID serialization between JavaScript strings and 8-byte Little-Endian binary buffers.
 * 3. Bidirectional packet transport across two dedicated P2P channels:
 *    - Channel 0: Reliable ordered (`k_EP2PSendReliable = 2`) for handshakes, world dumps, and game actions.
 *    - Channel 1: Unreliable low-latency (`k_EP2PSendUnreliable = 0`) for continuous cursor position streaming.
 * 4. Automatic session acceptance via `ISteamNetworking::AcceptP2PSession`.
 * 5. High-frequency non-blocking packet polling loop (15ms tick).
 * 
 * Architectural Invariants:
 * - Never blocks the Electron event loop; uses non-blocking read calls with iteration limits.
 * - Enforces 64-bit Steam ID integrity checks to prevent buffer overflow or malformed packets.
 */

const fs = require("fs");
const path = require("path");
const { logInfo, logWarn } = require("./logger");

/**
 * Cached reference to the loaded C++ native addon.
 * @type {object | null}
 */
let steamP2P = null;

/**
 * Flag indicating whether native Steamworks P2P was successfully initialized.
 * @type {boolean}
 */
let p2pInitialized = false;

/**
 * Active high-frequency polling interval timer.
 * @type {NodeJS.Timeout | null}
 */
let p2pPollTimer = null;

/**
 * Set of 64-bit Steam ID strings whose P2P sessions have already been accepted.
 * @type {Set<string>}
 */
const acceptedP2PPeers = new Set();

/**
 * Optional external delegate for dispatching events to the Electron Renderer process.
 * Set during bridge initialization.
 * @type {((channel: string, payload: any) => void) | null}
 */
let rendererSender = null;

/**
 * Optional external delegate for looking up Steam friend display names via Greenworks.
 * @type {((steamId: string) => string) | null}
 */
let friendNameResolver = null;

/**
 * Sets the renderer event dispatcher callback.
 * @param {(channel: string, payload: any) => void} fn - Dispatch function.
 */
function setRendererSender(fn) {
    rendererSender = fn;
}

/**
 * Sets the friend persona name lookup callback.
 * @param {(steamId: string) => string} fn - Persona resolver.
 */
function setFriendNameResolver(fn) {
    friendNameResolver = fn;
}

/**
 * Dispatches a message to the Electron Renderer window if the delegate is configured.
 * @param {string} channel - IPC channel name.
 * @param {any} payload - Serializable data payload.
 */
function sendToRenderer(channel, payload) {
    if (typeof rendererSender === "function") {
        rendererSender(channel, payload);
    }
}

/**
 * Locates and dynamically loads the native `steam_p2p_win64.node` addon.
 * Searches:
 * 1. `process.resourcesPath/app.asar.unpacked/...` (Production installed game)
 * 2. Relative `../app.asar.unpacked/...` (Local development environment)
 * 3. Direct sibling `src/steam_p2p_win64.node` (Build tree)
 *
 * @returns {object | null} Native addon module or null if unavailable.
 */
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
        path.join(__dirname, "..", "..", "bin", "steam_p2p_win64.node"),
        path.join(__dirname, "..", "bin", "steam_p2p_win64.node"),
        path.join(__dirname, "..", "steam_p2p_win64.node"),
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

/**
 * Converts a 64-bit Steam ID decimal string into an 8-byte Little-Endian Buffer.
 *
 * @param {string | number} idStr - 64-bit Steam ID string (e.g. "76561198000000001").
 * @returns {Buffer | null} 8-byte Buffer or null if invalid.
 */
function steamIdToBuffer8(idStr) {
    const s = String(idStr || "").trim();
    if (!/^\d{15,20}$/.test(s)) return null;
    try {
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigUInt64LE(BigInt(s), 0);
        return buf;
    } catch {
        return null;
    }
}

/**
 * Converts an 8-byte Little-Endian Buffer into a 64-bit Steam ID decimal string.
 *
 * @param {Buffer} buffer - 8-byte Buffer.
 * @returns {string} 64-bit Steam ID decimal string.
 */
function buffer8ToSteamId(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8) return "";
    try {
        return buffer.readBigUInt64LE(0).toString();
    } catch {
        return "";
    }
}

/**
 * Ensures that an incoming Steamworks P2P session from a peer has been accepted.
 *
 * @param {string} steamIdStr - Peer 64-bit Steam ID string.
 */
function ensureP2PSessionAccepted(steamIdStr) {
    if (!p2pInitialized || !steamP2P || !steamIdStr) return;
    if (acceptedP2PPeers.has(steamIdStr)) return;

    const idBuf = steamIdToBuffer8(steamIdStr);
    if (!idBuf) return;

    try {
        steamP2P.acceptP2PSession(idBuf);
        acceptedP2PPeers.add(steamIdStr);
    } catch {
        // Silently swallow errors if peer session is already in active state
    }
}

/**
 * Drains all pending packets from the specified Steamworks P2P channel.
 *
 * Channel 0: Reliable messages (World dumps, actions, hub progress).
 * Channel 1: Unreliable messages (Cursor updates).
 *
 * @param {number} channel - Steam P2P channel (0 or 1).
 */
function drainP2PChannel(channel) {
    if (!p2pInitialized || !steamP2P || typeof steamP2P.readP2PPacket !== "function") return;

    let guard = 0;
    while (guard++ < 64) {
        let pkt = null;
        try {
            pkt = steamP2P.readP2PPacket(channel);
        } catch {
            break;
        }
        if (!pkt || pkt.length <= 8) break;

        let fromId = "";
        try {
            fromId = pkt.readBigUInt64LE(0).toString();
        } catch {
            continue;
        }
        ensureP2PSessionAccepted(fromId);

        let parsed = null;
        try {
            parsed = JSON.parse(pkt.subarray(8).toString("utf8"));
        } catch {
            continue;
        }
        if (!parsed || typeof parsed !== "object") continue;

        let fromName = fromId;
        if (typeof friendNameResolver === "function") {
            try {
                fromName = friendNameResolver(fromId) || fromId;
            } catch {}
        }

        const dataObj = parsed.kind ? parsed : { kind: "STEAM_PACKET", packet: parsed };
        const innerPkt = dataObj.packet;
        const pktType = innerPkt && innerPkt.type ? innerPkt.type : "";

        const shouldLogRx =
            channel === 0 &&
            pktType !== "CURSOR" &&
            pktType !== "SYNC_HUB" &&
            (pktType !== "CHUNK_PART" || innerPkt.index === 0 || innerPkt.index === innerPkt.total - 1);

        if (shouldLogRx) {
            const chunkSuffix = pktType === "CHUNK_PART" ? ` (${innerPkt.index + 1}/${innerPkt.total})` : "";
            logInfo(
                `Received Steam P2P packet kind=${dataObj.kind}${pktType ? ":" + pktType : ""}${chunkSuffix} from=${fromName} (${fromId})`
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

/**
 * Starts the high-frequency polling loop for non-blocking Steam P2P incoming packets.
 */
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

/**
 * Stops the high-frequency polling loop.
 */
function stopP2PPollTimer() {
    if (p2pPollTimer) {
        clearInterval(p2pPollTimer);
        p2pPollTimer = null;
    }
}

/**
 * Transmits a JSON-serializable payload to a target Steam user via native ISteamNetworking P2P.
 * Automatically selects Channel 1 / k_EP2PSendUnreliable for cursors, and Channel 0 /
 * k_EP2PSendReliable for all gameplay actions and world chunks.
 *
 * @param {string} targetSteamId - 64-bit Steam ID of the recipient.
 * @param {object} dataObj - Envelope or payload object to transmit.
 * @returns {boolean} True if successfully queued to the native Steam socket, false otherwise.
 */
function sendViaSteamP2P(targetSteamId, dataObj) {
    if (!p2pInitialized || !steamP2P || typeof steamP2P.sendP2PPacket !== "function") {
        return false;
    }
    const idBuf = steamIdToBuffer8(targetSteamId);
    if (!idBuf) return false;

    ensureP2PSessionAccepted(targetSteamId);

    const pkt = dataObj && dataObj.packet;
    const pktType = pkt && pkt.type ? pkt.type : "";
    const isUnreliableCursor = dataObj && dataObj.kind === "STEAM_PACKET" && pktType === "CURSOR";
    const sendType = isUnreliableCursor ? 0 : 2; // 0 = k_EP2PSendUnreliable, 2 = k_EP2PSendReliable
    const channel = isUnreliableCursor ? 1 : 0;

    try {
        const payloadBuf = Buffer.from(JSON.stringify(dataObj), "utf8");
        const ok = Boolean(steamP2P.sendP2PPacket(idBuf, payloadBuf, sendType, channel));

        const shouldLogTx =
            channel === 0 &&
            pktType !== "SYNC_HUB" &&
            (pktType !== "CHUNK_PART" || pkt.index === 0 || pkt.index === pkt.total - 1);

        if (shouldLogTx) {
            const chunkSuffix = pktType === "CHUNK_PART" ? ` (${pkt.index + 1}/${pkt.total})` : "";
            logInfo(
                `Sent Steam P2P packet (${payloadBuf.length}B, ok=${ok}) kind=${dataObj.kind}${
                    pktType ? ":" + pktType : ""
                }${chunkSuffix} to=${targetSteamId}`
            );
        }
        return ok;
    } catch (err) {
        logWarn("sendP2PPacket failed: " + (err.message || err));
        return false;
    }
}

/**
 * Resets the set of accepted P2P peers.
 */
function resetAcceptedPeers() {
    acceptedP2PPeers.clear();
}

/**
 * Sets the P2P initialization status flag.
 * @param {boolean} val - Flag value.
 */
function setP2pInitialized(val) {
    p2pInitialized = Boolean(val);
}

/**
 * Gets the P2P initialization status flag.
 * @returns {boolean} Flag value.
 */
function getP2pInitialized() {
    return p2pInitialized;
}

module.exports = {
    loadNativeSteamP2P,
    steamIdToBuffer8,
    buffer8ToSteamId,
    ensureP2PSessionAccepted,
    drainP2PChannel,
    startP2PPollTimer,
    stopP2PPollTimer,
    sendViaSteamP2P,
    resetAcceptedPeers,
    setP2pInitialized,
    getP2pInitialized,
    setRendererSender,
    setFriendNameResolver,
    acceptedP2PPeers,
};
