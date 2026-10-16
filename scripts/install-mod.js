const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const GAME_RESOURCES_DIR = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\shapez.io\\resources";
const ASAR_PATH = path.join(GAME_RESOURCES_DIR, "app.asar");
const BACKUP_ASAR_PATH = path.join(GAME_RESOURCES_DIR, "app.asar.vanilla.bak");

const ROAMING_DIR =
    process.env.APPDATA ||
    (process.platform === "darwin"
        ? path.join(process.env.HOME, "Library", "Preferences")
        : path.join(process.env.HOME, ".local", "share"));
const MODS_DIR = path.join(ROAMING_DIR, "shapez.io", "mods");
const TARGET_MOD_FILE = path.join(MODS_DIR, "steam_multiplayer.js");

const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(WORKSPACE_ROOT, "src");
const SOURCE_MOD_FILE = path.join(SRC_DIR, "steam_multiplayer.js");
const SOURCE_BRIDGE_FILE = path.join(SRC_DIR, "steam_bridge.js");

function computeIntegrity(buffer) {
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    return {
        algorithm: "SHA256",
        hash,
        blockSize: 4194304,
        blocks: [hash],
    };
}

function readAsarFile(rawAsar, headerObj, headerSize, fileName) {
    const files = headerObj.files;
    if (!files || !files[fileName]) return null;
    const entry = files[fileName];
    const payloadOffset = 8 + headerSize;
    const start = payloadOffset + Number(entry.offset);
    return rawAsar.subarray(start, start + entry.size);
}

