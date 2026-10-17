/* eslint-disable */

const METADATA = {
    website: "https://store.steampowered.com/app/1318690/shapez/",
    author: "Antigravity",
    name: "Steam Multiplayer (Co-op)",
    version: "1.0.2",
    id: "steam-multiplayer",
    description:
        "Real-time Co-op Multiplayer with Steamworks Lobbies, Friends, Overlay, WebRTC/TCP P2P, Live Cursors, and Full Factory Sync.",
    minimumGameVersion: ">=1.5.0",
    doesNotAffectSavegame: true,
};

const PLAYER_COLORS = [
    "#38bdf8", // Sky Blue
    "#f43f5e", // Rose
    "#a855f7", // Purple
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#ec4899", // Pink
    "#6366f1", // Indigo
    "#14b8a6", // Teal
];

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function encodeJoinCode(endpoint, lobbyId, hostSteamId) {
    const raw = JSON.stringify({
        e: endpoint || "",
        l: lobbyId || "",
        h: hostSteamId || "",
    });
    return btoa(unescape(encodeURIComponent(raw)));
}

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
        const json = decodeURIComponent(escape(atob(trimmed)));
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
    } catch (e) {
        return {
            endpoint: "",
            host: "127.0.0.1",
            port: 27080,
            lobbyId: trimmed,
            hostSteamId: /^\d{15,20}$/.test(trimmed) ? trimmed : "",
        };
    }
}

class HUDMultiplayer extends (typeof shapez !== "undefined" && shapez.BaseHUDPart ? shapez.BaseHUDPart : class {}) {
    createElements(parent) {
        this.container = shapez.makeDiv(
            parent,
            "ingame_HUD_Multiplayer",
            ["mpHudPanel"],
            `
            <div class="mpHudHeader">
                <div class="mpStatusDot"></div>
                <span class="mpHeaderTitle">Steam Co-op</span>
                <span class="mpPlayerCountBadge">1</span>
                <button class="mpCollapseBtn" title="Toggle Panel">–</button>
            </div>
            <div class="mpHudBody">
                <div class="mpRoster"></div>
                <div class="mpActionRow">
                    <button class="styledButton mpBtnInvite">Invite Friends</button>
                    <button class="styledButton mpBtnCopyCode">Copy Code</button>
                    <button class="styledButton mpBtnPing" title="Ping Map Location (P)">Ping [P]</button>
                    <button class="styledButton mpBtnResync" title="Resync Map from Host">Resync</button>
                </div>
                <div class="mpChatBox">
                    <div class="mpChatMessages"></div>
                    <div class="mpChatInputRow">
                        <input type="text" class="mpChatInput" placeholder="Chat with co-op team..." maxlength="180" />
                        <button class="styledButton mpChatSendBtn">Send</button>
                    </div>
                </div>
            </div>
        `
        );
    }

    initialize() {
        this.mod = window.$shapezMultiplayerMod;
        this.collapsed = false;
        this.lastCursorBroadcast = 0;

        if (this.mod) {
            this.mod.attachGameRoot(this.root, this);
        }

        const collapseBtn = this.container.querySelector(".mpCollapseBtn");
        const header = this.container.querySelector(".mpHudHeader");
        const inviteBtn = this.container.querySelector(".mpBtnInvite");
        const copyBtn = this.container.querySelector(".mpBtnCopyCode");
        const pingBtn = this.container.querySelector(".mpBtnPing");
        const resyncBtn = this.container.querySelector(".mpBtnResync");
        const chatInput = this.container.querySelector(".mpChatInput");
        const chatSendBtn = this.container.querySelector(".mpChatSendBtn");

        // Allow dragging HUD panel anywhere on screen
        if (header) {
            let isDragging = false;
            let startX = 0, startY = 0;
            let startLeft = 0, startTop = 0;

            header.style.cursor = "move";
            header.addEventListener("mousedown", ev => {
                if (ev.target === collapseBtn) return;
                isDragging = true;
                startX = ev.clientX;
                startY = ev.clientY;
                const rect = this.container.getBoundingClientRect();
                startLeft = rect.left;
                startTop = rect.top;
                this.container.style.right = "auto";
                this.container.style.bottom = "auto";
                this.container.style.left = startLeft + "px";
                this.container.style.top = startTop + "px";
                this.container.style.transform = "none";
                ev.preventDefault();
            });

            window.addEventListener("mousemove", ev => {
                if (!isDragging) return;
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                const newLeft = Math.max(10, Math.min(window.innerWidth - 120, startLeft + dx));
                const newTop = Math.max(10, Math.min(window.innerHeight - 40, startTop + dy));
                this.container.style.left = newLeft + "px";
                this.container.style.top = newTop + "px";
            });

            window.addEventListener("mouseup", () => {
                isDragging = false;
            });
        }

        collapseBtn.addEventListener("click", () => {
            this.collapsed = !this.collapsed;
            this.container.classList.toggle("collapsed", this.collapsed);
            collapseBtn.innerText = this.collapsed ? "+" : "–";
        });

        inviteBtn.addEventListener("click", () => {
            if (this.mod) this.mod.openMultiplayerModal();
        });

        copyBtn.addEventListener("click", () => {
            if (this.mod) this.mod.copyJoinInfoToClipboard();
        });

        pingBtn.addEventListener("click", () => {
            if (this.mod) this.mod.sendMapPingAtCursor();
        });

        resyncBtn.addEventListener("click", () => {
            if (this.mod) this.mod.requestWorldResync();
        });

        const sendChat = () => {
            const text = chatInput.value.trim();
            if (!text) return;
            chatInput.value = "";
            if (this.mod) {
                this.mod.sendChatMessage(text);
            }
        };

        chatSendBtn.addEventListener("click", sendChat);
        chatInput.addEventListener("keydown", ev => {
            ev.stopPropagation();
            if (ev.key === "Enter") {
                ev.preventDefault();
                sendChat();
                chatInput.blur();
            } else if (ev.key === "Escape") {
                chatInput.blur();
            }
        });

        this.keyDownHandler = ev => {
            if (document.activeElement === chatInput || document.activeElement?.tagName === "INPUT") {
                return;
            }
            if ((ev.key === "p" || ev.key === "P") && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
                if (this.mod && this.mod.isSessionActive()) {
                    this.mod.sendMapPingAtCursor();
                }
            }
        };
        window.addEventListener("keydown", this.keyDownHandler);

        this.refreshUI();
    }

    cleanup() {
        if (this.keyDownHandler) {
            window.removeEventListener("keydown", this.keyDownHandler);
            this.keyDownHandler = null;
        }
        if (this.mod && this.mod.currentHud === this) {
            this.mod.detachGameRoot(this.root);
        }
        super.cleanup();
    }

    refreshUI() {
        if (!this.container || !this.mod) return;
        const active = this.mod.isSessionActive();
        const dot = this.container.querySelector(".mpStatusDot");
        const title = this.container.querySelector(".mpHeaderTitle");
        const badge = this.container.querySelector(".mpPlayerCountBadge");
        const rosterEl = this.container.querySelector(".mpRoster");
        const resyncBtn = this.container.querySelector(".mpBtnResync");
        const copyBtn = this.container.querySelector(".mpBtnCopyCode");

        dot.classList.toggle("online", active);
        if (!active) {
            title.innerText = "Co-op (Offline)";
        } else if (this.mod.role === "host") {
            title.innerText = "Hosting Co-op";
        } else {
            title.innerText = "Connected Co-op";
        }

        resyncBtn.style.display = this.mod.role === "client" ? "inline-block" : "none";
        copyBtn.style.display = active ? "inline-block" : "none";

        const players = this.mod.getAllPlayersList();
        badge.innerText = String(players.length);

        rosterEl.innerHTML = players
            .map(
                p => `
                <div class="mpRosterItem">
                    <span class="mpColorSwatch" style="background:${p.color}"></span>
                    <span class="mpRosterName">${escapeHtml(p.name)}</span>
                    <span class="mpRosterRole">${p.isHost ? "HOST" : p.isLocal ? "YOU" : "CO-OP"}</span>
                </div>
            `
            )
            .join("");
    }

    appendChatLine(senderName, color, text, isSystem = false) {
        if (!this.container) return;
        const list = this.container.querySelector(".mpChatMessages");
        if (!list) return;
        const line = document.createElement("div");
        line.className = "mpChatLine" + (isSystem ? " mpSystemMsg" : "");
        if (isSystem) {
            line.innerHTML = `<span class="mpSysText">${escapeHtml(text)}</span>`;
        } else {
            line.innerHTML = `<strong style="color:${color}">${escapeHtml(senderName)}:</strong> <span>${escapeHtml(
                text
            )}</span>`;
        }
        list.appendChild(line);
        while (list.children.length > 40) {
            list.removeChild(list.firstChild);
        }
        list.scrollTop = list.scrollHeight;
    }

    update() {
        if (!this.mod || !this.mod.isSessionActive()) return;
        const now = performance.now();
        if (now - this.lastCursorBroadcast >= 50) {
            this.lastCursorBroadcast = now;
            this.mod.broadcastLocalCursorState(this.root);
        }
        this.mod.onInGameTick(this.root, now);
    }

