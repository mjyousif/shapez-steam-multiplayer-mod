const { test, describe } = require("node:test");
const assert = require("node:assert");

const { setupGameHooks } = require("../src/multiplayer/sync/game_hooks");
const { applyRemoteAction } = require("../src/multiplayer/sync/actions");

describe("Blueprint Synchronization Engine", () => {
    function setupMockEnvironment() {
        const dispatchedActions = [];
        const hubBroadcasts = [];

        class Vector {
            constructor(x = 0, y = 0) {
                this.x = x;
                this.y = y;
            }
            add(v) {
                return new Vector(this.x + v.x, this.y + v.y);
            }
            addInplace(v) {
                this.x += v.x;
                this.y += v.y;
                return this;
            }
            copy() {
                return new Vector(this.x, this.y);
            }
        }

        class StaticMapEntityComponent {
            constructor({ origin, rotation = 0, originalRotation = 0, rotationVariant = 0, variant = "default", buildingId = "belt" }) {
                this.origin = origin.copy();
                this.rotation = rotation;
                this.originalRotation = originalRotation;
                this.rotationVariant = rotationVariant;
                this.variant = variant;
                this.buildingId = buildingId;
            }
            getMetaBuilding() {
                return { getId: () => this.buildingId };
            }
            getVariant() {
                return this.variant;
            }
            getRotationVariant() {
                return this.rotationVariant;
            }
        }

        class Entity {
            constructor(root) {
                this.root = root;
                this.components = {};
                this.layer = "regular";
                this.destroyed = false;
            }
            clone() {
                const copy = new Entity(this.root);
                copy.layer = this.layer;
                const sm = this.components.StaticMapEntity;
                copy.components.StaticMapEntity = new StaticMapEntityComponent({
                    origin: sm.origin,
                    rotation: sm.rotation,
                    originalRotation: sm.originalRotation,
                    rotationVariant: sm.rotationVariant,
                    variant: sm.variant,
                    buildingId: sm.buildingId,
                });
                if (this.components.ConstantSignal) {
                    copy.components.ConstantSignal = {
                        signal: this.components.ConstantSignal.signal,
                    };
                }
                if (this.components.Lever) {
                    copy.components.Lever = {
                        toggled: this.components.Lever.toggled,
                    };
                }
                return copy;
            }
        }

        class Blueprint {
            constructor(entities, cost = 10) {
                this.entities = entities;
                this.cost = cost;
            }
            getCost() {
                return this.cost;
            }
            tryPlace(root, targetTile) {
                return root.logic.performBulkOperation(() => {
                    return root.logic.performImmutableOperation(() => {
                        let placedCount = 0;
                        for (let i = 0; i < this.entities.length; i++) {
                            const n = this.entities[i];
                            if (root.logic.checkCanPlaceEntity(n, { offset: targetTile })) {
                                const a = n.clone();
                                a.components.StaticMapEntity.origin.addInplace(targetTile);
                                root.logic.freeEntityAreaBeforeBuild(a);
                                root.map.placeStaticEntity(a);
                                root.entityMgr.registerEntity(a);
                                placedCount++;
                            }
                        }
                        return placedCount > 0;
                    });
                });
            }
        }

        const mapEntities = new Map();
        const registeredEntities = [];

        const mockRoot = {
            logicInitialized: true,
            map: {
                getLayerContentXY: (x, y, layer) => mapEntities.get(`${x},${y},${layer || "regular"}`),
                placeStaticEntity: entity => {
                    const sm = entity.components.StaticMapEntity;
                    mapEntities.set(`${sm.origin.x},${sm.origin.y},${entity.layer || "regular"}`, entity);
                },
            },
            entityMgr: {
                registerEntity: entity => {
                    registeredEntities.push(entity);
                },
            },
            logic: {
                performBulkOperation: fn => fn(),
                performImmutableOperation: fn => fn(),
                checkCanPlaceEntity: () => true,
                freeEntityAreaBeforeBuild: entity => {
                    // Simulates replacing an existing entity at the same coordinate
                    const sm = entity.components.StaticMapEntity;
                    const existing = mapEntities.get(`${sm.origin.x},${sm.origin.y},${entity.layer || "regular"}`);
                    if (existing) {
                        mockRoot.logic.tryDeleteBuilding(existing);
                    }
                },
                tryDeleteBuilding: entity => {
                    const sm = entity.components.StaticMapEntity;
                    mapEntities.delete(`${sm.origin.x},${sm.origin.y},${entity.layer || "regular"}`);
                    entity.destroyed = true;
                    return true;
                },
            },
            gameMode: {
                getHasFreeCopyPaste: () => false,
                getBlueprintShapeKey: () => "bp_shape",
            },
            hubGoals: {
                storedShapes: { bp_shape: 500 },
                takeShapeByKey: (key, amount) => {
                    mockRoot.hubGoals.storedShapes[key] = (mockRoot.hubGoals.storedShapes[key] || 0) - amount;
                },
            },
            hud: {
                parts: {
                    constantSignalEdit: {
                        parseSignalCode: (entity, code) => ({
                            getAsCopyableKey: () => code,
                        }),
                    },
                },
            },
        };

        const shapezMock = {
            Vector,
            Blueprint,
            GameLogic: class {},
            gMetaBuildingRegistry: {
                findById: id => ({
                    getId: () => id,
                    getLayer: () => (id === "constant_signal" ? "wires" : "regular"),
                    createEntity: ({ root, origin, rotation, originalRotation, rotationVariant, variant }) => {
                        const ent = new Entity(root);
                        ent.layer = id === "constant_signal" ? "wires" : "regular";
                        ent.components.StaticMapEntity = new StaticMapEntityComponent({
                            origin,
                            rotation,
                            originalRotation,
                            rotationVariant,
                            variant,
                            buildingId: id,
                        });
                        if (id === "constant_signal") {
                            ent.components.ConstantSignal = { signal: null };
                        }
                        if (id === "lever") {
                            ent.components.Lever = { toggled: false };
                        }
                        return ent;
                    },
                }),
            },
        };

        const modInterface = {
            replaceMethod: (cls, methodName, replacer) => {
                const orig = cls.prototype[methodName] || (() => true);
                cls.prototype[methodName] = function (...args) {
                    return replacer.call(this, orig.bind(this), args);
                };
            },
            runAfterMethod: () => {},
        };

        const mockMod = {
            role: "client",
            isApplyingRemote: false,
            isInsidePlaceBuilding: false,
            modInterface,
            currentRoot: mockRoot,
            pendingActionsQueue: [],
            isSessionActive: () => true,
            dispatchNetworkAction: act => dispatchedActions.push(act),
            broadcastHubSync: root => hubBroadcasts.push(root),
        };

        global.shapez = shapezMock;
        setupGameHooks(mockMod);

        return {
            mockMod,
            mockRoot,
            shapezMock,
            Vector,
            Entity,
            StaticMapEntityComponent,
            Blueprint,
            dispatchedActions,
            hubBroadcasts,
            mapEntities,
            registeredEntities,
        };
    }

    test("local tryPlace intercepts blueprint placement and dispatches ACT_BLUEPRINT", () => {
        const env = setupMockEnvironment();
        const { mockRoot, Vector, Entity, StaticMapEntityComponent, Blueprint, dispatchedActions } = env;

        const ent1 = new Entity(mockRoot);
        ent1.components.StaticMapEntity = new StaticMapEntityComponent({
            origin: new Vector(0, 0),
            buildingId: "belt",
            rotation: 90,
            variant: "default",
        });

        const ent2 = new Entity(mockRoot);
        ent2.components.StaticMapEntity = new StaticMapEntityComponent({
            origin: new Vector(1, 0),
            buildingId: "cutter",
            rotation: 180,
            variant: "default",
        });

        const bp = new Blueprint([ent1, ent2], 15);
        const placed = bp.tryPlace(mockRoot, new Vector(10, 20));

        assert.strictEqual(placed, true);
        assert.strictEqual(dispatchedActions.length, 1);
        const act = dispatchedActions[0];
        assert.strictEqual(act.type, "ACT_BLUEPRINT");
        assert.strictEqual(act.cost, 15);
        assert.strictEqual(act.entries.length, 2);

        assert.strictEqual(act.entries[0].x, 10);
        assert.strictEqual(act.entries[0].y, 20);
        assert.strictEqual(act.entries[0].buildingId, "belt");
        assert.strictEqual(act.entries[0].rotation, 90);

        assert.strictEqual(act.entries[1].x, 11);
        assert.strictEqual(act.entries[1].y, 20);
        assert.strictEqual(act.entries[1].buildingId, "cutter");
        assert.strictEqual(act.entries[1].rotation, 180);
    });

    test("isInsidePlaceBuilding flag guards against spurious ACT_DELETE during blueprint replacement", () => {
        const env = setupMockEnvironment();
        const { mockRoot, Vector, Entity, StaticMapEntityComponent, Blueprint, dispatchedActions, mapEntities } = env;

        // Pre-populate map with an existing building at (10, 20)
        const oldEnt = new Entity(mockRoot);
        oldEnt.components.StaticMapEntity = new StaticMapEntityComponent({
            origin: new Vector(10, 20),
            buildingId: "belt",
        });
        mapEntities.set("10,20,regular", oldEnt);

        // Place blueprint over (10, 20)
        const newEnt = new Entity(mockRoot);
        newEnt.components.StaticMapEntity = new StaticMapEntityComponent({
            origin: new Vector(0, 0),
            buildingId: "balancer",
        });

        const bp = new Blueprint([newEnt], 5);
        bp.tryPlace(mockRoot, new Vector(10, 20));

        // Must ONLY dispatch ACT_BLUEPRINT, never an intermediate ACT_DELETE
        const deleteActions = dispatchedActions.filter(a => a.type === "ACT_DELETE");
        assert.strictEqual(deleteActions.length, 0, "Blueprint replacement must not emit ACT_DELETE");
        assert.strictEqual(dispatchedActions.length, 1);
        assert.strictEqual(dispatchedActions[0].type, "ACT_BLUEPRINT");
    });

    test("applyRemoteAction applies ACT_BLUEPRINT batch and preserves signals and levers", () => {
        const env = setupMockEnvironment();
        const { mockMod, mockRoot, mapEntities, registeredEntities } = env;

        const packet = {
            type: "ACT_BLUEPRINT",
            entries: [
                {
                    x: 5,
                    y: 10,
                    buildingId: "constant_signal",
                    rotation: 0,
                    originalRotation: 0,
                    rotationVariant: 0,
                    variant: "default",
                    layer: "wires",
                    signalCode: "red_shape",
                    toggled: false,
                },
                {
                    x: 6,
                    y: 10,
                    buildingId: "lever",
                    rotation: 0,
                    originalRotation: 0,
                    rotationVariant: 0,
                    variant: "default",
                    layer: "regular",
                    signalCode: null,
                    toggled: true,
                },
            ],
            cost: 25,
            actionSeq: 42,
        };

        applyRemoteAction(mockMod, packet);

        assert.strictEqual(mockMod.lastAppliedActionSeq, 42);
        assert.strictEqual(registeredEntities.length, 2);

        const sigEntity = mapEntities.get("5,10,wires");
        assert(sigEntity, "Signal entity must be placed on wires layer");
        assert.strictEqual(sigEntity.components.ConstantSignal.signal.getAsCopyableKey(), "red_shape");

        const leverEntity = mapEntities.get("6,10,regular");
        assert(leverEntity, "Lever entity must be placed on regular layer");
        assert.strictEqual(leverEntity.components.Lever.toggled, true);
    });

    test("Host deducts blueprint cost and broadcasts Hub sync upon applying ACT_BLUEPRINT", () => {
        const env = setupMockEnvironment();
        const { mockMod, mockRoot, hubBroadcasts } = env;
        mockMod.role = "host";

        const packet = {
            type: "ACT_BLUEPRINT",
            entries: [
                {
                    x: 1,
                    y: 1,
                    buildingId: "belt",
                    rotation: 0,
                    rotationVariant: 0,
                    variant: "default",
                    layer: "regular",
                },
            ],
            cost: 50,
            actionSeq: 100,
        };

        assert.strictEqual(mockRoot.hubGoals.storedShapes.bp_shape, 500);
        applyRemoteAction(mockMod, packet);

        assert.strictEqual(mockRoot.hubGoals.storedShapes.bp_shape, 450, "Host must deduct 50 blueprint shapes");
        assert.strictEqual(hubBroadcasts.length, 1, "Host must broadcast hub sync after blueprint cost deduction");
    });

    test("does not dispatch ACT_BLUEPRINT when isApplyingRemote is true", () => {
        const env = setupMockEnvironment();
        const { mockMod, mockRoot, Vector, Entity, StaticMapEntityComponent, Blueprint, dispatchedActions } = env;

        mockMod.isApplyingRemote = true;

        const ent = new Entity(mockRoot);
        ent.components.StaticMapEntity = new StaticMapEntityComponent({
            origin: new Vector(0, 0),
            buildingId: "belt",
        });

        const bp = new Blueprint([ent], 5);
        bp.tryPlace(mockRoot, new Vector(0, 0));

        assert.strictEqual(dispatchedActions.length, 0, "Must not broadcast during remote action application");
    });
});
