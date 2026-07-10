import { beforeEach, describe, expect, it } from "vitest";

import type { Candle } from "../candles/types";
import type { MarketContextResult } from "../market-context/types";
import type { MarketStructureResult } from "../market-structure/types";
import {
  ACTIVE_SIGNAL_ENGINE,
  BREAKOUT_STRATEGY_ID,
  calculateAsianRanges,
  clearV2AsianBreakoutCache,
  generateV2AsianBreakoutSignals,
} from ".";

describe("V2 Asian Range Breakout Retest", () => {
  beforeEach(clearV2AsianBreakoutCache);

  it("calculates a valid Asian range", () => {
    const input = inputFixture(buyDayCandles());
    const ranges = calculateAsianRanges(input.candles, input.structure.atr, "5m");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ valid: true, candlesCount: 84, rangeType: "COMPLETE" });
  });

  it("generates a confirmed breakout BUY signal on successful retest & confirmation", () => {
    const result = generateV2AsianBreakoutSignals(inputFixture(buyDayCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({
      engine: ACTIVE_SIGNAL_ENGINE,
      strategyId: BREAKOUT_STRATEGY_ID,
      type: "CONFIRMED_BUY",
      v2Direction: "BUY",
      immutable: true,
    });
    expect(result.signals[0].entryPrice).toBeGreaterThan(result.signals[0].stopLoss);
    expect(result.signals[0].rr).toBeGreaterThanOrEqual(1.5);
    expect(result.signals[0].score).toBeGreaterThanOrEqual(60);
  });

  it("generates a confirmed breakout BUY signal with a partial Asian range", () => {
    const result = generateV2AsianBreakoutSignals(inputFixture(partialBuyDayCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].asianRange).toMatchObject({ rangeType: "PARTIAL", isPartial: true });
    expect(result.signals[0].asianRange?.warnings).toContain("WARNING_PARTIAL_ASIAN_RANGE");
    expect(result.audit.v2Breakout?.partialAsianRanges).toBe(1);
    expect(result.audit.v2Breakout?.confirmedSignalsUsingPartialRange).toBe(1);
  });

  it("generates a confirmed breakout BUY signal with a large range warning", () => {
    const result = generateV2AsianBreakoutSignals(inputFixture(largeRangeBuyDayCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].asianRange?.warnings).toContain("WARNING_LARGE_ASIAN_RANGE");
    expect(result.signals[0].warnings.join(" ")).toContain("Asian range is large compared with ATR");
    expect(result.audit.v2Breakout?.largeRangeWarnings).toBe(1);
    expect(result.audit.v2Breakout?.confirmedSignalsUsingLargeRange).toBe(1);
  });

  it("generates a confirmed breakout SELL signal on successful retest & confirmation", () => {
    const result = generateV2AsianBreakoutSignals(inputFixture(sellDayCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({
      engine: ACTIVE_SIGNAL_ENGINE,
      strategyId: BREAKOUT_STRATEGY_ID,
      type: "CONFIRMED_SELL",
      v2Direction: "SELL",
      immutable: true,
    });
    expect(result.signals[0].entryPrice).toBeLessThan(result.signals[0].stopLoss);
    expect(result.signals[0].rr).toBeGreaterThanOrEqual(1.5);
    expect(result.signals[0].score).toBeGreaterThanOrEqual(60);
  });

  it("rejects when breakout candle momentum is too weak", () => {
    // Modify breakout candle to have very small body (less than 45% of range)
    const candles = buyDayCandles();
    const breakoutIndex = 84; // candle at 07:00
    const baseCandle = candles[breakoutIndex];
    candles[breakoutIndex] = candleAt(
      baseCandle.timestamp,
      baseCandle.open,
      baseCandle.open + 0.5,
      baseCandle.open - 0.45,
      baseCandle.open + 0.02 // very tiny body!
    );
    const result = generateV2AsianBreakoutSignals(inputFixture(candles));
    expect(result.signals).toHaveLength(0);
    expect(
      result.rejectedSetups.some((setup) =>
        setup.rejectionReasonCodes.includes("WEAK_BREAKOUT_MOMENTUM")
      )
    ).toBe(true);
  });

  it("rejects when retest closes back inside the Asian range", () => {
    // Modify retest candle to close inside the range
    const candles = buyDayCandles();
    const retestIndex = 86; // candle at 07:10
    const baseCandle = candles[retestIndex];
    // Asian high is around 100.8. Let's make it close inside the range at 100.5
    candles[retestIndex] = candleAt(
      baseCandle.timestamp,
      100.82,
      100.85,
      100.4,
      100.5
    );
    const result = generateV2AsianBreakoutSignals(inputFixture(candles));
    expect(result.signals).toHaveLength(0);
  });
});

// Fixtures
function inputFixture(candles: Candle[]) {
  return {
    candles,
    symbol: "XAUUSD",
    timeframe: "5m" as const,
    startDate: "2026-05-20",
    endDate: "2026-05-20",
    structure: structureFixture(candles),
    context: contextFixture(),
    settings: {
      maxRiskAmount: 100,
    },
  };
}

function buyDayCandles(): Candle[] {
  const candles: Candle[] = [];
  const start = Date.UTC(2026, 4, 20, 0, 0); // 00:00 UTC
  // Asian session: 00:00 to 07:00 (84 candles of 5m)
  for (let index = 0; index < 120; index += 1) {
    const timestamp = start + index * 5 * 60000;
    const isAsian = index < 84;
    // Generate a bounded 100.2 to 100.8 Asian range.
    const wave = Math.sin((index / 84) * Math.PI * 2) * 0.15;
    let open = 100.5 + wave;
    let close = open + (index % 2 === 0 ? 0.05 : -0.05);
    let high = Math.max(open, close) + 0.02;
    let low = Math.min(open, close) - 0.02;
    if (isAsian && index === 20) low = 100.2;
    if (isAsian && index === 60) high = 100.8;

    if (!isAsian) {
      // Post-Asian session (London)
      if (index === 84) {
        // Breakout candle: closes above Asian high (100.8) with good momentum
        // Body: 100.82 -> 100.99 (0.17). Range: 100.80 -> 101.00 (0.20). Body/Range = 85%
        // Closes near high.
        open = 100.82;
        close = 100.99;
        high = 101.00;
        low = 100.80;
      } else if (index === 85) {
        // High wick / consolidation
        open = 100.99;
        close = 101.05;
        high = 101.10;
        low = 100.95;
      } else if (index === 86) {
        // Retest candle: low touches near Asian high (100.8), close stays above
        open = 100.95;
        close = 100.90;
        high = 101.00;
        low = 100.81; // touches above Asian high
      } else if (index === 87) {
        // Confirmation candle: bullish candle (close > open)
        // Body: 100.90 -> 101.05 (0.15). Range: 100.88 -> 101.08 (0.20). Body/Range = 75%
        open = 100.90;
        close = 101.05;
        high = 101.08;
        low = 100.88;
      } else {
        // Follow through / extension
        close = 101.10 + (index - 84) * 0.02;
        high = close + 0.02;
        low = close - 0.02;
      }
    }
    candles.push(candleAt(timestamp, open, high, low, close));
  }
  return candles;
}

function partialBuyDayCandles(): Candle[] {
  return buyDayCandles().slice(36);
}

function largeRangeBuyDayCandles(): Candle[] {
  const candles = buyDayCandles();
  candles[20] = candleAt(candles[20].timestamp, 100.42, 100.5, 99.6, 100.45);
  return candles;
}

function sellDayCandles(): Candle[] {
  const candles: Candle[] = [];
  const start = Date.UTC(2026, 4, 20, 0, 0); // 00:00 UTC
  // Asian session: 00:00 to 07:00 (84 candles of 5m)
  for (let index = 0; index < 120; index += 1) {
    const timestamp = start + index * 5 * 60000;
    const isAsian = index < 84;
    // Generate a bounded 100.2 to 100.8 Asian range.
    const wave = Math.sin((index / 84) * Math.PI * 2) * 0.15;
    let open = 100.5 + wave;
    let close = open + (index % 2 === 0 ? -0.05 : 0.05);
    let high = Math.max(open, close) + 0.02;
    let low = Math.min(open, close) - 0.02;
    if (isAsian && index === 20) high = 100.8;
    if (isAsian && index === 60) low = 100.2;

    if (!isAsian) {
      // Post-Asian session (London)
      if (index === 84) {
        // Breakout candle: closes below Asian low (100.2) with good momentum
        open = 100.18;
        close = 100.01;
        high = 100.20;
        low = 100.00;
      } else if (index === 85) {
        // Low wick / consolidation
        open = 100.01;
        close = 99.95;
        high = 100.05;
        low = 99.90;
      } else if (index === 86) {
        // Retest candle: high touches near Asian low (100.2), close stays below
        open = 100.05;
        close = 100.10;
        high = 100.19; // touches near Asian low
        low = 100.00;
      } else if (index === 87) {
        // Confirmation candle: bearish candle (close < open)
        open = 100.08;
        close = 99.95;
        high = 100.10;
        low = 99.90;
      } else {
        // Follow through / extension
        close = 99.90 - (index - 84) * 0.02;
        high = close + 0.02;
        low = close - 0.02;
      }
    }
    candles.push(candleAt(timestamp, open, high, low, close));
  }
  return candles;
}

function structureFixture(candles: Candle[]): MarketStructureResult {
  const atr = candles.map(() => 0.15); // small ATR so that breakout distance checks pass
  return {
    candles,
    markers: [],
    markerMap: new Map(),
    liquidityZones: [],
    liquidityZoneMap: new Map(),
    fvgZones: [],
    atr,
    audit: {
      totalCandles: candles.length,
      totalSwingHighs: 0,
      totalSwingLows: 0,
      totalBslZones: 0,
      totalSslZones: 0,
      totalEqualHighZones: 0,
      totalEqualLowZones: 0,
      totalSweeps: 0,
      totalSslSweeps: 0,
      totalBslSweeps: 0,
      totalMomentumCandles: 0,
      totalBullishMomentum: 0,
      totalBearishMomentum: 0,
      totalBuyersMarkers: 0,
      totalSellersMarkers: 0,
      totalBos: 0,
      totalChoch: 0,
      totalMss: 0,
      totalFvg: 0,
      totalMitigatedFvg: 0,
      calculationTimeMs: 0,
      lastMarkerCreated: null,
      currentStructureState: "RANGING",
      markerSensitivitySettings: { sensitivity: "normal", leftBars: 2, rightBars: 2, atrPeriod: 14, showOnlyMajor: false },
      cacheStatus: "miss",
      validationWarnings: [],
      noRepaintValidationStatus: "pass",
    },
  };
}

function contextFixture(): MarketContextResult {
  return {
    mapping: { ltf: "5m", itf: "15m", htf: "1h", modeName: "5M SCALPING" },
    itfCandles: [],
    htfCandles: [],
    htfBias: { bias: "NEUTRAL", strength: 50, structureState: "RANGING", lastBos: null, lastChoch: null, majorSwingHigh: null, majorSwingLow: null, reason: "fixture", warnings: [] },
    itfSetup: { setupState: "NO_SETUP", direction: "NONE", strength: 0, relatedLiquidity: null, relatedSweep: null, relatedDisplacement: null, relatedStructure: null, pullbackZone: null, reason: "fixture", invalidation: null },
    premiumDiscount: null,
    levels: [],
    nearestLevels: { nearestResistance: null, nearestSupport: null, nearestBSL: null, nearestSSL: null, distanceToResistance: null, distanceToSupport: null },
    regime: { regime: "LIQUIDITY_GRAB", confidence: 70, trendQuality: 50, rangeQuality: 50, volatilityQuality: 70, chopRisk: 20, reason: "fixture", warnings: [] },
    session: { session: "LONDON", displayTimezone: "UTC", sessionQuality: 80, sessionOpen: null, sessionClose: null, currentSessionHigh: null, currentSessionLow: null, previousSessionHigh: null, previousSessionLow: null, sessionBias: "NEUTRAL", reason: "fixture" },
    volatility: { state: "NORMAL_VOLATILITY", atr: 0.15, atrPercentile: 50, averageRange: 0.15, expansionRatio: 1, warning: null, reason: "fixture" },
    score: { overallScore: 70, directionPreference: "NEUTRAL", tradeEnvironment: "GOOD", reason: "fixture", warnings: [] },
    wait: { shouldWait: false, waitReasons: [], requiredForImprovement: [] },
    cacheStatus: "miss",
  };
}

function candleAt(timestamp: number, open: number, high: number, low: number, close: number): Candle {
  return {
    time: new Date(timestamp).toISOString(),
    timestamp,
    open,
    high,
    low,
    close,
    volume: 100,
    closeTime: timestamp + 299_999,
    isClosed: true,
  };
}
