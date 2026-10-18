/**
 * @file src/multiplayer/mod.js
 * @description Central cooperative multiplayer lifecycle and coordination class extending `shapez.Mod`.
 * 
 * Orchestrates:
 * 1. Mod initialization and registration with shapez.io game engine.
 * 2. IPC bridge event subscriptions for Steam and TCP networking.
 * 3. Hosting and joining lifecycle management with session state tracking.
 * 4. Delegation to specialized modular subsystems:
 *    - HUD rendering (`src/multiplayer/hud/hud_multiplayer.js`)
 *    - Action synchronization (`src/multiplayer/sync/actions.js`)
 *    - Hub reconciliation (`src/multiplayer/sync/hub_sync.js`)
 *    - World dump hydration & savegame isolation (`src/multiplayer/sync/world_dump.js`)
 *    - Live cursors & ghost building rendering (`src/multiplayer/sync/cursors.js`)
 *    - GameLogic hooks (`src/multiplayer/sync/game_hooks.js`)
 *    - UI dialogs, modals & toasts (`src/multiplayer/ui/dialogs.js`)
 *    - CSS injection (`src/multiplayer/ui/styles.js`)
 */

const { METADATA, PLAYER_COLORS } = require("./constants");
const { encodeJoinCode, decodeJoinCode } = require("./join_code");
const { HUDMultiplayer } = require("./hud/hud_multiplayer");
const { injectStyles } = require("./ui/styles");
const dialogs = require("./ui/dialogs");
const actions = require("./sync/actions");
const hubSync = require("./sync/hub_sync");
const worldDump = require("./sync/world_dump");
const cursors = require("./sync/cursors");
const gameHooks = require("./sync/game_hooks");

/**
 * Shapez.io mod implementation class managing cooperative multiplayer session state.
 */
class Mod extends (typeof shapez !== "undefined" && shapez.Mod ? shapez.Mod : class {}) {
    /**
     * Initializes the mod instance, state structures, UI hooks, and IPC event listeners.
     */
    init() {
        window.$shapezMultiplayerMod = this;

        this.role = "none"; // "none" | "host" | "client"
        this.mode = "coop";
        this.steamStatus = {
            initialized: false,
            profile: {
                steamId: "local_player",
                name: "Player",
                isSteam: false,
            },
            launchCmd: "",
            localIps: [],
            hostPort: 0,
        };

        this.lobbyId = "";
        this.hostEndpoint = "";
        this.hostSteamId = "";
        this.joinCode = "";

        // Peer tracking: peerId -> { peerId, steamId, name, color, transport, ready, lastWelcomeSentAt, playerId }
        this.peers = new Map();
        // Remote players: playerId -> { id, name, color, isHost, x, y, renderX, renderY, layer, buildingId, variant, rotation, rotationVariant, lastUpdate }
        this.remotePlayers = new Map();
        this.activePings = [];
        this.clientChunkBuffer = new Map();
        this.pendingWelcomes = [];

        this.currentRoot = null;
        this.currentHud = null;
        this.isApplyingRemote = false;
        this.isInsidePlaceBuilding = false;
        this.pendingActionsQueue = [];
        this.lastHubSyncTime = 0;
        this.activeCoopSavegame = null;
        this.clientWorldLoaded = false;
        this.assignedPlayerId = "";
        this.assignedPlayerName = "";
        this.assignedColor = PLAYER_COLORS[1];
        this.lastCursorStateKey = "";
        this.lastCursorSentAt = 0;
        this.clientHelloTimer = null;
        this.isConnecting = false;
        this.joinOverlayEl = null;
        this.modalEl = null;
        this.updateInfo = null;
        this.bridgeAvailable = null;

        this.injectStyles();
        this.setupIpcListeners();
        this.setupGameHooks();
        this.refreshSteamStatus();
        this.checkForUpdates();

        // Register HUD element in-game
        if (this.modInterface) {
            this.modInterface.registerHudElement("multiplayer", HUDMultiplayer);
            this.modInterface.runAfterMethod(shapez.GameHUD, "draw", function (parameters) {
                if (this.parts.multiplayer) {
                    this.parts.multiplayer.draw(parameters);
                }
            });
            this.modInterface.runAfterMethod(shapez.GameHUD, "drawOverlays", function (parameters) {
                if (this.parts.multiplayer) {
                    this.parts.multiplayer.drawOverlays(parameters);
                }
            });

            if (typeof shapez !== "undefined" && shapez.MainMenuState) {
                const self = this;
                this.modInterface.runAfterMethod(shapez.MainMenuState, "renderMainMenu", function () {
                    self.enhanceMainMenu(this);
                });
                this.modInterface.runAfterMethod(shapez.MainMenuState, "onEnter", function () {
                    self.enhanceMainMenu(this);
                });
            }
        }

        if (this.signals && this.signals.stateEntered) {
            this.signals.stateEntered.add(state => {
                if (state && state.key === "MainMenuState") {
                    if (this.isSessionActive() && !this.isConnecting) {
                        this.logInfo("Returned to Main Menu from active game - terminating background multiplayer session.");
                        this.stopSession(false);
                    }
                    this.enhanceMainMenu(state);
                    setTimeout(() => this.enhanceMainMenu(state), 40);
                    setTimeout(() => this.enhanceMainMenu(state), 200);
                }
            });
        }
    }

