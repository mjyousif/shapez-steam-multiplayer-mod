/**
 * @file src/multiplayer/constants.js
 * @description Mod metadata and curated visual color palette for player differentiation.
 */

/**
 * Shapez.io Mod specification metadata conforming to `shapez.Mod` interface.
 * @type {{
 *   website: string,
 *   author: string,
 *   name: string,
 *   version: string,
 *   id: string,
 *   description: string,
 *   minimumGameVersion: string,
 *   doesNotAffectSavegame: boolean
 * }}
 */
const METADATA = {
    website: "https://store.steampowered.com/app/1318690/shapez/",
    author: "Antigravity",
    name: "Steam Multiplayer (Co-op)",
    version: "1.0.12",
    id: "steam-multiplayer",
    description:
        "Real-time Co-op Multiplayer with Steamworks Lobbies, Friends, Overlay, WebRTC/TCP P2P, Live Cursors, and Full Factory Sync.",
    minimumGameVersion: ">=1.5.0",
    doesNotAffectSavegame: true,
};

/**
 * High-contrast, accessible visual color palette assigned to co-op players for cursors,
 * HUD elements, ghost placement previews, and map pings.
 * @type {string[]}
 */
const PLAYER_COLORS = [
    "#38bdf8", // Sky Blue (Host default)
    "#f43f5e", // Rose
    "#a855f7", // Purple
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#ec4899", // Pink
    "#6366f1", // Indigo
    "#14b8a6", // Teal
];

/**
 * Protocol version to ensure network wire compatibility between host and joining peers.
 * Increment whenever packet format or synchronization semantics change.
 * @type {number}
 */
const PROTOCOL_VERSION = 2;

/**
 * Periodic interval (in milliseconds) at which the host broadcasts authoritative Hub status.
 * @type {number}
 */
const HUB_SYNC_INTERVAL_MS = 2000;

/**
 * Periodic interval (in milliseconds) at which the host performs background world drift checks.
 * @type {number}
 */
const WORLD_CHECK_INTERVAL_MS = 3000;

/**
 * Region tile dimension (16x16 chunk) for spatial hashing and targeted desync repair.
 * @type {number}
 */
const REGION_SIZE = 16;

/**
 * Maximum duration (in milliseconds) for a client-side predicted upgrade before expiring.
 * @type {number}
 */
const PREDICTION_TIMEOUT_MS = 3000;

module.exports = {
    METADATA,
    PLAYER_COLORS,
    PROTOCOL_VERSION,
    HUB_SYNC_INTERVAL_MS,
    WORLD_CHECK_INTERVAL_MS,
    REGION_SIZE,
    PREDICTION_TIMEOUT_MS,
};
