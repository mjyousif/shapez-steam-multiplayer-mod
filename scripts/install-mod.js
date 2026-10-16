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
const PATCHES_DIR = path.join(WORKSPACE_ROOT, "src", "asar-patches");
const SOURCE_MOD_FILE = path.join(WORKSPACE_ROOT, "src", "steam_multiplayer.js");

function computeIntegrity(buffer) {
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    return {
        algorithm: "SHA256",
        hash,
        blockSize: 4194304,
        blocks: [hash],
    };
}

function patchAsarArchive(sourceAsarPath, targetAsarPath, replacements) {
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

    let currentEndOffset = originalPayload.length;
    const appendedBuffers = [];

    for (const [fileName, fileBuffer] of Object.entries(replacements)) {
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
    console.log("[2/3] Patching index.js, steam.js, and preload.js inside app.asar...");
    const replacements = {
        "index.js": fs.readFileSync(path.join(PATCHES_DIR, "index.js")),
        "steam.js": fs.readFileSync(path.join(PATCHES_DIR, "steam.js")),
        "preload.js": fs.readFileSync(path.join(PATCHES_DIR, "preload.js")),
    };
    patchAsarArchive(BACKUP_ASAR_PATH, ASAR_PATH, replacements);
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
    ASAR_PATH,
    BACKUP_ASAR_PATH,
    TARGET_MOD_FILE,
};
