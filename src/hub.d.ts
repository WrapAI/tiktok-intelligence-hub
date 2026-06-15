export type LibraryVideoInsight = {
  libraryId: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagementScore: number;
  hookType: string;
  hookText: string;
  visualHook: string;
  hookMechanism: string;
  funnelCategory: string;
  primaryReason: string;
  replicationNotes: string;
  replicationScore: number;
  hasPacing: boolean;
  profile?: string;
};

export type HookTypeStat = {
  hookType: string;
  count: number;
  avgViews: number;
  avgEngagement: number;
  totalEngagement: number;
};

export type ScriptInsights = {
  topVideos: LibraryVideoInsight[];
  hookTypeStats: HookTypeStat[];
  recommendedReferenceId: string | null;
  recommendedHookType: string;
};

export type ProductResearchStatus = "pending" | "researching" | "complete" | "error" | "skipped";

export type Product = {
  id: string;
  name: string;
  brand?: string;
  price?: string;
  description?: string;
  image_url?: string;
  source?: string;
  packaging_type?: string;
  container_nouns?: string;
  product_category?: string;
  research_notes?: string;
  research_completed_at?: string;
  research_status?: ProductResearchStatus;
  research_error?: string;
};

export type AgentCostBreakdown = {
  pricingAsOf: string;
  modelId: string;
  modelLabel: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreation5mTokens?: number;
  };
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  totalUsd: number;
  estimated: boolean;
};

export type ScriptResult = {
  id: string;
  title: string;
  script: string;
  ssml: string;
  hookType: string;
  productId: string;
  referenceLibraryId?: string;
  createdAt: string;
  onScreenCaption: string;
  tiktokCaption: string;
  audioPath?: string;
  cost?: AgentCostBreakdown;
};

export type MemorySummary = {
  totalMemoryEntries: number;
  ratedEntries: number;
  avgRating: number;
  avgMyViews: number;
  avgMyGmv: number;
  hookTypeWins?: Record<string, number>;
  topPatterns: Array<{
    source: string;
    hook: string;
    hookType?: string;
    whatWorked: string;
    myViews?: number;
    myGmv?: number;
    rating?: number;
  }>;
};

export type FunnelLimits = {
  top: number;
  middle: number;
  bottom: number;
};

export type ClipInstruction = {
  step: number;
  duration: string;
  whatToFilm: string;
  whatToSay: string;
  onScreenText: string;
};

export type PlanVideo = {
  id: string;
  funnel: "top" | "middle" | "bottom";
  funnelLabel: string;
  productName: string;
  productBrand: string;
  productId: string | null;
  salesRank: number;
  videoIndex: number;
  videoCountForProduct: number;
  title: string;
  summary: string;
  referenceLibraryId: string | null;
  hookType: string;
  funnelCategory: string;
  fullAudioScript: string;
  onScreenCaption: string;
  tiktokCaption: string;
  clips: ClipInstruction[];
};

export type DailyPlan = {
  id: string;
  planDate: string;
  limits: FunnelLimits;
  totalVideos: number;
  salesSource: string | null;
  salesPeriodDays: number;
  videos: PlanVideo[];
  createdAt: string;
  cost?: AgentCostBreakdown;
};

export type PlannerSummary = {
  salesCount: number;
  lastSalesImport: string;
  lastSalesFile: string;
  salesPeriodDays: number;
  topProducts: Array<{
    rank: number;
    name: string;
    fullName: string;
    brand: string;
    gmv: number;
    orders: number;
    units: number;
  }>;
  funnelLibraryCounts: { top: number; middle: number; bottom: number };
  defaultLimits: FunnelLimits;
  maxDailyPosts: number;
};

export type DataFolderInfo = {
  id: string;
  label: string;
  description: string;
  path: string;
  fileCount: number;
};

export type DataLayoutSummary = {
  root: string;
  database: string;
  folders: DataFolderInfo[];
  archiveCount: number;
  importHistoryCount: number;
};

