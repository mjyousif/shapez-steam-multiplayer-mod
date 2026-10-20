const { test, describe } = require("node:test");
const assert = require("node:assert");

// Test the hub sync subsystem in isolation
const hubSync = require("../src/multiplayer/sync/hub_sync");
const { PREDICTION_TIMEOUT_MS } = require("../src/multiplayer/constants");

describe("Hub Goals and Upgrades Synchronization", () => {
    test("recomputeUpgradeImprovements calculates accurate speed multipliers", () => {
        const mockRoot = {
            gameMode: {
                getUpgrades: () => ({
                    belt: [
                        { improvement: 0.5 },
                        { improvement: 0.5 },
                        { improvement: 0.5 },
                        { improvement: 0.5 },
                    ],
                    miner: [
                        { improvement: 0.25 },
                        { improvement: 0.25 },
                    ],
                }),
            },
            hubGoals: {
                upgradeLevels: { belt: 3, miner: 1 },
                upgradeImprovements: {},
            },
        };

        hubSync.recomputeUpgradeImprovements(mockRoot);

        // Belt level 3 = 1.0 (base) + 0.5 + 0.5 + 0.5 = 2.5
        assert.strictEqual(mockRoot.hubGoals.upgradeImprovements.belt, 2.5);
        // Miner level 1 = 1.0 (base) + 0.25 = 1.25
        assert.strictEqual(mockRoot.hubGoals.upgradeImprovements.miner, 1.25);
    });

    test("broadcastHubSync sends deep-copied authoritative snapshot with monotonically increasing sequence", () => {
        const broadcasts = [];
        const mockMod = {
            role: "host",
            hubSeq: 0,
            ackReq: { player_2: 42 },
            broadcastFromHost: msg => broadcasts.push(msg),
        };
        const mockRoot = {
            hubGoals: {
                level: 8,
                storedShapes: { "CuCuCuCu": 1200 },
                upgradeLevels: { belt: 2, miner: 1 },
                gainedRewards: { reward_wires: 1 },
            },
        };

        hubSync.broadcastHubSync(mockMod, mockRoot);

        assert.strictEqual(broadcasts.length, 1);
        const packet = broadcasts[0];
        assert.strictEqual(packet.type, "SYNC_HUB");
        assert.strictEqual(packet.seq, 1);
        assert.strictEqual(packet.level, 8);
        assert.deepStrictEqual(packet.storedShapes, { "CuCuCuCu": 1200 });
        assert.deepStrictEqual(packet.upgradeLevels, { belt: 2, miner: 1 });
        assert.deepStrictEqual(packet.gainedRewards, { reward_wires: 1 });
        assert.deepStrictEqual(packet.ackReq, { player_2: 42 });

        // Verify deep-copy: mutating original does not mutate broadcast packet
        mockRoot.hubGoals.storedShapes["CuCuCuCu"] = 9999;
        assert.strictEqual(packet.storedShapes["CuCuCuCu"], 1200);
    });

    test("applyHubSync authoritatively sets tiers, recalculates multipliers, and drops stale sequence packets", () => {
        let purchasedSignalDispatched = null;
        let storyGoalDispatched = null;

        const mockRoot = {
            gameMode: {
                getUpgrades: () => ({
                    belt: [{ improvement: 0.5 }, { improvement: 0.5 }, { improvement: 0.5 }],
                }),
            },
            hubGoals: {
                level: 5,
                storedShapes: { "CuCuCuCu": 5000 },
                upgradeLevels: { belt: 4 }, // Client was ahead (e.g. from local save or desync)
                upgradeImprovements: { belt: 3.0 },
                computeNextGoal: () => {},
            },
            signals: {
                upgradePurchased: { dispatch: id => { purchasedSignalDispatched = id; } },
                storyGoalCompleted: { dispatch: (lvl, reward) => { storyGoalDispatched = { lvl, reward }; } },
            },
        };

        const mockMod = {
            role: "client",
            currentRoot: mockRoot,
            lastHubSeq: 10,
            assignedPlayerId: "client_1",
            getLocalPlayerInfo: () => ({ id: "client_1" }),
            pendingUpgrades: new Map(),
            isApplyingRemote: false,
        };

        // 1. Packet with older sequence must be dropped
        hubSync.applyHubSync(mockMod, {
            type: "SYNC_HUB",
            seq: 9,
            level: 3,
            storedShapes: { "CuCuCuCu": 100 },
            upgradeLevels: { belt: 2 },
        });

        assert.strictEqual(mockRoot.hubGoals.upgradeLevels.belt, 4, "Stale packet must not modify levels");
        assert.strictEqual(mockRoot.hubGoals.storedShapes["CuCuCuCu"], 5000, "Stale packet must not modify shapes");

        // 2. Newer authoritative packet overwrites levels and downward shapes
        hubSync.applyHubSync(mockMod, {
            type: "SYNC_HUB",
            seq: 11,
            level: 6,
            storedShapes: { "CuCuCuCu": 300 },
            upgradeLevels: { belt: 2 },
            gainedRewards: { reward_blueprints: 1 },
        });

        assert.strictEqual(mockMod.lastHubSeq, 11);
        assert.strictEqual(mockRoot.hubGoals.level, 6);
        assert.strictEqual(mockRoot.hubGoals.storedShapes["CuCuCuCu"], 300, "Authoritative shapes must overwrite downward");
        assert.strictEqual(mockRoot.hubGoals.upgradeLevels.belt, 2, "Authoritative levels must overwrite downward");
        assert.strictEqual(mockRoot.hubGoals.upgradeImprovements.belt, 2.0, "Multiplier must be recomputed");
        assert.strictEqual(purchasedSignalDispatched, "belt", "upgradePurchased signal must be dispatched");
        assert.strictEqual(storyGoalDispatched.lvl, 5);
    });

    test("predictUpgrade applies optimistic local tier and reconciles on host snapshot", () => {
        const sentToHost = [];
        let purchasedSignalCount = 0;

        const mockRoot = {
            gameMode: {
                getUpgrades: () => ({
                    belt: [{ improvement: 0.5 }, { improvement: 0.5 }, { improvement: 0.5 }, { improvement: 0.5 }],
                }),
            },
            hubGoals: {
                level: 3,
                upgradeLevels: { belt: 1 },
                upgradeImprovements: { belt: 1.5 },
                getUpgradeLevel: id => mockRoot.hubGoals.upgradeLevels[id] || 0,
            },
            signals: {
                upgradePurchased: { dispatch: () => { purchasedSignalCount++; } },
            },
        };

        const mockMod = {
            role: "client",
            currentRoot: mockRoot,
            nextReqId: 0,
            pendingUpgrades: new Map(),
            assignedPlayerId: "client_player_1",
            getLocalPlayerInfo: () => ({ id: "client_player_1" }),
            sendToHost: msg => sentToHost.push(msg),
        };

        // Client triggers upgrade click
        const result = hubSync.predictUpgrade(mockMod, mockRoot.hubGoals, "belt");
        assert.strictEqual(result, true);
        assert.strictEqual(mockRoot.hubGoals.upgradeLevels.belt, 2, "Local tier must immediately increment to 2");
        assert.strictEqual(mockRoot.hubGoals.upgradeImprovements.belt, 2.0, "Speed multiplier must immediately recompute");
        assert.strictEqual(purchasedSignalCount, 1, "Shop UI refresh signal must dispatch immediately");
        assert.strictEqual(sentToHost.length, 1);
        assert.strictEqual(sentToHost[0].type, "REQUEST_UPGRADE");
        assert.strictEqual(sentToHost[0].reqId, 1);
        assert.strictEqual(sentToHost[0].upgradeId, "belt");

        // An intermediate heartbeat arrives from host that was sent BEFORE host received our request (belt still level 1)
        hubSync.applyHubSync(mockMod, {
            type: "SYNC_HUB",
            seq: 1,
            level: 3,
            storedShapes: {},
            upgradeLevels: { belt: 1 },
            ackReq: {}, // Request not acknowledged yet
        });

        // Prediction preservation: client must NOT flicker back to level 1
        assert.strictEqual(mockRoot.hubGoals.upgradeLevels.belt, 2, "Unacknowledged prediction must stay applied on top of snapshot");
        assert.strictEqual(mockRoot.hubGoals.upgradeImprovements.belt, 2.0);

        // Host receives request, processes it, and broadcasts snapshot acknowledging reqId 1
        hubSync.applyHubSync(mockMod, {
            type: "SYNC_HUB",
            seq: 2,
            level: 3,
            storedShapes: {},
            upgradeLevels: { belt: 2 },
            ackReq: { client_player_1: 1 },
        });

        // Prediction should now be acknowledged and deleted from pending map
        assert.strictEqual(mockMod.pendingUpgrades.size, 0, "Pending prediction must be cleared once acknowledged");
        assert.strictEqual(mockRoot.hubGoals.upgradeLevels.belt, 2);
    });

    test("host handleUpgradeRequest rejects stale fromLevel and processes valid unlock", () => {
        const broadcasts = [];
        let unlockAttempted = null;

        const mockRoot = {
            hubGoals: {
                level: 3,
                upgradeLevels: { belt: 2 },
                getUpgradeLevel: id => mockRoot.hubGoals.upgradeLevels[id] || 0,
                tryUnlockUpgrade: id => {
                    unlockAttempted = id;
                    mockRoot.hubGoals.upgradeLevels[id] = 3;
                    return true;
                },
            },
        };

        const mockMod = {
            role: "host",
            currentRoot: mockRoot,
            peers: new Map([["peer_abc", { playerId: "client_1" }]]),
            ackReq: {},
            broadcastFromHost: msg => broadcasts.push(msg),
        };

        // 1. Stale request where client thought belt was level 1
        hubSync.handleUpgradeRequest(mockMod, "peer_abc", {
            reqId: 10,
            upgradeId: "belt",
            fromLevel: 1,
        });

        assert.strictEqual(unlockAttempted, null, "Should not unlock when fromLevel is stale");
        assert.strictEqual(mockMod.ackReq["client_1"], 10, "Should acknowledge reqId to release client prediction");
        assert.strictEqual(broadcasts.length, 1);
        assert.strictEqual(broadcasts[0].upgradeLevels.belt, 2, "Should broadcast current authoritative level");

        // 2. Valid request matching current level
        hubSync.handleUpgradeRequest(mockMod, "peer_abc", {
            reqId: 11,
            upgradeId: "belt",
            fromLevel: 2,
        });

        assert.strictEqual(unlockAttempted, "belt");
        assert.strictEqual(mockRoot.hubGoals.upgradeLevels.belt, 3);
        assert.strictEqual(mockMod.ackReq["client_1"], 11);
    });

    test("checkExpiredPredictions drops predictions that exceed timeout", () => {
        const mockRoot = {
            gameMode: {
                getUpgrades: () => ({
                    belt: [{ improvement: 0.5 }, { improvement: 0.5 }],
                }),
            },
            hubGoals: {
                upgradeLevels: { belt: 1 },
                upgradeImprovements: { belt: 1.5 },
            },
        };

        const mockMod = {
            currentRoot: mockRoot,
            pendingUpgrades: new Map([
                [1, { reqId: 1, upgradeId: "belt", targetLevel: 2, sentAt: 1000 }],
            ]),
        };

        // Now is 1000 + PREDICTION_TIMEOUT_MS + 100
        hubSync.checkExpiredPredictions(mockMod, 1000 + PREDICTION_TIMEOUT_MS + 100);

        assert.strictEqual(mockMod.pendingUpgrades.size, 0, "Expired prediction should be removed");
    });

    test("Mutation Twin: detects un-reconciled upgrade discrepancy and verifies host authority overwrites mutated client state", () => {
        const mockRoot = {
            gameMode: {
                getUpgrades: () => ({
                    belt: [
                        { improvement: 0.5 },
                        { improvement: 0.5 },
                        { improvement: 0.5 },
                        { improvement: 0.5 },
                    ],
                }),
            },
            hubGoals: {
                level: 3,
                storedShapes: { "CuCuCuCu": 100 },
                upgradeLevels: { belt: 4 }, // Mutated/hacked client level
                upgradeImprovements: { belt: 3.0 }, // Mutated speed multiplier
                computeNextGoal: () => {},
            },
            signals: {
                upgradePurchased: { dispatch: () => {} },
                storyGoalCompleted: { dispatch: () => {} },
            },
        };

        const mockMod = {
            role: "client",
            currentRoot: mockRoot,
            lastHubSeq: 10,
            assignedPlayerId: "client_hack",
            pendingUpgrades: new Map(),
            logInfo: () => {},
            logWarn: () => {},
        };

        // 1. Baseline Mutation Verification: Client has hacked level 4 (multiplier 3.0)
        assert.strictEqual(mockRoot.hubGoals.upgradeLevels.belt, 4);
        assert.strictEqual(mockRoot.hubGoals.upgradeImprovements.belt, 3.0);

        // 2. Mutation Twin Branch A (Drop Stale or Forged Packets):
        const stalePacket = {
            type: "SYNC_HUB",
            seq: 9, // Older than lastHubSeq (10)
            level: 1,
            storedShapes: {},
            upgradeLevels: { belt: 1 },
            gainedRewards: {},
            ackReq: {},
        };
        hubSync.applyHubSync(mockMod, stalePacket);
        assert.strictEqual(mockRoot.hubGoals.upgradeLevels.belt, 4, "Stale packet must not alter client state");

        // 3. Mutation Twin Branch B (Host Authoritative Overwrite):
        const hostPacket = {
            type: "SYNC_HUB",
            seq: 11,
            level: 3,
            storedShapes: { "CuCuCuCu": 500 },
            upgradeLevels: { belt: 2 }, // Host authoritative level is 2
            gainedRewards: {},
            ackReq: {},
        };
        hubSync.applyHubSync(mockMod, hostPacket);

        // Verify that client's mutated level is authoritatively forced back down to Host's level 2
        assert.strictEqual(mockRoot.hubGoals.upgradeLevels.belt, 2, "Host authority must roll back mutated upgrade level");
        // Verify that speed multiplier is automatically recomputed down to 2.0 (1.0 + 0.5 + 0.5)
        assert.strictEqual(mockRoot.hubGoals.upgradeImprovements.belt, 2.0, "Multiplier must be recomputed authoritatively");
        assert.strictEqual(mockMod.lastHubSeq, 11);
    });
});
