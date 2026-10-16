const fs = require("fs");
const { ASAR_PATH, BACKUP_ASAR_PATH, TARGET_MOD_FILE } = require("./install-mod");

function main() {
    console.log("=== shapez.io Steam Co-op Multiplayer Uninstaller ===");

    if (fs.existsSync(BACKUP_ASAR_PATH)) {
        console.log("[1/2] Restoring vanilla app.asar from backup...");
        fs.copyFileSync(BACKUP_ASAR_PATH, ASAR_PATH);
        console.log("      Restored:", ASAR_PATH);
    } else {
        console.log("[1/2] No app.asar.vanilla.bak found; skipping archive restore.");
    }

    if (fs.existsSync(TARGET_MOD_FILE)) {
        console.log("[2/2] Removing steam_multiplayer.js from mods folder...");
        fs.unlinkSync(TARGET_MOD_FILE);
        console.log("      Removed:", TARGET_MOD_FILE);
    } else {
        console.log("[2/2] Mod file already removed.");
    }

    console.log("\nUninstall complete! shapez.io is back to 100% vanilla.");
}

if (require.main === module) {
    main();
}
