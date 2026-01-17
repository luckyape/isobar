/**
 * Closet Dashboard Page — Local offline corpus health, coverage, and signals
 * 
 * Implements a layered depth model for progressive disclosure:
 * - Layer 0: Human-readable assertions
 * - Layer 1: Inline explanations ("Why?")
 * - Layer 2: Detailed data view
 * - Layer 3: Full JSON export
 * 
 * No destructive actions; ops are in /ops/closet.
 */

import { useEffect, useMemo, useState, useCallback, useSyncExternalStore } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Braces, Copy, ExternalLink, RefreshCw, Database, Archive, AlertTriangle, X } from "lucide-react";

import { computeOpsSnapshot, getDefaultClosetPolicy, isTrustedMode, type OpsConfig, type OpsSnapshot } from "@/lib/closet/ops";
import { getClosetDB, type ForecastIndexEntry, type ObservationIndexEntry } from "@/lib/closet";
import { ClosetSection, TrustSection, ActivitySection, TimelineSection, LastObservationSection, type TrustData, type ActivityData, type TimelineData, type TimelineBin } from "@/components/closet";
import { useClosetUrlState, toggleSection } from "@/hooks/useClosetUrlState";
import { subscribeToLocationChanges, getLocationSnapshot } from "@/lib/locationStore";
import { getLatestObservation, type ObservationData } from "@/lib/observations/observations";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

type ExportLevel = "summary" | "full";
type Platform = "web" | "ios" | "android";

type ClosetDashboardSnapshot = {
  version: "closet_dashboard_v1";
  generatedAt: string;
  exportLevel: ExportLevel;
  environment: {
    platform: Platform;
    client_version: string;
    storage_quota_tier: "unknown" | "low" | "medium" | "high";
    storage_estimate: { quotaBytes: number | null; usageBytes: number | null };
  };
  privacy: {
    redactionApplied: boolean;
  };
  config: OpsConfig;
  ops: OpsSnapshot;
  derived: {
    inflightCount: number;
    obsIndexCount: number;
    forecastIndexCount: number;
    observationSources: Array<{ key: string; count: number }>;
    forecastModels: Array<{ key: string; count: number }>;
    newestObservationBucket: string | null;
    newestObservationAgeMs: number | null;
    newestForecastRunTime: string | null;
    latestObservation: ObservationData | null;
  };
  // New fields for layered depth model
  trust: TrustData;
  activity: ActivityData;
  timeline: TimelineData;
  lastObservation: string;
  assertions: {
    coverage: string;
    storage: string;
    activity: string;
    trust: string;
    timeline: string;
    lastObservation: string; // Added to match assertions object structure usage
  };
  raw?: {
    observationIndexEntries: ObservationIndexEntry[];
    forecastIndexEntries: ForecastIndexEntry[];
    inflight: Array<{ hash: string; startedAtMs: number }>;
  };
};

// =============================================================================
// Helpers
// =============================================================================

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatAgeFromMs(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "—";
  const totalMinutes = Math.floor(ageMs / 60000);
  if (totalMinutes < 1) return "just now";
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h ago`;
  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays}d ago`;
}

function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Never";
  return new Date(timestamp).toLocaleString();
}

