/**
 * Closet Ops Page — Production-grade local storage management UI
 *
 * Shows local corpus state, GC preview, and provides explicit controls.
 * No background actions; all mutations require user confirmation.
 */

import { useState, useCallback, useEffect } from 'react';
import {
    computeOpsSnapshot,
    runGCNow,
    pruneManifestRefs,
    resetCloset,
    flushAccessBuffer,
    pinBlob,
    unpinBlob,
    runReconciliation,
    getDefaultClosetPolicy,
    isTrustedMode,
    type OpsSnapshot,
    type OpsConfig,
    type TrustMode,
    type ReconciliationReport
} from '@/lib/closet/ops';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';
import { Lock, Unlock, AlertTriangle, CheckCircle, RotateCcw } from 'lucide-react';

// ... (formatting helpers same as before) ...
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatDate(timestamp: number): string {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
}

function shortHash(hash: string): string {
    return hash.slice(0, 8) + '…' + hash.slice(-6);
}

// ... (hook same as before) ...
function useClosetOpsSnapshot() {
    const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [config, setConfig] = useState<OpsConfig>({
        trustMode: 'unverified',
        expectedManifestPubKeyHex: undefined,
        policy: getDefaultClosetPolicy()
    });

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const snap = await computeOpsSnapshot(config);
            setSnapshot(snap);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, [config]);

    return { snapshot, loading, error, config, setConfig, refresh };
}