    logInfo(message) {
        console.log("[Steam MP]", message);
        if (typeof ipcRenderer !== "undefined" && typeof ipcRenderer.invoke === "function") {
            try {
                const p = ipcRenderer.invoke("steam:mp:log", { level: "INFO", message });
                if (p && typeof p.catch === "function") p.catch(() => {});
            } catch {}
        }
    }

    logWarn(message) {
        console.warn("[Steam MP]", message);
        if (typeof ipcRenderer !== "undefined" && typeof ipcRenderer.invoke === "function") {
            try {
                const p = ipcRenderer.invoke("steam:mp:log", { level: "WARN", message });
                if (p && typeof p.catch === "function") p.catch(() => {});
            } catch {}
        }
    }

    async refreshSteamStatus() {
        if (typeof ipcRenderer === "undefined") {
            this.bridgeAvailable = false;
            return;
        }
        try {
            const status = await ipcRenderer.invoke("steam:mp:get-status");
            if (status) {
                this.bridgeAvailable = true;
                this.steamStatus = status;
                this.logInfo(
                    `Loaded Steam Status: initialized=${status.initialized} steamId=${status.profile?.steamId} name=${status.profile?.name}`
                );
                this.updateMainMenuBadge();

                if (status.launchCmd && !this.handledLaunchCmd) {
                    this.handledLaunchCmd = true;
                    const ipMatch = status.launchCmd.match(/\+connect_ip\s+([^\s]+)/);
                    const lobbyMatch = status.launchCmd.match(/\+connect_lobby\s+([^\s]+)/);
                    if (ipMatch && ipMatch[1]) {
                        this.joinByCodeOrAddress(ipMatch[1]);
                    } else if (lobbyMatch && lobbyMatch[1]) {
                        this.joinSteamLobby(lobbyMatch[1]);
                    }
                }
            }
        } catch (err) {
            this.bridgeAvailable = false;
            console.warn("[Steam MP] Could not query steam:mp:get-status (Bridge may not be installed):", err);
            this.updateMainMenuBadge();
        }
    }

    async checkForUpdates() {
        try {
            if (typeof fetch === "undefined") return;
            const res = await fetch(
                "https://api.github.com/repos/mjyousif/shapez-steam-multiplayer-mod/releases/latest",
                {
                    headers: { Accept: "application/vnd.github.v3+json" },
                }
            );
            if (!res.ok) return;
            const data = await res.json();
            if (!data || !data.tag_name) return;

            const latestTag = String(data.tag_name).replace(/^v/i, "").trim();
            const currentVer = String(METADATA.version).replace(/^v/i, "").trim();

            if (this.compareVersions(latestTag, currentVer) > 0) {
                this.updateInfo = {
                    version: latestTag,
                    url: data.html_url || "https://github.com/mjyousif/shapez-steam-multiplayer-mod/releases/latest",
                    name: data.name || `v${latestTag}`,
                    isNewer: true,
                };
                this.logInfo(`Update available: v${latestTag} (current: v${currentVer})`);
                this.updateMainMenuBadge();
            }
        } catch {}
    }

    compareVersions(vA, vB) {
        const pa = String(vA).split(".").map(x => parseInt(x, 10) || 0);
        const pb = String(vB).split(".").map(x => parseInt(x, 10) || 0);
        const max = Math.max(pa.length, pb.length);
        for (let i = 0; i < max; i++) {
            const a = pa[i] || 0;
            const b = pb[i] || 0;
            if (a > b) return 1;
            if (a < b) return -1;
        }
        return 0;
    }

    openExternalUrl(url) {
        try {
            if (typeof require !== "undefined") {
                const { shell } = require("electron");
                if (shell && shell.openExternal) {
                    shell.openExternal(url);
                    return;
                }
            }
        } catch {}
        try {
            window.open(url, "_blank");
        } catch {}
    }

    setupIpcListeners() {
        if (typeof ipcRenderer === "undefined") return;

        ipcRenderer.on("steam:mp:event", (event, data) => {
            if (!data) return;
            this.handleSteamEvent(data);
        });

        ipcRenderer.on("mp:net:event", (event, data) => {
            if (!data) return;
            this.handleNetEvent(data);
        });
    }

