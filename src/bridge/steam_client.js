/**
 * @file src/bridge/steam_client.js
 * @description Steamworks client lifecycle, Greenworks bindings, Steam Lobby management, and Rich Presence.
 * 
 * Coordinates:
 * 1. Steam API initialization via `greenworks`, including app ID detection (`steam_appid.txt`).
 * 2. Multi-instance support (skips `restartAppIfNecessary` when running secondary instances).
 * 3. Steam profile discovery with deterministic offline fallback generation.
 * 4. Steam Matchmaking Lobby creation, join lifecycle, and validation (filtering out 20-digit async handles).
 * 5. Native Steam event listeners (`lobby-created`, `lobby-enter`, `lobby-invite`, `rich-presence-join-requested`).
 * 6. Steam Rich Presence and Overlay activation.
 * 7. Achievement and DLC ownership verification.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { logInfo, logWarn, writeMpLog } = require("./logger");
const { loadNativeSteamP2P, ensureP2PSessionAccepted, startP2PPollTimer, setP2pInitialized } = require("./native_p2p");

let greenworks = null;
let appId = null;
let initialized = false;
let mainWindow = null;
let currentLobbyId = null;
let currentLobbyHostId = null;
let lobbyRole = "none"; // "none" | "host" | "client"
let fallbackProfile = null;

// Attempt loading Greenworks addon and reading steam_appid.txt
try {
    greenworks = require("shapez.io-private-artifacts/steam/greenworks");
    const appIdPath = path.join(__dirname, "..", "steam_appid.txt");
    const directAppIdPath = path.join(__dirname, "steam_appid.txt");
    if (fs.existsSync(appIdPath)) {
        appId = parseInt(fs.readFileSync(appIdPath, "utf8"), 10);
    } else if (fs.existsSync(directAppIdPath)) {
        appId = parseInt(fs.readFileSync(directAppIdPath, "utf8"), 10);
    } else {
        appId = 1318690;
    }
} catch (err) {
    logWarn("Failed to load steam api: " + (err && err.message ? err.message : err));
}

/**
 * Associates the active Electron BrowserWindow with the Steam bridge.
 *
 * @param {import("electron").BrowserWindow | null} win - Primary Electron window instance.
 */
function setMainWindow(win) {
    mainWindow = win;
}

/**
 * Gets the current main window reference.
 * @returns {import("electron").BrowserWindow | null}
 */
function getMainWindow() {
    return mainWindow;
}

/**
 * Transmits an IPC event to the Electron Renderer process if the window is alive.
 *
 * @param {string} channel - Channel name.
 * @param {any} payload - Serializable data payload.
 */
function sendToRenderer(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        try {
            mainWindow.webContents.send(channel, payload);
        } catch (err) {
            logWarn("Failed to send IPC to renderer: " + (err.message || err));
        }
    }
}

/**
 * Normalizes various Steam ID object and string representations into a canonical string.
 *
 * @param {any} val - Raw Steam ID object, number, or string.
 * @returns {string} Normalized 64-bit Steam ID decimal string.
 */
function normalizeSteamId(val) {
    if (!val) return "";
    if (typeof val === "string") return val;
    if (typeof val === "number") return String(val);
    if (typeof val.getRawSteamID === "function") {
        try {
            return String(val.getRawSteamID());
        } catch {}
    }
    if (val.steamId) return String(val.steamId);
    if (val.staticAccountId) return String(val.staticAccountId);
    return String(val);
}

/**
 * Validates whether an ID string corresponds to a genuine 64-bit Steam Matchmaking Lobby ID.
 * Distinguishes true Steam lobby IDs (`^109\d{14,15}$`) from 20-digit SteamAPICall_t async
 * handles (`1590867...`) and synthetic fallbacks.
 *
 * @param {string | number} id - Candidate lobby ID.
 * @returns {boolean} True if genuine Steam Matchmaking Lobby ID, false otherwise.
 */
