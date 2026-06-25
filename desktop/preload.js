const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("WeChatClonedDesktop", {
  platform: process.platform
});
