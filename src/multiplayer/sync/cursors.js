/**
 * @file src/multiplayer/sync/cursors.js
 * @description Real-time live cursor streaming, ghost building placement previews, map pings, and overlays.
 * 
 * Provides:
 * 1. High-frequency cursor broadcasting (~20-50 Hz) with state deduplication and rate limiting.
 * 2. Linear interpolation smoothing (`renderX`, `renderY`) for remote player cursors.
 * 3. Ghost building preview rendering:
 *    - Translucent player-tinted bounding box.
 *    - Rotation, variant, and multi-tile dimension alignment.
 *    - Sprite centering and drawing from `shapez.gMetaBuildingRegistry`.
 * 4. Distinct cursor pointers with custom color fills and Steam persona name badges.
 * 5. Screen-space edge indicator arrows pointing toward teammates who are currently off-screen.
 * 6. Pulsating map pings with distance falloff, coordinate labels, and audio cues.
 */

const { PLAYER_COLORS } = require("../constants");

/**
 * Captures local mouse world position, held building metadata, and broadcasts to peers.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} root - Active GameRoot instance.
 */
function broadcastLocalCursorState(mod, root) {
    if (!root || !root.camera || !root.app?.mousePosition) return;
    if (mod.role === "client" && !mod.clientWorldLoaded) return;
    if (mod.role === "host") {
        let hasReadyPeer = false;
        for (const [, p] of mod.peers) {
            if (p.ready) {
                hasReadyPeer = true;
                break;
            }
        }
        if (!hasReadyPeer) return;
    }

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const isRelay =
        (mod.role === "client" && mod.clientTransport === "steam-relay") ||
        (mod.role === "host" &&
            Array.from(mod.peers.values()).some(p => p.ready && p.transport === "steam-relay"));

    if (isRelay && now - (mod.lastCursorSentAt || 0) < 350) {
        return;
    }

    const worldPos = root.camera.screenToWorld(root.app.mousePosition);
    const placer = root.hud?.parts?.buildingPlacer;
    const metaBuilding = placer?.currentMetaBuilding?.get();
    let buildingId = null;
    let variant = null;
    let rotation = 0;
    let rotationVariant = 0;

    if (metaBuilding) {
        buildingId = metaBuilding.getId();
        variant = placer.currentVariant.get() || shapez.defaultBuildingVariant;
        const tile = worldPos.toTileSpace();
        try {
            const opt = metaBuilding.computeOptimalDirectionAndRotationVariantAtTile({
                root,
                tile,
                rotation: placer.currentBaseRotation,
                variant,
                layer: metaBuilding.getLayer(),
            });
            rotation = opt.rotation;
            rotationVariant = opt.rotationVariant;
        } catch {
            rotation = placer.currentBaseRotation || 0;
        }
    }

    const rx = Math.round(worldPos.x * 10) / 10;
    const ry = Math.round(worldPos.y * 10) / 10;
    const layer = root.currentLayer || "regular";
    const stateKey = `${rx},${ry},${layer},${buildingId || ""},${variant || ""},${rotation},${rotationVariant}`;

    if (mod.lastCursorStateKey === stateKey && now - (mod.lastCursorSentAt || 0) < 3000) {
        return;
    }
    mod.lastCursorStateKey = stateKey;
    mod.lastCursorSentAt = now;

    const local = mod.getLocalPlayerInfo();
    mod.dispatchNetworkAction({
        type: "CURSOR",
        playerId: local.id,
        name: local.name,
        color: local.color,
        x: rx,
        y: ry,
        layer,
        buildingId,
        variant,
        rotation,
        rotationVariant,
        time: now,
    });
}

/**
 * Updates a remote player's target coordinates and held building preview.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} msg - Cursor message packet.
 */