    handleSteamEvent(ev) {
        switch (ev.type) {
            case "lobby-invite": {
                this.showInviteToast({
                    fromName: ev.inviterName || ev.inviterId,
                    fromSteamId: ev.inviterId,
                    lobbyId: ev.lobbyId,
                    joinCode: "",
                });
                break;
            }
            case "lobby-join-requested": {
                if (ev.lobbyId) {
                    this.joinSteamLobby(ev.lobbyId, ev.friendId);
                }
                break;
            }
            case "rich-presence-join-requested": {
                const connectStr = ev.connect || "";
                const ipMatch = connectStr.match(/\+connect_ip\s+([^\s]+)/);
                const lobbyMatch = connectStr.match(/\+connect_lobby\s+([^\s]+)/);
                if (ipMatch && ipMatch[1]) {
                    this.joinByCodeOrAddress(ipMatch[1]);
                } else if (lobbyMatch && lobbyMatch[1]) {
                    this.joinSteamLobby(lobbyMatch[1], ev.friendId);
                } else if (ev.friendId) {
                    this.connectToHost({ endpoints: [], lobbyId: "", hostSteamId: ev.friendId });
                }
                break;
            }
            case "steam-friend-signal": {
                this.handleSteamFriendSignal(ev.fromSteamId, ev.fromName, ev.data);
                break;
            }
        }
    }

    async handleSteamFriendSignal(fromSteamId, fromName, data) {
        if (!data || !data.kind) return;

        switch (data.kind) {
            case "INVITE": {
                this.showInviteToast({
                    fromName: data.hostName || fromName || fromSteamId,
                    fromSteamId,
                    lobbyId: data.lobbyId,
                    joinCode: data.joinCode,
                });
                break;
            }
            case "STEAM_PACKET": {
                if (this.role === "host") {
                    const peerId = "steam_" + fromSteamId;
                    if (!this.peers.has(peerId)) {
                        this.registerHostPeer(peerId, "steam-p2p", fromSteamId);
                    }
                    this.onHostReceivedPeerMessage(peerId, data.packet);
                } else if (this.role === "client") {
                    this.onClientReceivedMessage(data.packet);
                }
                break;
            }
        }
    }

    handleNetEvent(ev) {
        switch (ev.type) {
            case "host-peer-connected": {
                if (this.role !== "host") return;
                this.registerHostPeer(ev.peerId, "tcp", "");
                break;
            }
            case "host-peer-message": {
                if (this.role !== "host") return;
                this.onHostReceivedPeerMessage(ev.peerId, ev.message);
                break;
            }
            case "host-peer-disconnected": {
                if (this.role !== "host") return;
                this.handleHostPeerDisconnected(ev.peerId);
                break;
            }
            case "client-message": {
                if (this.role !== "client") return;
                this.onClientReceivedMessage(ev.message);
                break;
            }
            case "client-disconnected": {
                if (this.role !== "client") return;
                this.onClientDisconnected();
                break;
            }
        }
    }

    isSessionActive() {
        return this.role === "host" || this.role === "client";
    }

    getLocalPlayerInfo() {
        const p = this.steamStatus?.profile || {};
        return {
            id:
                this.role === "client" && this.assignedPlayerId
                    ? this.assignedPlayerId
                    : p.steamId || "local_player",
            name:
                this.role === "client" && this.assignedPlayerName
                    ? this.assignedPlayerName
                    : p.name || "Player",
            color: this.role === "host" ? PLAYER_COLORS[0] : this.assignedColor || PLAYER_COLORS[1],
            isHost: this.role === "host",
            isLocal: true,
        };
    }

    getAllPlayersList() {
        const local = this.getLocalPlayerInfo();
        const list = [local];
        for (const [, rp] of this.remotePlayers) {
            if (rp.id !== local.id) {
                list.push({
                    id: rp.id,
                    name: rp.name,
                    color: rp.color || PLAYER_COLORS[1],
                    isHost: Boolean(rp.isHost),
                    isLocal: false,
                });
            }
        }
        return list;
    }