    draw(parameters) {
        if (!this.mod || !this.mod.isSessionActive()) return;
        this.mod.drawWorldSpacePeers(this.root, parameters);
    }

    drawOverlays(parameters) {
        if (!this.mod || !this.mod.isSessionActive()) return;
        this.mod.drawScreenSpaceOverlays(this.root, parameters);
    }
}

class Mod extends (typeof shapez !== "undefined" && shapez.Mod ? shapez.Mod : class {}) {
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

        // Peer tracking: peerId -> { peerId, steamId, name, color, transport, rtcPc, rtcDc, cursor, chunkAssembler }
        this.peers = new Map();
        this.remotePlayers = new Map(); // playerId -> { id, name, color, x, y, renderX, renderY, layer, buildingId, variant, rotation, rotationVariant, lastUpdate }
        this.activePings = []; // { x, y, color, name, createdAt }
        this.clientChunkBuffer = new Map(); // transferId -> { chunks: [], received: 0, total: 0 }
        this.pendingIceCandidates = new Map(); // steamId -> Array<RTCIceCandidateInit>

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
        this.lastCursorStateKey = "";
        this.lastCursorSentAt = 0;
        this.clientHelloTimer = null;

        this.injectStyles();
        this.setupIpcListeners();
        this.setupGameHooks();
        this.refreshSteamStatus();

        // Register HUD element in-game
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

        // Hook MainMenuState to guarantee the multiplayer button persists across menu re-renders & savegame updates
        if (typeof shapez !== "undefined" && shapez.MainMenuState) {
            const self = this;
            this.modInterface.runAfterMethod(shapez.MainMenuState, "renderMainMenu", function () {
                self.enhanceMainMenu(this);
            });
            this.modInterface.runAfterMethod(shapez.MainMenuState, "onEnter", function () {
                self.enhanceMainMenu(this);
            });
        }

