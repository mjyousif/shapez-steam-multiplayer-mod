/**
 * @file src/multiplayer/sync/world_dump.js
 * @description World state snapshot serialization, chunked network transfer, and savegame isolation.
 * 
 * Provides:
 * 1. Full factory state serialization using shapez's `SavegameSerializer`.
 * 2. 48 KB chunk splitting (`CHUNK_PART`) to prevent network frame choking over P2P/TCP streams.
 * 3. Bidirectional chunk reassembly and progress tracking.
 * 4. Savegame Isolation Guarantee:
 *    - Never overwrites or mutates singleplayer saves (`currentRoot.savegame`).
 *    - Explicitly allocates an isolated savegame slot (`activeCoopSavegame`) via `app.savegameMgr.createNewSavegame()`.
 *    - Resyncs safely reuse the established co-op slot.
 * 5. State transition orchestration into `InGameState`.
 */

const { PLAYER_COLORS } = require("../constants");

/**
 * Maximum byte size of individual chunk slices during large message transmission (48 Kilobytes).
 * @type {number}
 */
const CHUNK_SIZE_BYTES = 48000;

/**
 * Serializes the complete factory world state into a structured JSON dump object.
 *
 * @param {any} root - Active `shapez.GameRoot` instance.
 * @returns {object} Serialized world dump containing buildings, belts, hub goals, and wires.
 */
function serializeWorldDump(root) {
    if (!root || typeof shapez === "undefined" || !shapez.SavegameSerializer) {
        throw new Error("Cannot serialize world dump without active game root and shapez engine");
    }
    const serializer = new shapez.SavegameSerializer();
    return serializer.generateDumpFromGameRoot(root, false);
}

/**
 * Transmits a large message payload from the Host to a target peer broken into numbered chunks.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} peer - Target peer object.
 * @param {any} message - Message payload to transmit.
 */
function sendChunkedToPeer(mod, peer, message) {
    const serialized = JSON.stringify(message);
    if (serialized.length <= CHUNK_SIZE_BYTES) {
        mod.sendRawToPeer(peer, message);
        return;
    }

    const transferId = "tx_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
    const total = Math.ceil(serialized.length / CHUNK_SIZE_BYTES);

    for (let i = 0; i < total; i++) {
        const slice = serialized.slice(i * CHUNK_SIZE_BYTES, (i + 1) * CHUNK_SIZE_BYTES);
        mod.sendRawToPeer(peer, {
            type: "CHUNK_PART",
            transferId,
            index: i,
            total,
            data: slice,
        });
    }
}

/**
 * Transmits a large message payload from a Client to the Host broken into numbered chunks.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} message - Message payload to transmit.
 */
function sendChunkedToHost(mod, message) {
    const serialized = JSON.stringify(message);
    if (serialized.length <= CHUNK_SIZE_BYTES) {
        mod.sendRawToHost(message);
        return;
    }

    const transferId = "tx_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
    const total = Math.ceil(serialized.length / CHUNK_SIZE_BYTES);

    for (let i = 0; i < total; i++) {
        const slice = serialized.slice(i * CHUNK_SIZE_BYTES, (i + 1) * CHUNK_SIZE_BYTES);
        mod.sendRawToHost({
            type: "CHUNK_PART",
            transferId,
            index: i,
            total,
            data: slice,
        });
    }
}

/**
 * Processes an incoming `CHUNK_PART` packet, updating reassembly progress and triggering
 * completion once all chunks have arrived.
 *
 * @param {any} mod - Active Mod instance.
 * @param {{ transferId: string, index: number, total: number, data: string }} msg - Chunk part packet.
 * @param {(fullMsg: any) => void} onComplete - Callback executed upon complete message reconstruction.
 */
function handleChunkPart(mod, msg, onComplete) {
    let entry = mod.clientChunkBuffer.get(msg.transferId);
    if (!entry) {
        entry = {
            chunks: new Array(msg.total),
            received: 0,
            total: msg.total,
        };
        mod.clientChunkBuffer.set(msg.transferId, entry);
    }

    if (entry.chunks[msg.index] === undefined) {
        entry.chunks[msg.index] = msg.data;
        entry.received++;
    }

    const pct = Math.round((entry.received / entry.total) * 100);
    mod.updateJoinProgressModal(
        `Downloading factory snapshot: ${pct}% (${entry.received}/${entry.total} chunks)...`,
        pct
    );

    if (entry.received >= entry.total) {
        mod.updateJoinProgressModal("Factory snapshot received! Reconstructing world...", 100);
        mod.clientChunkBuffer.delete(msg.transferId);
        try {
            const fullJson = entry.chunks.join("");
            const fullMsg = JSON.parse(fullJson);
            onComplete(fullMsg);
        } catch (err) {
            console.error("[Steam MP] Failed to reassemble chunked message:", err);
        }
    }
}