    async startHostingSession({ savegame = null, port = 27080, mode = "coop" } = {}) {
        await this.stopSession(false);
        await this.refreshSteamStatus();

        this.role = "host";
        this.mode = mode;

        const netInfo = await ipcRenderer.invoke("mp:net:host-start", { port });
        const primaryEndpoint = (netInfo.endpoints && netInfo.endpoints[0]) || "127.0.0.1:" + netInfo.port;
        const allEndpoints = (netInfo.endpoints || [primaryEndpoint]).join(",");
        this.hostEndpoint = allEndpoints;

        const lobbyInfo = await ipcRenderer.invoke("steam:mp:create-lobby", {
            maxPlayers: 8,
            mode,
            endpoint: allEndpoints,
        });

        this.lobbyId = lobbyInfo.lobbyId;
        this.hostSteamId = lobbyInfo.hostId;
        this.joinCode = encodeJoinCode(allEndpoints, this.lobbyId, this.hostSteamId);

        this.logInfo(
            `Hosting started: port=${netInfo.port} endpoints=${allEndpoints} lobbyId=${this.lobbyId} hostSteamId=${this.hostSteamId}`
        );
        this.showToast(`Hosting Co-op on port ${netInfo.port} (Steam Lobby Ready)`);

        const activeState = this.app.stateMgr.currentState;
        if (!activeState || activeState.key !== "InGameState") {
            let targetSave = savegame;
            if (!targetSave) {
                targetSave = this.app.savegameMgr.createNewSavegame();
            } else if (typeof targetSave.readAsync === "function" && !targetSave.currentData?.dump) {
                await targetSave.readAsync();
            }
            this.app.stateMgr.moveToState("InGameState", { savegame: targetSave });
        } else if (this.currentHud) {
            this.currentHud.refreshUI();
            this.currentHud.appendChatLine(
                "System",
                "#38bdf8",
                `Co-op Server started on port ${netInfo.port}. Click 'Invite Friends' or 'Copy Code' to invite teammates!`,
                true
            );
        }

        return {
            port: netInfo.port,
            endpoints: netInfo.endpoints,
            lobbyId: this.lobbyId,
            joinCode: this.joinCode,
        };
    }

    async joinSteamLobby(lobbyId, hostFriendSteamId = "") {
        try {
            this.showToast("Joining Steam Co-op Lobby...");
            this.showJoinProgressModal("Joining Steam Co-op Lobby...");
            const joinArg = hostFriendSteamId ? { lobbyId, hostSteamId: hostFriendSteamId } : lobbyId;
            const info = await ipcRenderer.invoke("steam:mp:join-lobby", joinArg);
            const endpointsStr = info.endpoints || "";
            const hostId = info.hostId || hostFriendSteamId || "";
            const resolvedLobbyId = info.lobbyId || lobbyId || "";
            if (endpointsStr || hostId || resolvedLobbyId) {
                await this.connectToHost({
                    endpoints: endpointsStr ? endpointsStr.split(",").filter(Boolean) : [],
                    lobbyId: resolvedLobbyId,
                    hostSteamId: hostId,
                    alreadyJoinedLobby: true,
                });
            } else {
                this.isConnecting = false;
                this.closeJoinProgressModal();
                this.showToast("Could not resolve host address from lobby. Try using Join Code or IP:Port.");
            }
        } catch (err) {
            this.isConnecting = false;
            this.closeJoinProgressModal();
            this.logWarn("Failed to join Steam lobby: " + (err.message || err));
            this.showToast("Failed to join Steam Lobby: " + (err.message || err));
        }
    }

    async joinByCodeOrAddress(inputStr) {
        const decoded = decodeJoinCode(inputStr);
        if (!decoded) {
            this.showToast("Invalid Join Code or IP:Port");
            return;
        }
        const endpoints = decoded.endpoint ? decoded.endpoint.split(",").filter(Boolean) : [];
        if (decoded.host && decoded.port) {
            const direct = `${decoded.host}:${decoded.port}`;
            if (!endpoints.includes(direct)) {
                endpoints.unshift(direct);
            }
        }
        try {
            await this.connectToHost({
                endpoints,
                lobbyId: decoded.lobbyId,
                hostSteamId: decoded.hostSteamId,
            });
        } catch {
            this.isConnecting = false;
            this.closeJoinProgressModal();
        }
    }

