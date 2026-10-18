# Technical Design: Architecture & Process Model

## 1. Overview

**shapez.io** is packaged as an Electron desktop application combining a Chromium web runtime with a Node.js desktop environment. In the vanilla release of shapez.io, the game engine operates exclusively in a single-player sandbox, and modding capabilities are separated from Steam networking.

The Co-op Multiplayer Mod implements a hybrid architecture that splits responsibilities across the **Electron Main Process**, the **Electron Preload Context Bridge**, and the **Chromium Renderer Context**.

```mermaid
flowchart TB
    subgraph HostSystem["Host Operating System / Steam Runtime"]
        SteamClient["Steam Client & API (Steamworks SDK / steam_api64.dll)"]
        OSNetwork["OS Network Stack (TCP Sockets :27080)"]
    end

    subgraph ElectronMain["Electron Main Process (Node.js Environment)"]
        IndexJS["index.js (Lifecycle, Mod Loader, Window Manager)"]
        SteamJS["steam.js / steam_bridge.js (IPC Bridge, TCP Framing Server)"]
        Greenworks["Greenworks C++ Addon (.node)"]
        SteamP2P["Native Steam P2P Addon (steam_p2p_win64.node)"]

        IndexJS <--> SteamJS
        SteamJS <--> Greenworks
        SteamJS <--> SteamP2P
    end

    subgraph Preload["Preload Context Bridge"]
        PreloadJS["preload.js (contextBridge: window.ipcRenderer)"]
    end

    subgraph RendererProcess["Renderer Process (Chromium Web Environment)"]
        GameEngine["shapez.io Game Engine (bundle.js)"]
        MultiplayerMod["steam_multiplayer.js (Mod, Draggable HUD, Sync Engine)"]

        MultiplayerMod <--> GameEngine
    end

    Greenworks <--> |Native C++ Calls| SteamClient
    SteamP2P <--> |ISteamNetworking Calls| SteamClient
    SteamJS <--> |Node net.Socket| OSNetwork

    SteamJS <--> |ipcMain.handle / webContents.send| PreloadJS
    PreloadJS <--> |window.ipcRenderer| MultiplayerMod
```

---

## 2. Process Responsibilities

### 2.1 Electron Main Process (`src/steam_bridge.js` & patched `index.js`)
* **Environment**: Full Node.js runtime with access to native OS libraries, the filesystem, and C++ native Node addons (`.node`).
* **Responsibilities**:
  * **Steamworks Matchmaking & Profile Bridge**: Initializes and interfaces with Greenworks (`shapez.io-private-artifacts/steam/greenworks`). Exposes Steam Lobby management, Steam Friends presence, Steam Overlay triggers, and Rich Presence to the renderer via Electron IPC.
  * **Native Steamworks P2P Engine**: Loads `steam_p2p_win64.node` to bind directly to Valve's `ISteamNetworking` subsystem. Manages Channel 0 (reliable actions/state) and Channel 1 (unreliable high-frequency cursors) with a 15ms drain poll.
  * **TCP Socket Framing Server**: Hosts a `net.Server` socket on port `27080` (with dynamic port auto-increment on conflicts) to allow low-latency direct connections over LAN, VPNs (Tailscale, Hamachi, ZeroTier), or localhost.
  * **Multi-Instance Isolation**: Inspects command-line switches (`--multi-instance`, `--instance-id`) and relocates Electron's `userData` and save game directories so multiple game clients can run concurrently on one machine without database collisions.
  * **Steam Lifecycle Unlocking**: Overrides the vanilla restriction where `steam.listen()` was skipped if any mod was loaded.

