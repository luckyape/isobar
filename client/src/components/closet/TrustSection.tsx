/**
 * TrustSection — Trust status display for Closet Dashboard
 * 
 * Shows manifest signature status, trusted mode state, and explains
 * why destructive ops may be disabled.
 */

import { Shield, ShieldCheck, ShieldAlert, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClosetSection, type SectionStatus } from "./ClosetSection";

export interface TrustData {
    mode: "unverified" | "trusted";
    isTrusted: boolean;
    whyNotTrusted: string | null;
    manifestSignatureStatus: "valid" | "invalid" | "unchecked";
    destructiveOpsEnabled: boolean;
    expectedPubKeyHex?: string;
}

interface TrustSectionProps {
    data: TrustData;
    isExpanded?: boolean;
    onExpandChange?: (expanded: boolean) => void;
}

function getAssertion(data: TrustData): string {
    if (data.isTrusted && data.manifestSignatureStatus === "valid") {
        return "Verified and trusted";
    }
    if (data.isTrusted) {
        return "Trusted mode enabled";
    }
    if (data.mode === "unverified") {
        return "Unverified mode";
    }
    return "Trust check pending";
}

function getStatus(data: TrustData): SectionStatus {
    if (data.isTrusted && data.manifestSignatureStatus === "valid") return "healthy";
    if (data.isTrusted) return "healthy";
    if (data.mode === "unverified") return "warning";
    return "neutral";
}

export function TrustSection({ data, isExpanded, onExpandChange }: TrustSectionProps) {
    const Icon = data.isTrusted
        ? ShieldCheck
        : data.mode === "unverified"
            ? ShieldAlert
            : Shield;

    return (
        <ClosetSection
            id="trust"
            title="Trust"
            assertion={getAssertion(data)}
            status={getStatus(data)}
            isExpanded={isExpanded}
            onExpandChange={onExpandChange}
            compactContent={
                <div className="flex items-center gap-3 text-sm">
                    <Icon className="h-5 w-5" />
                    <Badge variant={data.isTrusted ? "default" : "secondary"}>
                        {data.mode === "trusted" ? "Trusted" : "Unverified"}
                    </Badge>
                    {data.destructiveOpsEnabled && (
                        <Badge variant="outline" className="text-xs">
                            Ops enabled
                        </Badge>
                    )}
                </div>
            }
        >
            {/* Layer 1: Why explanation */}
            <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <div className="text-muted-foreground mb-1">Trust Mode</div>
                        <div className="font-mono">{data.mode}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground mb-1">Manifest Signature</div>
                        <div className="font-mono">{data.manifestSignatureStatus}</div>
                    </div>
                </div>

                {data.whyNotTrusted && (
                    <div className="p-3 rounded-md bg-secondary/50 text-sm">
                        <div className="font-medium text-muted-foreground mb-1">
                            Why destructive ops are disabled:
                        </div>
                        <div>{data.whyNotTrusted}</div>
                    </div>
                )}

                {data.expectedPubKeyHex && (
                    <div>
                        <div className="text-muted-foreground mb-1">Expected Public Key</div>
                        <div className="font-mono text-xs break-all bg-secondary/30 p-2 rounded">
                            {data.expectedPubKeyHex.slice(0, 32)}…{data.expectedPubKeyHex.slice(-16)}
                        </div>
                    </div>
                )}

                <div className="pt-2 border-t border-border/50">
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 text-xs"
                        onClick={() => window.open("/ops/closet", "_blank", "noopener,noreferrer")}
                    >
                        <ExternalLink className="h-3 w-3" />
                        Open Ops Console
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">
                        Advanced operations including GC, reset, and integrity checks require trusted mode.
                    </p>
                </div>
            </div>
        </ClosetSection>
    );
}

export default TrustSection;