/**
 * Serializes the host's current world state and transmits the initial `WELCOME_WORLD` snapshot.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} peer - Peer receiving the snapshot.
 */
function sendWorldWelcomeToPeer(mod, peer) {
    if (!mod.currentRoot) {
        mod.pendingWelcomes = mod.pendingWelcomes || [];
        mod.pendingWelcomes.push(peer);
        return;
    }

    try {
        const dump = serializeWorldDump(mod.currentRoot);
        const local = mod.getLocalPlayerInfo();

        sendChunkedToPeer(mod, peer, {
            type: "WELCOME_WORLD",
            hostId: local.id,
            hostName: local.name,
            assignedPlayerId: peer.playerId,
            assignedPlayerName: peer.name,
            assignedColor: peer.color,
            mode: mod.mode,
            roster: mod.buildRosterPayload(),
            actionSeq: mod.actionSeq || 0,
            hubSeq: mod.hubSeq || 0,
            dump,
        });
    } catch (err) {
        console.error("[Steam MP] Failed to serialize world dump for peer:", err);
    }
}

/**
 * Hydrates the client game state with the received host world snapshot while strictly
 * preserving client savegame isolation.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} worldDump - Serialized world dump from host.
 * @param {string} hostName - Host player name.
 */
async function loadHostWorldDump(mod, worldDump, hostName) {
    if (!worldDump) return;

    mod.closeMultiplayerModal();
    mod.updateJoinProgressModal("Loading factory world & warming up simulation...", 100);

    // Timeout safety guard to close join modal if loading state stalls
    setTimeout(() => {
        mod.closeJoinProgressModal();
        mod.isConnecting = false;
        mod.isReloadingWorld = false;
    }, 12000);

    // Architectural Invariant: Never overwrite client singleplayer saves
    let savegame = mod.activeCoopSavegame;
    if (!savegame) {
        savegame = mod.app.savegameMgr.createNewSavegame();
        mod.activeCoopSavegame = savegame;
    }

    savegame.currentData = {
        version: savegame.getCurrentVersion(),
        dump: worldDump,
        stats: { failedMam: false, trashedCount: 0, usedInverseRotater: false },
        lastUpdate: Date.now(),
        mods: typeof shapez !== "undefined" && shapez.MODS ? shapez.MODS.getModsListForSavegame() : [],
    };

    const safeHost = String(hostName || "Host")
        .replace(/[^a-zA-Z0-9_\- ]/g, "")
        .slice(0, 12);

    savegame.metaDataRef.name = "Co-op (" + safeHost + ")";
    savegame.metaDataRef.level = (worldDump.hubGoals && worldDump.hubGoals.level) || 1;

    try {
        await savegame.writeSavegameAndMetadata();
    } catch (e) {
        console.warn("[Steam MP] Failed to write initial co-op savegame:", e);
    }

    // Reset client-side progression sync counters to align with new dump
    mod.lastHubSeq = 0;
    if (mod.pendingUpgrades) {
        mod.pendingUpgrades.clear();
    }

    const enterInGame = () => {
        mod.app.stateMgr.moveToState("InGameState", {
            savegame,
            fastEnter: true,
        });
    };

    const activeState = mod.app.stateMgr && mod.app.stateMgr.currentState;
    if (activeState && activeState.key === "InGameState") {
        // StateManager rejects moveToState("InGameState") if already active.
        // Cycle cleanly through MainMenuState under isReloadingWorld guard to bypass termination.
        mod.isReloadingWorld = true;
        mod.pendingWorldEntry = enterInGame;
        mod.app.stateMgr.moveToState("MainMenuState");
    } else {
        enterInGame();
    }
}

module.exports = {
    CHUNK_SIZE_BYTES,
    serializeWorldDump,
    sendChunkedToPeer,
    sendChunkedToHost,
    handleChunkPart,
    sendWorldWelcomeToPeer,
    loadHostWorldDump,
};
