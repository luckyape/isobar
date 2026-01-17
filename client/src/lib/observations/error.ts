/**
 * Error calculation utilities for observations.
 * Pure functions for computing deviations between model forecasts and observed data.
 *
 * Terminology: "Error" or "Delta".
 */

/**
 * Compute Mean Absolute Error (MAE) between two series.
 * Ignores indices where either value is null/undefined or non-finite.
 */
export function mae(modelValues: (number | null)[], observedValues: (number | null)[]): number | null {
    let sumError = 0;
    let count = 0;

    const len = Math.min(modelValues.length, observedValues.length);
    for (let i = 0; i < len; i++) {
        const m = modelValues[i];
        const o = observedValues[i];

        if (Number.isFinite(m) && Number.isFinite(o)) {
            sumError += Math.abs((m as number) - (o as number));
            count++;
        }
    }

    return count > 0 ? sumError / count : null;
}

/**
 * Compute signed delta (Model - Observed) for each bucket.
 * Returns null if data missing.
 */
export function signedDelta(modelValues: (number | null)[], observedValues: (number | null)[]): (number | null)[] {
    const len = Math.min(modelValues.length, observedValues.length);
    const deltas: (number | null)[] = new Array(len).fill(null);

    for (let i = 0; i < len; i++) {
        const m = modelValues[i];
        const o = observedValues[i];
        if (Number.isFinite(m) && Number.isFinite(o)) {
            deltas[i] = (m as number) - (o as number);
        }
    }
    return deltas;
}

/**
 * Compute circular absolute difference for degrees (0-360).
 * Minimal path difference (e.g. 359 vs 1 = 2 degrees).
 */
export function circularAbsDiffDeg(a: number | null, b: number | null): number | null {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

    const d = Math.abs((a as number) - (b as number)) % 360;
    return d > 180 ? 360 - d : d;
}

/**
 * Compute Mean Circular Error (MAE for degrees) over a series.
 */
export function circularMae(modelValues: (number | null)[], observedValues: (number | null)[]): number | null {
    let sumError = 0;
    let count = 0;

    const len = Math.min(modelValues.length, observedValues.length);
    for (let i = 0; i < len; i++) {
        const diff = circularAbsDiffDeg(modelValues[i], observedValues[i]);
        if (diff !== null) {
            sumError += diff;
            count++;
        }
    }

    return count > 0 ? sumError / count : null;
}

/**
 * Represents the precision or error margin of the observation
 */
export interface ErrorMargin {
    value: number;
    unit: string;
    // precision level: 'high' | 'medium' | 'low'
    precision: string;
}

/**
 * Summarize error stats for a specific window (e.g. past 24h).
 */
export interface ErrorSummary {
    mae: number | null;
    bias: number | null; // Mean Signed Error
    count: number;
}

export function summarizeWindow(
    modelValues: (number | null)[],
    observedValues: (number | null)[]
): ErrorSummary {
    let sumAbs = 0;
    let sumSigned = 0;
    let count = 0;

    const len = Math.min(modelValues.length, observedValues.length);
    for (let i = 0; i < len; i++) {
        const m = modelValues[i];
        const o = observedValues[i];
        if (Number.isFinite(m) && Number.isFinite(o)) {
            const diff = (m as number) - (o as number);
            sumAbs += Math.abs(diff);
            sumSigned += diff;
            count++;
        }
    }

    return {
        mae: count > 0 ? sumAbs / count : null,
        bias: count > 0 ? sumSigned / count : null,
        count
    };
}
