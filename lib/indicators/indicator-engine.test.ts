import { describe, expect, it } from "vitest";

import type { Candle } from "../candles/types";
import {
  calculateSharedIndicators,
  clearIndicatorEngineCache,
  getIndicatorEngineCacheSize,
} from "./indicator-engine";

describe("shared indicator engine cache", () => {
  it("returns stable indicator values from cache for the same candle fingerprint", () => {
    clearIndicatorEngineCache();
    const candles = Array.from({ length: 220 }, (_, index) => makeCandle(index));

    const first = calculateSharedIndicators(candles);
    const second = calculateSharedIndicators(candles);

    expect(first.cacheStatus).toBe("miss");
    expect(second.cacheStatus).toBe("hit");
    expect(second.ema20).toEqual(first.ema20);
    expect(second.ema50).toEqual(first.ema50);
    expect(second.ema200).toEqual(first.ema200);
    expect(second.atr).toEqual(first.atr);
    expect(getIndicatorEngineCacheSize()).toBe(1);
  });
});

function makeCandle(index: number): Candle {
  const close = 100 + index * 0.1;

  return {
    time: new Date(index * 60_000).toISOString(),
    timestamp: index * 60_000,
    open: close - 0.05,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 1,
    isClosed: true,
  };
}
