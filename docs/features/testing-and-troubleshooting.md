# Feature Guide: Testing, Tooling & Troubleshooting

## 1. Single-PC Testing (Dual Windows)

Developers can test Host and Client interactions side-by-side on a single computer without needing two Steam accounts or two PCs.

### 1.1 Running the Secondary Client
1. Launch **shapez** normally through Steam (this will be the **Host**).
2. Start a Co-op session (e.g. Host a new or existing save on port `27080`).
3. Open a terminal in the project directory and run:
   ```powershell
   npm run launch-client
   ```
4. A second game window will spawn side-by-side. In the second window:
   * Click **Steam Multiplayer** on the Main Menu.
   * Under **2. Join by Code or IP:Port**, click **Connect** (defaults to `127.0.0.1:27080`).
   * The second window will instantly download the factory and enter the game.

### 1.2 How Instance Isolation Works
By default, Chromium and Electron prevent multiple instances from using the same user data directory. The secondary client script passes special flags:
```powershell
shapezio.exe --multi-instance --instance-id=2 --dev
```

When the patched `index.js` in `app.asar` detects these switches:
* **UserData Directory**: Relocated to `%APPDATA%\shapez.io\instances\instance-2`.
* **Save Directory**: Relocated to `%APPDATA%\shapez.io\saves-2`.
* **Single Instance Lock**: `app.requestSingleInstanceLock()` is bypassed, allowing both windows to run concurrently without file locking conflicts.
* **Cursor Disambiguation**: Mod automatically differentiates player IDs so both cursors render distinctly.

---

## 2. Automated Test Suite

The mod features a tiered testing pipeline executed via `npm test`:

```powershell
# Run the entire test pipeline (Syntax Check -> Unit Tests -> E2E Verification)
npm test

# Build distribution bundles from modular source units
npm run build           # Assembles src/bridge/ and src/multiplayer/ into bundles

# Run individual stages
npm run check:syntax    # Validates syntax across all JS files
npm run test:unit       # Runs 10 native unit test suites via node --test
npm run test:e2e        # Runs the end-to-end Host <-> Client simulation
```

### 2.1 Syntax Validation (`scripts/check-syntax.js`)
Performs static AST syntax verification on all project scripts, source files, and test files using Node's native `vm.Script` compiler.

### 2.2 Unit Test Suites (`tests/*.test.js`)
Powered by Node.js's native test runner (`node --test`), covering 50+ test assertions across 10 specialized suites:
1. **`tests/asar-patcher.test.js`**:
   * Inspects `app.asar` byte offsets, Chromium Pickle headers, and JSON structure.
   * Confirms `index.js`, `steam.js`, and `preload.js` patch cleanly in-place.
   * Ensures native binaries in `app.asar.unpacked/` retain `unpacked: true`.
2. **`tests/framing.test.js`**:
   * Tests 4-byte Big-Endian length header framing.
   * Validates chunk fragmentation across arbitrary byte boundaries and large concatenated packet bursts.
   * Confirms oversized frame guard protection destroys offending sockets.
3. **`tests/join-code.test.js`**:
   * Round-trips Base64 Join Codes with endpoints, lobby IDs, and host Steam IDs.
   * Validates fallback for raw IP:Port strings and 64-bit Steam IDs.
   * Confirms HTML entity escaping protects against XSS and markup injection.
4. **`tests/network-resilience.test.js`**:
   * Simulates malformed JSON stream recovery without dropping subsequent valid frames.
   * Verifies header bytes split across chunk boundaries.
   * Validates automatic TCP port incrementing on `EADDRINUSE` conflicts.
5. **`tests/savegame-isolation.test.js`**:
   * Ensures active singleplayer savegames are never overwritten when joining co-op or resyncing.
   * Verifies dedicated `activeCoopSavegame` allocation.
6. **`tests/installer-cli.test.js`**:
   * Smoke-tests C# installer binary CLI flags (`--help`, `--version`, `--backup`, `--check-update`).
