import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hub", {
  getBootstrap: () => ipcRenderer.invoke("hub:get-bootstrap"),
  checkWhisper: () => ipcRenderer.invoke("hub:check-whisper"),
  getSettings: () => ipcRenderer.invoke("hub:get-settings"),
  saveSettings: (settings: Record<string, string>) => ipcRenderer.invoke("hub:save-settings", settings),
  getDashboard: () => ipcRenderer.invoke("hub:get-dashboard"),
  listProducts: () => ipcRenderer.invoke("hub:list-products"),
  saveProduct: (product: Record<string, string>) => ipcRenderer.invoke("hub:save-product", product),
  retryProductResearch: (productId: string) => ipcRenderer.invoke("hub:retry-product-research", productId),
  deleteProduct: (id: string) => ipcRenderer.invoke("hub:delete-product", id),
  refreshProductsFromLibrary: () => ipcRenderer.invoke("hub:refresh-products-from-library"),
  listLibrary: () => ipcRenderer.invoke("hub:list-library"),
  listMemory: () => ipcRenderer.invoke("hub:list-memory"),
  listScripts: () => ipcRenderer.invoke("hub:list-scripts"),
  getScript: (id: string) => ipcRenderer.invoke("hub:get-script", id),
  listPacingReferences: () => ipcRenderer.invoke("hub:list-pacing-references"),
  getScriptInsights: () => ipcRenderer.invoke("hub:get-script-insights"),
  generateScript: (req: {
    productId: string;
    durationSeconds?: number;
    referenceLibraryId?: string;
    additionalInfo?: string;
  }) => ipcRenderer.invoke("hub:generate-script", req),
  rateScriptFeedback: (req: { scriptId: string; feedback: "liked" | "disliked"; reason?: string }) =>
    ipcRenderer.invoke("hub:rate-script-feedback", req),
  rateScriptSectionFeedback: (req: {
    scriptId: string;
    section: "audio" | "on_screen_caption" | "tiktok_caption" | "pace";
    rating: "liked" | "disliked" | "keep_with_notes";
    reason?: string;
    notes?: string;
  }) => ipcRenderer.invoke("hub:rate-script-section-feedback", req),
  updateScriptContent: (req: {
    scriptId: string;
    pendingAnalysisId?: string;
    updates: Record<string, string | undefined>;
  }) => ipcRenderer.invoke("hub:update-script-content", req),
  listElevenLabsVoices: () => ipcRenderer.invoke("hub:list-elevenlabs-voices"),
  generateAudio: (scriptId: string) => ipcRenderer.invoke("hub:generate-audio", scriptId),
  openAudioFile: (filePath: string) => ipcRenderer.invoke("hub:open-audio-file", filePath),
  getGoogleDriveStatus: () => ipcRenderer.invoke("hub:google-drive-status"),
  connectGoogleDrive: () => ipcRenderer.invoke("hub:google-drive-connect"),
  uploadVoiceoverToDrive: (scriptId: string) => ipcRenderer.invoke("hub:upload-voiceover-to-drive", scriptId),
  getMemorySummary: () => ipcRenderer.invoke("hub:get-memory-summary"),
  importFiles: () => ipcRenderer.invoke("hub:import-files"),
  rescanDataFolder: () => ipcRenderer.invoke("hub:rescan-data-folder"),
  openDataFolder: () => ipcRenderer.invoke("hub:open-data-folder"),
  openDataSubfolder: (folderId: string) => ipcRenderer.invoke("hub:open-data-subfolder", folderId),
  getDataLayout: () => ipcRenderer.invoke("hub:get-data-layout"),
  listImportHistory: () => ipcRenderer.invoke("hub:list-import-history"),
  requestSync: (type: "ALL" | "STUDIO" | "COMPASS") => ipcRenderer.invoke("hub:request-sync", type),
  getPlannerSummary: () => ipcRenderer.invoke("hub:get-planner-summary"),
  getMaxDailyPosts: () => ipcRenderer.invoke("hub:get-max-daily-posts"),
  importSalesFile: () => ipcRenderer.invoke("hub:import-sales-file"),
  generateDailyPlan: (req: {
    planDate?: string;
    limits: { top: number; middle: number; bottom: number };
    selectedProductNames?: string[];
  }) => ipcRenderer.invoke("hub:generate-daily-plan", req),
  listDailyPlans: () => ipcRenderer.invoke("hub:list-daily-plans"),
  getDailyPlan: (id: string) => ipcRenderer.invoke("hub:get-daily-plan", id),
  getAgentStatus: () => ipcRenderer.invoke("hub:get-agent-status"),
  syncAgentMemory: () => ipcRenderer.invoke("hub:sync-agent-memory"),
  sendAgentMessage: (message: string) => ipcRenderer.invoke("hub:send-agent-message", message),
  estimateAgentCost: (params: {
    action: "generate_script" | "generate_daily_plan" | "agent_chat";
    totalVideos?: number;
    durationSeconds?: number;
    messageChars?: number;
  }) => ipcRenderer.invoke("hub:estimate-agent-cost", params),
  requestAgentTask: (req: {
    task: "generate_script" | "generate_daily_plan" | "analyze_data" | "custom";
    instructions: string;
    context?: string;
  }) => ipcRenderer.invoke("hub:request-agent-task", req),
  listAgentChatHistory: () => ipcRenderer.invoke("hub:list-agent-chat-history"),
  resetAgentSession: () => ipcRenderer.invoke("hub:reset-agent-session"),
  importPersonalLibrary: () => ipcRenderer.invoke("hub:import-personal-library"),
  listMyVideos: () => ipcRenderer.invoke("hub:list-my-videos"),
  saveMyVideo: (submission: Record<string, unknown>) => ipcRenderer.invoke("hub:save-my-video", submission),
  deleteMyVideo: (id: string) => ipcRenderer.invoke("hub:delete-my-video", id),
  analyseMyVideo: (id: string) => ipcRenderer.invoke("hub:analyse-my-video", id),
  listPendingAnalysis: () => ipcRenderer.invoke("hub:list-pending-analysis"),
  batchPendingFromToday: (dateTag?: string) => ipcRenderer.invoke("hub:batch-pending-from-today", dateTag),
  setPendingAnalysisUrl: (req: { id: string; url: string }) =>
    ipcRenderer.invoke("hub:set-pending-analysis-url", req),
  pullPendingAnalysis: (id: string) => ipcRenderer.invoke("hub:pull-pending-analysis", id),
  submitPendingAnalysis: (req: { id: string; data: Record<string, unknown> }) =>
    ipcRenderer.invoke("hub:submit-pending-analysis", req),
  deletePendingAnalysis: (req: { id: string; deleteScript?: boolean }) =>
    ipcRenderer.invoke("hub:delete-pending-analysis", req),
  onAgentSessionStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on("hub:agent-session-status", listener);
    return () => {
      ipcRenderer.removeListener("hub:agent-session-status", listener);
    };
  },
});
