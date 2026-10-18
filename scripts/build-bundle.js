/**
 * @file scripts/build-bundle.js
 * @description Zero-dependency bundler and module linker for shapez.io Steam Co-op Mod.
 * 
 * Aggregates modular units from:
 *   - `src/bridge/*.js`      -> `src/steam_bridge.js` (Main Process distribution bundle)
 *   - `src/multiplayer/*.js` -> `src/steam_multiplayer.js` (Renderer Sandbox distribution bundle)
 * 
 * Uses micro-closures to encapsulate module scopes cleanly, preventing variable collisions
 * while preserving JSDoc comments, type definitions, and architectural invariants.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT_DIR, "src");
const BRIDGE_DIR = path.join(SRC_DIR, "bridge");
const MULTIPLAYER_DIR = path.join(SRC_DIR, "multiplayer");

const TARGET_BRIDGE_FILE = path.join(SRC_DIR, "steam_bridge.js");
const TARGET_MOD_FILE = path.join(SRC_DIR, "steam_multiplayer.js");

/**
 * Builds the Electron Main Process Bridge bundle (`src/steam_bridge.js`).
 */
function buildBridgeBundle() {
    console.log("-> Assembling src/steam_bridge.js from src/bridge/ modules...");

    const bridgeModules = [
        { key: "./logger", file: "logger.js" },
        { key: "./native_p2p", file: "native_p2p.js" },
        { key: "./lobby_channel", file: "lobby_channel.js" },
        { key: "./tcp_transport", file: "tcp_transport.js" },
        { key: "./steam_client", file: "steam_client.js" },
        { key: "./ipc_handlers", file: "ipc_handlers.js" },
        { key: "./index", file: "index.js" },
    ];

    let modulesCode = "";
    for (const m of bridgeModules) {
        const fullPath = path.join(BRIDGE_DIR, m.file);
        const code = fs.readFileSync(fullPath, "utf8");
        modulesCode += `
// ============================================================================
// Module: ${m.key} (${m.file})
// ============================================================================
__defineModule("${m.key}", function(require, module, exports) {
${code}
});
__aliasModule("${m.key}", "${m.key}.js");
`;
    }

    const bundleContent = `/**
 * @file src/steam_bridge.js
 * @description shapez.io Steam Co-op Mod - Electron Main Process Bridge
 * 
 * NOTE: This is the compiled self-contained bundle assembled from modular units in src/bridge/.
 * Source modules:
 *   - src/bridge/logger.js       : Persistent disk logging & in-memory ring buffer
 *   - src/bridge/native_p2p.js    : Native Steamworks P2P (Channel 0 Reliable, Channel 1 Unreliable)
 *   - src/bridge/lobby_channel.js : Compressed sliding-window Steam Lobby metadata channel
 *   - src/bridge/tcp_transport.js : 4-byte Big-Endian TCP framing & UPnP automatic router mapping
 *   - src/bridge/steam_client.js  : Greenworks Steam API bindings, Lobby lifecycle & profile
 *   - src/bridge/ipc_handlers.js  : Electron ipcMain request routing
 *   - src/bridge/index.js         : Central bridge coordinator
 * 
 * Architectural Invariants:
 * - Thread-safe within Electron's Main Process.
 * - Primary transport: Native Steamworks P2P (ISteamNetworking).
 * - Secondary transport: Length-prefixed TCP streaming.
 * - Zero Steam chat spam: Session discovery and signaling use Steam Lobbies and P2P packets.
 */

const __registeredModules = {};

function __defineModule(id, factory) {
    __registeredModules[id] = { factory, exports: null, loaded: false };
}

function __aliasModule(targetId, aliasId) {
    __registeredModules[aliasId] = __registeredModules[targetId];
}

function __bundleRequire(id) {
    if (__registeredModules[id]) {
        const mod = __registeredModules[id];
        if (!mod.loaded) {
            const moduleObj = { exports: {} };
            mod.loaded = true;
            mod.exports = moduleObj.exports;
            mod.factory(__bundleRequire, moduleObj, moduleObj.exports);
            mod.exports = moduleObj.exports;
        }
        return mod.exports;
    }
    // Delegate external module requirements (fs, path, net, greenworks, etc.) to Node runtime
    return require(id);
}

${modulesCode}

const __bridge = __bundleRequire("./index");

module.exports = {
    init: __bridge.init,
    listen: __bridge.listen,
    setMainWindow: __bridge.setMainWindow,
    createFrameBuffer: __bridge.createFrameBuffer,
    attachFrameParser: __bridge.attachFrameParser,
    startTcpHost: __bridge.startTcpHost,
    stopTcpHost: __bridge.stopTcpHost,
    connectTcpClient: __bridge.connectTcpClient,
    disconnectTcpClient: __bridge.disconnectTcpClient,
    isRealSteamLobbyId: __bridge.isRealSteamLobbyId,
    steamIdToBuffer8: __bridge.steamIdToBuffer8,
    loadNativeSteamP2P: __bridge.loadNativeSteamP2P,
    encodeLobbyWindow: __bridge.encodeLobbyWindow,
    decodeLobbyWindow: __bridge.decodeLobbyWindow,
    LOG_FILE_PATH: __bridge.LOG_FILE_PATH,
};
`;

    // Verify syntax
    new vm.Script(bundleContent);
    fs.writeFileSync(TARGET_BRIDGE_FILE, bundleContent, "utf8");
    console.log(`   [OK] Generated ${TARGET_BRIDGE_FILE} (${(bundleContent.length / 1024).toFixed(1)} KB)`);
}

