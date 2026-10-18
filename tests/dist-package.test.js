const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

describe("Distribution Package and Artifact Integrity", () => {
    const distDir = path.resolve(__dirname, "..", "dist");

    test("dist directory contains compiled installer with valid Windows PE executable header", () => {
        const exePath = path.join(distDir, "ShapezCoopInstaller.exe");
        if (!fs.existsSync(exePath)) {
            console.log("   [SKIP] ShapezCoopInstaller.exe not built yet.");
            return;
        }

        const stat = fs.statSync(exePath);
        assert.ok(stat.size > 50000, `Installer binary too small (${stat.size} bytes)`);

        const buf = Buffer.alloc(2);
        const fd = fs.openSync(exePath, "r");
        try {
            fs.readSync(fd, buf, 0, 2, 0);
            // DOS MZ Header 'MZ' (0x4D, 0x5A)
            assert.strictEqual(buf.toString("ascii"), "MZ", "Binary must have valid PE 'MZ' magic header");
        } finally {
            fs.closeSync(fd);
        }
    });

    test("dist directory contains distribution zip archive with valid PKZIP header", () => {
        const zipFiles = fs.existsSync(distDir)
            ? fs.readdirSync(distDir).filter(f => f.startsWith("shapez-steam-coop-mod-") && f.endsWith(".zip"))
            : [];
        const zipPath = zipFiles.length > 0 ? path.join(distDir, zipFiles[0]) : null;
        if (!zipPath || !fs.existsSync(zipPath)) {
            console.log("   [SKIP] Release zip archive not built yet.");
            return;
        }

        const stat = fs.statSync(zipPath);
        assert.ok(stat.size > 20000, `Zip archive too small (${stat.size} bytes)`);

        const buf = Buffer.alloc(4);
        const fd = fs.openSync(zipPath, "r");
        try {
            fs.readSync(fd, buf, 0, 4, 0);
            // PKZIP Magic 'PK\x03\x04'
            assert.strictEqual(buf.readUInt32BE(0), 0x504b0304, "Archive must have valid PKZIP magic header");
        } finally {
            fs.closeSync(fd);
        }
    });

    test("SHA256SUMS.txt matches actual disk hashes byte-for-byte", () => {
        const checksumFile = path.join(distDir, "SHA256SUMS.txt");
        if (!fs.existsSync(checksumFile)) {
            console.log("   [SKIP] SHA256SUMS.txt not present.");
            return;
        }

        const content = fs.readFileSync(checksumFile, "utf8");
        const lines = content.trim().split(/\r?\n/).filter(Boolean);
        assert.ok(lines.length >= 2, "SHA256SUMS.txt must contain at least 2 entries");

        for (const line of lines) {
            const parts = line.split(/\s+/);
            assert.strictEqual(parts.length, 2, `Malformed line in SHA256SUMS.txt: ${line}`);
            const [expectedHash, fileName] = parts;
            const targetPath = path.join(distDir, fileName);

            assert.ok(fs.existsSync(targetPath), `Referenced file missing: ${fileName}`);
            const actualHash = crypto
                .createHash("sha256")
                .update(fs.readFileSync(targetPath))
                .digest("hex");
            assert.strictEqual(
                actualHash,
                expectedHash,
                `Checksum mismatch for ${fileName}: expected ${expectedHash}, got ${actualHash}`
            );
        }
    });

    test("helper batch scripts and documentation exist with valid syntax", () => {
        const installBat = path.join(distDir, "Install-Mod.bat");
        const uninstallBat = path.join(distDir, "Uninstall-Mod.bat");
        const readme = path.join(distDir, "HOW-TO-INSTALL.txt");

        if (!fs.existsSync(installBat) || !fs.existsSync(uninstallBat)) {
            console.log("   [SKIP] Batch files not present.");
            return;
        }

        const installContent = fs.readFileSync(installBat, "utf8");
        const uninstallContent = fs.readFileSync(uninstallBat, "utf8");
        const readmeContent = fs.readFileSync(readme, "utf8");

        assert.ok(installContent.includes("ShapezCoopInstaller.exe --silent"));
        assert.ok(uninstallContent.includes("ShapezCoopInstaller.exe --silent --uninstall"));
        assert.ok(readmeContent.includes("Steam Co-op Multiplayer Mod"));
    });
});