function isRealSteamLobbyId(id) {
    const s = String(id || "").trim();
    if (!s || s === "0" || s.startsWith("steam_lobby_")) return false;
    return /^109\d{14,15}$/.test(s);
}

/**
 * Retrieves the local user's Steam profile or generates a deterministic fallback profile.
 *
 * @returns {{ steamId: string, name: string, accountId: number, level: number, isSteam: boolean }}
 */
function getLocalSteamProfile() {
    if (initialized && greenworks && typeof greenworks.getSteamId === "function") {
        try {
            const info = greenworks.getSteamId();
            const steamId = normalizeSteamId(info);
            return {
                steamId: steamId || "steam_local",
                name:
                    info.screenName ||
                    (typeof info.getPersonaName === "function" ? info.getPersonaName() : "Steam Player"),
                accountId: info.accountId || 0,
                level: info.level || 1,
                isSteam: true,
            };
        } catch (err) {
            logWarn("Error reading greenworks.getSteamId(): " + (err.message || err));
        }
    }

    if (!fallbackProfile) {
        const suffix = Math.floor(1000 + Math.random() * 9000);
        fallbackProfile = {
            steamId: "local_" + process.pid + "_" + suffix,
            name: (os.userInfo().username || "Player") + "#" + suffix,
            accountId: suffix,
            level: 1,
            isSteam: false,
        };
    }
    return fallbackProfile;
}

/**
 * Retrieves the 64-bit Steam ID of the host/owner of a Steam Matchmaking Lobby.
 *
 * @param {string} lobbyId - Lobby ID.
 * @returns {string} Owner Steam ID string or empty string.
 */
function getLobbyOwnerSteamId(lobbyId) {
    if (!initialized || !greenworks || !isRealSteamLobbyId(lobbyId) || typeof greenworks.getLobbyOwner !== "function") {
        return "";
    }
    try {
        return normalizeSteamId(greenworks.getLobbyOwner(lobbyId));
    } catch {
        return "";
    }
}

/**
 * Creates a native Steam Matchmaking Lobby and resolves with its 64-bit Steam Lobby ID.
 *
 * @param {number} [maxPlayers=8] - Maximum allowable lobby members.
 * @returns {Promise<string | null>} Lobby ID string or null on failure.
 */
function createSteamLobbyInternal(maxPlayers = 8) {
    if (!initialized || !greenworks || typeof greenworks.createLobby !== "function") {
        return Promise.resolve(null);
    }
    const lobbyType =
        greenworks.LobbyType && greenworks.LobbyType.Public !== undefined
            ? greenworks.LobbyType.Public
            : greenworks.LobbyType && greenworks.LobbyType.FriendsOnly !== undefined
            ? greenworks.LobbyType.FriendsOnly
            : 2;

    return new Promise(resolve => {
        let done = false;
        const finish = id => {
            if (!done) {
                done = true;
                resolve(id && isRealSteamLobbyId(id) ? normalizeSteamId(id) : null);
            }
        };

        const timer = setTimeout(() => finish(null), 3000);

        const onCreated = (res, createdLobbyId) => {
            clearTimeout(timer);
            const actualId = createdLobbyId
                ? normalizeSteamId(createdLobbyId)
                : typeof res === "string"
                ? normalizeSteamId(res)
                : null;
            finish(actualId);
        };

        if (typeof greenworks.once === "function") {
            greenworks.once("lobby-created", onCreated);
        }

        try {
            greenworks.createLobby(lobbyType, maxPlayers, id => {
                if (id) {
                    clearTimeout(timer);
                    finish(id);
                }
            });
        } catch {
            clearTimeout(timer);
            finish(null);
        }
    });
}

/**
 * Subscribes to native Steam Matchmaking and Rich Presence event callbacks.
 */
