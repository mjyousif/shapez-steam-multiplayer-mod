/**
 * @file src/multiplayer/sync/game_hooks.js
 * @description Method interception and hook registration for the shapez.io GameLogic and HUD subsystems.
 * 
 * Intercepts:
 * 1. `GameLogic.tryPlaceBuilding`: Intercepts local placements, sets `isInsidePlaceBuilding = true`
 *    to prevent false deletion triggers during building replacement, and broadcasts `ACT_PLACE`.
 * 2. `GameLogic.tryDeleteBuilding`: Intercepts local deletions, guards against deletions caused by
 *    placements via `!isInsidePlaceBuilding`, and broadcasts `ACT_DELETE`.
 * 3. `HUDConstantSignalEdit.editConstantSignal`: Listens to dialog OK and value chosen events,
 *    capturing updated signal codes and broadcasting `ACT_SIGNAL`.
 * 4. `HUDLeverToggle.downPreHandler`: Captures interactive lever state toggles and broadcasts `ACT_LEVER`.
 * 5. `HUDMassSelector.clearBelts`: Captures mass selection belt item clearances and broadcasts `ACT_CLEAR_BELTS`.
 * 6. `HubGoals.tryUnlockUpgrade`: Captures research tier purchases and broadcasts `ACT_UPGRADE`.
 * 7. `HUDWaypoints`: Synchronizes waypoint creations, renames, and deletions via `ACT_WAYPOINTS`.
 * 8. `HUDPinnedShapes`: Synchronizes pinned shapes via `ACT_PINS`.
 * 9. `Blueprint.tryPlace`: Intercepts blueprint pastes, sets `isInsidePlaceBuilding = true`
 *    to prevent false deletions, captures placed entities, and broadcasts `ACT_BLUEPRINT`.
 * 
 * Invariants:
 * - Never broadcast actions when `isApplyingRemote === true` (loop prevention).
 * - Never broadcast actions unless `isSessionActive() === true`.
 */

const hubSync = require("./hub_sync");

/**
 * Registers all shapez.io GameLogic and HUD method hooks using the mod interface.
 *
 * @param {any} mod - Active Mod instance.
 */
