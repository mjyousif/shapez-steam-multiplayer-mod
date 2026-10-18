/**
 * @file scripts/build-bundle.js
 * @description Zero-dependency bundler and module linker for shapez.io Steam Co-op Mod.
 * 
 * Aggregates modular units from:
 *   - `src/bridge/*.js`      -> `dist/steam_bridge.js` (Main Process distribution bundle)
 *   - `src/multiplayer/*.js` -> `dist/steam_multiplayer.js` (Renderer Sandbox distribution bundle)
 * 
 * Uses micro-closures to encapsulate module scopes cleanly, preventing variable collisions
 * while preserving JSDoc comments, type definitions, and architectural invariants.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT_DIR, "src");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const BRIDGE_DIR = path.join(SRC_DIR, "bridge");
const MULTIPLAYER_DIR = path.join(SRC_DIR, "multiplayer");

const TARGET_BRIDGE_FILE = path.join(DIST_DIR, "steam_bridge.js");
const TARGET_MOD_FILE = path.join(DIST_DIR, "steam_multiplayer.js");

/**
 * Recursively and deterministically discovers all JavaScript source modules in a directory.
 * @param {string} dir Absolute directory path to search.
 * @param {string} [baseDir] Base directory for calculating relative module paths.
 * @returns {Array<{ key: string, relPath: string, fullPath: string }>} Discovered module entries.
 */
function discoverModules(dir, baseDir = dir) {
    let modules = [];
    if (!fs.existsSync(dir)) return modules;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            modules = modules.concat(discoverModules(fullPath, baseDir));
        } else if (entry.isFile() && entry.name.endsWith(".js")) {
            const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
            const key = relPath.replace(/\.js$/, "");
            modules.push({ key, relPath, fullPath });
        }
    }
    return modules;
}

/**
 * Returns the CommonJS micro-loader header to inject into distribution bundles.
 * Supports context-aware relative require() resolution (./, ../, nested paths).
 * @returns {string} Loader runtime JavaScript string.
 */
function getLoaderHeader() {
    return `
const __registeredModules = {};

function __defineModule(id, factory) {
    const key = id.replace(/\\\\/g, "/").replace(/^\\.\\//, "").replace(/\\.js$/, "");
    __registeredModules[key] = { factory, exports: null, loaded: false };
}

function __resolve(fromDir, request) {
    if (request.startsWith("./") || request.startsWith("../")) {
        const combined = fromDir ? fromDir + "/" + request : request;
        const parts = combined.split("/");
        const resolved = [];
        for (const part of parts) {
            if (part === "." || part === "") continue;
            if (part === "..") {
                resolved.pop();
            } else {
                resolved.push(part);
            }
        }
        return resolved.join("/").replace(/\\.js$/, "");
    }
    return request.replace(/\\\\/g, "/").replace(/^\\.\\//, "").replace(/\\.js$/, "");
}

function __createScopedRequire(fromFile) {
    const fromDir = fromFile.includes("/") ? fromFile.substring(0, fromFile.lastIndexOf("/")) : "";
    return function scopedRequire(request) {
        const key = __resolve(fromDir, request);
        if (__registeredModules[key]) {
            const mod = __registeredModules[key];
            if (!mod.loaded) {
                const moduleObj = { exports: {} };
                mod.loaded = true;
                mod.exports = moduleObj.exports;
                mod.factory(__createScopedRequire(key), moduleObj, moduleObj.exports);
                mod.exports = moduleObj.exports;
            }
            return mod.exports;
        }
        if (typeof require === "function") {
            return require(request);
        }
        return {};
    };
}
`;
}

/**
 * Builds the Electron Main Process Bridge bundle (`dist/steam_bridge.js`).
 */
