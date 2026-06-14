import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hub", {
  getBootstrap: () => ipcRenderer.invoke("hub:get-bootstrap"),
  checkWhisper: () => ipcRenderer.invoke("hub:check-whisper"),
  getSettings: () => ipcRenderer.invoke("hub:get-settings"),
  saveSettings: (settings: Record<string, string>) => ipcRenderer.invoke("hub:save-settings", settings),
  getDashboard: () => ipcRenderer.invoke("hub:get-dashboard"),
  listProducts: () => ipcRenderer.invoke("hub:list-products"),
  saveProduct: (product: Record<string, string>) => ipcRenderer.invoke("hub:save-product", product),
  deleteProduct: (id: string) => ipcRenderer.invoke("hub:delete-product", id),
  refreshProductsFromLibrary: () => ipcRenderer.invoke("hub:refresh-products-from-library"),
  listLibrary: () => ipcRenderer.invoke("hub:list-library"),
  listMemory: () => ipcRenderer.invoke("hub:list-memory"),
  listScripts: () => ipcRenderer.invoke("hub:list-scripts"),
  getScript: (id: string) => ipcRenderer.invoke("hub:get-script", id),
  listPacingReferences: () => ipcRenderer.invoke("hub:list-pacing-references"),
  listHookTypes: () => ipcRenderer.invoke("hub:list-hook-types"),
  generateScript: (req: {
    hookType: string;
    productId: string;
    durationSeconds?: number;
    referenceLibraryId?: string;
  }) => ipcRenderer.invoke("hub:generate-script", req),
  listElevenLabsVoices: () => ipcRenderer.invoke("hub:list-elevenlabs-voices"),
  generateAudio: (scriptId: string) => ipcRenderer.invoke("hub:generate-audio", scriptId),
  openAudioFile: (filePath: string) => ipcRenderer.invoke("hub:open-audio-file", filePath),
  getMemorySummary: () => ipcRenderer.invoke("hub:get-memory-summary"),
  importFiles: () => ipcRenderer.invoke("hub:import-files"),
  rescanDataFolder: () => ipcRenderer.invoke("hub:rescan-data-folder"),
  openDataFolder: () => ipcRenderer.invoke("hub:open-data-folder"),
  requestSync: (type: "ALL" | "STUDIO" | "COMPASS") => ipcRenderer.invoke("hub:request-sync", type),
});
