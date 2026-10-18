/**
 * @file src/bridge/lobby_channel.js
 * @description Steamworks Matchmaking Lobby metadata-based fallback signaling channel.
 * 
 * Provides an alternate, reliable, zero-chat-spam signaling transport when native Steam P2P
 * is disabled or during mock automated testing. Encodes sliding-window sequences into compressed
 * Base64 strings placed directly into Steam Lobby key-value metadata slots (`mp_h2c_<id>`,
 * `mp_c2h_<id>`, `ack_<id>`).
 * 
 * Invariants:
 * - Employs raw zlib deflate with "Z:" prefix to stay well below Steam's ~3 KB per-key lobby metadata limit.
 * - Sequence-numbered packet delivery with cumulative acknowledgments guarantees at-most-once ordered processing.
 * - Zero Steam chat spam: NEVER calls or utilizes Steam Friends chat messages for signaling.
 */

const zlib = require("zlib");
const { logInfo } = require("./logger");
const { ensureP2PSessionAccepted } = require("./native_p2p");

/**
 * Active polling timer interval for lobby metadata checks.
 * @type {NodeJS.Timeout | null}
 */
let lobbyPollTimer = null;

/**
 * Monotonically increasing transmission sequence counter.
 * @type {number}
 */
let txSeqCounter = 0;

/**
 * Outgoing message queues per target Steam ID.
 * targetSteamId -> Array<{ seq: number, ts: number, data: any }>
 * @type {Map<string, Array<{ seq: number, ts: number, data: any }>>}
 */
const txQueues = new Map();

/**
 * Highest received sequence number processed per sender.
 * fromSteamId -> number
 * @type {Map<string, number>}
 */
const rxLastSeq = new Map();

/**
 * Highest acknowledged sequence number confirmed by peer.
 * peerSteamId -> number
 * @type {Map<string, number>}
 */
const peerAckSeq = new Map();

/**
 * Cache of known lobby members to prevent duplicate join notifications.
 * @type {Set<string>}
 */
const knownLobbyMembers = new Set();

/**
 * External context accessor provided by the bridge.
 * @type {{
 *   getGreenworks: () => any,
 *   getCurrentLobbyId: () => string | null,
 *   getCurrentLobbyHostId: () => string | null,
 *   setCurrentLobbyHostId: (id: string) => void,
 *   getLobbyRole: () => "none" | "host" | "client",
 *   getLocalSteamProfile: () => { steamId: string, name: string },
 *   normalizeSteamId: (val: any) => string,
 *   isRealSteamLobbyId: (id: any) => boolean,
 *   getLobbyOwnerSteamId: (id: string) => string,
 *   sendToRenderer: (channel: string, payload: any) => void
 * } | null}
 */
let context = null;

/**
 * Configures the bridge context delegates.
 * @param {typeof context} ctx - Context object.
 */
function setLobbyChannelContext(ctx) {
    context = ctx;
}

/**
 * Encodes and compresses a sliding window message object into a compact string representation.
 * Uses raw zlib deflate and Base64 encoding prefixed with "Z:".
 *
 * @param {object} windowObj - Sliding window packet container.
 * @returns {string} Compressed Base64 string prefixed with "Z:" or empty string on failure.
 */
function encodeLobbyWindow(windowObj) {
    try {
        const json = JSON.stringify(windowObj);
        const compressed = zlib.deflateRawSync(Buffer.from(json, "utf8")).toString("base64");
        return "Z:" + compressed;
    } catch {
        return "";
    }
}

/**
 * Decodes and inflates a raw lobby metadata string into a structured window object.
 *
 * @param {string} rawStr - Raw string value from lobby metadata.
 * @returns {object | null} Deserialized object, or null on parse error.
 */
function decodeLobbyWindow(rawStr) {
    if (!rawStr || typeof rawStr !== "string") return null;
    try {
        if (rawStr.startsWith("Z:")) {
            const json = zlib.inflateRawSync(Buffer.from(rawStr.slice(2), "base64")).toString("utf8");
            return JSON.parse(json);
        }
        return JSON.parse(rawStr);
    } catch {
        return null;
    }
}

/**
 * Clears all sliding-window queues, acknowledgments, and timers for the lobby metadata channel.
 */
function resetLobbyChannelState() {
    if (lobbyPollTimer) {
        clearInterval(lobbyPollTimer);
        lobbyPollTimer = null;
    }
    txQueues.clear();
    rxLastSeq.clear();
    peerAckSeq.clear();
    knownLobbyMembers.clear();
}

/**
 * Constructs an encoded sliding window payload for transmission to a target Steam user.
 * Discards packets already acknowledged or expired past the 25-second TTL.
 *
 * @param {string} targetSteamId - Recipient 64-bit Steam ID.
 * @param {string} fromSteamId - Sender 64-bit Steam ID.
 * @returns {string} Encoded string conforming to Steam lobby data size limits.
 */
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

        // Steam Lobby Data limit is ~3072 bytes; enforce conservative 2800 char guard
        if (candidate.length > 2800 && activeItems.length > 1) {
            activeItems.pop();
            break;
        }
        encoded = candidate;
    }

    return encoded;
}

/**
 * Flushes pending outgoing transmission queues into Steam Lobby metadata fields.
 *
 * @returns {boolean} True if any data was written, false otherwise.
 */