function shortHash(hash: string): string {
  if (!hash) return "—";
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function safeJsonStringify(value: unknown, indent = 2): string {
  try {
    return JSON.stringify(value, null, indent);
  } catch (err) {
    return JSON.stringify({ error: "JSON_STRINGIFY_FAILED", detail: String(err) }, null, 2);
  }
}

function clampList<T>(items: T[], limit: number): T[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (safeLimit === 0) return [];
  return items.length <= safeLimit ? items : items.slice(0, safeLimit);
}

function computeHistogram<T>(items: T[], toKey: (item: T) => string): Array<{ key: string; count: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = toKey(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

function computeMinuteKey(isoLike: string): string | null {
  if (typeof isoLike !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(isoLike)) return isoLike;
  const m = isoLike.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return m?.[1] ?? null;
}

function parseMinuteKeyUtc(minuteKey: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(minuteKey)) return null;
  const ms = Date.parse(`${minuteKey}:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function detectPlatform(): Platform {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent ?? "" : "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  return "web";
}

async function getStorageEstimate(): Promise<{ quotaBytes: number | null; usageBytes: number | null }> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    const quotaBytes = typeof estimate?.quota === "number" ? estimate.quota : null;
    const usageBytes = typeof estimate?.usage === "number" ? estimate.usage : null;
    return { quotaBytes, usageBytes };
  } catch {
    return { quotaBytes: null, usageBytes: null };
  }
}

function computeStorageQuotaTier(quotaBytes: number | null): "unknown" | "low" | "medium" | "high" {
  if (!Number.isFinite(quotaBytes ?? NaN)) return "unknown";
  if ((quotaBytes as number) < 250 * 1024 * 1024) return "low";
  if ((quotaBytes as number) < 2 * 1024 * 1024 * 1024) return "medium";
  return "high";
}

function nowIso(): string {
  return new Date().toISOString();
}

function isSensitiveKeyName(key: string): boolean {
  const k = key.toLowerCase();
  if (k.includes("public")) return false;
  if (k.includes("pubkey")) return false;
  return (
    k.includes("authorization") ||
    k.includes("cookie") ||
    k.includes("token") ||
    k.includes("secret") ||
    k.includes("password") ||
    k.includes("apikey") ||
    k.includes("api_key") ||
    k.includes("openai_api_key") ||
    k.includes("bearer")
  );
}

function sanitizeObject(value: unknown): { value: unknown; redacted: boolean } {
  if (!value || typeof value !== "object") return { value, redacted: false };
  if (Array.isArray(value)) return { value, redacted: false };

  let redacted = false;
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKeyName(k)) {
      out[k] = "[REDACTED]";
      redacted = true;
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = sanitizeObject(v);
      out[k] = nested.value;
      redacted = redacted || nested.redacted;
    } else {
      out[k] = v;
    }
  }

  return { value: out, redacted };
}

// =============================================================================
// Assertion Generators
// =============================================================================

function computeCoverageAssertion(
  obsCount: number,
  forecastCount: number,
  newestObsAgeMs: number | null
): string {
  if (obsCount === 0 && forecastCount === 0) return "No data stored yet";
  if (obsCount === 0) return "Observations missing";
  if (forecastCount === 0) return "Forecasts missing";

  // Check freshness (data older than 6 hours is stale)
  if (newestObsAgeMs !== null && newestObsAgeMs > 6 * 60 * 60 * 1000) {
    return "Coverage is stale";
  }

  return "You're covered";
}

function computeStorageAssertion(
  usedBytes: number,
  quotaBytes: number,
  headroomBytes: number
): string {
  if (usedBytes === 0) return "Storage empty";

  const usageRatio = usedBytes / quotaBytes;
  if (usageRatio > 0.9) return "Near quota limit";
  if (usageRatio > 0.7) return "Running low on space";
  if (headroomBytes < 50 * 1024 * 1024) return "Limited headroom";

  return "Storage is healthy";
}

function computeTrustData(config: OpsConfig): TrustData {
  const isTrusted = isTrustedMode(config);

  let whyNotTrusted: string | null = null;
  if (!isTrusted) {
    if (config.trustMode !== "trusted") {
      whyNotTrusted = "Trust mode is set to 'unverified'. Switch to 'trusted' mode to enable destructive operations.";
    } else if (!config.expectedManifestPubKeyHex) {
      whyNotTrusted = "No expected manifest public key configured. Provide a pubkey to verify manifest signatures.";
    }
  }

  return {
    mode: config.trustMode,
    isTrusted,
    whyNotTrusted,
    manifestSignatureStatus: "unchecked", // Could be derived from verification receipts
    destructiveOpsEnabled: isTrusted,
    expectedPubKeyHex: config.expectedManifestPubKeyHex
  };
}

function computeActivityData(
  inflight: Array<{ hash: string; startedAtMs: number }>,
  lastGcAt: number
): ActivityData {
  const nowMs = Date.now();
  return {
    inflightDownloads: inflight.map((item) => ({
      ...item,
      ageMs: Math.max(0, nowMs - item.startedAtMs)
    })),
    lastGcAt,
    lastGcAgeMs: lastGcAt > 0 ? Math.max(0, nowMs - lastGcAt) : 0
  };
}

function computeTimelineData(
  obsEntries: ObservationIndexEntry[],
  forecastEntries: ForecastIndexEntry[]
): TimelineData {
  const nowMs = Date.now();
  // Default lookback: 24h or up to 7 days if data is older
  // Let's scan data to find min/max
  let minMs = nowMs - 24 * 60 * 60 * 1000;
  let maxMs = nowMs;

  const obsTimes = obsEntries
    .map(e => parseMinuteKeyUtc(e.observedAtBucket))
    .filter((ms): ms is number => ms !== null);

  const forecastTimes = forecastEntries
    .map(e => {
      // forecast runTime is usually ISO
      const ms = Date.parse(e.runTime);
      return Number.isFinite(ms) ? ms : null;
    })
    .filter((ms): ms is number => ms !== null);

  const allTimes = [...obsTimes, ...forecastTimes];
  if (allTimes.length > 0) {
    minMs = Math.min(...allTimes);
    maxMs = Math.max(...allTimes);
  }

  // Cap lookback at 30 days to avoid huge timelines for stale data
  const limitMs = nowMs - 30 * 24 * 60 * 60 * 1000;
  if (minMs < limitMs) minMs = limitMs;

  // Pad the future slightly if maxMs is close to now
  if (maxMs < nowMs) maxMs = nowMs;

  // Determine bucket size
  const rangeMs = maxMs - minMs;
  const targetBins = 50;
  let bucketSizeMs = Math.ceil(rangeMs / targetBins);

  // Round bucket size to nice intervals (10m, 1h, 6h, 1d)
  const hour = 60 * 60 * 1000;
  if (bucketSizeMs < hour) bucketSizeMs = hour;
  else if (bucketSizeMs < 6 * hour) bucketSizeMs = 6 * hour;
  else if (bucketSizeMs < 24 * hour) bucketSizeMs = 24 * hour;
  else bucketSizeMs = 24 * hour;

  // Align minMs to bucket start
  minMs = Math.floor(minMs / bucketSizeMs) * bucketSizeMs;
  maxMs = Math.ceil(maxMs / bucketSizeMs) * bucketSizeMs;

  const bins: TimelineBin[] = [];
  for (let t = minMs; t < maxMs; t += bucketSizeMs) {
    bins.push({ timeMs: t, obsCount: 0, forecastCount: 0 });
  }

  // Fill bins
  for (const t of obsTimes) {
    if (t < minMs || t >= maxMs) continue; // Out of range (probably older than 30d)
    const binIdx = Math.floor((t - minMs) / bucketSizeMs);
    if (bins[binIdx]) bins[binIdx].obsCount++;
  }

  for (const t of forecastTimes) {
    if (t < minMs || t >= maxMs) continue;
    const binIdx = Math.floor((t - minMs) / bucketSizeMs);
    if (bins[binIdx]) bins[binIdx].forecastCount++;
  }

  return {
    bins: bins,
    startMs: minMs,
    endMs: maxMs,
    bucketSizeMs
  };
}

// =============================================================================
// Snapshot Computation
// =============================================================================

async function computeClosetDashboardSnapshot(
  config: OpsConfig,
  exportLevel: ExportLevel,
  primaryLat: number | null,
  primaryLon: number | null,
  options?: { listLimit?: number }
): Promise<ClosetDashboardSnapshot> {
  const closetDB = getClosetDB();
  await closetDB.open();

  const [ops, obsIndexAll, forecastIndexAll, inflight, storageEstimate, latestObservation] = await Promise.all([
    computeOpsSnapshot(config),
    closetDB.getAllObservationIndexEntries(),
    closetDB.getAllForecastIndexEntries(),
    closetDB.getAllInflight(),
    getStorageEstimate(),
    (primaryLat !== null && primaryLon !== null)
      ? getLatestObservation(primaryLat, primaryLon)
      : Promise.resolve(null)
  ]);

  const obsIndexCount = obsIndexAll.length;
  const forecastIndexCount = forecastIndexAll.length;

  const newestObservationBucket =
    obsIndexAll
      .map((e) => computeMinuteKey(e.observedAtBucket))
      .filter((s): s is string => typeof s === "string")
      .sort()
      .at(-1) ?? null;

  const newestObservationBucketMs = newestObservationBucket ? parseMinuteKeyUtc(newestObservationBucket) : null;
  const newestObservationAgeMs =
    typeof newestObservationBucketMs === "number" ? Math.max(0, Date.now() - newestObservationBucketMs) : null;

  const newestForecastRunTime =
    forecastIndexAll
      .map((e) => e.runTime)
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .sort()
      .at(-1) ?? null;

  const observationSources = computeHistogram(obsIndexAll, (e) => e.source).slice(0, 12);
  const forecastModels = computeHistogram(forecastIndexAll, (e) => e.model).slice(0, 12);

  const sanitizedConfig = sanitizeObject(config);
  const clientVersion = import.meta.env.VITE_APP_VERSION ?? (import.meta.env.DEV ? "dev" : "unknown");
  const platform = detectPlatform();
  const storageQuotaTier = computeStorageQuotaTier(storageEstimate.quotaBytes);

  // Compute new structured data
  const trust = computeTrustData(config);
  const activity = computeActivityData(inflight, ops.lastGcAt);
  const timeline = computeTimelineData(obsIndexAll, forecastIndexAll);

  // Compute Layer 0 assertions
  const assertions = {
    coverage: computeCoverageAssertion(obsIndexCount, forecastIndexCount, newestObservationAgeMs),
    storage: computeStorageAssertion(ops.totalBytesPresent, ops.quotaBytes, ops.headroomBytes),
    activity: activity.inflightDownloads.length > 0
      ? `Syncing ${activity.inflightDownloads.length} item${activity.inflightDownloads.length === 1 ? "" : "s"}`
      : ops.lastGcAt > 0
        ? `Last sync ${formatAgeFromMs(activity.lastGcAgeMs)}`
        : "All quiet",
    trust: trust.isTrusted ? "Verified and trusted" : "Unverified mode",
    timeline: timeline.bins.length > 0
      ? (timeline.bins.some(b => b.obsCount > 0) ? "Data collected" : "No recent data")
      : "Empty timeline",
    lastObservation: latestObservation ? "Fresh data available" : "No recent data"
  };

  const snapshot: ClosetDashboardSnapshot = {
    version: "closet_dashboard_v1",
    generatedAt: nowIso(),
    exportLevel,
    environment: {
      platform,
      client_version: String(clientVersion),
      storage_quota_tier: storageQuotaTier,
      storage_estimate: storageEstimate
    },
    privacy: { redactionApplied: sanitizedConfig.redacted },
    config: sanitizedConfig.value as OpsConfig,
    ops,
    derived: {
      inflightCount: inflight.length,
      obsIndexCount,
      forecastIndexCount,
      observationSources,
      forecastModels,
      newestObservationBucket,
      newestObservationAgeMs,
      newestForecastRunTime,
      latestObservation
    },
    trust,
    activity,
    timeline,
    lastObservation: assertions.lastObservation,
    assertions
  };

  if (exportLevel === "full") {
    const listLimit = options?.listLimit ?? 5000;
    snapshot.raw = {
      observationIndexEntries: clampList(obsIndexAll, listLimit),
      forecastIndexEntries: clampList(forecastIndexAll, listLimit),
      inflight: clampList(inflight, 2000)
    };
  }

  return snapshot;
}

// =============================================================================
// Section Status Derivers
// =============================================================================

function getCoverageStatus(snapshot: ClosetDashboardSnapshot): "healthy" | "warning" | "error" | "neutral" {
  const { obsIndexCount, forecastIndexCount, newestObservationAgeMs } = snapshot.derived;
  if (obsIndexCount === 0 && forecastIndexCount === 0) return "neutral";
  if (obsIndexCount === 0 || forecastIndexCount === 0) return "warning";
  if (newestObservationAgeMs !== null && newestObservationAgeMs > 6 * 60 * 60 * 1000) return "warning";
  return "healthy";
}

function getStorageStatus(snapshot: ClosetDashboardSnapshot): "healthy" | "warning" | "error" | "neutral" {
  const { totalBytesPresent, quotaBytes, headroomBytes } = snapshot.ops;
  if (totalBytesPresent === 0) return "neutral";
  const ratio = totalBytesPresent / quotaBytes;
  if (ratio > 0.9) return "error";
  if (ratio > 0.7 || headroomBytes < 50 * 1024 * 1024) return "warning";
  return "healthy";
}

// =============================================================================
// Component
// =============================================================================

export default function ClosetDashboardPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonDrawerOpen, setJsonDrawerOpen] = useState(false);

  const [config, setConfig] = useState<OpsConfig>({
    trustMode: "unverified",
    expectedManifestPubKeyHex: undefined,
    policy: getDefaultClosetPolicy()
  });

  const [exportLevel, setExportLevel] = useState<ExportLevel>("full");
  const [listLimit, setListLimit] = useState(5000);
  const [snapshot, setSnapshot] = useState<ClosetDashboardSnapshot | null>(null);

  // URL state for section expansion
  const [urlState, setUrlState] = useClosetUrlState();

  const isTrusted = isTrustedMode(config);

  // Subscribe to location store
  const { primaryLocation } = useSyncExternalStore(subscribeToLocationChanges, getLocationSnapshot);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const lat = primaryLocation?.latitude ?? null;
      const lon = primaryLocation?.longitude ?? null;
      const next = await computeClosetDashboardSnapshot(config, exportLevel, lat, lon, { listLimit });
      setSnapshot(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [config, exportLevel, listLimit, primaryLocation?.latitude, primaryLocation?.longitude]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Sync JSON drawer with URL state
  useEffect(() => {
    if (urlState.jsonOpen !== jsonDrawerOpen) {
      setJsonDrawerOpen(urlState.jsonOpen);
    }
  }, [urlState.jsonOpen, jsonDrawerOpen]);

  const assistantJson = useMemo(() => (snapshot ? safeJsonStringify(snapshot, 2) : ""), [snapshot]);
  const assistantJsonBytes = useMemo(() => new TextEncoder().encode(assistantJson).length, [assistantJson]);
  const isLargeExport = assistantJsonBytes > 1024 * 1024; // > 1MB

  const copyAssistantJson = async () => {
    try {
      await navigator.clipboard.writeText(assistantJson);
      toast.success(`Copied assistant JSON (${formatBytes(assistantJsonBytes)})`);
    } catch (err) {
      toast.error(`Copy failed: ${String(err)}`);
    }
  };

  const toggleJsonDrawer = () => {
    const newState = !jsonDrawerOpen;
    setJsonDrawerOpen(newState);
    setUrlState({ jsonOpen: newState });
  };

  const handleSectionToggle = (sectionId: string) => (expanded: boolean) => {
    const next = new Set(urlState.expandedSections);
    if (expanded) {
      next.add(sectionId);
    } else {
      next.delete(sectionId);
    }
    setUrlState({ expandedSections: next });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">Closet</h1>
                <Badge variant={isTrusted ? "default" : "secondary"}>
                  {isTrusted ? "Trusted" : "Unverified"}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Your local offline data for <span className="font-medium text-foreground">{primaryLocation?.name ?? "Unknown Location"}</span> — what's stored, what's fresh, and what's working for you.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={refresh} disabled={loading} size="sm" className="gap-2">
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                {loading ? "Refreshing…" : "Refresh"}
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={toggleJsonDrawer}>
                <Braces className="h-4 w-4" />
                Export JSON
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={() => window.open("/ops/closet", "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="h-4 w-4" />
                Ops
              </Button>
            </div>
          </div>
          {error && (
            <div className="mt-3 flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="px-6 py-8">
        <div className="mx-auto max-w-6xl">
          {!snapshot ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5 animate-pulse" />
                  Loading Closet…
                </CardTitle>
                <CardDescription>Building snapshot of your local data.</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Coverage Section */}
              <ClosetSection
                id="coverage"
                title="Coverage"
                assertion={snapshot.assertions.coverage}
                status={getCoverageStatus(snapshot)}
                isExpanded={urlState.expandedSections.has("coverage")}
                onExpandChange={handleSectionToggle("coverage")}
                compactContent={
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{snapshot.derived.obsIndexCount} observations</span>
                    <span>{snapshot.derived.forecastIndexCount} forecasts</span>
                  </div>
                }
              >
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-muted-foreground mb-1">Observation Index</div>
                      <div className="text-lg font-mono">{snapshot.derived.obsIndexCount}</div>
                      <div className="text-xs text-muted-foreground">
                        Newest: {snapshot.derived.newestObservationBucket ?? "—"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Age: {snapshot.derived.newestObservationAgeMs !== null
                          ? formatAgeFromMs(snapshot.derived.newestObservationAgeMs)
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">Forecast Index</div>
                      <div className="text-lg font-mono">{snapshot.derived.forecastIndexCount}</div>
                      <div className="text-xs text-muted-foreground">
                        Newest run: {snapshot.derived.newestForecastRunTime ?? "—"}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-md bg-secondary/30">
                    <div className="text-xs text-muted-foreground mb-1">
                      Freshness threshold: Data older than 6 hours is considered stale.
                    </div>
                  </div>

                  {snapshot.derived.observationSources.length > 0 && (
                    <div>
                      <div className="text-muted-foreground mb-2">Top sources</div>
                      <div className="space-y-1">
                        {snapshot.derived.observationSources.slice(0, 4).map((s) => (
                          <div key={s.key} className="flex justify-between text-xs">
                            <span className="font-mono">{s.key}</span>
                            <span className="text-muted-foreground">{s.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ClosetSection>

              {/* Storage Section */}
              <ClosetSection
                id="storage"
                title="Storage"
                assertion={snapshot.assertions.storage}
                status={getStorageStatus(snapshot)}
                isExpanded={urlState.expandedSections.has("storage")}
                onExpandChange={handleSectionToggle("storage")}
                compactContent={
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-mono">{formatBytes(snapshot.ops.totalBytesPresent)}</span>
                      <span className="text-muted-foreground">of {formatBytes(snapshot.ops.quotaBytes)}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{
                          width: `${Math.min(100, (snapshot.ops.totalBytesPresent / snapshot.ops.quotaBytes) * 100)}%`
                        }}
                      />
                    </div>
                  </div>
                }
              >
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-muted-foreground mb-1">Blobs</div>
                      <div className="text-lg font-mono">{snapshot.ops.presentBlobsCount}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">Pinned</div>
                      <div className="text-lg font-mono">{snapshot.ops.pinnedBlobsCount}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">Headroom</div>
                      <div className="text-lg font-mono">{formatBytes(snapshot.ops.headroomBytes)}</div>
                    </div>
                  </div>

                  <div className="p-3 rounded-md bg-secondary/30">
                    <div className="text-xs text-muted-foreground">
                      Quota tier: <span className="font-mono">{snapshot.environment.storage_quota_tier}</span>.
                      {" "}Healthy threshold: &lt;70% usage with &gt;50MB headroom.
                    </div>
                  </div>

                  {snapshot.ops.topBlobsBySize.length > 0 && (
                    <div>
                      <div className="text-muted-foreground mb-2">Largest blobs</div>
                      <div className="space-y-1">
                        {snapshot.ops.topBlobsBySize.slice(0, 4).map((b) => (
                          <div key={b.hash} className="flex justify-between text-xs">
                            <span className="font-mono">{shortHash(b.hash)}</span>
                            <span className="text-muted-foreground">{formatBytes(b.sizeBytes)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ClosetSection>

              {/* Activity Section */}
              <ActivitySection
                data={snapshot.activity}
                isExpanded={urlState.expandedSections.has("activity")}
                onExpandChange={handleSectionToggle("activity")}
              />

              {/* Trust Section */}
              <TrustSection
                data={snapshot.trust}
                isExpanded={urlState.expandedSections.has("trust")}
                onExpandChange={handleSectionToggle("trust")}
              />

              {/* Last Observation Section */}
              <LastObservationSection
                data={snapshot.derived.latestObservation}
                isExpanded={urlState.expandedSections.has("last-observation")}
                onExpandChange={handleSectionToggle("last-observation")}
              />

              {/* Timeline Section */}
              <TimelineSection
                data={snapshot.timeline}
                isExpanded={urlState.expandedSections.has("timeline")}
                onExpandChange={handleSectionToggle("timeline")}
              />
            </div>
          )}
        </div>
      </div>

      {/* JSON Drawer (Layer 3) */}
      {jsonDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={toggleJsonDrawer}>
          <div
            className="fixed right-0 top-0 h-full w-full max-w-3xl border-l bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b px-6 py-4">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Braces className="h-5 w-5" />
                    Assistant JSON Export
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Copy/paste into a support thread
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={toggleJsonDrawer}>
                  <X className="h-5 w-5" />
                  <span className="sr-only">Close</span>
                </Button>
              </div>

              <div className="border-b px-6 py-3">
                {isLargeExport && (
                  <div className="mb-3 flex items-center gap-2 text-sm text-amber-500">
                    <AlertTriangle className="h-4 w-4" />
                    Export is large ({formatBytes(assistantJsonBytes)}). Consider using Summary mode.
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="exportLevel" className="text-sm">Mode</Label>
                    <select
                      id="exportLevel"
                      className="rounded-md border bg-transparent px-2 py-1 text-sm"
                      value={exportLevel}
                      onChange={(e) => setExportLevel(e.target.value as ExportLevel)}
                    >
                      <option value="full">Full</option>
                      <option value="summary">Summary</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="listLimit" className="text-sm">List limit</Label>
                    <Input
                      id="listLimit"
                      type="number"
                      inputMode="numeric"
                      className="w-24 h-8 text-sm"
                      value={listLimit}
                      min={0}
                      max={50000}
                      onChange={(e) => setListLimit(Number(e.target.value))}
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                    <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
                    Rebuild
                  </Button>
                  <Button size="sm" onClick={copyAssistantJson} disabled={!assistantJson}>
                    <Copy className="h-4 w-4 mr-1" />
                    Copy ({formatBytes(assistantJsonBytes)})
                  </Button>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Privacy: sensitive keys are redacted. Public keys are included.
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-6">
                  <Textarea
                    readOnly
                    value={assistantJson}
                    className="min-h-[600px] font-mono text-xs"
                  />
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
