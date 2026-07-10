import { describe, expect, it } from "vitest";

import type { Candle } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { FredMacroSeries, IntermarketSnapshot, NormalizedMarketCandle } from "../market-data/types";
import {
  evaluateIntermarketConfirmation,
} from "./intermarket-confirmation-gate";

describe("INTERMARKET_MACRO_CONFIRMATION_GATE", () => {
  it("supports an XAUUSD BUY when DXY and TNX are falling", () => {
    const signal = tradeSignal("BUY");
    const result = evaluateIntermarketConfirmation({
      signal,
      xauusdCandles: xauusdCandles(),
      dxyCandles: trendCandles("DX-Y.NYB", "down"),
      tnxCandles: trendCandles("^TNX", "down"),
      fredMacro: neutralFred(),
      timeframe: "5m",
      mode: "SCORE_ONLY",
    });

    expect(result.macroGrade).toBe("A");
    expect(result.dxyConfirmation.status).toMatch(/SUPPORTS/);
    expect(result.tnxConfirmation.status).toMatch(/SUPPORTS/);
    expect(result.shouldBlock).toBe(false);
  });

  it("flags an XAUUSD BUY conflict when DXY and TNX are rising strongly", () => {
    const signal = tradeSignal("BUY");
    const result = evaluateIntermarketConfirmation({
      signal,
      xauusdCandles: xauusdCandles(),
      dxyCandles: trendCandles("DX-Y.NYB", "up"),
      tnxCandles: trendCandles("^TNX", "up"),
      fredMacro: neutralFred(),
      timeframe: "5m",
      mode: "SCORE_ONLY",
    });

    expect(result.macroGrade).toBe("CONFLICT");
    expect(result.dxyConfirmation.status).toBe("STRONGLY_CONFLICTS");
    expect(result.tnxConfirmation.status).toBe("STRONGLY_CONFLICTS");
    expect(result.shouldBlock).toBe(false);
  });

  it("supports an XAUUSD SELL when DXY and TNX are rising", () => {
    const result = evaluateIntermarketConfirmation({
      signal: tradeSignal("SELL"),
      xauusdCandles: xauusdCandles(),
      dxyCandles: trendCandles("DX-Y.NYB", "up"),
      tnxCandles: trendCandles("^TNX", "up"),
      fredMacro: neutralFred(),
      timeframe: "5m",
      mode: "SCORE_ONLY",
    });

    expect(result.macroGrade).toBe("A");
    expect(result.dxyConfirmation.status).toMatch(/SUPPORTS/);
    expect(result.tnxConfirmation.status).toMatch(/SUPPORTS/);
  });

  it("flags an XAUUSD SELL conflict when DXY and TNX are falling strongly", () => {
    const result = evaluateIntermarketConfirmation({
      signal: tradeSignal("SELL"),
      xauusdCandles: xauusdCandles(),
      dxyCandles: trendCandles("DX-Y.NYB", "down"),
      tnxCandles: trendCandles("^TNX", "down"),
      fredMacro: neutralFred(),
      timeframe: "5m",
      mode: "SCORE_ONLY",
    });

    expect(result.macroGrade).toBe("CONFLICT");
    expect(result.dxyConfirmation.status).toBe("STRONGLY_CONFLICTS");
    expect(result.tnxConfirmation.status).toBe("STRONGLY_CONFLICTS");
  });

  it("does not let FRED alone hard block a 5M signal", () => {
    const result = evaluateIntermarketConfirmation({
      signal: tradeSignal("BUY"),
      xauusdCandles: xauusdCandles(),
      dxyCandles: trendCandles("DX-Y.NYB", "down"),
      tnxCandles: trendCandles("^TNX", "down"),
      fredMacro: bearishFred(),
      timeframe: "5m",
      mode: "BLOCK_STRONG_CONFLICT_ONLY",
    });

    expect(result.fredConfirmation.status).toBe("STRONGLY_CONFLICTS");
    expect(result.shouldBlock).toBe(false);
  });

  it("handles missing DXY without crashing or blocking", () => {
    const result = evaluateIntermarketConfirmation({
      signal: tradeSignal("BUY"),
      xauusdCandles: xauusdCandles(),
      dxyCandles: [],
      tnxCandles: trendCandles("^TNX", "up"),
      fredMacro: neutralFred(),
      timeframe: "5m",
      mode: "BLOCK_STRONG_CONFLICT_ONLY",
    });

    expect(result.macroGrade).toBe("UNKNOWN");
    expect(result.dxyConfirmation.status).toBe("UNKNOWN");
    expect(result.shouldBlock).toBe(false);
  });

  it("handles missing TNX without crashing or blocking", () => {
    const result = evaluateIntermarketConfirmation({
      signal: tradeSignal("SELL"),
      xauusdCandles: xauusdCandles(),
      dxyCandles: trendCandles("DX-Y.NYB", "down"),
      tnxCandles: [],
      fredMacro: neutralFred(),
      timeframe: "5m",
      mode: "BLOCK_STRONG_CONFLICT_ONLY",
    });

    expect(result.macroGrade).toBe("UNKNOWN");
    expect(result.tnxConfirmation.status).toBe("UNKNOWN");
    expect(result.shouldBlock).toBe(false);
  });

  it("SCORE_ONLY mode never blocks signals", () => {
    const result = evaluateIntermarketConfirmation({
      signal: tradeSignal("BUY"),
      xauusdCandles: xauusdCandles(),
      dxyCandles: trendCandles("DX-Y.NYB", "up"),
      tnxCandles: trendCandles("^TNX", "up"),
      fredMacro: bearishFred(),
      timeframe: "5m",
      mode: "SCORE_ONLY",
    });

    expect(result.macroGrade).toBe("CONFLICT");
    expect(result.shouldBlock).toBe(false);
  });

  it("BLOCK_STRONG_CONFLICT_ONLY blocks only when DXY and TNX both strongly conflict", () => {
    const result = evaluateIntermarketConfirmation({
      signal: tradeSignal("BUY"),
      xauusdCandles: xauusdCandles(),
      dxyCandles: trendCandles("DX-Y.NYB", "up"),
      tnxCandles: trendCandles("^TNX", "up"),
      fredMacro: neutralFred(),
      timeframe: "5m",
      mode: "BLOCK_STRONG_CONFLICT_ONLY",
    });

    expect(result.shouldBlock).toBe(true);
    expect(result.blockReason).toBe("DXY_AND_TNX_STRONG_MACRO_CONFLICT");
  });

  it("does not use future macro candles for historical signal evaluation", () => {
    const result = evaluateIntermarketConfirmation({
      signal: tradeSignal("BUY", BASE - 60_000),
      xauusdCandles: xauusdCandles(),
      dxyCandles: trendCandles("DX-Y.NYB", "down"),
      tnxCandles: trendCandles("^TNX", "down"),
      fredMacro: neutralFred(),
      timeframe: "5m",
      mode: "SCORE_ONLY",
    });

    expect(result.macroGrade).toBe("UNKNOWN");
    expect(result.debug.dxyCandlesUsed).toBe(0);
    expect(result.debug.tnxCandlesUsed).toBe(0);
  });
});

