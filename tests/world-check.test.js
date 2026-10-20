const { test, describe } = require("node:test");
const assert = require("node:assert");

const worldCheck = require("../src/multiplayer/sync/world_check");
const { REGION_SIZE } = require("../src/multiplayer/constants");

describe("World Checksum and Region Self-Healing Repair", () => {
    test("fnv1a produces deterministic 32-bit hex hashes", () => {
        const h1 = worldCheck.fnv1a("belt:10,20:miner:0:0:default:");
        const h2 = worldCheck.fnv1a("belt:10,20:miner:0:0:default:");
        const h3 = worldCheck.fnv1a("belt:10,21:miner:0:0:default:");

        assert.strictEqual(h1, h2);
        assert.notStrictEqual(h1, h3);
        assert.strictEqual(h1.length, 8);
    });

    test("computeRegionHashes and computeRootHash are deterministic and detect variations", () => {
        function makeEntity(x, y, layer = "regular", code = "belt", rot = 0, signal = null, lever = null) {
            return {
                layer,
                components: {
                    StaticMapEntity: {
                        origin: { x, y },
                        code,
                        rotation: rot,
                        rotationVariant: 0,
                        variant: "default",
                        getBuilding: () => ({ getId: () => code }),
                    },
                    ConstantSignal: signal ? { signal: { getAsCopyableKey: () => signal } } : null,
                    Lever: lever !== null ? { toggled: lever } : null,
                },
            };
        }

        const rootA = {
            entityMgr: {
                entities: [
                    makeEntity(0, 0, "regular", "belt", 0),
                    makeEntity(5, 5, "regular", "miner", 1),
                    makeEntity(100, 100, "wires", "constant_signal", 0, "color_red"),
                ],
            },
        };

        const rootB = {
            entityMgr: {
                // Different order, same entities
                entities: [
                    makeEntity(100, 100, "wires", "constant_signal", 0, "color_red"),
                    makeEntity(5, 5, "regular", "miner", 1),
                    makeEntity(0, 0, "regular", "belt", 0),
                ],
            },
        };

        const hashesA = worldCheck.computeRegionHashes(rootA);
        const hashesB = worldCheck.computeRegionHashes(rootB);
        const rootHashA = worldCheck.computeRootHash(hashesA);
        const rootHashB = worldCheck.computeRootHash(hashesB);

        assert.strictEqual(rootHashA, rootHashB, "Identical entity sets must yield identical root hash regardless of order");

        // Mutate one building's rotation
        const rootC = {
            entityMgr: {
                entities: [
                    makeEntity(0, 0, "regular", "belt", 1), // rot 0 -> 1
                    makeEntity(5, 5, "regular", "miner", 1),
                    makeEntity(100, 100, "wires", "constant_signal", 0, "color_red"),
                ],
            },
        };

        const hashesC = worldCheck.computeRegionHashes(rootC);
        const rootHashC = worldCheck.computeRootHash(hashesC);
        assert.notStrictEqual(rootHashA, rootHashC, "Rotation modification must alter root hash");

        // Mutate signal value
        const rootD = {
            entityMgr: {
                entities: [
                    makeEntity(0, 0, "regular", "belt", 0),
                    makeEntity(5, 5, "regular", "miner", 1),
                    makeEntity(100, 100, "wires", "constant_signal", 0, "color_blue"), // red -> blue
                ],
            },
        };

        const hashesD = worldCheck.computeRegionHashes(rootD);
        const rootHashD = worldCheck.computeRootHash(hashesD);
        assert.notStrictEqual(rootHashA, rootHashD, "Signal change must alter root hash");
    });

    test("serializeRegions and applyRegionData extract and replace regional factory chunks", () => {
        const deleted = [];
        const placed = [];

        global.shapez = {
            Vector: class {
                constructor(x, y) {
                    this.x = x;
                    this.y = y;
                }
            },
            gMetaBuildingRegistry: {
                findById: id => ({ id }),
            },
        };

        const existingEntity = {
            layer: "regular",
            components: {
                StaticMapEntity: {
                    origin: { x: 2, y: 3 },
                    code: "old_belt",
                    rotation: 0,
                    getBuilding: () => ({ getId: () => "old_belt" }),
                },
            },
        };

        const mockClientRoot = {
            map: {
                getLayerContentXY: (x, y, layer) => {
                    if (x === 2 && y === 3 && layer === "regular") return existingEntity;
                    return null;
                },
            },
            logic: {
                tryDeleteBuilding: ent => deleted.push(ent),
                tryPlaceBuilding: args => {
                    placed.push(args);
                    return { components: {} };
                },
            },
        };

        const mockMod = {
            currentRoot: mockClientRoot,
            isApplyingRemote: false,
        };

        const hostRoot = {
            entityMgr: {
                entities: [
                    {
                        layer: "regular",
                        components: {
                            StaticMapEntity: {
                                origin: { x: 2, y: 3 },
                                code: "new_miner",
                                rotation: 2,
                                originalRotation: 2,
                                rotationVariant: 0,
                                variant: "default",
                                getBuilding: () => ({ getId: () => "new_miner" }),
                            },
                        },
                    },
                ],
            },
        };

        const serialized = worldCheck.serializeRegions(hostRoot, ["0_0"]);
        assert.strictEqual(serialized.length, 1);
        assert.strictEqual(serialized[0].key, "0_0");
        assert.strictEqual(serialized[0].entities[0].buildingId, "new_miner");

        // Apply to client
        worldCheck.applyRegionData(mockMod, serialized);

        assert.strictEqual(deleted.length, 1, "Existing entity in chunk must be deleted first");
        assert.strictEqual(deleted[0], existingEntity);
        assert.strictEqual(placed.length, 1, "Authoritative entity must be placed");
        assert.strictEqual(placed[0].building.id, "new_miner");
        assert.strictEqual(placed[0].origin.x, 2);
        assert.strictEqual(placed[0].origin.y, 3);
        assert.strictEqual(mockMod.isApplyingRemote, false, "isApplyingRemote flag must be cleared");
    });

    test("handleClientSyncCheck respects action grace periods and handles consecutive mismatches", () => {
        const sentToHost = [];
        let resyncRequested = false;

        const mockMod = {
            role: "client",
            currentRoot: {
                entityMgr: { entities: [] },
            },
            lastLocalActionAt: 0,
            lastAppliedActionSeq: 10,
            checkMismatchCount: 0,
            repairRounds: 0,
            sendToHost: msg => sentToHost.push(msg),
            requestWorldResync: () => { resyncRequested = true; },
            logInfo: () => {},
            logWarn: () => {},
        };

        // 1. Client actively placed an action 200ms ago -> grace period, do not check
        mockMod.lastLocalActionAt = Date.now() - 200;
        worldCheck.handleClientSyncCheck(mockMod, { actionSeq: 10, rootHash: "deadbeef" });
        assert.strictEqual(mockMod.checkMismatchCount, 0, "Must skip check during local action grace period");

        // 2. Client is waiting for an incoming action (lastAppliedActionSeq = 10 < msg.actionSeq = 12)
        mockMod.lastLocalActionAt = 0;
        mockMod.lastAppliedActionSeq = 10;
        worldCheck.handleClientSyncCheck(mockMod, { actionSeq: 12, rootHash: "deadbeef" });
        assert.strictEqual(mockMod.checkMismatchCount, 0, "Must skip check when incoming actions are still in-flight");

        // 3. First mismatch increments counter but does not request repair immediately
        worldCheck.handleClientSyncCheck(mockMod, { actionSeq: 10, rootHash: "deadbeef" });
        assert.strictEqual(mockMod.checkMismatchCount, 1);
        assert.strictEqual(sentToHost.length, 0);

        // 4. Second consecutive mismatch triggers REQUEST_REGION_HASHES
        worldCheck.handleClientSyncCheck(mockMod, { actionSeq: 10, rootHash: "deadbeef" });
        assert.strictEqual(mockMod.checkMismatchCount, 2);
        assert.strictEqual(sentToHost.length, 1);
        assert.strictEqual(sentToHost[0].type, "REQUEST_REGION_HASHES");

        // 5. If mismatches persist across 3 repair rounds, escalate to full resync
        mockMod.repairRounds = 3;
        worldCheck.handleClientSyncCheck(mockMod, { actionSeq: 10, rootHash: "deadbeef" });
        assert.strictEqual(resyncRequested, true, "Persistent divergence must trigger full resync fallback");
    });

    test("Mutation Twin: detects intentional silent desync and fails oracle if auto-repair is bypassed", () => {
        function makeEntity(x, y, layer = "regular", code = "belt", rot = 0) {
            return {
                layer,
                components: {
                    StaticMapEntity: {
                        origin: { x, y },
                        code,
                        rotation: rot,
                        rotationVariant: 0,
                        variant: "default",
                        getBuilding: () => ({ getId: () => code, getLayer: () => layer }),
                    },
                },
            };
        }

        // 1. Initial State: Host and Client are identical
        const hostEntities = [
            makeEntity(2, 3, "regular", "belt", 0),
            makeEntity(5, 5, "regular", "miner", 1),
            makeEntity(10, 10, "regular", "balancer", 0),
        ];

        const clientEntities = [
            makeEntity(2, 3, "regular", "belt", 0),
            makeEntity(5, 5, "regular", "miner", 1),
            makeEntity(10, 10, "regular", "balancer", 0),
        ];

        const hostRoot = { entityMgr: { entities: hostEntities } };
        const clientRoot = { entityMgr: { entities: clientEntities } };

        const hostHashes = worldCheck.computeRegionHashes(hostRoot);
        const clientHashes = worldCheck.computeRegionHashes(clientRoot);
        assert.strictEqual(
            worldCheck.computeRootHash(clientHashes),
            worldCheck.computeRootHash(hostHashes),
            "Baseline: host and client root hashes must start identical"
        );

        // 2. Mutation Injection: Silently alter client state (mutate miner rotation in chunk 0_0)
        clientEntities[1].components.StaticMapEntity.rotation = 3;

        // 3. Mutation Twin Branch A (Desync Detection Oracle):
        const mutatedClientHashes = worldCheck.computeRegionHashes(clientRoot);
        const mutatedRootHash = worldCheck.computeRootHash(mutatedClientHashes);
        assert.notStrictEqual(
            mutatedRootHash,
            worldCheck.computeRootHash(hostHashes),
            "Oracle Verification: Mutation must alter root hash (prevents hollow passes)"
        );
        assert.notStrictEqual(
            mutatedClientHashes.get("0_0"),
            hostHashes.get("0_0"),
            "Oracle Verification: Divergence must be isolated precisely to mutated region 0_0"
        );

        // 4. Mutation Twin Branch B (Un-repaired Control Failure):
        let fullResyncEscalated = false;
        const mockBypassedMod = {
            role: "client",
            currentRoot: clientRoot,
            lastLocalActionAt: 0,
            lastAppliedActionSeq: 10,
            checkMismatchCount: 2,
            repairRounds: 3, // Max rounds reached
            sendToHost: () => {},
            requestWorldResync: () => { fullResyncEscalated = true; },
            logInfo: () => {},
            logWarn: () => {},
        };
        worldCheck.handleClientSyncCheck(mockBypassedMod, { actionSeq: 10, rootHash: worldCheck.computeRootHash(hostHashes) });
        assert.strictEqual(fullResyncEscalated, true, "Bypassed repair must escalate to full resync");

        // 5. Mutation Twin Branch C (Active Self-Healing Recovery):
        global.shapez = {
            Vector: class {
                constructor(x, y) {
                    this.x = x;
                    this.y = y;
                }
            },
            gMetaBuildingRegistry: {
                findById: id => ({ id, getId: () => id, getLayer: () => "regular" }),
            },
        };

        const deleted = [];
        const placed = [];
        const mockRepairMod = {
            role: "client",
            currentRoot: {
                map: {
                    getLayerContentXY: (x, y, layer) => {
                        return clientEntities.find(e => e.components.StaticMapEntity.origin.x === x && e.components.StaticMapEntity.origin.y === y && e.layer === layer) || null;
                    },
                },
                logic: {
                    tryDeleteBuilding: ent => {
                        deleted.push(ent);
                        const idx = clientEntities.indexOf(ent);
                        if (idx !== -1) clientEntities.splice(idx, 1);
                    },
                    tryPlaceBuilding: args => {
                        placed.push(args);
                        const ent = makeEntity(args.origin.x, args.origin.y, args.building.getLayer?.() || "regular", args.building.getId(), args.rotation);
                        clientEntities.push(ent);
                        return ent;
                    },
                },
                entityMgr: { entities: clientEntities },
            },
            isApplyingRemote: false,
        };

        const serializedDivergentChunks = worldCheck.serializeRegions(hostRoot, ["0_0"]);
        worldCheck.applyRegionData(mockRepairMod, serializedDivergentChunks);

        // Verify that after self-healing auto-repair, client hashes are once again 100% identical to host
        const healedClientHashes = worldCheck.computeRegionHashes(mockRepairMod.currentRoot);
        const healedRootHash = worldCheck.computeRootHash(healedClientHashes);
        assert.strictEqual(healedRootHash, worldCheck.computeRootHash(hostHashes), "Self-healing repair must restore 100% hash equivalence with host");
    });
});
