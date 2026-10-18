/**
 * @file src/multiplayer/sync/hub_sync.js
 * @description Synchronization engine for Hub Goals, milestone levels, delivered shapes, and upgrades.
 * 
 * Synchronizes:
 * - Stored shape delivery progress for the current level goal.
 * - Global factory research upgrade tiers (`upgradeLevels`).
 * - Gained shapez rewards and game unlocks (`gainedRewards`).
 * - Main level advancement (`level`, `computeNextGoal`, `storyGoalCompleted`).
 * 
 * Reentrancy Invariant:
 * - All local mutations in `applyHubSync` are enclosed in `isApplyingRemote = true` try-finally
 *   blocks to prevent dispatching circular signals back to the host.
 */

/**
 * Broadcasts the current Hub status from the host to all connected clients.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} root - Active GameRoot instance.
 */
function broadcastHubSync(mod, root) {
    if (mod.role !== "host" || !root || !root.hubGoals) return;
    mod.broadcastFromHost({
        type: "SYNC_HUB",
        level: root.hubGoals.level,
        storedShapes: root.hubGoals.storedShapes,
        upgradeLevels: root.hubGoals.upgradeLevels,
        gainedRewards: root.hubGoals.gainedRewards,
    });
}

/**
 * Reconciles the client's local Hub state with the host's authoritative Hub state.
 *
 * @param {any} mod - Active Mod instance.
 * @param {{
 *   level?: number,
 *   storedShapes?: Record<string, number>,
 *   upgradeLevels?: Record<string, number>,
 *   gainedRewards?: Record<string, any>
 * }} msg - Hub sync packet.
 */
function applyHubSync(mod, msg) {
    if (!mod.currentRoot || !mod.currentRoot.hubGoals) return;
    const hg = mod.currentRoot.hubGoals;

    mod.isApplyingRemote = true;
    try {
        if (msg.storedShapes && typeof msg.storedShapes === "object") {
            for (const [k, v] of Object.entries(msg.storedShapes)) {
                hg.storedShapes[k] = Math.max(hg.storedShapes[k] || 0, v);
            }
        }

        if (msg.gainedRewards && typeof msg.gainedRewards === "object") {
            Object.assign(hg.gainedRewards, msg.gainedRewards);
        }

        if (msg.upgradeLevels && typeof msg.upgradeLevels === "object") {
            for (const [upId, lv] of Object.entries(msg.upgradeLevels)) {
                if ((hg.upgradeLevels[upId] || 0) < lv) {
                    hg.upgradeLevels[upId] = lv;
                    mod.currentRoot.signals.upgradePurchased.dispatch(upId);
                }
            }
        }

        if (typeof msg.level === "number" && msg.level > hg.level) {
            const prevLevel = hg.level;
            const prevReward = hg.currentGoal?.reward;
            hg.level = msg.level;
            hg.computeNextGoal();
            mod.currentRoot.signals.storyGoalCompleted.dispatch(
                prevLevel,
                prevReward || (typeof shapez !== "undefined" && shapez.enumHubGoalRewards ? shapez.enumHubGoalRewards.no_reward : null)
            );
        }
    } finally {
        mod.isApplyingRemote = false;
    }
}

module.exports = {
    broadcastHubSync,
    applyHubSync,
};
