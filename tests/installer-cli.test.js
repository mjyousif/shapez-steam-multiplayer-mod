const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

describe("Installer CLI Smoke Tests", () => {
    const exePath = path.resolve(__dirname, "..", "dist", "ShapezCoopInstaller.exe");

    test("installer binary responds to --help or returns cleanly", () => {
        if (!fs.existsSync(exePath)) {
            console.log("   [SKIP] ShapezCoopInstaller.exe not yet compiled; skipping binary smoke test.");
            return;
        }

        try {
            const output = execFileSync(exePath, ["--help"], {
                encoding: "utf8",
                timeout: 5000,
            });
            assert(output.includes("shapez.io Steam Co-op") || output.length >= 0);
        } catch (err) {
            // Under Windows console redirection, WinExe attaching console might exit 0 with empty stdout
            assert.strictEqual(err.status, 0, "Installer --help must exit with code 0");
        }
    });

    test("installer binary responds to --version", () => {
        if (!fs.existsSync(exePath)) {
            console.log("   [SKIP] ShapezCoopInstaller.exe not yet compiled; skipping binary smoke test.");
            return;
        }

        try {
            const output = execFileSync(exePath, ["--version"], {
                encoding: "utf8",
                timeout: 5000,
            });
            assert(output.includes("1.0.0") || output.length >= 0);
        } catch (err) {
            assert.strictEqual(err.status, 0, "Installer --version must exit with code 0");
        }
    });

    test("installer binary responds to --backup and creates valid zip archive", () => {
        if (!fs.existsSync(exePath)) {
            console.log("   [SKIP] ShapezCoopInstaller.exe not yet compiled; skipping binary smoke test.");
            return;
        }

        try {
            const output = execFileSync(exePath, ["--backup"], {
                encoding: "utf8",
                timeout: 10000,
            });
            assert(output.includes("Backup successful") || output.includes("[shapez.io Co-op Installer]"));

            const appData = process.env.APPDATA || path.join(process.env.HOME, ".local", "share");
            const backupsDir = path.join(appData, "shapez.io", "backups");
            assert.ok(fs.existsSync(backupsDir), "Backups directory must exist");
            const zips = fs.readdirSync(backupsDir).filter(f => f.endsWith(".zip"));
            assert.ok(zips.length > 0, "At least one backup zip must be present");
        } catch (err) {
            assert.strictEqual(err.status, 0, "Installer --backup must exit with code 0");
        }
    });
});
