const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function getNextVersion() {
    const ref = process.env.GITHUB_REF || "";
    const refName = process.env.GITHUB_REF_NAME || "";

    // If triggered by a manual tag push (e.g. v2.0.0), use that tag directly
    if (ref.startsWith("refs/tags/v") && refName) {
        return {
            tag: refName,
            name: `shapez Steam Co-op Mod ${refName}`,
        };
    }

    try {
        const rawTags = execSync('git tag -l "v*.*.*"', { encoding: "utf8" })
            .trim()
            .split("\n")
            .map(t => t.trim())
            .filter(Boolean);

        const semvers = rawTags
            .map(t => {
                const m = t.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
                return m ? { tag: t, major: +m[1], minor: +m[2], patch: +m[3] } : null;
            })
            .filter(Boolean)
            .sort((a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch);

        if (semvers.length > 0) {
            const latest = semvers[semvers.length - 1];
            const nextTag = `v${latest.major}.${latest.minor}.${latest.patch + 1}`;
            return {
                tag: nextTag,
                name: `shapez Steam Co-op Mod ${nextTag}`,
            };
        }
    } catch (err) {
        console.warn("Could not query git tags:", err.message);
    }

    // Fallback default
    return {
        tag: "v1.0.3",
        name: "shapez Steam Co-op Mod v1.0.3",
    };
}

function syncVersionToFiles(rawVersion) {
    const cleanVer = String(rawVersion).replace(/^v/i, "").trim();
    const rootDir = path.resolve(__dirname, "..");

    // 1. package.json
    const pkgPath = path.join(rootDir, "package.json");
    if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        pkg.version = cleanVer;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + "\n", "utf8");
        console.log(`[Version Sync] Synchronized package.json -> v${cleanVer}`);
    }

    // 2. src/multiplayer/constants.js
    const constantsPath = path.join(rootDir, "src", "multiplayer", "constants.js");
    if (fs.existsSync(constantsPath)) {
        let content = fs.readFileSync(constantsPath, "utf8");
        content = content.replace(/version:\s*["'][^"']+["']/, `version: "${cleanVer}"`);
        fs.writeFileSync(constantsPath, content, "utf8");
        console.log(`[Version Sync] Synchronized src/multiplayer/constants.js -> v${cleanVer}`);
    }

    // 3. src/installer/Program.cs (fallback return value in GetEmbeddedModVersion)
    const installerPath = path.join(rootDir, "src", "installer", "Program.cs");
    if (fs.existsSync(installerPath)) {
        let content = fs.readFileSync(installerPath, "utf8");
        content = content.replace(/(catch\s*\{\s*\}\s*return\s*")[^"]+(";)/, `$1${cleanVer}$2`);
        fs.writeFileSync(installerPath, content, "utf8");
        console.log(`[Version Sync] Synchronized src/installer/Program.cs fallback -> v${cleanVer}`);
    }
}

if (require.main === module) {
    const { tag, name } = getNextVersion();
    console.log(`Target Release Tag:  ${tag}`);
    console.log(`Target Release Name: ${name}`);

    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `RELEASE_TAG=${tag}\nRELEASE_NAME=${name}\n`);
    }

    const shouldApply = process.argv.includes("--apply") || Boolean(process.env.GITHUB_OUTPUT);
    if (shouldApply) {
        syncVersionToFiles(tag);
    }
}

module.exports = { getNextVersion, syncVersionToFiles };

