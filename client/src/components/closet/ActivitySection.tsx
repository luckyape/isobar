/**
 * ActivitySection — Activity overview for Closet Dashboard
 * 
 * Shows inflight downloads, last GC timestamp, and recent activity.
 */

import { Activity, Download, Trash2, Clock } from "lucide-react";
import { ClosetSection, type SectionStatus } from "./ClosetSection";

export interface ActivityData {
    inflightDownloads: Array<{ hash: string; startedAtMs: number; ageMs: number }>;
    lastGcAt: number;
    lastGcAgeMs: number;
}

interface ActivitySectionProps {
    data: ActivityData;
    isExpanded?: boolean;
    onExpandChange?: (expanded: boolean) => void;
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

function getAssertion(data: ActivityData): string {
    if (data.inflightDownloads.length > 0) {
        const count = data.inflightDownloads.length;
        return `Syncing ${count} item${count === 1 ? "" : "s"}`;
    }
    if (data.lastGcAt > 0) {
        return `Last sync ${formatAgeFromMs(data.lastGcAgeMs)}`;
    }
    return "All quiet";
}

function getStatus(data: ActivityData): SectionStatus {
    if (data.inflightDownloads.length > 0) return "healthy"; // Active syncing
    if (data.lastGcAgeMs > 0 && data.lastGcAgeMs < 6 * 60 * 60 * 1000) return "healthy"; // Recent activity
    if (data.lastGcAt <= 0) return "neutral"; // No history
    return "warning"; // Stale
}

export function ActivitySection({ data, isExpanded, onExpandChange }: ActivitySectionProps) {
    const hasInflight = data.inflightDownloads.length > 0;

    return (
        <ClosetSection
            id="activity"
            title="Activity"
            assertion={getAssertion(data)}
            status={getStatus(data)}
            isExpanded={isExpanded}
            onExpandChange={onExpandChange}
            compactContent={
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                        <Download className="h-4 w-4" />
                        <span>{data.inflightDownloads.length} inflight</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Trash2 className="h-4 w-4" />
                        <span>GC {data.lastGcAt > 0 ? formatAgeFromMs(data.lastGcAgeMs) : "never"}</span>
                    </div>
                </div>
            }
        >
            {/* Layer 1: Detailed activity */}
            <div className="space-y-4 text-sm">
                {/* Inflight Downloads */}
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <Download className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">Inflight Downloads</span>
                    </div>
                    {hasInflight ? (
                        <div className="space-y-1.5">
                            {data.inflightDownloads.slice(0, 5).map((item) => (
                                <div
                                    key={item.hash}
                                    className="flex items-center justify-between bg-secondary/30 px-2 py-1.5 rounded text-xs"
                                >
                                    <span className="font-mono">{shortHash(item.hash)}</span>
                                    <span className="text-muted-foreground">
                                        Started {formatAgeFromMs(item.ageMs)}
                                    </span>
                                </div>
                            ))}
                            {data.inflightDownloads.length > 5 && (
                                <div className="text-xs text-muted-foreground">
                                    +{data.inflightDownloads.length - 5} more
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-muted-foreground">No downloads in progress</div>
                    )}
                </div>

                {/* Last GC */}
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">Last Garbage Collection</span>
                    </div>
                    <div className="text-muted-foreground">
                        {data.lastGcAt > 0 ? (
                            <>
                                <span className="font-mono text-foreground">{formatDate(data.lastGcAt)}</span>
                                <span> ({formatAgeFromMs(data.lastGcAgeMs)})</span>
                            </>
                        ) : (
                            "Never run — GC is triggered automatically when storage pressure is detected."
                        )}
                    </div>
                </div>

                <div className="text-xs text-muted-foreground pt-2 border-t border-border/50">
                    Activity is derived from current system state. Historical logs are not persisted.
                </div>
            </div>
        </ClosetSection>
    );
}

export default ActivitySection;
