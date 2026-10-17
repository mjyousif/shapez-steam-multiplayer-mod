const fs = require("fs");
const { ASAR_PATH, BACKUP_ASAR_PATH, TARGET_MOD_FILE, TARGET_P2P_NODE } = require("./install-mod");

function main() {
    console.log("=== shapez.io Steam Co-op Multiplayer Uninstaller ===");

    if (fs.existsSync(BACKUP_ASAR_PATH)) {
        console.log("[1/3] Restoring vanilla app.asar from backup...");
        fs.copyFileSync(BACKUP_ASAR_PATH, ASAR_PATH);
        console.log("      Restored:", ASAR_PATH);
    } else {
        console.log("[1/3] No app.asar.vanilla.bak found; skipping archive restore.");
    }

    if (TARGET_P2P_NODE && fs.existsSync(TARGET_P2P_NODE)) {
        console.log("[2/3] Removing steam_p2p_win64.node...");
        try {
            fs.unlinkSync(TARGET_P2P_NODE);
            console.log("      Removed:", TARGET_P2P_NODE);
        } catch {}
    } else {
        console.log("[2/3] Native P2P bridge already removed.");
    }

    if (fs.existsSync(TARGET_MOD_FILE)) {
        console.log("[3/3] Removing steam_multiplayer.js from mods folder...");
        fs.unlinkSync(TARGET_MOD_FILE);
        console.log("      Removed:", TARGET_MOD_FILE);
    } else {
        console.log("[3/3] Mod file already removed.");
    }

    console.log("\nUninstall complete! shapez.io is back to 100% vanilla.");
}

if (require.main === module) {
    main();
}
