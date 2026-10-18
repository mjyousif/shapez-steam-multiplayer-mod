const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

describe("Ghost Building Preview Rendering", () => {
    function setupModContext() {
        const drawCalls = [];
        const ctxCalls = [];

        const mockContext = {
            save: () => ctxCalls.push(["save"]),
            restore: () => ctxCalls.push(["restore"]),
            translate: (x, y) => ctxCalls.push(["translate", x, y]),
            rotate: angle => ctxCalls.push(["rotate", angle]),
            scale: (x, y) => ctxCalls.push(["scale", x, y]),
            fillRect: (...args) => ctxCalls.push(["fillRect", ...args]),
            strokeRect: (...args) => ctxCalls.push(["strokeRect", ...args]),
            rect: (...args) => ctxCalls.push(["rect", ...args]),
            beginRoundedRect: (...args) => ctxCalls.push(["beginRoundedRect", ...args]),
            fill: () => ctxCalls.push(["fill"]),
            stroke: () => ctxCalls.push(["stroke"]),
            beginPath: () => ctxCalls.push(["beginPath"]),
            moveTo: () => ctxCalls.push(["moveTo"]),
            lineTo: () => ctxCalls.push(["lineTo"]),
            closePath: () => ctxCalls.push(["closePath"]),
            fillText: () => ctxCalls.push(["fillText"]),
            measureText: () => ({ width: 50 }),
            lineWidth: 1,
            globalAlpha: 1,
            fillStyle: "",
            strokeStyle: "",
        };

        const mockParameters = {
            context: mockContext,
            visibleRect: {
                containsRect4Params: () => true,
            },
            desiredAtlasScale: 0.5,
        };

        const blueprintSprite = {
            name: "blueprintSprite",
            drawCached: (params, x, y, w, h, clip) => {
                drawCalls.push({ type: "cached", sprite: "blueprintSprite", x, y, w, h, clip });
            },
            draw: (ctx, x, y, w, h) => {
                drawCalls.push({ type: "raw", sprite: "blueprintSprite", x, y, w, h });
            },
        };

        const previewSprite = {
            name: "previewSprite",
            drawCached: (params, x, y, w, h, clip) => {
                drawCalls.push({ type: "cached", sprite: "previewSprite", x, y, w, h, clip });
            },
            draw: (ctx, x, y, w, h) => {
                drawCalls.push({ type: "raw", sprite: "previewSprite", x, y, w, h });
            },
        };

        const mockMetaBalancer = {
            getId: () => "balancer",
            getLayer: () => "regular",
            getDimensions: () => ({ x: 2, y: 1 }),
            getBlueprintSprite: () => blueprintSprite,
            getPreviewSprite: () => previewSprite,
        };

        const mockMetaWire = {
            getId: () => "wire",
            getLayer: () => "wires",
            getDimensions: () => ({ x: 1, y: 1 }),
            getBlueprintSprite: () => blueprintSprite,
            getPreviewSprite: () => previewSprite,
        };

        class MockVector {
            constructor(x = 0, y = 0) {
                this.x = x;
                this.y = y;
            }
        }

        const mockShapez = {
            Mod: class {
                constructor() {
                    this.modInterface = {
                        registerCss: () => {},
                        registerHudElement: () => {},
                        runAfterMethod: () => {},
                        replaceMethod: () => {},
                    };
                    this.signals = { stateEntered: { add: () => {} } };
                }
            },
            BaseHUDPart: class {},
            Vector: MockVector,
            defaultBuildingVariant: "default",
            gMetaBuildingRegistry: {
                findById: id => {
                    if (id === "balancer") return mockMetaBalancer;
                    if (id === "wire") return mockMetaWire;
                    return null;
                },
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
            MODS: { getModsListForSavegame: () => [] },
            GameHUD: {},
            MainMenuState: {},
            enumMouseButton: { left: 0 },
        };

        let registeredModClass = null;
        const mockWindow = {
            shapez: mockShapez,
            ipcRenderer: {
                invoke: async () => ({
                    initialized: false,
                    profile: { steamId: "client_id", name: "ClientPlayer" },
                }),
                on: () => () => {},
                send: () => {},
            },
            $shapez_registerMod: (cls, meta) => {
                registeredModClass = cls;
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

        const modSource = fs.readFileSync(
            path.join(__dirname, "..", "dist", "steam_multiplayer.js"),
            "utf8"
        );

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

        const modInstance = new registeredModClass();
        modInstance.init();

        return {
            mod: modInstance,
            parameters: mockParameters,
            drawCalls,
            ctxCalls,
            blueprintSprite,
            previewSprite,
            mockMetaBalancer,
        };
    }

    test("rotates 2x1 balancer with correct tile bounding box at 90 and 270 degrees", () => {
        const { mod, parameters, ctxCalls } = setupModContext();
        const root = {
            camera: { zoomLevel: 1 },
            currentLayer: "regular",
        };

        mod.remotePlayers.set("peer_1", {
            id: "peer_1",
            name: "Teammate",
            color: "#38bdf8",
            x: 10 * 32, // tile (10, 5)
            y: 5 * 32,
            renderX: 10 * 32,
            renderY: 5 * 32,
            layer: "regular",
            buildingId: "balancer",
            variant: "default",
            rotation: 90, // rotated 90 degrees
            rotationVariant: 0,
        });

        mod.drawWorldSpacePeers(root, parameters);

        // At 90 degrees, dims (2, 1) bounds becomes x = 10 - 1 + 1 = 10, y = 5, w = 1, h = 2
        // In pixels: worldBoxX = 320, worldBoxY = 160, worldBoxW = 32, worldBoxH = 64
        // Margin of 2: box is (322, 162, 28, 60)
        const roundedRectCalls = ctxCalls.filter(c => c[0] === "beginRoundedRect");
        assert.ok(roundedRectCalls.length >= 1, "Should draw rounded rect for preview bounds");
        const [, rx, ry, rw, rh] = roundedRectCalls[0];
        assert.strictEqual(rx, 320 + 2);
        assert.strictEqual(ry, 160 + 2);
        assert.strictEqual(rw, 32 - 4);
        assert.strictEqual(rh, 64 - 4);
    });

    test("preserves non-square sprite aspect ratio and rotates around first tile pivot", () => {
        const { mod, parameters, drawCalls, ctxCalls } = setupModContext();
        const root = {
            camera: { zoomLevel: 1 },
            currentLayer: "regular",
        };

        mod.remotePlayers.set("peer_1", {
            id: "peer_1",
            name: "Teammate",
            color: "#38bdf8",
            x: 10 * 32,
            y: 5 * 32,
            renderX: 10 * 32,
            renderY: 5 * 32,
            layer: "regular",
            buildingId: "balancer",
            variant: "default",
            rotation: 90,
            rotationVariant: 0,
        });

        mod.drawWorldSpacePeers(root, parameters);

        // Check pivot translation: tileX * 32 + 16 = 336, tileY * 32 + 16 = 176
        const translateCalls = ctxCalls.filter(c => c[0] === "translate" && c[1] === 336 && c[2] === 176);
        assert.ok(translateCalls.length >= 1, "Should translate to center of origin tile (336, 176)");

        // Check rotation angle: 90 deg = Math.PI / 2
        const rotateCalls = ctxCalls.filter(c => c[0] === "rotate" && Math.abs(c[1] - Math.PI / 2) < 0.001);
        assert.ok(rotateCalls.length >= 1, "Should rotate by Math.PI / 2");

        // Check sprite draw: width must be 64 (2 * 32) and height must be 32 (1 * 32)
        // NOT 64x64 square!
        assert.strictEqual(drawCalls.length, 1);
        assert.strictEqual(drawCalls[0].w, 64, "Sprite width should match unrotated dims.x * 32");
        assert.strictEqual(drawCalls[0].h, 32, "Sprite height should match unrotated dims.y * 32 (NOT squashed to square)");
        assert.strictEqual(drawCalls[0].x, -16, "Rotated sprite should be drawn from -16 relative to origin tile center");
        assert.strictEqual(drawCalls[0].y, -16, "Rotated sprite should be drawn from -16 relative to origin tile center");
    });

    test("prefers blueprint sprite for ghost preview", () => {
        const { mod, parameters, drawCalls } = setupModContext();
        const root = {
            camera: { zoomLevel: 1 },
            currentLayer: "regular",
        };

        mod.remotePlayers.set("peer_1", {
            id: "peer_1",
            name: "Teammate",
            color: "#38bdf8",
            x: 0,
            y: 0,
            renderX: 0,
            renderY: 0,
            layer: "regular",
            buildingId: "balancer",
            variant: "default",
            rotation: 0,
            rotationVariant: 0,
        });

        mod.drawWorldSpacePeers(root, parameters);

        assert.strictEqual(drawCalls.length, 1);
        assert.strictEqual(drawCalls[0].sprite, "blueprintSprite");
    });

    test("does not render ghost building when building layer does not match current view layer", () => {
        const { mod, parameters, drawCalls } = setupModContext();
        const root = {
            camera: { zoomLevel: 1 },
            currentLayer: "regular", // view is regular
        };

        // Remote player is holding a wire (wires layer)
        mod.remotePlayers.set("peer_1", {
            id: "peer_1",
            name: "Teammate",
            color: "#38bdf8",
            x: 0,
            y: 0,
            renderX: 0,
            renderY: 0,
            layer: "wires",
            buildingId: "wire",
            variant: "default",
            rotation: 0,
            rotationVariant: 0,
        });

        mod.drawWorldSpacePeers(root, parameters);

        // No sprite should have been drawn because layers do not match
        assert.strictEqual(drawCalls.length, 0, "Should not render wires preview while on regular layer");
    });
});
