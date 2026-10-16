# Feature Guide: Co-op HUD & Social Features

## 1. Overview

Building massive factories in Co-op requires constant coordination and communication. The mod introduces a dedicated in-game **Co-op HUD**, real-time **ghost building previews**, **remote cursor rendering**, **off-screen tracking**, **radar pings**, and **in-game chat**.

---

## 2. In-Game HUD Panel

The Co-op HUD is embedded at the top-center of the screen during gameplay (`HUDMultiplayer` in `src/steam_multiplayer.js`).

### HUD Components
* **Status Indicator**:
  * 🟢 **Green**: Connected to active Host / Clients.
  * 🟡 **Yellow**: Connecting / Handshaking / Synchronizing world state.
  * 🔴 **Red**: Disconnected / Offline.
* **Player Count Badge**: Displays the current number of players in the factory session.
* **Collapse Button (`–` / `+`)**: Minimizes the HUD to a discreet pill to maximize screen space for large factory blueprints.
* **Roster List**: Shows all active teammates with their assigned player color dot and Host status badge.
* **Action Buttons**:
  * **Invite Friends**: Opens the Steam Multiplayer modal / Steam Overlay.
  * **Copy Code**: Copies the session Join Code directly to the clipboard.
  * **Ping `[P]`**: Sends an animated radar map ping at your current mouse cursor coordinates.
  * **Resync** *(Client only)*: Requests a fresh factory snapshot from the Host.

---

## 3. Live Teammate Cursors & Ghost Previews

### 3.1 Cursor Tracking & Name Tags
Every player is assigned a unique color from the Co-op palette (Sky Blue, Rose, Purple, Emerald, Amber, Pink, Indigo, Teal).
* Teammates' cursors are rendered in their color with their Steam username floating above.
* Below the name, a badge indicates whether the player is currently viewing the **Regular** building layer or the **[Wires]** logic layer.

### 3.2 Ghost Building Previews
When your teammate selects any building in their hotbar (e.g. Belt, Balancer, Cutter, Painter, Stack Operator) or rotates it:
* The mod renders a **translucent ghost preview (40% opacity)** on your screen at their exact cursor position.
* You can see exactly what your friend is planning to build and where they are about to place it before they click.

### 3.3 Off-Screen Directional Tracking
On an infinite shapez.io canvas, players frequently work thousands of tiles apart.
* When a teammate moves off your current screen viewport, a **directional arrow** appears at the edge of your screen.
* The arrow points directly toward your teammate's coordinates and displays their name and player color, allowing you to easily pan over to inspect their work.

---

## 4. Radar Map Pings (<kbd>P</kbd>)

* Pressing the <kbd>P</kbd> key anywhere on the map (or clicking **Ping [P]**) emits an expanding radar ripple at your cursor's tile coordinates.
* The ping animates across a 3-second decay curve and plays an audio cue for all connected players.
* Teammates can immediately see where help is needed or where a new raw resource patch has been located.

---

## 5. In-Game Team Chat

* An integrated chat box is embedded directly in the expandable Co-op HUD.
* Pressing <kbd>Enter</kbd> focuses the input field; pressing <kbd>Enter</kbd> again sends the message.
* Messages are rendered with colored author tags matching each player's cursor color.
* System notifications (e.g., player joins, leaves, and factory resync events) appear automatically in the chat stream.