function updateRemoteCursor(mod, msg) {
    const localId = mod.getLocalPlayerInfo().id;
    if (!msg.playerId || msg.playerId === localId) return;

    let rp = mod.remotePlayers.get(msg.playerId);
    if (!rp) {
        rp = {
            id: msg.playerId,
            name: msg.name || "Teammate",
            color: msg.color || PLAYER_COLORS[1],
            isHost: false,
            x: msg.x || 0,
            y: msg.y || 0,
            renderX: msg.x || 0,
            renderY: msg.y || 0,
            layer: msg.layer || "regular",
            buildingId: msg.buildingId || null,
            variant: msg.variant || null,
            rotation: msg.rotation || 0,
            rotationVariant: msg.rotationVariant || 0,
            lastUpdate: performance.now(),
            lastTime: typeof msg.time === "number" ? msg.time : 0,
        };
        mod.remotePlayers.set(msg.playerId, rp);
        if (mod.currentHud) mod.currentHud.refreshUI();
    } else {
        // Discard stale out-of-order cursor packet from jittered transport
        if (typeof msg.time === "number") {
            if (rp.lastTime && msg.time < rp.lastTime) return;
            rp.lastTime = msg.time;
        }

        rp.name = msg.name || rp.name;
        rp.color = msg.color || rp.color;
        rp.x = msg.x || 0;
        rp.y = msg.y || 0;
        rp.layer = msg.layer || "regular";
        rp.buildingId = msg.buildingId || null;
        rp.variant = msg.variant || null;
        rp.rotation = msg.rotation || 0;
        rp.rotationVariant = msg.rotationVariant || 0;
        rp.lastUpdate = performance.now();
    }
}

/**
 * Sends a cooperative chat message to all connected peers.
 *
 * @param {any} mod - Active Mod instance.
 * @param {string} text - Message text.
 */
function sendChatMessage(mod, text) {
    const local = mod.getLocalPlayerInfo();
    if (mod.currentHud) {
        mod.currentHud.appendChatLine(local.name, local.color, text);
    }
    mod.dispatchNetworkAction({
        type: "CHAT",
        senderName: local.name,
        color: local.color,
        text,
    });
}

/**
 * Transmits a map ping at the local user's current cursor location.
 *
 * @param {any} mod - Active Mod instance.
 */
function sendMapPingAtCursor(mod) {
    if (!mod.currentRoot || !mod.currentRoot.camera) return;
    const mousePos = mod.currentRoot.app?.mousePosition;
    const worldPos = mousePos
        ? mod.currentRoot.camera.screenToWorld(mousePos)
        : mod.currentRoot.camera.center;
    const local = mod.getLocalPlayerInfo();

    const ping = {
        type: "PING",
        x: Math.round(worldPos.x),
        y: Math.round(worldPos.y),
        name: local.name,
        color: local.color,
    };
    addMapPing(mod, ping);
    mod.dispatchNetworkAction(ping);
}

/**
 * Adds an active pulsating map ping to the local render list and HUD chat.
 *
 * @param {any} mod - Active Mod instance.
 * @param {{ x: number, y: number, name?: string, color?: string }} ping - Ping data.
 */
function addMapPing(mod, ping) {
    mod.activePings.push({
        x: ping.x,
        y: ping.y,
        name: ping.name || "Player",
        color: ping.color || "#38bdf8",
        createdAt: performance.now(),
    });
    if (mod.currentHud) {
        mod.currentHud.appendChatLine(
            "Ping",
            ping.color || "#38bdf8",
            `${ping.name} pinged (${Math.floor(ping.x / 32)}, ${Math.floor(ping.y / 32)})`,
            true
        );
    }
}

/**
 * Draws all remote player cursors, ghost building previews, and expanding map pings in world-space.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} root - Active GameRoot instance.
 * @param {any} parameters - Drawing parameters containing canvas 2D context.
 */