function flushLobbyChannel() {
    if (!context) return false;
    const greenworks = context.getGreenworks();
    const currentLobbyId = context.getCurrentLobbyId();
    const lobbyRole = context.getLobbyRole();

    if (!greenworks || typeof greenworks.setLobbyData !== "function" || !context.isRealSteamLobbyId(currentLobbyId)) {
        return false;
    }
    const localId = context.getLocalSteamProfile().steamId;

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
                } catch {}
            }
        }
        return wroteAny;
    }

    if (lobbyRole === "client") {
        const targetHost = context.getCurrentLobbyHostId() || "host";
        const encoded = buildEncodedWindowForTarget(targetHost, localId);
        const ackStr = String(rxLastSeq.get(targetHost) || 0);
        try {
            if (encoded) {
                greenworks.setLobbyData(currentLobbyId, "mp_c2h_" + localId, encoded);
            }
            greenworks.setLobbyData(currentLobbyId, "ack_" + localId, ackStr);
            return true;
        } catch {}
    }

    return false;
}

/**
 * Ingests and processes an incoming encoded sliding-window message from lobby metadata.
 *
 * @param {string} expectedFromSteamId - Expected sender 64-bit Steam ID.
 * @param {string} rawStr - Raw metadata string.
 */
function processIncomingEncodedWindow(expectedFromSteamId, rawStr) {
    if (!rawStr || !context) return;
    const decoded = decodeLobbyWindow(rawStr);
    if (!decoded || typeof decoded !== "object") return;

    const fromId = context.normalizeSteamId(decoded.from || expectedFromSteamId);
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
        const greenworks = context.getGreenworks();
        try {
            if (greenworks && typeof greenworks.getFriendPersonaName === "function") {
                fromName = greenworks.getFriendPersonaName(fromId) || fromId;
            }
        } catch {}

        logInfo(`Received lobby signal seq=${item.seq} kind=${item.data && item.data.kind} from=${fromName} (${fromId})`);
        context.sendToRenderer("steam:mp:event", {
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

/**
 * Periodic polling tick inspecting lobby members and reading metadata changes.
 */
function pollLobbyChannel() {
    if (!context) return;
    const greenworks = context.getGreenworks();
    const currentLobbyId = context.getCurrentLobbyId();
    const lobbyRole = context.getLobbyRole();

    if (!greenworks || !context.isRealSteamLobbyId(currentLobbyId)) return;
    const localId = context.getLocalSteamProfile().steamId;

    if (lobbyRole === "host") {
        let memberCount = 0;
        try {
            if (typeof greenworks.getNumLobbyMembers === "function") {
                memberCount = Number(greenworks.getNumLobbyMembers(currentLobbyId)) || 0;
            }
        } catch {}

        const currentMembers = new Set();
        for (let i = 0; i < memberCount; i++) {
            try {
                const mObj = greenworks.getLobbyMemberByIndex(currentLobbyId, i);
                const mId = context.normalizeSteamId(mObj);
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
                        } catch {}
                        logInfo(`Lobby member joined host lobby ${currentLobbyId}: ${mName} (${mId})`);
                        context.sendToRenderer("steam:mp:event", {
                            type: "lobby-member-joined",
                            lobbyId: currentLobbyId,
                            memberId: mId,
                            memberName: mName,
                        });
                    }
                }
            } catch {}
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
            } catch {}
        }

        flushLobbyChannel();
    } else if (lobbyRole === "client") {
        let currentLobbyHostId = context.getCurrentLobbyHostId();
        if (!currentLobbyHostId) {
            try {
                const hId =
                    greenworks.getLobbyData(currentLobbyId, "host_id") || context.getLobbyOwnerSteamId(currentLobbyId);
                if (hId && hId !== localId) {
                    currentLobbyHostId = hId;
                    context.setCurrentLobbyHostId(hId);
                    ensureP2PSessionAccepted(hId);
                }
            } catch {}
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
        } catch {}

        flushLobbyChannel();
    }
}

/**
 * Starts the periodic 250ms polling timer for lobby metadata updates.
 */
function startLobbyPollTimer() {
    if (lobbyPollTimer) {
        clearInterval(lobbyPollTimer);
    }
    lobbyPollTimer = setInterval(() => {
        try {
            pollLobbyChannel();
        } catch {}
    }, 250);

    if (typeof lobbyPollTimer.unref === "function") {
        lobbyPollTimer.unref();
    }
}

/**
 * Enqueues a message for transmission via the lobby metadata channel.
 *
 * @param {string} targetKey - Target Steam ID or role identifier.
 * @param {any} data - Message payload.
 * @returns {{ seq: number, flushed: boolean }} Sequence and flush status.
 */
function enqueueLobbySignal(targetKey, data) {
    if (!txQueues.has(targetKey)) {
        txQueues.set(targetKey, []);
    }
    const seq = ++txSeqCounter;
    txQueues.get(targetKey).push({
        seq,
        ts: Date.now(),
        data,
    });

    logInfo(`Queued lobby signal seq=${seq} kind=${data && data.kind} to=${targetKey}`);
    const flushed = flushLobbyChannel();
    return { seq, flushed };
}

module.exports = {
    encodeLobbyWindow,
    decodeLobbyWindow,
    resetLobbyChannelState,
    startLobbyPollTimer,
    pollLobbyChannel,
    flushLobbyChannel,
    processIncomingEncodedWindow,
    buildEncodedWindowForTarget,
    enqueueLobbySignal,
    setLobbyChannelContext,
    txQueues,
    rxLastSeq,
    peerAckSeq,
    knownLobbyMembers,
};
