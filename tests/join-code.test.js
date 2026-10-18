const { test, describe } = require("node:test");
const assert = require("node:assert");
const { encodeJoinCode, decodeJoinCode, escapeHtml } = require("../src/multiplayer");

describe("Join Code and Address Parser", () => {
    test("round-trips standard IP:Port endpoint, lobbyId, and hostSteamId", () => {
        const endpoint = "192.168.1.120:27080";
        const lobbyId = "10977524099999999";
        const hostSteamId = "76561198000000001";

        const code = encodeJoinCode(endpoint, lobbyId, hostSteamId);
        assert.ok(code, "Join code must not be empty");
        assert.ok(!code.includes(" "), "Join code must not contain spaces");

        const decoded = decodeJoinCode(code);
        assert.strictEqual(decoded.endpoint, endpoint);
        assert.strictEqual(decoded.host, "192.168.1.120");
        assert.strictEqual(decoded.port, 27080);
        assert.strictEqual(decoded.lobbyId, lobbyId);
        assert.strictEqual(decoded.hostSteamId, hostSteamId);
    });

    test("handles multiple comma-separated endpoint candidates and picks the first as primary host", () => {
        const endpoints = "10.0.0.15:27085,192.168.1.50:27085,127.0.0.1:27085";
        const code = encodeJoinCode(endpoints, "lobby_123", "76561198000000002");

        const decoded = decodeJoinCode(code);
        assert.strictEqual(decoded.endpoint, endpoints);
        assert.strictEqual(decoded.host, "10.0.0.15");
        assert.strictEqual(decoded.port, 27085);
        assert.strictEqual(decoded.lobbyId, "lobby_123");
    });

    test("parses direct raw IP:Port format without base64 wrapper", () => {
        const res = decodeJoinCode("127.0.0.1:27088");
        assert.deepStrictEqual(res, {
            endpoint: "127.0.0.1:27088",
            host: "127.0.0.1",
            port: 27088,
            lobbyId: "",
            hostSteamId: "",
        });

        const hostnameRes = decodeJoinCode("my-coop-server.local:27080");
        assert.strictEqual(hostnameRes.host, "my-coop-server.local");
        assert.strictEqual(hostnameRes.port, 27080);
    });

    test("identifies raw 64-bit Steam ID strings", () => {
        const steamId = "76561198012345678";
        const decoded = decodeJoinCode(steamId);
        assert.strictEqual(decoded.hostSteamId, steamId);
        assert.strictEqual(decoded.lobbyId, steamId);
        assert.strictEqual(decoded.host, "127.0.0.1");
        assert.strictEqual(decoded.port, 27080);
    });

    test("handles empty, null, undefined, or whitespace gracefully without throwing", () => {
        assert.strictEqual(decodeJoinCode(""), null);
        assert.strictEqual(decodeJoinCode("   "), null);
        assert.strictEqual(decodeJoinCode(null), null);
        assert.strictEqual(decodeJoinCode(undefined), null);
    });

    test("handles corrupted or malformed base64 without throwing", () => {
        const corrupted = "???%%%NotAValidBase64String&&&";
        const decoded = decodeJoinCode(corrupted);
        assert.ok(decoded, "Should return a safe fallback object");
        assert.strictEqual(decoded.host, "127.0.0.1");
        assert.strictEqual(decoded.port, 27080);
        assert.strictEqual(decoded.lobbyId, corrupted);
    });

    test("handles corrupted JSON inside valid base64", () => {
        const badJsonBase64 = Buffer.from("{ bad json content", "utf8").toString("base64");
        const decoded = decodeJoinCode(badJsonBase64);
        assert.ok(decoded);
        assert.strictEqual(decoded.host, "127.0.0.1");
        assert.strictEqual(decoded.port, 27080);
    });

    test("escapeHtml sanitizes HTML entities to prevent XSS / markup injection", () => {
        assert.strictEqual(
            escapeHtml("<script>alert('xss')</script>"),
            "&lt;script&gt;alert('xss')&lt;/script&gt;"
        );
        assert.strictEqual(
            escapeHtml(`Hello & "Welcome"`),
            "Hello &amp; &quot;Welcome&quot;"
        );
        assert.strictEqual(escapeHtml(null), "");
        assert.strictEqual(escapeHtml(undefined), "");
        assert.strictEqual(escapeHtml(12345), "12345");
    });
});
