const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

describe("Client Savegame Isolation", () => {
    test("does not overwrite active singleplayer savegame when joining co-op or resyncing", async () => {
        const singleplayerSave = {
            id: "sp_save_01",
            currentData: {
                version: 1000,
                dump: { factory: "100_hour_singleplayer_factory" },
                lastUpdate: 1234567,
            },
            metaDataRef: {
                internalId: "sp_save_01",
                name: "My Massive Factory",
                level: 50,
            },
            getCurrentVersion: () => 1000,
            writeSavegameAndMetadata: async () => {},
        };

        let newSavegameCreatedCount = 0;
        const createdSaves = [];

        class MockSavegame {
            constructor() {
                newSavegameCreatedCount++;
                this.id = "coop_save_" + newSavegameCreatedCount;
                this.currentData = null;
                this.metaDataRef = {
                    internalId: this.id,
                    name: "New Save",
                    level: 1,
                };
                this.writeCount = 0;
                createdSaves.push(this);
            }
            getCurrentVersion() {
                return 1000;
            }
            async writeSavegameAndMetadata() {
                this.writeCount++;
            }
        }

        let enteredState = null;
        let enteredPayload = null;

        const mockApp = {
            savegameMgr: {
                createNewSavegame: () => new MockSavegame(),
                getSavegamesMetaData: () => [],
            },
            stateMgr: {
                currentState: { key: "InGameState" },
                moveToState: (key, payload) => {
                    enteredState = key;
                    enteredPayload = payload;
                    mockApp.stateMgr.currentState = { key };
                    for (const listener of stateEnteredListeners) {
                        listener({ key });
                    }
                },
            },
        };

        const mockModInterface = {
            registerCss: () => {},
            registerHudElement: () => {},
            runAfterMethod: () => {},
            replaceMethod: () => {},
        };

        const stateEnteredListeners = [];
        const mockSignals = {
            stateEntered: { add: fn => stateEnteredListeners.push(fn) },
        };

        // Minimal shapez globals for mod initialization
        const mockShapez = {
            Mod: class {
                constructor() {
                    this.app = mockApp;
                    this.modInterface = mockModInterface;
                    this.signals = mockSignals;
                }
            },
            BaseHUDPart: class {
                constructor(root) {
                    this.root = root;
                }
            },
            makeDiv: () => ({
                querySelector: () => ({
                    addEventListener: () => {},
                    classList: { toggle: () => {} },
                    style: {},
                }),
                classList: { toggle: () => {} },
                appendChild: () => {},
            }),
            MODS: {
                getModsListForSavegame: () => [],
            },
            GameHUD: {},
            MainMenuState: {},
            enumMouseButton: { left: 0 },
            gMetaBuildingRegistry: { findById: () => null },
        };

        // Load steam_multiplayer.js in a mocked context
        const modSource = fs.readFileSync(
            path.join(__dirname, "..", "dist", "steam_multiplayer.js"),
            "utf8"
        );

        let registeredClass = null;
        const mockWindow = {
            shapez: mockShapez,
            ipcRenderer: {
                invoke: async () => ({
                    initialized: false,
                    profile: { steamId: "client_id", name: "ClientPlayer" },
                }),
                on: () => {},
            },
            $shapez_registerMod: (cls, meta) => {
                registeredClass = cls;
            },
            addEventListener: () => {},
            removeEventListener: () => {},
        };

        const mockDocument = {
            body: { appendChild: () => {} },
            querySelector: () => null,
            getElementById: () => null,
            createElement: () => ({
                className: "",
                classList: { add: () => {}, remove: () => {}, toggle: () => {} },
                addEventListener: () => {},
                querySelector: () => ({ addEventListener: () => {}, style: {} }),
                querySelectorAll: () => [],
                remove: () => {},
                style: {},
            }),
        };

        const contextFn = new Function(
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

        contextFn(mockWindow, mockDocument, mockShapez, mockWindow.ipcRenderer);

        assert.ok(registeredClass, "Mod class should be registered");
        const modInstance = new registeredClass();
        modInstance.init();

        // Simulate that the client was actively playing their own singleplayer game
        modInstance.currentRoot = {
            savegame: singleplayerSave,
            logicInitialized: true,
        };

        // 1. Host transmits initial world dump
        const hostDump1 = { hubGoals: { level: 12 }, buildings: ["belt_1", "miner_1"] };
        await modInstance.loadHostWorldDump(hostDump1, "CoolHost");

        // Verify singleplayer save was completely untouched!
        assert.strictEqual(
            singleplayerSave.metaDataRef.name,
            "My Massive Factory",
            "Singleplayer save name must NOT be overwritten"
        );
        assert.strictEqual(
            singleplayerSave.currentData.dump.factory,
            "100_hour_singleplayer_factory",
            "Singleplayer save dump must NOT be overwritten"
        );

        // Verify a new isolated co-op savegame was created
        assert.strictEqual(newSavegameCreatedCount, 1, "Exactly one new savegame should be created");
        assert.ok(modInstance.activeCoopSavegame, "activeCoopSavegame must be tracked");
        assert.strictEqual(modInstance.activeCoopSavegame.metaDataRef.name, "Co-op (CoolHost)");
        assert.deepStrictEqual(modInstance.activeCoopSavegame.currentData.dump, hostDump1);
        assert.strictEqual(enteredState, "InGameState");
        assert.strictEqual(enteredPayload.savegame, modInstance.activeCoopSavegame);

        // 2. Client triggers an on-demand resync during the session
        const hostDump2 = { hubGoals: { level: 13 }, buildings: ["belt_1", "miner_1", "cutter_1"] };
        await modInstance.loadHostWorldDump(hostDump2, "CoolHost");

        // Should reuse activeCoopSavegame without creating another new save file
        assert.strictEqual(
            newSavegameCreatedCount,
            1,
            "Resync must reuse existing activeCoopSavegame without creating extra save files"
        );
        assert.deepStrictEqual(modInstance.activeCoopSavegame.currentData.dump, hostDump2);
        assert.strictEqual(
            singleplayerSave.metaDataRef.name,
            "My Massive Factory",
            "Singleplayer save remains safe after resync"
        );

        // 3. Disconnect resets activeCoopSavegame
        await modInstance.stopSession(false);
        assert.strictEqual(modInstance.activeCoopSavegame, null, "activeCoopSavegame reset on stopSession");

        // 4. Auto-disconnect when exiting from an active game session to MainMenuState
        modInstance.role = "client";
        modInstance.activeCoopSavegame = { id: "active_coop_session" };
        assert.strictEqual(modInstance.isSessionActive(), true);

        // Trigger MainMenuState entry event
        for (const listener of stateEnteredListeners) {
            listener({ key: "MainMenuState" });
        }

        assert.strictEqual(
            modInstance.role,
            "none",
            "Multiplayer role must reset to 'none' when returning to MainMenuState"
        );
        assert.strictEqual(
            modInstance.activeCoopSavegame,
            null,
            "activeCoopSavegame must be cleared when returning to MainMenuState"
        );
        assert.strictEqual(
            modInstance.isSessionActive(),
            false,
            "Session must no longer be active after returning to menu"
        );

        // 5. Join progress overlay displays and cleans up on attachGameRoot
        modInstance.showJoinProgressModal("Connecting to Host...");
        assert.ok(modInstance.joinOverlayEl, "joinOverlayEl must be created on showJoinProgressModal");
        modInstance.updateJoinProgressModal("Downloading snapshot: 50%...", 50);

        modInstance.attachGameRoot({ logicInitialized: true }, {});
        assert.strictEqual(
            modInstance.joinOverlayEl,
            null,
            "joinOverlayEl must be dismissed when attachGameRoot is called"
        );
        assert.strictEqual(
            modInstance.isConnecting,
            false,
            "isConnecting must be reset to false when attachGameRoot is called"
        );
    });
});
