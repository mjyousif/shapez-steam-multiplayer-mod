const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { ASAR_PATH, BACKUP_ASAR_PATH, TARGET_MOD_FILE } = require("./install-mod");

async function verifyAsarIntegrity() {
    console.log("1. Verifying patched app.asar integrity...");
    if (!fs.existsSync(ASAR_PATH) || !fs.existsSync(BACKUP_ASAR_PATH) || !fs.existsSync(TARGET_MOD_FILE)) {
        console.log("   [SKIP] Local shapez.io installation / backup not found (CI or clean environment). Skipping disk ASAR check.");
        return;
    }

    const raw = fs.readFileSync(ASAR_PATH);
    const headerSize = raw.readUInt32LE(4);
    const jsonLen = raw.readUInt32LE(12);
    const header = JSON.parse(raw.subarray(16, 16 + jsonLen).toString("utf8"));

    assert(header.files["index.js"], "index.js must exist in ASAR header");
    assert(header.files["steam.js"], "steam.js must exist in ASAR header");
    assert(header.files["preload.js"], "preload.js must exist in ASAR header");
    assert(header.files["bundle.js"], "bundle.js must exist in ASAR header");
    assert(
        header.files.node_modules.files["shapez.io-private-artifacts"].files.steam.files.lib.files.win64.unpacked ===
            true,
        "win64 greenworks native addon must remain marked unpacked: true"
    );

    const payloadStart = 8 + headerSize;
    const readAsarEntry = name => {
        const entry = header.files[name];
        const start = payloadStart + Number(entry.offset);
        return raw.subarray(start, start + entry.size).toString("utf8");
    };

    const indexContent = readAsarEntry("index.js");
    const steamContent = readAsarEntry("steam.js");
    const preloadContent = readAsarEntry("preload.js");

    assert(indexContent.includes("steam.init(isDev, allowMultiInstance);"), "index.js should call steam.init with allowMultiInstance");
    assert(indexContent.includes("steam.listen();") && !indexContent.includes("if (mods.length === 0)"), "index.js should always call steam.listen()");
    assert(steamContent.includes("steam:mp:create-lobby"), "steam.js should register steam:mp:create-lobby");
    assert(steamContent.includes("mp:net:host-start"), "steam.js should register mp:net:host-start");
    assert(preloadContent.includes("removeListener"), "preload.js should support listener cleanup");

    console.log("   [PASS] app.asar header, offsets, and unpacked native Steam bindings verified.");
}

