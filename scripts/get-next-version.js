const { execSync } = require("child_process");
const fs = require("fs");

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

const { tag, name } = getNextVersion();
console.log(`Target Release Tag:  ${tag}`);
console.log(`Target Release Name: ${name}`);

if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `RELEASE_TAG=${tag}\nRELEASE_NAME=${name}\n`);
}

module.exports = { getNextVersion };