function setupSteamEventListeners() {
    if (!greenworks || typeof greenworks.on !== "function") {
        return;
    }

    greenworks.on("lobby-created", (result, lobbyId) => {
        const idStr = normalizeSteamId(lobbyId || (typeof result === "string" ? result : ""));
        logInfo(`lobby-created event: result=${result} lobbyId=${idStr}`);
        if (idStr && isRealSteamLobbyId(idStr)) {
            currentLobbyId = idStr;
        }
        sendToRenderer("steam:mp:event", {
            type: "lobby-created",
            result,
            lobbyId: idStr,
        });
    });

    greenworks.on("lobby-enter", (lobbyId, chatPermissions, locked, response) => {
        const idStr = normalizeSteamId(lobbyId);
        logInfo(`lobby-enter event: lobbyId=${idStr} response=${response}`);
        if (idStr && isRealSteamLobbyId(idStr)) {
            currentLobbyId = idStr;
        }
        sendToRenderer("steam:mp:event", {
            type: "lobby-enter",
            lobbyId: idStr,
            chatPermissions,
            locked,
            response,
        });
    });

    greenworks.on("lobby-data-update", (arg1, arg2, arg3) => {
        const isFirstBool = typeof arg1 === "boolean";
        const success = isFirstBool ? arg1 : Boolean(arg3);
        const lobbyId = normalizeSteamId(isFirstBool ? arg2 : arg1);
        const memberId = normalizeSteamId(isFirstBool ? arg3 : arg2);

        sendToRenderer("steam:mp:event", {
            type: "lobby-data-update",
            success,
            lobbyId,
            memberId,
        });
    });

    greenworks.on("lobby-invite", (inviterId, lobbyId, gameId) => {
        const fromId = normalizeSteamId(inviterId);
        const targetLobby = normalizeSteamId(lobbyId);
        ensureP2PSessionAccepted(fromId);
        let fromName = fromId;
        try {
            if (greenworks.getFriendPersonaName) {
                fromName = greenworks.getFriendPersonaName(fromId) || fromId;
            }
        } catch {}
        logInfo(`lobby-invite from ${fromName} (${fromId}) to lobby ${targetLobby}`);
        sendToRenderer("steam:mp:event", {
            type: "lobby-invite",
            inviterId: fromId,
            inviterName: fromName,
            lobbyId: targetLobby,
            gameId: String(gameId || ""),
        });
    });

    greenworks.on("lobby-join-requested", (lobbyId, friendId) => {
        const targetLobby = normalizeSteamId(lobbyId);
        const fromFriend = normalizeSteamId(friendId);
        ensureP2PSessionAccepted(fromFriend);
        logInfo(`lobby-join-requested: lobby=${targetLobby} from=${fromFriend}`);
        sendToRenderer("steam:mp:event", {
            type: "lobby-join-requested",
            lobbyId: targetLobby,
            friendId: fromFriend,
        });
    });

    greenworks.on("rich-presence-join-requested", (friendId, connectStr) => {
        const fromFriend = normalizeSteamId(friendId);
        ensureP2PSessionAccepted(fromFriend);
        logInfo(`rich-presence-join-requested: from=${fromFriend} connect=${connectStr}`);
        sendToRenderer("steam:mp:event", {
            type: "rich-presence-join-requested",
            friendId: fromFriend,
            connect: String(connectStr || ""),
        });
    });
}

/**
 * Initializes the Steamworks API, validates application ownership, and loads native addons.
 *
 * @param {boolean} isDev - True if running under developer mode.
 * @param {boolean} [allowMultiInstance=false] - True if running multiple local instances.
 */