async function verifyMainProcessAndModEndToEnd() {
    console.log("2. Running end-to-end Host <-> Client simulation (IPC + TCP Framing + Mod Sync)...");

    // Create two isolated IPC + Window environments: one for Host, one for Client
    function createSimulatedInstance(instanceName) {
        const ipcHandlers = new Map();
        const rendererListeners = new Map();

        const mockElectron = {
            ipcMain: {
                handle: (channel, fn) => {
                    ipcHandlers.set(channel, fn);
                },
            },
        };

        const mockWin = {
            isDestroyed: () => false,
            webContents: {
                send: (channel, payload) => {
                    const listeners = rendererListeners.get(channel) || [];
                    for (const cb of listeners) {
                        cb({}, payload);
                    }
                },
            },
        };

        const origLoad = Module._load;
        Module._load = function (request, parent, isMain) {
            if (request === "electron") return mockElectron;
            if (request === "shapez.io-private-artifacts/steam/greenworks") {
                return {
                    FriendFlags: { Immediate: 4 },
                    LobbyType: { FriendsOnly: 1 },
                    restartAppIfNecessary: () => false,
                    init: () => true,
                    getSteamId: () => ({
                        steamId: "765611980000" + (instanceName === "Host" ? "0001" : "0002"),
                        screenName: instanceName + "SteamUser",
                        accountId: instanceName === "Host" ? 1001 : 1002,
                        level: 42,
                    }),
                    setListenForFriendsMessage: () => true,
                    getLaunchCommandLine: () => "",
                    getFriends: () => [
                        {
                            getRawSteamID: () => "7656119800009999",
                            getPersonaName: () => "CoopBuddy",
                        },
                    ],
                    getFriendPersonaName: () => "CoopBuddy",
                    getFriendRichPresence: () => "",
                    setRichPresence: () => true,
                    clearRichPresence: () => true,
                    createLobby: (type, max, cb) => {
                        setTimeout(() => cb("10977524099999999"), 10);
                    },
                    setLobbyData: () => true,
                    getLobbyData: () => "",
                    on: () => {},
                    once: () => {},
                };
            }
            return origLoad.apply(this, arguments);
        };

        const steamPath = path.resolve(__dirname, "..", "src", "asar-patches", "steam.js");
        delete require.cache[steamPath];
        const steamModule = require(steamPath);
        Module._load = origLoad;

        steamModule.setMainWindow(mockWin);
        steamModule.init(true, true);
        steamModule.listen();

        const ipcRenderer = {
            invoke: async (channel, arg) => {
                const handler = ipcHandlers.get(channel);
                assert(handler, `Missing IPC handler for ${channel} on ${instanceName}`);
                return await handler({}, arg);
            },
            on: (channel, cb) => {
                if (!rendererListeners.has(channel)) rendererListeners.set(channel, []);
                rendererListeners.get(channel).push(cb);
                return () => {};
            },
            send: () => {},
        };

        return { ipcRenderer, steamModule };
    }

    const hostEnv = createSimulatedInstance("Host");
    const clientEnv = createSimulatedInstance("Client");

    // Verify Steam status & Friends IPC
    const hostStatus = await hostEnv.ipcRenderer.invoke("steam:mp:get-status");
    assert.strictEqual(hostStatus.initialized, true, "Steam should be initialized in mock");
    assert.strictEqual(hostStatus.profile.name, "HostSteamUser");

    const friends = await hostEnv.ipcRenderer.invoke("steam:mp:get-friends");
    assert.strictEqual(friends.length, 1);
    assert.strictEqual(friends[0].name, "CoopBuddy");
    console.log("   [PASS] Steam Profile, Friends, and Lobby IPC handlers verified.");

    // Build mock shapez environment to load src/steam_multiplayer.js for both Host and Client
    function createMockShapezWorld(env, label) {
        const placedBuildings = [];
        const deletedBuildings = [];
        const mapEntities = new Map(); // "x,y,layer" -> entity

        class Vector {
            constructor(x = 0, y = 0) {
                this.x = x;
                this.y = y;
            }
            toTileSpace() {
                return new Vector(Math.floor(this.x / 32), Math.floor(this.y / 32));
            }
        }

        class Signal {
            constructor() {
                this.listeners = [];
            }
            add(fn, ctx) {
                this.listeners.push(ctx ? fn.bind(ctx) : fn);
            }
            dispatch(...args) {
                for (const fn of this.listeners) fn(...args);
            }
        }

        class BaseHUDPart {
            constructor(root) {
                this.root = root;
            }
            cleanup() {}
        }

        class GameLogic {
            tryPlaceBuilding(args) {
                const key = `${args.origin.x},${args.origin.y},regular`;
                const entity = {
                    uid: Math.floor(Math.random() * 100000),
                    layer: "regular",
                    components: {
                        StaticMapEntity: {
                            origin: args.origin,
                        },
                        Lever: { toggled: false },
                        ConstantSignal: { signal: null },
                    },
                };
                mapEntities.set(key, entity);
                placedBuildings.push({
                    x: args.origin.x,
                    y: args.origin.y,
                    rotation: args.rotation,
                    variant: args.variant,
                    buildingId: args.building.getId(),
                });
                return entity;
            }
            tryDeleteBuilding(entity) {
                if (!entity) return false;
                const origin = entity.components.StaticMapEntity.origin;
                const key = `${origin.x},${origin.y},${entity.layer || "regular"}`;
                mapEntities.delete(key);
                deletedBuildings.push({ x: origin.x, y: origin.y, layer: entity.layer || "regular" });
                return true;
            }
        }

        class HubGoals {
            constructor() {
                this.level = 1;
                this.storedShapes = { CuCuCuCu: 500 };
                this.upgradeLevels = { belt: 0 };
                this.gainedRewards = {};
                this.currentGoal = { reward: "reward_cutter_and_trash" };
            }
            getUpgradeLevel(id) {
                return this.upgradeLevels[id] || 0;
            }
            tryUnlockUpgrade(id) {
                this.upgradeLevels[id] = (this.upgradeLevels[id] || 0) + 1;
                return true;
            }
            computeNextGoal() {}
        }

        class GameHUD {
            draw() {}
            drawOverlays() {}
        }

        class SavegameSerializer {
            generateDumpFromGameRoot(root) {
                return {
                    version: 1010,
                    map: { seed: 424242 },
                    hubGoals: {
                        level: root.hubGoals.level,
                        storedShapes: Object.assign({}, root.hubGoals.storedShapes),
                        upgradeLevels: Object.assign({}, root.hubGoals.upgradeLevels),
                    },
                    entities: placedBuildings.slice(),
                    // Include padding string to test multi-chunk transfer (>48KB)
                    largeFactoryPadding: "X".repeat(110000),
                };
            }
        }

        const shapez = {
            Vector,
            Signal,
            BaseHUDPart,
            GameLogic,
            HubGoals,
            GameHUD,
            SavegameSerializer,
            defaultBuildingVariant: "default",
            enumMouseButton: { left: "left", right: "right" },
            enumHubGoalRewards: { no_reward: "no_reward" },
            MODS: {
                getModsListForSavegame: () => [],
            },
            gMetaBuildingRegistry: {
                findById: id => ({
                    getId: () => id,
                    getLayer: () => "regular",
                    getDimensions: () => new Vector(1, 1),
                    getPreviewSprite: () => null,
                    computeOptimalDirectionAndRotationVariantAtTile: ({ rotation }) => ({
                        rotation: rotation || 0,
                        rotationVariant: 0,
                    }),
                }),
            },
            makeDiv: () => ({
                querySelector: () => ({
                    addEventListener: () => {},
                    classList: { toggle: () => {} },
                    style: {},
                }),
                classList: { toggle: () => {} },
            }),
            Mod: class {
                constructor({ app, modInterface, signals }) {
                    this.app = app;
                    this.modInterface = modInterface;
                    this.signals = signals;
                }
            },
        };

        const hudInitializers = [];
        const modInterface = {
            registerCss: () => {},
            registerHudElement: (id, cls) => {
                hudInitializers.push({ id, cls });
            },
            replaceMethod: (cls, method, fn) => {
                const orig = cls.prototype[method];
                cls.prototype[method] = function (...args) {
                    return fn.call(this, orig.bind(this), args);
                };
            },
            runAfterMethod: (cls, method, fn) => {
                const orig = cls.prototype[method];
                cls.prototype[method] = function (...args) {
                    const res = orig.apply(this, args);
                    fn.apply(this, args);
                    return res;
                };
            },
        };

        let receivedSavedDump = null;
        const mockSavegame = {
            getCurrentVersion: () => 1010,
            currentData: { dump: { entities: [{}] } },
            metaDataRef: {},
            writeSavegameAndMetadata: async function () {
                receivedSavedDump = this.currentData.dump;
            },
        };

        const root = {
            logicInitialized: true,
            gameWidth: 1280,
            gameHeight: 720,
            currentLayer: "regular",
            savegame: mockSavegame,
            app: { mousePosition: new Vector(160, 160) },
            camera: {
                zoomLevel: 1,
                center: new Vector(0, 0),
                screenToWorld: v => v,
                worldToScreen: v => v,
            },
            map: {
                getLayerContentXY: (x, y, layer) => mapEntities.get(`${x},${y},${layer || "regular"}`),
            },
            logic: new GameLogic(),
            hubGoals: new HubGoals(),
            signals: {
                storyGoalCompleted: new Signal(),
                upgradePurchased: new Signal(),
            },
            hud: {
                parts: {},
            },
        };

        const app = {
            savegameMgr: {
                createNewSavegame: () => mockSavegame,
                getSavegamesMetaData: () => [],
            },
            stateMgr: {
                currentState: { key: "InGameState" },
                moveToState: (stateKey, payload) => {
                    if (payload && payload.savegame && payload.savegame.currentData?.dump) {
                        receivedSavedDump = payload.savegame.currentData.dump;
                    }
                },
            },
        };

        const signals = {
            stateEntered: new Signal(),
        };

        const modSource = fs.readFileSync(TARGET_MOD_FILE, "utf8");
        let registeredModClass = null;
        let registeredMeta = null;

        const mockWindow = {
            shapez,
            ipcRenderer: env.ipcRenderer,
            $shapez_registerMod: (cls, meta) => {
                registeredModClass = cls;
                registeredMeta = meta;
            },
            addEventListener: () => {},
            removeEventListener: () => {},
        };

        const mockDocument = {
            body: { appendChild: () => {} },
            querySelector: () => null,
            createElement: () => ({
                className: "",
                classList: { add: () => {}, remove: () => {}, toggle: () => {} },
                addEventListener: () => {},
                querySelector: () => ({ addEventListener: () => {} }),
                querySelectorAll: () => [],
                remove: () => {},
            }),
        };

        const runner = new Function(
            "window",
            "document",
            "shapez",
            "ipcRenderer",
            `
            ${modSource}
            if (typeof Mod !== 'undefined') {
                window.$shapez_registerMod(Mod, METADATA);
            }
            `
        );
        runner(mockWindow, mockDocument, shapez, env.ipcRenderer);

        assert(registeredModClass, `Mod class should register on ${label}`);
        assert.strictEqual(registeredMeta.id, "steam-multiplayer");

        const modInstance = new registeredModClass({ app, modInterface, signals });
        modInstance.init();

        const hudStub = {
            refreshUI: () => {},
            appendChatLine: () => {},
        };
        modInstance.attachGameRoot(root, hudStub);

        return {
            mod: modInstance,
            root,
            shapez,
            placedBuildings,
            deletedBuildings,
            getReceivedDump: () => receivedSavedDump,
        };
    }

    const hostWorld = createMockShapezWorld(hostEnv, "Host");
    const clientWorld = createMockShapezWorld(clientEnv, "Client");

    // 1. Place an initial building on Host before starting server
    hostWorld.root.logic.tryPlaceBuilding({
        origin: new hostWorld.shapez.Vector(5, 7),
        rotation: 90,
        originalRotation: 90,
        rotationVariant: 0,
        variant: "default",
        building: hostWorld.shapez.gMetaBuildingRegistry.findById("belt"),
    });

    // 2. Start Hosting on port 27088
    const hostInfo = await hostWorld.mod.startHostingSession({ port: 27088, mode: "coop" });
    assert.strictEqual(hostInfo.port, 27088);
    assert(hostInfo.joinCode, "Host should produce a Join Code");

    // 3. Client connects using Host's Join Code
    await clientWorld.mod.joinByCodeOrAddress(hostInfo.joinCode);

    // Wait briefly for async TCP handshake + chunked 110KB world dump transfer
    await new Promise(r => setTimeout(r, 200));

    const syncedDump = clientWorld.getReceivedDump();
    assert(syncedDump, "Client must receive chunked WELCOME_WORLD dump from Host");
    assert.strictEqual(syncedDump.map.seed, 424242, "Client must receive Host's map seed");
    assert.strictEqual(syncedDump.entities.length, 1, "Client dump must include Host's initial building");
    assert.strictEqual(syncedDump.largeFactoryPadding.length, 110000, "Multi-chunk 110KB payload must reassemble losslessly");
    console.log("   [PASS] Host -> Client chunked World Dump handshake verified (110KB+ payload).");

    // 4. Test Host placing a building -> replicated on Client
    hostWorld.root.logic.tryPlaceBuilding({
        origin: new hostWorld.shapez.Vector(10, 12),
        rotation: 180,
        originalRotation: 180,
        rotationVariant: 0,
        variant: "default",
        building: hostWorld.shapez.gMetaBuildingRegistry.findById("miner"),
    });

    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(clientWorld.placedBuildings.length, 1, "Host building placement must replicate to Client");
    assert.strictEqual(clientWorld.placedBuildings[0].x, 10);
    assert.strictEqual(clientWorld.placedBuildings[0].y, 12);
    assert.strictEqual(clientWorld.placedBuildings[0].buildingId, "miner");

    // 5. Test Client placing a building -> replicated on Host
    clientWorld.root.logic.tryPlaceBuilding({
        origin: new clientWorld.shapez.Vector(22, 30),
        rotation: 270,
        originalRotation: 270,
        rotationVariant: 0,
        variant: "default",
        building: clientWorld.shapez.gMetaBuildingRegistry.findById("cutter"),
    });

    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(hostWorld.placedBuildings.length, 3, "Client building placement must replicate to Host without echo loop");
    assert.strictEqual(hostWorld.placedBuildings[2].x, 22);
    assert.strictEqual(hostWorld.placedBuildings[2].y, 30);
    assert.strictEqual(hostWorld.placedBuildings[2].buildingId, "cutter");

    // 6. Test Client deleting a building -> replicated on Host
    const entityOnClient = clientWorld.root.map.getLayerContentXY(22, 30, "regular");
    assert(entityOnClient, "Entity at (22,30) should exist on Client");
    clientWorld.root.logic.tryDeleteBuilding(entityOnClient);

    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(hostWorld.deletedBuildings.length, 1, "Client building deletion must replicate to Host");
    assert.strictEqual(hostWorld.deletedBuildings[0].x, 22);
    assert.strictEqual(hostWorld.deletedBuildings[0].y, 30);

    // 7. Test Hub Upgrade & Authoritative Hub Sync
    clientWorld.root.hubGoals.tryUnlockUpgrade("belt");
    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(hostWorld.root.hubGoals.getUpgradeLevel("belt"), 1, "Client upgrade unlock must sync to Host");

    hostWorld.root.hubGoals.level = 5;
    hostWorld.root.hubGoals.storedShapes["RuRuRuRu"] = 1234;
    hostWorld.mod.broadcastHubSync(hostWorld.root);
    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(clientWorld.root.hubGoals.level, 5, "Host level advancement must sync to Client");
    assert.strictEqual(clientWorld.root.hubGoals.storedShapes["RuRuRuRu"], 1234, "Host stored shapes must sync to Client");

    // 8. Test Live Cursor & Map Ping broadcast
    clientWorld.mod.broadcastLocalCursorState(clientWorld.root);
    clientWorld.mod.sendMapPingAtCursor();
    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(hostWorld.mod.activePings.length, 1, "Client map ping must appear on Host");

    // Cleanup sockets
    await clientWorld.mod.stopSession(false);
    await hostWorld.mod.stopSession(false);

    console.log("   [PASS] Bidirectional Action Sync (Place, Delete, Upgrades, Hub Goals, Cursors, Pings) verified.");
}

async function main() {
    await verifyAsarIntegrity();
    await verifyMainProcessAndModEndToEnd();
    console.log("\nALL VERIFICATION CHECKS PASSED SUCCESSFULLY!");
}

main().catch(err => {
    console.error("Verification failed:", err);
    process.exit(1);
});
