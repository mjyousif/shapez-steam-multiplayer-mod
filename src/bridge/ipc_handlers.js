/**
 * @file src/bridge/ipc_handlers.js
 * @description Electron IPC handler registration and request routing for Steamworks and P2P networking.
 * 
 * Maps bidirectional communication between the Chromium Renderer sandbox (`window.ipcRenderer`)
 * and the Node.js Main Process (`electron.ipcMain`). Handles all `steam:*`, `steam:mp:*`,
 * and `mp:net:*` channels.
 * 
 * Invariants:
 * - All IPC handlers are async and return JSON-serializable payloads or reject with descriptive errors.
 * - Renderer log invocations are routed to persistent disk storage to preserve diagnostic history across crashes.
 * - Steam chat messages are strictly avoided; session invitations and signals use native Lobbies and P2P packets.
 */

const { logInfo, logWarn, writeMpLog, getRecentLogs } = require("./logger");
const {
    sendViaSteamP2P,
    steamIdToBuffer8,
    ensureP2PSessionAccepted,
    getP2pInitialized,
} = require("./native_p2p");
const {
    startTcpHost,
    stopTcpHost,
    connectTcpClient,
    disconnectTcpClient,
    sendFromHost,
    broadcastExcept,
    sendFromClient,
    getTcpServerPort,
    getLocalIPv4Addresses,
} = require("./tcp_transport");
const {
    startLobbyPollTimer,
    resetLobbyChannelState,
    enqueueLobbySignal,
    pollLobbyChannel,
} = require("./lobby_channel");
const steamClient = require("./steam_client");

let defaultIpcMain = { handle: () => {}, on: () => {} };
try {
    const electron = require("electron");
    if (electron && electron.ipcMain) {
        defaultIpcMain = electron.ipcMain;
    }
} catch {}

/**
 * Registers all Electron IPC handlers on the provided or default `ipcMain` instance.
 *
 * @param {import("electron").IpcMain} [ipcMainInstance] - Optional ipcMain instance (useful for mock testing).
 */
