export type WindSizeBin = 'calm' | 'small' | 'medium' | 'large';

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function flowToDegrees(windFromDeg: number): number {
  return normalizeDegrees(windFromDeg + 180);
}

export function binSustainedSpeed(speedKmh: number): WindSizeBin | null {
  if (!Number.isFinite(speedKmh)) return null;
  if (speedKmh < 3) return 'calm';
  if (speedKmh < 15) return 'small';
  if (speedKmh <= 30) return 'medium';
  return 'large';
}

export function resultantLengthR(degrees: number[]): number | null {
  const values = degrees.filter((value) => Number.isFinite(value));
  if (values.length < 2) return null;
  let sumSin = 0;
  let sumCos = 0;
  values.forEach((deg) => {
    const radians = (deg * Math.PI) / 180;
    sumSin += Math.sin(radians);
    sumCos += Math.cos(radians);
  });
  return Math.sqrt(sumSin * sumSin + sumCos * sumCos) / values.length;
}
