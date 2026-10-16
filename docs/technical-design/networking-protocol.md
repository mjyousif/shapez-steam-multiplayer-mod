# Technical Design: Networking Protocol & Transports

## 1. Overview

The Co-op Multiplayer Mod features a **dual-transport networking engine** designed to provide instant connections regardless of network environment:

1. **Direct TCP Sockets (Main Process)**: Lowest latency; ideal for LAN, port-forwarded IP addresses, local multi-instance testing (`127.0.0.1:27080`), and virtual private networks (Tailscale, Hamachi, ZeroTier).
2. **WebRTC DataChannels (Renderer Process)**: Peer-to-peer UDP channels with NAT traversal; connects Steam friends across different networks without requiring port-forwarding or third-party relay servers.

```mermaid
flowchart LR
    subgraph Host["Host Player"]
        HTCP["TCP Framing Server (:27080)"]
        HMod["Mod Core"]
        HWebRTC["WebRTC RTCPeerConnection"]
        HSteam["Steamworks Friends API"]
        HMod <--> HTCP
        HMod <--> HWebRTC
        HMod <--> HSteam
    end

    subgraph Client["Joining Client"]
        CTCP["TCP Client Socket"]
        CMod["Mod Core"]
        CWebRTC["WebRTC RTCPeerConnection"]
        CSteam["Steamworks Friends API"]
        CMod <--> CTCP
        CMod <--> CWebRTC
        CMod <--> CSteam
    end

    HTCP <==> |"Length-Prefixed TCP (Direct IP / LAN / VPN)"| CTCP
    HSteam <==> |"Out-of-Band Signaling: [SHAPEZ_MP]:{kind: ...}"| CSteam
    HWebRTC <==> |"P2P UDP DataChannel (STUN NAT Traversal)"| CWebRTC
```

---

## 2. Transport Layer Details

### 2.1 Direct TCP Framing Layer (`src/asar-patches/steam.js`)

Node.js TCP sockets (`net.Socket`) transmit arbitrary byte streams rather than discrete message packets. Without framing, multiple JSON packets can be merged into a single `data` event, or a large JSON packet can be fragmented across multiple read buffers.

To guarantee message boundary integrity, all TCP messages use a **4-byte Big-Endian length header**:

```text
+-----------------------+------------------------------------------+
| Header (4 Bytes)      | Payload (N Bytes)                        |
| UInt32BE (N)          | UTF-8 Encoded JSON String                |
+-----------------------+------------------------------------------+
```

#### Serialization (`createFrameBuffer`)
```javascript
function createFrameBuffer(obj) {
    const payload = Buffer.from(JSON.stringify(obj), "utf8");
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(payload.length, 0);
    return Buffer.concat([header, payload]);
}
```

#### Parsing & Reassembly (`attachFrameParser`)
The receiving socket buffers incoming bytes until the expected payload size is fulfilled:
```javascript
function attachFrameParser(socket, onMessage) {
    let buffer = Buffer.alloc(0);
    socket.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
            const msgLen = buffer.readUInt32BE(0);
            if (buffer.length < 4 + msgLen) {
                break; // Await remaining bytes
            }
            const payload = buffer.subarray(4, 4 + msgLen);
            buffer = buffer.subarray(4 + msgLen);
            try {
                const parsed = JSON.parse(payload.toString("utf8"));
                onMessage(parsed);
            } catch (err) {
                console.warn("Invalid frame payload:", err);
            }
        }
    });
}
```

---

### 2.2 WebRTC Peer-to-Peer over Steam Friends Signaling

When connecting via Steam Friends, users may be behind restrictive NAT routers or firewalls where opening inbound ports is impossible. The mod solves this using standard **WebRTC DataChannels** with **Steam Friends Chat** acting as the out-of-band signaling conduit.

#### The Signaling Channel
Greenworks exposes Steam's friend messaging subsystem:
* `greenworks.setListenForFriendsMessage(true)` enables chat message interception.
* `greenworks.sendFriendMessage(friendSteamId, message)` transmits out-of-band payloads.
* Signaling messages are tagged with the signature prefix: `[SHAPEZ_MP]:` followed by JSON.

#### The WebRTC Handshake Lifecycle
```mermaid
sequenceDiagram
    autonumber
    actor Client as Client Player
    actor Host as Host Player

    Client->>Host: Steam Friend Msg: [SHAPEZ_MP]: {"kind":"WEBRTC_OFFER", "sdp":{...}}
    Host->>Host: createRtcPeerConnection(remoteSteamId, isHost=true)
    Host->>Host: pc.setRemoteDescription(offer)
    Host->>Host: answer = pc.createAnswer()
    Host->>Client: Steam Friend Msg: [SHAPEZ_MP]: {"kind":"WEBRTC_ANSWER", "sdp":{...}}
    Client->>Client: pc.setRemoteDescription(answer)

    par ICE Candidate Exchange
        Client->>Host: Steam Friend Msg: [SHAPEZ_MP]: {"kind":"WEBRTC_ICE", "candidate":{...}}
        Host->>Client: Steam Friend Msg: [SHAPEZ_MP]: {"kind":"WEBRTC_ICE", "candidate":{...}}
    end

    Note over Client,Host: Direct P2P RTCDataChannel Established ("shapez-sync")
    Host->>Client: WELCOME_WORLD (Chunked Initial Sync)
```

