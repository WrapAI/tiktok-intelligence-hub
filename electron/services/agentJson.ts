/** Parse JSON from managed-agent replies (markdown, prose, imperfect escaping). */

function repairJson(json: string): string {
  return json
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/,\s*([\]}])/g, "$1");
}

function extractBalancedSlice(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function extractVideosWrapper(text: string): string | null {
  const match = text.match(/"videos"\s*:\s*\[/i);
  if (!match || match.index === undefined) return null;

  const arrayStart = text.indexOf("[", match.index);
  if (arrayStart < 0) return null;

  const arraySlice = extractBalancedSlice(text.slice(arrayStart), "[", "]");
  if (!arraySlice) return null;

  return `{"videos":${arraySlice}}`;
}

function collectJsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates: string[] = [];

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }

  const videosWrapper = extractVideosWrapper(trimmed);
  if (videosWrapper) candidates.push(videosWrapper);

  const objectSlice = extractBalancedSlice(trimmed, "{", "}");
  if (objectSlice) candidates.push(objectSlice);

  const arraySlice = extractBalancedSlice(trimmed, "[", "]");
  if (arraySlice) candidates.push(arraySlice);

  candidates.push(trimmed);

  // Legacy: first { to last } (kept last — least reliable)
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }

  return [...new Set(candidates.filter(Boolean))];
}

function tryParse(candidate: string): unknown | null {
  for (const variant of [candidate, repairJson(candidate)]) {
    try {
      return JSON.parse(variant);
    } catch {
      /* try next */
    }
  }
  return null;
}

export function extractJsonFromAgentReply(text: string, label = "response"): unknown {
  if (!text?.trim()) {
    throw new Error(`Agent did not return valid JSON for the ${label}.`);
  }

  for (const candidate of collectJsonCandidates(text)) {
    const parsed = tryParse(candidate);
    if (parsed !== null) return parsed;
  }

  throw new Error(`Agent did not return valid JSON for the ${label}.`);
}

export function normalizeDailyPlanPayload(parsed: unknown): { videos: Array<Record<string, unknown>> } {
  if (Array.isArray(parsed)) {
    return { videos: parsed as Array<Record<string, unknown>> };
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Agent plan JSON must be an object with a videos array.");
  }

  const obj = parsed as Record<string, unknown>;

  if (Array.isArray(obj.videos)) {
    return { videos: obj.videos as Array<Record<string, unknown>> };
  }

  if (Array.isArray(obj.plan)) {
    return { videos: obj.plan as Array<Record<string, unknown>> };
  }

  if (obj.plan && typeof obj.plan === "object") {
    const plan = obj.plan as Record<string, unknown>;
    if (Array.isArray(plan.videos)) {
      return { videos: plan.videos as Array<Record<string, unknown>> };
    }
  }

  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>;
    if (Array.isArray(data.videos)) {
      return { videos: data.videos as Array<Record<string, unknown>> };
    }
  }

  // Single video returned as one object
  if (obj.fullAudioScript || obj.productName || obj.funnel) {
    return { videos: [obj] };
  }

  throw new Error("Agent plan JSON is missing a videos array.");
}

export function parseDailyPlanAgentReply(text: string): { videos: Array<Record<string, unknown>> } {
  const parsed = extractJsonFromAgentReply(text, "daily plan");
  return normalizeDailyPlanPayload(parsed);
}

export function hasParseableJson(text: string): boolean {
  try {
    extractJsonFromAgentReply(text);
    return true;
  } catch {
    return false;
  }
}

export function hasParseablePlanJson(text: string): boolean {
  try {
    parseDailyPlanAgentReply(text);
    return true;
  } catch {
    return false;
  }
}