function buildBridgeBundle() {
    console.log("-> Assembling dist/steam_bridge.js from src/bridge/ modules...");

    const bridgeModules = discoverModules(BRIDGE_DIR);
    console.log(`   Found ${bridgeModules.length} module(s) in src/bridge/`);

    let modulesCode = "";
    for (const m of bridgeModules) {
        const code = fs.readFileSync(m.fullPath, "utf8");
        modulesCode += `
// ============================================================================
// Module: ${m.key} (${m.relPath})
// ============================================================================
__defineModule("${m.key}", function(require, module, exports) {
${code}
});
`;
    }

    const bundleContent = `/**
 * @file dist/steam_bridge.js
 * @description shapez.io Steam Co-op Mod - Electron Main Process Bridge
 * 
 * NOTE: This is the compiled self-contained bundle dynamically assembled from modular units in src/bridge/.
 * 
 * Architectural Invariants:
 * - Thread-safe within Electron's Main Process.
 * - Primary transport: Native Steamworks P2P (ISteamNetworking).
 * - Secondary transport: Length-prefixed TCP streaming.
 * - Zero Steam chat spam: Session discovery and signaling use Steam Lobbies and P2P packets.
 */
${getLoaderHeader()}
${modulesCode}

const __bridge = __createScopedRequire("")("./index");

module.exports = __bridge;
`;

    // Verify syntax
    new vm.Script(bundleContent);
    fs.writeFileSync(TARGET_BRIDGE_FILE, bundleContent, "utf8");
    console.log(`   [OK] Generated ${TARGET_BRIDGE_FILE} (${(bundleContent.length / 1024).toFixed(1)} KB)`);
}

/**
 * Builds the Chromium Renderer mod bundle (`dist/steam_multiplayer.js`).
 */
function buildMultiplayerBundle() {
    console.log("-> Assembling dist/steam_multiplayer.js from src/multiplayer/ modules...");

    const pkgPath = path.join(ROOT_DIR, "package.json");
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
            const constantsPath = path.join(MULTIPLAYER_DIR, "constants.js");
            if (pkg.version && fs.existsSync(constantsPath)) {
                let constantsCode = fs.readFileSync(constantsPath, "utf8");
                const updatedConstants = constantsCode.replace(/version:\s*["'][^"']+["']/, `version: "${pkg.version}"`);
                if (updatedConstants !== constantsCode) {
                    fs.writeFileSync(constantsPath, updatedConstants, "utf8");
                    console.log(`   [Version Sync] Synchronized src/multiplayer/constants.js -> v${pkg.version}`);
                }
            }
        } catch {}
    }

    const modModules = discoverModules(MULTIPLAYER_DIR);
    console.log(`   Found ${modModules.length} module(s) in src/multiplayer/`);

    let modulesCode = "";
    for (const m of modModules) {
        const code = fs.readFileSync(m.fullPath, "utf8");
        modulesCode += `
// ============================================================================
// Module: ${m.key} (${m.relPath})
// ============================================================================
__defineModule("${m.key}", function(require, module, exports) {
${code}
});
`;
    }

    const bundleContent = `/* eslint-disable */
/**
 * @file dist/steam_multiplayer.js
 * @description shapez.io Steam Co-op Multiplayer Mod (Chromium Renderer Sandbox Bundle)
 * 
 * NOTE: This is the compiled self-contained bundle dynamically assembled from modular units in src/multiplayer/.
 * 
 * Invariants:
 * - Runs strictly within Chromium sandbox. All network & Steam operations route through window.ipcRenderer.
 * - Save Game Isolation Guarantee: Never overwrites client singleplayer saves.
 * - Reentrancy & Echo Prevention: All remote actions executed with isApplyingRemote = true.
 */
${getLoaderHeader()}
${modulesCode}

const __mpBundle = __createScopedRequire("")("./index");

const METADATA = __mpBundle.METADATA;
const PLAYER_COLORS = __mpBundle.PLAYER_COLORS;
const escapeHtml = __mpBundle.escapeHtml;
const encodeJoinCode = __mpBundle.encodeJoinCode;
const decodeJoinCode = __mpBundle.decodeJoinCode;
const HUDMultiplayer = __mpBundle.HUDMultiplayer;
const Mod = __mpBundle.Mod;

if (typeof module !== "undefined" && module.exports) {
    module.exports = __mpBundle;
}
`;

    // Verify syntax
    new vm.Script(bundleContent);
    fs.writeFileSync(TARGET_MOD_FILE, bundleContent, "utf8");
    console.log(`   [OK] Generated ${TARGET_MOD_FILE} (${(bundleContent.length / 1024).toFixed(1)} KB)`);
}

function main() {
    console.log("=== Building shapez.io Co-op Mod Distribution Bundles ===");
    if (!fs.existsSync(DIST_DIR)) {
        fs.mkdirSync(DIST_DIR, { recursive: true });
    }
    buildBridgeBundle();
    buildMultiplayerBundle();
    console.log("=== Build completed successfully! ===\n");
}

if (require.main === module) {
    main();
}

module.exports = {
    discoverModules,
    buildBridgeBundle,
    buildMultiplayerBundle,
    main,
};
