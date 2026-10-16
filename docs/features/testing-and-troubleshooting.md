# Feature Guide: Testing & Troubleshooting

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

---

## 2. Automated Test Suite (`npm test`)

The repository includes a comprehensive, automated test suite in `scripts/verify-mod.js`:

```powershell
npm test
# or
npm run verify
```

### What the Test Suite Verifies:

1. **ASAR Binary Integrity**:
   * Inspects `app.asar` byte offsets, Chromium Pickle headers, and JSON structure.
   * Confirms `index.js`, `steam.js`, and `preload.js` are present and properly patched.
   * Ensures the 64-bit native Greenworks addon in `app.asar.unpacked/` retains its `unpacked: true` flag.
2. **Host <-> Client End-to-End Simulation**:
   * Spawns two isolated simulated processes (Host and Client).
   * Verifies the 4-byte length-prefixed TCP framing server and client socket handshakes.
   * Simulates full factory world serialization, 48 KB chunk streaming, and deserialization.
   * Dispatches and verifies delta actions (`ACT_PLACE`, `ACT_DELETE`, `ACT_SIGNAL`, `ACT_UPGRADE`).
   * Confirms recursion prevention guards (`isApplyingRemote`) suppress echo packets.

---

## 3. Troubleshooting Common Issues

### 3.1 "Connection Refused" or Join Timed Out
* **Windows Defender Firewall**: When hosting for the first time, Windows may prompt to allow network access. Ensure **Private Networks** is checked.
* **Port In Use (EADDRINUSE)**: If a previous game process crashed while holding port `27080`, terminate any orphaned `shapezio.exe` processes via Task Manager or PowerShell:
  ```powershell
  Stop-Process -Name shapezio -Force -ErrorAction SilentlyContinue
  ```
* **Direct LAN / VPN**: If connecting across machines without Steam, verify both players can ping each other's IP address (e.g. over Tailscale, Radmin, or LAN).

### 3.2 Mod Does Not Appear In-Game
* Ensure `steam_multiplayer.js` is present in your roaming mods directory:
  ```text
  %APPDATA%\shapez.io\mods\steam_multiplayer.js
  ```
* Verify Steam Launch Options do not have `--safe-mode` enabled (safe mode disables all mods).
* Re-run the installer:
  ```powershell
  npm run install-mod
  ```

### 3.3 Restoring 100% Vanilla Game
To remove the mod and restore the original vanilla game files:
* Run the uninstaller:
  ```powershell
  npm run uninstall-mod
  ```
  *(Or run `ShapezCoopInstaller.exe` and click "Restore Vanilla".)*
* This restores `app.asar` from `app.asar.vanilla.bak` and removes the mod script from `%APPDATA%\shapez.io\mods`.