    async connectToHost({ endpoints = [], lobbyId = "", hostSteamId = "", alreadyJoinedLobby = false }) {
        await this.stopSession(false);
        await this.refreshSteamStatus();

        this.isConnecting = true;
        this.showJoinProgressModal("Connecting to Host...");

        this.role = "client";
        this.lobbyId = lobbyId;
        this.hostSteamId = hostSteamId;
        this.clientTransport = "";
        this.clientWorldLoaded = false;

        if (!alreadyJoinedLobby && (lobbyId || hostSteamId) && typeof ipcRenderer !== "undefined") {
            try {
                const joinArg = hostSteamId ? { lobbyId, hostSteamId } : lobbyId;
                const lobbyInfo = await ipcRenderer.invoke("steam:mp:join-lobby", joinArg);
                if (lobbyInfo) {
                    if (lobbyInfo.lobbyId) this.lobbyId = lobbyInfo.lobbyId;
                    if (lobbyInfo.hostId && !this.hostSteamId) this.hostSteamId = lobbyInfo.hostId;
                    if (lobbyInfo.endpoints) {
                        for (const ep of lobbyInfo.endpoints.split(",").filter(Boolean)) {
                            if (!endpoints.includes(ep)) {
                                endpoints.push(ep);
                            }
                        }
                    }
                }
            } catch (e) {
                this.logWarn("join-lobby pre-step warning: " + (e.message || e));
            }
        }

        let connected = false;
        const localSteamId = this.getLocalPlayerInfo().id;
        const isRemoteSteamHost = Boolean(this.hostSteamId && this.hostSteamId !== localSteamId);

        const cleanEndpoints = Array.from(new Set(endpoints.map(e => e.trim()).filter(Boolean)));
        for (const ep of cleanEndpoints) {
            const [host, portStr] = ep.split(":");
            const port = Number(portStr) || 27080;
            if (!host) continue;
            const isLoopback = host === "127.0.0.1" || host === "localhost";
            if (isRemoteSteamHost && isLoopback) continue;
            const tcpTimeout = isRemoteSteamHost ? 1200 : 3000;
            try {
                this.updateJoinProgressModal(`Connecting to ${host}:${port}...`);
                this.showToast(`Connecting to ${host}:${port}...`);
                await ipcRenderer.invoke("mp:net:client-connect", {
                    host,
                    port,
                    timeoutMs: tcpTimeout,
                });
                this.clientTransport = "tcp";
                this.hostEndpoint = `${host}:${port}`;
                connected = true;
                this.logInfo(`Connected to Host via TCP ${host}:${port}`);
                break;
            } catch (e) {
                this.logWarn(`TCP connect to ${host}:${port} failed: ${e.message}`);
            }
        }

        if (!connected && (this.hostSteamId || this.lobbyId)) {
            this.clientTransport = "steam-p2p";
            if (!this.hostSteamId) this.hostSteamId = "host";
            connected = true;
            this.updateJoinProgressModal("Negotiating Steamworks P2P connection...");
            this.logInfo(`Connecting to Host ${this.hostSteamId} via Native Steam P2P`);
        }

        if (!connected) {
            this.isConnecting = false;
            this.closeJoinProgressModal();
            this.role = "none";
            this.showToast("Could not connect to Host. Check Join Code or Steam Lobby.");
            throw new Error("Could not connect to Host");
        }

        const local = this.getLocalPlayerInfo();
        const sendHello = () => {
            if (this.role !== "client" || this.clientWorldLoaded) return;
            this.logInfo(`Sending HELLO to Host via ${this.clientTransport}`);
            this.sendToHost({
                type: "HELLO",
                playerId: local.id,
                name: local.name,
                version: METADATA.version,
            });
        };
        sendHello();

        if (this.clientTransport === "steam-p2p") {
            let retries = 0;
            this.clientHelloTimer = setInterval(() => {
                retries++;
                if (this.role !== "client" || this.clientWorldLoaded || retries > 4) {
                    clearInterval(this.clientHelloTimer);
                    this.clientHelloTimer = null;
                    return;
                }
                sendHello();
            }, 1500);
        }

        this.updateJoinProgressModal("Connected! Synchronizing factory world...");
        this.showToast("Connected to Host! Synchronizing factory world...");
    }

    async stopSession(notifyUser = true) {
        if (this.clientHelloTimer) {
            clearInterval(this.clientHelloTimer);
            this.clientHelloTimer = null;
        }
        this.isConnecting = false;
        this.closeJoinProgressModal();

        const prevRole = this.role;
        this.role = "none";
        this.activeCoopSavegame = null;
        this.clientWorldLoaded = false;
        this.assignedPlayerId = "";
        this.assignedPlayerName = "";
        this.lastCursorStateKey = "";
        this.lobbyId = "";
        this.joinCode = "";
        this.peers.clear();
        this.remotePlayers.clear();
        this.clientChunkBuffer.clear();
        this.pendingActionsQueue = [];

        if (this.currentHud) {
            this.currentHud.refreshUI();
        }

        if (prevRole === "host") {
            try {
                await ipcRenderer.invoke("mp:net:host-stop");
                await ipcRenderer.invoke("steam:mp:leave-lobby");
            } catch {}
        } else if (prevRole === "client") {
            try {
                await ipcRenderer.invoke("mp:net:client-disconnect");
                await ipcRenderer.invoke("steam:mp:leave-lobby");
            } catch {}
        }

        if (notifyUser) {
            this.showToast("Disconnected from Co-op session.");
        }
    }

    registerHostPeer(peerId, transport, steamId = "") {
        let peer = this.peers.get(peerId);
        if (!peer) {
            const colorIdx = (this.peers.size + 1) % PLAYER_COLORS.length;
            peer = {
                peerId,
                steamId: steamId || peerId,
                name: "Player " + (this.peers.size + 2),
                color: PLAYER_COLORS[colorIdx],
                transport,
                ready: false,
            };
            this.peers.set(peerId, peer);
        } else {
            peer.transport = transport || peer.transport;
            if (steamId) peer.steamId = steamId;
        }
        return peer;
    }

