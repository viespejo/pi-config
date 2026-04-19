import { AuthStorage } from "@mariozechner/pi-coding-agent";

interface GoogleQuotaBucket {
  modelId?: unknown;
  tokenType?: unknown;
  remainingFraction?: unknown;
  quotaId?: unknown;
  metric?: unknown;
  name?: unknown;
  period?: unknown;
  duration?: unknown;
  interval?: unknown;
  resetTime?: unknown;
  resetAt?: unknown;
  resetTimestamp?: unknown;
}

export interface Quota {
  name?: string;
  session: number;
  weekly: number;
  sessionResetsIn?: string;
  weeklyResetsIn?: string;
}

export interface ProviderUsage {
  provider: "Claude" | "Codex" | "Gemini";
  quotas: Quota[];
  error?: string;
}

export const GOOGLE_QUOTA_ENDPOINT = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
export const GOOGLE_LOAD_CODE_ASSIST_ENDPOINTS = [
  "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
];

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "request timeout";
    return error.message || String(error);
  }
  return String(error);
}

async function requestJson(url: string, init: RequestInit, timeoutMs = 12000): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      let detail = "";
      try {
        const text = await response.text();
        if (text) detail = `: ${text.slice(0, 180).replace(/\s+/g, " ").trim()}`;
      } catch {
        // ignore read errors
      }
      return { ok: false, error: `HTTP ${response.status}${detail}` };
    }

    try {
      const data = await response.json();
      return { ok: true, data };
    } catch {
      return { ok: false, error: "invalid JSON response" };
    }
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  } finally {
    clearTimeout(timeout);
  }
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0 && h > 0) return `${d}d ${h}h`;
  if (d > 0) return `${d}d`;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

export function formatResetsAt(isoDate: string, nowMs = Date.now()): string {
  const resetTime = new Date(isoDate).getTime();
  if (!Number.isFinite(resetTime)) return "";
  const diffSeconds = Math.max(0, (resetTime - nowMs) / 1000);
  return formatDuration(diffSeconds);
}

export function readPercentCandidate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value * 100;
  if (value >= 0 && value <= 100) return value;
  return null;
}

export async function fetchCodexUsage(token: string): Promise<ProviderUsage> {
  const result = await requestJson(
    "https://chatgpt.com/backend-api/wham/usage",
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (result.ok === false) {
    return { provider: "Codex", quotas: [], error: result.error };
  }

  const data = result.data as any;
  const primary = data?.rate_limit?.primary_window;
  const secondary = data?.rate_limit?.secondary_window;

  return {
    provider: "Codex",
    quotas: [{
      session: readPercentCandidate(primary?.used_percent) ?? 0,
      weekly: readPercentCandidate(secondary?.used_percent) ?? 0,
      sessionResetsIn: typeof primary?.reset_after_seconds === "number" ? formatDuration(primary.reset_after_seconds) : undefined,
      weeklyResetsIn: typeof secondary?.reset_after_seconds === "number" ? formatDuration(secondary.reset_after_seconds) : undefined,
    }]
  };
}

export async function fetchClaudeUsage(token: string): Promise<ProviderUsage> {
  const result = await requestJson(
    "https://api.anthropic.com/api/oauth/usage",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    }
  );

  if (result.ok === false) {
    return { provider: "Claude", quotas: [], error: result.error };
  }

  const data = result.data as any;
  return {
    provider: "Claude",
    quotas: [{
      session: readPercentCandidate(data?.five_hour?.utilization) ?? 0,
      weekly: readPercentCandidate(data?.seven_day?.utilization) ?? 0,
      sessionResetsIn: data?.five_hour?.resets_at ? formatResetsAt(data.five_hour.resets_at) : undefined,
      weeklyResetsIn: data?.seven_day?.resets_at ? formatResetsAt(data.seven_day.resets_at) : undefined,
    }]
  };
}

export function googleMetadata(projectId?: string) {
  return {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
    ...(projectId ? { duetProject: projectId } : {}),
  };
}

export function googleHeaders(token: string, projectId?: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "X-Goog-Api-Client": "gl-node/22.17.0",
    "Client-Metadata": JSON.stringify(googleMetadata(projectId)),
  };
}

export async function discoverGoogleProjectId(token: string): Promise<string | undefined> {
  for (const endpoint of GOOGLE_LOAD_CODE_ASSIST_ENDPOINTS) {
    const result = await requestJson(
      endpoint,
      {
        method: "POST",
        headers: googleHeaders(token),
        body: JSON.stringify({ metadata: googleMetadata() }),
      }
    );

    if (!result.ok) continue;

    const data = result.data as any;
    if (typeof data?.cloudaicompanionProject === "string" && data.cloudaicompanionProject) {
      return data.cloudaicompanionProject;
    }
    if (data?.cloudaicompanionProject && typeof data.cloudaicompanionProject === "object") {
      const id = data.cloudaicompanionProject.id;
      if (typeof id === "string" && id) return id;
    }
  }

  return undefined;
}

export function usedPercentFromRemainingFraction(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const remaining = Math.max(0, Math.min(1, value));
  return (1 - remaining) * 100;
}

function pickMostUsed(bucketSet: GoogleQuotaBucket[]): number | null {
  let best: number | null = null;
  for (const bucket of bucketSet) {
    const used = usedPercentFromRemainingFraction(bucket.remainingFraction);
    if (used == null) continue;
    if (best == null || used > best) best = used;
  }
  return best;
}

function bucketHints(bucket: GoogleQuotaBucket): string {
  return [
    bucket.quotaId,
    bucket.metric,
    bucket.name,
    bucket.period,
    bucket.duration,
    bucket.interval,
  ]
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase();
}

