# Agent & Contributor Guidelines (`AGENTS.md`)

Welcome to the **shapez.io Steam Co-op Multiplayer Mod** codebase. This document outlines architectural invariants, testing protocols, and documentation freshness rules for AI coding agents (such as Antigravity, Cursor, Claude, and Copilot) and human contributors.

---

## 1. Cardinal Rule: Keep Documentation Fresh

Whenever you modify any subsystem in this repository, you **MUST** audit and update the corresponding documentation:

* **Networking Changes** &rarr; Update [`docs/technical-design/networking-protocol.md`](docs/technical-design/networking-protocol.md) and [`README.md`](README.md).
* **Process / IPC / Addon Changes** &rarr; Update [`docs/technical-design/architecture.md`](docs/technical-design/architecture.md).
* **GameLogic Hooks / Action Types** &rarr; Update [`docs/technical-design/synchronization-engine.md`](docs/technical-design/synchronization-engine.md).
* **Steamworks Features** &rarr; Update [`docs/features/steam-integration.md`](docs/features/steam-integration.md).
* **HUD, Social & UI Controls** &rarr; Update [`docs/features/coop-hud-and-social.md`](docs/features/coop-hud-and-social.md).
* **Scripts, Testing & Installer CLI** &rarr; Update [`docs/features/testing-and-troubleshooting.md`](docs/features/testing-and-troubleshooting.md), [`docs/README.md`](docs/README.md), and [`README.md`](README.md).

> [!IMPORTANT]
> **No Phantom Technologies**: Never allow documentation to describe removed, legacy, or speculative architectures (e.g. WebRTC or friend chat relays). The documentation must accurately reflect the executable reality in `src/`.

---

## 2. Architectural Boundaries & Invariants

### 2.1 Process Separation (Renderer vs. Main)
* **Renderer Process (`src/multiplayer/`, compiled to `dist/steam_multiplayer.js`)**: Runs in Chromium sandbox.
  * Intercepts `shapez.GameLogic` methods via `shapez.ModInterface`.
  * Manages UI elements (`HUDMultiplayer`), cursors, and ghost building previews.
  * **Rule**: Never require Node.js core modules (`net`, `fs`, `child_process`) directly inside the Renderer. All network I/O and Steam operations must route through `window.ipcRenderer`.
* **Main Process (`src/bridge/`, compiled to `dist/steam_bridge.js`)**: Runs in Node.js runtime.
  * Owns the TCP framing server (`net.Server`) and client sockets (`net.Socket`).
  * Loads native C++ addons (`greenworks-win64.node` and `steam_p2p_win64.node`).
  * Manages Steam lobby state, metadata windowing, and IPC dispatch to Renderer.

### 2.2 Networking Invariants
* **Primary Transport**: Native Steamworks P2P (`ISteamNetworking`) via `bin/steam_p2p_win64.node`.
  * Channel 0: Reliable ordered (`k_EP2PSendReliable = 2`) for world dumps, gameplay actions, and hub sync.
  * Channel 1: Unreliable low-latency (`k_EP2PSendUnreliable = 0`) for rapid cursor streaming.
* **Secondary Transport**: Length-prefixed TCP sockets with 4-byte Big-Endian length headers.
* **Zero Steam Chat Spam**: Never use `greenworks.sendFriendMessage` or user chat channels for signaling. Session discovery must use Steam Lobbies (`setLobbyData` / `requestLobbyData`) and Steam Rich Presence.

### 2.3 Save Game Isolation Guarantee
* **Never Overwrite Singleplayer Saves**: When a client joins a co-op session or requests a resync, never overwrite `currentRoot.savegame`.
* Always allocate and isolate co-op states via `this.activeCoopSavegame` using `app.savegameMgr.createNewSavegame()`.

### 2.4 Reentrancy & Echo Prevention
* All remote action applications in `applyRemoteAction()` must be enclosed in `isApplyingRemote = true` try-finally blocks to avoid infinite broadcast loops.
* `isInsidePlaceBuilding` must guard against spurious building deletions when placing a building on top of an existing one.

---

## 3. Mandatory Verification Workflow

Before completing any task, opening a PR, or handing work back to the user, you **MUST** run the full test suite:

```powershell
npm test
```

The automated pipeline executes three distinct stages:
1. **`npm run check:syntax` (`scripts/check-syntax.js`)**:
   * Validates static AST syntax on all JavaScript files using Node's `vm.Script`.
2. **`npm run test:unit` (`node --test`)**:
   * Executes 40+ unit tests across 8 test suites under `tests/`:
     * `asar-patcher.test.js`: Pickle headers, binary offsets, unpacked native flags.
     * `framing.test.js`: 4-byte BE TCP framing and packet fragmentation.
     * `join-code.test.js`: Base64 Join Code parsing, fallback formats, HTML escaping.
     * `network-resilience.test.js`: Malformed frames, buffer resilience, port auto-increment.
     * `savegame-isolation.test.js`: Verifies client savegame safety.
     * `installer-cli.test.js`: Smoke tests CLI flags (`--help`, `--version`, `--backup`, `--check-update`).
     * `dist-package.test.js`: Distribution package structure.
     * `version-check.test.js`: Version comparison invariants, semver normalization, and file synchronization.
3. **`npm run test:e2e` (`scripts/verify-mod.js`)**:
   * End-to-end simulated Host <-> Client handshake, chunked 48 KB world dump transfer, delta action synchronization, and native Steam P2P addon validation.

---

## 4. Building Native Addons & Installer

* **Native P2P Addon (`bin/steam_p2p_win64.node`)**:
  * Generated programmatically by [`scripts/build-native-p2p.js`](scripts/build-native-p2p.js) without external MSBuild/Visual Studio dependencies.
  * Ignored by Git (`*.node`) and generated automatically on demand by `pretest`, `prepackage`, and installer scripts if not present on disk.
  * Can be explicitly compiled using:
    ```powershell
    npm run build:native
    ```
* **C# Windows Installer (`src/installer/Program.cs`)**:
  * Compiled via `scripts/build-dist.js` using `csc.exe` (.NET Framework 4.8).
  * If updating installer GUI or CLI flags, test compilation and smoke tests via:
    ```powershell
    npm run build-dist
    node --test tests/installer-cli.test.js
    ```

---

## 5. Version Bumping & Synchronization

Automated release builds in GitHub Actions (`.github/workflows/release.yml`) use `scripts/get-next-version.js --apply` to automatically increment patch versions from git tags and synchronize all version references across the project.

When manually bumping versions:
- [ ] Run `node scripts/get-next-version.js --apply` (or update `package.json`)
- [ ] `package.json` (`version`)
- [ ] `src/multiplayer/constants.js` (`METADATA.version`)
- [ ] `src/installer/Program.cs` (`GetEmbeddedModVersion` fallback return)
- [ ] Run `npm test` to verify `tests/version-check.test.js` passes