/**
 * Builds the Chromium Renderer mod bundle (`src/steam_multiplayer.js`).
 */
function buildMultiplayerBundle() {
    console.log("-> Assembling src/steam_multiplayer.js from src/multiplayer/ modules...");

    const modModules = [
        { key: "./constants", file: "constants.js" },
        { key: "./join_code", file: "join_code.js" },
        { key: "./hud/hud_multiplayer", file: "hud/hud_multiplayer.js" },
        { key: "./sync/world_dump", file: "sync/world_dump.js" },
        { key: "./sync/actions", file: "sync/actions.js" },
        { key: "./sync/hub_sync", file: "sync/hub_sync.js" },
        { key: "./sync/cursors", file: "sync/cursors.js" },
        { key: "./sync/game_hooks", file: "sync/game_hooks.js" },
        { key: "./ui/styles", file: "ui/styles.js" },
        { key: "./ui/dialogs", file: "ui/dialogs.js" },
        { key: "./mod", file: "mod.js" },
        { key: "./index", file: "index.js" },
    ];

    let modulesCode = "";
    for (const m of modModules) {
        const fullPath = path.join(MULTIPLAYER_DIR, m.file);
        const code = fs.readFileSync(fullPath, "utf8");
        modulesCode += `
// ============================================================================
// Module: ${m.key} (${m.file})
// ============================================================================
__defineModule("${m.key}", function(require, module, exports) {
${code}
});
__aliasModule("${m.key}", "${m.key}.js");
`;
    }

    const bundleContent = `/* eslint-disable */
/**
 * @file src/steam_multiplayer.js
 * @description shapez.io Steam Co-op Multiplayer Mod (Chromium Renderer Sandbox Bundle)
 * 
 * NOTE: This is the compiled self-contained bundle assembled from modular units in src/multiplayer/.
 * Source modules:
 *   - src/multiplayer/constants.js          : METADATA & PLAYER_COLORS
 *   - src/multiplayer/join_code.js           : Base64 Join Code encoder/decoder & HTML sanitizer
 *   - src/multiplayer/hud/hud_multiplayer.js : In-game HUD element, roster, chat & pings
 *   - src/multiplayer/sync/world_dump.js     : World dump serialization, chunking & savegame isolation
 *   - src/multiplayer/sync/actions.js        : Remote action dispatcher with reentrancy protection
 *   - src/multiplayer/sync/hub_sync.js       : HubGoals & research upgrade tier synchronizer
 *   - src/multiplayer/sync/cursors.js        : Cursors, ghost building previews & map pings
 *   - src/multiplayer/sync/game_hooks.js     : GameLogic & HUD method hooks
 *   - src/multiplayer/ui/styles.js           : Injected CSS styling
 *   - src/multiplayer/ui/dialogs.js          : Main menu buttons, multiplayer modal & toasts
 *   - src/multiplayer/mod.js                 : Central Mod coordinator class
 *   - src/multiplayer/index.js               : Module aggregator barrel
 * 
 * Invariants:
 * - Runs strictly within Chromium sandbox. All network & Steam operations route through window.ipcRenderer.
 * - Save Game Isolation Guarantee: Never overwrites client singleplayer saves.
 * - Reentrancy & Echo Prevention: All remote actions executed with isApplyingRemote = true.
 */

const __registeredModules = {};

function __defineModule(id, factory) {
    __registeredModules[id] = { factory, exports: null, loaded: false };
}

function __aliasModule(targetId, aliasId) {
    __registeredModules[aliasId] = __registeredModules[targetId];
}

function __bundleRequire(id) {
    // Normalize relative path resolution (e.g. "../constants" from "hud/hud_multiplayer")
    let normalized = id;
    if (normalized.startsWith("../")) {
        normalized = "./" + normalized.slice(3);
    }
    if (__registeredModules[normalized]) {
        const mod = __registeredModules[normalized];
        if (!mod.loaded) {
            const moduleObj = { exports: {} };
            mod.loaded = true;
            mod.exports = moduleObj.exports;
            mod.factory(__bundleRequire, moduleObj, moduleObj.exports);
            mod.exports = moduleObj.exports;
        }
        return mod.exports;
    }
    if (typeof require === "function") {
        return require(id);
    }
    return {};
}

${modulesCode}

const __mpBundle = __bundleRequire("./index");

const METADATA = __mpBundle.METADATA;
const PLAYER_COLORS = __mpBundle.PLAYER_COLORS;
const escapeHtml = __mpBundle.escapeHtml;
const encodeJoinCode = __mpBundle.encodeJoinCode;
const decodeJoinCode = __mpBundle.decodeJoinCode;
const HUDMultiplayer = __mpBundle.HUDMultiplayer;
const Mod = __mpBundle.Mod;

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        METADATA,
        PLAYER_COLORS,
        escapeHtml,
        encodeJoinCode,
        decodeJoinCode,
        HUDMultiplayer,
        Mod,
    };
}
`;

    // Verify syntax
    new vm.Script(bundleContent);
    fs.writeFileSync(TARGET_MOD_FILE, bundleContent, "utf8");
    console.log(`   [OK] Generated ${TARGET_MOD_FILE} (${(bundleContent.length / 1024).toFixed(1)} KB)`);
}

function main() {
    console.log("=== Building shapez.io Co-op Mod Distribution Bundles ===");
    buildBridgeBundle();
    buildMultiplayerBundle();
    console.log("=== Build completed successfully! ===\n");
}

if (require.main === module) {
    main();
}

module.exports = {
    buildBridgeBundle,
    buildMultiplayerBundle,
    main,
};
