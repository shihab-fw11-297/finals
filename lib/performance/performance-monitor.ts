export type PerformanceWarning =
  | "SCAN_TOO_SLOW"
  | "RENDER_TOO_SLOW"
  | "TOO_MANY_MARKERS_VISIBLE"
  | "DUPLICATE_CANDLES_DETECTED"
  | "DUPLICATE_SIGNALS_PREVENTED";

export type PerformanceSnapshot = {
  candlesCount: number;
  visibleCandlesCount: number;
  lastFetchDurationMs: number;
  lastScanDurationMs: number;
  lastRenderDurationMs: number;
  indicatorCalculationMs: number;
  strategyScanMs: number;
  memoryCacheSize: number;
  signalsCount: number;
  pendingSetupsCount: number;
  rejectedSetupsCount: number;
  duplicateCandlesDetected: number;
  duplicateSignalsPrevented: number;
  visibleMarkersCount: number;
};

export const EMPTY_PERFORMANCE_SNAPSHOT: PerformanceSnapshot = {
  candlesCount: 0,
  visibleCandlesCount: 0,
  lastFetchDurationMs: 0,
  lastScanDurationMs: 0,
  lastRenderDurationMs: 0,
  indicatorCalculationMs: 0,
  strategyScanMs: 0,
  memoryCacheSize: 0,
  signalsCount: 0,
  pendingSetupsCount: 0,
  rejectedSetupsCount: 0,
  duplicateCandlesDetected: 0,
  duplicateSignalsPrevented: 0,
  visibleMarkersCount: 0,
};

export function getPerformanceWarnings(snapshot: PerformanceSnapshot): PerformanceWarning[] {
  const warnings: PerformanceWarning[] = [];

  if (snapshot.strategyScanMs > 250 || snapshot.lastScanDurationMs > 250) {
    warnings.push("SCAN_TOO_SLOW");
  }

  if (snapshot.lastRenderDurationMs > 32) {
    warnings.push("RENDER_TOO_SLOW");
  }

  if (snapshot.visibleMarkersCount > 400) {
    warnings.push("TOO_MANY_MARKERS_VISIBLE");
  }

  if (snapshot.duplicateCandlesDetected > 0) {
    warnings.push("DUPLICATE_CANDLES_DETECTED");
  }

  if (snapshot.duplicateSignalsPrevented > 0) {
    warnings.push("DUPLICATE_SIGNALS_PREVENTED");
  }

  return warnings;
}
