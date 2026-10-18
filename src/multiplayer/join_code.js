/**
 * @file src/multiplayer/join_code.js
 * @description Join code encoding/decoding utilities and HTML sanitization for DOM rendering.
 * 
 * Provides:
 * - HTML string sanitization to prevent XSS / markup injection when displaying player names.
 * - Base64 URL-safe Join Code serialization bundling IP:Port endpoint, Steam Lobby ID, and Host Steam ID.
 * - Robust parsing supporting raw `IP:Port`, direct 64-bit Steam IDs, and Base64 encoded tokens.
 */

/**
 * Sanitizes input strings by escaping HTML special characters to prevent DOM-based XSS attacks.
 *
 * @param {string | any} str - String to escape.
 * @returns {string} Sanitized string safe for HTML interpolation.
 */
function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Encodes connection parameters into a compact, Base64-encoded Join Code.
 *
 * @param {string} endpoint - Comma-separated list of IP:Port host candidate endpoints.
 * @param {string} [lobbyId=""] - 64-bit Steam Matchmaking Lobby ID.
 * @param {string} [hostSteamId=""] - 64-bit Steam ID of the host player.
 * @returns {string} Base64-encoded Join Code.
 */
function encodeJoinCode(endpoint, lobbyId, hostSteamId) {
    const raw = JSON.stringify({
        e: endpoint || "",
        l: lobbyId || "",
        h: hostSteamId || "",
    });

    if (typeof btoa === "function") {
        return btoa(unescape(encodeURIComponent(raw)));
    }
    return Buffer.from(raw, "utf8").toString("base64");
}

/**
 * Parses and extracts connection parameters from user input.
 * Supports:
 * 1. Base64 encoded Join Code (e.g. `eyJlIjoiMTI3LjAuMC4x...`)
 * 2. Raw IP:Port endpoint (e.g. `127.0.0.1:27080` or `192.168.1.50:27080`)
 * 3. Raw 64-bit Steam ID string (e.g. `76561198000000001`)
 *
 * @param {string | any} code - Input join code or network address.
 * @returns {{ endpoint: string, host: string, port: number, lobbyId: string, hostSteamId: string } | null}
 * Parsed parameters or null if input was empty.
 */
function decodeJoinCode(code) {
    const trimmed = String(code || "").trim();
    if (!trimmed) return null;

    // Direct IP:Port format (e.g. 127.0.0.1:27080 or 192.168.1.50:27080)
    if (/^[a-zA-Z0-9.\-]+:\d{2,5}$/.test(trimmed)) {
        const [host, portStr] = trimmed.split(":");
        return {
            endpoint: trimmed,
            host,
            port: Number(portStr),
            lobbyId: "",
            hostSteamId: "",
        };
    }

    try {
        const json =
            typeof atob === "function"
                ? decodeURIComponent(escape(atob(trimmed)))
                : Buffer.from(trimmed, "base64").toString("utf8");
        const obj = JSON.parse(json);
        const ep = (obj.e || "").split(",")[0] || "";
        const [host, portStr] = ep.split(":");
        return {
            endpoint: obj.e || "",
            host: host || "127.0.0.1",
            port: Number(portStr) || 27080,
            lobbyId: obj.l || "",
            hostSteamId: obj.h || "",
        };
    } catch {
        return {
            endpoint: "",
            host: "127.0.0.1",
            port: 27080,
            lobbyId: trimmed,
            hostSteamId: /^\d{15,20}$/.test(trimmed) ? trimmed : "",
        };
    }
}

module.exports = {
    escapeHtml,
    encodeJoinCode,
    decodeJoinCode,
};