function init(isDev, allowMultiInstance = false) {
    if (!greenworks) {
        return;
    }

    if (!isDev && !allowMultiInstance) {
        try {
            if (greenworks.restartAppIfNecessary(appId)) {
                console.log("Restarting ...");
                process.exit(0);
            }
        } catch (err) {
            logWarn("restartAppIfNecessary check failed: " + (err.message || err));
        }
    }

    try {
        if (!greenworks.init()) {
            logWarn("Failed to initialize greenworks");
            if (!isDev && !allowMultiInstance) {
                process.exit(1);
            }
            return;
        }
        initialized = true;
        console.log("Steam (greenworks) initialized successfully.");
        writeMpLog("MAIN", "INFO", "Steam (greenworks) initialized successfully.");

        const nativeP2P = loadNativeSteamP2P();
        if (nativeP2P && typeof nativeP2P.init === "function") {
            try {
                const ok = Boolean(nativeP2P.init());
                setP2pInitialized(ok);
                logInfo("Native ISteamNetworking P2P initialized: " + ok);
                if (ok) {
                    startP2PPollTimer();
                }
            } catch (err) {
                setP2pInitialized(false);
                logWarn("Native Steam P2P init failed: " + (err.message || err));
            }
        }

        setupSteamEventListeners();
    } catch (err) {
        logWarn("Steam initialization threw error (continuing in local/LAN fallback mode): " + (err.message || err));
        if (!isDev && !allowMultiInstance) {
            initialized = false;
        }
    }
}

/**
 * Checks if the Steam client initialized successfully.
 * @returns {Promise<boolean>}
 */
function isInitialized() {
    return Promise.resolve(initialized);
}

/**
 * Retrieves the list of Steam achievement internal names.
 * @returns {Promise<string[]>}
 */
function getAchievementNames() {
    if (!initialized || !greenworks) {
        return Promise.resolve([]);
    }
    return new Promise((resolve, reject) => {
        try {
            const achievements = greenworks.getAchievementNames();
            resolve(achievements);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Unlocks a Steam achievement by its internal identifier.
 *
 * @param {any} event - IPC event context.
 * @param {string} id - Achievement identifier.
 * @returns {Promise<void>}
 */
function activateAchievement(event, id) {
    if (!initialized || !greenworks) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        greenworks.activateAchievement(
            id,
            () => resolve(),
            err => reject(err)
        );
    });
}

/**
 * Retrieves an encrypted Steam session authentication ticket encoded as hex.
 * @returns {Promise<string>}
 */
function getAuthTicket() {
    if (!initialized || !greenworks) {
        return Promise.reject("Steam not initialized");
    }
    return new Promise((resolve, reject) => {
        greenworks.getAuthSessionTicket(
            success => {
                const ticketHex = Array.from(new Uint8Array(success.ticket))
                    .map(b => b.toString(16).padStart(2, "0"))
                    .join("");
                resolve(ticketHex);
            },
            error => {
                logWarn("Failed to get steam ticket: " + (error.message || error));
                reject(error);
            }
        );
    });
}

/**
 * Verifies DLC ownership.
 * @param {number} dlcAppId - Steam DLC App ID.
 * @returns {Promise<boolean>}
 */
function checkAppOwnership(dlcAppId) {
    if (!initialized || !greenworks) {
        return Promise.resolve(false);
    }
    try {
        return Promise.resolve(greenworks.isDLCInstalled(dlcAppId));
    } catch {
        return Promise.resolve(false);
    }
}

module.exports = {
    init,
    setMainWindow,
    getMainWindow,
    sendToRenderer,
    normalizeSteamId,
    isRealSteamLobbyId,
    getLocalSteamProfile,
    getLobbyOwnerSteamId,
    createSteamLobbyInternal,
    setupSteamEventListeners,
    isInitialized,
    getAchievementNames,
    activateAchievement,
    getAuthTicket,
    checkAppOwnership,
    getGreenworks: () => greenworks,
    getAppId: () => appId,
    isSteamInitialized: () => initialized,
    getCurrentLobbyId: () => currentLobbyId,
    setCurrentLobbyId: id => { currentLobbyId = id; },
    getCurrentLobbyHostId: () => currentLobbyHostId,
    setCurrentLobbyHostId: id => { currentLobbyHostId = id; },
    getLobbyRole: () => lobbyRole,
    setLobbyRole: role => { lobbyRole = role; },
};
