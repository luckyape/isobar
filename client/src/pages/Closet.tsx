import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Braces, Copy, ExternalLink, RefreshCw } from "lucide-react";

import { computeOpsSnapshot, getDefaultClosetPolicy, isTrustedMode, type OpsConfig, type OpsSnapshot } from "@/lib/closet/ops";
import { getClosetDB, type ForecastIndexEntry, type ObservationIndexEntry } from "@/lib/closet";

type ExportLevel = "summary" | "full";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
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
  // Supported shapes:
  // - "YYYY-MM-DDTHH:mm" (preferred)
  // - "YYYY-MM-DDTHH:mm:ssZ" (fallback)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(isoLike)) return isoLike;
  const m = isoLike.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return m?.[1] ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

type ClosetDashboardSnapshot = {
  version: "closet_dashboard_v1";
  generatedAt: string;
  exportLevel: ExportLevel;
  config: OpsConfig;
  ops: OpsSnapshot;
  derived: {
    inflightCount: number;
    obsIndexCount: number;
    forecastIndexCount: number;
    observationSources: Array<{ key: string; count: number }>;
    forecastModels: Array<{ key: string; count: number }>;
    newestObservationBucket: string | null;
    newestForecastRunTime: string | null;
  };
  raw?: {
    observationIndexEntries: ObservationIndexEntry[];
    forecastIndexEntries: ForecastIndexEntry[];
    inflight: Array<{ hash: string; startedAtMs: number }>;
  };
};

