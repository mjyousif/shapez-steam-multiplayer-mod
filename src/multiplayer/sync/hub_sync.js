/**
 * @file src/multiplayer/sync/hub_sync.js
 * @description Synchronization engine for Hub Goals, milestone levels, delivered shapes, and upgrades.
 * 
 * Synchronizes:
 * - Stored shape delivery progress for the current level goal.
 * - Global factory research upgrade tiers (`upgradeLevels`) and recomputes `upgradeImprovements`.
 * - Gained shapez rewards and game unlocks (`gainedRewards`).
 * - Main level advancement (`level`, `computeNextGoal`, `storyGoalCompleted`).
 * - Client-side optimistic upgrade prediction with server reconciliation.
 * 
 * Reentrancy Invariant:
 * - All local mutations in `applyHubSync` are enclosed in `isApplyingRemote = true` try-finally
 *   blocks to prevent dispatching circular signals back to the host.
 */

const { PREDICTION_TIMEOUT_MS } = require("../constants");

/**
 * Recomputes the speed improvement multipliers on `hubGoals.upgradeImprovements`
 * from the current `upgradeLevels` matching shapez.io's internal `HubGoals.deserialize` logic.
 *
 * @param {any} root - Active GameRoot instance.
 */
function recomputeUpgradeImprovements(root) {
    if (!root || !root.gameMode || !root.hubGoals) return;
    const hg = root.hubGoals;
    if (typeof root.gameMode.getUpgrades !== "function") return;
    const upgrades = root.gameMode.getUpgrades();
    if (!upgrades) return;

    hg.upgradeImprovements = hg.upgradeImprovements || {};
    for (const [id, tiers] of Object.entries(upgrades)) {
        const lv = (hg.upgradeLevels && hg.upgradeLevels[id]) || 0;
        let mult = 1;
        if (Array.isArray(tiers)) {
            for (let i = 0; i < lv && i < tiers.length; ++i) {
                if (tiers[i] && typeof tiers[i].improvement === "number") {
                    mult += tiers[i].improvement;
                }
            }
        }
        hg.upgradeImprovements[id] = mult;
    }
}

/**
 * Broadcasts the current Hub status from the host to all connected clients.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} root - Active GameRoot instance.
 */
function broadcastHubSync(mod, root) {
    if (mod.role !== "host" || !root || !root.hubGoals) return;
    mod.hubSeq = (mod.hubSeq || 0) + 1;
    const hg = root.hubGoals;

    mod.broadcastFromHost({
        type: "SYNC_HUB",
        seq: mod.hubSeq,
        level: hg.level,
        storedShapes: Object.assign({}, hg.storedShapes || {}),
        upgradeLevels: Object.assign({}, hg.upgradeLevels || {}),
        gainedRewards: Object.assign({}, hg.gainedRewards || {}),
        ackReq: Object.assign({}, mod.ackReq || {}),
    });
}

/**
 * Performs client-side optimistic prediction when the player clicks an upgrade.
 * Immediately applies local tier increment, recomputes multipliers, and dispatches UI signals,
 * then sends REQUEST_UPGRADE to host for authoritative verification.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} hg - Active HubGoals instance.
 * @param {string} upgradeId - Upgrade category ID (e.g. 'belt', 'miner').
 * @returns {boolean} Whether prediction was applied.
 */
function predictUpgrade(mod, hg, upgradeId) {
    if (!mod.currentRoot) return false;
    mod.nextReqId = (mod.nextReqId || 0) + 1;
    const reqId = mod.nextReqId;
    const currentLv = typeof hg.getUpgradeLevel === "function" ? hg.getUpgradeLevel(upgradeId) : (hg.upgradeLevels[upgradeId] || 0);
    const targetLevel = currentLv + 1;

    mod.pendingUpgrades = mod.pendingUpgrades || new Map();
    mod.pendingUpgrades.set(reqId, {
        reqId,
        upgradeId,
        targetLevel,
        sentAt: Date.now(),
    });

    hg.upgradeLevels = hg.upgradeLevels || {};
    hg.upgradeLevels[upgradeId] = targetLevel;
    recomputeUpgradeImprovements(mod.currentRoot);

    if (mod.currentRoot.signals && mod.currentRoot.signals.upgradePurchased) {
        mod.currentRoot.signals.upgradePurchased.dispatch(upgradeId);
    }

    mod.sendToHost({
        type: "REQUEST_UPGRADE",
        reqId,
        upgradeId,
        fromLevel: currentLv,
    });

    return true;
}

/**
 * Host handler for client REQUEST_UPGRADE packets.
 * Validates prerequisite level and shape requirements before unlocking and broadcasting.
 *
 * @param {any} mod - Active Mod instance.
 * @param {string} peerId - Sender peer ID.
 * @param {{ reqId: number, upgradeId: string, fromLevel?: number }} msg - Request packet.
 */