### 2.2 Preload Context Bridge (Dynamically Patched `preload.js`)
* **Environment**: Isolated context executing before web scripts load.
* **Responsibilities**:
  * Exposes a secure, limited subset of `ipcRenderer` to `window.ipcRenderer` using Electron's `contextBridge.exposeInMainWorld`.
  * Provides an event listener unsubscription pattern:
    ```javascript
    contextBridge.exposeInMainWorld("ipcRenderer", {
        invoke: ipcRenderer.invoke.bind(ipcRenderer),
        on: (channel, listener) => {
            const wrapped = (event, ...args) => listener(event, ...args);
            ipcRenderer.on(channel, wrapped);
            return () => ipcRenderer.removeListener(channel, wrapped);
        },
        send: ipcRenderer.send.bind(ipcRenderer),
    });
    ```
  * Prevents listener memory leaks when reloading states.

### 2.3 Renderer Process (`src/steam_multiplayer.js`)
* **Environment**: Chromium Web Engine (`shapez.GameRoot`, Canvas UI).
* **Responsibilities**:
  * Extends `shapez.Mod` and injects `HUDMultiplayer extends shapez.BaseHUDPart` (draggable roster, action buttons, smooth scrolling, team chat).
  * Intercepts game mutations via `shapez.ModInterface` (`tryPlaceBuilding`, `tryDeleteBuilding`, `clearBelts`, `tryUnlockUpgrade`, etc.).
  * Dispatches and receives network packets through the IPC bridge (`window.ipcRenderer`).
  * Performs delta action dispatch, chunked initial world transfer reassembly, remote cursor interpolation, ghost building preview overlays, and off-screen directional arrows.

---

## 3. The ASAR Patching Mechanism

Electron bundles application code into an `app.asar` archive located at:
```text
<GameDir>/resources/app.asar
```

### 3.1 Why Binary ASAR Patching is Used
Unpacking the entire `app.asar` archive, modifying files, and repacking with standard tools has critical risks:
1. **Unpacked Native Binaries**: Shapez ships with pre-compiled 64-bit native Steam binaries in `app.asar.unpacked/`. Naive ASAR repacking invalidates the `unpacked: true` metadata flags, preventing Greenworks from loading `greenworks-win64.node`.
2. **Installation Speed**: The entire ASAR is ~60MB+. Rewriting the whole archive takes several seconds, while binary header patching executes in under 50 milliseconds.
3. **Safety & Rollback**: Backing up `app.asar` to `app.asar.vanilla.bak` guarantees 100% reversible, clean uninstallation.

### 3.2 The ASAR Binary Structure
An ASAR archive is an endian-specific Chromium Pickle container with the following header:
```text
+-------------------------+------------------------------------------------+
| Byte Offset             | Purpose                                        |
+-------------------------+------------------------------------------------+
| 0 - 3 (UInt32LE)        | Outer pickle payload size (always 4)           |
| 4 - 7 (UInt32LE)        | Total header byte size (inner pickle + 4)      |
| 8 - 11 (UInt32LE)       | Inner pickle payload size                      |
| 12 - 15 (UInt32LE)      | JSON header string byte length                 |
| 16 - (16 + JSON Length) | UTF-8 encoded JSON file directory tree         |
| Payload Offset          | Concatenated raw file payloads                 |
+-------------------------+------------------------------------------------+
```

### 3.3 Patching Strategy (`scripts/install-mod.js`)
Rather than unpacking files, the installer:
1. Reads the original ASAR buffer and parses the JSON directory table.
2. Appends the updated buffers (`index.js`, `steam.js`, `preload.js`) to the end of the existing payload.
3. Updates the JSON dictionary offsets for each patched file to point to the new positions:
   ```javascript
   headerObj.files[fileName] = {
       size: fileBuffer.length,
       offset: String(currentEndOffset),
       integrity: computeIntegrity(fileBuffer),
   };
   ```
4. Recalculates 4-byte Pickle alignment padding and writes the updated header prefix followed by the original payload and appended patches.
5. Deploys the native P2P module `src/steam_p2p_win64.node` (generated on demand by `scripts/build-native-p2p.js`) into `<GameDir>/resources/app.asar.unpacked/` so that Electron Main can load `ISteamNetworking` bindings directly.
6. All untouched files (including `bundle.js` and `shapez.io-private-artifacts`) retain their original relative offsets and native unpack pointers.