async function computeClosetDashboardSnapshot(
  config: OpsConfig,
  exportLevel: ExportLevel,
  options?: { listLimit?: number }
): Promise<ClosetDashboardSnapshot> {
  const closetDB = getClosetDB();
  await closetDB.open();

  const [ops, obsIndexAll, forecastIndexAll, inflight] = await Promise.all([
    computeOpsSnapshot(config),
    closetDB.getAllObservationIndexEntries(),
    closetDB.getAllForecastIndexEntries(),
    closetDB.getAllInflight()
  ]);

  const obsIndexCount = obsIndexAll.length;
  const forecastIndexCount = forecastIndexAll.length;

  const newestObservationBucket =
    obsIndexAll
      .map((e) => computeMinuteKey(e.observedAtBucket))
      .filter((s): s is string => typeof s === "string")
      .sort()
      .at(-1) ?? null;

  const newestForecastRunTime =
    forecastIndexAll
      .map((e) => e.runTime)
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .sort()
      .at(-1) ?? null;

  const observationSources = computeHistogram(obsIndexAll, (e) => e.source).slice(0, 12);
  const forecastModels = computeHistogram(forecastIndexAll, (e) => e.model).slice(0, 12);

  const snapshot: ClosetDashboardSnapshot = {
    version: "closet_dashboard_v1",
    generatedAt: nowIso(),
    exportLevel,
    config,
    ops,
    derived: {
      inflightCount: inflight.length,
      obsIndexCount,
      forecastIndexCount,
      observationSources,
      forecastModels,
      newestObservationBucket,
      newestForecastRunTime
    }
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

export default function ClosetDashboardPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [config, setConfig] = useState<OpsConfig>({
    trustMode: "unverified",
    expectedManifestPubKeyHex: undefined,
    policy: getDefaultClosetPolicy()
  });

  const [exportLevel, setExportLevel] = useState<ExportLevel>("full");
  const [listLimit, setListLimit] = useState(5000);
  const [snapshot, setSnapshot] = useState<ClosetDashboardSnapshot | null>(null);

  const isTrusted = isTrustedMode(config);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await computeClosetDashboardSnapshot(config, exportLevel, { listLimit });
      setSnapshot(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assistantJson = useMemo(() => (snapshot ? safeJsonStringify(snapshot, 2) : ""), [snapshot]);
  const assistantJsonBytes = useMemo(() => new TextEncoder().encode(assistantJson).length, [assistantJson]);

  const copyAssistantJson = async () => {
    try {
      await navigator.clipboard.writeText(assistantJson);
      toast.success(`Copied assistant JSON (${formatBytes(assistantJsonBytes)})`);
    } catch (err) {
      toast.error(`Copy failed: ${String(err)}`);
    }
  };

  return (
    <div className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-2 flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">Closet</h1>
            <Badge variant={isTrusted ? "default" : "secondary"}>{isTrusted ? "Trusted" : "Unverified"}</Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Local offline corpus health, coverage, and retention signals — with a copy/paste JSON export for assistants.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={refresh} disabled={loading} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => window.open("/ops/closet", "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-4 w-4" />
              Open Ops
            </Button>
          </div>
          {error && <div className="mt-3 text-sm text-destructive">{error}</div>}
        </div>

        {!snapshot ? (
          <Card>
            <CardHeader>
              <CardTitle>Loading…</CardTitle>
              <CardDescription>Building Closet snapshot.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Storage</CardTitle>
                  <CardDescription>Bytes present vs quota</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{formatBytes(snapshot.ops.totalBytesPresent)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {snapshot.ops.presentBlobsCount} blobs • {snapshot.ops.pinnedBlobsCount} pinned •{" "}
                    {snapshot.derived.inflightCount} inflight
                  </div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width: `${Math.min(100, (snapshot.ops.totalBytesPresent / snapshot.ops.quotaBytes) * 100)}%`
                      }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Quota {formatBytes(snapshot.ops.quotaBytes)} • Headroom {formatBytes(snapshot.ops.headroomBytes)}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Coverage</CardTitle>
                  <CardDescription>Indexed local signal</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-2xl font-semibold">{snapshot.derived.obsIndexCount}</div>
                      <div className="text-xs text-muted-foreground">Obs index entries</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold">{snapshot.derived.forecastIndexCount}</div>
                      <div className="text-xs text-muted-foreground">Forecast index entries</div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    Newest obs bucket: <span className="font-mono">{snapshot.derived.newestObservationBucket ?? "—"}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Newest forecast run: <span className="font-mono">{snapshot.derived.newestForecastRunTime ?? "—"}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Retention</CardTitle>
                  <CardDescription>Discovery window + GC cadence</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{snapshot.ops.manifestsInWindowCount}</div>
                  <div className="text-xs text-muted-foreground">
                    manifests in window • {snapshot.ops.manifestRefsCount} total refs
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    Window {snapshot.ops.policy.windowDays}d • Obs {snapshot.ops.policy.keepObservationDays}d • Forecast{" "}
                    {snapshot.ops.policy.keepForecastRunsDays}d
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Last GC: {formatDate(snapshot.ops.lastGcAt)}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Tabs defaultValue="dashboard" className="space-y-4">
              <TabsList>
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                <TabsTrigger value="assistant">Assistant JSON</TabsTrigger>
                <TabsTrigger value="config">Config</TabsTrigger>
              </TabsList>

              <TabsContent value="dashboard" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Signals</CardTitle>
                    <CardDescription>Quick read of what’s piling up locally.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                      <div className="mb-2 text-sm font-medium">Top observation sources</div>
                      <div className="space-y-2">
                        {snapshot.derived.observationSources.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No observation index entries yet.</div>
                        ) : (
                          snapshot.derived.observationSources.map((row) => (
                            <div key={row.key} className="flex items-center justify-between text-sm">
                              <span className="font-mono">{row.key}</span>
                              <span className="text-muted-foreground">{row.count}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-sm font-medium">Top forecast models</div>
                      <div className="space-y-2">
                        {snapshot.derived.forecastModels.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No forecast index entries yet.</div>
                        ) : (
                          snapshot.derived.forecastModels.map((row) => (
                            <div key={row.key} className="flex items-center justify-between text-sm">
                              <span className="font-mono">{row.key}</span>
                              <span className="text-muted-foreground">{row.count}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Largest blobs</CardTitle>
                    <CardDescription>These dominate space; useful for diagnosing quota pressure.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {snapshot.ops.topBlobsBySize.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No blobs tracked yet.</div>
                    ) : (
                      snapshot.ops.topBlobsBySize.slice(0, 12).map((b) => (
                        <div key={b.hash} className="flex items-center justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <div className="truncate font-mono">{shortHash(b.hash)}</div>
                            <div className="text-xs text-muted-foreground">
                              lastAccess {formatDate(b.lastAccess)} • pinned {b.pinned ? "yes" : "no"}
                            </div>
                          </div>
                          <div className="shrink-0 font-mono text-muted-foreground">{formatBytes(b.sizeBytes)}</div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="assistant" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Braces className="h-4 w-4" />
                      Assistant JSON Export
                    </CardTitle>
                    <CardDescription>
                      Copy/paste into a support thread. Includes ops snapshot + index summaries (and optionally raw index entries).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="exportLevel">Export</Label>
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
                        <Label htmlFor="listLimit">List limit</Label>
                        <Input
                          id="listLimit"
                          type="number"
                          inputMode="numeric"
                          className="w-28"
                          value={listLimit}
                          min={0}
                          max={50000}
                          onChange={(e) => setListLimit(Number(e.target.value))}
                        />
                      </div>
                      <Button variant="outline" className="gap-2" onClick={refresh} disabled={loading}>
                        <RefreshCw className="h-4 w-4" />
                        Rebuild
                      </Button>
                      <Button className="gap-2" onClick={copyAssistantJson} disabled={!assistantJson}>
                        <Copy className="h-4 w-4" />
                        Copy ({formatBytes(assistantJsonBytes)})
                      </Button>
                    </div>

                    <div className="rounded-md border">
                      <ScrollArea className="h-[520px]">
                        <div className="p-3">
                          <Textarea readOnly value={assistantJson} className="min-h-[500px] font-mono text-xs" />
                        </div>
                      </ScrollArea>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="config" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Runtime configuration</CardTitle>
                    <CardDescription>Trusted mode enables destructive maintenance operations in Ops.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-6">
                      <div className="flex items-center gap-3">
                        <Label htmlFor="trustMode">Trust mode</Label>
                        <select
                          id="trustMode"
                          className="rounded-md border bg-transparent px-2 py-1 text-sm"
                          value={config.trustMode}
                          onChange={(e) => setConfig({ ...config, trustMode: e.target.value as OpsConfig["trustMode"] })}
                        >
                          <option value="unverified">Unverified</option>
                          <option value="trusted">Trusted</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <Label htmlFor="pubkey">Expected manifest pubkey (hex)</Label>
                        <Input
                          id="pubkey"
                          value={config.expectedManifestPubKeyHex ?? ""}
                          placeholder="64-byte hex public key"
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              expectedManifestPubKeyHex: e.target.value.trim() || undefined
                            })
                          }
                        />
                        <div className="mt-1 text-xs text-muted-foreground">
                          Current: {isTrusted ? "trusted-ready" : "missing pubkey or unverified"}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3 text-sm">
                      <div className="font-medium">Policy</div>
                      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                        <div>
                          <div className="text-xs text-muted-foreground">Quota</div>
                          <div className="font-mono">{formatBytes(config.policy.quotaBytes)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Window</div>
                          <div className="font-mono">{config.policy.windowDays}d</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Obs retain</div>
                          <div className="font-mono">{config.policy.keepObservationDays}d</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Forecast retain</div>
                          <div className="font-mono">{config.policy.keepForecastRunsDays}d</div>
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Note: This page is read-only. Destructive actions live in <span className="font-mono">/ops/closet</span>.
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}

