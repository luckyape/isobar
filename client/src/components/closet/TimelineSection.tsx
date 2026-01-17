
import React, { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ClosetSection } from "./ClosetSection";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type TimelineBin = {
    timeMs: number; // Start of the bin
    obsCount: number;
    forecastCount: number;
};

export type TimelineData = {
    bins: TimelineBin[];
    startMs: number;
    endMs: number;
    bucketSizeMs: number;
};

interface TimelineSectionProps {
    data: TimelineData;
    isExpanded: boolean;
    onExpandChange: (expanded: boolean) => void;
}

export function TimelineSection({ data, isExpanded, onExpandChange }: TimelineSectionProps) {
    // Calculate assertions for Layer 0
    const assertion = useMemo(() => {
        const totalBins = data.bins.length;
        const filledBins = data.bins.filter(b => b.obsCount > 0 || b.forecastCount > 0).length;
        if (totalBins === 0) return "No timeline data";

        // Simple heuristic for "filling up"
        const coverage = totalBins > 0 ? filledBins / totalBins : 0;
        if (coverage > 0.9) return "Complete history";
        if (coverage > 0.5) return "Filling up nicely";
        if (coverage > 0.1) return "Data flowing in";
        return "Just started";
    }, [data]);

    // Animation state
    const [animateProgress, setAnimateProgress] = useState(0);

    useEffect(() => {
        // Simple fill animation on mount
        const timer = setTimeout(() => setAnimateProgress(1), 100);
        return () => clearTimeout(timer);
    }, []);

    const totalObs = useMemo(() => data.bins.reduce((acc, b) => acc + b.obsCount, 0), [data]);
    const maxBinTotal = useMemo(() => {
        return Math.max(1, ...data.bins.map(b => b.obsCount + b.forecastCount));
    }, [data]);

    return (
        <ClosetSection
            id="timeline"
            title="Timeline"
            assertion={assertion}
            status="neutral" // Timeline is informational, rarely "error"
            isExpanded={isExpanded}
            onExpandChange={onExpandChange}
            compactContent={
                <div className="relative h-8 w-full overflow-hidden rounded-md bg-secondary/20 flex items-end">
                    {/* Mini-minimap for compact view */}
                    {data.bins.map((bin, i) => {
                        const hasData = bin.obsCount > 0 || bin.forecastCount > 0;
                        if (!hasData) return null;
                        const leftPct = (i / data.bins.length) * 100;
                        const widthPct = 100 / data.bins.length;
                        return (
                            <div
                                key={bin.timeMs}
                                className="absolute bottom-0 bg-primary/40"
                                style={{
                                    left: `${leftPct}%`,
                                    width: `${Math.max(0.2, widthPct)}%`,
                                    height: `60%`, // Fixed height for compact view
                                    opacity: animateProgress
                                }}
                            />
                        );
                    })}
                </div>
            }
        >
            <div className="space-y-6">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{new Date(data.startMs).toLocaleDateString()}</span>
                    <span>Last {Math.round((data.endMs - data.startMs) / (1000 * 60 * 60 * 24))} days</span>
                    <span>{new Date(data.endMs).toLocaleDateString()}</span>
                </div>

                <div className="relative h-32 w-full border-b border-l bg-secondary/5">
                    {/* Grid lines? Maybe later */}

                    <div className="absolute inset-0 flex items-end">
                        {data.bins.map((bin, i) => {
                            const total = bin.obsCount + bin.forecastCount;
                            if (total === 0) return (
                                <div
                                    key={bin.timeMs}
                                    className="flex-1 h-full border-r border-transparent"
                                />
                            );

                            const heightPct = Math.min(100, (total / maxBinTotal) * 100);
                            const obsHeightPct = total > 0 ? (bin.obsCount / total) * 100 : 0;

                            return (
                                <TooltipProvider key={bin.timeMs}>
                                    <Tooltip delayDuration={0}>
                                        <TooltipTrigger asChild>
                                            <div
                                                className="flex-1 group relative flex flex-col justify-end transition-all duration-500 ease-out hover:bg-secondary/20"
                                                style={{ height: '100%' }}
                                            >
                                                <div
                                                    className="w-full bg-primary/80 transition-all duration-1000 ease-out rounded-t-sm mx-[1px]"
                                                    style={{
                                                        height: `${heightPct * animateProgress}%`,
                                                        minHeight: '4px'
                                                    }}
                                                >
                                                    {/* Segment for forecast distinction if we want it? For now just one bar */}
                                                </div>
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs">
                                            <div className="font-semibold">{new Date(bin.timeMs).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</div>
                                            <div className="flex gap-4 mt-1">
                                                <div>
                                                    <div className="text-muted-foreground">Obs</div>
                                                    <div className="font-mono">{bin.obsCount}</div>
                                                </div>
                                                <div>
                                                    <div className="text-muted-foreground">Models</div>
                                                    <div className="font-mono">{bin.forecastCount}</div>
                                                </div>
                                            </div>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            );
                        })}
                    </div>
                </div>

                <div className="text-xs text-muted-foreground">
                    <p>
                        The timeline shows the density of data collected over time.
                        "Filling up" means your closet is building a continuous history of weather data.
                    </p>
                </div>
            </div>
        </ClosetSection>
    );
}
