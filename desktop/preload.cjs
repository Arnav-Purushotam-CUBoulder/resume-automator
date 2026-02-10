const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  chooseFolder: async () => {
    const folder = await ipcRenderer.invoke('choose-folder');
    return typeof folder === 'string' ? folder : null;
  },
});