7. **`tests/dist-package.test.js`**:
   * Verifies distribution packaging and required binary bundle inclusions.
8. **`tests/version-check.test.js`**:
   * Validates semantic version comparison invariants, release increment logic, and inter-file synchronization (`package.json`, `constants.js`, `Program.cs`).
9. **`tests/hub-sync.test.js`**:
   * Validates host-authoritative snapshots, geometric speed multiplier recomputation (`recomputeUpgradeImprovements`), client optimistic prediction reconciliation, and prediction timeout expiry.
10. **`tests/world-check.test.js`**:
    * Tests deterministic FNV-1a hashing, 16x16 chunk spatial bucketing, regional factory chunk replacement, and drift detection grace periods with targeted auto-repair.

### 2.3 End-to-End Simulation (`scripts/verify-mod.js`)
* Spawns two isolated simulated processes (Host and Client).
* Simulates full factory world serialization, 48 KB chunk streaming, and deserialization.
* Dispatches and verifies delta actions (`ACT_PLACE`, `ACT_DELETE`, `ACT_SIGNAL`, `ACT_UPGRADE`).
* Confirms recursion prevention guards (`isApplyingRemote`) suppress echo packets.
* **Native Steam P2P Validation**: Verifies `steam_p2p_win64.node` exists and exports all required functions (`init`, `sendP2PPacket`, `readP2PPacket`, `acceptP2PSession`, `requestFriendRichPresence`, `requestLobbyData`), verifies lobby data windowing, and asserts zero chat spam.

---

## 3. Installer CLI & Save Game Backups

The standalone Windows installer GUI (`ShapezCoopInstaller.exe`) can also be controlled directly from the command line:

```text
Usage: ShapezCoopInstaller.exe [options]
  --silent, -s       Install mod and patches quietly without UI
  --uninstall, -u    Uninstall mod and restore vanilla shapez.io
  --backup, -b       Create a timestamped .zip backup of shapez saves
  --path <dir>       Specify custom shapez.io installation path
  --version, -v      Print installer version
  --help, -h         Show help message
```

### Save Game Backup Utilities
* **From Installer GUI**: Click **Backup Saves (.zip)** or use the folder shortcut buttons to open saves or backups.
* **From Installer CLI**: Run `ShapezCoopInstaller.exe --backup`.
* **From Node.js**: Run `npm run backup-saves` (`scripts/backup-saves.js`).
* Backups are written as timestamped `.zip` archives into `%APPDATA%\shapez.io\backups\`.

---

## 4. Troubleshooting Common Issues

### 4.1 "Connection Refused" or Join Timed Out
* **Windows Defender Firewall**: When hosting for the first time, Windows may prompt to allow network access. Ensure **Private Networks** is checked.
* **Port In Use (EADDRINUSE)**: The mod automatically tries the next port (e.g. `27081`), but if an orphaned game process is holding port `27080`, terminate it via PowerShell:
  ```powershell
  Stop-Process -Name shapezio -Force -ErrorAction SilentlyContinue
  ```
* **Direct LAN / VPN**: If connecting across machines without Steam, verify both players can ping each other's IP address (e.g. over Tailscale, Radmin, or LAN).

### 4.2 Mod Does Not Appear In-Game
* Ensure `steam_multiplayer.js` is present in your roaming mods directory:
  ```text
  %APPDATA%\shapez.io\mods\steam_multiplayer.js
  ```
* Verify Steam Launch Options do not have `--safe-mode` enabled (safe mode disables all mods).
* Re-run the installer:
  ```powershell
  npm run install-mod
  ```

### 4.3 Restoring 100% Vanilla Game
To remove the mod and restore original vanilla game files:
* Run the uninstaller:
  ```powershell
  npm run uninstall-mod
  ```
  *(Or run `ShapezCoopInstaller.exe` and click "Restore Vanilla", or run `ShapezCoopInstaller.exe --uninstall`.)*
* This restores `app.asar` from `app.asar.vanilla.bak` and removes the mod script from `%APPDATA%\shapez.io\mods`.