    handleHostPeerDisconnected(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer) return;
        this.peers.delete(peerId);
        if (peer.playerId) {
            this.remotePlayers.delete(peer.playerId);
        }
        this.broadcastFromHost({
            type: "ROSTER_UPDATE",
            players: this.buildRosterPayload(),
        });
        if (this.currentHud) {
            this.currentHud.refreshUI();
            this.currentHud.appendChatLine("System", "#f43f5e", `${peer.name} left the factory.`, true);
        }
    }

    onClientDisconnected() {
        if (this.role !== "client") return;
        if (this.clientHelloTimer) {
            clearInterval(this.clientHelloTimer);
            this.clientHelloTimer = null;
        }
        this.isConnecting = false;
        this.closeJoinProgressModal();
        this.role = "none";
        this.clientWorldLoaded = false;
        this.assignedPlayerId = "";
        this.assignedPlayerName = "";
        this.remotePlayers.clear();
        this.activeCoopSavegame = null;
        if (this.currentHud) {
            this.currentHud.refreshUI();
            this.currentHud.appendChatLine("System", "#f43f5e", "Disconnected from Host.", true);
        }
        this.showToast("Disconnected from Co-op Host.");
    }

    sendRawToPeer(peer, message) {
        if (!peer) return;
        if (peer.transport === "tcp") {
            ipcRenderer.invoke("mp:net:host-send", { peerId: peer.peerId, message });
        } else if (peer.steamId) {
            ipcRenderer.invoke("steam:mp:send-friend-signal", {
                friendSteamId: peer.steamId,
                data: { kind: "STEAM_PACKET", packet: message },
            });
        }
    }

    sendChunkedToPeer(peer, message) {
        worldDump.sendChunkedToPeer(this, peer, message);
    }

    broadcastFromHost(message, excludePeerId = null) {
        if (this.role !== "host") return;
        for (const [peerId, peer] of this.peers) {
            if (peerId === excludePeerId) continue;
            this.sendRawToPeer(peer, message);
        }
    }

    sendToHost(message) {
        if (this.role !== "client") return;
        if (this.clientTransport === "tcp") {
            ipcRenderer.invoke("mp:net:client-send", { message });
        } else if (this.hostSteamId) {
            ipcRenderer.invoke("steam:mp:send-friend-signal", {
                friendSteamId: this.hostSteamId,
                data: { kind: "STEAM_PACKET", packet: message },
            });
        }
    }

    dispatchNetworkAction(actionMsg) {
        if (!this.isSessionActive()) return;
        if (this.role === "host") {
            this.broadcastFromHost(actionMsg);
        } else if (this.role === "client") {
            this.sendToHost(actionMsg);
        }
    }

    buildRosterPayload() {
        const local = this.getLocalPlayerInfo();
        const roster = [
            {
                id: local.id,
                name: local.name,
                color: PLAYER_COLORS[0],
                isHost: true,
            },
        ];
        for (const [, peer] of this.peers) {
            if (peer.playerId) {
                roster.push({
                    id: peer.playerId,
                    name: peer.name,
                    color: peer.color,
                    isHost: false,
                });
            }
        }
        return roster;
    }

    onHostReceivedPeerMessage(peerId, msg) {
        if (!msg || !msg.type) return;
        const peer = this.peers.get(peerId);
        if (!peer) return;

        switch (msg.type) {
            case "HELLO": {
                const now = performance.now();
                if (peer.ready && peer.lastWelcomeSentAt && now - peer.lastWelcomeSentAt < 8000) {
                    break;
                }
                const hostLocal = this.getLocalPlayerInfo();
                let resolvedId = msg.playerId || peerId;
                let resolvedName = msg.name || peer.name;

                let collision = resolvedId === hostLocal.id;
                if (!collision) {
                    for (const [otherPeerId, otherPeer] of this.peers) {
                        if (otherPeerId !== peerId && otherPeer.playerId === resolvedId) {
                            collision = true;
                            break;
                        }
                    }
                }
                if (collision) {
                    resolvedId = `${resolvedId}_${peerId}`;
                    if (resolvedName === hostLocal.name) {
                        resolvedName = `${resolvedName} (2)`;
                    }
                }

                peer.playerId = resolvedId;
                peer.name = resolvedName;
                peer.ready = true;
                peer.lastWelcomeSentAt = now;

                this.remotePlayers.set(peer.playerId, {
                    id: peer.playerId,
                    name: peer.name,
                    color: peer.color,
                    isHost: false,
                    x: 0,
                    y: 0,
                    renderX: 0,
                    renderY: 0,
                    layer: "regular",
                    buildingId: null,
                    variant: null,
                    rotation: 0,
                    rotationVariant: 0,
                    lastUpdate: now,
                });

                this.sendWorldWelcomeToPeer(peer);
                this.broadcastFromHost({
                    type: "ROSTER_UPDATE",
                    players: this.buildRosterPayload(),
                });

                if (this.currentHud) {
                    this.currentHud.refreshUI();
                    this.currentHud.appendChatLine(
                        "System",
                        peer.color,
                        `${peer.name} joined the Co-op factory!`,
                        true
                    );
                }
                this.showToast(`${peer.name} joined Co-op!`);
                break;
            }
            case "REQUEST_RESYNC": {
                this.sendWorldWelcomeToPeer(peer);
                break;
            }
            case "CURSOR": {
                msg.playerId = peer.playerId || peerId;
                msg.name = peer.name;
                msg.color = peer.color;
                this.updateRemoteCursor(msg);
                this.broadcastFromHost(msg, peerId);
                break;
            }
            case "CHAT": {
                const chatPacket = {
                    type: "CHAT",
                    senderName: peer.name,
                    color: peer.color,
                    text: String(msg.text || "").slice(0, 180),
                };
                if (this.currentHud) {
                    this.currentHud.appendChatLine(chatPacket.senderName, chatPacket.color, chatPacket.text);
                }
                this.broadcastFromHost(chatPacket, peerId);
                break;
            }
            case "PING": {
                const pingPacket = {
                    type: "PING",
                    x: Number(msg.x) || 0,
                    y: Number(msg.y) || 0,
                    name: peer.name,
                    color: peer.color,
                };
                this.addMapPing(pingPacket);
                this.broadcastFromHost(pingPacket, peerId);
                break;
            }
            case "ACT_PLACE":
            case "ACT_DELETE":
            case "ACT_SIGNAL":
            case "ACT_LEVER":
            case "ACT_CLEAR_BELTS":
            case "ACT_UPGRADE":
            case "ACT_WAYPOINTS":
            case "ACT_PINS": {
                this.applyRemoteAction(msg);
                this.broadcastFromHost(msg, peerId);
                break;
            }
        }
    }

    sendWorldWelcomeToPeer(peer) {
        worldDump.sendWorldWelcomeToPeer(this, peer);
    }

    onClientReceivedMessage(msg) {
        if (!msg || !msg.type) return;

        if (this.clientHelloTimer) {
            clearInterval(this.clientHelloTimer);
            this.clientHelloTimer = null;
        }

        if (msg.type === "CHUNK_PART") {
            worldDump.handleChunkPart(this, msg, fullMsg => {
                this.onClientReceivedMessage(fullMsg);
            });
            return;
        }

        switch (msg.type) {
            case "WELCOME_WORLD": {
                this.clientWorldLoaded = true;
                if (this.clientHelloTimer) {
                    clearInterval(this.clientHelloTimer);
                    this.clientHelloTimer = null;
                }
                this.logInfo(`Received WELCOME_WORLD from Host (${msg.hostName || msg.hostId})`);
                this.updateJoinProgressModal("Loading factory world & warming up simulation...", 100);
                if (msg.assignedPlayerId) {
                    this.assignedPlayerId = msg.assignedPlayerId;
                }
                if (msg.assignedPlayerName) {
                    this.assignedPlayerName = msg.assignedPlayerName;
                }
                this.assignedColor = msg.assignedColor || PLAYER_COLORS[1];
                this.mode = msg.mode || "coop";
                if (Array.isArray(msg.roster)) {
                    this.applyRosterUpdate(msg.roster);
                }
                this.loadHostWorldDump(msg.dump, msg.hostName);
                break;
            }
            case "ROSTER_UPDATE": {
                if (Array.isArray(msg.players)) {
                    this.applyRosterUpdate(msg.players);
                }
                break;
            }
            case "CURSOR": {
                this.updateRemoteCursor(msg);
                break;
            }
            case "CHAT": {
                if (this.currentHud) {
                    this.currentHud.appendChatLine(msg.senderName, msg.color, msg.text);
                }
                break;
            }
            case "PING": {
                this.addMapPing(msg);
                break;
            }
            case "SYNC_HUB": {
                this.applyHubSync(msg);
                break;
            }
            case "ACT_PLACE":
            case "ACT_DELETE":
            case "ACT_SIGNAL":
            case "ACT_LEVER":
            case "ACT_CLEAR_BELTS":
            case "ACT_UPGRADE":
            case "ACT_WAYPOINTS":
            case "ACT_PINS": {
                this.applyRemoteAction(msg);
                break;
            }
        }
    }

    applyRosterUpdate(roster) {
        const localId = this.getLocalPlayerInfo().id;
        const activeIds = new Set();
        for (const p of roster) {
            if (p.id === localId) {
                if (p.color) this.assignedColor = p.color;
                continue;
            }
            activeIds.add(p.id);
            let existing = this.remotePlayers.get(p.id);
            if (!existing) {
                existing = {
                    id: p.id,
                    name: p.name,
                    color: p.color || PLAYER_COLORS[0],
                    isHost: Boolean(p.isHost),
                    x: 0,
                    y: 0,
                    renderX: 0,
                    renderY: 0,
                    layer: "regular",
                    buildingId: null,
                    variant: null,
                    rotation: 0,
                    rotationVariant: 0,
                    lastUpdate: performance.now(),
                };
                this.remotePlayers.set(p.id, existing);
            } else {
                existing.name = p.name;
                existing.color = p.color || existing.color;
                existing.isHost = Boolean(p.isHost);
            }
        }
        for (const id of Array.from(this.remotePlayers.keys())) {
            if (!activeIds.has(id)) {
                this.remotePlayers.delete(id);
            }
        }
        if (this.currentHud) {
            this.currentHud.refreshUI();
        }
    }

    async loadHostWorldDump(worldDumpData, hostName) {
        return await worldDump.loadHostWorldDump(this, worldDumpData, hostName);
    }

    requestWorldResync() {
        if (this.role === "client") {
            this.showToast("Requesting factory resync from Host...");
            this.sendToHost({ type: "REQUEST_RESYNC" });
        }
    }

    attachGameRoot(root, hudPart) {
        this.isConnecting = false;
        this.closeJoinProgressModal();
        this.currentRoot = root;
        this.currentHud = hudPart;

        if (this.pendingActionsQueue.length > 0) {
            const queue = this.pendingActionsQueue.slice();
            this.pendingActionsQueue = [];
            for (const act of queue) {
                this.applyRemoteAction(act);
            }
        }

        if (this.role === "host" && this.pendingWelcomes && this.pendingWelcomes.length > 0) {
            const list = this.pendingWelcomes.slice();
            this.pendingWelcomes = [];
            for (const peer of list) {
                this.sendWorldWelcomeToPeer(peer);
            }
        }

        if (root && root.signals) {
            root.signals.storyGoalCompleted.add(() => {
                if (this.role === "host" && !this.isApplyingRemote) {
                    this.broadcastHubSync(root);
                }
            });
            root.signals.upgradePurchased.add(() => {
                if (this.role === "host" && !this.isApplyingRemote) {
                    this.broadcastHubSync(root);
                }
            });
        }
    }

    detachGameRoot(root) {
        if (this.currentRoot === root) {
            this.currentRoot = null;
            this.currentHud = null;
        }
    }

    setupGameHooks() {
        gameHooks.setupGameHooks(this);
    }

    applyRemoteAction(msg) {
        actions.applyRemoteAction(this, msg);
    }

    onInGameTick(root, now) {
        if (this.role === "host" && now - this.lastHubSyncTime >= 2000) {
            this.lastHubSyncTime = now;
            this.broadcastHubSync(root);
        }
    }

    broadcastHubSync(root) {
        hubSync.broadcastHubSync(this, root);
    }

    applyHubSync(msg) {
        hubSync.applyHubSync(this, msg);
    }

    broadcastLocalCursorState(root) {
        cursors.broadcastLocalCursorState(this, root);
    }

    updateRemoteCursor(msg) {
        cursors.updateRemoteCursor(this, msg);
    }

    sendChatMessage(text) {
        cursors.sendChatMessage(this, text);
    }

    sendMapPingAtCursor() {
        cursors.sendMapPingAtCursor(this);
    }

    addMapPing(ping) {
        cursors.addMapPing(this, ping);
    }

    drawWorldSpacePeers(root, parameters) {
        cursors.drawWorldSpacePeers(this, root, parameters);
    }

    drawScreenSpaceOverlays(root, parameters) {
        cursors.drawScreenSpaceOverlays(this, root, parameters);
    }

    enhanceMainMenu(mainMenuState) {
        dialogs.enhanceMainMenu(this, mainMenuState);
    }

    updateMainMenuBadge() {
        dialogs.updateMainMenuBadge(this);
    }

    openMultiplayerModal(mainMenuState = null) {
        dialogs.openMultiplayerModal(this, mainMenuState);
    }

    openLogsModal() {
        dialogs.openLogsModal(this);
    }

    closeMultiplayerModal() {
        dialogs.closeMultiplayerModal(this);
    }

    showJoinProgressModal(initialStatus = "Connecting to Host...") {
        dialogs.showJoinProgressModal(this, initialStatus);
    }

    updateJoinProgressModal(statusText, progressPercent = null) {
        dialogs.updateJoinProgressModal(this, statusText, progressPercent);
    }

    closeJoinProgressModal() {
        dialogs.closeJoinProgressModal(this);
    }

    copyJoinInfoToClipboard() {
        dialogs.copyJoinInfoToClipboard(this);
    }

    showInviteToast(params) {
        dialogs.showInviteToast(this, params);
    }

    showToast(text) {
        dialogs.showToast(this, text);
    }

    injectStyles() {
        injectStyles(this.modInterface);
    }
}

module.exports = {
    Mod,
};