Public STUN servers are configured to discover external IP candidates:
* `stun:stun.l.google.com:19302`
* `stun:stun1.l.google.com:19302`

---

## 3. Chunked World Transfer Protocol

A shapez.io factory savegame dump can range from 200 KB to over 10 MB depending on factory complexity. Transmitting large monolithic strings in a single message can saturate network buffers or exceed WebRTC channel buffer limits (typically 64 KB per message).

To ensure smooth delivery without frame drops, `sendChunkedToPeer()` splits the payload into **48 KB slices**:

```javascript
// src/steam_multiplayer.js
sendChunkedToPeer(peer, message) {
    const raw = JSON.stringify(message);
    const CHUNK_SIZE = 49152; // 48 KB
    if (raw.length <= CHUNK_SIZE) {
        this.sendRawToPeer(peer, message);
        return;
    }
    const transferId = "xfer_" + Math.random().toString(36).slice(2, 10);
    const total = Math.ceil(raw.length / CHUNK_SIZE);
    for (let i = 0; i < total; i++) {
        const chunk = raw.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        this.sendRawToPeer(peer, {
            type: "CHUNK_PART",
            transferId,
            index: i,
            total,
            data: chunk,
        });
    }
}
```

### Client-Side Chunk Reassembly
The client stores received slices inside `clientChunkBuffer`. Once all slices (`received >= total`) arrive:
1. Slices are concatenated in order: `entry.chunks.join("")`.
2. The full payload is deserialized: `JSON.parse(fullJson)`.
3. The message is passed into `onClientReceivedMessage(fullMsg)` as if it were received as a single message.

---

## 4. Packet Schema Reference

All messages dispatched between Host and Clients share a common `type` property:

| Packet `type` | Direction | Description | Key Fields |
| :--- | :--- | :--- | :--- |
| `WELCOME_WORLD` | Host &rarr; Client | Initial factory snapshot on connection | `hostId`, `hostName`, `assignedColor`, `mode`, `roster`, `dump` |
| `CHUNK_PART` | Host &harr; Client | 48 KB fragment of a large packet | `transferId`, `index`, `total`, `data` |
| `ROSTER_UPDATE` | Host &rarr; All | Connected player roster & colors | `players: [{ id, name, color, isHost }]` |
| `CURSOR` | Both directions | Player cursor position & active layer | `senderId`, `name`, `x`, `y`, `layer`, `buildingId`, `variant`, `rotation`, `rotationVariant` |
| `ACT_PLACE` | Both directions | Building, belt, or wire placed | `x`, `y`, `rotation`, `originalRotation`, `rotationVariant`, `variant`, `buildingId` |
| `ACT_DELETE` | Both directions | Building or wire deleted | `x`, `y`, `layer` |
| `ACT_SIGNAL` | Both directions | Constant signal code modified | `x`, `y`, `layer`, `signalCode` |
| `ACT_LEVER` | Both directions | Logic lever toggled | `x`, `y`, `toggled` |
| `ACT_CLEAR_BELTS` | Both directions | Mass selector cleared items from belts | `tiles: [{ x, y, layer }]` |
| `ACT_UPGRADE` | Both directions | Hub tier upgrade unlocked | `upgradeId` |
| `ACT_WAYPOINTS` | Both directions | Map waypoint added, renamed, or deleted | `data: serializedWaypoints` |
| `ACT_PINS` | Both directions | Pinned shape formula modified | `data: serializedPins` |
| `SYNC_HUB` | Host &rarr; Client | Periodic hub shapes and level sync | `level`, `deliveredShapes`, `upgradeLevels` |
| `REQUEST_RESYNC` | Client &rarr; Host | Client requesting fresh world snapshot | `{ type: "REQUEST_RESYNC" }` |
| `CHAT` | Both directions | Chat message sent | `senderName`, `color`, `text` |
| `PING` | Both directions | Animated map ping coordinate | `senderName`, `color`, `x`, `y`, `time` |

---

## 5. Session Codes & Addressing

The mod provides two representations of session connection details:

1. **Standard `IP:Port`**:
   * Example: `127.0.0.1:27080` or `192.168.1.50:27080`.
   * Directly entered in the Join modal or passed via CLI.
2. **Base64 Join Code**:
   * Contains JSON metadata encoding the endpoint, Steam lobby ID, and Host Steam ID:
     ```json
     {
       "e": "192.168.1.50:27080",
       "l": "109775244769012345",
       "h": "76561198000000000"
     }
     ```
   * Generated with `encodeJoinCode()` and decoded via `decodeJoinCode()`.
   * Automatically falls back to raw Steam IDs or IP addresses if entered directly.