const BASE = Date.UTC(2026, 6, 1, 8, 0);

function trendCandles(symbol: string, direction: "up" | "down"): NormalizedMarketCandle[] {
  const start = direction === "up" ? 100 : 110;
  const step = direction === "up" ? 0.22 : -0.22;
  return Array.from({ length: 18 }, (_, index) => {
    const close = start + step * index;
    const open = close - step * 0.8;
    return {
      timestamp: BASE + index * 300_000,
      time: new Date(BASE + index * 300_000).toISOString(),
      open,
      high: Math.max(open, close) + 0.03,
      low: Math.min(open, close) - 0.03,
      close,
      volume: 100,
      source: "YAHOO",
      symbol,
      interval: "5m",
      isClosed: true,
    };
  });
}

function xauusdCandles(): Candle[] {
  return Array.from({ length: 18 }, (_, index) => ({
    timestamp: BASE + index * 300_000,
    time: new Date(BASE + index * 300_000).toISOString(),
    open: 2300,
    high: 2301,
    low: 2299,
    close: 2300,
    volume: 100,
    isClosed: true,
  }));
}

function neutralFred(): IntermarketSnapshot["fred"] {
  return {
    dgs10: fredSeries("DGS10", "FLAT", 4.1, 4.1, 0),
    dfii10: fredSeries("DFII10", "FLAT", 1.9, 1.9, 0),
    dailyBias: "NEUTRAL",
  };
}

