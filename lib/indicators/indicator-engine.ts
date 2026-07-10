import type { Candle } from "../candles/types";
import { calculateATR, calculateEMA } from "../v2-signal-engine";

export type IndicatorEngineResult = {
  ema20: Array<number | null>;
  ema50: Array<number | null>;
  ema200: Array<number | null>;
  atr: Array<number | null>;
  calculationTimeMs: number;
  cacheStatus: "hit" | "miss";
};

const indicatorCache = new Map<string, IndicatorEngineResult>();
const MAX_CACHE_SIZE = 40;

export function calculateSharedIndicators(candles: Candle[]): IndicatorEngineResult {
  const cacheKey = buildIndicatorCacheKey(candles);
  const cached = indicatorCache.get(cacheKey);

  if (cached) {
    return cloneResult(cached, "hit");
  }

  const startedAt = performance.now();
  const result: IndicatorEngineResult = {
    ema20: calculateEMA(candles, 20),
    ema50: calculateEMA(candles, 50),
    ema200: calculateEMA(candles, 200),
    atr: calculateATR(candles, 14),
    calculationTimeMs: performance.now() - startedAt,
    cacheStatus: "miss",
  };

  if (indicatorCache.size >= MAX_CACHE_SIZE) {
    indicatorCache.delete(indicatorCache.keys().next().value ?? "");
  }

  indicatorCache.set(cacheKey, result);
  return cloneResult(result, "miss");
}

export function clearIndicatorEngineCache(): void {
  indicatorCache.clear();
}

export function getIndicatorEngineCacheSize(): number {
  return indicatorCache.size;
}

function buildIndicatorCacheKey(candles: Candle[]): string {
  const first = candles[0]?.timestamp ?? 0;
  const last = candles.at(-1)?.timestamp ?? 0;
  return `${candles.length}:${first}:${last}`;
}

function cloneResult(result: IndicatorEngineResult, cacheStatus: "hit" | "miss"): IndicatorEngineResult {
  return {
    ema20: [...result.ema20],
    ema50: [...result.ema50],
    ema200: [...result.ema200],
    atr: [...result.atr],
    calculationTimeMs: result.calculationTimeMs,
    cacheStatus,
  };
}