function drawWorldSpacePeers(mod, root, parameters) {
    const ctx = parameters.context;
    if (!ctx) return;

    const zoom = root.camera.zoomLevel || 1;
    const invZoom = 1 / Math.max(0.2, zoom);

    for (const [, rp] of mod.remotePlayers) {
        // Smoothly interpolate cursor position
        rp.renderX += (rp.x - rp.renderX) * 0.35;
        rp.renderY += (rp.y - rp.renderY) * 0.35;

        ctx.save();

        // 1. Draw remote player's ghost building preview if holding a building
        if (rp.buildingId) {
            try {
                const metaBuilding = shapez.gMetaBuildingRegistry.findById(rp.buildingId);
                const buildingLayer = metaBuilding?.getLayer ? metaBuilding.getLayer() : (rp.layer || "regular");
                const currentLayer = root.currentLayer || "regular";

                if (metaBuilding && buildingLayer === currentLayer) {
                    const tileX = Math.floor(rp.renderX / 32);
                    const tileY = Math.floor(rp.renderY / 32);
                    const variant = rp.variant || shapez.defaultBuildingVariant;
                    const rotationVariant = rp.rotationVariant || 0;
                    const rawRotation = rp.rotation || 0;
                    const rotation = ((Math.round(rawRotation / 90) * 90) % 360 + 360) % 360;
                    const dims = metaBuilding.getDimensions(variant) || new shapez.Vector(1, 1);

                    // Calculate tile-space bounds taking building rotation into account
                    // Matches shapez.StaticMapEntityComponent.getTileSpaceBounds
                    let boundsX = tileX;
                    let boundsY = tileY;
                    let boundsW = dims.x;
                    let boundsH = dims.y;

                    switch (rotation) {
                        case 90:
                            boundsX = tileX - dims.y + 1;
                            boundsY = tileY;
                            boundsW = dims.y;
                            boundsH = dims.x;
                            break;
                        case 180:
                            boundsX = tileX - dims.x + 1;
                            boundsY = tileY - dims.y + 1;
                            boundsW = dims.x;
                            boundsH = dims.y;
                            break;
                        case 270:
                            boundsX = tileX;
                            boundsY = tileY - dims.x + 1;
                            boundsW = dims.y;
                            boundsH = dims.x;
                            break;
                    }

                    const worldBoxX = boundsX * 32;
                    const worldBoxY = boundsY * 32;
                    const worldBoxW = boundsW * 32;
                    const worldBoxH = boundsH * 32;

                    // Check visibility within camera viewport
                    const isVisible = parameters.visibleRect
                        ? parameters.visibleRect.containsRect4Params(worldBoxX, worldBoxY, worldBoxW, worldBoxH)
                        : true;

                    if (isVisible) {
                        ctx.save();

                        // Subtle player-tinted rounded placement bounds
                        ctx.fillStyle = rp.color;
                        ctx.strokeStyle = rp.color;
                        ctx.lineWidth = 1.5;

                        if (typeof ctx.beginRoundedRect === "function") {
                            ctx.globalAlpha = 0.16;
                            ctx.beginRoundedRect(worldBoxX + 2, worldBoxY + 2, worldBoxW - 4, worldBoxH - 4, 4);
                            ctx.fill();
                            ctx.globalAlpha = 0.65;
                            ctx.stroke();
                        } else {
                            ctx.globalAlpha = 0.16;
                            ctx.fillRect(worldBoxX + 2, worldBoxY + 2, worldBoxW - 4, worldBoxH - 4);
                            ctx.globalAlpha = 0.65;
                            ctx.strokeRect(worldBoxX + 2, worldBoxY + 2, worldBoxW - 4, worldBoxH - 4);
                        }

                        // Prefer native blueprint ghost sprite, fallback to preview sprite
                        const sprite =
                            (typeof metaBuilding.getBlueprintSprite === "function"
                                ? metaBuilding.getBlueprintSprite(rotationVariant, variant)
                                : null) ||
                            (typeof metaBuilding.getPreviewSprite === "function"
                                ? metaBuilding.getPreviewSprite(rotationVariant, variant)
                                : null);

                        if (sprite) {
                            ctx.globalAlpha = 0.55;

                            const spriteW = dims.x * 32;
                            const spriteH = dims.y * 32;

                            if (rotation === 0) {
                                if (typeof sprite.drawCached === "function") {
                                    sprite.drawCached(parameters, tileX * 32, tileY * 32, spriteW, spriteH);
                                } else if (typeof sprite.draw === "function") {
                                    sprite.draw(ctx, tileX * 32, tileY * 32, spriteW, spriteH);
                                }
                            } else {
                                const pivotX = tileX * 32 + 16;
                                const pivotY = tileY * 32 + 16;
                                ctx.translate(pivotX, pivotY);
                                ctx.rotate((rotation * Math.PI) / 180);

                                if (typeof sprite.drawCached === "function") {
                                    sprite.drawCached(parameters, -16, -16, spriteW, spriteH, false);
                                } else if (typeof sprite.draw === "function") {
                                    sprite.draw(ctx, -16, -16, spriteW, spriteH);
                                }
                            }
                        }

                        ctx.restore();
                    }
                }
            } catch {}
        }

        // 2. Draw cursor pointer & player name label
        ctx.translate(rp.renderX, rp.renderY);
        ctx.scale(invZoom, invZoom);

        ctx.fillStyle = rp.color;
        ctx.strokeStyle = "#111827";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 18);
        ctx.lineTo(5, 14);
        ctx.lineTo(9, 22);
        ctx.lineTo(12, 20);
        ctx.lineTo(8, 12);
        ctx.lineTo(14, 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Name tag pill
        const label = rp.layer === "wires" ? `${rp.name} [Wires]` : rp.name;
        ctx.font = "bold 12px GameFont, sans-serif";
        const textW = ctx.measureText(label).width;
        const padX = 7;
        const boxX = 14;
        const boxY = 12;
        const boxW = textW + padX * 2;
        const boxH = 20;

        ctx.fillStyle = "rgba(17, 24, 39, 0.88)";
        ctx.strokeStyle = rp.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(boxX, boxY, boxW, boxH);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "middle";
        ctx.fillText(label, boxX + padX, boxY + boxH / 2);

        ctx.restore();
    }

    // 3. Draw active map pings
    const now = performance.now();
    mod.activePings = mod.activePings.filter(p => now - p.createdAt < 4500);
    for (const ping of mod.activePings) {
        const age = (now - ping.createdAt) / 4500;
        const radius = (20 + age * 110) * invZoom;
        const alpha = Math.max(0, 1 - age);

        ctx.save();
        ctx.translate(ping.x, ping.y);
        ctx.strokeStyle = ping.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 3 * invZoom;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.45, 0, Math.PI * 2);
        ctx.stroke();

        ctx.scale(invZoom, invZoom);
        ctx.font = "bold 13px GameFont, sans-serif";
        ctx.fillStyle = ping.color;
        ctx.textAlign = "center";
        ctx.fillText(`PING: ${ping.name}`, 0, -24);
        ctx.restore();
    }
}

