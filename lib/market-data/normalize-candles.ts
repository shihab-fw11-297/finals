import type { Candle } from "../candles/types";

export type CandleMergeResult = {
  candles: Candle[];
  addedCount: number;
  replacedCount: number;
  duplicateCount: number;
  lastClosedCandleTime: number | null;
};

export function mergeCandlesByTimestamp(previous: Candle[], incoming: Candle[]): CandleMergeResult {
  const candleMap = new Map<number, Candle>();

  for (const candle of previous) {
    candleMap.set(candle.timestamp, candle);
  }

  let replacedCount = 0;
  let duplicateCount = 0;

  for (const candle of incoming) {
    const existing = candleMap.get(candle.timestamp);

    if (existing) {
      duplicateCount += 1;
      if (!areCandlesEqual(existing, candle)) {
        replacedCount += 1;
      }
    }

    candleMap.set(candle.timestamp, candle);
  }

  const candles = Array.from(candleMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  const previousTimestamps = new Set(previous.map((candle) => candle.timestamp));
  const addedCount = candles.reduce((count, candle) => count + (previousTimestamps.has(candle.timestamp) ? 0 : 1), 0);

  return {
    candles,
    addedCount,
    replacedCount,
    duplicateCount,
    lastClosedCandleTime: getLastClosedCandleTime(candles),
  };
}

export function getLastClosedCandleTime(candles: Candle[]): number | null {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if (candles[index].isClosed) {
      return candles[index].timestamp;
    }
  }

  return null;
}

export function shouldRunStrategyScan(previousLastClosedCandleTime: number | null, nextLastClosedCandleTime: number | null): boolean {
  if (nextLastClosedCandleTime === null) {
    return false;
  }

  return previousLastClosedCandleTime === null || nextLastClosedCandleTime > previousLastClosedCandleTime;
}

function areCandlesEqual(left: Candle, right: Candle): boolean {
  return (
    left.timestamp === right.timestamp &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    left.volume === right.volume &&
    left.closeTime === right.closeTime &&
    left.isClosed === right.isClosed
  );
}
