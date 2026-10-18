/**
 * @file src/multiplayer/ui/styles.js
 * @description Injected CSS styling for in-game multiplayer HUD, modals, dialogs, and toasts.
 */

const MULTIPLAYER_CSS = `
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
            .mpUpdateNoticePill {
                background: #f59e0b !important;
                color: #0f172a !important;
                font-weight: 700 !important;
                font-size: 10px !important;
                line-height: 1 !important;
                padding: 3px 7px !important;
                border-radius: 10px !important;
                margin-left: 6px !important;
                letter-spacing: 0.3px !important;
            }
            .mpUpdateModalBanner {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                background: rgba(245, 158, 11, 0.12);
                border: 1px solid rgba(245, 158, 11, 0.4);
                border-radius: 8px;
                padding: 10px 14px;
                margin-bottom: 14px;
            }
            .mpUpdateModalText {
                font-size: 12px;
                color: #fef3c7;
                line-height: 1.4;
            }
            .mpUpdateModalSub {
                font-size: 11px;
                color: #cbd5e1;
                margin-top: 3px;
            }
            .mpOpenUpdateBtn {
                background: #f59e0b !important;
                color: #0f172a !important;
                font-weight: 700 !important;
                font-size: 11px !important;
                padding: 6px 14px !important;
                border-radius: 4px !important;
                white-space: nowrap !important;
                cursor: pointer !important;
                flex-shrink: 0 !important;
            }
            .mpOpenUpdateBtn:hover {
                background: #fbbf24 !important;
                color: #020617 !important;
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
                width: 290px;
                max-height: calc(100vh - 90px);
                display: flex;
                flex-direction: column;
                background: rgba(15, 23, 42, 0.95);
                border: 1.5px solid rgba(102, 192, 244, 0.65);
                border-radius: 8px;
                color: #f3f4f6;
                font-family: GameFont, sans-serif;
                z-index: 900;
                pointer-events: all;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                box-sizing: border-box;
                overflow: hidden;
            }
            #ingame_HUD_Multiplayer.mpHudPanel.collapsed {
                max-height: none;
            }
            #ingame_HUD_Multiplayer.mpHudPanel.collapsed .mpHudBody {
                display: none;
            }
            .mpHudHeader {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 7px 10px;
                background: rgba(30, 41, 59, 0.95);
                border-bottom: 1px solid rgba(102, 192, 244, 0.25);
                border-radius: 6px 6px 0 0;
                font-size: 12px;
                font-weight: bold;
                cursor: move;
                user-select: none;
                -webkit-user-select: none;
                flex: 0 0 auto;
            }
            .mpStatusDot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #9ca3af;
                flex-shrink: 0;
            }
            .mpStatusDot.online {
                background: #4ade80;
                box-shadow: 0 0 6px #4ade80;
            }
            .mpHeaderTitle {
                flex: 1;
                color: #66c0f4;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .mpPlayerCountBadge {
                background: #2563eb;
                color: #ffffff;
                border-radius: 10px;
                padding: 1px 7px;
                font-size: 11px;
                flex-shrink: 0;
            }
            .mpCollapseBtn {
                background: transparent;
                border: none;
                color: #cbd5e1;
                cursor: pointer;
                font-size: 14px;
                font-weight: bold;
                padding: 0 4px;
                line-height: 1;
            }
            .mpCollapseBtn:hover {
                color: #ffffff;
            }
            .mpHudBody {
                padding: 8px 10px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                overflow-y: auto;
                overflow-x: hidden;
                box-sizing: border-box;
                flex: 1 1 auto;
                min-height: 0;
            }
            .mpRoster {
                display: flex;
                flex-direction: column;
                gap: 4px;
                max-height: 90px;
                overflow-y: auto;
                overflow-x: hidden;
                box-sizing: border-box;
                padding-right: 2px;
                flex-shrink: 0;
            }
            .mpRosterItem {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 11px;
                background: rgba(30, 41, 59, 0.75);
                border: 1px solid rgba(100, 116, 139, 0.25);
                padding: 4px 8px;
                border-radius: 4px;
                box-sizing: border-box;
                min-height: 25px;
            }
            .mpColorSwatch {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                flex-shrink: 0;
            }
            .mpRosterName {
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 11px;
            }
            .mpRosterRole {
                font-size: 9px;
                color: #93c5fd;
                background: rgba(37, 99, 235, 0.3);
                padding: 1px 5px;
                border-radius: 3px;
                font-weight: 600;
                letter-spacing: 0.5px;
                flex-shrink: 0;
            }
            .mpActionRow {
                display: grid !important;
                grid-template-columns: 1fr 1fr !important;
                gap: 6px !important;
                width: 100% !important;
                box-sizing: border-box !important;
                flex-shrink: 0;
            }
            .mpActionRow .styledButton {
                box-sizing: border-box !important;
                height: 28px !important;
                min-height: 28px !important;
                max-height: 28px !important;
                padding: 0 6px !important;
                font-size: 10px !important;
                line-height: 26px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                text-align: center !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                margin: 0 !important;
                border-radius: 4px !important;
                cursor: pointer !important;
            }
            .mpChatBox {
                display: flex;
                flex-direction: column;
                gap: 6px;
                border-top: 1px solid rgba(148, 163, 184, 0.2);
                padding-top: 6px;
                box-sizing: border-box;
                width: 100%;
                flex-shrink: 0;
            }
            .mpChatMessages {
                height: 80px;
                max-height: 110px;
                overflow-y: auto;
                overflow-x: hidden;
                font-size: 11px;
                display: flex;
                flex-direction: column;
                gap: 3px;
                word-break: break-word;
                background: rgba(15, 23, 42, 0.6);
                border: 1px solid rgba(51, 65, 85, 0.6);
                border-radius: 4px;
                padding: 5px 7px;
                box-sizing: border-box;
            }
            .mpChatLine {
                line-height: 1.35;
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
                line-height: 26px !important;
                margin: 0 !important;
                background: #0f172a !important;
                background-color: #0f172a !important;
                color: #ffffff !important;
                border: 1px solid #334155 !important;
                border-radius: 4px !important;
                padding: 0 8px !important;
                font-size: 11px !important;
                box-sizing: border-box !important;
                display: block !important;
                user-select: text !important;
                -webkit-user-select: text !important;
                pointer-events: all !important;
            }
            .mpChatInput:focus {
                border-color: #38bdf8 !important;
                outline: none !important;
            }
            .mpChatSendBtn {
                flex: 0 0 auto !important;
                height: 28px !important;
                min-height: 28px !important;
                max-height: 28px !important;
                line-height: 26px !important;
                margin: 0 !important;
                font-size: 10px !important;
                padding: 0 12px !important;
                box-sizing: border-box !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                border-radius: 4px !important;
                cursor: pointer !important;
            }

            /* Dedicated Clean Scrollbars inside HUD Panel & Modals */
            .mpHudPanel ::-webkit-scrollbar,
            .mpModalCard ::-webkit-scrollbar {
                width: 5px !important;
                height: 5px !important;
            }
            .mpHudPanel ::-webkit-scrollbar-track,
            .mpModalCard ::-webkit-scrollbar-track {
                background: rgba(15, 23, 42, 0.4) !important;
                border-radius: 3px !important;
            }
            .mpHudPanel ::-webkit-scrollbar-thumb,
            .mpModalCard ::-webkit-scrollbar-thumb {
                background: #475569 !important;
                border-radius: 3px !important;
            }
            .mpHudPanel ::-webkit-scrollbar-thumb:hover,
            .mpModalCard ::-webkit-scrollbar-thumb:hover {
                background: #64748b !important;
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

            /* Joining & World Sync Progress Overlay */
            .mpJoinOverlayBackdrop {
                position: fixed;
                inset: 0;
                background: rgba(10, 15, 25, 0.88);
                z-index: 100000;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: GameFont, sans-serif;
                backdrop-filter: blur(4px);
            }
            .mpJoinCard {
                width: min(440px, 90vw);
                background: #1b2838;
                border: 2px solid #66c0f4;
                border-radius: 10px;
                padding: 24px;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85);
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
                gap: 12px;
                color: #e5e7eb;
                box-sizing: border-box;
            }
            .mpJoinSpinner {
                width: 38px;
                height: 38px;
                border: 4px solid rgba(102, 192, 244, 0.2);
                border-top-color: #66c0f4;
                border-radius: 50%;
                animation: mpSpin 0.9s linear infinite;
            }
            @keyframes mpSpin {
                to { transform: rotate(360deg); }
            }
            .mpJoinTitle {
                margin: 0;
                font-size: 18px;
                color: #ffffff;
            }
            .mpJoinStatus {
                margin: 0;
                font-size: 13px;
                color: #94a3b8;
                min-height: 20px;
                word-break: break-word;
            }
            .mpJoinProgressContainer {
                width: 100%;
                height: 8px;
                background: #0f172a;
                border: 1px solid #334155;
                border-radius: 4px;
                overflow: hidden;
                margin-top: 4px;
                box-sizing: border-box;
            }
            .mpJoinProgressBar {
                height: 100%;
                width: 0%;
                background: linear-gradient(90deg, #38bdf8, #4ade80);
                transition: width 0.2s ease-out;
            }
            .mpCancelJoinBtn {
                margin-top: 8px !important;
                background: #334155 !important;
                color: #cbd5e1 !important;
                font-size: 12px !important;
                padding: 6px 16px !important;
            }
            .mpCancelJoinBtn:hover {
                background: #475569 !important;
                color: #ffffff !important;
            }
`;

/**
 * Injects multiplayer CSS styles into the game document.
 * @param {any} modInterface - Shapez modInterface instance.
 */
function injectStyles(modInterface) {
    if (modInterface && typeof modInterface.registerCss === "function") {
        modInterface.registerCss(MULTIPLAYER_CSS);
    }
}

module.exports = {
    MULTIPLAYER_CSS,
    injectStyles,
};
