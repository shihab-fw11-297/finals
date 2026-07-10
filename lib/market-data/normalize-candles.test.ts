import { describe, expect, it } from "vitest";

import type { Candle } from "../candles/types";
import {
  getLastClosedCandleTime,
  mergeCandlesByTimestamp,
  shouldRunStrategyScan,
} from "./normalize-candles";

describe("market candle normalization helpers", () => {
  it("merges candles with a timestamp map and sorts once after merge", () => {
    const previous = [makeCandle(120_000, 102), makeCandle(0, 100)];
    const incoming = [makeCandle(60_000, 101), makeCandle(120_000, 103)];

    const result = mergeCandlesByTimestamp(previous, incoming);

    expect(result.candles.map((candle) => candle.timestamp)).toEqual([0, 60_000, 120_000]);
    expect(result.candles.at(-1)?.close).toBe(103);
    expect(result.addedCount).toBe(1);
    expect(result.replacedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
  });

  it("tracks last closed candle and scan gating", () => {
    expect(getLastClosedCandleTime([makeCandle(0, 100), makeCandle(60_000, 101, false)])).toBe(0);
    expect(shouldRunStrategyScan(null, 60_000)).toBe(true);
    expect(shouldRunStrategyScan(60_000, 60_000)).toBe(false);
    expect(shouldRunStrategyScan(60_000, 120_000)).toBe(true);
    expect(shouldRunStrategyScan(60_000, null)).toBe(false);
  });
});

function makeCandle(timestamp: number, close: number, isClosed = true): Candle {
  return {
    time: new Date(timestamp).toISOString(),
    timestamp,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
    isClosed,
  };
}