function bearishFred(): IntermarketSnapshot["fred"] {
  return {
    dgs10: fredSeries("DGS10", "RISING", 4.2, 4.1, 0.04),
    dfii10: fredSeries("DFII10", "RISING", 2.1, 2.0, 0.05),
    dailyBias: "BEARISH_GOLD",
  };
}

function fredSeries(
  seriesId: string,
  bias: FredMacroSeries["bias"],
  latestValue: number,
  previousValue: number,
  threeDaySlope: number,
): FredMacroSeries {
  return {
    seriesId,
    latestValue,
    previousValue,
    oneDayChange: latestValue - previousValue,
    threeDaySlope,
    fiveDaySlope: threeDaySlope,
    twentyDayAverage: latestValue,
    bias,
    latestDate: "2026-07-01",
    previousDate: "2026-06-30",
  };
}

function tradeSignal(direction: "BUY" | "SELL", timestamp = BASE + 17 * 300_000): TradeSignal {
  const bullish = direction === "BUY";
  return {
    id: `${direction.toLowerCase()}-signal`,
    engine: "V2_GOLDMINE",
    strategyId: "PRO_LIQUIDITY_CONFLUENCE_ENGINE",
    v2Direction: direction,
    type: bullish ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
    direction: bullish ? "BULLISH" : "BEARISH",
    status: "CONFIRMED",
    sourceSetupId: `setup-${direction}`,
    setupType: "TREND_CONTINUATION",
    strategyModel: "CONTINUATION",
    mode: "V2_DEFAULT",
    timestamp,
    candleIndex: 17,
    confirmedAtIndex: 17,
    timeframe: "5m",
    session: "LONDON",
    entryPrice: bullish ? 2300 : 2300,
    stopLoss: bullish ? 2298 : 2302,
    takeProfit: bullish ? 2304 : 2296,
    takeProfit2: null,
    takeProfit3: null,
    riskPoints: 2,
    rewardPoints: 4,
    rr: 2,
    score: 80,
    confidence: "STRONG",
    positionSizeSuggestion: 1,
    maxRiskAmount: 100,
    invalidationLevel: bullish ? 2298 : 2302,
    reasons: ["Test signal"],
    warnings: [],
    rejectionReasons: [],
    relatedMarkers: [],
    noRepaintProof: { status: "PASS", signalIndex: 17, latestAllowedCandleIndex: 17, usedMarkerIndexes: [], usedContextCloseTimes: [], usedSetupId: `setup-${direction}`, passed: true, lastAvailableIndex: 17, maxEvidenceIndex: 17, message: "Test" },
    stopLossDetail: { price: bullish ? 2298 : 2302, source: "STRUCTURE", buffer: 0, riskPoints: 2, reason: "Test" },
    takeProfitDetail: { tp1: bullish ? 2304 : 2296, tp2: null, tp3: null, source: "LIQUIDITY", rewardPoints: 4, reason: "Test" },
    scoreBreakdown: { phase4Setup: 10, contextAlignment: 10, confirmationCandle: 10, stopLossQuality: 10, targetQuality: 10, sessionQuality: 10, volatilityQuality: 10, antiReversal: 10 },
  };
}