---

## 4. Steamworks Unlocking & Lifecycle

### 4.1 The Vanilla Mod Restriction
In vanilla `index.js`, the game intentionally disabled Steam whenever mods were detected:
```javascript
// Vanilla index.js (Lines 386-389)
steam.init(isDev);
if (mods.length === 0) {
    steam.listen(); // <-- Never executed when any mod is in %APPDATA%/shapez.io/mods
}
```
As a result, loading any mod caused:
* `ipcMain.handle("steam:*")` handlers were never registered.
* Steam Achievements and DLC verification were disabled.
* In-game Steam overlay invite hooks were ignored.

### 4.2 The Patched Lifecycle
In the dynamically patched `index.js`, `steam.listen()` is called unconditionally:
```javascript
steam.init(isDev, allowMultiInstance);
steam.listen(); // <-- Always executed, keeping Steam active
```

Additionally, `steam.js` detects whether Greenworks successfully initialized:
* **Steam Available**: Initializes Greenworks, binds `steam_p2p_win64.node`, registers Steam lobby listeners, and monitors overlay events.
* **Steam Unavailable (Offline / Dev Fallback)**: Automatically falls back to local virtual profiles (`local_<PID>_<suffix>`), allowing multiplayer testing over direct TCP even when running offline or without the Steam client active.

---

## 5. Modular Source Architecture & Bundling Pipeline

### 5.1 Architecture Motivation
In previous versions, `src/steam_bridge.js` (~1.8k lines) and `src/steam_multiplayer.js` (~3.5k lines) were monolithic files containing all networking, UI, hooks, synchronization, and logging logic in single massive scripts.

To improve maintainability, comprehensibility, and testability while strictly adhering to shapez.io's distribution constraints, the codebase is structured into modular source units aggregated via a zero-dependency linker (`scripts/build-bundle.js`).

```mermaid
flowchart TD
    subgraph ModularBridge["Main Process Modules (src/bridge/)"]
        B1["logger.js (File + Ring Buffer Log)"]
        B2["native_p2p.js (Steam P2P C++ Addon Loader)"]
        B3["lobby_channel.js (Zlib Metadata Channel)"]
        B4["tcp_transport.js (4-byte BE TCP Framing & Server)"]
        B5["steam_client.js (Greenworks & Steam Client)"]
        B6["ipc_handlers.js (Electron ipcMain Handlers)"]
        B7["index.js (Central Orchestrator)"]

        B1 & B2 & B3 & B4 & B5 & B6 --> B7
    end

    subgraph ModularMod["Renderer Modules (src/multiplayer/)"]
        M1["constants.js (Metadata & Colors)"]
        M2["join_code.js (Base64 Join Codes & HTML Sanitizer)"]
        M3["hud/hud_multiplayer.js (Draggable HUD & Chat UI)"]
        M4["sync/world_dump.js (48 KB Sliced World Serialization)"]
        M5["sync/actions.js (Remote Action Dispatch & Guards)"]
        M6["sync/hub_sync.js (Hub Goals & Upgrades Sync)"]
        M7["sync/cursors.js (Interpolation, Ghosts, Radar Pings)"]
        M8["sync/game_hooks.js (GameLogic & HUD Hooks)"]
        M9["ui/styles.js (CSS Injection)"]
        M10["ui/dialogs.js (Menu Buttons, Modals & Toasts)"]
        M11["mod.js (Central Mod Controller)"]
        M12["index.js (Barrel Exporter)"]

        M1 & M2 & M3 & M4 & M5 & M6 & M7 & M8 & M9 & M10 --> M11 --> M12
    end

    subgraph Bundler["Bundler (scripts/build-bundle.js)"]
        BB["Micro-Closure Module Linker & AST Syntax Verifier"]
    end

    subgraph Distribution["Distribution Bundles (src/)"]
        DistBridge["src/steam_bridge.js (Main Process Bundle)"]
        DistMod["src/steam_multiplayer.js (Renderer Mod Bundle)"]
    end

    ModularBridge --> BB --> DistBridge
    ModularMod --> BB --> DistMod
```

