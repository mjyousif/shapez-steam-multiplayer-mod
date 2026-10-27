# shapez.io Co-op Multiplayer Mod — Documentation Hub

Welcome to the technical design and feature documentation for the **shapez.io Steam Co-op Multiplayer Mod**. This documentation is organized into technical design specifications, user-facing feature guides, and contributor/agent guidelines.

---

## 📚 Documentation Index

### ⚙️ Technical Design Documents
Deep-dives into the mod's architecture, underlying protocols, and game engine hooks:

* [**Architecture & Process Model**](technical-design/architecture.md)
  * Electron dual-process architecture (Main vs. Renderer).
  * Safe ASAR binary archive patching and integrity preservation.
  * Electron IPC communication bridge (`preload.js`).
  * Native C++ modules: Greenworks and Native Steam P2P Addon (`steam_p2p_win64.node`).

* [**Networking Protocol & Transports**](technical-design/networking-protocol.md)
  * Dual-transport layer: Direct TCP Sockets and Native Steamworks P2P (`ISteamNetworking`).
  * Length-prefixed framing protocol (4-byte Big-Endian).
  * Steam Lobby Data signaling with zero Steam chat spam.
  * Chunked initial world transfer (`WELCOME_WORLD` in 48 KB slices).
  * Comprehensive network packet schema reference.

* [**Synchronization Engine**](technical-design/synchronization-engine.md)
  * `shapez.ModInterface` method interception.
  * Delta action catalog (`ACT_PLACE`, `ACT_DELETE`, `ACT_SIGNAL`, `ACT_BLUEPRINT`, etc.).
  * Recursion & echo-loop prevention (`isApplyingRemote`).
  * Host-authoritative hub goals, optimistic upgrade prediction, and geometric multiplier recalculation.
  * Background FNV-1a world checksums and targeted spatial region self-healing.
  * Client savegame isolation and seamless in-game resync reload protocol.

---

### 🎮 Feature & Operational Guides
Guides detailing in-game features, Steamworks integration, and development tools:

* [**Steamworks Integration**](features/steam-integration.md)
  * Steam Lobby lifecycle (Create, Join, Leave, Member data).
  * Steam Friends list detection and live status polling.
  * Native Steam Overlay invites (`Shift+Tab`) and custom toast notifications.
  * Rich Presence integration.
  * Fallback mode for non-Steam or offline environments.

* [**Co-op HUD & Social Features**](features/coop-hud-and-social.md)
  * Draggable in-game Multiplayer HUD panel and player roster.
  * Live cursor streaming, interpolation, and multi-instance ID disambiguation.
  * Real-time ghost building placement previews.
  * Off-screen player tracking arrows.
  * Animated radar map pings (<kbd>P</kbd>).
  * In-game team chat with smooth auto-scrolling.

* [**Testing, Tooling & Troubleshooting**](features/testing-and-troubleshooting.md)
  * Single-PC dual-window testing (`npm run launch-client`).
  * Multi-tiered automated test suite (`npm test`: syntax check, 10 unit test suites, E2E simulation).
  * Standalone installer CLI switches (`--backup`, `--silent`, `--uninstall`, etc.).
  * Automated savegame backup utilities (`npm run backup-saves`).
  * Common troubleshooting scenarios (firewalls, port conflicts, safe mode).

---

### 🤖 Contributor & Agent Guidelines
* [**Agent & Contributor Guidelines (`AGENTS.md`)](../AGENTS.md): Coding conventions, documentation freshness rules, test execution, and architecture boundaries for human and AI contributors.

---

## 🧭 Repository Structure At A Glance