function patchIndexJs(src) {
    let out = src;
    if (!out.includes("allowMultiInstance")) {
        out = out.replace(
            /const\s+externalMod\s*=\s*app\.commandLine\.getSwitchValue\("load-mod"\);/,
            `const allowMultiInstance = app.commandLine.hasSwitch("multi-instance");\nconst externalMod = app.commandLine.getSwitchValue("load-mod");\nconst instanceId = app.commandLine.getSwitchValue("instance-id") || (allowMultiInstance ? String(process.pid) : "");`
        );
        out = out.replace(
            /let\s+storePath\s*=\s*path\.join\(roamingFolder,\s*"shapez\.io",\s*"saves"\);/,
            `if (allowMultiInstance && instanceId) {\n    const customUserData = path.join(roamingFolder, "shapez.io", "instances", "instance-" + instanceId);\n    fs.mkdirSync(customUserData, { recursive: true });\n    app.setPath("userData", customUserData);\n}\n\nlet storePath =\n    allowMultiInstance && instanceId\n        ? path.join(roamingFolder, "shapez.io", "saves-" + instanceId)\n        : path.join(roamingFolder, "shapez.io", "saves");`
        );
        out = out.replace(
            /title:\s*"shapez",/,
            `title: allowMultiInstance ? "shapez (Co-op Instance)" : "shapez",`
        );
        out = out.replace(
            /mainWindowState\.manage\(win\);/,
            `steam.setMainWindow(win);\n\n    if (!allowMultiInstance) {\n        mainWindowState.manage(win);\n    } else {\n        const instTitle = "shapez (Co-op Instance" + (instanceId ? " " + instanceId : "") + ")";\n        win.setTitle(instTitle);\n        win.on("page-title-updated", (ev) => { ev.preventDefault(); win.setTitle(instTitle); });\n    }`
        );
        out = out.replace(
            /win\.on\("closed",\s*\(\)\s*=>\s*\{[\r\n\s]*console\.log\("Window closed"\);[\r\n\s]*win\s*=\s*null;[\r\n\s]*\}\);/,
            `win.on("closed", () => {\n        console.log("Window closed");\n        steam.setMainWindow(null);\n        win = null;\n    });`
        );
        out = out.replace(
            /if\s*\(!app\.requestSingleInstanceLock\(\)\)\s*\{[\r\n\s]*app\.exit\(0\);[\r\n\s]*\}\s*else\s*\{/,
            `if (!allowMultiInstance && !app.requestSingleInstanceLock()) {\n    app.exit(0);\n} else if (!allowMultiInstance) {`
        );
    }

    out = out.replace(
        /steam\.init\(isDev\);[\s\S]*?if\s*\(mods\.length\s*===\s*0\)\s*\{\s*steam\.listen\(\);\s*\}/,
        `steam.init(isDev, allowMultiInstance);\nsteam.listen();`
    );

    return out;
}

function patchPreloadJs(src) {
    let out = src;
    if (!out.includes("removeListener")) {
        out = out.replace(
            /on:\s*ipcRenderer\.on\.bind\(ipcRenderer\),?/,
            `on: (channel, listener) => {\n        const wrapped = (event, ...args) => listener(event, ...args);\n        ipcRenderer.on(channel, wrapped);\n        return () => ipcRenderer.removeListener(channel, wrapped);\n    },`
        );
    }
    return out;
}

function patchSteamJs(src) {
    let out = src;
    if (!out.includes("steam_bridge")) {
        out += `\n// Hook shapez-steam-multiplayer-mod bridge\ntry {\n    const _steamBridge = require("./steam_bridge");\n    module.exports = _steamBridge;\n} catch (err) {\n    console.warn("Failed to load steam_bridge:", err);\n}\n`;
    }
    return out;
}

function patchAsarArchive(sourceAsarPath, targetAsarPath, replacements = null) {
    const rawAsar = fs.readFileSync(sourceAsarPath);

    const picklePayloadSize = rawAsar.readUInt32LE(0);
    if (picklePayloadSize !== 4) {
        throw new Error("Invalid ASAR header (expected outer pickle size 4, got " + picklePayloadSize + ")");
    }
    const headerSize = rawAsar.readUInt32LE(4);
    const jsonByteLength = rawAsar.readUInt32LE(12);
    const payloadOffset = 8 + headerSize;

    const headerJsonStr = rawAsar.subarray(16, 16 + jsonByteLength).toString("utf8");
    const headerObj = JSON.parse(headerJsonStr);
    const originalPayload = rawAsar.subarray(payloadOffset);

    // If specific replacements were passed (e.g. in unit tests), use them directly.
    // Otherwise, dynamically patch user's local files and add steam_bridge.js.
    let finalReplacements = replacements;
    if (!finalReplacements) {
        const rawIndex = readAsarFile(rawAsar, headerObj, headerSize, "index.js");
        const rawPreload = readAsarFile(rawAsar, headerObj, headerSize, "preload.js");
        const rawSteam = readAsarFile(rawAsar, headerObj, headerSize, "steam.js");

        if (!rawIndex || !rawPreload || !rawSteam) {
            throw new Error("Expected index.js, preload.js, and steam.js in source ASAR archive.");
        }

        const patchedIndex = patchIndexJs(rawIndex.toString("utf8"));
        const patchedPreload = patchPreloadJs(rawPreload.toString("utf8"));
        const patchedSteam = patchSteamJs(rawSteam.toString("utf8"));
        const bridgeBuffer = fs.readFileSync(SOURCE_BRIDGE_FILE);

        finalReplacements = {
            "index.js": Buffer.from(patchedIndex, "utf8"),
            "preload.js": Buffer.from(patchedPreload, "utf8"),
            "steam.js": Buffer.from(patchedSteam, "utf8"),
            "steam_bridge.js": bridgeBuffer,
        };
    }

    let currentEndOffset = originalPayload.length;
    const appendedBuffers = [];

    for (const [fileName, fileBuffer] of Object.entries(finalReplacements)) {
        headerObj.files[fileName] = {
            size: fileBuffer.length,
            offset: String(currentEndOffset),
            integrity: computeIntegrity(fileBuffer),
        };
        appendedBuffers.push(fileBuffer);
        currentEndOffset += fileBuffer.length;
    }

    const newHeaderJsonBuf = Buffer.from(JSON.stringify(headerObj), "utf8");
    const newJsonLen = newHeaderJsonBuf.length;
    // Align (4 + newJsonLen) to 4-byte boundary
    const innerPickleSize = Math.ceil((4 + newJsonLen) / 4) * 4;
    const newHeaderSize = innerPickleSize + 4;

    const newHeaderPrefix = Buffer.alloc(8 + newHeaderSize, 0);
    newHeaderPrefix.writeUInt32LE(4, 0);
    newHeaderPrefix.writeUInt32LE(newHeaderSize, 4);
    newHeaderPrefix.writeUInt32LE(innerPickleSize, 8);
    newHeaderPrefix.writeUInt32LE(newJsonLen, 12);
    newHeaderJsonBuf.copy(newHeaderPrefix, 16);

    const finalAsar = Buffer.concat([newHeaderPrefix, originalPayload, ...appendedBuffers]);
    fs.writeFileSync(targetAsarPath, finalAsar);
}

function main() {
    console.log("=== shapez.io Steam Co-op Multiplayer Mod Installer ===");

    if (!fs.existsSync(ASAR_PATH)) {
        throw new Error("Could not find shapez.io app.asar at: " + ASAR_PATH);
    }

    // 1. Create vanilla backup if it doesn't already exist
    if (!fs.existsSync(BACKUP_ASAR_PATH)) {
        console.log("[1/3] Creating vanilla backup at:", BACKUP_ASAR_PATH);
        fs.copyFileSync(ASAR_PATH, BACKUP_ASAR_PATH);
    } else {
        console.log("[1/3] Using existing vanilla backup at:", BACKUP_ASAR_PATH);
    }

    // 2. Patch app.asar from clean vanilla backup
    console.log("[2/3] Dynamically patching index.js, steam.js, and preload.js inside app.asar...");
    patchAsarArchive(BACKUP_ASAR_PATH, ASAR_PATH);
    console.log("      Successfully updated:", ASAR_PATH);

    // 3. Install steam_multiplayer.js into %APPDATA%\shapez.io\mods
    console.log("[3/3] Installing mod to:", TARGET_MOD_FILE);
    fs.mkdirSync(MODS_DIR, { recursive: true });
    fs.copyFileSync(SOURCE_MOD_FILE, TARGET_MOD_FILE);

    console.log("\nInstallation complete!");
    console.log(" - Patched Steam/IPC Bridge in:", ASAR_PATH);
    console.log(" - Installed Co-op Mod in:     ", TARGET_MOD_FILE);
    console.log(" - Vanilla Backup saved at:    ", BACKUP_ASAR_PATH);
}

if (require.main === module) {
    main();
}

module.exports = {
    patchAsarArchive,
    patchIndexJs,
    patchPreloadJs,
    patchSteamJs,
    readAsarFile,
    ASAR_PATH,
    BACKUP_ASAR_PATH,
    TARGET_MOD_FILE,
};
