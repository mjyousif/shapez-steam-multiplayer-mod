/**
 * @file src/multiplayer/ui/dialogs.js
 * @description UI dialogs, modals, toasts, and main menu enhancements for the Steam Co-op Mod.
 * 
 * Provides:
 * 1. Main menu button injection and live Steam status badge indicator.
 * 2. Savegame row "Co-op" quick-host buttons.
 * 3. Central multiplayer dialog:
 *    - Host factory configuration (world selection, port binding).
 *    - Join session by Join Code or raw `IP:Port`.
 *    - Steam Friends list with 1-click Join, Invite, and Rich Presence detection.
 *    - Active session controls (Invite Overlay, Copy Code, Leave Session).
 * 4. Diagnostics modal displaying rotating in-memory and persistent disk logs.
 * 5. Animated connection and world download progress overlay with cancel option.
 * 6. Non-intrusive invite toasts and transient toast notifications.
 * 
 * Invariants:
 * - Prevents DOM event bubbling to avoid triggering game canvas zooms or clicks underneath modals.
 * - Sanitizes all user-supplied Steam persona names via `escapeHtml` to prevent XSS.
 */

const { METADATA } = require("../constants");
const { escapeHtml } = require("../join_code");

/**
 * Injects the "Steam Multiplayer" button and savegame "Co-op" buttons into the Main Menu.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} mainMenuState - Shapez MainMenuState instance.
 */
function enhanceMainMenu(mod, mainMenuState) {
    const htmlEl =
        (mainMenuState && mainMenuState.htmlElement) ||
        (typeof document !== "undefined" && typeof document.getElementById === "function"
            ? document.getElementById("state_MainMenuState")
            : null);
    if (!htmlEl) return;

    if (mod.steamStatus?.allowMultiInstance || (typeof window !== "undefined" && window.location.search.includes("multi-instance"))) {
        document.title = "shapez (Co-op Instance)";
    }

    const buttonsContainer = htmlEl.querySelector(".mainContainer .buttons");
    if (buttonsContainer) {
        if (!buttonsContainer.querySelector(".mpMainMenuBtn")) {
            const mpBtn = document.createElement("button");
            mpBtn.className = "styledButton mpMainMenuBtn";
            mpBtn.innerHTML = `<span class="mpSteamDot"></span> Steam Multiplayer`;
            mpBtn.addEventListener("click", () => openMultiplayerModal(mod, mainMenuState));
            buttonsContainer.insertBefore(mpBtn, buttonsContainer.firstChild);
        }

        if (!buttonsContainer.__mpObserver) {
            const observer = new MutationObserver(() => {
                if (buttonsContainer && !buttonsContainer.querySelector(".mpMainMenuBtn")) {
                    const mpBtn = document.createElement("button");
                    mpBtn.className = "styledButton mpMainMenuBtn";
                    mpBtn.innerHTML = `<span class="mpSteamDot"></span> Steam Multiplayer`;
                    mpBtn.addEventListener("click", () => openMultiplayerModal(mod, mainMenuState));
                    buttonsContainer.insertBefore(mpBtn, buttonsContainer.firstChild);
                    updateMainMenuBadge(mod);
                }
            });
            observer.observe(buttonsContainer, { childList: true });
            buttonsContainer.__mpObserver = observer;
        }
    }

    const saveItems = htmlEl.querySelectorAll(".savegames .savegame");
    const savesMeta = mod.app?.savegameMgr?.getSavegamesMetaData() || [];
    saveItems.forEach((row, idx) => {
        if (row.querySelector(".mpHostSaveBtn") || !savesMeta[idx]) return;
        const meta = savesMeta[idx];
        const hostBtn = document.createElement("button");
        hostBtn.className = "styledButton mpHostSaveBtn";
        hostBtn.innerText = "Co-op";
        hostBtn.title = "Host this Savegame in Steam Co-op";
        hostBtn.addEventListener("click", ev => {
            ev.stopPropagation();
            const sg = mod.app.savegameMgr.getSavegameById(meta.internalId);
            mod.startHostingSession({ savegame: sg });
        });
        row.appendChild(hostBtn);
    });

    updateMainMenuBadge(mod);
}

