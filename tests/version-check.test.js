const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Mod } = require("../src/multiplayer/mod");
const { METADATA } = require("../src/multiplayer/constants");
const { getNextVersion, syncVersionToFiles } = require("../scripts/get-next-version");

describe("Version Comparison & Synchronization Integrity", () => {
    const modInstance = new Mod();

    test("compareVersions correctly identifies identical versions", () => {
        assert.strictEqual(modInstance.compareVersions("1.0.12", "1.0.12"), 0);
        assert.strictEqual(modInstance.compareVersions("v1.0.12", "1.0.12"), 0);
        assert.strictEqual(modInstance.compareVersions("1.0.12", "v1.0.12"), 0);
        assert.strictEqual(modInstance.compareVersions("v1.0.12", "v1.0.12"), 0);
    });

    test("compareVersions correctly identifies newer releases", () => {
        // The exact scenario from the bug: v1.0.11 released vs v1.0.2 installed
        assert.strictEqual(modInstance.compareVersions("1.0.11", "1.0.2"), 1);
        assert.strictEqual(modInstance.compareVersions("v1.0.11", "v1.0.2"), 1);
        assert.strictEqual(modInstance.compareVersions("1.0.12", "1.0.11"), 1);
        assert.strictEqual(modInstance.compareVersions("1.1.0", "1.0.99"), 1);
        assert.strictEqual(modInstance.compareVersions("2.0.0", "1.99.99"), 1);
    });

    test("compareVersions correctly identifies older releases", () => {
        assert.strictEqual(modInstance.compareVersions("1.0.2", "1.0.11"), -1);
        assert.strictEqual(modInstance.compareVersions("v1.0.2", "v1.0.11"), -1);
        assert.strictEqual(modInstance.compareVersions("1.0.11", "1.0.12"), -1);
        assert.strictEqual(modInstance.compareVersions("1.0.99", "1.1.0"), -1);
    });

    test("compareVersions handles pre-release suffixes and whitespace", () => {
        assert.strictEqual(modInstance.compareVersions(" 1.0.12 ", "1.0.12"), 0);
        assert.strictEqual(modInstance.compareVersions("1.0.12-beta", "1.0.11"), 1);
        assert.strictEqual(modInstance.compareVersions("1.0.11", "1.0.12-beta"), -1);
        assert.strictEqual(modInstance.compareVersions(null, "1.0.0"), -1);
        assert.strictEqual(modInstance.compareVersions("1.0.0", null), 1);
        assert.strictEqual(modInstance.compareVersions(null, null), 0);
    });

    test("repository version files are strictly synchronized", () => {
        const pkg = require("../package.json");
        assert.ok(pkg.version, "package.json must define a version");

        // METADATA.version in src/multiplayer/constants.js
        assert.strictEqual(
            METADATA.version,
            pkg.version,
            "src/multiplayer/constants.js version must match package.json"
        );

        // Fallback version in src/installer/Program.cs
        const csContent = fs.readFileSync(
            path.resolve(__dirname, "..", "src", "installer", "Program.cs"),
            "utf8"
        );
        const csMatch = csContent.match(/catch\s*\{\s*\}\s*return\s*"([^"]+)";/);
        assert.ok(csMatch, "Program.cs must contain a return fallback in GetEmbeddedModVersion");
        assert.strictEqual(
            csMatch[1],
            pkg.version,
            "Program.cs fallback version must match package.json"
        );
    });

    test("getNextVersion calculates valid semantic release metadata", () => {
        const result = getNextVersion();
        assert.ok(result.tag.startsWith("v"), "Release tag must start with 'v'");
        assert.ok(result.name.includes(result.tag), "Release name must contain tag");
        assert.match(result.tag, /^v\d+\.\d+\.\d+$/, "Release tag must be valid semver");
    });
});
