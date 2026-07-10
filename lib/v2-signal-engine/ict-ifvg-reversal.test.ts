import { beforeEach, describe, expect, it } from "vitest";

import type { Candle } from "../candles/types";
import type { MarketContextResult } from "../market-context/types";
import type { MarketStructureResult } from "../market-structure/types";
import {
  ACTIVE_SIGNAL_ENGINE,
  ICT_IFVG_REVERSAL_STRATEGY_ID,
  clearIctIfvgReversalCache,
  generateIctIfvgReversalSignals,
} from ".";

describe("V2 ICT IFVG Reversal Engine", () => {
  beforeEach(clearIctIfvgReversalCache);

  it("registers and exports the clear and generate functions correctly", () => {
    expect(clearIctIfvgReversalCache).toBeTypeOf("function");
    expect(generateIctIfvgReversalSignals).toBeTypeOf("function");
  });

  it("handles empty or insufficient candles gracefully", () => {
    const input = inputFixture([]);
    const result = generateIctIfvgReversalSignals(input);
    expect(result.signals).toHaveLength(0);
    expect(result.audit.v2IctIfvgReversal?.candlesScanned).toBe(0);
  });

  it("detects when a standard FVG fails and flips into an Inverted FVG (IFVG)", () => {
    const candles: Candle[] = [];
    const baseTime = Date.UTC(2026, 6, 8, 8, 0);

    // Build 30 candles of baseline
    for (let i = 0; i < 30; i++) {
      candles.push(candleAt(baseTime + i * 300000, 100.50, 100.55, 100.45, 100.50));
    }

    // Now insert our BEARISH FVG on candles 30, 31, 32
    // Candle 30 (high/low for first)
    candles.push(candleAt(baseTime + 30 * 300000, 100.70, 100.80, 100.50, 100.60));
    // Candle 31 (displacement down)
    candles.push(candleAt(baseTime + 31 * 300000, 100.60, 100.65, 100.32, 100.35));
    // Candle 32 (low/high for third)
    candles.push(candleAt(baseTime + 32 * 300000, 100.35, 100.38, 100.00, 100.05));

    // Candle 33: Inversion Breakout
    // Closes above 100.50 + buffer (100.504)
    candles.push(candleAt(baseTime + 33 * 300000, 100.05, 100.70, 100.00, 100.65));

    // Candle 34: Retest touching the IFVG zone (100.38 to 100.50) without invalidating (not closing below 100.37)
    candles.push(candleAt(baseTime + 34 * 300000, 100.65, 100.65, 100.40, 100.45));

    // Candle 35: Bullish Confirmation close above midpoint (100.44) with good body & close position
    candles.push(candleAt(baseTime + 35 * 300000, 100.45, 100.65, 100.42, 100.60));

    const input = inputFixture(candles);
    const result = generateIctIfvgReversalSignals(input);

    expect(result.signals).toHaveLength(1);
    const signal = result.signals[0];
    expect(signal).toMatchObject({
      engine: ACTIVE_SIGNAL_ENGINE,
      strategyId: ICT_IFVG_REVERSAL_STRATEGY_ID,
      direction: "BULLISH",
      type: "CONFIRMED_BUY",
    });

    expect(signal.entryPrice).toBe(100.60);
    expect(signal.stopLoss).toBeLessThan(100.60);
    expect(signal.takeProfit).toBeGreaterThan(100.60);
    expect(signal.rr).toBeGreaterThanOrEqual(1.5);
  });
});

function inputFixture(candles: Candle[]) {
  return {
    candles,
    symbol: "XAUUSD",
    timeframe: "5m" as const,
    startDate: candles[0]?.time ?? "2026-07-08T08:00",
    endDate: candles.at(-1)?.time ?? "2026-07-08T09:00",
    structure: structureFixture(candles),
    context: contextFixture(),
    settings: { maxRiskAmount: 100 },
  };
}

function structureFixture(candles: Candle[]): MarketStructureResult {
  const atr = candles.map(() => 0.10);
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
    regime: { regime: "RANGING", confidence: 70, trendQuality: 50, rangeQuality: 50, volatilityQuality: 70, chopRisk: 20, reason: "fixture", warnings: [] },
    session: { session: "LONDON", displayTimezone: "UTC", sessionQuality: 80, sessionOpen: null, sessionClose: null, currentSessionHigh: null, currentSessionLow: null, previousSessionHigh: null, previousSessionLow: null, sessionBias: "NEUTRAL", reason: "fixture" },
    volatility: { state: "NORMAL_VOLATILITY", atr: 0.10, atrPercentile: 50, averageRange: 0.10, expansionRatio: 1, warning: null, reason: "fixture" },
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
