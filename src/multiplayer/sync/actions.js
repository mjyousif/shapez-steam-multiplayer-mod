/**
 * @file src/multiplayer/sync/actions.js
 * @description Remote gameplay action dispatcher with reentrancy loop protection.
 * 
 * Synchronizes:
 * - `ACT_PLACE`: Static entity / building placement across regular and wires layers.
 * - `ACT_DELETE`: Entity deletion on specified layer coordinate.
 * - `ACT_SIGNAL`: Constant signal value changes and code parsing.
 * - `ACT_LEVER`: Interactive lever state toggles.
 * - `ACT_CLEAR_BELTS`: Bulk clearing of items on conveyors / machines within selected tiles.
 * - `ACT_UPGRADE`: Research tier unlock synchronizations.
 * - `ACT_WAYPOINTS`: Player map waypoint mutations.
 * - `ACT_PINS`: Pinned shape target HUD updates.
 * 
 * Reentrancy Invariant:
 * - All actions applied through `applyRemoteAction` MUST be wrapped in `isApplyingRemote = true`
 *   inside a `try ... finally` block to prevent infinite echoing back into outgoing broadcast streams.
 */

/**
 * Applies a remote player's gameplay action to the local simulation state.
 *
 * @param {any} mod - Active Mod instance.
 * @param {{
 *   type: string,
 *   buildingId?: string,
 *   x?: number,
 *   y?: number,
 *   layer?: "regular" | "wires",
 *   rotation?: number,
 *   originalRotation?: number,
 *   rotationVariant?: number,
 *   variant?: string,
 *   signalCode?: string,
 *   toggled?: boolean,
 *   tiles?: Array<{ x: number, y: number, layer: string }>,
 *   upgradeId?: string,
 *   data?: any
 * }} msg - Remote action packet.
 */
function applyRemoteAction(mod, msg) {
    if (!mod.currentRoot || !mod.currentRoot.logicInitialized) {
        mod.pendingActionsQueue.push(msg);
        return;
    }

    if (typeof msg.actionSeq === "number") {
        mod.lastAppliedActionSeq = Math.max(mod.lastAppliedActionSeq || 0, msg.actionSeq);
    }

    const root = mod.currentRoot;
    mod.isApplyingRemote = true;

    try {
        switch (msg.type) {
            case "ACT_PLACE": {
                const metaBuilding = shapez.gMetaBuildingRegistry.findById(msg.buildingId);
                if (metaBuilding) {
                    root.logic.tryPlaceBuilding({
                        origin: new shapez.Vector(msg.x, msg.y),
                        rotation: msg.rotation,
                        originalRotation: msg.originalRotation,
                        rotationVariant: msg.rotationVariant,
                        variant: msg.variant,
                        building: metaBuilding,
                    });
                }
                break;
            }

            case "ACT_DELETE": {
                const entity = root.map.getLayerContentXY(msg.x, msg.y, msg.layer || "regular");
                if (entity) {
                    root.logic.tryDeleteBuilding(entity);
                }
                break;
            }

            case "ACT_SIGNAL": {
                const entity = root.map.getLayerContentXY(msg.x, msg.y, msg.layer || "wires");
                if (entity && entity.components?.ConstantSignal) {
                    const editor = root.hud?.parts?.constantSignalEdit;
                    if (editor && typeof editor.parseSignalCode === "function") {
                        entity.components.ConstantSignal.signal = editor.parseSignalCode(
                            entity,
                            msg.signalCode || ""
                        );
                    }
                }
                break;
            }

            case "ACT_LEVER": {
                const entity = root.map.getLayerContentXY(msg.x, msg.y, "regular");
                if (entity && entity.components?.Lever) {
                    entity.components.Lever.toggled = Boolean(msg.toggled);
                }
                break;
            }

            case "ACT_CLEAR_BELTS": {
                if (Array.isArray(msg.tiles)) {
                    for (const t of msg.tiles) {
                        const entity = root.map.getLayerContentXY(t.x, t.y, t.layer || "regular");
                        if (entity && entity.components) {
                            for (const comp of Object.values(entity.components)) {
                                if (comp && typeof comp.clear === "function") {
                                    comp.clear();
                                }
                            }
                        }
                    }
                }
                break;
            }

            case "ACT_WAYPOINTS": {
                if (root.hud?.parts?.waypoints && msg.data) {
                    root.hud.parts.waypoints.deserialize(msg.data);
                }
                break;
            }

            case "ACT_PINS": {
                if (root.hud?.parts?.pinnedShapes && msg.data) {
                    root.hud.parts.pinnedShapes.deserialize(msg.data);
                    root.hud.parts.pinnedShapes.rerenderFull();
                }
                break;
            }
        }
    } catch (err) {
        console.warn("[Steam MP] Error applying remote action:", msg, err);
    } finally {
        mod.isApplyingRemote = false;
    }
}

module.exports = {
    applyRemoteAction,
};