### 5.2 Main Process Modular Units (`src/bridge/`)
* **`logger.js`**: Thread-safe rotating disk logging (`coop-multiplayer.log`) with automatic size limits (2 MB) and an in-memory 200-entry ring buffer queryable via IPC.
* **`native_p2p.js`**: Loads `steam_p2p_win64.node`, provides 64-bit Steam ID byte buffer pack/unpack conversions, and manages Channel 0 (reliable) and Channel 1 (unreliable) message streaming.
* **`lobby_channel.js`**: Implements the compressed zlib (`Z:`) sliding-window Steam Lobby metadata signaling channel for session discovery and fallback communications without friends chat spam.
* **`tcp_transport.js`**: Handles 4-byte Big-Endian length header framing with 64 MB guard protections, auto-incrementing port server (`EADDRINUSE` handling), and UPnP IGD automatic port forwarding.
* **`steam_client.js`**: Initializes Greenworks, retrieves Steam persona details, manages Steam Lobby creation and joining, and handles native Steam events.
* **`ipc_handlers.js`**: Registers and handles all Electron `ipcMain.handle` endpoints (`steam:*`, `steam:mp:*`, `mp:net:*`).
* **`index.js`**: Orchestrates all bridge subsystems into a cohesive singleton.

### 5.3 Renderer Process Modular Units (`src/multiplayer/`)
* **`constants.js`**: Version constants, metadata descriptors, and player color palettes.
* **`join_code.js`**: Join Code base64 encoder and decoder, endpoint parsers, and HTML entity XSS sanitization.
* **`hud/hud_multiplayer.js`**: The `HUDMultiplayer` class implementing the draggable in-game roster, player status badges, quick actions, and real-time chat log.
* **`sync/world_dump.js`**: Serializes full game state, manages 48 KB chunk transfers (`WELCOME_WORLD`), and handles isolated savegame allocation.
* **`sync/actions.js`**: Remote action dispatcher (`applyRemoteAction`) with reentrancy guards (`isApplyingRemote`).
* **`sync/hub_sync.js`**: Synchronizes hub level completions, pinned shapes, and tech tree upgrades.
* **`sync/cursors.js`**: Low-latency remote cursor interpolation, ghost building previews, radar pings (<kbd>P</kbd>), and screen-edge directional indicators.
* **`sync/game_hooks.js`**: Hooks `shapez.GameLogic` methods (`tryPlaceBuilding`, `tryDeleteBuilding`, etc.) with `isInsidePlaceBuilding` recursion protection.
* **`ui/styles.js`**: Defines and dynamically injects the mod's complete responsive CSS stylesheet into the DOM.
* **`ui/dialogs.js`**: Builds the Main Menu multiplayer button, connection modals, friends list, join progress overlay, and toast notifications.
* **`mod.js`**: Core `Mod` class coordinating the initialization lifecycle and linking all submodules.
* **`index.js`**: Barrel exporter exposing the public API.

### 5.4 Distribution Bundler (`scripts/build-bundle.js`)
* **Why Bundling is Required**: shapez.io's mod loader (`%APPDATA%\shapez.io\mods\steam_multiplayer.js`), the ASAR patcher (`install-mod.js`), and the C# installer (`ShapezCoopInstaller.exe`) require self-contained single-file payloads without multi-file runtime loading overhead.
* **Zero External Dependencies**: The bundler uses Node.js standard modules (`fs`, `path`, `vm`) to encapsulate each module in a clean micro-closure scope, preventing variable leaks while preserving full JSDoc comments and type signatures.
* **Automated Sync**: The bundler runs automatically as part of `npm run build`, `npm run check:syntax`, `npm test`, and `npm run package`, ensuring the distribution files always reflect source changes.

