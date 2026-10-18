/**
 * @file src/multiplayer/index.js
 * @description Central module entrypoint and barrel exporter for shapez.io Steam Co-op Mod client subsystems.
 * 
 * Exports:
 * - `METADATA`, `PLAYER_COLORS` (`constants.js`)
 * - `escapeHtml`, `encodeJoinCode`, `decodeJoinCode` (`join_code.js`)
 * - `HUDMultiplayer` (`hud/hud_multiplayer.js`)
 * - `Mod` (`mod.js`)
 * - Subsystems: `worldDump`, `actions`, `hubSync`, `cursors`, `gameHooks`, `dialogs`, `styles`.
 */

const { METADATA, PLAYER_COLORS } = require("./constants");
const { escapeHtml, encodeJoinCode, decodeJoinCode } = require("./join_code");
const { HUDMultiplayer } = require("./hud/hud_multiplayer");
const { Mod } = require("./mod");
const worldDump = require("./sync/world_dump");
const worldCheck = require("./sync/world_check");
const actions = require("./sync/actions");
const hubSync = require("./sync/hub_sync");
const cursors = require("./sync/cursors");
const gameHooks = require("./sync/game_hooks");
const dialogs = require("./ui/dialogs");
const styles = require("./ui/styles");

module.exports = {
    METADATA,
    PLAYER_COLORS,
    escapeHtml,
    encodeJoinCode,
    decodeJoinCode,
    HUDMultiplayer,
    Mod,
    worldDump,
    worldCheck,
    actions,
    hubSync,
    cursors,
    gameHooks,
    dialogs,
    styles,
};