        this.signals.stateEntered.add(state => {
            if (state && state.key === "MainMenuState") {
                this.enhanceMainMenu(state);
                setTimeout(() => this.enhanceMainMenu(state), 40);
                setTimeout(() => this.enhanceMainMenu(state), 200);
            }
        });
    }

    // =========================================================================
    // Persistent Logging & Steam / Electron Main-Process IPC Setup
    // =========================================================================

    logInfo(message) {
        console.log("[Steam MP]", message);
        if (typeof ipcRenderer !== "undefined" && typeof ipcRenderer.invoke === "function") {
            try {
                const p = ipcRenderer.invoke("steam:mp:log", { level: "INFO", message });
                if (p && typeof p.catch === "function") p.catch(() => {});
            } catch (e) {}
        }
    }

    logWarn(message) {
        console.warn("[Steam MP]", message);
        if (typeof ipcRenderer !== "undefined" && typeof ipcRenderer.invoke === "function") {
            try {
                const p = ipcRenderer.invoke("steam:mp:log", { level: "WARN", message });
                if (p && typeof p.catch === "function") p.catch(() => {});
            } catch (e) {}
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

                // Check if launched with +connect_lobby or +connect_ip
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

    // =========================================================================
    // Hosting & Joining Flows
    // =========================================================================

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

        // If we are not already in InGameState, enter InGameState with the chosen or new savegame
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
                this.showToast("Could not resolve host address from lobby. Try using Join Code or IP:Port.");
            }
        } catch (err) {
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
        await this.connectToHost({
            endpoints,
            lobbyId: decoded.lobbyId,
            hostSteamId: decoded.hostSteamId,
        });
    }

    async connectToHost({ endpoints = [], lobbyId = "", hostSteamId = "", alreadyJoinedLobby = false }) {
        await this.stopSession(false);
        await this.refreshSteamStatus();

        this.role = "client";
        this.lobbyId = lobbyId;
        this.hostSteamId = hostSteamId;
        this.clientTransport = "";
        this.clientWorldLoaded = false;

        // Join the Host's Steam Lobby whenever a lobbyId or hostSteamId is available
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

        // 1. Try direct TCP endpoints (Localhost / LAN / UPnP)
        const cleanEndpoints = Array.from(new Set(endpoints.map(e => e.trim()).filter(Boolean)));
        for (const ep of cleanEndpoints) {
            const [host, portStr] = ep.split(":");
            const port = Number(portStr) || 27080;
            if (!host) continue;
            const isLoopback = host === "127.0.0.1" || host === "localhost";
            if (isRemoteSteamHost && isLoopback) continue;
            const tcpTimeout = isRemoteSteamHost ? 1200 : 3000;
            try {
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

        // 2. Use Native Steamworks ISteamNetworking P2P if TCP wasn't reachable
        if (!connected && (this.hostSteamId || this.lobbyId)) {
            this.clientTransport = "steam-p2p";
            if (!this.hostSteamId) this.hostSteamId = "host";
            connected = true;
            this.logInfo(`Connecting to Host ${this.hostSteamId} via Native Steam P2P`);
        }

        if (!connected) {
            this.role = "none";
            this.showToast("Could not connect to Host. Check Join Code or Steam Lobby.");
            throw new Error("Could not connect to Host");
        }

        // Send HELLO handshake to Host
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

        // Retry HELLO up to 4 times over Steam P2P until WELCOME_WORLD arrives (handles initial Steam Relay circuit setup)
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

        this.showToast("Connected to Host! Synchronizing factory world...");
    }

    async stopSession(notifyUser = true) {
        if (this.clientHelloTimer) {
            clearInterval(this.clientHelloTimer);
            this.clientHelloTimer = null;
        }
        if (this.role === "host") {
            try {
                await ipcRenderer.invoke("mp:net:host-stop");
                await ipcRenderer.invoke("steam:mp:leave-lobby");
            } catch (e) {}
        } else if (this.role === "client") {
            try {
                await ipcRenderer.invoke("mp:net:client-disconnect");
                await ipcRenderer.invoke("steam:mp:leave-lobby");
            } catch (e) {}
        }

        this.peers.clear();
        this.remotePlayers.clear();
        this.clientChunkBuffer.clear();
        this.pendingActionsQueue = [];
        this.activeCoopSavegame = null;
        this.clientWorldLoaded = false;
        this.assignedPlayerId = "";
        this.assignedPlayerName = "";
        this.lastCursorStateKey = "";
        this.role = "none";
        this.lobbyId = "";
        this.joinCode = "";

        if (this.currentHud) {
            this.currentHud.refreshUI();
        }
        if (notifyUser) {
            this.showToast("Disconnected from Co-op session.");
        }
    }

    // =========================================================================
    // Packet Transport & Chunking
    // =========================================================================

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
        const serialized = JSON.stringify(message);
        const CHUNK_SIZE = 48000;
        if (serialized.length <= CHUNK_SIZE) {
            this.sendRawToPeer(peer, message);
            return;
        }
        const transferId = "tx_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
        const total = Math.ceil(serialized.length / CHUNK_SIZE);
        for (let i = 0; i < total; i++) {
            const slice = serialized.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            this.sendRawToPeer(peer, {
                type: "CHUNK_PART",
                transferId,
                index: i,
                total,
                data: slice,
            });
        }
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

    // =========================================================================
    // Host & Client Message Handling
    // =========================================================================

    onHostReceivedPeerMessage(peerId, msg) {
        if (!msg || !msg.type) return;
        const peer = this.peers.get(peerId);
        if (!peer) return;

        switch (msg.type) {
            case "HELLO": {
                const hostLocal = this.getLocalPlayerInfo();
                let resolvedId = msg.playerId || peerId;
                let resolvedName = msg.name || peer.name;

                // Disambiguate if connecting from a second instance on the same Steam account (or duplicate ID)
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
                    lastUpdate: performance.now(),
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
        if (!this.currentRoot) {
            // Host is still loading InGameState; retry once root is ready
            this.pendingWelcomes = this.pendingWelcomes || [];
            this.pendingWelcomes.push(peer);
            return;
        }
        try {
            const serializer = new shapez.SavegameSerializer();
            const dump = serializer.generateDumpFromGameRoot(this.currentRoot, false);
            const local = this.getLocalPlayerInfo();
            this.sendChunkedToPeer(peer, {
                type: "WELCOME_WORLD",
                hostId: local.id,
                hostName: local.name,
                assignedPlayerId: peer.playerId,
                assignedPlayerName: peer.name,
                assignedColor: peer.color,
                mode: this.mode,
                roster: this.buildRosterPayload(),
                dump,
            });
        } catch (err) {
            console.error("[Steam MP] Failed to serialize world dump for peer:", err);
        }
    }

    onClientReceivedMessage(msg) {
        if (!msg || !msg.type) return;

        if (msg.type === "CHUNK_PART") {
            let entry = this.clientChunkBuffer.get(msg.transferId);
            if (!entry) {
                entry = {
                    chunks: new Array(msg.total),
                    received: 0,
                    total: msg.total,
                };
                this.clientChunkBuffer.set(msg.transferId, entry);
            }
            if (entry.chunks[msg.index] === undefined) {
                entry.chunks[msg.index] = msg.data;
                entry.received++;
            }
            if (entry.received >= entry.total) {
                this.clientChunkBuffer.delete(msg.transferId);
                try {
                    const fullJson = entry.chunks.join("");
                    const fullMsg = JSON.parse(fullJson);
                    this.onClientReceivedMessage(fullMsg);
                } catch (err) {
                    console.error("[Steam MP] Failed to reassemble chunked message:", err);
                }
            }
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

    async loadHostWorldDump(worldDump, hostName) {
        if (!worldDump) return;
        this.closeMultiplayerModal();

        // Ensure client singleplayer saves are NEVER overwritten:
        // Only reuse activeCoopSavegame if we are already in an active co-op session and resyncing.
        // Otherwise, create a dedicated new savegame instance.
        let savegame = this.activeCoopSavegame;
        if (!savegame) {
            savegame = this.app.savegameMgr.createNewSavegame();
            this.activeCoopSavegame = savegame;
        }

        savegame.currentData = {
            version: savegame.getCurrentVersion(),
            dump: worldDump,
            stats: { failedMam: false, trashedCount: 0, usedInverseRotater: false },
            lastUpdate: Date.now(),
            mods: shapez.MODS.getModsListForSavegame(),
        };
        const safeHost = String(hostName || "Host")
            .replace(/[^a-zA-Z0-9_\- ]/g, "")
            .slice(0, 12);
        savegame.metaDataRef.name = "Co-op (" + safeHost + ")";
        savegame.metaDataRef.level = (worldDump.hubGoals && worldDump.hubGoals.level) || 1;

        try {
            await savegame.writeSavegameAndMetadata();
        } catch (e) {
            console.warn("[Steam MP] Failed to write initial co-op savegame:", e);
        }

        this.app.stateMgr.moveToState("InGameState", {
            savegame,
            fastEnter: true,
        });
    }

    requestWorldResync() {
        if (this.role === "client") {
            this.showToast("Requesting factory resync from Host...");
            this.sendToHost({ type: "REQUEST_RESYNC" });
        }
    }

    // =========================================================================
    // Deterministic World & Action Synchronization Hooks
    // =========================================================================

    attachGameRoot(root, hudPart) {
        this.currentRoot = root;
        this.currentHud = hudPart;

        // Flush any pending actions received while loading
        if (this.pendingActionsQueue.length > 0) {
            const queue = this.pendingActionsQueue.slice();
            this.pendingActionsQueue = [];
            for (const act of queue) {
                this.applyRemoteAction(act);
            }
        }

        // Flush any pending peer welcome dumps if host just finished loading
        if (this.role === "host" && this.pendingWelcomes && this.pendingWelcomes.length > 0) {
            const list = this.pendingWelcomes.slice();
            this.pendingWelcomes = [];
            for (const peer of list) {
                this.sendWorldWelcomeToPeer(peer);
            }
        }

        // Hook host signals for immediate HubGoals sync
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
        const self = this;

        // 1. Hook Building / Belt / Wire / Blueprint Placement
        this.modInterface.replaceMethod(shapez.GameLogic, "tryPlaceBuilding", function (original, [args]) {
            const wasInside = self.isInsidePlaceBuilding;
            self.isInsidePlaceBuilding = true;
            let entity = null;
            try {
                entity = original(args);
            } finally {
                self.isInsidePlaceBuilding = wasInside;
            }

            if (entity && !self.isApplyingRemote && self.isSessionActive()) {
                const { origin, rotation, rotationVariant, originalRotation, variant, building } = args;
                self.dispatchNetworkAction({
                    type: "ACT_PLACE",
                    x: origin.x,
                    y: origin.y,
                    rotation,
                    originalRotation,
                    rotationVariant,
                    variant,
                    buildingId: building.getId(),
                });
            }
            return entity;
        });

        // 2. Hook Building / Wire Deletion
        this.modInterface.replaceMethod(shapez.GameLogic, "tryDeleteBuilding", function (original, [entity]) {
            let tileX = null;
            let tileY = null;
            let layer = "regular";
            if (entity && entity.components && entity.components.StaticMapEntity) {
                tileX = entity.components.StaticMapEntity.origin.x;
                tileY = entity.components.StaticMapEntity.origin.y;
                layer = entity.layer || "regular";
            }

            const deleted = original(entity);
            if (
                deleted &&
                tileX !== null &&
                !self.isApplyingRemote &&
                !self.isInsidePlaceBuilding &&
                self.isSessionActive()
            ) {
                self.dispatchNetworkAction({
                    type: "ACT_DELETE",
                    x: tileX,
                    y: tileY,
                    layer,
                });
            }
            return deleted;
        });

        // 3. Hook Constant Signal Edit
        if (shapez.HUDConstantSignalEdit) {
            this.modInterface.runAfterMethod(
                shapez.HUDConstantSignalEdit,
                "editConstantSignal",
                function (entity) {
                    if (self.isApplyingRemote || !self.isSessionActive() || !entity) return;
                    const dialogs = this.root?.hud?.parts?.dialogs;
                    const topDialog =
                        dialogs && dialogs.dialogStack && dialogs.dialogStack[dialogs.dialogStack.length - 1];
                    if (!topDialog) return;

                    const broadcastSignalAfterApply = () => {
                        setTimeout(() => {
                            if (!entity || entity.destroyed || !entity.components?.ConstantSignal) return;
                            const origin = entity.components.StaticMapEntity.origin;
                            const sig = entity.components.ConstantSignal.signal;
                            const signalCode = sig ? sig.getAsCopyableKey() : "";
                            self.dispatchNetworkAction({
                                type: "ACT_SIGNAL",
                                x: origin.x,
                                y: origin.y,
                                layer: entity.layer || "wires",
                                signalCode,
                            });
                        }, 0);
                    };

                    if (topDialog.buttonSignals?.ok) {
                        topDialog.buttonSignals.ok.add(broadcastSignalAfterApply);
                    }
                    if (topDialog.valueChosen) {
                        topDialog.valueChosen.add(broadcastSignalAfterApply);
                    }
                }
            );
        }

        // 4. Hook Lever Toggle
        if (shapez.HUDLeverToggle) {
            this.modInterface.runAfterMethod(
                shapez.HUDLeverToggle,
                "downPreHandler",
                function (pos, button) {
                    if (self.isApplyingRemote || !self.isSessionActive()) return;
                    if (button !== shapez.enumMouseButton.left) return;
                    const tile = this.root.camera.screenToWorld(pos).toTileSpace();
                    const entity = this.root.map.getLayerContentXY(tile.x, tile.y, "regular");
                    if (entity && entity.components && entity.components.Lever) {
                        const origin = entity.components.StaticMapEntity.origin;
                        self.dispatchNetworkAction({
                            type: "ACT_LEVER",
                            x: origin.x,
                            y: origin.y,
                            toggled: Boolean(entity.components.Lever.toggled),
                        });
                    }
                }
            );
        }

        // 5. Hook Mass Selector Clear Belts
        if (shapez.HUDMassSelector) {
            this.modInterface.replaceMethod(shapez.HUDMassSelector, "clearBelts", function (original, args) {
                const tiles = [];
                if (!self.isApplyingRemote && self.isSessionActive() && this.selectedUids) {
                    for (const uid of this.selectedUids) {
                        const entity = this.root.entityMgr.findByUid(uid, false);
                        if (entity && entity.components?.StaticMapEntity) {
                            tiles.push({
                                x: entity.components.StaticMapEntity.origin.x,
                                y: entity.components.StaticMapEntity.origin.y,
                                layer: entity.layer || "regular",
                            });
                        }
                    }
                }
                const res = original(...args);
                if (tiles.length > 0 && !self.isApplyingRemote && self.isSessionActive()) {
                    self.dispatchNetworkAction({
                        type: "ACT_CLEAR_BELTS",
                        tiles,
                    });
                }
                return res;
            });
        }

        // 6. Hook Hub Upgrades
        if (shapez.HubGoals) {
            this.modInterface.replaceMethod(
                shapez.HubGoals,
                "tryUnlockUpgrade",
                function (original, [upgradeId]) {
                    const unlocked = original(upgradeId);
                    if (unlocked && !self.isApplyingRemote && self.isSessionActive()) {
                        self.dispatchNetworkAction({
                            type: "ACT_UPGRADE",
                            upgradeId,
                        });
                    }
                    return unlocked;
                }
            );
        }

        // 7. Hook Waypoints
        if (shapez.HUDWaypoints) {
            for (const fnName of ["addWaypoint", "renameWaypoint", "deleteWaypoint"]) {
                this.modInterface.runAfterMethod(shapez.HUDWaypoints, fnName, function () {
                    if (!self.isApplyingRemote && self.isSessionActive()) {
                        self.dispatchNetworkAction({
                            type: "ACT_WAYPOINTS",
                            data: this.serialize(),
                        });
                    }
                });
            }
        }

        // 8. Hook Pinned Shapes
        if (shapez.HUDPinnedShapes) {
            for (const fnName of ["pinNewShape", "unpinShape"]) {
                this.modInterface.runAfterMethod(shapez.HUDPinnedShapes, fnName, function () {
                    if (!self.isApplyingRemote && self.isSessionActive()) {
                        self.dispatchNetworkAction({
                            type: "ACT_PINS",
                            data: this.serialize(),
                        });
                    }
                });
            }
        }
    }

    applyRemoteAction(msg) {
        if (!this.currentRoot || !this.currentRoot.logicInitialized) {
            this.pendingActionsQueue.push(msg);
            return;
        }

        const root = this.currentRoot;
        this.isApplyingRemote = true;
        try {
            switch (msg.type) {
                case "ACT_PLACE": {
                    const metaBuilding = shapez.gMetaBuildingRegistry.findById(msg.buildingId);
                    if (metaBuilding) {
                        root.logic.tryPlaceBuilding({
                            origin: new shapez.Vector(msg.x, msg.y),
                            rotation: msg.rotation,
                            originalRotation: msg.originalRotation,
                            rotationVariant: msg.rotationVariant,
                            variant: msg.variant,
                            building: metaBuilding,
                        });
                    }
                    break;
                }
                case "ACT_DELETE": {
                    const entity = root.map.getLayerContentXY(msg.x, msg.y, msg.layer || "regular");
                    if (entity) {
                        root.logic.tryDeleteBuilding(entity);
                    }
                    break;
                }
                case "ACT_SIGNAL": {
                    const entity = root.map.getLayerContentXY(msg.x, msg.y, msg.layer || "wires");
                    if (entity && entity.components?.ConstantSignal) {
                        const editor = root.hud?.parts?.constantSignalEdit;
                        if (editor && typeof editor.parseSignalCode === "function") {
                            entity.components.ConstantSignal.signal = editor.parseSignalCode(
                                entity,
                                msg.signalCode || ""
                            );
                        }
                    }
                    break;
                }
                case "ACT_LEVER": {
                    const entity = root.map.getLayerContentXY(msg.x, msg.y, "regular");
                    if (entity && entity.components?.Lever) {
                        entity.components.Lever.toggled = Boolean(msg.toggled);
                    }
                    break;
                }
                case "ACT_CLEAR_BELTS": {
                    if (Array.isArray(msg.tiles)) {
                        for (const t of msg.tiles) {
                            const entity = root.map.getLayerContentXY(t.x, t.y, t.layer || "regular");
                            if (entity && entity.components) {
                                for (const comp of Object.values(entity.components)) {
                                    if (comp && typeof comp.clear === "function") {
                                        comp.clear();
                                    }
                                }
                            }
                        }
                    }
                    break;
                }
                case "ACT_UPGRADE": {
                    if (root.hubGoals && msg.upgradeId) {
                        if (!root.hubGoals.tryUnlockUpgrade(msg.upgradeId)) {
                            // Force apply upgrade if client stored shapes were slightly behind host
                            const currentLv = root.hubGoals.getUpgradeLevel(msg.upgradeId);
                            root.hubGoals.upgradeLevels[msg.upgradeId] = currentLv + 1;
                            root.signals.upgradePurchased.dispatch(msg.upgradeId);
                        }
                    }
                    break;
                }
                case "ACT_WAYPOINTS": {
                    if (root.hud?.parts?.waypoints && msg.data) {
                        root.hud.parts.waypoints.deserialize(msg.data);
                    }
                    break;
                }
                case "ACT_PINS": {
                    if (root.hud?.parts?.pinnedShapes && msg.data) {
                        root.hud.parts.pinnedShapes.deserialize(msg.data);
                        root.hud.parts.pinnedShapes.rerenderFull();
                    }
                    break;
                }
            }
        } catch (err) {
            console.warn("[Steam MP] Error applying remote action:", msg, err);
        } finally {
            this.isApplyingRemote = false;
        }
    }

    onInGameTick(root, now) {
        if (this.role === "host" && now - this.lastHubSyncTime >= 2000) {
            this.lastHubSyncTime = now;
            this.broadcastHubSync(root);
        }
    }

    broadcastHubSync(root) {
        if (this.role !== "host" || !root || !root.hubGoals) return;
        this.broadcastFromHost({
            type: "SYNC_HUB",
            level: root.hubGoals.level,
            storedShapes: root.hubGoals.storedShapes,
            upgradeLevels: root.hubGoals.upgradeLevels,
            gainedRewards: root.hubGoals.gainedRewards,
        });
    }

    applyHubSync(msg) {
        if (!this.currentRoot || !this.currentRoot.hubGoals) return;
        const hg = this.currentRoot.hubGoals;
        this.isApplyingRemote = true;
        try {
            if (msg.storedShapes && typeof msg.storedShapes === "object") {
                for (const [k, v] of Object.entries(msg.storedShapes)) {
                    hg.storedShapes[k] = Math.max(hg.storedShapes[k] || 0, v);
                }
            }
            if (msg.gainedRewards && typeof msg.gainedRewards === "object") {
                Object.assign(hg.gainedRewards, msg.gainedRewards);
            }
            if (msg.upgradeLevels && typeof msg.upgradeLevels === "object") {
                for (const [upId, lv] of Object.entries(msg.upgradeLevels)) {
                    if ((hg.upgradeLevels[upId] || 0) < lv) {
                        hg.upgradeLevels[upId] = lv;
                        this.currentRoot.signals.upgradePurchased.dispatch(upId);
                    }
                }
            }
            if (typeof msg.level === "number" && msg.level > hg.level) {
                const prevLevel = hg.level;
                const prevReward = hg.currentGoal?.reward;
                hg.level = msg.level;
                hg.computeNextGoal();
                this.currentRoot.signals.storyGoalCompleted.dispatch(
                    prevLevel,
                    prevReward || shapez.enumHubGoalRewards.no_reward
                );
            }
        } finally {
            this.isApplyingRemote = false;
        }
    }

    // =========================================================================
    // Live Cursors, Ghost Building Previews, Pings & Chat
    // =========================================================================

    broadcastLocalCursorState(root) {
        if (!root || !root.camera || !root.app?.mousePosition) return;
        if (this.role === "client" && !this.clientWorldLoaded) return;
        if (this.role === "host") {
            let hasReadyPeer = false;
            for (const [, p] of this.peers) {
                if (p.ready) {
                    hasReadyPeer = true;
                    break;
                }
            }
            if (!hasReadyPeer) return;
        }

        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const isRelay =
            (this.role === "client" && this.clientTransport === "steam-relay") ||
            (this.role === "host" &&
                Array.from(this.peers.values()).some(p => p.ready && p.transport === "steam-relay"));
        if (isRelay && now - (this.lastCursorSentAt || 0) < 350) {
            return;
        }

        const worldPos = root.camera.screenToWorld(root.app.mousePosition);
        const placer = root.hud?.parts?.buildingPlacer;
        const metaBuilding = placer?.currentMetaBuilding?.get();
        let buildingId = null;
        let variant = null;
        let rotation = 0;
        let rotationVariant = 0;

        if (metaBuilding) {
            buildingId = metaBuilding.getId();
            variant = placer.currentVariant.get() || shapez.defaultBuildingVariant;
            const tile = worldPos.toTileSpace();
            try {
                const opt = metaBuilding.computeOptimalDirectionAndRotationVariantAtTile({
                    root,
                    tile,
                    rotation: placer.currentBaseRotation,
                    variant,
                    layer: metaBuilding.getLayer(),
                });
                rotation = opt.rotation;
                rotationVariant = opt.rotationVariant;
            } catch (e) {
                rotation = placer.currentBaseRotation || 0;
            }
        }

        const rx = Math.round(worldPos.x * 10) / 10;
        const ry = Math.round(worldPos.y * 10) / 10;
        const layer = root.currentLayer || "regular";
        const stateKey = `${rx},${ry},${layer},${buildingId || ""},${variant || ""},${rotation},${rotationVariant}`;
        if (this.lastCursorStateKey === stateKey && now - (this.lastCursorSentAt || 0) < 3000) {
            return;
        }
        this.lastCursorStateKey = stateKey;
        this.lastCursorSentAt = now;

        const local = this.getLocalPlayerInfo();
        this.dispatchNetworkAction({
            type: "CURSOR",
            playerId: local.id,
            name: local.name,
            color: local.color,
            x: rx,
            y: ry,
            layer,
            buildingId,
            variant,
            rotation,
            rotationVariant,
        });
    }

    updateRemoteCursor(msg) {
        const localId = this.getLocalPlayerInfo().id;
        if (!msg.playerId || msg.playerId === localId) return;

        let rp = this.remotePlayers.get(msg.playerId);
        if (!rp) {
            rp = {
                id: msg.playerId,
                name: msg.name || "Teammate",
                color: msg.color || PLAYER_COLORS[1],
                isHost: false,
                x: msg.x || 0,
                y: msg.y || 0,
                renderX: msg.x || 0,
                renderY: msg.y || 0,
                layer: msg.layer || "regular",
                buildingId: msg.buildingId || null,
                variant: msg.variant || null,
                rotation: msg.rotation || 0,
                rotationVariant: msg.rotationVariant || 0,
                lastUpdate: performance.now(),
            };
            this.remotePlayers.set(msg.playerId, rp);
            if (this.currentHud) this.currentHud.refreshUI();
        } else {
            rp.name = msg.name || rp.name;
            rp.color = msg.color || rp.color;
            rp.x = msg.x || 0;
            rp.y = msg.y || 0;
            rp.layer = msg.layer || "regular";
            rp.buildingId = msg.buildingId || null;
            rp.variant = msg.variant || null;
            rp.rotation = msg.rotation || 0;
            rp.rotationVariant = msg.rotationVariant || 0;
            rp.lastUpdate = performance.now();
        }
    }

    sendChatMessage(text) {
        const local = this.getLocalPlayerInfo();
        if (this.currentHud) {
            this.currentHud.appendChatLine(local.name, local.color, text);
        }
        this.dispatchNetworkAction({
            type: "CHAT",
            senderName: local.name,
            color: local.color,
            text,
        });
    }

    sendMapPingAtCursor() {
        if (!this.currentRoot || !this.currentRoot.camera) return;
        const mousePos = this.currentRoot.app?.mousePosition;
        const worldPos = mousePos
            ? this.currentRoot.camera.screenToWorld(mousePos)
            : this.currentRoot.camera.center;
        const local = this.getLocalPlayerInfo();
        const ping = {
            type: "PING",
            x: Math.round(worldPos.x),
            y: Math.round(worldPos.y),
            name: local.name,
            color: local.color,
        };
        this.addMapPing(ping);
        this.dispatchNetworkAction(ping);
    }

    addMapPing(ping) {
        this.activePings.push({
            x: ping.x,
            y: ping.y,
            name: ping.name || "Player",
            color: ping.color || "#38bdf8",
            createdAt: performance.now(),
        });
        if (this.currentHud) {
            this.currentHud.appendChatLine(
                "Ping",
                ping.color || "#38bdf8",
                `${ping.name} pinged (${Math.floor(ping.x / 32)}, ${Math.floor(ping.y / 32)})`,
                true
            );
        }
    }

    drawWorldSpacePeers(root, parameters) {
        const ctx = parameters.context;
        if (!ctx) return;

        const zoom = root.camera.zoomLevel || 1;
        const invZoom = 1 / Math.max(0.2, zoom);

        for (const [, rp] of this.remotePlayers) {
            // Smoothly interpolate cursor position
            rp.renderX += (rp.x - rp.renderX) * 0.35;
            rp.renderY += (rp.y - rp.renderY) * 0.35;

            ctx.save();

            // 1. Draw remote player's ghost building preview if holding a building
            if (rp.buildingId) {
                try {
                    const metaBuilding = shapez.gMetaBuildingRegistry.findById(rp.buildingId);
                    if (metaBuilding) {
                        const tileX = Math.floor(rp.renderX / 32);
                        const tileY = Math.floor(rp.renderY / 32);
                        const dims = metaBuilding.getDimensions(rp.variant || shapez.defaultBuildingVariant);
                        const worldTileX = tileX * 32;
                        const worldTileY = tileY * 32;
                        const w = (dims?.x || 1) * 32;
                        const h = (dims?.y || 1) * 32;

                        ctx.save();
                        ctx.globalAlpha = 0.38;
                        ctx.fillStyle = rp.color;
                        ctx.strokeStyle = rp.color;
                        ctx.lineWidth = 2;
                        ctx.fillRect(worldTileX, worldTileY, w, h);
                        ctx.strokeRect(worldTileX, worldTileY, w, h);

                        const sprite = metaBuilding.getPreviewSprite(
                            rp.rotationVariant || 0,
                            rp.variant || shapez.defaultBuildingVariant
                        );
                        if (sprite) {
                            ctx.translate(worldTileX + w / 2, worldTileY + h / 2);
                            ctx.rotate(((rp.rotation || 0) * Math.PI) / 180);
                            sprite.drawCentered(ctx, 0, 0, Math.max(w, h));
                        }
                        ctx.restore();
                    }
                } catch (e) {}
            }

            // 2. Draw cursor pointer & player name label
            ctx.translate(rp.renderX, rp.renderY);
            ctx.scale(invZoom, invZoom);

            ctx.fillStyle = rp.color;
            ctx.strokeStyle = "#111827";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, 18);
            ctx.lineTo(5, 14);
            ctx.lineTo(9, 22);
            ctx.lineTo(12, 20);
            ctx.lineTo(8, 12);
            ctx.lineTo(14, 12);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Name tag pill
            const label = rp.layer === "wires" ? `${rp.name} [Wires]` : rp.name;
            ctx.font = "bold 12px GameFont, sans-serif";
            const textW = ctx.measureText(label).width;
            const padX = 7;
            const boxX = 14;
            const boxY = 12;
            const boxW = textW + padX * 2;
            const boxH = 20;

            ctx.fillStyle = "rgba(17, 24, 39, 0.88)";
            ctx.strokeStyle = rp.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.rect(boxX, boxY, boxW, boxH);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "#ffffff";
            ctx.textBaseline = "middle";
            ctx.fillText(label, boxX + padX, boxY + boxH / 2);

            ctx.restore();
        }

        // 3. Draw active map pings
        const now = performance.now();
        this.activePings = this.activePings.filter(p => now - p.createdAt < 4500);
        for (const ping of this.activePings) {
            const age = (now - ping.createdAt) / 4500;
            const radius = (20 + age * 110) * invZoom;
            const alpha = Math.max(0, 1 - age);

            ctx.save();
            ctx.translate(ping.x, ping.y);
            ctx.strokeStyle = ping.color;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 3 * invZoom;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.45, 0, Math.PI * 2);
            ctx.stroke();

            ctx.scale(invZoom, invZoom);
            ctx.font = "bold 13px GameFont, sans-serif";
            ctx.fillStyle = ping.color;
            ctx.textAlign = "center";
            ctx.fillText(`PING: ${ping.name}`, 0, -24);
            ctx.restore();
        }
    }

    drawScreenSpaceOverlays(root, parameters) {
        const ctx = parameters.context;
        if (!ctx || !root.camera) return;

        const screenW = root.gameWidth;
        const screenH = root.gameHeight;
        const margin = 42;

        for (const [, rp] of this.remotePlayers) {
            const screenPos = root.camera.worldToScreen(new shapez.Vector(rp.renderX, rp.renderY));
            if (
                screenPos.x >= margin &&
                screenPos.x <= screenW - margin &&
                screenPos.y >= margin &&
                screenPos.y <= screenH - margin
            ) {
                continue; // On-screen
            }

            const centerX = screenW / 2;
            const centerY = screenH / 2;
            const dx = screenPos.x - centerX;
            const dy = screenPos.y - centerY;
            const angle = Math.atan2(dy, dx);

            const clampedX = Math.max(margin, Math.min(screenW - margin, screenPos.x));
            const clampedY = Math.max(margin, Math.min(screenH - margin, screenPos.y));

            ctx.save();
            ctx.translate(clampedX, clampedY);

            // Arrow head
            ctx.save();
            ctx.rotate(angle);
            ctx.fillStyle = rp.color;
            ctx.strokeStyle = "#111827";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(12, 0);
            ctx.lineTo(-8, -8);
            ctx.lineTo(-4, 0);
            ctx.lineTo(-8, 8);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            ctx.font = "bold 11px GameFont, sans-serif";
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "#111827";
            ctx.lineWidth = 3;
            ctx.textAlign = "center";
            ctx.strokeText(rp.name, 0, 20);
            ctx.fillText(rp.name, 0, 20);

            ctx.restore();
        }
    }

    // =========================================================================
    // Main Menu & Multiplayer Hub UI
    // =========================================================================

    enhanceMainMenu(mainMenuState) {
        const htmlEl = (mainMenuState && mainMenuState.htmlElement) || document.getElementById("state_MainMenuState");
        if (!htmlEl) return;

        // If multi-instance is active, ensure document title reflects it
        if (this.steamStatus?.allowMultiInstance || (typeof window !== "undefined" && window.location.search.includes("multi-instance"))) {
            document.title = "shapez (Co-op Instance)";
        }

        // Add "Steam Multiplayer" button to main menu button bar
        const buttonsContainer = htmlEl.querySelector(".mainContainer .buttons");
        if (buttonsContainer) {
            if (!buttonsContainer.querySelector(".mpMainMenuBtn")) {
                const mpBtn = document.createElement("button");
                mpBtn.className = "styledButton mpMainMenuBtn";
                mpBtn.innerHTML = `<span class="mpSteamDot"></span> Steam Multiplayer`;
                mpBtn.addEventListener("click", () => this.openMultiplayerModal(mainMenuState));
                buttonsContainer.insertBefore(mpBtn, buttonsContainer.firstChild);
            }

            // Continuous guard against removeAllChildren wipes during async save loads
            if (!buttonsContainer.__mpObserver) {
                const observer = new MutationObserver(() => {
                    if (buttonsContainer && !buttonsContainer.querySelector(".mpMainMenuBtn")) {
                        const mpBtn = document.createElement("button");
                        mpBtn.className = "styledButton mpMainMenuBtn";
                        mpBtn.innerHTML = `<span class="mpSteamDot"></span> Steam Multiplayer`;
                        mpBtn.addEventListener("click", () => this.openMultiplayerModal(mainMenuState));
                        buttonsContainer.insertBefore(mpBtn, buttonsContainer.firstChild);
                        this.updateMainMenuBadge();
                    }
                });
                observer.observe(buttonsContainer, { childList: true });
                buttonsContainer.__mpObserver = observer;
            }
        }

        // Also add a "Co-op" quick-host button on each savegame row if present
        const saveItems = htmlEl.querySelectorAll(".savegames .savegame");
        const savesMeta = this.app?.savegameMgr?.getSavegamesMetaData() || [];
        saveItems.forEach((row, idx) => {
            if (row.querySelector(".mpHostSaveBtn") || !savesMeta[idx]) return;
            const meta = savesMeta[idx];
            const hostBtn = document.createElement("button");
            hostBtn.className = "styledButton mpHostSaveBtn";
            hostBtn.innerText = "Co-op";
            hostBtn.title = "Host this Savegame in Steam Co-op";
            hostBtn.addEventListener("click", ev => {
                ev.stopPropagation();
                const sg = this.app.savegameMgr.getSavegameById(meta.internalId);
                this.startHostingSession({ savegame: sg });
            });
            row.appendChild(hostBtn);
        });

        this.updateMainMenuBadge();
    }

    updateMainMenuBadge() {
        const dot = document.querySelector(".mpMainMenuBtn .mpSteamDot");
        if (dot) {
            dot.classList.remove("online", "warning");
            if (this.steamStatus?.initialized) {
                dot.classList.add("online");
            } else if (this.bridgeAvailable === false) {
                dot.classList.add("warning");
                dot.title = "Steamworks bridge unpatched. Run ShapezCoopInstaller.exe to patch app.asar";
            }
        }
    }

    async openMultiplayerModal(mainMenuState = null) {
        this.closeMultiplayerModal();
        await this.refreshSteamStatus();

        const profile = this.steamStatus?.profile || { name: "Player", steamId: "local", isSteam: false };
        const friends = (typeof ipcRenderer !== "undefined" && (await ipcRenderer.invoke("steam:mp:get-friends").catch(() => []))) || [];
        const savesMeta = this.app?.savegameMgr?.getSavegamesMetaData() || [];
        const active = this.isSessionActive();
        const bridgeMissing = this.bridgeAvailable === false;

        const overlay = document.createElement("div");
        overlay.className = "mpModalBackdrop";
        overlay.innerHTML = `
            <div class="mpModalCard">
                <div class="mpModalHeader">
                    <div>
                        <h2>Steam Co-op Multiplayer</h2>
                        <div class="mpSubHeader">
                            <span class="mpBadge ${profile.isSteam ? "steamOnline" : "steamFallback"}">
                                ${profile.isSteam ? "Steam Connected" : "Local / LAN Mode"}
                            </span>
                            <span>Logged in as <strong>${escapeHtml(profile.name)}</strong></span>
                        </div>
                    </div>
                    <button class="mpCloseModalBtn" aria-label="Close">&times;</button>
                </div>
                ${bridgeMissing ? `
                <div class="mpBridgeWarning">
                    <strong>Steamworks Bridge Unpatched:</strong> The core game archive (<code>resources\\app.asar</code>) has not been patched. Steam lobbies, invites, and multi-instance sync require running <strong>ShapezCoopInstaller.exe</strong> with shapez closed.
                </div>
                ` : ""}

                ${
                    active
                        ? `
                    <div class="mpActiveSessionBanner">
                        <div>
                            <strong>Active Session (${this.role.toUpperCase()} — Mode: ${this.mode.toUpperCase()})</strong>
                            <div class="mpJoinCodePreview">Join Endpoint: <code>${escapeHtml(
                                this.hostEndpoint || "Connected"
                            )}</code></div>
                        </div>
                        <div class="mpBannerActions">
                            <button class="styledButton mpCopyJoinCodeModalBtn">Copy Join Code</button>
                            <button class="styledButton mpSteamOverlayModalBtn">Steam Invite Overlay</button>
                            <button class="styledButton mpDisconnectModalBtn">Leave Session</button>
                        </div>
                    </div>
                `
                        : ""
                }

                <div class="mpModalColumns">
                    <div class="mpModalCol">
                        <h3>1. Host Co-op Factory</h3>
                        <p class="mpColDesc">Start a shared factory on Steam Lobby + TCP P2P.</p>
                        <label class="mpFieldLabel">Select World to Host:</label>
                        <select class="mpSelectSave">
                            <option value="__new__">+ Create New Co-op Factory</option>
                            ${savesMeta
                                .map(
                                    s =>
                                        `<option value="${escapeHtml(s.internalId)}">${escapeHtml(
                                            s.name || "Unnamed Save"
                                        )} (Level ${s.level || 1})</option>`
                                )
                                .join("")}
                        </select>
                        <label class="mpFieldLabel">Host Port (TCP/LAN):</label>
                        <input type="number" class="mpInputPort" value="27080" min="1024" max="65535" />
                        <button class="styledButton mpPrimaryBtn mpStartHostBtn">
                            ${
                                this.currentRoot
                                    ? "Host Current Factory in Co-op"
                                    : "Start Hosting Co-op Factory"
                            }
                        </button>

                        <hr class="mpDivider" />

                        <h3>2. Join by Code or IP:Port</h3>
                        <p class="mpColDesc">Paste a friend's Join Code or IP:Port (e.g. <code>127.0.0.1:27080</code>):</p>
                        <div class="mpInputGroup">
                            <input type="text" class="mpInputJoinCode" placeholder="127.0.0.1:27080 or Join Code..." />
                            <button class="styledButton mpPrimaryBtn mpJoinByCodeBtn">Connect</button>
                        </div>
                    </div>

                    <div class="mpModalCol">
                        <div class="mpFriendsHeader">
                            <h3>3. Steam Friends (${friends.length})</h3>
                            <div class="mpFriendBtns">
                                <button class="styledButton mpViewLogsBtn" title="View Co-op Diagnostic Logs">Logs</button>
                                <button class="styledButton mpOpenOverlayBtn">Steam Overlay</button>
                            </div>
                        </div>
                        <p class="mpColDesc">Invite Steam friends or join a friend currently playing shapez:</p>
                        <div class="mpFriendsList">
                            ${
                                friends.length === 0
                                    ? `<div class="mpEmptyFriends">No online Steam friends detected, or running in local instance mode. You can always connect via Join Code or <code>127.0.0.1:27080</code>!</div>`
                                    : friends
                                          .map(f => {
                                              const isHosting = Boolean(f.mpEndpoint || f.mpLobby);
                                              const isPlaying = Boolean(f.isPlayingShapez);
                                              const canJoin = isHosting || isPlaying;
                                              return `
                                                <div class="mpFriendRow ${canJoin ? "hosting" : ""}">
                                                    <div class="mpFriendInfo">
                                                        <strong>${escapeHtml(f.name)}</strong>
                                                        <span class="mpFriendSub">${
                                                            isHosting
                                                                ? "Hosting shapez Co-op!"
                                                                : isPlaying
                                                                ? "Playing shapez"
                                                                : "Steam Friend"
                                                        }</span>
                                                    </div>
                                                    <div class="mpFriendBtns">
                                                        ${
                                                            canJoin
                                                                ? `<button class="styledButton mpJoinFriendBtn" data-steamid="${escapeHtml(
                                                                      f.steamId
                                                                  )}" data-endpoint="${escapeHtml(
                                                                      f.mpEndpoint
                                                                  )}" data-lobby="${escapeHtml(
                                                                      f.mpLobby
                                                                  )}">Join Game</button>`
                                                                : ""
                                                        }
                                                        <button class="styledButton mpInviteFriendBtn" data-steamid="${escapeHtml(
                                                            f.steamId
                                                        )}" data-name="${escapeHtml(f.name)}">Invite</button>
                                                    </div>
                                                </div>
                                            `;
                                          })
                                          .join("")
                            }
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.modalEl = overlay;

        overlay.querySelector(".mpCloseModalBtn").addEventListener("click", () => this.closeMultiplayerModal());
        overlay.addEventListener("click", ev => {
            if (ev.target === overlay) this.closeMultiplayerModal();
        });

        const startHostBtn = overlay.querySelector(".mpStartHostBtn");
        if (startHostBtn) {
            startHostBtn.addEventListener("click", async () => {
                const portVal = Number(overlay.querySelector(".mpInputPort").value) || 27080;
                const saveVal = overlay.querySelector(".mpSelectSave").value;
                let chosenSave = null;
                if (this.currentRoot && this.currentRoot.savegame) {
                    chosenSave = this.currentRoot.savegame;
                } else if (saveVal && saveVal !== "__new__") {
                    chosenSave = this.app.savegameMgr.getSavegameById(saveVal);
                }
                this.closeMultiplayerModal();
                await this.startHostingSession({ savegame: chosenSave, port: portVal, mode: "coop" });
            });
        }

        const joinCodeInput = overlay.querySelector(".mpInputJoinCode");
        const joinByCodeBtn = overlay.querySelector(".mpJoinByCodeBtn");
        if (joinByCodeBtn && joinCodeInput) {
            const triggerJoin = () => {
                const val = joinCodeInput.value.trim() || "127.0.0.1:27080";
                this.joinByCodeOrAddress(val);
            };
            joinByCodeBtn.addEventListener("click", triggerJoin);
            joinCodeInput.addEventListener("keydown", ev => {
                ev.stopPropagation();
                if (ev.key === "Enter") triggerJoin();
            });
        }

        const viewLogsBtn = overlay.querySelector(".mpViewLogsBtn");
        if (viewLogsBtn) {
            viewLogsBtn.addEventListener("click", () => {
                this.openLogsModal();
            });
        }

        const openOverlayBtn = overlay.querySelector(".mpOpenOverlayBtn");
        if (openOverlayBtn) {
            openOverlayBtn.addEventListener("click", () => {
                ipcRenderer.invoke("steam:mp:invite-overlay", this.lobbyId);
            });
        }

        const copyModalBtn = overlay.querySelector(".mpCopyJoinCodeModalBtn");
        if (copyModalBtn) {
            copyModalBtn.addEventListener("click", () => this.copyJoinInfoToClipboard());
        }

        const overlayModalBtn = overlay.querySelector(".mpSteamOverlayModalBtn");
        if (overlayModalBtn) {
            overlayModalBtn.addEventListener("click", () => {
                ipcRenderer.invoke("steam:mp:invite-overlay", this.lobbyId);
            });
        }

        const disconnectModalBtn = overlay.querySelector(".mpDisconnectModalBtn");
        if (disconnectModalBtn) {
            disconnectModalBtn.addEventListener("click", async () => {
                await this.stopSession(true);
                this.closeMultiplayerModal();
            });
        }

        overlay.querySelectorAll(".mpInviteFriendBtn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const friendSteamId = btn.getAttribute("data-steamid");
                const friendName = btn.getAttribute("data-name");
                if (!this.isSessionActive()) {
                    await this.startHostingSession({
                        savegame: this.currentRoot?.savegame || null,
                        port: 27080,
                        mode: "coop",
                    });
                }
                await ipcRenderer.invoke("steam:mp:invite-friend", {
                    friendSteamId,
                    lobbyId: this.lobbyId,
                    joinCode: this.joinCode,
                });
                btn.innerText = "Invited!";
                this.showToast(`Sent Steam Co-op invite to ${friendName}!`);
            });
        });

        overlay.querySelectorAll(".mpJoinFriendBtn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const friendSteamId = btn.getAttribute("data-steamid");
                const endpoint = btn.getAttribute("data-endpoint");
                const lobby = btn.getAttribute("data-lobby");
                this.closeMultiplayerModal();
                await this.connectToHost({
                    endpoints: endpoint ? endpoint.split(",") : [],
                    lobbyId: lobby,
                    hostSteamId: friendSteamId,
                });
            });
        });
    }

    async openLogsModal() {
        let logData = { logFilePath: "%APPDATA%\\shapez.io\\coop-multiplayer.log", lines: [] };
        if (typeof ipcRenderer !== "undefined") {
            try {
                const res = await ipcRenderer.invoke("steam:mp:get-logs");
                if (res) logData = res;
            } catch (e) {}
        }
        const logText = (logData.lines || []).join("\n") || "No log entries recorded yet.";
        const existing = document.querySelector(".mpLogsModalBackdrop");
        if (existing) existing.remove();

        const modal = document.createElement("div");
        modal.className = "mpModalBackdrop mpLogsModalBackdrop";
        modal.innerHTML = `
            <div class="mpModalCard">
                <div class="mpModalHeader">
                    <div>
                        <h2>Co-op Diagnostic Logs</h2>
                        <div class="mpSubHeader">
                            <span>Log file: <code>${escapeHtml(logData.logFilePath || "")}</code></span>
                        </div>
                    </div>
                    <button class="mpCloseModalBtn" aria-label="Close">&times;</button>
                </div>
                <pre style="background:#0f172a;color:#e2e8f0;padding:12px;border-radius:6px;max-height:360px;overflow:auto;font-size:11px;line-height:1.45;user-select:text;-webkit-user-select:text;">${escapeHtml(
                    logText
                )}</pre>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
                    <button class="styledButton mpCopyLogsBtn">Copy Logs to Clipboard</button>
                    <button class="styledButton mpCloseLogsBtn">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.querySelector(".mpCloseModalBtn").addEventListener("click", close);
        modal.querySelector(".mpCloseLogsBtn").addEventListener("click", close);
        modal.querySelector(".mpCopyLogsBtn").addEventListener("click", () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(logText).catch(() => {});
            }
            this.showToast("Copied diagnostic logs to clipboard!");
        });
    }

    closeMultiplayerModal() {
        if (this.modalEl) {
            this.modalEl.remove();
            this.modalEl = null;
        }
    }

    copyJoinInfoToClipboard() {
        const textToCopy = this.joinCode || this.hostEndpoint || "127.0.0.1:27080";
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textToCopy).catch(() => {});
        }
        this.showToast(`Copied Join Code (${this.hostEndpoint || textToCopy}) to clipboard!`);
    }

    showInviteToast({ fromName, fromSteamId, lobbyId, joinCode }) {
        const existing = document.querySelector(".mpInviteBanner");
        if (existing) existing.remove();

        const banner = document.createElement("div");
        banner.className = "mpInviteBanner";
        banner.innerHTML = `
            <div class="mpInviteText">
                <strong>Steam Co-op Invite</strong>
                <span><strong>${escapeHtml(fromName)}</strong> invited you to join their factory!</span>
            </div>
            <div class="mpInviteBtns">
                <button class="styledButton mpAcceptInviteBtn">Accept & Join</button>
                <button class="styledButton mpDismissInviteBtn">Dismiss</button>
            </div>
        `;
        document.body.appendChild(banner);

        banner.querySelector(".mpAcceptInviteBtn").addEventListener("click", () => {
            banner.remove();
            if (joinCode) {
                this.joinByCodeOrAddress(joinCode);
            } else if (lobbyId) {
                this.joinSteamLobby(lobbyId, fromSteamId);
            } else if (fromSteamId) {
                this.connectToHost({ endpoints: [], lobbyId: "", hostSteamId: fromSteamId });
            }
        });
        banner.querySelector(".mpDismissInviteBtn").addEventListener("click", () => banner.remove());
        setTimeout(() => {
            if (banner.parentElement) banner.remove();
        }, 20000);
    }

    showToast(text) {
        let toast = document.querySelector(".mpToastNotification");
        if (!toast) {
            toast = document.createElement("div");
            toast.className = "mpToastNotification";
            document.body.appendChild(toast);
        }
        toast.innerText = text;
        toast.classList.add("visible");
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            toast.classList.remove("visible");
        }, 3800);
    }

    // =========================================================================
    // Styling
    // =========================================================================

    injectStyles() {
        this.modInterface.registerCss(`
            .mpMainMenuBtn {
                background: linear-gradient(135deg, #1b2838 0%, #2a475e 100%) !important;
                color: #66c0f4 !important;
                border: 1px solid #66c0f4 !important;
                display: flex !important;
                align-items: center;
                justify-content: center;
                gap: 8px;
                margin-bottom: 8px !important;
            }
            .mpMainMenuBtn:hover {
                background: linear-gradient(135deg, #2a475e 0%, #3b6584 100%) !important;
                color: #ffffff !important;
            }
            .mpSteamDot {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: #9ca3af;
                display: inline-block;
            }
            .mpSteamDot.online {
                background: #4ade80;
                box-shadow: 0 0 8px #4ade80;
            }
            .mpSteamDot.warning {
                background: #f59e0b;
                box-shadow: 0 0 8px #f59e0b;
            }
            .mpBridgeWarning {
                background: rgba(239, 68, 68, 0.12);
                border: 1px solid rgba(239, 68, 68, 0.4);
                border-radius: 8px;
                padding: 10px 14px;
                margin-bottom: 14px;
                color: #fca5a5;
                font-size: 12px;
                line-height: 1.5;
            }
            .mpBridgeWarning strong {
                color: #ef4444;
            }
            .mpHostSaveBtn {
                background: #1e3a8a !important;
                color: #93c5fd !important;
                font-size: 11px !important;
                padding: 3px 8px !important;
                margin-left: 4px !important;
            }

            /* Modal Backdrop & Card */
            .mpModalBackdrop {
                position: fixed;
                inset: 0;
                background: rgba(10, 15, 25, 0.78);
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: GameFont, sans-serif;
            }
            .mpModalCard {
                width: min(860px, 92vw);
                max-height: 86vh;
                overflow-y: auto;
                overflow-x: hidden;
                box-sizing: border-box;
                background: #1b2838;
                color: #e5e7eb;
                border: 2px solid #66c0f4;
                border-radius: 8px;
                padding: 20px 24px;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
            }
            .mpModalHeader {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                border-bottom: 1px solid rgba(102, 192, 244, 0.25);
                padding-bottom: 12px;
                margin-bottom: 16px;
            }
            .mpModalHeader h2 {
                margin: 0 0 6px 0;
                color: #ffffff;
                font-size: 20px;
            }
            .mpSubHeader {
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 12px;
                color: #9ca3af;
            }
            .mpBadge {
                padding: 2px 8px;
                border-radius: 4px;
                font-weight: bold;
                font-size: 11px;
            }
            .mpBadge.steamOnline {
                background: rgba(74, 222, 128, 0.18);
                color: #4ade80;
                border: 1px solid #4ade80;
            }
            .mpBadge.steamFallback {
                background: rgba(56, 189, 248, 0.18);
                color: #38bdf8;
                border: 1px solid #38bdf8;
            }
            .mpCloseModalBtn {
                background: transparent;
                border: none;
                color: #9ca3af;
                font-size: 26px;
                cursor: pointer;
                line-height: 1;
            }
            .mpCloseModalBtn:hover {
                color: #ffffff;
            }
            .mpActiveSessionBanner {
                background: rgba(16, 185, 129, 0.15);
                border: 1px solid #10b981;
                border-radius: 6px;
                padding: 10px 14px;
                margin-bottom: 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .mpJoinCodePreview {
                font-size: 12px;
                color: #a7f3d0;
                margin-top: 3px;
            }
            .mpBannerActions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }
            .mpModalColumns {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                gap: 20px;
                min-width: 0;
                width: 100%;
                box-sizing: border-box;
            }
            .mpModalCol {
                background: rgba(15, 23, 42, 0.55);
                border: 1px solid rgba(148, 163, 184, 0.2);
                border-radius: 6px;
                padding: 14px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                min-width: 0;
                box-sizing: border-box;
            }
            .mpModalCol h3 {
                margin: 0;
                font-size: 15px;
                color: #66c0f4;
            }
            .mpColDesc {
                margin: 0;
                font-size: 12px;
                color: #94a3b8;
            }
            .mpFieldLabel {
                font-size: 12px;
                color: #cbd5e1;
                margin-top: 4px;
            }
            .mpSelectSave,
            .mpInputPort,
            .mpInputJoinCode {
                background: #0f172a !important;
                background-color: #0f172a !important;
                color: #f8fafc !important;
                border: 1px solid #334155 !important;
                border-radius: 4px !important;
                padding: 6px 10px !important;
                margin: 0 !important;
                height: 34px !important;
                line-height: 20px !important;
                font-size: 12px !important;
                font-family: inherit !important;
                display: block !important;
                box-sizing: border-box !important;
                user-select: text !important;
                -webkit-user-select: text !important;
                pointer-events: all !important;
            }
            .mpInputGroup {
                display: flex !important;
                gap: 8px !important;
                align-items: center !important;
                width: 100% !important;
                box-sizing: border-box !important;
            }
            .mpInputGroup .mpInputJoinCode {
                flex: 1 1 auto !important;
                min-width: 0 !important;
                width: auto !important;
            }
            .mpInputGroup .mpJoinByCodeBtn {
                flex: 0 0 auto !important;
                height: 34px !important;
                line-height: 20px !important;
                margin: 0 !important;
                padding: 0 16px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
            }
            .mpPrimaryBtn {
                background: #2563eb !important;
                color: #ffffff !important;
                padding: 8px 14px !important;
            }
            .mpPrimaryBtn:hover {
                background: #3b82f6 !important;
            }
            .mpDivider {
                border: none;
                border-top: 1px solid rgba(148, 163, 184, 0.2);
                margin: 10px 0;
            }
            .mpFriendsHeader {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
            }
            .mpFriendsList {
                display: flex;
                flex-direction: column;
                gap: 6px;
                max-height: 270px;
                overflow-y: auto;
            }
            .mpFriendRow {
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: rgba(30, 41, 59, 0.75);
                border: 1px solid rgba(100, 116, 139, 0.3);
                border-radius: 5px;
                padding: 7px 10px;
            }
            .mpFriendRow.hosting {
                border-color: #4ade80;
                background: rgba(20, 83, 45, 0.35);
            }
            .mpFriendInfo {
                display: flex;
                flex-direction: column;
                font-size: 12px;
            }
            .mpFriendSub {
                font-size: 11px;
                color: #94a3b8;
            }
            .mpFriendRow.hosting .mpFriendSub {
                color: #4ade80;
            }
            .mpFriendBtns {
                display: flex;
                gap: 6px;
            }
            .mpEmptyFriends {
                font-size: 12px;
                color: #94a3b8;
                padding: 12px;
                background: rgba(15, 23, 42, 0.4);
                border-radius: 4px;
            }

            /* In-Game HUD Panel */
            #ingame_HUD_Multiplayer.mpHudPanel {
                position: absolute;
                top: 70px;
                right: 16px;
                width: 300px;
                background: rgba(17, 24, 39, 0.94);
                border: 1.5px solid rgba(102, 192, 244, 0.65);
                border-radius: 7px;
                color: #f3f4f6;
                font-family: GameFont, sans-serif;
                z-index: 900;
                pointer-events: all;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
            }
            #ingame_HUD_Multiplayer.mpHudPanel.collapsed .mpHudBody {
                display: none;
            }
            .mpHudHeader {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 10px;
                background: rgba(30, 41, 59, 0.95);
                border-radius: 6px 6px 0 0;
                font-size: 12px;
                font-weight: bold;
                cursor: move;
                user-select: none;
                -webkit-user-select: none;
            }
            .mpStatusDot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #9ca3af;
            }
            .mpStatusDot.online {
                background: #4ade80;
                box-shadow: 0 0 6px #4ade80;
            }
            .mpHeaderTitle {
                flex: 1;
                color: #66c0f4;
            }
            .mpPlayerCountBadge {
                background: #2563eb;
                color: #ffffff;
                border-radius: 10px;
                padding: 1px 7px;
                font-size: 11px;
            }
            .mpCollapseBtn {
                background: transparent;
                border: none;
                color: #cbd5e1;
                cursor: pointer;
                font-size: 14px;
                font-weight: bold;
            }
            .mpHudBody {
                padding: 8px 10px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .mpRoster {
                display: flex;
                flex-direction: column;
                gap: 4px;
                max-height: 95px;
                overflow-y: auto;
            }
            .mpRosterItem {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 11px;
                background: rgba(30, 41, 59, 0.65);
                padding: 3px 6px;
                border-radius: 4px;
            }
            .mpColorSwatch {
                width: 9px;
                height: 9px;
                border-radius: 50%;
            }
            .mpRosterName {
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .mpRosterRole {
                font-size: 9px;
                color: #93c5fd;
                background: rgba(37, 99, 235, 0.25);
                padding: 1px 5px;
                border-radius: 3px;
            }
            .mpActionRow {
                display: flex;
                gap: 5px;
                flex-wrap: wrap;
            }
            .mpActionRow .styledButton {
                font-size: 10px !important;
                padding: 4px 7px !important;
                flex: 1;
            }
            .mpChatBox {
                display: flex;
                flex-direction: column;
                gap: 6px;
                border-top: 1px solid rgba(148, 163, 184, 0.2);
                padding-top: 6px;
                box-sizing: border-box;
                width: 100%;
            }
            .mpChatMessages {
                max-height: 75px;
                overflow-y: auto;
                font-size: 11px;
                display: flex;
                flex-direction: column;
                gap: 2px;
                word-break: break-word;
            }
            .mpChatLine.mpSystemMsg .mpSysText {
                color: #93c5fd;
                font-style: italic;
            }
            .mpChatInputRow {
                display: flex !important;
                gap: 6px !important;
                align-items: center !important;
                width: 100% !important;
                box-sizing: border-box !important;
            }
            .mpChatInput {
                flex: 1 1 auto !important;
                min-width: 0 !important;
                width: auto !important;
                height: 28px !important;
                line-height: 18px !important;
                margin: 0 !important;
                background: #0f172a !important;
                background-color: #0f172a !important;
                color: #ffffff !important;
                border: 1px solid #334155 !important;
                border-radius: 4px !important;
                padding: 4px 8px !important;
                font-size: 11px !important;
                box-sizing: border-box !important;
                display: block !important;
                user-select: text !important;
                -webkit-user-select: text !important;
                pointer-events: all !important;
            }
            .mpChatSendBtn {
                flex: 0 0 auto !important;
                height: 28px !important;
                line-height: 18px !important;
                margin: 0 !important;
                font-size: 10px !important;
                padding: 4px 10px !important;
                box-sizing: border-box !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
            }

            /* Toast & Invite Banner */
            .mpToastNotification {
                position: fixed;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%) translateY(20px);
                background: rgba(15, 23, 42, 0.95);
                color: #66c0f4;
                border: 1.5px solid #66c0f4;
                border-radius: 6px;
                padding: 9px 18px;
                font-family: GameFont, sans-serif;
                font-size: 13px;
                z-index: 100000;
                opacity: 0;
                pointer-events: none;
                transition: all 0.2s ease;
            }
            .mpToastNotification.visible {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
            .mpInviteBanner {
                position: fixed;
                top: 20px;
                right: 20px;
                background: #1b2838;
                border: 2px solid #4ade80;
                border-radius: 8px;
                padding: 12px 16px;
                color: #ffffff;
                z-index: 100001;
                display: flex;
                align-items: center;
                gap: 14px;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
                font-family: GameFont, sans-serif;
            }
            .mpInviteText {
                display: flex;
                flex-direction: column;
                font-size: 12px;
                gap: 3px;
            }
            .mpInviteBtns {
                display: flex;
                gap: 6px;
            }
        `);
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        METADATA,
        PLAYER_COLORS,
        escapeHtml,
        encodeJoinCode,
        decodeJoinCode,
        HUDMultiplayer,
        Mod,
    };
}
