/**
 * @file src/bridge/index.js
 * @description Central coordinator and module aggregator for the shapez.io Steam Co-op Mod Main Process.
 * 
 * Orchestrates:
 * - Persistent logging subsystem (`src/bridge/logger.js`)
 * - Native Steamworks P2P C++ addon wrapper (`src/bridge/native_p2p.js`)
 * - Steamworks Matchmaking Lobby metadata channel (`src/bridge/lobby_channel.js`)
 * - 4-byte BE TCP framing and UPnP network transport (`src/bridge/tcp_transport.js`)
 * - Steam lifecycle, Greenworks bindings, and profile manager (`src/bridge/steam_client.js`)
 * - Electron IPC handler registration (`src/bridge/ipc_handlers.js`)
 */

const logger = require("./logger");
const nativeP2P = require("./native_p2p");
const lobbyChannel = require("./lobby_channel");
const tcpTransport = require("./tcp_transport");
const steamClient = require("./steam_client");
const { registerIpcHandlers } = require("./ipc_handlers");

// Wire cross-module delegates
nativeP2P.setRendererSender(steamClient.sendToRenderer);
tcpTransport.setRendererSender(steamClient.sendToRenderer);

nativeP2P.setFriendNameResolver(steamId => {
    const greenworks = steamClient.getGreenworks();
    if (greenworks && typeof greenworks.getFriendPersonaName === "function") {
        return greenworks.getFriendPersonaName(steamId) || steamId;
    }
    return steamId;
});

lobbyChannel.setLobbyChannelContext({
    getGreenworks: steamClient.getGreenworks,
    getCurrentLobbyId: steamClient.getCurrentLobbyId,
    getCurrentLobbyHostId: steamClient.getCurrentLobbyHostId,
    setCurrentLobbyHostId: steamClient.setCurrentLobbyHostId,
    getLobbyRole: steamClient.getLobbyRole,
    getLocalSteamProfile: steamClient.getLocalSteamProfile,
    normalizeSteamId: steamClient.normalizeSteamId,
    isRealSteamLobbyId: steamClient.isRealSteamLobbyId,
    getLobbyOwnerSteamId: steamClient.getLobbyOwnerSteamId,
    sendToRenderer: steamClient.sendToRenderer,
});

/**
 * Registers all Steamworks and networking IPC handlers on `electron.ipcMain`.
 */
function listen() {
    registerIpcHandlers();
}

module.exports = {
    init: steamClient.init,
    listen,
    setMainWindow: steamClient.setMainWindow,
    createFrameBuffer: tcpTransport.createFrameBuffer,
    attachFrameParser: tcpTransport.attachFrameParser,
    startTcpHost: tcpTransport.startTcpHost,
    stopTcpHost: tcpTransport.stopTcpHost,
    connectTcpClient: tcpTransport.connectTcpClient,
    disconnectTcpClient: tcpTransport.disconnectTcpClient,
    isRealSteamLobbyId: steamClient.isRealSteamLobbyId,
    steamIdToBuffer8: nativeP2P.steamIdToBuffer8,
    loadNativeSteamP2P: nativeP2P.loadNativeSteamP2P,
    encodeLobbyWindow: lobbyChannel.encodeLobbyWindow,
    decodeLobbyWindow: lobbyChannel.decodeLobbyWindow,
    LOG_FILE_PATH: logger.LOG_FILE_PATH,
    logger,
    nativeP2P,
    lobbyChannel,
    tcpTransport,
    steamClient,
    registerIpcHandlers,
};
