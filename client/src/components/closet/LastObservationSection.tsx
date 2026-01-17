
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClosetSection } from "./ClosetSection";
import type { ObservationData } from "@/lib/observations/observations";
import { Thermometer, Wind, Umbrella, MapPin, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface LastObservationSectionProps {
    data: ObservationData | null;
    isExpanded: boolean;
    onExpandChange: (expanded: boolean) => void;
}

function formatValue(val: number | null, unit: string) {
    if (val === null || val === undefined) return "—";
    return `${val.toFixed(1)}${unit}`;
}

export function LastObservationSection({
    data,
    isExpanded,
    onExpandChange
}: LastObservationSectionProps) {
    // Determine status based on data presence
    const status = data ? "healthy" : "neutral";

    // Compact content (summary line)
    const compactContent = (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {data ? (
                <>
                    <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {data.series?.buckets[0] ? new Date(data.series.buckets[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                    </span>
                    <span className="flex items-center gap-1">
                        <Thermometer className="h-3 w-3" />
                        {formatValue(data.series?.tempC[0] ?? null, "°C")}
                    </span>
                    <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {data.stationName || data.stationId || "Unknown Stn"}
                    </span>
                </>
            ) : (
                <span>No observations available</span>
            )}
        </div>
    );

    return (
        <ClosetSection
            id="last-observation"
            title="Last Observation"
            assertion={data ? "Fresh data available" : "No recent data"}
            status={status}
            isExpanded={isExpanded}
            onExpandChange={onExpandChange}
            compactContent={compactContent}
        >
            {!data ? (
                <div className="text-sm text-muted-foreground py-4">
                    No observation data found in the closet. Trigger an ingestion or wait for sync.
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Main Metrics Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <Card className="bg-secondary/20 border-border/50">
                            <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                                <Thermometer className="h-5 w-5 text-muted-foreground mb-2" />
                                <div className="text-2xl font-mono font-semibold">
                                    {formatValue(data.series?.tempC[0] ?? null, "°")}
                                </div>
                                <div className="text-xs text-muted-foreground">Temperature</div>
                            </CardContent>
                        </Card>

                        <Card className="bg-secondary/20 border-border/50">
                            <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                                <Wind className="h-5 w-5 text-muted-foreground mb-2" />
                                <div className="text-2xl font-mono font-semibold">
                                    {formatValue(data.series?.windKph[0] ?? null, "")}
                                </div>
                                <div className="text-xs text-muted-foreground">Wind (km/h)</div>
                            </CardContent>
                        </Card>

                        <Card className="bg-secondary/20 border-border/50">
                            <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                                <Umbrella className="h-5 w-5 text-muted-foreground mb-2" />
                                <div className="text-2xl font-mono font-semibold">
                                    {formatValue(data.series?.precipMm[0] ?? null, "")}
                                </div>
                                <div className="text-xs text-muted-foreground">Precip (mm)</div>
                            </CardContent>
                        </Card>

                        <Card className="bg-secondary/20 border-border/50">
                            <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                                <Clock className="h-5 w-5 text-muted-foreground mb-2" />
                                <div className="text-lg font-mono font-medium pt-1">
                                    {data.series?.buckets[0] ? new Date(data.series.buckets[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                    {data.series?.buckets[0] ? new Date(data.series.buckets[0]).toLocaleDateString() : ""}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Metadata Section */}
                    <div className="rounded-md bg-secondary/30 p-3 text-sm space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Station ID</span>
                            <span className="font-mono">{data.stationId}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Station Name</span>
                            <span className="font-medium">{data.stationName || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Distance</span>
                            <span className="font-mono">{data.distanceKm.toFixed(2)} km</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-border/50">
                            <span className="text-muted-foreground">Trust Status</span>
                            <Badge variant="outline" className={cn("text-xs",
                                data.trust.mode === 'trusted' ? "border-green-500/50 text-green-700 dark:text-green-400" : ""
                            )}>
                                {data.trust.mode === 'trusted' ? 'Verified' : 'Unverified'}
                            </Badge>
                        </div>
                    </div>
                </div>
            )}
        </ClosetSection>
    );
}
