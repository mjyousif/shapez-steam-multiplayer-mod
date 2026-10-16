# shapez.io — Steam Co-op Multiplayer Mod

[![Release](https://img.shields.io/github/v/release/mjyousif/shapez-steam-multiplayer-mod?color=brightgreen&label=Latest%20Release)](https://github.com/mjyousif/shapez-steam-multiplayer-mod/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-blue)](https://store.steampowered.com/app/1318690/shapezio/)
[![Tests](https://img.shields.io/badge/Tests-Passing-success)](scripts/verify-mod.js)

A real-time Co-op Multiplayer mod for the Steam version of **shapez.io** (`v1.5.7`), featuring native **Steamworks integration** (Steam Lobbies, Friends List, Rich Presence, Overlay Invites), dual **WebRTC P2P + TCP/LAN** networking, live remote player cursors & ghost building previews, map pings, chat, and full factory synchronization.

> ### 🚀 Quick Download for Players & Friends:
> 👉 **[Download Latest Release (ShapezCoopInstaller.exe or .zip)](https://github.com/mjyousif/shapez-steam-multiplayer-mod/releases/latest)**
> 
> *No Node.js, Git, or command line required! Just run `ShapezCoopInstaller.exe` and click "Install Mod".*

---

## Features

- **Steamworks Integration Kept Active**: Patches `app.asar` so Steam Authentication, Achievements, Puzzle DLC, Lobbies, and Friends stay active even when mods are loaded.
- **Multiple Ways to Connect**:
  - **Steam Friends & Lobbies**: Host a lobby, invite friends through the in-game Steam Friends list or native Steam Overlay (`Shift+Tab`), or click **Join Game** on a friend hosting Co-op.
  - **WebRTC P2P over Steam**: Automatically negotiates peer-to-peer WebRTC DataChannels over Steam Friends signaling when direct TCP isn't reachable.
  - **Direct TCP / LAN / VPN / Join Code**: Instant low-latency TCP sockets over LAN, VPNs (Tailscale, Radmin, ZeroTier, Hamachi), port-forwarding, or localhost (`127.0.0.1:27080`).
- **Full Co-op Factory Synchronization**:
  - **Initial World Transfer**: Automatically serializes and streams the Host's factory (in 48 KB chunks) to joining players.
  - **Real-Time Building & Wire Sync**: Syncs single placements, belt/wire drags, blueprint pastes, deletions, mass-deletes, belt clearing, constant signal edits, and lever toggles.
  - **Shared Hub & Upgrades**: Syncs Hub shape deliveries, level progression, upgrade unlocks, map waypoints, and pinned shapes.
- **Live Co-op HUD**:
  - See teammates' live cursors, Steam names, active layer (`Regular` / `[Wires]`), translucent ghost previews of the buildings they are placing, off-screen directional arrows, map pings (<kbd>P</kbd>), and in-game chat.

---

## For Friends: How to Install (5 Seconds)

Your friends **do not need Node.js, Git, or any technical knowledge**.

1. Download **`shapez-steam-coop-mod-v1.0.0.zip`** (or **`ShapezCoopInstaller.exe`**) from the [Releases Page](https://github.com/mjyousif/shapez-steam-multiplayer-mod/releases/latest).
2. Run **`ShapezCoopInstaller.exe`** (or double-click `Install-Mod.bat`).
   - It automatically detects the Steam shapez.io installation folder on any drive (`C:`, `D:`, `E:`, etc.).
3. Click the blue **"Install Mod"** button.
4. Launch **shapez** from Steam and play!

> **100% Reversible:** To uninstall, open the installer and click **"Restore Vanilla"** (or double-click `Uninstall-Mod.bat`). All original game files are restored.

---

## Quick Start & Developer Installation

### Prerequisites (For Mod Developers)
- **shapez.io** installed via Steam
- **Node.js** (`v16+`)

### Install / Update the Mod (Via Node)
From this project directory, run:

```powershell
npm run install-mod
```

**What this does:**
1. Backs up your original `app.asar` to `C:\Program Files (x86)\Steam\steamapps\common\shapez.io\resources\app.asar.vanilla.bak` (if not already backed up).
2. Updates `index.js`, `steam.js`, and `preload.js` inside `app.asar` to enable Steamworks Lobby/Friends IPC and TCP P2P networking.
3. Copies `src/steam_multiplayer.js` into `%APPDATA%\shapez.io\mods\steam_multiplayer.js`.

---

## How to Play Co-op

### 1. Hosting a Co-op Factory
1. Launch **shapez** normally from Steam.
2. On the Main Menu:
   - Click the **Steam Multiplayer** button at the top of the menu, choose **+ Create New Co-op Factory** (or pick an existing savegame) and click **Start Hosting Co-op Factory**, **OR**
   - Click the blue **Co-op** button directly on any savegame card in your save list.
3. Once in-game, you will see the **Steam Co-op** panel at the top-center of your screen:
   - Click **Invite Friends** to open the Multiplayer Hub & invite Steam Friends or open the Steam Invite Overlay.
   - Click **Copy Code** to copy your Join Code / endpoint to send to friends on Discord or Steam Chat.

### 2. Joining a Friend's Factory
1. Launch **shapez** from Steam.
2. Click **Steam Multiplayer** on the Main Menu:
   - **Via Steam Friends (Right Column)**: If your Steam friend is currently hosting, their row will highlight green (**"Hosting shapez Co-op!"**). Click **Join Game** next to their name.
   - **Via In-Game Invite Banner**: When a friend clicks **Invite** next to your name, a green toast banner will pop up in the top-right corner of your game—click **Accept & Join**.
   - **Via Join Code or IP:Port (Left Column)**: Paste the Host's Join Code or `IP:Port` (e.g. `192.168.1.50:27080` or `127.0.0.1:27080`) into **2. Join by Code or IP:Port** and click **Connect**.

---

## Solo Testing on a Single PC (Two Windows)

You can test Hosting and Joining on the same computer using two side-by-side windows:

1. Start **shapez** from Steam and host a Co-op Factory (defaults to port `27080`).
2. In this folder, open a terminal and run:
   ```powershell
   npm run launch-client
   ```
   *(This launches a second instance of `shapezio.exe` with `--multi-instance --instance-id=2 --dev` and its own isolated save/cache folder so it won't conflict with your main window.)*
3. In the second window, click **Steam Multiplayer** &rarr; click **Connect** under **Join by Code or IP:Port** (which defaults to `127.0.0.1:27080`).
4. Place buildings, toggle levers, unlock upgrades, or press <kbd>P</kbd> to ping in either window and watch them sync live!

---

## In-Game Controls & Commands

| Control / Button | Action |
| :--- | :--- |
| **Top-Center Panel (`–` / `+`)** | Collapse or expand the in-game Steam Co-op roster & chat panel |
| **Invite Friends** | Open the Steam Multiplayer modal to invite friends or switch sessions |
| **Copy Code** | Copy your session Join Code to the clipboard |
| **Ping `[P]`** (or press <kbd>P</kbd>) | Send an animated radar ping at your cursor's map coordinates |
| **Resync** *(Client only)* | Request a fresh full-world snapshot from the Host if ever needed |
| **Chat Box** (<kbd>Enter</kbd>) | Send a chat message to all connected players |

---

## NPM Scripts Reference

| Command | Description |
| :--- | :--- |
| `npm run package` | Builds the standalone `ShapezCoopInstaller.exe` and distribution ZIP for friends |
| `npm run install-mod` | Backs up `app.asar`, installs the Steam/IPC bridge, and deploys `steam_multiplayer.js` |
| `npm run uninstall-mod` | Restores `app.asar.vanilla.bak` and removes `steam_multiplayer.js` (100% vanilla restore) |
| `npm test` / `npm run verify` | Runs the automated ASAR integrity & Host-to-Client synchronization test suite |
| `npm run launch-client` | Launches a second local `shapezio.exe` window for single-PC Co-op testing |

---

## Documentation

Full architectural and feature design documentation is available in the [`docs/`](docs/README.md) directory:

- 🏗️ [**Architecture & Process Model**](docs/technical-design/architecture.md): Electron Main vs. Renderer split, ASAR binary patching, and IPC bridge.
- 🌐 [**Networking Protocol & Transports**](docs/technical-design/networking-protocol.md): Dual-transport TCP sockets & WebRTC DataChannels, framing format, and chunked transfers.
- ⚡ [**Synchronization Engine**](docs/technical-design/synchronization-engine.md): GameLogic interception, delta action replay, and loop recursion guards.
- 👥 [**Steamworks Integration**](docs/features/steam-integration.md): Steam Lobbies, Friends presence, Overlay invites, and Rich Presence.
- 🖥️ [**Co-op HUD & Social Features**](docs/features/coop-hud-and-social.md): Live cursor streaming, ghost building placement previews, off-screen arrows, radar pings, and chat.
- 🧪 [**Testing & Troubleshooting**](docs/features/testing-and-troubleshooting.md): Multi-instance single-PC testing, automated verification suite, and common fixes.

---

## Project Structure

```text
├── package.json
├── README.md
├── docs/                       # Technical design and feature documentation
│   ├── README.md               # Documentation hub and index
│   ├── technical-design/       # Architecture, networking protocol, and sync engine
│   └── features/               # Steamworks, Co-op HUD, testing, and troubleshooting
├── scripts/
│   ├── install-mod.js          # Automated backup, ASAR patcher, and mod installer
│   ├── uninstall-mod.js        # Restores vanilla app.asar and removes mod
│   ├── verify-mod.js           # Automated verification & Host<->Client test suite
│   ├── build-dist.js           # Packages distribution release and installer
│   └── launch-coop-client.js   # Spawns a second local game instance (--multi-instance)
└── src/
    ├── steam_multiplayer.js    # The shapez.io Co-op Multiplayer mod (Renderer)
    ├── asar-patches/           # Patched Electron main-process files injected into app.asar
    │   ├── index.js            # Enables Steam with mods & adds --multi-instance support
    │   ├── steam.js            # Greenworks Lobby/Friends/RichPresence IPC + TCP framing server
    │   └── preload.js          # Renderer IPC bridge with listener cleanup
    ├── installer/              # Standalone C# Windows installer GUI
    └── vanilla/                # Reference copies of the unmodified vanilla files
```

