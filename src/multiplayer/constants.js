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

module.exports = {
    METADATA,
    PLAYER_COLORS,
};
