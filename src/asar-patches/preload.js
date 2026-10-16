const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ipcRenderer", {
    invoke: ipcRenderer.invoke.bind(ipcRenderer),
    on: (channel, listener) => {
        const wrapped = (event, ...args) => listener(event, ...args);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
    },
    send: ipcRenderer.send.bind(ipcRenderer),
});
