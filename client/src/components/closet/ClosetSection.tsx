/**
 * ClosetSection — Collapsible section with layered depth model support
 * 
 * Supports Layer 0 (assertion) → Layer 1 (expanded details) flow.
 * Keyboard accessible with visible focus indicators.
 */

import { useState, useId, type ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SectionStatus = "healthy" | "warning" | "error" | "neutral";

interface ClosetSectionProps {
    /** Unique section identifier for URL state */
    id: string;
    /** Section title */
    title: string;
    /** Layer 0: Human-readable assertion statement */
    assertion: string;
    /** Visual status indicator */
    status?: SectionStatus;
    /** Whether the section is expanded (controlled) */
    isExpanded?: boolean;
    /** Callback when expansion state changes */
    onExpandChange?: (expanded: boolean) => void;
    /** Optional Layer 2 trigger callback */
    onViewData?: () => void;
    /** Layer 1: Expanded details content */
    children?: ReactNode;
    /** Layer 0: Compact content shown when collapsed */
    compactContent?: ReactNode;
}

const statusColors: Record<SectionStatus, string> = {
    healthy: "text-agreement-high",
    warning: "text-agreement-medium",
    error: "text-agreement-low",
    neutral: "text-muted-foreground"
};

const statusBorderColors: Record<SectionStatus, string> = {
    healthy: "border-l-agreement-high",
    warning: "border-l-agreement-medium",
    error: "border-l-agreement-low",
    neutral: "border-l-transparent"
};

export function ClosetSection({
    id,
    title,
    assertion,
    status = "neutral",
    isExpanded: controlledExpanded,
    onExpandChange,
    onViewData,
    children,
    compactContent
}: ClosetSectionProps) {
    const [internalExpanded, setInternalExpanded] = useState(false);
    const headingId = useId();
    const contentId = useId();

    // Support both controlled and uncontrolled usage
    const isExpanded = controlledExpanded ?? internalExpanded;
    const setExpanded = onExpandChange ?? setInternalExpanded;

    const handleToggle = () => {
        setExpanded(!isExpanded);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggle();
        }
    };

    return (
        <Card
            data-section-id={id}
            className={cn(
                "transition-all duration-200 border-l-4",
                statusBorderColors[status]
            )}
        >
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            {title}
                        </CardTitle>
                        {/* Layer 0: Assertion */}
                        <p
                            className={cn("text-lg font-semibold mt-1", statusColors[status])}
                            aria-live="polite"
                        >
                            {assertion}
                        </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                        {children && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleToggle}
                                onKeyDown={handleKeyDown}
                                aria-expanded={isExpanded}
                                aria-controls={contentId}
                                className={cn(
                                    "gap-1.5 text-xs text-muted-foreground hover:text-foreground",
                                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                )}
                            >
                                <Info className="h-3 w-3" />
                                Why?
                                <ChevronDown
                                    className={cn(
                                        "h-3 w-3 transition-transform duration-200",
                                        isExpanded && "rotate-180"
                                    )}
                                />
                            </Button>
                        )}
                        {onViewData && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onViewData}
                                className={cn(
                                    "text-xs text-muted-foreground hover:text-foreground",
                                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                )}
                            >
                                Data
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>

            <CardContent className="pt-0">
                {/* Layer 0: Compact content (always visible) */}
                {compactContent && (
                    <div className="mb-3">
                        {compactContent}
                    </div>
                )}

                {/* Layer 1: Expanded details */}
                {children && (
                    <div
                        id={contentId}
                        role="region"
                        aria-labelledby={headingId}
                        className={cn(
                            "overflow-hidden transition-all duration-200",
                            isExpanded ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
                        )}
                    >
                        <div className="pt-3 border-t border-border/50 space-y-3">
                            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Why this assessment?
                            </div>
                            {children}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export default ClosetSection;