function registerIpcHandlers(ipcMainInstance) {
    const ipcMain = ipcMainInstance || defaultIpcMain;
    if (!ipcMain || typeof ipcMain.handle !== "function") {
        return;
    }

    // =========================================================================
    // Steam Core Handlers
    // =========================================================================

    ipcMain.handle("steam:is-initialized", steamClient.isInitialized);
    ipcMain.handle("steam:get-achievement-names", steamClient.getAchievementNames);
    ipcMain.handle("steam:activate-achievement", steamClient.activateAchievement);
    ipcMain.handle("steam:get-ticket", steamClient.getAuthTicket);
    ipcMain.handle("steam:check-app-ownership", (event, dlcAppId) => steamClient.checkAppOwnership(dlcAppId));

    // =========================================================================
    // Steam Multiplayer Diagnostic & Status Handlers
    // =========================================================================

    ipcMain.handle("steam:mp:log", async (event, { level, message } = {}) => {
        writeMpLog("RENDERER", level || "INFO", String(message || ""));
        return { ok: true };
    });

    ipcMain.handle("steam:mp:get-logs", async () => {
        return getRecentLogs(80);
    });

    ipcMain.handle("steam:mp:get-status", async () => {
        let launchCmd = "";
        const greenworks = steamClient.getGreenworks();
        if (steamClient.isSteamInitialized() && greenworks && typeof greenworks.getLaunchCommandLine === "function") {
            try {
                launchCmd = greenworks.getLaunchCommandLine() || "";
            } catch {}
        }

        return {
            initialized: Boolean(steamClient.isSteamInitialized() && greenworks),
            p2pInitialized: getP2pInitialized(),
            profile: steamClient.getLocalSteamProfile(),
            launchCmd,
            activeLobbyId: steamClient.getCurrentLobbyId(),
            localIps: getLocalIPv4Addresses(),
            hostPort: getTcpServerPort(),
            logPath: getRecentLogs().logPath,
        };
    });

    // =========================================================================
    // Steam Friends & Lobby Discovery
    // =========================================================================

    ipcMain.handle("steam:mp:get-friends", async () => {
        const greenworks = steamClient.getGreenworks();
        if (!steamClient.isSteamInitialized() || !greenworks || typeof greenworks.getFriends !== "function") {
            return [];
        }

        try {
            const flag =
                greenworks.FriendFlags && greenworks.FriendFlags.Immediate !== undefined
                    ? greenworks.FriendFlags.Immediate
                    : 4;
            const rawFriends = greenworks.getFriends(flag) || [];
            const list = [];
            const targetAppStr = String(steamClient.getAppId() || "1318690");

            for (const f of rawFriends) {
                const steamId = steamClient.normalizeSteamId(f);
                if (!steamId) continue;

                let name = "";
                try {
                    name =
                        typeof f.getPersonaName === "function"
                            ? f.getPersonaName()
                            : greenworks.getFriendPersonaName
                            ? greenworks.getFriendPersonaName(steamId)
                            : steamId;
                } catch {
                    name = steamId;
                }

                let connect = "";
                let mpEndpoint = "";
                let mpLobby = "";
                let mpMode = "";
                let isPlayingShapez = false;
                let isInGame = false;

                const nativeP2P = require("./native_p2p").loadNativeSteamP2P();
                if (getP2pInitialized() && nativeP2P && typeof nativeP2P.requestFriendRichPresence === "function") {
                    const idBuf = steamIdToBuffer8(steamId);
                    if (idBuf) {
                        try {
                            nativeP2P.requestFriendRichPresence(idBuf);
                        } catch {}
                    }
                }

                if (typeof greenworks.getFriendGamePlayed === "function") {
                    try {
                        const gp = greenworks.getFriendGamePlayed(steamId);
                        if (gp && gp.m_gameID && String(gp.m_gameID) !== "0") {
                            isInGame = true;
                            if (String(gp.m_gameID) === targetAppStr) {
                                isPlayingShapez = true;
                                const gpLobby = gp.m_steamIDLobby ? steamClient.normalizeSteamId(gp.m_steamIDLobby) : "";
                                if (steamClient.isRealSteamLobbyId(gpLobby)) {
                                    mpLobby = gpLobby;
                                }
                            }
                        }
                    } catch {}
                }

                if (typeof greenworks.getFriendRichPresence === "function") {
                    try {
                        if (typeof greenworks.requestUserInformation === "function") {
                            greenworks.requestUserInformation(steamId, true);
                        }
                        connect = greenworks.getFriendRichPresence(steamId, "connect") || "";
                        mpEndpoint = greenworks.getFriendRichPresence(steamId, "shapez_mp_endpoint") || "";
                        const rpLobby = greenworks.getFriendRichPresence(steamId, "shapez_mp_lobby") || "";
                        if (steamClient.isRealSteamLobbyId(rpLobby)) {
                            mpLobby = rpLobby;
                        }
                        mpMode = greenworks.getFriendRichPresence(steamId, "shapez_mp_mode") || "";
                    } catch {}
                }

                list.push({
                    steamId,
                    name: name || steamId,
                    connect,
                    mpEndpoint,
                    mpLobby,
                    mpMode,
                    isPlayingShapez,
                    isInGame,
                });
            }

            // Priority sort: active shapez co-op hosts first, shapez players second, in-game third
            list.sort((a, b) => {
                const aHost = a.mpLobby || a.mpEndpoint ? 1 : 0;
                const bHost = b.mpLobby || b.mpEndpoint ? 1 : 0;
                if (aHost !== bHost) return bHost - aHost;
                if (a.isPlayingShapez !== b.isPlayingShapez) return (b.isPlayingShapez ? 1 : 0) - (a.isPlayingShapez ? 1 : 0);
                if (a.isInGame !== b.isInGame) return (b.isInGame ? 1 : 0) - (a.isInGame ? 1 : 0);
                return String(a.name).localeCompare(String(b.name));
            });

            return list;
        } catch (err) {
            logWarn("get-friends failed: " + (err.message || err));
            return [];
        }
    });

    // =========================================================================
    // Steam Lobby Management
    // =========================================================================

    ipcMain.handle("steam:mp:create-lobby", async (event, options = {}) => {
        const maxPlayers = options.maxPlayers || 8;
        const mode = options.mode || "coop";
        const endpointStr = options.endpoint || "";
        const profile = steamClient.getLocalSteamProfile();

        resetLobbyChannelState();

        let lobbyId = await steamClient.createSteamLobbyInternal(maxPlayers);
        if (!lobbyId) {
            lobbyId = "steam_lobby_" + profile.steamId;
        }

        steamClient.setCurrentLobbyId(lobbyId);
        steamClient.setCurrentLobbyHostId(profile.steamId);
        steamClient.setLobbyRole("host");

        logInfo(`Created host lobby: ${lobbyId} (host=${profile.name} [${profile.steamId}], endpoints=${endpointStr})`);

        const greenworks = steamClient.getGreenworks();
        if (steamClient.isSteamInitialized() && greenworks) {
            try {
                if (typeof greenworks.setLobbyData === "function" && steamClient.isRealSteamLobbyId(lobbyId)) {
                    greenworks.setLobbyData(lobbyId, "host_id", profile.steamId);
                    greenworks.setLobbyData(lobbyId, "host_name", profile.name);
                    greenworks.setLobbyData(lobbyId, "mp_mode", mode);
                    if (endpointStr) {
                        greenworks.setLobbyData(lobbyId, "mp_endpoints", endpointStr);
                    }
                    if (typeof greenworks.setLobbyJoinable === "function") {
                        greenworks.setLobbyJoinable(lobbyId, true);
                    }
                }
            } catch {}

            try {
                if (typeof greenworks.setRichPresence === "function") {
                    greenworks.setRichPresence("status", "Hosting shapez Co-op Factory");
                    greenworks.setRichPresence(
                        "connect",
                        "+connect_lobby " + lobbyId + (endpointStr ? " +connect_ip " + endpointStr : "")
                    );
                    greenworks.setRichPresence("shapez_mp_lobby", lobbyId);
                    greenworks.setRichPresence("shapez_mp_mode", mode);
                    if (endpointStr) {
                        greenworks.setRichPresence("shapez_mp_endpoint", endpointStr);
                    }
                }
            } catch {}

            if (steamClient.isRealSteamLobbyId(lobbyId)) {
                startLobbyPollTimer();
            }
        }

        return {
            lobbyId,
            hostId: profile.steamId,
            hostName: profile.name,
            mode,
        };
    });

    ipcMain.handle("steam:mp:join-lobby", async (event, arg) => {
        const lobbyIdArg = typeof arg === "object" && arg !== null ? arg.lobbyId : arg;
        const hostSteamIdArg = typeof arg === "object" && arg !== null ? steamClient.normalizeSteamId(arg.hostSteamId) : "";

        let targetLobby = String(lobbyIdArg || "").trim();
        const greenworks = steamClient.getGreenworks();

        if (!steamClient.isRealSteamLobbyId(targetLobby) && hostSteamIdArg && steamClient.isSteamInitialized() && greenworks) {
            try {
                if (typeof greenworks.getFriendGamePlayed === "function") {
                    const gp = greenworks.getFriendGamePlayed(hostSteamIdArg);
                    const gpLobby = gp && gp.m_steamIDLobby ? steamClient.normalizeSteamId(gp.m_steamIDLobby) : "";
                    if (steamClient.isRealSteamLobbyId(gpLobby)) {
                        targetLobby = gpLobby;
                    }
                }
            } catch {}
        }

        if (!targetLobby && hostSteamIdArg) {
            targetLobby = "steam_lobby_" + hostSteamIdArg;
        }
        if (!targetLobby) throw new Error("Missing lobbyId");

        resetLobbyChannelState();
        steamClient.setCurrentLobbyId(targetLobby);
        steamClient.setCurrentLobbyHostId(hostSteamIdArg || "");
        steamClient.setLobbyRole("client");

        if (hostSteamIdArg) {
            ensureP2PSessionAccepted(hostSteamIdArg);
        }

        const joinSingleLobby = idToJoin => {
            if (!steamClient.isSteamInitialized() || !greenworks || typeof greenworks.joinLobby !== "function" || !steamClient.isRealSteamLobbyId(idToJoin)) {
                return Promise.resolve();
            }
            const nativeP2P = require("./native_p2p").loadNativeSteamP2P();
            if (getP2pInitialized() && nativeP2P && typeof nativeP2P.requestLobbyData === "function") {
                const lobbyBuf = steamIdToBuffer8(idToJoin);
                if (lobbyBuf) {
                    try {
                        nativeP2P.requestLobbyData(lobbyBuf);
                    } catch {}
                }
            }
            return new Promise(resolve => {
                let settled = false;
                const done = () => {
                    if (!settled) {
                        settled = true;
                        resolve();
                    }
                };
                const timer = setTimeout(done, 2500);
                if (typeof greenworks.once === "function") {
                    greenworks.once("lobby-enter", () => {
                        clearTimeout(timer);
                        done();
                    });
                }
                try {
                    greenworks.joinLobby(idToJoin, () => {
                        clearTimeout(timer);
                        done();
                    });
                } catch {
                    clearTimeout(timer);
                    done();
                }
            });
        };

        await joinSingleLobby(targetLobby);

        let endpoints = "";
        let hostId = steamClient.getCurrentLobbyHostId();
        let hostName = "";

        if (
            steamClient.isSteamInitialized() &&
            greenworks &&
            typeof greenworks.getLobbyData === "function" &&
            steamClient.isRealSteamLobbyId(targetLobby)
        ) {
            try {
                endpoints = greenworks.getLobbyData(targetLobby, "mp_endpoints") || "";
                hostId =
                    greenworks.getLobbyData(targetLobby, "host_id") ||
                    steamClient.getLobbyOwnerSteamId(targetLobby) ||
                    hostId;
                hostName = greenworks.getLobbyData(targetLobby, "host_name") || "";
            } catch {}
        }

        steamClient.setCurrentLobbyHostId(hostId);
        if (hostId) {
            ensureP2PSessionAccepted(hostId);
        }
        if (!hostName && hostId && steamClient.isSteamInitialized() && greenworks && typeof greenworks.getFriendPersonaName === "function") {
            try {
                hostName = greenworks.getFriendPersonaName(hostId) || "";
            } catch {}
        }

        if (steamClient.isSteamInitialized() && greenworks && steamClient.isRealSteamLobbyId(targetLobby)) {
            startLobbyPollTimer();
            pollLobbyChannel();
        }

        logInfo(`Joined lobby ${targetLobby}: hostId=${hostId} hostName=${hostName} endpoints=${endpoints}`);

        return {
            lobbyId: targetLobby,
            hostId,
            hostName,
            endpoints,
        };
    });

    ipcMain.handle("steam:mp:leave-lobby", async () => {
        resetLobbyChannelState();
        const greenworks = steamClient.getGreenworks();
        const curLobby = steamClient.getCurrentLobbyId();

        if (steamClient.isSteamInitialized() && greenworks) {
            try {
                if (curLobby && steamClient.isRealSteamLobbyId(curLobby) && typeof greenworks.leaveLobby === "function") {
                    greenworks.leaveLobby(curLobby);
                }
            } catch {}
            try {
                if (typeof greenworks.clearRichPresence === "function") {
                    greenworks.clearRichPresence();
                }
            } catch {}
        }

        steamClient.setCurrentLobbyId(null);
        steamClient.setCurrentLobbyHostId(null);
        steamClient.setLobbyRole("none");
        return { ok: true };
    });

    ipcMain.handle("steam:mp:set-lobby-data", async (event, { lobbyId, key, value }) => {
        const target = lobbyId || steamClient.getCurrentLobbyId();
        const greenworks = steamClient.getGreenworks();
        if (
            steamClient.isSteamInitialized() &&
            greenworks &&
            target &&
            steamClient.isRealSteamLobbyId(target) &&
            typeof greenworks.setLobbyData === "function"
        ) {
            try {
                return Boolean(greenworks.setLobbyData(target, String(key), String(value)));
            } catch {}
        }
        return false;
    });

    ipcMain.handle("steam:mp:get-lobby-data", async (event, { lobbyId, key }) => {
        const target = lobbyId || steamClient.getCurrentLobbyId();
        const greenworks = steamClient.getGreenworks();
        if (
            steamClient.isSteamInitialized() &&
            greenworks &&
            target &&
            steamClient.isRealSteamLobbyId(target) &&
            typeof greenworks.getLobbyData === "function"
        ) {
            try {
                return greenworks.getLobbyData(target, String(key)) || "";
            } catch {}
        }
        return "";
    });

    ipcMain.handle("steam:mp:set-rich-presence", async (event, kvMap = {}) => {
        const greenworks = steamClient.getGreenworks();
        if (!steamClient.isSteamInitialized() || !greenworks || typeof greenworks.setRichPresence !== "function") {
            return false;
        }
        try {
            for (const [k, v] of Object.entries(kvMap)) {
                greenworks.setRichPresence(String(k), String(v || ""));
            }
            return true;
        } catch {
            return false;
        }
    });

    ipcMain.handle("steam:mp:invite-overlay", async (event, lobbyId) => {
        const greenworks = steamClient.getGreenworks();
        if (!steamClient.isSteamInitialized() || !greenworks) {
            return { opened: false, reason: "steam-not-initialized" };
        }
        const target = lobbyId || steamClient.getCurrentLobbyId() || "";
        try {
            if (
                target &&
                steamClient.isRealSteamLobbyId(target) &&
                typeof greenworks.activateGameOverlayInviteDialog === "function"
            ) {
                greenworks.activateGameOverlayInviteDialog(target);
                return { opened: true, mode: "invite-dialog" };
            }
            if (typeof greenworks.activateGameOverlay === "function") {
                greenworks.activateGameOverlay("Friends");
                return { opened: true, mode: "friends-overlay" };
            }
        } catch (err) {
            logWarn("Failed to activate Steam overlay: " + (err.message || err));
        }
        return { opened: false, reason: "overlay-unavailable" };
    });

    ipcMain.handle("steam:mp:invite-friend", async (event, { friendSteamId, lobbyId }) => {
        const greenworks = steamClient.getGreenworks();
        if (!steamClient.isSteamInitialized() || !greenworks || !friendSteamId) {
            return { sent: false };
        }
        const targetLobby = lobbyId || steamClient.getCurrentLobbyId() || "";
        let sent = false;
        ensureP2PSessionAccepted(steamClient.normalizeSteamId(friendSteamId));
        try {
            if (targetLobby && steamClient.isRealSteamLobbyId(targetLobby) && typeof greenworks.inviteUserToLobby === "function") {
                sent = Boolean(greenworks.inviteUserToLobby(targetLobby, friendSteamId));
                logInfo(`Sent native Steam lobby invite to ${friendSteamId} for lobby ${targetLobby} (sent=${sent})`);
            }
        } catch (e) {
            logWarn("inviteUserToLobby error: " + (e.message || e));
        }
        return { sent };
    });

    ipcMain.handle("steam:mp:send-friend-signal", async (event, { friendSteamId, lobbyId, data }) => {
        const greenworks = steamClient.getGreenworks();
        if (!steamClient.isSteamInitialized() || !greenworks || !data) {
            return { sent: false };
        }
        if (lobbyId && steamClient.isRealSteamLobbyId(lobbyId) && !steamClient.getCurrentLobbyId()) {
            steamClient.setCurrentLobbyId(steamClient.normalizeSteamId(lobbyId));
        }

        let targetId = steamClient.normalizeSteamId(friendSteamId || steamClient.getCurrentLobbyHostId() || "");
        const curLobby = steamClient.getCurrentLobbyId();
        if ((!targetId || targetId === "host") && steamClient.isRealSteamLobbyId(curLobby)) {
            const ownerId = steamClient.getLobbyOwnerSteamId(curLobby);
            if (ownerId) {
                targetId = ownerId;
                if (steamClient.getLobbyRole() === "client") {
                    steamClient.setCurrentLobbyHostId(ownerId);
                }
            }
        }
        if (!targetId) {
            return { sent: false };
        }

        // Primary transport: Native Steamworks P2P (Channel 0 reliable, Channel 1 unreliable cursor)
        if (sendViaSteamP2P(targetId, data)) {
            return { sent: true, transport: "steam-p2p" };
        }

        // Secondary fallback transport: Single-Lobby Metadata Channel
        const queueKey = steamClient.getLobbyRole() === "client" ? steamClient.getCurrentLobbyHostId() || targetId : targetId;
        const { seq, flushed } = enqueueLobbySignal(queueKey, data);
        if (steamClient.isRealSteamLobbyId(curLobby)) {
            startLobbyPollTimer();
        }
        return { sent: true, flushed, seq, transport: "lobby-data" };
    });

    // =========================================================================
    // TCP / Direct Network Handlers
    // =========================================================================

    ipcMain.handle("mp:net:host-start", async (event, { port } = {}) => {
        return await startTcpHost(port || 27080);
    });

    ipcMain.handle("mp:net:host-stop", async () => {
        stopTcpHost();
        return { stopped: true };
    });

    ipcMain.handle("mp:net:host-send", async (event, { peerId, message }) => {
        return sendFromHost(peerId, message);
    });

    ipcMain.handle("mp:net:host-broadcast-except", async (event, { excludePeerId, message }) => {
        return broadcastExcept(excludePeerId, message);
    });

    ipcMain.handle("mp:net:client-connect", async (event, { host, port, timeoutMs }) => {
        return await connectTcpClient(host, port, timeoutMs || 6000);
    });

    ipcMain.handle("mp:net:client-send", async (event, { message }) => {
        return sendFromClient(message);
    });

    ipcMain.handle("mp:net:client-disconnect", async () => {
        disconnectTcpClient();
        return { disconnected: true };
    });
}

module.exports = {
    registerIpcHandlers,
};