function handleUpgradeRequest(mod, peerId, msg) {
    const root = mod.currentRoot;
    if (!root || !root.hubGoals || !msg.upgradeId) return;
    const hg = root.hubGoals;

    const peer = mod.peers && mod.peers.get(peerId);
    const playerId = (peer && peer.playerId) || peerId;

    mod.ackReq = mod.ackReq || {};
    mod.ackReq[playerId] = msg.reqId;

    const currentHostLevel = typeof hg.getUpgradeLevel === "function"
        ? hg.getUpgradeLevel(msg.upgradeId)
        : (hg.upgradeLevels && hg.upgradeLevels[msg.upgradeId]) || 0;

    if (typeof msg.fromLevel === "number" && msg.fromLevel !== currentHostLevel) {
        // Stale request or desynced level reference; respond with authoritative truth
        broadcastHubSync(mod, root);
        return;
    }

    if (typeof hg.tryUnlockUpgrade === "function") {
        hg.tryUnlockUpgrade(msg.upgradeId);
        // Note: successful unlock dispatches upgradePurchased signal which already calls broadcastHubSync
    }
    broadcastHubSync(mod, root);
}

/**
 * Reconciles the client's local Hub state with the host's authoritative Hub state.
 *
 * @param {any} mod - Active Mod instance.
 * @param {{
 *   seq?: number,
 *   level?: number,
 *   storedShapes?: Record<string, number>,
 *   upgradeLevels?: Record<string, number>,
 *   gainedRewards?: Record<string, any>,
 *   ackReq?: Record<string, number>
 * }} msg - Hub sync packet.
 */
function applyHubSync(mod, msg) {
    if (!mod.currentRoot || !mod.currentRoot.hubGoals || mod.role !== "client") return;
    if (typeof msg.seq === "number") {
        if (msg.seq <= (mod.lastHubSeq || 0)) {
            // Drop stale packet
            return;
        }
        mod.lastHubSeq = msg.seq;
    }

    const root = mod.currentRoot;
    const hg = root.hubGoals;

    mod.isApplyingRemote = true;
    try {
        // Reconcile pending optimistic predictions
        const myId = mod.assignedPlayerId || mod.getLocalPlayerInfo().id;
        if (msg.ackReq && typeof msg.ackReq[myId] === "number" && mod.pendingUpgrades) {
            const ackedReqId = msg.ackReq[myId];
            for (const [rId] of Array.from(mod.pendingUpgrades.entries())) {
                if (rId <= ackedReqId) {
                    mod.pendingUpgrades.delete(rId);
                }
            }
        }

        // Authoritative overwrite of stored delivery items and rewards
        hg.storedShapes = Object.assign({}, msg.storedShapes || {});
        hg.gainedRewards = Object.assign({}, msg.gainedRewards || {});

        const oldUpgradeLevels = Object.assign({}, hg.upgradeLevels || {});
        const baseUpgradeLevels = Object.assign({}, msg.upgradeLevels || {});

        // Re-apply any remaining unacknowledged predictions that have not expired
        const now = Date.now();
        if (mod.pendingUpgrades) {
            for (const [rId, pred] of Array.from(mod.pendingUpgrades.entries())) {
                if (now - pred.sentAt > PREDICTION_TIMEOUT_MS) {
                    mod.pendingUpgrades.delete(rId);
                } else {
                    const baseLv = baseUpgradeLevels[pred.upgradeId] || 0;
                    baseUpgradeLevels[pred.upgradeId] = Math.max(baseLv, pred.targetLevel);
                }
            }
        }

        hg.upgradeLevels = baseUpgradeLevels;
        recomputeUpgradeImprovements(root);

        // Notify UI of any upgrade tier modifications
        const allKeys = new Set([...Object.keys(oldUpgradeLevels), ...Object.keys(baseUpgradeLevels)]);
        for (const k of allKeys) {
            if ((oldUpgradeLevels[k] || 0) !== (baseUpgradeLevels[k] || 0)) {
                if (root.signals && root.signals.upgradePurchased) {
                    root.signals.upgradePurchased.dispatch(k);
                }
            }
        }

        // Authoritative level progression
        if (typeof msg.level === "number" && msg.level !== hg.level) {
            const prevLevel = hg.level;
            const prevReward = hg.currentGoal?.reward;
            hg.level = msg.level;
            if (typeof hg.computeNextGoal === "function") {
                hg.computeNextGoal();
            }
            if (msg.level > prevLevel && root.signals && root.signals.storyGoalCompleted) {
                root.signals.storyGoalCompleted.dispatch(
                    prevLevel,
                    prevReward || (typeof shapez !== "undefined" && shapez.enumHubGoalRewards ? shapez.enumHubGoalRewards.no_reward : null)
                );
            }
        }
    } finally {
        mod.isApplyingRemote = false;
    }
}

/**
 * Periodic tick helper to expire stale predictions on client.
 *
 * @param {any} mod - Active Mod instance.
 * @param {number} now - Current timestamp.
 */
function checkExpiredPredictions(mod, now) {
    if (!mod.pendingUpgrades || mod.pendingUpgrades.size === 0) return;
    let expiredAny = false;
    for (const [rId, pred] of Array.from(mod.pendingUpgrades.entries())) {
        if (now - pred.sentAt > PREDICTION_TIMEOUT_MS) {
            mod.pendingUpgrades.delete(rId);
            expiredAny = true;
        }
    }
    if (expiredAny && mod.currentRoot && mod.currentRoot.hubGoals) {
        recomputeUpgradeImprovements(mod.currentRoot);
    }
}

module.exports = {
    recomputeUpgradeImprovements,
    broadcastHubSync,
    predictUpgrade,
    handleUpgradeRequest,
    applyHubSync,
    checkExpiredPredictions,
};
