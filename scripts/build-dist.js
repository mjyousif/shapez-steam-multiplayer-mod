const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const SRC_DIR = path.join(ROOT_DIR, "src");
const BRIDGE_FILE = path.join(DIST_DIR, "steam_bridge.js");
const MOD_FILE = path.join(DIST_DIR, "steam_multiplayer.js");
const BIN_DIR = path.join(ROOT_DIR, "bin");
const P2P_NODE_FILE = path.join(BIN_DIR, "steam_p2p_win64.node");

function findCsc() {
    const candidates = [
        "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
        "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    // Fallback to csc on PATH
    try {
        execSync("where csc", { stdio: "ignore" });
        return "csc";
    } catch {
        throw new Error("Could not find csc.exe (.NET Framework C# compiler).");
    }
}

function main() {
    console.log("=== Building shapez.io Co-op Multiplayer Distribution Package ===");

    // Always assemble the latest distribution bundles from modular source units
    require("./build-bundle").main();

    if (!fs.existsSync(P2P_NODE_FILE)) {
        require("./build-native-p2p");
    }

    if (!fs.existsSync(DIST_DIR)) {
        fs.mkdirSync(DIST_DIR, { recursive: true });
    }

    const cscPath = findCsc();
    console.log("Using C# Compiler:", cscPath);

    const installerCs = path.join(SRC_DIR, "installer", "Program.cs");
    const outputExe = path.join(DIST_DIR, "ShapezCoopInstaller.exe");

    const resources = [
        `"/resource:${BRIDGE_FILE},steam_bridge.js"`,
        `"/resource:${MOD_FILE},steam_multiplayer.js"`,
        `"/resource:${P2P_NODE_FILE},steam_p2p_win64.node"`,
    ];

    const refs = [
        "/r:System.Drawing.dll",
        "/r:System.Windows.Forms.dll",
        "/r:System.Web.Extensions.dll",
        "/r:System.IO.Compression.dll",
        "/r:System.IO.Compression.FileSystem.dll",
    ];

    try {
        execSync("taskkill /F /IM ShapezCoopInstaller.exe", { stdio: "ignore" });
    } catch {}

    const cmd = `"${cscPath}" /target:winexe /optimize+ /out:"${outputExe}" ${refs.join(" ")} ${resources.join(" ")} "${installerCs}"`;

    console.log("Compiling standalone GUI & CLI installer...");
    execSync(cmd, { stdio: "inherit" });

    const exeStat = fs.statSync(outputExe);
    console.log(`Successfully compiled: ${outputExe} (${(exeStat.size / 1024).toFixed(1)} KB)`);

    // 2. Generate Install-Mod.bat
    const installBat = `@echo off
cd /d "%~dp0"
title shapez.io Steam Co-op Mod Installer
echo ========================================================
echo    shapez.io Steam Co-op Multiplayer Mod Installer
echo ========================================================
echo.
ShapezCoopInstaller.exe --silent
if %ERRORLEVEL% equ 0 (
    echo.
    echo [SUCCESS] Mod installed successfully!
    echo You can now launch shapez.io from Steam and invite friends.
) else (
    echo.
    echo [NOTE] Silent install requested manual input. Opening GUI...
    start "" ShapezCoopInstaller.exe
)
echo.
pause
`;
    fs.writeFileSync(path.join(DIST_DIR, "Install-Mod.bat"), installBat, "utf8");

    // 3. Generate Uninstall-Mod.bat
    const uninstallBat = `@echo off
cd /d "%~dp0"
title shapez.io Steam Co-op Mod Uninstaller
echo ========================================================
echo    shapez.io Steam Co-op Mod Uninstaller
echo ========================================================
echo.
ShapezCoopInstaller.exe --silent --uninstall
echo.
echo [DONE] Restored shapez.io to 100%% vanilla.
echo.
pause
`;
    fs.writeFileSync(path.join(DIST_DIR, "Uninstall-Mod.bat"), uninstallBat, "utf8");

    const pkg = require(path.join(ROOT_DIR, "package.json"));

    // 4. Generate HOW-TO-INSTALL.txt
    const readmeTxt = `========================================================================
             shapez.io — Steam Co-op Multiplayer Mod (v${pkg.version})
========================================================================

HOW TO INSTALL (Takes 5 seconds):
------------------------------------------------------------------------
Method 1 (Recommended):
  1. Double-click "ShapezCoopInstaller.exe"
  2. Click the blue "Install Mod" button.
  3. That's it! Launch shapez.io from Steam.

Method 2 (One-click Batch):
  - Just double-click "Install-Mod.bat" and press Enter when done.

------------------------------------------------------------------------
HOW TO PLAY CO-OP TOGETHER:
------------------------------------------------------------------------
1. Launch shapez.io from Steam.
2. Click "Steam Multiplayer" at the top of the main menu.
3. Choose either:
   - "Host Co-op Factory": Start a new world or host an existing save.
     Then click "Invite Friends" to invite via Steam Overlay or Friends list,
     or click "Copy Code" to share your session code.
   - "Join Game": If your friend is already hosting, their name will appear
     in your Steam Friends list on the right—just click "Join Game" next
     to their name, or accept the green in-game invite notification!

------------------------------------------------------------------------
SAVE GAMES & BACKUPS:
------------------------------------------------------------------------
- Your shapez save games are 100% SAFE: neither installing nor uninstalling
  ever touches or deletes your save files.
- To create a timestamped backup archive of your saves at any time:
  - Click "Backup Saves (.zip)" in ShapezCoopInstaller.exe, OR
  - Run "ShapezCoopInstaller.exe --backup"
  Backups are saved to %APPDATA%\\shapez.io\\backups\\.

------------------------------------------------------------------------
HOW TO UNINSTALL / RESTORE VANILLA:
------------------------------------------------------------------------
- Run "ShapezCoopInstaller.exe" and click "Restore Vanilla", OR
- Double-click "Uninstall-Mod.bat".
Your original unmodded game files are 100% restored.
========================================================================
`;
    fs.writeFileSync(path.join(DIST_DIR, "HOW-TO-INSTALL.txt"), readmeTxt, "utf8");

    // 5. Create distribution zip
    const zipName = `shapez-steam-coop-mod-v${pkg.version}.zip`;
    const zipPath = path.join(DIST_DIR, zipName);
    if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
    }

    console.log("Packaging distribution zip archive...");
    const psScript = `Compress-Archive -Path '${path.join(DIST_DIR, "ShapezCoopInstaller.exe")}','${path.join(DIST_DIR, "Install-Mod.bat")}','${path.join(DIST_DIR, "Uninstall-Mod.bat")}','${path.join(DIST_DIR, "HOW-TO-INSTALL.txt")}' -DestinationPath '${zipPath}' -Force`;
    execSync(`powershell -NoProfile -Command "${psScript}"`, { stdio: "inherit" });

    const zipStat = fs.statSync(zipPath);

    // 6. Generate SHA256SUMS.txt
    const crypto = require("crypto");
    const filesToHash = ["ShapezCoopInstaller.exe", zipName];
    const checksumLines = filesToHash.map(file => {
        const filePath = path.join(DIST_DIR, file);
        const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
        return `${hash}  ${file}`;
    });
    const checksumPath = path.join(DIST_DIR, "SHA256SUMS.txt");
    fs.writeFileSync(checksumPath, checksumLines.join("\n") + "\n", "utf8");

    console.log(`\n========================================================`);
    console.log(`Distribution package ready!`);
    console.log(` Zip archive: ${zipPath} (${(zipStat.size / 1024).toFixed(1)} KB)`);
    console.log(` Installer:   ${outputExe} (${(exeStat.size / 1024).toFixed(1)} KB)`);
    console.log(` Checksums:   ${checksumPath}`);
    console.log(`========================================================\n`);
}

if (require.main === module) {
    main();
}

module.exports = { main };
