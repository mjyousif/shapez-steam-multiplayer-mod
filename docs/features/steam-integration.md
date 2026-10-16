# Feature Guide: Steamworks Integration

## 1. Overview

The mod integrates directly with Valve's **Steamworks SDK** via **Greenworks**, providing native Steam multiplayer features without requiring external accounts, servers, or registration.

All Steam operations are bridged through the Electron Main Process (`src/steam_bridge.js`) and rendered dynamically inside the game menu and in-game HUD (`src/steam_multiplayer.js`).

---

## 2. Key Steam Features

### 2.1 Steam Lobbies & Matchmaking
* **Lobby Creation**: When a player starts hosting a Co-op factory, the mod creates an official Steam Matchmaking Lobby:
  ```javascript
  ipcRenderer.invoke("steam:mp:create-lobby", {
      lobbyType: "friends-only",
      maxMembers: 8,
      joinCode: sessionCode,
  });
  ```
* **Lobby Metadata**: The lobby stores metadata keys including `status: "hosting"`, `version: "1.5.7"`, and `endpoint`, allowing friends to detect active sessions automatically.
* **Auto-Discovery**: Connected players leave the lobby cleanly upon exiting or disconnecting.

### 2.2 Live Steam Friends Detection
In the **Steam Multiplayer** menu, the right-hand column dynamically lists your online Steam Friends:
* **Active Host Detection**: If a Steam friend is hosting a Co-op factory, their entry is highlighted in **emerald green** with a prominent **Join Game** button.
* **One-Click Joining**: Clicking **Join Game** automatically extracts their lobby ID and negotiates a WebRTC or TCP connection without needing to type IP addresses.

### 2.3 Invitations & Native Steam Overlay
* **Native Steam Overlay (`Shift+Tab`)**:
  * Clicking **Invite Friends** opens the official Steam Overlay Friends Invite dialog (`greenworks.activateGameOverlayInviteDialog`).
* **Direct In-Game Invites**:
  * Clicking the **Invite** button next to a friend's name in the Friends list sends a dual notification:
    1. An in-game green toast notification to their running game window.
    2. A Steam Chat message with the session's clickable Join Code.
* **In-Game Invite Toasts**:
  * When a friend invites you, an animated green banner appears in the top-right corner of your screen showing the friend's name and an **Accept & Join** button.

### 2.4 Rich Presence
The mod updates your Steam profile's Rich Presence status in real-time:
* When hosting: `Hosting Co-op (Level 12 • 3 Players)`
* When playing: `Playing Co-op with [HostName]`
* Friends viewing your profile in the Steam Friends window see your status and can click **Join Game** directly from Steam.

---

## 3. Fallback Mode (Offline & LAN)

If shapez.io is launched in an environment where the Steam Client is not running, offline, or launched in developer mode without Steam initialized:
1. The mod detects that `greenworks.init()` returned false.
2. It automatically creates a virtual local profile:
   ```javascript
   fallbackProfile = {
       steamId: "local_" + process.pid + "_" + suffix,
       name: (os.userInfo().username || "Player") + "#" + suffix,
       accountId: suffix,
       level: 1,
       isSteam: false,
   };
   ```
3. Players can still host and join via direct IP addresses, LAN, or VPNs without any crashes or degraded functionality.
