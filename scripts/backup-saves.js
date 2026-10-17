const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function getRoamingDir() {
    if (process.env.APPDATA) return process.env.APPDATA;
    if (process.platform === "darwin") {
        return path.join(process.env.HOME, "Library", "Application Support");
    }
    return process.env.XDG_DATA_HOME || path.join(process.env.HOME, ".local", "share");
}

function backupSaves() {
    console.log("=== shapez.io Save Games Backup Utility ===");

    const shapezDir = path.join(getRoamingDir(), "shapez.io");
    const savesDir = path.join(shapezDir, "saves");
    const backupsDir = path.join(shapezDir, "backups");

    if (!fs.existsSync(savesDir)) {
        console.warn(`[WARN] Saves directory not found at: ${savesDir}`);
        console.warn("No save files have been created by shapez.io yet.");
        return null;
    }

    const files = fs.readdirSync(savesDir).filter(f => !fs.statSync(path.join(savesDir, f)).isDirectory());
    if (files.length === 0) {
        console.warn(`[WARN] No save files found in: ${savesDir}`);
        return null;
    }

    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }

    const pad = n => String(n).padStart(2, "0");
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const zipName = `shapez-saves-backup-${timestamp}.zip`;
    const targetZip = path.join(backupsDir, zipName);

    console.log(`Source folder: ${savesDir} (${files.length} files)`);
    console.log(`Target archive: ${targetZip}`);

    if (process.platform === "win32") {
        const psCmd = `Compress-Archive -Path '${path.join(savesDir, "*")}' -DestinationPath '${targetZip}' -Force`;
        execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: "inherit" });
    } else {
        execSync(`cd "${savesDir}" && zip -r "${targetZip}" .`, { stdio: "inherit" });
    }

    const stat = fs.statSync(targetZip);
    console.log(`\n[SUCCESS] Backup archive created successfully! (${(stat.size / 1024).toFixed(1)} KB)`);
    console.log(`Location: ${targetZip}\n`);

    return targetZip;
}

if (require.main === module) {
    backupSaves();
}

module.exports = { backupSaves, getRoamingDir };
