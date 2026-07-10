import type { Candle } from "../candles/types";

export function findStartIndexByTime(candles: Candle[], startTime: number): number {
  let left = 0;
  let right = candles.length;

  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);

    if (candles[middle].timestamp < startTime) {
      left = middle + 1;
    } else {
      right = middle;
    }
  }

  return left;
}

export function findEndIndexByTime(candles: Candle[], endTime: number): number {
  let left = 0;
  let right = candles.length;

  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);

    if (candles[middle].timestamp <= endTime) {
      left = middle + 1;
    } else {
      right = middle;
    }
  }

  return left;
}

export function getVisibleCandlesByTime(candles: Candle[], startTime: number, endTime: number): Candle[] {
  if (candles.length === 0 || startTime > endTime) {
    return [];
  }

  const startIndex = findStartIndexByTime(candles, startTime);
  const endIndex = findEndIndexByTime(candles, endTime);

  return candles.slice(startIndex, endIndex);
}

export function findNearestCandleIndexByTime(candles: Candle[], timestamp: number): number {
  if (candles.length === 0) {
    return -1;
  }

  return Math.min(findStartIndexByTime(candles, timestamp), candles.length - 1);
}
