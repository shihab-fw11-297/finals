import { describe, expect, it } from "vitest";

import type { Candle } from "../candles/types";
import {
  findEndIndexByTime,
  findNearestCandleIndexByTime,
  findStartIndexByTime,
  getVisibleCandlesByTime,
} from "./visible-range";

describe("visible range binary search", () => {
  const candles = [0, 60_000, 120_000, 180_000, 240_000].map(makeCandle);

  it("finds inclusive start and exclusive end indexes by timestamp", () => {
    expect(findStartIndexByTime(candles, 60_000)).toBe(1);
    expect(findStartIndexByTime(candles, 90_000)).toBe(2);
    expect(findEndIndexByTime(candles, 180_000)).toBe(4);
    expect(findEndIndexByTime(candles, 181_000)).toBe(4);
  });

  it("slices only the visible candle range", () => {
    expect(getVisibleCandlesByTime(candles, 60_000, 180_000).map((candle) => candle.timestamp)).toEqual([
      60_000,
      120_000,
      180_000,
    ]);
  });

  it("returns the nearest candle index without scanning the full array", () => {
    expect(findNearestCandleIndexByTime(candles, 125_000)).toBe(3);
    expect(findNearestCandleIndexByTime([], 125_000)).toBe(-1);
  });
});

function makeCandle(timestamp: number): Candle {
  return {
    time: new Date(timestamp).toISOString(),
    timestamp,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
    isClosed: true,
  };
}
