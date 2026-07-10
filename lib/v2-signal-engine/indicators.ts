import type { Candle } from "../candles/types";

export type SessionVwapPoint = {
  value: number | null;
  usedVolumeProxy: boolean;
  sessionDate: string;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function calculateEMA(candles: Candle[], period: number): Array<number | null> {
  const output: Array<number | null> = Array(candles.length).fill(null);
  if (period <= 0 || candles.length < period) return output;
  const seed = candles.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;
  output[period - 1] = seed;
  const multiplier = 2 / (period + 1);
  for (let index = period; index < candles.length; index++) {
    output[index] = candles[index].close * multiplier + (output[index - 1] ?? seed) * (1 - multiplier);
  }
  return output;
}

export function calculateATR(candles: Candle[], period: number): Array<number | null> {
  const output: Array<number | null> = Array(candles.length).fill(null);
  if (period <= 0 || candles.length < period) return output;
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  let value = trueRanges.slice(0, period).reduce((sum, range) => sum + range, 0) / period;
  output[period - 1] = value;
  for (let index = period; index < candles.length; index++) {
    value = ((value * (period - 1)) + trueRanges[index]) / period;
    output[index] = value;
  }
  return output;
}

export function calculateSlope(values: Array<number | null>, lookback: number): Array<number | null> {
  const output: Array<number | null> = Array(values.length).fill(null);
  if (lookback <= 0 || values.length <= lookback) return output;
  for (let index = lookback; index < values.length; index++) {
    const current = values[index];
    const previous = values[index - lookback];
    output[index] = current !== null && previous !== null ? (current - previous) / lookback : null;
  }
  return output;
}

export function detectSwingHigh(candles: Candle[], index: number, lookback: number): boolean {
  if (lookback <= 0 || index < lookback || index + lookback >= candles.length) return false;
  const value = candles[index].high;
  for (let cursor = index - lookback; cursor <= index + lookback; cursor++) {
    if (cursor === index) continue;
    if (candles[cursor].high >= value) return false;
  }
  return true;
}

export function detectSwingLow(candles: Candle[], index: number, lookback: number): boolean {
  if (lookback <= 0 || index < lookback || index + lookback >= candles.length) return false;
  const value = candles[index].low;
  for (let cursor = index - lookback; cursor <= index + lookback; cursor++) {
    if (cursor === index) continue;
    if (candles[cursor].low <= value) return false;
  }
  return true;
}

export type EqualLiquidityLevel = {
  level: number;
  firstIndex: number;
  lastIndex: number;
  touches: number;
};

export type FvgDetection = {
  type: "BULLISH_FVG" | "BEARISH_FVG";
  bottom: number;
  top: number;
  midpoint: number;
  size: number;
};

export type MssDetection = {
  type: "MSS" | "CHOCH";
  brokenLevel: number;
};

export function detectEqualHighs(candles: Candle[], lookback: number, tolerance: number): EqualLiquidityLevel[] {
  return detectEqualLiquidity(candles, lookback, tolerance, "HIGH");
}

export function detectEqualLows(candles: Candle[], lookback: number, tolerance: number): EqualLiquidityLevel[] {
  return detectEqualLiquidity(candles, lookback, tolerance, "LOW");
}

export function detectFVG(candles: Candle[], index: number): FvgDetection | null {
  if (index < 2 || index >= candles.length) return null;
  const first = candles[index - 2];
  const third = candles[index];
  if (first.high < third.low) {
    return {
      type: "BULLISH_FVG",
      bottom: first.high,
      top: third.low,
      midpoint: (first.high + third.low) / 2,
      size: third.low - first.high,
    };
  }
  if (first.low > third.high) {
    return {
      type: "BEARISH_FVG",
      bottom: third.high,
      top: first.low,
      midpoint: (third.high + first.low) / 2,
      size: first.low - third.high,
    };
  }
  return null;
}

export function detectMSS(candles: Candle[], index: number, direction: "BUY" | "SELL", lookback = 5): MssDetection | null {
  if (index <= lookback) return null;
  const start = Math.max(lookback, index - lookback * 4);
  const end = index - lookback;
  const levels: number[] = [];
  for (let cursor = start; cursor <= end; cursor++) {
    if (direction === "BUY" && detectSwingHigh(candles, cursor, lookback)) levels.push(candles[cursor].high);
    if (direction === "SELL" && detectSwingLow(candles, cursor, lookback)) levels.push(candles[cursor].low);
  }
  if (!levels.length) {
    const fallback = candles.slice(Math.max(0, index - lookback * 4), index);
    if (fallback.length < lookback) return null;
    levels.push(direction === "BUY" ? Math.max(...fallback.map((candle) => candle.high)) : Math.min(...fallback.map((candle) => candle.low)));
  }
  const level = direction === "BUY" ? Math.max(...levels) : Math.min(...levels);
  const candle = candles[index];
  const closedBreak = direction === "BUY" ? candle.close > level : candle.close < level;
  const wickBreak = direction === "BUY" ? candle.high > level : candle.low < level;
  if (closedBreak) return { type: "MSS", brokenLevel: level };
  if (wickBreak) return { type: "CHOCH", brokenLevel: level };
  return null;
}

export function calculateSessionVWAP(
  candles: Candle[],
  sessionStart: string,
  timezone: string,
): SessionVwapPoint[] {
  const output: SessionVwapPoint[] = [];
  const startMinutes = parseClock(sessionStart);
  let activeSession = "";
  let weightedTotal = 0;
  let volumeTotal = 0;
  let proxyUsed = false;

  for (const candle of candles) {
    const local = zonedDateParts(candle.timestamp, timezone);
    const minutes = local.hour * 60 + local.minute;
    const sessionDate = minutes < startMinutes ? previousDate(local.date) : local.date;
    if (sessionDate !== activeSession) {
      activeSession = sessionDate;
      weightedTotal = 0;
      volumeTotal = 0;
      proxyUsed = false;
    }
    const hasVolume = Number.isFinite(candle.volume) && candle.volume > 0;
    const weight = hasVolume ? candle.volume : Math.max(candle.high - candle.low, Number.EPSILON);
    proxyUsed ||= !hasVolume;
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    weightedTotal += typicalPrice * weight;
    volumeTotal += weight;
    output.push({
      value: volumeTotal > 0 ? weightedTotal / volumeTotal : null,
      usedVolumeProxy: proxyUsed,
      sessionDate,
    });
  }
  return output;
}

export function zonedDateParts(timestamp: number, timezone: string): {
  date: string;
  hour: number;
  minute: number;
} {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(timestamp).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function clockWindowAt(
  timestamp: number,
  timezone: string,
  windows: ReadonlyArray<{ name: string; start: string; end: string }>,
): string | null {
  const local = zonedDateParts(timestamp, timezone);
  const minute = local.hour * 60 + local.minute;
  return windows.find((window) => minute >= parseClock(window.start) && minute < parseClock(window.end))?.name ?? null;
}

export function getKillzone(
  candleTime: number,
  timezone: string,
  killzones: ReadonlyArray<{ name: string; start: string; end: string }>,
): string | null {
  return clockWindowAt(candleTime, timezone, killzones);
}

function detectEqualLiquidity(candles: Candle[], lookback: number, tolerance: number, side: "HIGH" | "LOW"): EqualLiquidityLevel[] {
  const start = Math.max(0, candles.length - lookback);
  const source = candles.slice(start).map((candle, offset) => ({
    price: side === "HIGH" ? candle.high : candle.low,
    index: start + offset,
  }));
  const levels: EqualLiquidityLevel[] = [];
  for (let left = 0; left < source.length; left++) {
    const touches = [source[left]];
    for (let right = left + 1; right < source.length; right++) {
      if (Math.abs(source[left].price - source[right].price) <= tolerance) touches.push(source[right]);
    }
    if (touches.length >= 2) {
      levels.push({
        level: touches.reduce((sum, item) => sum + item.price, 0) / touches.length,
        firstIndex: touches[0].index,
        lastIndex: touches.at(-1)?.index ?? touches[0].index,
        touches: touches.length,
      });
    }
  }
  return levels.sort((a, b) => b.touches - a.touches || b.lastIndex - a.lastIndex);
}

function parseClock(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function previousDate(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}
