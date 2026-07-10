import { beforeEach, describe, expect, it } from "vitest";

import type { Candle } from "../candles/types";
import type { MarketContextResult } from "../market-context/types";
import type { MarketStructureResult } from "../market-structure/types";
import { runBacktest } from "../backtesting/engine";
import {
  ACTIVE_SIGNAL_ENGINE,
  GOLDMINE_STRATEGY_ID,
  calculateAsianRanges,
  clearV2GoldmineCache,
  detectGoldmineSweep,
  generateV2GoldmineSignals,
  isGoldmineConfirmation,
} from ".";

describe("V2 Goldmine Asian Sweep Reversal", () => {
  beforeEach(clearV2GoldmineCache);

  it("calculates a valid Asian range", () => {
    const input = inputFixture(buyDayCandles());
    const ranges = calculateAsianRanges(input.candles, input.structure.atr, "5m");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ valid: true, candlesCount: 84, rangeType: "COMPLETE", isComplete: true });
    expect(ranges[0].high).toBeGreaterThan(ranges[0].low);
    expect(ranges[0].midpoint).toBeCloseTo((ranges[0].high + ranges[0].low) / 2, 5);
  });

  it("uses a partial Asian range as a warning, not a rejection", () => {
    const input = inputFixture(partialBuyDayCandles());
    const ranges = calculateAsianRanges(input.candles, input.structure.atr, "5m");
    expect(ranges[0]).toMatchObject({
      valid: true,
      rangeType: "PARTIAL",
      isPartial: true,
      candlesCount: 48,
    });
    expect(ranges[0].coverageRatio).toBeGreaterThanOrEqual(0.35);
    expect(ranges[0].warnings).toContain("WARNING_PARTIAL_ASIAN_RANGE");
  });

  it("uses a fallback range as a warning when no Asian candles are available", () => {
    const input = inputFixture(fallbackRangeCandles());
    const ranges = calculateAsianRanges(input.candles, input.structure.atr, "5m");
    expect(ranges[0]).toMatchObject({
      valid: true,
      rangeType: "FALLBACK",
      isFallback: true,
    });
    expect(ranges[0].coverageRatio).toBeGreaterThanOrEqual(0.35);
    expect(ranges[0].warnings).toContain("WARNING_FALLBACK_RANGE_USED");
  });

  it("marks an invalid Asian range when too few candles exist", () => {
    const input = inputFixture(buyDayCandles().slice(0, 8));
    const ranges = calculateAsianRanges(input.candles, input.structure.atr, "5m");
    expect(ranges[0].valid).toBe(false);
    expect(ranges[0].invalidCode).toBe("RANGE_CANDLES_TOO_FEW");
    expect(ranges[0].invalidReason).toContain("minimum");
  });

  it("rejects only truly unusable range data", () => {
    const result = generateV2GoldmineSignals(inputFixture(fallbackRangeCandles().slice(0, 8)));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("RANGE_CANDLES_TOO_FEW"))).toBe(true);
    expect(result.audit.v2Goldmine?.noUsableRangeRejections).toBeGreaterThan(0);
  });

  it("keeps a large Asian range as a warning", () => {
    const input = inputFixture(largeRangeBuyDayCandles());
    const ranges = calculateAsianRanges(input.candles, input.structure.atr, "5m");
    expect(ranges[0].valid).toBe(true);
    expect(ranges[0].warnings).toContain("WARNING_LARGE_ASIAN_RANGE");
  });

  it("detects bullish Asian low sweep and bearish Asian high sweep", () => {
    const buyInput = inputFixture(buyDayCandles());
    const sellInput = inputFixture(sellDayCandles());
    const buyRange = calculateAsianRanges(buyInput.candles, buyInput.structure.atr, "5m")[0];
    const sellRange = calculateAsianRanges(sellInput.candles, sellInput.structure.atr, "5m")[0];

    expect(detectGoldmineSweep(buyInput.candles[85], 85, buyRange)).toMatchObject({
      type: "ASIAN_LOW_SWEEP",
      direction: "BUY",
    });
    expect(detectGoldmineSweep(sellInput.candles[85], 85, sellRange)).toMatchObject({
      type: "ASIAN_HIGH_SWEEP",
      direction: "SELL",
    });
  });

  it("rejects a weak sweep rejection", () => {
    const candles = buyDayCandles();
    candles[85] = candleAt(Date.UTC(2026, 4, 20, 7, 5), 100.05, 100.55, 99.95, 100.01);
    const result = generateV2GoldmineSignals(inputFixture(candles));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("WEAK_SWEEP_REJECTION"))).toBe(true);
  });

  it("validates BUY and SELL confirmation candles", () => {
    expect(isGoldmineConfirmation(buyDayCandles(), 86, "BUY")).toMatchObject({
      candleIndex: 86,
    });
    expect(isGoldmineConfirmation(sellDayCandles(), 86, "SELL")).toMatchObject({
      candleIndex: 86,
    });
  });

  it("generates a confirmed BUY signal from a bullish Asian low sweep", () => {
    const result = generateV2GoldmineSignals(inputFixture(buyDayCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({
      engine: ACTIVE_SIGNAL_ENGINE,
      strategyId: GOLDMINE_STRATEGY_ID,
      type: "CONFIRMED_BUY",
      v2Direction: "BUY",
      immutable: true,
    });
    expect(result.signals[0].entryPrice).toBeGreaterThan(result.signals[0].stopLoss);
    expect(result.signals[0].rr).toBeGreaterThanOrEqual(1);
  });

  it("generates a Goldmine BUY signal with a partial Asian range", () => {
    const result = generateV2GoldmineSignals(inputFixture(partialBuyDayCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].asianRange).toMatchObject({ rangeType: "PARTIAL", isPartial: true });
    expect(result.signals[0].asianRange?.warnings).toContain("WARNING_PARTIAL_ASIAN_RANGE");
    expect(result.audit.v2Goldmine?.partialAsianRanges).toBe(1);
    expect(result.audit.v2Goldmine?.confirmedSignalsUsingPartialRange).toBe(1);
  });

  it("generates a Goldmine BUY signal with a large range warning", () => {
    const result = generateV2GoldmineSignals(inputFixture(largeRangeBuyDayCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].asianRange?.warnings).toContain("WARNING_LARGE_ASIAN_RANGE");
    expect(result.signals[0].warnings.join(" ")).toContain("Asian range is large compared with ATR");
    expect(result.audit.v2Goldmine?.largeRangeWarnings).toBe(1);
    expect(result.audit.v2Goldmine?.confirmedSignalsUsingLargeRange).toBe(1);
  });

  it("generates a confirmed SELL signal from a bearish Asian high sweep", () => {
    const result = generateV2GoldmineSignals(inputFixture(sellDayCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({
      engine: ACTIVE_SIGNAL_ENGINE,
      strategyId: GOLDMINE_STRATEGY_ID,
      type: "CONFIRMED_SELL",
      v2Direction: "SELL",
      immutable: true,
    });
    expect(result.signals[0].stopLoss).toBeGreaterThan(result.signals[0].entryPrice);
    expect(result.signals[0].takeProfit).toBeLessThan(result.signals[0].entryPrice);
  });

  it("uses fixed RR fallback when liquidity targets are not available", () => {
    const result = generateV2GoldmineSignals(inputFixture(buyDayCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].takeProfitDetail.source).toContain("V2_FALLBACK");
  });

  it("prevents duplicate signals with the stable signal map", () => {
    const result = generateV2GoldmineSignals(inputFixture([...buyDayCandles(), ...buyDayCandles()]));
    expect(result.signalMap.size).toBe(result.signals.length);
    expect(new Set(result.signals.map((signal) => signal.id)).size).toBe(result.signals.length);
  });

  it("scans full history and returns multiple V2 signals", () => {
    const result = generateV2GoldmineSignals(inputFixture([...buyDayCandles(), ...sellDayCandles(1)]));
    expect(result.signals.length).toBeGreaterThanOrEqual(2);
    expect(result.signals.map((signal) => signal.type)).toContain("CONFIRMED_BUY");
    expect(result.signals.map((signal) => signal.type)).toContain("CONFIRMED_SELL");
    expect(result.audit.v2Goldmine?.daysDetected).toBe(2);
  });

  it("uses no future candles to create the V2 signal", () => {
    const result = generateV2GoldmineSignals(inputFixture(buyDayCandles()));
    const signal = result.signals[0];
    expect(signal.noRepaintProof.passed).toBe(true);
    expect(signal.noRepaintProof.maxEvidenceIndex).toBeLessThanOrEqual(signal.confirmedAtIndex);
    expect(signal.asianRange!.sessionEnd).toBeLessThan(signal.sweep!.timestamp);
  });

  it("backtest uses only V2 Goldmine signals", () => {
    const result = generateV2GoldmineSignals(inputFixture(buyDayCandles()));
    const legacy = { ...result.signals[0], id: "legacy-signal", engine: undefined };
    const backtest = runBacktest({
      candles: buyDayCandles(),
      signals: [legacy, result.signals[0]],
      rejectedSetups: [],
      symbol: "XAUUSD",
      timeframe: "5m",
      startDate: "2026-05-20T00:00",
      endDate: "2026-05-20T12:00",
      settings: { signalMode: "NORMAL_SCALP" as const, enablePartials: false, enableBreakeven: false },
      marketRegime: "LIQUIDITY_GRAB",
    });
    expect(backtest.trades).toHaveLength(1);
    expect(backtest.trades[0].signalId).toBe(result.signals[0].id);
  });
});

function inputFixture(candles: Candle[]) {
  return {
    candles,
    symbol: "XAUUSD",
    timeframe: "5m" as const,
    startDate: candles[0]?.time ?? "2026-05-20T00:00",
    endDate: candles.at(-1)?.time ?? "2026-05-20T12:00",
    structure: structureFixture(candles),
    context: contextFixture(),
    settings: { maxRiskAmount: 100 },
  };
}

function buyDayCandles(dayOffset = 0): Candle[] {
  const candles = asianCandles(dayOffset);
  candles.push(candleAt(Date.UTC(2026, 4, 20 + dayOffset, 7, 0), 100.35, 100.55, 100.2, 100.4));
  candles.push(candleAt(Date.UTC(2026, 4, 20 + dayOffset, 7, 5), 100.3, 100.5, 99.5, 100.25));
  candles.push(candleAt(Date.UTC(2026, 4, 20 + dayOffset, 7, 10), 100.25, 101.3, 100.2, 101.2));
  candles.push(candleAt(Date.UTC(2026, 4, 20 + dayOffset, 7, 15), 101.2, 102.2, 101.1, 101.9));
  return candles;
}

function sellDayCandles(dayOffset = 0): Candle[] {
  const candles = asianCandles(dayOffset);
  candles.push(candleAt(Date.UTC(2026, 4, 20 + dayOffset, 7, 0), 100.65, 100.8, 100.45, 100.6));
  candles.push(candleAt(Date.UTC(2026, 4, 20 + dayOffset, 7, 5), 100.7, 101.5, 100.45, 100.75));
  candles.push(candleAt(Date.UTC(2026, 4, 20 + dayOffset, 7, 10), 100.75, 100.8, 99.7, 99.8));
  candles.push(candleAt(Date.UTC(2026, 4, 20 + dayOffset, 7, 15), 99.8, 99.9, 98.9, 99.2));
  return candles;
}

function partialBuyDayCandles(): Candle[] {
  const candles = buyDayCandles();
  candles[40] = candleAt(candles[40].timestamp, 100.42, 100.62, 100.1, 100.46);
  return candles.slice(36);
}

function largeRangeBuyDayCandles(): Candle[] {
  const candles = buyDayCandles();
  candles[10] = candleAt(candles[10].timestamp, 100.5, 102.1, 100.35, 100.55);
  return candles;
}

function fallbackRangeCandles(): Candle[] {
  const candles: Candle[] = [];
  const start = Date.UTC(2026, 4, 20, 8, 0);
  for (let index = 0; index < 84; index += 1) {
    const timestamp = start + index * 5 * 60000;
    const wave = ((index % 10) - 5) * 0.02;
    const open = 100.5 + wave;
    const close = open + (index % 2 === 0 ? 0.03 : -0.03);
    let high = Math.max(open, close) + 0.1;
    let low = Math.min(open, close) - 0.1;
    if (index === 15) high = 101;
    if (index === 35) low = 100.05;
    candles.push(candleAt(timestamp, open, high, low, close));
  }
  return candles;
}

function asianCandles(dayOffset: number): Candle[] {
  const candles: Candle[] = [];
  for (let index = 0; index < 84; index += 1) {
    const timestamp = Date.UTC(2026, 4, 20 + dayOffset, 0, index * 5);
    const wave = ((index % 8) - 4) * 0.025;
    const open = 100.5 + wave;
    const close = open + (index % 2 === 0 ? 0.04 : -0.04);
    let high = Math.max(open, close) + 0.12;
    let low = Math.min(open, close) - 0.12;
    if (index === 10) high = 101;
    if (index === 20) low = 100;
    candles.push(candleAt(timestamp, open, high, low, close));
  }
  return candles;
}

function structureFixture(candles: Candle[]): MarketStructureResult {
  const atr = candles.map(() => 0.25);
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
    volatility: { state: "NORMAL_VOLATILITY", atr: 0.25, atrPercentile: 50, averageRange: 0.25, expansionRatio: 1, warning: null, reason: "fixture" },
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
