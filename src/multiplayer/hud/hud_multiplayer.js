/**
 * @file src/multiplayer/hud/hud_multiplayer.js
 * @description In-game HUD part (`HUDMultiplayer`) extending `shapez.BaseHUDPart`.
 * 
 * Provides:
 * 1. Top-right collapsible, draggable in-game multiplayer control panel.
 * 2. Visual online status pill and live active player count badge.
 * 3. Color-coded roster displaying player avatars, Steam display names, and roles (HOST, YOU, CO-OP).
 * 4. Quick action buttons (Invite Steam Friends, Copy Join Code, Ping Map [P], Request World Resync).
 * 5. In-game cooperative text chat log with scroll lock and input filtering.
 * 6. High-frequency tick updates for cursor broadcasting and canvas overlay rendering.
 * 
 * Invariants:
 * - Prevents DOM event propagation (clicks, wheel scrolling) from triggering underlying game canvas panning/zooming.
 * - Safely detaches keyboard listeners (`P` for ping) upon scene teardown / game exit.
 */

const { escapeHtml } = require("../join_code");

/**
 * In-game HUD element managing the multiplayer status, roster, and cooperative chat.
 * Extends `shapez.BaseHUDPart` when running in the game engine.
 */
class HUDMultiplayer extends (typeof shapez !== "undefined" && shapez.BaseHUDPart ? shapez.BaseHUDPart : class {}) {
    /**
     * Constructs DOM elements for the in-game multiplayer HUD widget.
     * @param {HTMLElement} parent - Parent DOM container.
     */
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

    /**
     * Initializes event listeners, drag handlers, and hooks into the active Mod instance.
     */
    initialize() {
        this.mod = window.$shapezMultiplayerMod;
        this.collapsed = false;
        this.lastCursorBroadcast = 0;

        if (this.mod) {
            this.mod.attachGameRoot(this.root, this);
        }

        const collapseBtn = this.container.querySelector(".mpCollapseBtn");
        const header = this.container.querySelector(".mpHudHeader");
        const body = this.container.querySelector(".mpHudBody");
        const rosterEl = this.container.querySelector(".mpRoster");
        const chatMessagesEl = this.container.querySelector(".mpChatMessages");
        const inviteBtn = this.container.querySelector(".mpBtnInvite");
        const copyBtn = this.container.querySelector(".mpBtnCopyCode");
        const pingBtn = this.container.querySelector(".mpBtnPing");
        const resyncBtn = this.container.querySelector(".mpBtnResync");
        const chatInput = this.container.querySelector(".mpChatInput");
        const chatSendBtn = this.container.querySelector(".mpChatSendBtn");

        // Prevent mouse clicks in the HUD body from bubbling to canvas panning
        if (body) {
            body.addEventListener("mousedown", ev => {
                ev.stopPropagation();
            });
        }

        // Enable smooth wheel scrolling without zooming the underlying game map
        const makeScrollable = el => {
            if (!el) return;
            el.addEventListener(
                "wheel",
                ev => {
                    ev.stopPropagation();
                    el.scrollTop += ev.deltaY;
                },
                { passive: false }
            );
        };
        makeScrollable(rosterEl);
        makeScrollable(chatMessagesEl);
        makeScrollable(body);

        this.container.addEventListener(
            "wheel",
            ev => {
                ev.stopPropagation();
            },
            { passive: false }
        );

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

    /**
     * Cleans up registered global event handlers and detaches the game root.
     */
    cleanup() {
        if (this.keyDownHandler) {
            window.removeEventListener("keydown", this.keyDownHandler);
            this.keyDownHandler = null;
        }
        if (this.mod && this.mod.currentHud === this) {
            this.mod.detachGameRoot(this.root);
        }
        if (super.cleanup) {
            super.cleanup();
        }
    }

    /**
     * Re-renders the roster list, connection status badge, and role pill.
     */
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

    /**
     * Appends a chat or system notification message to the in-game chat log.
     *
     * @param {string} senderName - Name of player or system.
     * @param {string} color - Hex color for name.
     * @param {string} text - Message text.
     * @param {boolean} [isSystem=false] - True if this is an automated system announcement.
     */
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

    /**
     * High-frequency game update hook (called once per frame).
     */
    update() {
        if (!this.mod || !this.mod.isSessionActive()) return;
        const now = performance.now();
        if (now - this.lastCursorBroadcast >= 50) {
            this.lastCursorBroadcast = now;
            this.mod.broadcastLocalCursorState(this.root);
        }
        this.mod.onInGameTick(this.root, now);
    }

    /**
     * World-space rendering hook for drawing remote player ghost previews.
     * @param {any} parameters - Drawing parameters.
     */
    draw(parameters) {
        if (!this.mod || !this.mod.isSessionActive()) return;
        this.mod.drawWorldSpacePeers(this.root, parameters);
    }

    /**
     * Screen-space overlay rendering hook for drawing player tags, arrows, and pings.
     * @param {any} parameters - Drawing parameters.
     */
    drawOverlays(parameters) {
        if (!this.mod || !this.mod.isSessionActive()) return;
        this.mod.drawScreenSpaceOverlays(this.root, parameters);
    }
}

module.exports = {
    HUDMultiplayer,
};