function inferReset(bucketSet: GoogleQuotaBucket[]): string | undefined {
  for (const b of bucketSet) {
    const resetIso = typeof b.resetTime === "string"
      ? b.resetTime
      : typeof b.resetAt === "string"
        ? b.resetAt
        : undefined;

    if (resetIso) {
      const formatted = formatResetsAt(resetIso);
      if (formatted) return formatted;
    }

    if (typeof b.resetTimestamp === "number" && Number.isFinite(b.resetTimestamp)) {
      const maybeMs = b.resetTimestamp > 10_000_000_000 ? b.resetTimestamp : b.resetTimestamp * 1000;
      const formatted = formatResetsAt(new Date(maybeMs).toISOString());
      if (formatted) return formatted;
    }
  }
  return undefined;
}

function modelQuotaFromBuckets(bucketSet: GoogleQuotaBucket[], name: string): Quota | null {
  if (!bucketSet.length) return null;

  const weeklyBuckets = bucketSet.filter((b) => /\b(week|weekly|7d|seven)\b/.test(bucketHints(b)));
  const sessionBuckets = bucketSet.filter((b) => /\b(hour|session|daily|day|24h|5h)\b/.test(bucketHints(b)));

  const session = pickMostUsed(sessionBuckets) ?? pickMostUsed(bucketSet);
  const weekly = pickMostUsed(weeklyBuckets) ?? pickMostUsed(bucketSet);

  if (session == null || weekly == null) return null;

  return {
    name,
    session,
    weekly,
    sessionResetsIn: inferReset(sessionBuckets) ?? inferReset(bucketSet),
    weeklyResetsIn: inferReset(weeklyBuckets),
  };
}

export async function fetchGoogleUsage(token: string, projectId?: string): Promise<ProviderUsage> {
  const discoveredProjectId = projectId || (await discoverGoogleProjectId(token));
  if (!discoveredProjectId) {
    return { provider: "Gemini", quotas: [], error: "missing projectId (try /login again)" };
  }

  const result = await requestJson(
    GOOGLE_QUOTA_ENDPOINT,
    {
      method: "POST",
      headers: googleHeaders(token, discoveredProjectId),
      body: JSON.stringify({ project: discoveredProjectId }),
    }
  );

  if (result.ok === false) {
    return { provider: "Gemini", quotas: [], error: result.error };
  }

  const data = result.data as { buckets?: GoogleQuotaBucket[] };
  const allBuckets = Array.isArray(data?.buckets) ? data.buckets : [];
  if (!allBuckets.length) return { provider: "Gemini", quotas: [], error: "no quota buckets found" };

  const requestBuckets = allBuckets.filter((b) => String(b?.tokenType || "").toUpperCase() === "REQUESTS");
  const buckets = requestBuckets.length ? requestBuckets : allBuckets;

  const modelId = (b: GoogleQuotaBucket) => String(b?.modelId || "").toLowerCase();
  const proBuckets = buckets.filter((b) => modelId(b).includes("pro"));
  const flashBuckets = buckets.filter((b) => modelId(b).includes("flash"));

  const quotas: Quota[] = [];
  const pro = modelQuotaFromBuckets(proBuckets, "Pro");
  const flash = modelQuotaFromBuckets(flashBuckets, "Flash");

  if (pro) quotas.push(pro);
  if (flash) quotas.push(flash);

  if (quotas.length === 0) {
    const fallback = modelQuotaFromBuckets(buckets, "Default");
    if (fallback) quotas.push(fallback);
  }

  if (quotas.length === 0) {
    return { provider: "Gemini", quotas: [], error: "unable to parse Gemini quota buckets" };
  }

  return { provider: "Gemini", quotas };
}

function credentialProjectId(credential: unknown): string | undefined {
  if (!credential || typeof credential !== "object") return undefined;
  const maybe = credential as { projectId?: unknown };
  return typeof maybe.projectId === "string" && maybe.projectId ? maybe.projectId : undefined;
}

function credentialAccessToken(credential: unknown): string | undefined {
  if (!credential || typeof credential !== "object") return undefined;
  const maybe = credential as { access?: unknown };
  return typeof maybe.access === "string" && maybe.access ? maybe.access : undefined;
}

export async function fetchAllUsages(): Promise<ProviderUsage[]> {
  const auth = AuthStorage.create();

  const providers: { id: string; name: "Claude" | "Codex" | "Gemini" }[] = [
    { id: "anthropic", name: "Claude" },
    { id: "openai-codex", name: "Codex" },
    { id: "google-gemini-cli", name: "Gemini" },
  ];

  const tasks = providers.map(async (p): Promise<ProviderUsage> => {
    try {
      const token = await auth.getApiKey(p.id);
      if (!token) return { provider: p.name, quotas: [], error: "not logged in" };

      if (p.id === "anthropic") return fetchClaudeUsage(token);
      if (p.id === "openai-codex") return fetchCodexUsage(token);

      const credential = auth.get(p.id);
      const projectId = credentialProjectId(credential);
      const usage = await fetchGoogleUsage(token, projectId);

      // Defensive fallback: if refreshed token fails but stored access still works,
      // retry once with raw credential access token.
      if (usage.error?.includes("HTTP 401")) {
        const fallbackToken = credentialAccessToken(credential);
        if (fallbackToken && fallbackToken !== token) {
          return fetchGoogleUsage(fallbackToken, projectId);
        }
      }

      return usage;
    } catch (err) {
      return { provider: p.name, quotas: [], error: toErrorMessage(err) };
    }
  });

  return Promise.all(tasks);
}
