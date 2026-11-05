/**
 * @file src/multiplayer/ui/styles.js
 * @description Injected CSS styling for in-game multiplayer HUD, modals, dialogs, and toasts.
 * Uses dynamic scaling via shapez.io's --ui-scale CSS property to ensure proportional rendering
 * across all monitor resolutions and UI scaling preferences.
 */

/**
 * Scales a pixel value dynamically according to shapez.io's --ui-scale CSS custom property.
 * Defaults to 1 if --ui-scale is not set or running outside the game environment.
 * @param {number} px
 * @returns {string}
 */
const D = px => `calc(${px}px * var(--ui-scale, 1))`;

const MULTIPLAYER_CSS = `
            .mpMainMenuBtn {
                background: linear-gradient(135deg, #1b2838 0%, #2a475e 100%) !important;
                color: #66c0f4 !important;
                border: 1px solid #66c0f4 !important;
                display: flex !important;
                align-items: center;
                justify-content: center;
                gap: ${D(8)};
                margin-bottom: ${D(8)} !important;
            }
            .mpMainMenuBtn:hover {
                background: linear-gradient(135deg, #2a475e 0%, #3b6584 100%) !important;
                color: #ffffff !important;
            }
            .mpSteamDot {
                width: ${D(9)};
                height: ${D(9)};
                border-radius: 50%;
                background: #9ca3af;
                display: inline-block;
            }
            .mpSteamDot.online {
                background: #4ade80;
                box-shadow: 0 0 ${D(8)} #4ade80;
            }
            .mpSteamDot.warning {
                background: #f59e0b;
                box-shadow: 0 0 ${D(8)} #f59e0b;
            }
            .mpBridgeWarning {
                background: rgba(239, 68, 68, 0.12);
                border: 1px solid rgba(239, 68, 68, 0.4);
                border-radius: ${D(8)};
                padding: ${D(10)} ${D(14)};
                margin-bottom: ${D(14)};
                color: #fca5a5;
                font-size: ${D(12)};
                line-height: 1.5;
            }
            .mpBridgeWarning strong {
                color: #ef4444;
            }
            .mpUpdateNoticePill {
                background: #f59e0b !important;
                color: #0f172a !important;
                font-weight: 700 !important;
                font-size: ${D(10)} !important;
                line-height: 1 !important;
                padding: ${D(3)} ${D(7)} !important;
                border-radius: ${D(10)} !important;
                margin-left: ${D(6)} !important;
                letter-spacing: 0.3px !important;
            }
            .mpUpdateModalBanner {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: ${D(12)};
                background: rgba(245, 158, 11, 0.12);
                border: 1px solid rgba(245, 158, 11, 0.4);
                border-radius: ${D(8)};
                padding: ${D(10)} ${D(14)};
                margin-bottom: ${D(14)};
            }
            .mpUpdateModalText {
                font-size: ${D(12)};
                color: #fef3c7;
                line-height: 1.4;
            }
            .mpUpdateModalSub {
                font-size: ${D(11)};
                color: #cbd5e1;
                margin-top: ${D(3)};
            }
            .mpOpenUpdateBtn {
                background: #f59e0b !important;
                color: #0f172a !important;
                font-weight: 700 !important;
                font-size: ${D(11)} !important;
                padding: ${D(6)} ${D(14)} !important;
                border-radius: ${D(4)} !important;
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
                font-size: ${D(11)} !important;
                padding: ${D(3)} ${D(8)} !important;
                margin-left: ${D(4)} !important;
                border-radius: ${D(4)} !important;
            }

            /* Modal Backdrop & Card */
            .mpModalBackdrop {
                pointer-events: all !important;
            }
            .mpModalBackdrop,
            .mpModalBackdrop * {
                pointer-events: all !important;
                position: fixed;
                inset: 0;
                background: rgba(10, 15, 25, 0.78);
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: GameFont, sans-serif;
                cursor: grab;
                user-select: none;
                -webkit-user-select: none;
                pointer-events: all !important;
            }
            .mpInviteBanner,
            .mpInviteBanner * {
                pointer-events: all !important;
            .mpModalCard {
                width: min(${D(860)}, 92vw);
                max-height: 88vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-sizing: border-box;
                background: #1b2838;
                color: #e5e7eb;
                border: 2px solid #66c0f4;
                border-radius: ${D(8)};
                padding: ${D(18)} ${D(22)};
                box-shadow: 0 ${D(20)} ${D(50)} rgba(0, 0, 0, 0.7);
                position: relative;
            }

            /* Normalize shapez's global .styledButton inside multiplayer modals and overlays */
            .mpModalCard .styledButton,
            .mpInviteBanner .styledButton,
            .mpJoinCard .styledButton {
                font-size: ${D(12)} !important;
                line-height: ${D(16)} !important;
                padding: ${D(6)} ${D(12)} !important;
                margin: 0 !important;
                white-space: nowrap !important;
                box-sizing: border-box !important;
                border-radius: ${D(4)} !important;
                letter-spacing: 0.3px !important;
            }
            .mpModalCard .mpPrimaryBtn.mpStartHostBtn {
                font-size: ${D(13)} !important;
                padding: ${D(8)} ${D(14)} !important;
                white-space: normal !important;
                line-height: 1.3 !important;
            }

            .mpModalHeader {
                flex: 0 0 auto;
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                border-bottom: 1px solid rgba(102, 192, 244, 0.25);
                padding-bottom: ${D(10)};
                margin-bottom: ${D(12)};
                cursor: grab;
                user-select: none;
                -webkit-user-select: none;
            }
            .mpModalHeader h2 {
                margin: 0 0 ${D(6)} 0;
                color: #ffffff;
                font-size: ${D(20)};
            }
            .mpSubHeader {
                display: flex;
                align-items: center;
                gap: ${D(10)};
                font-size: ${D(12)};
                color: #9ca3af;
            }
            .mpBadge {
                padding: ${D(2)} ${D(8)};
                border-radius: ${D(4)};
                font-weight: bold;
                font-size: ${D(11)};
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
                font-size: ${D(24)};
                cursor: pointer;
                line-height: 1;
            }
            .mpCloseModalBtn:hover {
                color: #ffffff;
            }
            .mpActiveSessionBanner {
                flex: 0 0 auto;
                background: rgba(16, 185, 129, 0.15);
                border: 1px solid #10b981;
                border-radius: ${D(6)};
                padding: ${D(10)} ${D(14)};
                margin-bottom: ${D(12)};
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: ${D(12)};
            }
            .mpJoinCodePreview {
                font-size: ${D(12)};
                color: #a7f3d0;
                margin-top: ${D(3)};
            }
            .mpBannerActions {
                display: flex;
                gap: ${D(8)};
                flex-wrap: wrap;
            }
            .mpModalColumns {
                flex: 1 1 auto;
                min-height: 0;
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                gap: ${D(16)};
                min-width: 0;
                width: 100%;
                box-sizing: border-box;
                overflow: hidden;
            }
            .mpModalCol {
                background: rgba(15, 23, 42, 0.55);
                border: 1px solid rgba(148, 163, 184, 0.2);
                border-radius: ${D(6)};
                padding: ${D(12)};
                display: flex;
                flex-direction: column;
                gap: ${D(8)};
                min-width: 0;
                min-height: 0;
                box-sizing: border-box;
            }
            .mpModalCol h3 {
                margin: 0;
                font-size: ${D(15)};
                color: #66c0f4;
            }
            .mpColDesc {
                margin: 0;
                font-size: ${D(12)};
                color: #94a3b8;
                flex: 0 0 auto;
            }
            .mpFieldLabel {
                font-size: ${D(12)};
                color: #cbd5e1;
                margin-top: ${D(4)};
            }
            .mpSelectSave,
            .mpInputPort,
            .mpInputJoinCode {
                background: #0f172a !important;
                background-color: #0f172a !important;
                color: #f8fafc !important;
                border: 1px solid #334155 !important;
                border-radius: ${D(4)} !important;
                padding: ${D(6)} ${D(10)} !important;
                margin: 0 !important;
                height: ${D(34)} !important;
                line-height: ${D(20)} !important;
                font-size: ${D(12)} !important;
                font-family: inherit !important;
                display: block !important;
                box-sizing: border-box !important;
                user-select: text !important;
                -webkit-user-select: text !important;
                pointer-events: all !important;
            }
            .mpInputGroup {
                display: flex !important;
                gap: ${D(8)} !important;
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
                height: ${D(34)} !important;
                line-height: ${D(20)} !important;
                margin: 0 !important;
                padding: 0 ${D(16)} !important;
                font-size: ${D(12)} !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
            }
            .mpPrimaryBtn {
                background: #2563eb !important;
                color: #ffffff !important;
                padding: ${D(8)} ${D(14)} !important;
            }
            .mpPrimaryBtn:hover {
                background: #3b82f6 !important;
            }
            .mpDivider {
                border: none;
                border-top: 1px solid rgba(148, 163, 184, 0.2);
                margin: ${D(10)} 0;
            }
            .mpFriendsHeader {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: ${D(8)};
                flex-wrap: wrap;
                min-width: 0;
                flex: 0 0 auto;
            }
            .mpFriendsHeader h3 {
                white-space: nowrap;
                flex-shrink: 0;
            }
            .mpFriendsHeader .mpFriendBtns {
                display: flex;
                gap: ${D(6)};
                flex-wrap: wrap;
                justify-content: flex-end;
            }
            .mpFriendsHeader .styledButton {
                font-size: ${D(11)} !important;
                padding: ${D(4)} ${D(8)} !important;
                height: ${D(26)} !important;
                line-height: ${D(18)} !important;
            }
            .mpFriendsList {
                flex: 1 1 auto;
                min-height: 0;
                max-height: calc(340px * var(--ui-scale, 1));
                display: flex;
                flex-direction: column;
                gap: ${D(6)};
                overflow-y: auto;
                padding-right: 2px;
            }
            .mpFriendRow {
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: rgba(30, 41, 59, 0.75);
                border: 1px solid rgba(100, 116, 139, 0.3);
                border-radius: ${D(5)};
                padding: ${D(7)} ${D(10)};
                gap: ${D(8)};
            }
            .mpFriendRow.hosting {
                border-color: #4ade80;
                background: rgba(20, 83, 45, 0.35);
            }
            .mpFriendInfo {
                display: flex;
                flex-direction: column;
                font-size: ${D(12)};
                min-width: 0;
                flex: 1 1 auto;
            }
            .mpFriendInfo strong {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .mpFriendSub {
                font-size: ${D(11)};
                color: #94a3b8;
            }
            .mpFriendRow.hosting .mpFriendSub {
                color: #4ade80;
            }
            .mpFriendBtns {
                display: flex;
                gap: ${D(6)};
                flex-shrink: 0;
            }
            .mpFriendBtns .styledButton {
                font-size: ${D(11)} !important;
                padding: ${D(4)} ${D(10)} !important;
                height: ${D(26)} !important;
                line-height: ${D(18)} !important;
            }
            .mpEmptyFriends {
                font-size: ${D(12)};
                color: #94a3b8;
                padding: ${D(12)};
                background: rgba(15, 23, 42, 0.4);
                border-radius: ${D(4)};
            }

            /* Diagnostic Logs Modal */
            .mpLogsModalBackdrop pre {
                background: #0f172a !important;
                color: #e2e8f0 !important;
                padding: ${D(12)} !important;
                border-radius: ${D(6)} !important;
                max-height: ${D(360)} !important;
                overflow: auto !important;
                font-size: ${D(11)} !important;
                line-height: 1.45 !important;
                user-select: text !important;
                -webkit-user-select: text !important;
            }
            .mpLogsActions {
                display: flex;
                gap: ${D(8)};
                justify-content: flex-end;
                margin-top: ${D(12)};
            }

            /* In-Game HUD Panel */
            #ingame_HUD_Multiplayer.mpHudPanel {
                position: absolute;
                top: ${D(70)};
                right: ${D(16)};
                width: ${D(290)};
                max-height: calc(100vh - ${D(90)});
                display: flex;
                flex-direction: column;
                background: rgba(15, 23, 42, 0.95);
                border: 1.5px solid rgba(102, 192, 244, 0.65);
                border-radius: ${D(8)};
                color: #f3f4f6;
                font-family: GameFont, sans-serif;
                z-index: 900;
                pointer-events: all !important;
            }
            #ingame_HUD_Multiplayer.mpHudPanel,
            #ingame_HUD_Multiplayer.mpHudPanel * {
                pointer-events: all !important;
                box-shadow: 0 ${D(8)} ${D(24)} rgba(0, 0, 0, 0.55);
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
                gap: ${D(8)};
                padding: ${D(7)} ${D(10)};
                background: rgba(30, 41, 59, 0.95);
                border-bottom: 1px solid rgba(102, 192, 244, 0.25);
                border-radius: ${D(6)} ${D(6)} 0 0;
                font-size: ${D(12)};
                font-weight: bold;
                cursor: grab;
                user-select: none;
                -webkit-user-select: none;
                flex: 0 0 auto;
            }
            .mpGripHandle {
                color: #64748b;
                font-size: ${D(13)};
                line-height: 1;
                margin-right: -2px;
                cursor: grab;
                user-select: none;
                -webkit-user-select: none;
                flex-shrink: 0;
            }
            .mpStatusDot {
                width: ${D(8)};
                height: ${D(8)};
                border-radius: 50%;
                background: #9ca3af;
                flex-shrink: 0;
            }
            .mpStatusDot.online {
                background: #4ade80;
                box-shadow: 0 0 ${D(6)} #4ade80;
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
                border-radius: ${D(10)};
                padding: ${D(1)} ${D(7)};
                font-size: ${D(11)};
                flex-shrink: 0;
            }
            .mpCollapseBtn {
                background: transparent;
                border: none;
                color: #cbd5e1;
                cursor: pointer;
                font-size: ${D(14)};
                font-weight: bold;
                padding: 0 ${D(4)};
                line-height: 1;
            }
            .mpCollapseBtn:hover {
                color: #ffffff;
            }
            .mpHudBody {
                padding: ${D(8)} ${D(10)};
                display: flex;
                flex-direction: column;
                gap: ${D(8)};
                overflow-y: auto;
                overflow-x: hidden;
                box-sizing: border-box;
                flex: 1 1 auto;
                min-height: 0;
            }
            .mpRoster {
                display: flex;
                flex-direction: column;
                gap: ${D(4)};
                max-height: ${D(90)};
                overflow-y: auto;
                overflow-x: hidden;
                box-sizing: border-box;
                padding-right: ${D(2)};
                flex-shrink: 0;
            }
            .mpRosterItem {
                display: flex;
                align-items: center;
                gap: ${D(8)};
                font-size: ${D(11)};
                background: rgba(30, 41, 59, 0.75);
                border: 1px solid rgba(100, 116, 139, 0.25);
                padding: ${D(4)} ${D(8)};
                border-radius: ${D(4)};
                box-sizing: border-box;
                min-height: ${D(25)};
            }
            .mpColorSwatch {
                width: ${D(9)};
                height: ${D(9)};
                border-radius: 50%;
                flex-shrink: 0;
            }
            .mpRosterName {
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: ${D(11)};
            }
            .mpRosterRole {
                font-size: ${D(9)};
                color: #93c5fd;
                background: rgba(37, 99, 235, 0.3);
                padding: ${D(1)} ${D(5)};
                border-radius: ${D(3)};
                font-weight: 600;
                letter-spacing: 0.5px;
                flex-shrink: 0;
            }
            .mpActionRow {
                display: grid !important;
                grid-template-columns: 1fr 1fr !important;
                gap: ${D(6)} !important;
                width: 100% !important;
                box-sizing: border-box !important;
                flex-shrink: 0;
            }
            .mpActionRow .styledButton {
                box-sizing: border-box !important;
                height: ${D(28)} !important;
                min-height: ${D(28)} !important;
                max-height: ${D(28)} !important;
                padding: 0 ${D(6)} !important;
                font-size: ${D(10)} !important;
                line-height: ${D(26)} !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                text-align: center !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                margin: 0 !important;
                border-radius: ${D(4)} !important;
                cursor: pointer !important;
            }
            .mpChatBox {
                display: flex;
                flex-direction: column;
                gap: ${D(6)};
                border-top: 1px solid rgba(148, 163, 184, 0.2);
                padding-top: ${D(6)};
                box-sizing: border-box;
                width: 100%;
                flex-shrink: 0;
            }
            .mpChatMessages {
                height: ${D(80)};
                max-height: ${D(110)};
                overflow-y: auto;
                overflow-x: hidden;
                font-size: ${D(11)};
                display: flex;
                flex-direction: column;
                gap: ${D(3)};
                word-break: break-word;
                background: rgba(15, 23, 42, 0.6);
                border: 1px solid rgba(51, 65, 85, 0.6);
                border-radius: ${D(4)};
                padding: ${D(5)} ${D(7)};
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
                gap: ${D(6)} !important;
                align-items: center !important;
                width: 100% !important;
                box-sizing: border-box !important;
            }
            .mpChatInput {
                flex: 1 1 auto !important;
                min-width: 0 !important;
                width: auto !important;
                height: ${D(28)} !important;
                line-height: ${D(26)} !important;
                margin: 0 !important;
                background: #0f172a !important;
                background-color: #0f172a !important;
                color: #ffffff !important;
                border: 1px solid #334155 !important;
                border-radius: ${D(4)} !important;
                padding: 0 ${D(8)} !important;
                font-size: ${D(11)} !important;
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
                height: ${D(28)} !important;
                min-height: ${D(28)} !important;
                max-height: ${D(28)} !important;
                line-height: ${D(26)} !important;
                margin: 0 !important;
                font-size: ${D(10)} !important;
                padding: 0 ${D(12)} !important;
                box-sizing: border-box !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                border-radius: ${D(4)} !important;
                cursor: pointer !important;
            }

            /* Dragging State Cursor & Interaction Guard */
            .mpDragging,
            .mpDragging * {
                cursor: grabbing !important;
                user-select: none !important;
                -webkit-user-select: none !important;
            }

            /* Dedicated Clean Scrollbars inside HUD Panel & Modals */
            .mpHudPanel ::-webkit-scrollbar,
            .mpModalCard ::-webkit-scrollbar,
            .mpModalCard::-webkit-scrollbar,
            .mpFriendsList::-webkit-scrollbar {
                width: ${D(6)} !important;
                height: ${D(6)} !important;
            }
            .mpHudPanel ::-webkit-scrollbar-track,
            .mpModalCard ::-webkit-scrollbar-track,
            .mpModalCard::-webkit-scrollbar-track,
            .mpFriendsList::-webkit-scrollbar-track {
                background: rgba(15, 23, 42, 0.4) !important;
                border-radius: ${D(3)} !important;
            }
            .mpHudPanel ::-webkit-scrollbar-thumb,
            .mpModalCard ::-webkit-scrollbar-thumb,
            .mpModalCard::-webkit-scrollbar-thumb,
            .mpFriendsList::-webkit-scrollbar-thumb {
                background: #475569 !important;
                border-radius: ${D(3)} !important;
            }
            .mpHudPanel ::-webkit-scrollbar-thumb:hover,
            .mpModalCard ::-webkit-scrollbar-thumb:hover,
            .mpModalCard::-webkit-scrollbar-thumb:hover,
            .mpFriendsList::-webkit-scrollbar-thumb:hover {
                background: #64748b !important;
            }

            /* Toast & Invite Banner */
            .mpToastNotification {
                position: fixed;
                bottom: ${D(24)};
                left: 50%;
                transform: translateX(-50%) translateY(${D(20)});
                background: rgba(15, 23, 42, 0.95);
                color: #66c0f4;
                border: 1.5px solid #66c0f4;
                border-radius: ${D(6)};
                padding: ${D(9)} ${D(18)};
                font-family: GameFont, sans-serif;
                font-size: ${D(13)};
                z-index: 100000;
                opacity: 0;
                pointer-events: none !important;
                transition: all 0.2s ease;
            }
            .mpToastNotification.visible {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
            .mpInviteBanner {
                position: fixed;
                top: ${D(20)};
                right: ${D(20)};
                background: #1b2838;
                border: 2px solid #4ade80;
                border-radius: ${D(8)};
                padding: ${D(12)} ${D(16)};
                color: #ffffff;
                z-index: 100001;
                display: flex;
                align-items: center;
                gap: ${D(14)};
                box-shadow: 0 ${D(12)} ${D(32)} rgba(0, 0, 0, 0.6);
                font-family: GameFont, sans-serif;
            }
            .mpInviteText {
                display: flex;
                flex-direction: column;
                font-size: ${D(12)};
                gap: ${D(3)};
            }
            .mpInviteBtns {
                display: flex;
                gap: ${D(6)};
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
                pointer-events: all !important;
            }
            .mpJoinOverlayBackdrop,
            .mpJoinOverlayBackdrop * {
                pointer-events: all !important;
            .mpJoinCard {
                width: min(${D(440)}, 90vw);
                background: #1b2838;
                border: 2px solid #66c0f4;
                border-radius: ${D(10)};
                padding: ${D(24)};
                box-shadow: 0 ${D(20)} ${D(50)} rgba(0, 0, 0, 0.85);
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
                gap: ${D(12)};
                color: #e5e7eb;
                box-sizing: border-box;
                cursor: grab;
                user-select: none;
                -webkit-user-select: none;
                position: relative;
            }
            .mpJoinSpinner {
                width: ${D(38)};
                height: ${D(38)};
                border: ${D(4)} solid rgba(102, 192, 244, 0.2);
                border-top-color: #66c0f4;
                border-radius: 50%;
                animation: mpSpin 0.9s linear infinite;
            }
            @keyframes mpSpin {
                to { transform: rotate(360deg); }
            }
            .mpJoinTitle {
                margin: 0;
                font-size: ${D(18)};
                color: #ffffff;
            }
            .mpJoinStatus {
                margin: 0;
                font-size: ${D(13)};
                color: #94a3b8;
                min-height: ${D(20)};
                word-break: break-word;
            }
            .mpJoinProgressContainer {
                width: 100%;
                height: ${D(8)};
                background: #0f172a;
                border: 1px solid #334155;
                border-radius: ${D(4)};
                overflow: hidden;
                margin-top: ${D(4)};
                box-sizing: border-box;
            }
            .mpJoinProgressBar {
                height: 100%;
                width: 0%;
                background: linear-gradient(90deg, #38bdf8, #4ade80);
                transition: width 0.2s ease-out;
            }
            .mpCancelJoinBtn {
                margin-top: ${D(8)} !important;
                background: #334155 !important;
                color: #cbd5e1 !important;
                font-size: ${D(12)} !important;
                padding: ${D(6)} ${D(16)} !important;
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
    D,
    MULTIPLAYER_CSS,
    injectStyles,
};