export default function ClosetOps() {
    const { snapshot, loading, error, config, setConfig, refresh } = useClosetOpsSnapshot();
    const [showDryRun, setShowDryRun] = useState(false);
    const [resetConfirm, setResetConfirm] = useState('');
    const [showConfig, setShowConfig] = useState(false);

    // Reconciliation State
    const [reconcileReport, setReconcileReport] = useState<ReconciliationReport | null>(null);
    const [fixingReconcile, setFixingReconcile] = useState(false);
    const [fixConfirmToken, setFixConfirmToken] = useState('');

    // Compute trusted mode for UI gating
    const isTrusted = isTrustedMode(config);

    // Initial load
    useEffect(() => {
        refresh();
    }, []);

    // Actions
    const handleRunGC = async () => {
        try {
            const result = await runGCNow(config);
            toast.success(`GC Complete: deleted ${result.deletedCount}, freed ${formatBytes(result.freedBytes)}`);
            refresh();
        } catch (err) {
            toast.error(`GC failed: ${err}`);
        }
    };

    const handlePruneManifests = async () => {
        try {
            const result = await pruneManifestRefs(config);
            toast.success(`Pruned ${result.pruned} manifest refs`);
            refresh();
        } catch (err) {
            toast.error(`Prune failed: ${err}`);
        }
    };

    const handleReset = async () => {
        if (resetConfirm !== 'RESET') {
            toast.error('Type RESET to confirm');
            return;
        }
        try {
            await resetCloset(config);
            toast.success('Closet reset complete');
            setResetConfirm('');
            refresh();
        } catch (err) {
            toast.error(`Reset failed: ${err}`);
        }
    };

    const handleFlushAccess = async () => {
        await flushAccessBuffer();
        toast.success('Access buffer flushed');
    };

    const handlePin = async (hash: string) => {
        try {
            await pinBlob(hash);
            toast.success('Pinned blob');
            refresh();
        } catch (err) {
            toast.error(`Pin failed: ${err}`);
        }
    };

    const handleUnpin = async (hash: string) => {
        try {
            await unpinBlob(hash);
            toast.success('Unpinned blob');
            refresh();
        } catch (err) {
            toast.error(`Unpin failed: ${err}`);
        }
    };

    const handleCheckIntegrity = async () => {
        setReconcileReport(null);
        try {
            const report = await runReconciliation(config, false);
            setReconcileReport(report);
            toast.success('Integrity check complete');
        } catch (err) {
            toast.error(`Check failed: ${err}`);
        }
    };

    const handleFixIntegrity = async () => {
        if (fixConfirmToken !== 'FIX') {
            toast.error('Type FIX to confirm');
            return;
        }
        setFixingReconcile(true);
        try {
            const report = await runReconciliation(config, true);
            setReconcileReport(report);
            setFixConfirmToken('');
            toast.success('Repairs complete');
            refresh();
        } catch (err) {
            toast.error(`Fix failed: ${err}`);
        } finally {
            setFixingReconcile(false);
        }
    };

    const copyHashes = (hashes: string[]) => {
        navigator.clipboard.writeText(hashes.join('\n'));
        toast.success(`Copied ${hashes.length} hashes`);
    };

    return (
        <div className="min-h-screen bg-background p-6">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-bold">Closet Ops</h1>
                    <Badge variant={config.trustMode === 'trusted' ? 'default' : 'destructive'}>
                        {config.trustMode === 'trusted' ? 'TRUSTED' : 'UNVERIFIED MODE'}
                    </Badge>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowConfig(!showConfig)}>
                        Config
                    </Button>
                    <Button onClick={refresh} disabled={loading}>
                        {loading ? 'Loading...' : 'Refresh Snapshot'}
                    </Button>
                </div>
            </div>

            {/* Config & Policy Stats */}
            {snapshot && (
                <div className="mb-6 text-sm text-muted-foreground flex items-center gap-4">
                    <span>Window: <b>{snapshot.policy.windowDays}d</b></span>
                    <span>Quota: <b>{formatBytes(snapshot.quotaBytes)}</b></span>
                    <span>Pins: <b>{snapshot.policy.pins.length}</b></span>
                </div>
            )}

            {showConfig && (
                <Card className="mb-6 border-dashed">
                    <CardHeader><CardTitle>Runtime Configuration</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-4">
                            <Label>Trust Mode</Label>
                            <select
                                value={config.trustMode}
                                onChange={(e) => setConfig({ ...config, trustMode: e.target.value as TrustMode })}
                                className="border rounded p-1"
                            >
                                <option value="unverified">Unverified</option>
                                <option value="trusted">Trusted</option>
                            </select>
                        </div>
                        <div className="flex items-center gap-4">
                            <Label>Quota (MB) - Sim Only</Label>
                            <Slider
                                defaultValue={[config.policy.quotaBytes / 1024 / 1024]}
                                max={2000}
                                step={50}
                                onValueChange={(vals) => setConfig({ ...config, policy: { ...config.policy, quotaBytes: vals[0] * 1024 * 1024 } })}
                                className="w-[200px]"
                            />
                            <span>{formatBytes(config.policy.quotaBytes)}</span>
                        </div>
                    </CardContent>
                </Card>
            )}

            {error && <div className="p-4 bg-destructive/10 text-destructive mb-6 rounded">{error}</div>}

            {!snapshot ? (
                <div className="text-center py-12 text-muted-foreground">Loading snapshot...</div>
            ) : (
                <>
                    {/* Main Stats Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Storage Usage</CardTitle></CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{formatBytes(snapshot.totalBytesPresent)}</div>
                                <p className="text-xs text-muted-foreground">
                                    {((snapshot.totalBytesPresent / snapshot.quotaBytes) * 100).toFixed(1)}% of Quota
                                </p>
                                <div className="h-2 w-full bg-secondary mt-2 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-primary transition-all"
                                        style={{ width: `${Math.min(100, (snapshot.totalBytesPresent / snapshot.quotaBytes) * 100)}%` }}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Reachability</CardTitle></CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {snapshot.reachability ? snapshot.reachability.reachable.size : '-'}
                                </div>
                                <p className="text-xs text-muted-foreground">Reachable Blobs</p>
                                {snapshot.reachabilityError && <p className="text-xs text-destructive">{snapshot.reachabilityError}</p>}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Integrity Status</CardTitle></CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold flex items-center gap-2">
                                    {reconcileReport ? (
                                        (reconcileReport.missingFound + reconcileReport.sizeMismatches + reconcileReport.orphansFound) === 0 ?
                                            <><CheckCircle className="text-green-500 w-6 h-6" /> Healthy</> :
                                            <><AlertTriangle className="text-yellow-500 w-6 h-6" /> Issues</>
                                    ) : 'Unknown'}
                                </div>
                                <Button variant="link" size="sm" className="px-0 h-auto" onClick={handleCheckIntegrity}>
                                    Check Now
                                </Button>
                            </CardContent>
                        </Card>
                    </div>

                    <Tabs defaultValue="overview" className="space-y-4">
                        <TabsList>
                            <TabsTrigger value="overview">Overview</TabsTrigger>
                            <TabsTrigger value="blobs">Blob Explorer</TabsTrigger>
                            <TabsTrigger value="reconcile">Reconciliation</TabsTrigger>
                            <TabsTrigger value="ops">Dangerous Ops</TabsTrigger>
                        </TabsList>

                        <TabsContent value="overview" className="space-y-4">
                            {/* GC Preview */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Policy Simulation & GC Preview</CardTitle>
                                    <CardDescription>
                                        What would happen if GC ran right now with current settings?
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {snapshot.deletionPlan ? (
                                        <div className="flex gap-8">
                                            <div>
                                                <div className="text-sm text-muted-foreground">To Delete</div>
                                                <div className="text-xl font-bold text-destructive">
                                                    {snapshot.deletionPlan.sweepCount} items
                                                </div>
                                                <div className="text-sm font-mono">
                                                    {formatBytes(snapshot.deletionPlan.sweepBytes)}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-sm text-muted-foreground">Quota Logic</div>
                                                <div className="text-lg">
                                                    {snapshot.deletionPlan.wouldNeedQuotaEnforcement ? 'Enforced' : 'Not needed'}
                                                </div>
                                                {snapshot.deletionPlan.cannotSatisfyQuota && (
                                                    <Badge variant="destructive">Cannot Satisfy Quota</Badge>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-destructive">Plan computation failed: {snapshot.deletionPlanError}</div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="blobs">
                            <Card>
                                <CardHeader><CardTitle>Top Blobs</CardTitle></CardHeader>
                                <CardContent>
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b text-left">
                                                <th className="p-2">Hash</th>
                                                <th className="p-2">Size</th>
                                                <th className="p-2">Pinned</th>
                                                <th className="p-2">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {snapshot.topBlobsBySize.map(blob => (
                                                <tr key={blob.hash} className="border-b">
                                                    <td className="p-2 font-mono text-xs">{shortHash(blob.hash)}</td>
                                                    <td className="p-2 font-mono">{formatBytes(blob.sizeBytes)}</td>
                                                    <td className="p-2">{blob.pinned ? <Lock className="w-4 h-4 text-primary" /> : '-'}</td>
                                                    <td className="p-2">
                                                        {blob.pinned ? (
                                                            <Button variant="ghost" size="icon" onClick={() => handleUnpin(blob.hash)} title="Unpin">
                                                                <Unlock className="w-4 h-4" />
                                                            </Button>
                                                        ) : (
                                                            <Button variant="ghost" size="icon" onClick={() => handlePin(blob.hash)} title="Pin">
                                                                <Lock className="w-4 h-4" />
                                                            </Button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="reconcile">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Reconciliation Report</CardTitle>
                                    <CardDescription>
                                        Compare DB metadata with physical storage. Use "Fix" to align them.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex gap-4">
                                        <Button onClick={handleCheckIntegrity}>Run Integrity Check</Button>
                                    </div>

                                    {reconcileReport && (
                                        <div className="border rounded p-4 space-y-2 bg-muted/20">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <Label>Missing Payloads (Meta says present, Disk missing)</Label>
                                                    <div className="text-xl">{reconcileReport.missingFound}</div>
                                                </div>
                                                <div>
                                                    <Label>Orphans (Meta says deleted, Disk present)</Label>
                                                    <div className="text-xl">{reconcileReport.orphansFound}</div>
                                                </div>
                                                <div>
                                                    <Label>Size Mismatches</Label>
                                                    <div className="text-xl">{reconcileReport.sizeMismatches}</div>
                                                </div>
                                            </div>

                                            {(reconcileReport.missingFound > 0 || reconcileReport.orphansFound > 0 || reconcileReport.sizeMismatches > 0) && (
                                                <div className="mt-4 p-4 border border-destructive rounded bg-destructive/5 space-y-4">
                                                    <h3 className="font-bold text-destructive">Repairs Needed</h3>
                                                    <p className="text-sm">
                                                        Fixing will update metadata to match disk (remove missing items)
                                                        and delete orphaned files from disk.
                                                    </p>
                                                    <div className="flex gap-2">
                                                        <Input
                                                            placeholder="Type FIX to confirm"
                                                            value={fixConfirmToken}
                                                            onChange={e => setFixConfirmToken(e.target.value)}
                                                            className="w-32"
                                                        />
                                                        <Button
                                                            variant="destructive"
                                                            onClick={handleFixIntegrity}
                                                            disabled={fixingReconcile || !isTrusted}
                                                            title={!isTrusted ? 'Trusted mode required (missing manifest public key)' : undefined}
                                                        >
                                                            {fixingReconcile ? 'Fixing...' : 'Fix Issues'}
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="ops">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-destructive flex items-center gap-2">
                                        <AlertTriangle /> Dangerous Operations
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold">Manual Cleanup</h3>
                                            <p className="text-sm text-muted-foreground">Run mark-and-sweep GC immediately.</p>
                                        </div>
                                        <Button
                                            variant="secondary"
                                            onClick={handleRunGC}
                                            disabled={!isTrusted}
                                            title={!isTrusted ? 'Trusted mode required (missing manifest public key)' : undefined}
                                        >
                                            Run GC Now
                                        </Button>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold">Flush Buffers</h3>
                                            <p className="text-sm text-muted-foreground">Force write pending access times to DB.</p>
                                        </div>
                                        <Button variant="outline" onClick={handleFlushAccess}>Flush</Button>
                                    </div>

                                    <div className="border-t pt-4">
                                        <h3 className="font-bold text-destructive mb-2">Factory Reset</h3>
                                        <div className="flex gap-4">
                                            <Input
                                                placeholder="Type RESET to confirm"
                                                value={resetConfirm}
                                                onChange={(e) => setResetConfirm(e.target.value)}
                                                className="w-48"
                                            />
                                            <Button
                                                variant="destructive"
                                                onClick={handleReset}
                                                disabled={!isTrusted}
                                                title={!isTrusted ? 'Trusted mode required (missing manifest public key)' : undefined}
                                            >
                                                <RotateCcw className="w-4 h-4 mr-2" />
                                                Reset Closet
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </>
            )}
        </div>
    );
}
