# shapez.io Co-op Multiplayer Mod — Documentation Hub

Welcome to the technical design and feature documentation for the **shapez.io Steam Co-op Multiplayer Mod**. This documentation is organized into technical design specifications and user-facing feature guides.

---

## 📚 Documentation Index

### ⚙️ Technical Design Documents
Deep-dives into the mod's architecture, underlying protocols, and game engine hooks:

* [**Architecture & Process Model**](technical-design/architecture.md)
  * Electron dual-process architecture (Main vs. Renderer).
  * Safe ASAR binary archive patching and integrity preservation.
  * Electron IPC communication bridge (`preload.js`).
  * Unpacked native Greenworks binary handling.

* [**Networking Protocol & Transports**](technical-design/networking-protocol.md)
  * Dual-transport layer: Direct TCP Sockets and WebRTC Peer-to-Peer.
  * Length-prefixed framing protocol (4-byte Big-Endian).
  * Out-of-band Steam Chat signaling (`[SHAPEZ_MP]:...`).
  * Chunked initial world transfer (`WELCOME_WORLD` in 48 KB slices).
  * Network packet schema reference.

* [**Synchronization Engine**](technical-design/synchronization-engine.md)
  * `shapez.ModInterface` method interception.
  * Delta action catalog (`ACT_PLACE`, `ACT_DELETE`, `ACT_SIGNAL`, etc.).
  * Recursion & echo-loop prevention (`isApplyingRemote`).
  * Hub goals, upgrades, waypoints, and pinned shape synchronization.
  * Client resync protocol.

---

### 🎮 Feature & Operational Guides
Guides detailing in-game features, Steamworks integration, and development tools:

* [**Steamworks Integration**](features/steam-integration.md)
  * Steam Lobby lifecycle (Create, Join, Leave, Member data).
  * Steam Friends list detection and live status polling.
  * Steam Overlay invites (`Shift+Tab`) and custom toast notifications.
  * Rich Presence integration.
  * Fallback mode for non-Steam or offline environments.

* [**Co-op HUD & Social Features**](features/coop-hud-and-social.md)
  * In-game Multiplayer HUD panel and player roster.
  * Live cursor streaming and interpolation.
  * Real-time ghost building placement previews.
  * Off-screen player tracking arrows.
  * Animated radar map pings (<kbd>P</kbd>).
  * In-game team chat.

* [**Multi-Instance Testing & Troubleshooting**](features/testing-and-troubleshooting.md)
  * Single-PC dual-window testing (`npm run launch-client`).
  * Command-line switches: `--multi-instance`, `--instance-id`, `--dev`.
  * Automated test suite (`verify-mod.js`).
  * Common troubleshooting scenarios (firewalls, port conflicts, Steam overlay).

---

## 🧭 Repository Structure At A Glance

```text
shapez-steam-multiplayer-mod/
├── docs/                       # Permanent documentation hub
│   ├── README.md               # Documentation table of contents (this file)
│   ├── technical-design/       # Architecture, networking, and sync engine design docs
│   └── features/               # Steamworks, HUD, social, and testing guides
├── scripts/
│   ├── install-mod.js          # ASAR binary patcher and mod installer
│   ├── uninstall-mod.js        # Vanilla restoration tool
│   ├── verify-mod.js           # Automated end-to-end verification test suite
│   ├── build-dist.js           # Production release packager
│   └── launch-coop-client.js   # Isolated secondary instance launcher
├── src/
│   ├── steam_multiplayer.js    # In-game client mod (Renderer process)
│   ├── steam_bridge.js         # Electron Main-process Steam & TCP IPC bridge
│   └── installer/              # C# WinForms standalone installer source (Program.cs)
└── package.json
```