/**
 * Updates the online indicator dot and new version pill on the main menu button.
 *
 * @param {any} mod - Active Mod instance.
 */
function updateMainMenuBadge(mod) {
    const btn = document.querySelector(".mpMainMenuBtn");
    if (!btn) return;

    const dot = btn.querySelector(".mpSteamDot");
    if (dot) {
        dot.classList.remove("online", "warning");
        if (mod.steamStatus?.initialized) {
            dot.classList.add("online");
        } else if (mod.bridgeAvailable === false) {
            dot.classList.add("warning");
            dot.title = "Steamworks bridge unpatched. Run ShapezCoopInstaller.exe to patch app.asar";
        }
    }

    let badge = btn.querySelector(".mpUpdateNoticePill");
    if (mod.updateInfo && mod.updateInfo.isNewer) {
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "mpUpdateNoticePill";
            btn.appendChild(badge);
        }
        badge.innerText = `Update v${mod.updateInfo.version}`;
        badge.title = `A new version (v${mod.updateInfo.version}) of shapez Steam Co-op is available!`;
    } else if (badge) {
        badge.remove();
    }
}

/**
 * Opens the central cooperative multiplayer modal dialog.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} [mainMenuState=null] - Active MainMenuState instance.
 */
async function openMultiplayerModal(mod, mainMenuState = null) {
    closeMultiplayerModal(mod);
    await mod.refreshSteamStatus();

    const profile = mod.steamStatus?.profile || { name: "Player", steamId: "local", isSteam: false };
    const friends =
        (typeof ipcRenderer !== "undefined" &&
            (await ipcRenderer.invoke("steam:mp:get-friends").catch(() => []))) ||
        [];
    const savesMeta = mod.app?.savegameMgr?.getSavegamesMetaData() || [];
    const active = mod.isSessionActive();
    const bridgeMissing = mod.bridgeAvailable === false;

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
            ${
                bridgeMissing
                    ? `
            <div class="mpBridgeWarning">
                <strong>Steamworks Bridge Unpatched:</strong> The core game archive (<code>resources\\app.asar</code>) has not been patched. Steam lobbies, invites, and multi-instance sync require running <strong>ShapezCoopInstaller.exe</strong> with shapez closed.
            </div>
            `
                    : ""
            }

            ${
                mod.updateInfo?.isNewer
                    ? `
            <div class="mpUpdateModalBanner">
                <div class="mpUpdateModalText">
                    <strong>★ Update Available: v${escapeHtml(mod.updateInfo.version)}</strong> (Currently installed: v${escapeHtml(METADATA.version)})
                    <div class="mpUpdateModalSub">A newer release of shapez Steam Co-op is available on GitHub with updates and fixes.</div>
                </div>
                <button class="styledButton mpOpenUpdateBtn">View Release on GitHub</button>
            </div>
            `
                    : ""
            }

            ${
                active
                    ? `
                <div class="mpActiveSessionBanner">
                    <div>
                        <strong>Active Session (${mod.role.toUpperCase()} — Mode: ${mod.mode.toUpperCase()})</strong>
                        <div class="mpJoinCodePreview">Join Endpoint: <code>${escapeHtml(
                            mod.hostEndpoint || "Connected"
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
                        ${mod.currentRoot ? "Host Current Factory in Co-op" : "Start Hosting Co-op Factory"}
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
    mod.modalEl = overlay;

    const modalCard = overlay.querySelector(".mpModalCard");
    const friendsList = overlay.querySelector(".mpFriendsList");
    if (modalCard) {
        modalCard.addEventListener("mousedown", ev => ev.stopPropagation());
        modalCard.addEventListener(
            "wheel",
            ev => {
                ev.stopPropagation();
                modalCard.scrollTop += ev.deltaY;
            },
            { passive: false }
        );
    }
    if (friendsList) {
        friendsList.addEventListener(
            "wheel",
            ev => {
                ev.stopPropagation();
                friendsList.scrollTop += ev.deltaY;
            },
            { passive: false }
        );
    }
    overlay.addEventListener("wheel", ev => ev.stopPropagation(), { passive: false });

    overlay.querySelector(".mpCloseModalBtn").addEventListener("click", () => closeMultiplayerModal(mod));
    overlay.addEventListener("click", ev => {
        if (ev.target === overlay) closeMultiplayerModal(mod);
    });

    const openUpdateBtn = overlay.querySelector(".mpOpenUpdateBtn");
    if (openUpdateBtn && mod.updateInfo?.url) {
        openUpdateBtn.addEventListener("click", () => mod.openExternalUrl(mod.updateInfo.url));
    }

    const startHostBtn = overlay.querySelector(".mpStartHostBtn");
    if (startHostBtn) {
        startHostBtn.addEventListener("click", async () => {
            const portVal = Number(overlay.querySelector(".mpInputPort").value) || 27080;
            const saveVal = overlay.querySelector(".mpSelectSave").value;
            let chosenSave = null;
            if (mod.currentRoot && mod.currentRoot.savegame) {
                chosenSave = mod.currentRoot.savegame;
            } else if (saveVal && saveVal !== "__new__") {
                chosenSave = mod.app.savegameMgr.getSavegameById(saveVal);
            }
            closeMultiplayerModal(mod);
            await mod.startHostingSession({ savegame: chosenSave, port: portVal, mode: "coop" });
        });
    }

    const joinCodeInput = overlay.querySelector(".mpInputJoinCode");
    const joinByCodeBtn = overlay.querySelector(".mpJoinByCodeBtn");
    if (joinByCodeBtn && joinCodeInput) {
        const triggerJoin = () => {
            const val = joinCodeInput.value.trim() || "127.0.0.1:27080";
            closeMultiplayerModal(mod);
            mod.joinByCodeOrAddress(val);
        };
        joinByCodeBtn.addEventListener("click", triggerJoin);
        joinCodeInput.addEventListener("keydown", ev => {
            ev.stopPropagation();
            if (ev.key === "Enter") triggerJoin();
        });
    }

    const viewLogsBtn = overlay.querySelector(".mpViewLogsBtn");
    if (viewLogsBtn) {
        viewLogsBtn.addEventListener("click", () => openLogsModal(mod));
    }

    const openOverlayBtn = overlay.querySelector(".mpOpenOverlayBtn");
    if (openOverlayBtn) {
        openOverlayBtn.addEventListener("click", () => {
            ipcRenderer.invoke("steam:mp:invite-overlay", mod.lobbyId);
        });
    }

    const copyModalBtn = overlay.querySelector(".mpCopyJoinCodeModalBtn");
    if (copyModalBtn) {
        copyModalBtn.addEventListener("click", () => copyJoinInfoToClipboard(mod));
    }

    const overlayModalBtn = overlay.querySelector(".mpSteamOverlayModalBtn");
    if (overlayModalBtn) {
        overlayModalBtn.addEventListener("click", () => {
            ipcRenderer.invoke("steam:mp:invite-overlay", mod.lobbyId);
        });
    }

    const disconnectModalBtn = overlay.querySelector(".mpDisconnectModalBtn");
    if (disconnectModalBtn) {
        disconnectModalBtn.addEventListener("click", async () => {
            await mod.stopSession(true);
            closeMultiplayerModal(mod);
        });
    }

    overlay.querySelectorAll(".mpInviteFriendBtn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const friendSteamId = btn.getAttribute("data-steamid");
            const friendName = btn.getAttribute("data-name");
            if (!mod.isSessionActive()) {
                await mod.startHostingSession({
                    savegame: mod.currentRoot?.savegame || null,
                    port: 27080,
                    mode: "coop",
                });
            }
            await ipcRenderer.invoke("steam:mp:invite-friend", {
                friendSteamId,
                lobbyId: mod.lobbyId,
                joinCode: mod.joinCode,
            });
            btn.innerText = "Invited!";
            showToast(mod, `Sent Steam Co-op invite to ${friendName}!`);
        });
    });

    overlay.querySelectorAll(".mpJoinFriendBtn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const friendSteamId = btn.getAttribute("data-steamid");
            const endpoint = btn.getAttribute("data-endpoint");
            const lobby = btn.getAttribute("data-lobby");
            closeMultiplayerModal(mod);
            await mod.connectToHost({
                endpoints: endpoint ? endpoint.split(",") : [],
                lobbyId: lobby,
                hostSteamId: friendSteamId,
            });
        });
    });
}

/**
 * Closes the multiplayer modal overlay.
 *
 * @param {any} mod - Active Mod instance.
 */
function closeMultiplayerModal(mod) {
    if (mod.modalEl) {
        mod.modalEl.remove();
        mod.modalEl = null;
    }
}

/**
 * Opens the co-op diagnostic log viewer modal.
 *
 * @param {any} mod - Active Mod instance.
 */
async function openLogsModal(mod) {
    let logData = { logFilePath: "%APPDATA%\\shapez.io\\coop-multiplayer.log", lines: [] };
    if (typeof ipcRenderer !== "undefined") {
        try {
            const res = await ipcRenderer.invoke("steam:mp:get-logs");
            if (res) logData = res;
        } catch {}
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
    const pre = modal.querySelector("pre");
    if (pre) {
        pre.addEventListener(
            "wheel",
            ev => {
                ev.stopPropagation();
                pre.scrollTop += ev.deltaY;
            },
            { passive: false }
        );
    }
    modal.addEventListener("wheel", ev => ev.stopPropagation(), { passive: false });
    modal.querySelector(".mpModalCard")?.addEventListener("mousedown", ev => ev.stopPropagation());

    modal.querySelector(".mpCloseModalBtn").addEventListener("click", close);
    modal.querySelector(".mpCloseLogsBtn").addEventListener("click", close);
    modal.querySelector(".mpCopyLogsBtn").addEventListener("click", () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(logText).catch(() => {});
        }
        showToast(mod, "Copied diagnostic logs to clipboard!");
    });
}

/**
 * Displays an animated loading overlay during session joining and world transfer.
 *
 * @param {any} mod - Active Mod instance.
 * @param {string} [initialStatus="Connecting to Host..."] - Status message.
 */
function showJoinProgressModal(mod, initialStatus = "Connecting to Host...") {
    closeJoinProgressModal(mod);
    if (typeof document === "undefined" || !document.body) return;

    const overlay = document.createElement("div");
    overlay.className = "mpJoinOverlayBackdrop";
    overlay.innerHTML = `
        <div class="mpJoinCard">
            <div class="mpJoinSpinner"></div>
            <h3 class="mpJoinTitle">Connecting to Co-op Session</h3>
            <p class="mpJoinStatus">${escapeHtml(initialStatus)}</p>
            <div class="mpJoinProgressContainer" style="display: none;">
                <div class="mpJoinProgressBar"></div>
            </div>
            <button class="styledButton mpCancelJoinBtn">Cancel</button>
        </div>
    `;

    const card = overlay.querySelector ? overlay.querySelector(".mpJoinCard") : null;
    if (card && typeof card.addEventListener === "function") {
        card.addEventListener("mousedown", ev => ev.stopPropagation());
    }

    const cancelBtn = overlay.querySelector ? overlay.querySelector(".mpCancelJoinBtn") : null;
    if (cancelBtn && typeof cancelBtn.addEventListener === "function") {
        cancelBtn.addEventListener("click", async () => {
            mod.logInfo("User cancelled co-op join");
            mod.isConnecting = false;
            closeJoinProgressModal(mod);
            await mod.stopSession(true);
        });
    }

    document.body.appendChild(overlay);
    mod.joinOverlayEl = overlay;
}

/**
 * Updates text and progress bar percentage on the join progress overlay.
 *
 * @param {any} mod - Active Mod instance.
 * @param {string} statusText - Status message.
 * @param {number | null} [progressPercent=null] - Progress percentage (0 to 100).
 */
function updateJoinProgressModal(mod, statusText, progressPercent = null) {
    if (!mod.joinOverlayEl || typeof mod.joinOverlayEl.querySelector !== "function") return;
    const statusEl = mod.joinOverlayEl.querySelector(".mpJoinStatus");
    if (statusEl && statusText) {
        statusEl.innerText = statusText;
    }
    const progContainer = mod.joinOverlayEl.querySelector(".mpJoinProgressContainer");
    const progBar = mod.joinOverlayEl.querySelector(".mpJoinProgressBar");
    if (progContainer && progContainer.style && progBar && progBar.style) {
        if (typeof progressPercent === "number" && progressPercent >= 0) {
            progContainer.style.display = "block";
            progBar.style.width = Math.min(100, Math.max(0, Math.round(progressPercent))) + "%";
        }
    }
}

/**
 * Dismisses and removes the join progress modal overlay.
 *
 * @param {any} mod - Active Mod instance.
 */
function closeJoinProgressModal(mod) {
    if (mod.joinOverlayEl) {
        try {
            if (typeof mod.joinOverlayEl.remove === "function") {
                mod.joinOverlayEl.remove();
            }
        } catch {}
        mod.joinOverlayEl = null;
    }
}

/**
 * Copies the active session's Join Code or direct endpoint to the system clipboard.
 *
 * @param {any} mod - Active Mod instance.
 */
function copyJoinInfoToClipboard(mod) {
    const textToCopy = mod.joinCode || mod.hostEndpoint || "127.0.0.1:27080";
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).catch(() => {});
    }
    showToast(mod, `Copied Join Code (${mod.hostEndpoint || textToCopy}) to clipboard!`);
}

/**
 * Displays an in-game notification toast when receiving a Steam Lobby invite.
 *
 * @param {any} mod - Active Mod instance.
 * @param {{ fromName: string, fromSteamId: string, lobbyId: string, joinCode: string }} params - Invite parameters.
 */
function showInviteToast(mod, { fromName, fromSteamId, lobbyId, joinCode }) {
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
            mod.joinByCodeOrAddress(joinCode);
        } else if (lobbyId) {
            mod.joinSteamLobby(lobbyId, fromSteamId);
        } else if (fromSteamId) {
            mod.connectToHost({ endpoints: [], lobbyId: "", hostSteamId: fromSteamId });
        }
    });

    banner.querySelector(".mpDismissInviteBtn").addEventListener("click", () => banner.remove());
    setTimeout(() => {
        if (banner.parentElement) banner.remove();
    }, 20000);
}

/**
 * Displays a transient notification toast banner.
 *
 * @param {any} mod - Active Mod instance.
 * @param {string} text - Message text.
 */
function showToast(mod, text) {
    let toast = document.querySelector(".mpToastNotification");
    if (!toast) {
        toast = document.createElement("div");
        toast.className = "mpToastNotification";
        document.body.appendChild(toast);
    }
    toast.innerText = text;
    toast.classList.add("visible");
    clearTimeout(mod.toastTimer);
    mod.toastTimer = setTimeout(() => {
        toast.classList.remove("visible");
    }, 3800);
}

module.exports = {
    enhanceMainMenu,
    updateMainMenuBadge,
    openMultiplayerModal,
    closeMultiplayerModal,
    openLogsModal,
    showJoinProgressModal,
    updateJoinProgressModal,
    closeJoinProgressModal,
    copyJoinInfoToClipboard,
    showInviteToast,
    showToast,
};
