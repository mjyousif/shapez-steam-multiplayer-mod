/**
 * @file src/multiplayer/sync/world_check.js
 * @description Background world state drift detection and self-healing targeted region repair.
 * 
 * Architecture:
 * 1. Divides the factory grid into 16x16 tile regions.
 * 2. Produces deterministic spatial hashes of static building entities, signals, and levers.
 * 3. Compares host and client root hashes periodically without disrupting gameplay.
 * 4. Resolves detected drift through invisible targeted region delta repair before falling
 *    back to full savegame resynchronization.
 */

const { REGION_SIZE } = require("../constants");

/**
 * Deterministic 32-bit FNV-1a hashing function.
 *
 * @param {string} str - Input ASCII/UTF-8 string.
 * @param {number} [seed] - Optional hash seed.
 * @returns {string} 8-character hexadecimal hash string.
 */
function fnv1a(str, seed = 0x811c9dc5) {
    let h = seed;
    for (let i = 0; i < str.length; ++i) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Computes deterministic hashes for all occupied 16x16 grid regions in the world.
 *
 * @param {any} root - Active GameRoot instance.
 * @returns {Map<string, string>} Mapping of region keys ("rx_ry") to region hashes.
 */
function computeRegionHashes(root) {
    const regionBuckets = new Map();
    if (!root || !root.entityMgr) return regionBuckets;

    const entities = root.entityMgr.getAllWithComponent
        ? root.entityMgr.getAllWithComponent(shapez.StaticMapEntityComponent)
        : (root.entityMgr.entities || []);

    for (const entity of entities) {
        if (!entity || entity.destroyed) continue;
        const staticComp = entity.components && entity.components.StaticMapEntity;
        if (!staticComp || !staticComp.origin) continue;

        const x = staticComp.origin.x;
        const y = staticComp.origin.y;
        const rx = Math.floor(x / REGION_SIZE);
        const ry = Math.floor(y / REGION_SIZE);
        const rKey = `${rx}_${ry}`;

        let bucket = regionBuckets.get(rKey);
        if (!bucket) {
            bucket = [];
            regionBuckets.set(rKey, bucket);
        }

        const layer = entity.layer || "regular";
        const code = staticComp.code || (staticComp.getBuilding && staticComp.getBuilding().getId()) || 0;
        const rot = staticComp.rotation || 0;
        const rotVar = staticComp.rotationVariant || 0;
        const variant = staticComp.variant || "default";

        let extra = "";
        if (entity.components.ConstantSignal) {
            const sig = entity.components.ConstantSignal.signal;
            extra = sig && typeof sig.getAsCopyableKey === "function" ? sig.getAsCopyableKey() : "";
        } else if (entity.components.Lever) {
            extra = entity.components.Lever.toggled ? "1" : "0";
        }

        bucket.push(`${layer}:${x},${y}:${code}:${rot}:${rotVar}:${variant}:${extra}`);
    }

    const result = new Map();
    for (const [rKey, items] of regionBuckets) {
        items.sort();
        result.set(rKey, fnv1a(items.join(";")));
    }
    return result;
}

/**
 * Computes a single root hash representing the entire world topography from region hashes.
 *
 * @param {Map<string, string>} regionHashes - Regional hash map.
 * @returns {string} Root world hash.
 */
function computeRootHash(regionHashes) {
    if (!regionHashes || regionHashes.size === 0) return "00000000";
    const keys = Array.from(regionHashes.keys()).sort();
    const joined = keys.map(k => `${k}:${regionHashes.get(k)}`).join("|");
    return fnv1a(joined);
}

/**
 * Serializes entities within requested region keys for repair transfer.
 *
 * @param {any} root - Active GameRoot instance.
 * @param {string[]} regionKeys - Requested region keys.
 * @returns {Array<{ key: string, entities: Array<any> }>} Serialized region structures.
 */
function serializeRegions(root, regionKeys) {
    const keySet = new Set(regionKeys);
    const regionsMap = new Map();
    for (const k of keySet) {
        regionsMap.set(k, []);
    }

    if (!root || !root.entityMgr) return [];
    const entities = root.entityMgr.getAllWithComponent
        ? root.entityMgr.getAllWithComponent(shapez.StaticMapEntityComponent)
        : (root.entityMgr.entities || []);

    for (const entity of entities) {
        if (!entity || entity.destroyed) continue;
        const staticComp = entity.components && entity.components.StaticMapEntity;
        if (!staticComp || !staticComp.origin) continue;

        const x = staticComp.origin.x;
        const y = staticComp.origin.y;
        const rx = Math.floor(x / REGION_SIZE);
        const ry = Math.floor(y / REGION_SIZE);
        const rKey = `${rx}_${ry}`;

        if (!keySet.has(rKey)) continue;

        const building = staticComp.getBuilding ? staticComp.getBuilding() : null;
        const buildingId = building ? building.getId() : null;
        if (!buildingId) continue;

        let signalCode = null;
        let leverToggled = null;
        if (entity.components.ConstantSignal) {
            const sig = entity.components.ConstantSignal.signal;
            signalCode = sig && typeof sig.getAsCopyableKey === "function" ? sig.getAsCopyableKey() : "";
        } else if (entity.components.Lever) {
            leverToggled = Boolean(entity.components.Lever.toggled);
        }

        regionsMap.get(rKey).push({
            x,
            y,
            layer: entity.layer || "regular",
            buildingId,
            rotation: staticComp.rotation || 0,
            originalRotation: staticComp.originalRotation || 0,
            rotationVariant: staticComp.rotationVariant || 0,
            variant: staticComp.variant || "default",
            signalCode,
            leverToggled,
        });
    }

    const payload = [];
    for (const [key, ents] of regionsMap) {
        payload.push({ key, entities: ents });
    }
    return payload;
}

/**
 * Applies authoritative region data on the client, wiping mismatched tiles and rebuilding.
 *
 * @param {any} mod - Active Mod instance.
 * @param {Array<{ key: string, entities: Array<any> }>} regions - Regional entity arrays.
 */
function applyRegionData(mod, regions) {
    if (!mod.currentRoot || !Array.isArray(regions)) return;
    const root = mod.currentRoot;

    mod.isApplyingRemote = true;
    try {
        for (const reg of regions) {
            const [rx, ry] = reg.key.split("_").map(Number);
            const minX = rx * REGION_SIZE;
            const maxX = minX + REGION_SIZE;
            const minY = ry * REGION_SIZE;
            const maxY = minY + REGION_SIZE;

            // Remove all existing buildings in this 16x16 chunk
            for (let x = minX; x < maxX; ++x) {
                for (let y = minY; y < maxY; ++y) {
                    for (const layer of ["regular", "wires"]) {
                        const ent = root.map.getLayerContentXY(x, y, layer);
                        if (ent) {
                            root.logic.tryDeleteBuilding(ent);
                        }
                    }
                }
            }

            // Place incoming authoritative entities
            for (const item of reg.entities) {
                const metaBuilding = shapez.gMetaBuildingRegistry.findById(item.buildingId);
                if (metaBuilding) {
                    const placed = root.logic.tryPlaceBuilding({
                        origin: new shapez.Vector(item.x, item.y),
                        rotation: item.rotation,
                        originalRotation: item.originalRotation,
                        rotationVariant: item.rotationVariant,
                        variant: item.variant,
                        building: metaBuilding,
                    });

                    if (placed) {
                        if (item.signalCode !== null && placed.components && placed.components.ConstantSignal) {
                            const editor = root.hud?.parts?.constantSignalEdit;
                            if (editor && typeof editor.parseSignalCode === "function") {
                                placed.components.ConstantSignal.signal = editor.parseSignalCode(placed, item.signalCode);
                            }
                        } else if (item.leverToggled !== null && placed.components && placed.components.Lever) {
                            placed.components.Lever.toggled = Boolean(item.leverToggled);
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.warn("[Steam MP] Error applying region repair data:", err);
    } finally {
        mod.isApplyingRemote = false;
    }
}

/**
 * Client handler for host SYNC_CHECK packets.
 *
 * @param {any} mod - Active Mod instance.
 * @param {{ actionSeq: number, rootHash: string }} msg - Host sync check packet.
 */
function handleClientSyncCheck(mod, msg) {
    if (mod.role !== "client" || !mod.currentRoot) return;
    const now = Date.now();

    // In-flight grace period: do not check while local player placed something in last second
    if (now - (mod.lastLocalActionAt || 0) < 1000) return;

    // Grace period for pending incoming actions
    if ((mod.lastAppliedActionSeq || 0) < (msg.actionSeq || 0)) return;

    const localRegionHashes = computeRegionHashes(mod.currentRoot);
    const localRootHash = computeRootHash(localRegionHashes);

    if (localRootHash === msg.rootHash) {
        mod.checkMismatchCount = 0;
        mod.repairRounds = 0;
        return;
    }

    mod.checkMismatchCount = (mod.checkMismatchCount || 0) + 1;
    if (mod.checkMismatchCount >= 2) {
        if ((mod.repairRounds || 0) >= 3) {
            // Auto-heal escalation: targeted repairs did not converge, trigger full resync
            mod.logWarn("World state divergence persisted across 3 repair attempts. Requesting full resync...");
            mod.checkMismatchCount = 0;
            mod.repairRounds = 0;
            mod.requestWorldResync();
        } else {
            mod.logInfo(`Topography divergence detected (local=${localRootHash}, host=${msg.rootHash}). Requesting region hashes...`);
            mod.sendToHost({ type: "REQUEST_REGION_HASHES" });
        }
    }
}

/**
 * Host handler for client REQUEST_REGION_HASHES packets.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} peer - Peer requesting region hashes.
 */
function handleHostRequestRegionHashes(mod, peer) {
    if (mod.role !== "host" || !mod.currentRoot) return;
    const regionHashes = computeRegionHashes(mod.currentRoot);
    const hashesObj = {};
    for (const [k, v] of regionHashes) {
        hashesObj[k] = v;
    }
    mod.sendRawToPeer(peer, {
        type: "REGION_HASHES",
        hashes: hashesObj,
    });
}

/**
 * Client handler for host REGION_HASHES packets.
 *
 * @param {any} mod - Active Mod instance.
 * @param {{ hashes: Record<string, string> }} msg - Host region hashes packet.
 */
function handleClientRegionHashes(mod, msg) {
    if (mod.role !== "client" || !mod.currentRoot || !msg.hashes) return;
    const localRegionHashes = computeRegionHashes(mod.currentRoot);
    const hostHashes = msg.hashes;

    const mismatchedKeys = [];
    const allKeys = new Set([...localRegionHashes.keys(), ...Object.keys(hostHashes)]);

    for (const k of allKeys) {
        const localHash = localRegionHashes.get(k) || "00000000";
        const hostHash = hostHashes[k] || "00000000";
        if (localHash !== hostHash) {
            mismatchedKeys.push(k);
        }
    }

    if (mismatchedKeys.length > 0) {
        mod.repairRounds = (mod.repairRounds || 0) + 1;
        mod.logInfo(`Requesting ${mismatchedKeys.length} delta regions for self-healing repair...`);
        // Limit batch size to 32 regions per round
        mod.sendToHost({
            type: "REQUEST_REGIONS",
            keys: mismatchedKeys.slice(0, 32),
        });
    }
}

/**
 * Host handler for client REQUEST_REGIONS packets.
 *
 * @param {any} mod - Active Mod instance.
 * @param {any} peer - Requesting peer.
 * @param {{ keys: string[] }} msg - Request packet.
 */
function handleHostRequestRegions(mod, peer, msg) {
    if (mod.role !== "host" || !mod.currentRoot || !Array.isArray(msg.keys)) return;
    const regions = serializeRegions(mod.currentRoot, msg.keys);
    mod.sendRawToPeer(peer, {
        type: "REGION_DATA",
        regions,
    });
}

/**
 * Client handler for host REGION_DATA packets.
 *
 * @param {any} mod - Active Mod instance.
 * @param {{ regions: Array<any> }} msg - Region delta payload.
 */
function handleClientRegionData(mod, msg) {
    if (mod.role !== "client" || !mod.currentRoot || !Array.isArray(msg.regions)) return;
    applyRegionData(mod, msg.regions);
    mod.checkMismatchCount = 0;
}

module.exports = {
    fnv1a,
    computeRegionHashes,
    computeRootHash,
    serializeRegions,
    applyRegionData,
    handleClientSyncCheck,
    handleHostRequestRegionHashes,
    handleClientRegionHashes,
    handleHostRequestRegions,
    handleClientRegionData,
};
