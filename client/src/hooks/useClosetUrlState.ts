/**
 * useClosetUrlState — Bidirectional URL hash state for Closet Dashboard
 * 
 * Encodes section expansion states in the URL for deep linking:
 * - `#coverage,storage` — expanded sections
 * - `#coverage?json=open` — Layer 3 JSON view open
 */

import { useState, useEffect, useCallback, useMemo } from "react";

export interface ClosetUrlState {
    /** Set of expanded section IDs */
    expandedSections: Set<string>;
    /** Whether the JSON drawer is open */
    jsonOpen: boolean;
}

const DEFAULT_STATE: ClosetUrlState = {
    expandedSections: new Set(),
    jsonOpen: false
};

function parseHash(hash: string): ClosetUrlState {
    if (!hash || hash === "#") return { ...DEFAULT_STATE, expandedSections: new Set() };

    const cleanHash = hash.startsWith("#") ? hash.slice(1) : hash;
    const [sectionsPart, queryPart] = cleanHash.split("?");

    // Parse expanded sections from the path part
    const expandedSections = new Set(
        sectionsPart
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
    );

    // Parse query parameters
    let jsonOpen = false;
    if (queryPart) {
        const params = new URLSearchParams(queryPart);
        jsonOpen = params.get("json") === "open";
    }

    return { expandedSections, jsonOpen };
}

function serializeState(state: ClosetUrlState): string {
    const parts: string[] = [];

    // Serialize expanded sections
    const sectionsList = Array.from(state.expandedSections).sort().join(",");
    if (sectionsList) {
        parts.push(sectionsList);
    }

    // Serialize query params
    const params = new URLSearchParams();
    if (state.jsonOpen) {
        params.set("json", "open");
    }

    const queryString = params.toString();
    if (queryString) {
        return `#${parts.join("")}?${queryString}`;
    }

    return parts.length > 0 ? `#${parts.join("")}` : "";
}

export function useClosetUrlState(): [ClosetUrlState, (updates: Partial<ClosetUrlState>) => void] {
    const [state, setState] = useState<ClosetUrlState>(() => {
        if (typeof window === "undefined") return { ...DEFAULT_STATE, expandedSections: new Set() };
        return parseHash(window.location.hash);
    });

    // Listen for popstate (back/forward navigation)
    useEffect(() => {
        const handleHashChange = () => {
            setState(parseHash(window.location.hash));
        };

        window.addEventListener("hashchange", handleHashChange);
        return () => window.removeEventListener("hashchange", handleHashChange);
    }, []);

    // Update URL when state changes
    const updateState = useCallback((updates: Partial<ClosetUrlState>) => {
        setState((prev) => {
            const next: ClosetUrlState = {
                expandedSections: updates.expandedSections ?? prev.expandedSections,
                jsonOpen: updates.jsonOpen ?? prev.jsonOpen
            };

            // Update URL without triggering navigation
            const newHash = serializeState(next);
            if (newHash !== window.location.hash) {
                window.history.replaceState(null, "", newHash || window.location.pathname);
            }

            return next;
        });
    }, []);

    return [state, updateState];
}

/** Helper to toggle a section's expanded state */
export function toggleSection(
    state: ClosetUrlState,
    updateState: (updates: Partial<ClosetUrlState>) => void,
    sectionId: string
) {
    const next = new Set(state.expandedSections);
    if (next.has(sectionId)) {
        next.delete(sectionId);
    } else {
        next.add(sectionId);
    }
    updateState({ expandedSections: next });
}

export default useClosetUrlState;