function setupGameHooks(mod) {
    if (!mod.modInterface) return;

    // 1. Hook Building / Belt / Wire / Toolbar Placement
    mod.modInterface.replaceMethod(shapez.GameLogic, "tryPlaceBuilding", function (original, [args]) {
        const wasInside = mod.isInsidePlaceBuilding;
        mod.isInsidePlaceBuilding = true;
        let entity = null;
        try {
            entity = original(args);
        } finally {
            mod.isInsidePlaceBuilding = wasInside;
        }

        if (entity && !mod.isApplyingRemote && mod.isSessionActive()) {
            const { origin, rotation, rotationVariant, originalRotation, variant, building } = args;
            mod.dispatchNetworkAction({
                type: "ACT_PLACE",
                x: origin.x,
                y: origin.y,
                rotation,
                originalRotation,
                rotationVariant,
                variant,
                buildingId: building.getId(),
            });
        }
        return entity;
    });

    // 2. Hook Building / Wire Deletion
    mod.modInterface.replaceMethod(shapez.GameLogic, "tryDeleteBuilding", function (original, [entity]) {
        let tileX = null;
        let tileY = null;
        let layer = "regular";
        if (entity && entity.components && entity.components.StaticMapEntity) {
            tileX = entity.components.StaticMapEntity.origin.x;
            tileY = entity.components.StaticMapEntity.origin.y;
            layer = entity.layer || "regular";
        }

        const deleted = original(entity);
        if (
            deleted &&
            tileX !== null &&
            !mod.isApplyingRemote &&
            !mod.isInsidePlaceBuilding &&
            mod.isSessionActive()
        ) {
            mod.dispatchNetworkAction({
                type: "ACT_DELETE",
                x: tileX,
                y: tileY,
                layer,
            });
        }
        return deleted;
    });

    // 3. Hook Constant Signal Edit
    if (shapez.HUDConstantSignalEdit) {
        mod.modInterface.runAfterMethod(
            shapez.HUDConstantSignalEdit,
            "editConstantSignal",
            function (entity) {
                if (mod.isApplyingRemote || !mod.isSessionActive() || !entity) return;
                const dialogs = this.root?.hud?.parts?.dialogs;
                const topDialog =
                    dialogs && dialogs.dialogStack && dialogs.dialogStack[dialogs.dialogStack.length - 1];
                if (!topDialog) return;

                const broadcastSignalAfterApply = () => {
                    setTimeout(() => {
                        if (!entity || entity.destroyed || !entity.components?.ConstantSignal) return;
                        const origin = entity.components.StaticMapEntity.origin;
                        const sig = entity.components.ConstantSignal.signal;
                        const signalCode = sig ? sig.getAsCopyableKey() : "";
                        mod.dispatchNetworkAction({
                            type: "ACT_SIGNAL",
                            x: origin.x,
                            y: origin.y,
                            layer: entity.layer || "wires",
                            signalCode,
                        });
                    }, 0);
                };

                if (topDialog.buttonSignals?.ok) {
                    topDialog.buttonSignals.ok.add(broadcastSignalAfterApply);
                }
                if (topDialog.valueChosen) {
                    topDialog.valueChosen.add(broadcastSignalAfterApply);
                }
            }
        );
    }

    // 4. Hook Lever Toggle
    if (shapez.HUDLeverToggle) {
        mod.modInterface.runAfterMethod(
            shapez.HUDLeverToggle,
            "downPreHandler",
            function (pos, button) {
                if (mod.isApplyingRemote || !mod.isSessionActive()) return;
                if (button !== shapez.enumMouseButton.left) return;
                const tile = this.root.camera.screenToWorld(pos).toTileSpace();
                const entity = this.root.map.getLayerContentXY(tile.x, tile.y, "regular");
                if (entity && entity.components && entity.components.Lever) {
                    const origin = entity.components.StaticMapEntity.origin;
                    mod.dispatchNetworkAction({
                        type: "ACT_LEVER",
                        x: origin.x,
                        y: origin.y,
                        toggled: Boolean(entity.components.Lever.toggled),
                    });
                }
            }
        );
    }

    // 5. Hook Mass Selector Clear Belts
    if (shapez.HUDMassSelector) {
        mod.modInterface.replaceMethod(shapez.HUDMassSelector, "clearBelts", function (original, args) {
            const tiles = [];
            if (!mod.isApplyingRemote && mod.isSessionActive() && this.selectedUids) {
                for (const uid of this.selectedUids) {
                    const entity = this.root.entityMgr.findByUid(uid, false);
                    if (entity && entity.components?.StaticMapEntity) {
                        tiles.push({
                            x: entity.components.StaticMapEntity.origin.x,
                            y: entity.components.StaticMapEntity.origin.y,
                            layer: entity.layer || "regular",
                        });
                    }
                }
            }
            const res = original(...args);
            if (tiles.length > 0 && !mod.isApplyingRemote && mod.isSessionActive()) {
                mod.dispatchNetworkAction({
                    type: "ACT_CLEAR_BELTS",
                    tiles,
                });
            }
            return res;
        });
    }

    // 6. Hook Hub Upgrades
    if (shapez.HubGoals) {
        mod.modInterface.replaceMethod(
            shapez.HubGoals,
            "tryUnlockUpgrade",
            function (original, [upgradeId]) {
                if (mod.role === "client" && mod.isSessionActive() && !mod.isApplyingRemote) {
                    if (typeof this.canUnlockUpgrade === "function" && !this.canUnlockUpgrade(upgradeId)) {
                        return false;
                    }
                    return hubSync.predictUpgrade(mod, this, upgradeId);
                }
                return original(upgradeId);
            }
        );

        // 7. Suppress autonomous goal completion on client; host drives progression
        mod.modInterface.replaceMethod(
            shapez.HubGoals,
            "onGoalCompleted",
            function (original, args) {
                if (mod.role === "client" && mod.isSessionActive() && !mod.isApplyingRemote) {
                    return false;
                }
                return original(...args);
            }
        );
    }

    // 8. Hook Waypoints
    if (shapez.HUDWaypoints) {
        for (const fnName of ["addWaypoint", "renameWaypoint", "deleteWaypoint"]) {
            mod.modInterface.runAfterMethod(shapez.HUDWaypoints, fnName, function () {
                if (!mod.isApplyingRemote && mod.isSessionActive()) {
                    mod.dispatchNetworkAction({
                        type: "ACT_WAYPOINTS",
                        data: this.serialize(),
                    });
                }
            });
        }
    }

    // 9. Hook Pinned Shapes
    if (shapez.HUDPinnedShapes) {
        for (const fnName of ["pinNewShape", "unpinShape"]) {
            mod.modInterface.runAfterMethod(shapez.HUDPinnedShapes, fnName, function () {
                if (!mod.isApplyingRemote && mod.isSessionActive()) {
                    mod.dispatchNetworkAction({
                        type: "ACT_PINS",
                        data: this.serialize(),
                    });
                }
            });
        }
    }

    // 10. Hook Blueprint Placement
    if (shapez.Blueprint) {
        mod.modInterface.replaceMethod(shapez.Blueprint, "tryPlace", function (original, [root, targetTile]) {
            if (mod.isApplyingRemote || !mod.isSessionActive() || !root || !root.entityMgr) {
                return original(root, targetTile);
            }

            const wasInside = mod.isInsidePlaceBuilding;
            mod.isInsidePlaceBuilding = true;
            const placedEntities = [];
            const originalRegisterEntity = root.entityMgr.registerEntity;
            root.entityMgr.registerEntity = function (entity) {
                placedEntities.push(entity);
                return originalRegisterEntity.call(this, entity);
            };

            let success = false;
            try {
                success = original(root, targetTile);
            } finally {
                root.entityMgr.registerEntity = originalRegisterEntity;
                mod.isInsidePlaceBuilding = wasInside;
            }

            if (success && placedEntities.length > 0 && !mod.isApplyingRemote && mod.isSessionActive()) {
                const entries = [];
                for (const entity of placedEntities) {
                    if (!entity || entity.destroyed) continue;
                    const staticComp = entity.components?.StaticMapEntity;
                    if (!staticComp) continue;
                    const metaBuilding =
                        (typeof staticComp.getMetaBuilding === "function" && staticComp.getMetaBuilding()) ||
                        (typeof staticComp.getBuilding === "function" && staticComp.getBuilding()) ||
                        null;
                    if (!metaBuilding) continue;

                    let signalCode = null;
                    if (entity.components?.ConstantSignal?.signal) {
                        signalCode = entity.components.ConstantSignal.signal.getAsCopyableKey();
                    }

                    let toggled = false;
                    if (entity.components?.Lever) {
                        toggled = Boolean(entity.components.Lever.toggled);
                    }

                    const rotationVariant =
                        typeof staticComp.getRotationVariant === "function"
                            ? staticComp.getRotationVariant()
                            : staticComp.rotationVariant || 0;
                    const variant =
                        typeof staticComp.getVariant === "function"
                            ? staticComp.getVariant()
                            : staticComp.variant || "default";

                    entries.push({
                        x: staticComp.origin.x,
                        y: staticComp.origin.y,
                        buildingId: metaBuilding.getId(),
                        rotation: staticComp.rotation,
                        originalRotation: staticComp.originalRotation,
                        rotationVariant,
                        variant,
                        layer: entity.layer || "regular",
                        signalCode,
                        toggled,
                    });
                }

                if (entries.length > 0) {
                    const cost = typeof this.getCost === "function" ? this.getCost() : 0;
                    mod.dispatchNetworkAction({
                        type: "ACT_BLUEPRINT",
                        entries,
                        cost,
                    });

                    if (mod.role === "host" && cost > 0) {
                        setTimeout(() => {
                            if (mod.isSessionActive() && mod.currentRoot) {
                                hubSync.broadcastHubSync(mod, mod.currentRoot);
                            }
                        }, 0);
                    }
                }
            }

            return success;
        });
    }
}

module.exports = {
    setupGameHooks,
};
