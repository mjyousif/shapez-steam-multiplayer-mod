const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { patchAsarArchive } = require("../scripts/install-mod");

function createMockAsar(filesMap) {
    const headerObj = { files: {} };
    const payloadBuffers = [];
    let currentOffset = 0;

    for (const [name, content] of Object.entries(filesMap)) {
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
        const hash = crypto.createHash("sha256").update(buf).digest("hex");
        headerObj.files[name] = {
            size: buf.length,
            offset: String(currentOffset),
            integrity: {
                algorithm: "SHA256",
                hash,
                blockSize: 4194304,
                blocks: [hash],
            },
        };
        payloadBuffers.push(buf);
        currentOffset += buf.length;
    }

    const headerJson = Buffer.from(JSON.stringify(headerObj), "utf8");
    const jsonLen = headerJson.length;
    const innerPickleSize = Math.ceil((4 + jsonLen) / 4) * 4;
    const headerSize = innerPickleSize + 4;

    const prefix = Buffer.alloc(8 + headerSize, 0);
    prefix.writeUInt32LE(4, 0); // outer pickle payload size
    prefix.writeUInt32LE(headerSize, 4);
    prefix.writeUInt32LE(innerPickleSize, 8);
    prefix.writeUInt32LE(jsonLen, 12);
    headerJson.copy(prefix, 16);

    return Buffer.concat([prefix, ...payloadBuffers]);
}

function parseAsarHeader(buffer) {
    const picklePayloadSize = buffer.readUInt32LE(0);
    assert.strictEqual(picklePayloadSize, 4, "Outer pickle payload size must be 4");
    const headerSize = buffer.readUInt32LE(4);
    const jsonLen = buffer.readUInt32LE(12);
    const headerJsonStr = buffer.subarray(16, 16 + jsonLen).toString("utf8");
    const header = JSON.parse(headerJsonStr);
    const payloadStart = 8 + headerSize;

    const readFile = name => {
        const entry = header.files[name];
        if (!entry) return null;
        const start = payloadStart + Number(entry.offset);
        return buffer.subarray(start, start + entry.size);
    };

    return { header, readFile };
}

describe("ASAR Patching and Pickle Serialization", () => {
    test("creates valid ASAR archive and parses header correctly", () => {
        const mockAsar = createMockAsar({
            "index.js": "console.log('vanilla index');",
            "steam.js": "console.log('vanilla steam');",
        });

        const { header, readFile } = parseAsarHeader(mockAsar);
        assert(header.files["index.js"], "index.js should exist in header");
        assert(header.files["steam.js"], "steam.js should exist in header");
        assert.strictEqual(readFile("index.js").toString("utf8"), "console.log('vanilla index');");
    });

    test("patchAsarArchive successfully replaces entries and preserves unpatched files", () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shapez-test-"));
        const sourcePath = path.join(tmpDir, "app.vanilla.asar");
        const targetPath = path.join(tmpDir, "app.patched.asar");

        try {
            const initialAsar = createMockAsar({
                "bundle.js": "const game = true;",
                "index.js": "console.log('original index');",
                "steam.js": "console.log('original steam');",
            });
            fs.writeFileSync(sourcePath, initialAsar);

            const replacements = {
                "index.js": Buffer.from("console.log('patched index with MP hooks');", "utf8"),
                "steam.js": Buffer.from("console.log('patched steam with lobby net');", "utf8"),
            };

            patchAsarArchive(sourcePath, targetPath, replacements);

            const patchedData = fs.readFileSync(targetPath);
            const { header, readFile } = parseAsarHeader(patchedData);

            // Replaced files
            assert.strictEqual(readFile("index.js").toString("utf8"), "console.log('patched index with MP hooks');");
            assert.strictEqual(readFile("steam.js").toString("utf8"), "console.log('patched steam with lobby net');");

            // Preserved file
            assert.strictEqual(readFile("bundle.js").toString("utf8"), "const game = true;");
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
