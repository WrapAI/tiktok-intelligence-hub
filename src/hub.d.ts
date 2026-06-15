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

export type Product = {
  id: string;
  name: string;
  brand?: string;
  price?: string;
  description?: string;
  image_url?: string;
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

export type HubApi = {
  getBootstrap: () => Promise<{ dataFolder: string }>;
  checkWhisper: () => Promise<boolean>;
  getSettings: () => Promise<{
    anthropicApiKey: string;
    elevenLabsApiKey: string;
    elevenLabsVoiceId: string;
    myTiktokHandle: string;
    dataFolder: string;
  }>;
  saveSettings: (settings: Record<string, string>) => Promise<{ ok: boolean }>;
  getDashboard: () => Promise<{
    libraryCount: number;
    memoryCount: number;
    productCount: number;
    scriptCount: number;
    summary: MemorySummary;
    latestStudioSync: string | null;
    latestCompassSync: string | null;
    dataFolder: string;
  }>;
  listProducts: () => Promise<Product[]>;
  saveProduct: (product: Record<string, string>) => Promise<{ ok: boolean; id: string }>;
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
  }) => Promise<{ ok: boolean; result?: ScriptResult; error?: string }>;
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
  requestSync: (type: "ALL" | "STUDIO" | "COMPASS") => Promise<{ ok: boolean; message?: string; error?: string }>;
  getPlannerSummary: () => Promise<PlannerSummary>;
  getMaxDailyPosts: () => Promise<number>;
  importSalesFile: () => Promise<{ ok: boolean; canceled?: boolean; count?: number; file?: string; error?: string }>;
  generateDailyPlan: (req: {
    planDate?: string;
    limits: FunnelLimits;
    selectedProductNames?: string[];
  }) => Promise<{ ok: boolean; plan?: DailyPlan; error?: string }>;
  listDailyPlans: () => Promise<Array<{ id: string; planDate: string; totalVideos: number; createdAt: string }>>;
  getDailyPlan: (id: string) => Promise<DailyPlan | null>;
};

declare global {
  interface Window {
    hub: HubApi;
  }
}

export {};