export type ImportHistoryEntry = {
  id: string;
  category: string;
  file_name: string;
  relative_path: string;
  import_type: string;
  record_count: number;
  imported_at: string;
};

export type AgentStatus = {
  configured: boolean;
  memoryConfigured: boolean;
  agentId: string;
  environmentId: string;
  memoryStoreId: string;
  sessionId: string | null;
  hasApiKey: boolean;
};

export type AgentMessage = {
  role: "user" | "assistant";
  text: string;
  at: string;
  cost?: AgentCostBreakdown;
};

export type AgentSessionPhase =
  | "connecting"
  | "sending"
  | "running"
  | "waiting_json"
  | "finalizing"
  | "done"
  | "error";

export type AgentSessionLiveStatus = {
  active: boolean;
  phase: AgentSessionPhase;
  message: string;
  sessionStatus?: string;
  task?: string;
  sessionId?: string;
  at: string;
};

export type HubApi = {
  getBootstrap: () => Promise<{ dataFolder: string }>;
  checkWhisper: () => Promise<boolean>;
  getSettings: () => Promise<{
    anthropicApiKey: string;
    elevenLabsApiKey: string;
    elevenLabsVoiceId: string;
    myTiktokHandle: string;
    dataFolder: string;
    tiktokAgentId: string;
    tiktokAgentEnvironmentId: string;
    tiktokAgentMemoryStoreId: string;
    tiktokAgentSessionId: string;
  }>;
  saveSettings: (settings: Record<string, string>) => Promise<{ ok: boolean }>;
  getDashboard: () => Promise<{
    libraryCount: number;
    memoryCount: number;
    productCount: number;
    scriptCount: number;
    salesCount: number;
    summary: MemorySummary;
    latestStudioSync: string | null;
    latestCompassSync: string | null;
    dataFolder: string;
    dataLayout: DataLayoutSummary;
    importHistoryCount: number;
  }>;
  listProducts: () => Promise<Product[]>;
  saveProduct: (product: Record<string, string>) => Promise<{ ok: boolean; id: string }>;
  retryProductResearch: (productId: string) => Promise<{ ok: boolean }>;
  deleteProduct: (id: string) => Promise<{ ok: boolean }>;
  listLibrary: () => Promise<unknown[]>;
  listMemory: () => Promise<unknown[]>;
  listScripts: () => Promise<Array<{ id: string; title: string; hook_type: string; created_at: string }>>;
  getScript: (id: string) => Promise<{ script_text: string; ssml: string; title: string } | undefined>;
  refreshProductsFromLibrary: () => Promise<{ ok: boolean; count: number }>;
  getScriptInsights: () => Promise<ScriptInsights>;
  listPacingReferences: () => Promise<
    Array<{
      id: string;
      hook: string;
      hookType: string;
      views: number;
      likes: number;
      comments: number;
      replicationScore: number;
      engagementScore: number;
    }>
  >;
  generateScript: (req: {
    productId: string;
    durationSeconds?: number;
    referenceLibraryId?: string;
    additionalInfo?: string;
  }) => Promise<{ ok: boolean; result?: ScriptResult; cost?: AgentCostBreakdown; error?: string }>;
  listElevenLabsVoices: () => Promise<{ ok: boolean; voices?: Array<{ voice_id: string; name: string }>; error?: string }>;
  generateAudio: (scriptId: string) => Promise<{ ok: boolean; filePath?: string; alignmentPath?: string | null; error?: string }>;
  openAudioFile: (filePath: string) => Promise<{ ok: boolean }>;
  getMemorySummary: () => Promise<MemorySummary>;
  importFiles: () => Promise<{
    ok: boolean;
    canceled?: boolean;
    message?: string;
    error?: string;
    imported?: Array<{ file: string; ok: true; type: string; count: number }>;
    errors?: Array<{ file: string; error: string }>;
  }>;
  rescanDataFolder: () => Promise<{
    ok: boolean;
    results: unknown[];
    productsExtracted: number;
    message?: string;
    error?: string;
  }>;
  openDataFolder: () => Promise<{ ok: boolean }>;
  openDataSubfolder: (folderId: string) => Promise<{ ok: boolean }>;
  getDataLayout: () => Promise<DataLayoutSummary>;
  listImportHistory: () => Promise<ImportHistoryEntry[]>;
  requestSync: (type: "ALL" | "STUDIO" | "COMPASS") => Promise<{ ok: boolean; message?: string; error?: string }>;
  getPlannerSummary: () => Promise<PlannerSummary>;
  getMaxDailyPosts: () => Promise<number>;
  importSalesFile: () => Promise<{ ok: boolean; canceled?: boolean; count?: number; file?: string; error?: string }>;
  generateDailyPlan: (req: {
    planDate?: string;
    limits: FunnelLimits;
    selectedProductNames?: string[];
    additionalInfo?: string;
  }) => Promise<{ ok: boolean; plan?: DailyPlan; cost?: AgentCostBreakdown; error?: string }>;
  listDailyPlans: () => Promise<Array<{ id: string; planDate: string; totalVideos: number; createdAt: string }>>;
  getDailyPlan: (id: string) => Promise<DailyPlan | null>;
  getAgentStatus: () => Promise<AgentStatus>;
  syncAgentMemory: () => Promise<{ ok: boolean; uploaded?: number; paths?: string[]; error?: string }>;
  sendAgentMessage: (message: string) => Promise<{ ok: boolean; reply?: string; sessionId?: string; cost?: AgentCostBreakdown; error?: string }>;
  estimateAgentCost: (params: {
    action: "generate_script" | "generate_daily_plan" | "agent_chat";
    totalVideos?: number;
    durationSeconds?: number;
    messageChars?: number;
  }) => Promise<{ ok: boolean; cost?: AgentCostBreakdown; error?: string }>;
  requestAgentTask: (req: {
    task: "generate_script" | "generate_daily_plan" | "analyze_data" | "custom";
    instructions: string;
    context?: string;
  }) => Promise<{ ok: boolean; reply?: string; sessionId?: string; cost?: AgentCostBreakdown; error?: string }>;
  listAgentChatHistory: () => Promise<AgentMessage[]>;
  resetAgentSession: () => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  onAgentSessionStatus: (callback: (status: AgentSessionLiveStatus) => void) => () => void;
  importPersonalLibrary: () => Promise<{ ok: boolean; count?: number; message?: string; error?: string }>;
  listMyVideos: () => Promise<MyVideo[]>;
  saveMyVideo: (submission: Partial<MyVideo>) => Promise<{ ok: boolean; id?: string; error?: string }>;
  deleteMyVideo: (id: string) => Promise<{ ok: boolean; error?: string }>;
  analyseMyVideo: (id: string) => Promise<{ ok: boolean; analysis?: MyVideoAnalysis; score?: number; error?: string }>;
};

export type MyVideoAnalysis = {
  transcript: string;
  onscreen_hook: string | null;
  video_structure: string;
  cta_timestamps: number[];
  hook_type: string | null;
  funnel_category: string | null;
  timeline: Array<{ timestamp: number; visual: string; audio: string; on_screen_text: string | null }>;
  pacing_notes: string;
  detailed_analysis: string;
  raw_json: string;
};

export type MyVideo = {
  id: string;
  url: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  watch_time_pct: number | null;
  sales: number | null;
  gmv: number | null;
  commission: number | null;
  audience_male_pct: number | null;
  audience_female_pct: number | null;
  audience_other_pct: number | null;
  upload_date: string;
  submitted_at: string;
  analysis: MyVideoAnalysis | null;
  analysis_status: "pending" | "analysing" | "complete" | "error";
  analysis_error: string;
  score: number | null;
  pending_hub_review?: boolean;
  created_at: string;
  updated_at: string;
};

declare global {
  interface Window {
    hub: HubApi;
  }
}

export {};