/**
 * Draws screen-space off-screen directional indicator arrows for teammates outside the camera view.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} root - Active GameRoot instance.
 * @param {any} parameters - Drawing parameters containing canvas 2D context.
 */
function drawScreenSpaceOverlays(mod, root, parameters) {
    const ctx = parameters.context;
    if (!ctx || !root.camera) return;

    const screenW = root.gameWidth;
    const screenH = root.gameHeight;
    const margin = 42;

    for (const [, rp] of mod.remotePlayers) {
        const screenPos = root.camera.worldToScreen(new shapez.Vector(rp.renderX, rp.renderY));
        if (
            screenPos.x >= margin &&
            screenPos.x <= screenW - margin &&
            screenPos.y >= margin &&
            screenPos.y <= screenH - margin
        ) {
            continue; // Teammate is visible within viewport
        }

        const centerX = screenW / 2;
        const centerY = screenH / 2;
        const dx = screenPos.x - centerX;
        const dy = screenPos.y - centerY;
        const angle = Math.atan2(dy, dx);

        const clampedX = Math.max(margin, Math.min(screenW - margin, screenPos.x));
        const clampedY = Math.max(margin, Math.min(screenH - margin, screenPos.y));

        ctx.save();
        ctx.translate(clampedX, clampedY);

        // Arrow head pointing towards teammate
        ctx.save();
        ctx.rotate(angle);
        ctx.fillStyle = rp.color;
        ctx.strokeStyle = "#111827";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(-8, -8);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-8, 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Teammate display name
        ctx.font = "bold 11px GameFont, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#111827";
        ctx.lineWidth = 3;
        ctx.textAlign = "center";
        ctx.strokeText(rp.name, 0, 20);
        ctx.fillText(rp.name, 0, 20);

        ctx.restore();
    }
}

module.exports = {
    broadcastLocalCursorState,
    updateRemoteCursor,
    sendChatMessage,
    sendMapPingAtCursor,
    addMapPing,
    drawWorldSpacePeers,
    drawScreenSpaceOverlays,
};