```text
shapez-steam-multiplayer-mod/
├── AGENTS.md                   # Instructions and standards for AI coding agents & contributors
├── docs/                       # Permanent documentation hub
│   ├── README.md               # Documentation table of contents (this file)
│   ├── technical-design/       # Architecture, networking, and sync engine design docs
│   └── features/               # Steamworks, HUD, social, and testing guides
├── scripts/
│   ├── backup-saves.js         # Timestamped .zip save game backup tool
│   ├── build-bundle.js         # Zero-dependency module bundler and linker
│   ├── build-dist.js           # Production release packager and installer compiler
│   ├── build-native-p2p.js     # Standalone PE64 assembler for steam_p2p_win64.node
│   ├── check-syntax.js         # AST syntax validator across all JS files
│   ├── get-next-version.js     # Semantic version calculator for releases
│   ├── install-mod.js          # ASAR binary patcher and mod installer
│   ├── launch-coop-client.js   # Isolated secondary instance launcher
│   ├── uninstall-mod.js        # Vanilla restoration tool
│   └── verify-mod.js           # Automated end-to-end verification test suite
├── src/
│   ├── bridge/                 # Main Process modular units (Node.js runtime)
│   │   ├── index.js            # Central bridge orchestrator
│   │   ├── ipc_handlers.js     # Electron ipcMain.handle endpoints
│   │   ├── lobby_channel.js    # Deflated zlib Steam Lobby metadata channel
│   │   ├── logger.js           # Rotating disk log and in-memory ring buffer
│   │   ├── native_p2p.js       # ISteamNetworking C++ addon loader
│   │   ├── steam_client.js     # Greenworks initialization & Steam client
│   │   └── tcp_transport.js    # 4-byte BE TCP framing and auto-increment server
│   ├── multiplayer/            # Renderer Process modular units (Chromium sandbox)
│   │   ├── constants.js        # Metadata and player color palettes
│   │   ├── index.js            # Barrel module exporter
│   │   ├── join_code.js        # Base64 Join Code parser & HTML sanitizer
│   │   ├── mod.js              # Central Mod class and lifecycle coordinator
│   │   ├── hud/                # HUD components
│   │   │   └── hud_multiplayer.js # Draggable in-game multiplayer HUD
│   │   ├── sync/               # Synchronization engine
│   │   │   ├── actions.js      # Remote action dispatcher with reentrancy guards
│   │   │   ├── cursors.js      # Interpolated cursors, ghosts, radar pings
│   │   │   ├── game_hooks.js   # GameLogic & HUD method interceptors
│   │   │   ├── hub_sync.js     # Authoritative hub progression & prediction
│   │   │   ├── world_check.js  # Spatial region checksums & targeted auto-repair
│   │   │   └── world_dump.js   # 48 KB sliced world serialization & savegame loader
│   │   └── ui/                 # User interface elements
│   │       ├── dialogs.js      # Modals, friends list, overlays & toasts
│   │       └── styles.js       # Responsive CSS stylesheet injector
│   └── installer/              # C# WinForms standalone installer source (Program.cs)
├── bin/
│   └── steam_p2p_win64.node    # Native Windows x64 ISteamNetworking addon (generated)
├── dist/                       # Build distribution artifacts (generated)
│   ├── steam_bridge.js         # Compiled Electron Main Process distribution bundle
│   ├── steam_multiplayer.js    # Compiled Chromium Renderer Process distribution bundle
│   └── ShapezCoopInstaller.exe # Standalone Windows installer executable
├── tests/                      # Native Node.js unit test suite (node --test)
│   ├── asar-patcher.test.js    # ASAR pickle header and in-place patching tests
│   ├── dist-package.test.js    # Release packaging and distribution tests
│   ├── framing.test.js         # 4-byte BE framing and stream reassembly tests
│   ├── hub-sync.test.js        # Authoritative hub progression & prediction reconciliation
│   ├── installer-cli.test.js   # Installer binary CLI smoke tests
│   ├── join-code.test.js       # Join code encoding/decoding and sanitizer tests
│   ├── network-resilience.test.js # Buffer resilience, chunking, and port failover tests
│   ├── savegame-isolation.test.js # Savegame isolation and dedicated coop slot tests
│   ├── version-check.test.js   # Semver invariants and repository version synchronization
│   └── world-check.test.js     # Spatial region FNV-1a checksums & self-healing repair
└── package.json
```
