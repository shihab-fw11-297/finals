import { describe, expect, it } from "vitest";

import { evaluateSignalFollowThrough, trackSignalPostTradeFollowThrough } from "./signal-follow-through-engine";

import type { Candle } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { MarketContextResult } from "../market-context/types";

describe("SIGNAL_FOLLOW_THROUGH_ENGINE", () => {
  it("scores a BUY with clean bullish HTF runway as high follow-through", () => {
    const candles = buildCandles("BUY");
    const signal = buildSignal("BUY", candles.length - 1);
    const result = evaluateSignalFollowThrough({
      signal,
      candles,
      ltfCandles: [],
      itfCandles: [],
      htfCandles: [],
      timeframe: "5m",
      atr: 1,
      session: "NEW_YORK",
      marketContext: buildContext("BUY", 103),
      historicalSignalStats: { sampleSize: 40, winRate: 0.62, expectancyR: 0.35, averageMfeR: 1.4 },
    });

    expect(result.followThroughScore).toBeGreaterThanOrEqual(78);
    expect(["A+", "A"]).toContain(result.followThroughGrade);
    expect(result.expectedMoveSide).toBe("UP");
    expect(result.nearestTarget?.type).toBe("BSL");
    expect(result.chartOverlay.markerLabel).toMatch(/^BUY A/);
    expect(result.chartOverlay.runwayArrow.direction).toBe("UP");
  });

  it("scores a SELL with clean bearish HTF runway as high follow-through", () => {
    const candles = buildCandles("SELL");
    const signal = buildSignal("SELL", candles.length - 1);
    const result = evaluateSignalFollowThrough({
      signal,
      candles,
      ltfCandles: [],
      itfCandles: [],
      htfCandles: [],
      timeframe: "5m",
      atr: 1,
      session: "LONDON",
      marketContext: buildContext("SELL", 97),
      historicalSignalStats: { sampleSize: 40, winRate: 0.61, expectancyR: 0.28, averageMfeR: 1.25 },
    });

    expect(result.followThroughScore).toBeGreaterThanOrEqual(78);
    expect(["A+", "A"]).toContain(result.followThroughGrade);
    expect(result.expectedMoveSide).toBe("DOWN");
    expect(result.nearestTarget?.type).toBe("SSL");
    expect(result.chartOverlay.runwayArrow.direction).toBe("DOWN");
  });

  it("marks a BUY directly into HTF supply as AVOID", () => {
    const candles = buildCandles("BUY");
    const signal = buildSignal("BUY", candles.length - 1);
    const context = buildContext("BUY", 103, { obstaclePrice: 100.7, obstacleReason: "HTF supply obstacle" });
    const result = evaluateSignalFollowThrough({ signal, candles, ltfCandles: [], itfCandles: [], htfCandles: [], timeframe: "5m", atr: 1, session: "NEW_YORK", marketContext: context });

    expect(result.followThroughGrade).toBe("AVOID");
    expect(result.hardBlockers.join(" ")).toContain("Obstacle before 0.8R");
    expect(result.nearestObstacle?.distanceR).toBeLessThan(0.8);
  });

  it("marks a SELL directly into HTF demand as AVOID", () => {
    const candles = buildCandles("SELL");
    const signal = buildSignal("SELL", candles.length - 1);
    const context = buildContext("SELL", 97, { obstaclePrice: 99.3, obstacleReason: "HTF demand obstacle" });
    const result = evaluateSignalFollowThrough({ signal, candles, ltfCandles: [], itfCandles: [], htfCandles: [], timeframe: "5m", atr: 1, session: "LONDON", marketContext: context });

    expect(result.followThroughGrade).toBe("AVOID");
    expect(result.hardBlockers.join(" ")).toContain("Obstacle before 0.8R");
    expect(result.nearestObstacle?.distanceR).toBeLessThan(0.8);
  });

  it("rewards strong displacement and downgrades weak displacement", () => {
    const strongCandles = buildCandles("BUY");
    const weakCandles = buildCandles("BUY", { weakConfirmation: true });
    const strong = evaluateSignalFollowThrough({ signal: buildSignal("BUY", strongCandles.length - 1), candles: strongCandles, ltfCandles: [], itfCandles: [], htfCandles: [], timeframe: "5m", atr: 1, session: "NEW_YORK", marketContext: buildContext("BUY", 103) });
    const weak = evaluateSignalFollowThrough({ signal: buildSignal("BUY", weakCandles.length - 1), candles: weakCandles, ltfCandles: [], itfCandles: [], htfCandles: [], timeframe: "5m", atr: 1, session: "NEW_YORK", marketContext: buildContext("BUY", 103) });

    expect(strong.debug.displacementScore).toBeGreaterThan(weak.debug.displacementScore);
    expect(weak.failedFactors).toContain("WEAK_DISPLACEMENT");
  });

  it("freezes score inputs at confirmation and does not repaint with future candles", () => {
    const candles = buildCandles("BUY");
    const signal = buildSignal("BUY", candles.length - 1);
    const original = evaluateSignalFollowThrough({ signal, candles, ltfCandles: candles, itfCandles: [], htfCandles: [], timeframe: "5m", atr: 1, session: "NEW_YORK", marketContext: buildContext("BUY", 103) });
    const futureCandles = [...candles, ...buildFutureCandles(candles.at(-1)?.timestamp ?? 0)];
    const recalculated = evaluateSignalFollowThrough({ signal, candles: futureCandles, ltfCandles: futureCandles, itfCandles: [], htfCandles: [], timeframe: "5m", atr: 1, session: "NEW_YORK", marketContext: buildContext("BUY", 103) });

    expect(recalculated.followThroughScore).toBe(original.followThroughScore);
    expect(recalculated.noRepaintProof).toEqual(original.noRepaintProof);
    expect(recalculated.noRepaintProof.scoreFrozen).toBe(true);
  });

  it("does not reject missing historical stats but reduces score for negative edge", () => {
    const candles = buildCandles("BUY");
    const signal = buildSignal("BUY", candles.length - 1);
    const missing = evaluateSignalFollowThrough({ signal, candles, ltfCandles: [], itfCandles: [], htfCandles: [], timeframe: "5m", atr: 1, session: "NEW_YORK", marketContext: buildContext("BUY", 103) });
    const negative = evaluateSignalFollowThrough({ signal, candles, ltfCandles: [], itfCandles: [], htfCandles: [], timeframe: "5m", atr: 1, session: "NEW_YORK", marketContext: buildContext("BUY", 103), historicalSignalStats: { sampleSize: 40, winRate: 0.38, expectancyR: -0.2, averageMfeR: 0.6 } });

    expect(missing.warnings).toContain("HISTORICAL_SAMPLE_MISSING");
    expect(missing.followThroughGrade).not.toBe("AVOID");
    expect(negative.followThroughScore).toBeLessThan(missing.followThroughScore);
    expect(negative.failedFactors).toContain("SIMILAR_SETUP_EDGE_NEGATIVE");
  });

  it("tracks post-trade MFE, MAE, bars to 1R, TP, and SL", () => {
    const candles = buildCandles("BUY");
    const signal = {
      ...buildSignal("BUY", candles.length - 1),
      followThrough: evaluateSignalFollowThrough({ signal: buildSignal("BUY", candles.length - 1), candles, ltfCandles: [], itfCandles: [], htfCandles: [], timeframe: "5m", atr: 1, session: "NEW_YORK", marketContext: buildContext("BUY", 103) }),
    };
    const analytics = trackSignalPostTradeFollowThrough(signal, [
      ...candles,
      candle(100_000, 100.2, 101.1, 99.9, 100.9),
      candle(101_000, 100.9, 102.2, 100.8, 102),
    ]);

    expect(analytics.result).toBe("WIN");
    expect(analytics.mfeR).toBeGreaterThanOrEqual(2);
    expect(analytics.maeR).toBeGreaterThan(0);
    expect(analytics.barsTo1R).toBe(1);
    expect(analytics.barsToTP).toBe(2);
    expect(analytics.followedExpectedDirection).toBe(true);
  });
});

function buildSignal(direction: "BUY" | "SELL", index: number): TradeSignal {
  const bullish = direction === "BUY";
  return {
    id: `${direction}-${index}`,
    engine: "V2_GOLDMINE",
    strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE",
    v2Direction: direction,
    type: bullish ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
    direction: bullish ? "BULLISH" : "BEARISH",
    status: "CONFIRMED",
    sourceSetupId: "test-setup",
    setupType: "LIQUIDITY_SWEEP_REVERSAL",
    strategyModel: "Stock Guru test BOS sweep model",
    mode: "V2_DEFAULT",
    timestamp: index * 60_000,
    candleIndex: index,
    confirmedAtIndex: index,
    timeframe: "5m",
    session: bullish ? "NEW_YORK" : "LONDON",
    entryPrice: 100,
    stopLoss: bullish ? 99 : 101,
    takeProfit: bullish ? 102 : 98,
    takeProfit2: null,
    takeProfit3: null,
    riskPoints: 1,
    rewardPoints: 2,
    rr: 2,
    score: 78,
    confidence: "STRONG",
    positionSizeSuggestion: 1,
    maxRiskAmount: 100,
    invalidationLevel: bullish ? 98.9 : 101.1,
    reasons: ["Close based BOS confirmed", "Sweep and reclaim confirmed"],
    warnings: [],
    rejectionReasons: [],
    relatedMarkers: [],
    noRepaintProof: { status: "PASS", signalIndex: index, latestAllowedCandleIndex: index, usedMarkerIndexes: [index], usedContextCloseTimes: [index * 60_000], usedSetupId: "test-setup", passed: true, lastAvailableIndex: index, maxEvidenceIndex: index, message: "No repaint proof passed." },
    stopLossDetail: { price: bullish ? 99 : 101, source: "TEST", buffer: 0, riskPoints: 1, reason: "Test stop" },
    takeProfitDetail: { tp1: bullish ? 102 : 98, tp2: null, tp3: null, source: "TEST", rewardPoints: 2, reason: "Test target" },
    scoreBreakdown: { phase4Setup: 10, contextAlignment: 10, confirmationCandle: 10, stopLossQuality: 10, targetQuality: 10, sessionQuality: 10, volatilityQuality: 10, antiReversal: 8 },
  };
}

function buildContext(direction: "BUY" | "SELL", targetPrice: number, options?: { obstaclePrice: number; obstacleReason: string }): MarketContextResult {
  const bullish = direction === "BUY";
  return {
    htfBias: { bias: bullish ? "BULLISH" : "BEARISH", strength: 80 },
    itfSetup: { direction: bullish ? "BULLISH" : "BEARISH" },
    nearestLevels: {
      nearestBSL: bullish ? { price: targetPrice, type: "BSL", strength: 3 } : null,
      nearestSSL: bullish ? null : { price: targetPrice, type: "SSL", strength: 3 },
      nearestResistance: bullish ? { price: targetPrice + 0.5, type: "MAJOR_SWING_HIGH", strength: 2 } : null,
      nearestSupport: bullish ? null : { price: targetPrice - 0.5, type: "MAJOR_SWING_LOW", strength: 2 },
    },
    levels: options
      ? [{ price: options.obstaclePrice, minPrice: options.obstaclePrice, maxPrice: options.obstaclePrice, type: "FVG", timeframe: "HTF", strength: 3, reason: options.obstacleReason }]
      : [],
    session: { session: bullish ? "NEW_YORK" : "LONDON", currentSessionHigh: null, currentSessionLow: null, previousSessionHigh: null, previousSessionLow: null },
    volatility: { state: "NORMAL_VOLATILITY", atr: 1 },
    itfCandles: [],
    htfCandles: [],
    regime: { regime: bullish ? "TRENDING_BULLISH" : "TRENDING_BEARISH" },
  } as unknown as MarketContextResult;
}

function buildCandles(direction: "BUY" | "SELL", options?: { weakConfirmation?: boolean }): Candle[] {
  const bullish = direction === "BUY";
  const candles = Array.from({ length: 29 }, (_, index) => {
    const base = bullish ? 96 + index * 0.12 : 104 - index * 0.12;
    return candle(index * 60_000, base, base + 0.35, base - 0.35, bullish ? base + 0.18 : base - 0.18);
  });
  candles.push(options?.weakConfirmation
    ? candle(29 * 60_000, bullish ? 99.95 : 100.05, bullish ? 100.18 : 100.25, bullish ? 99.86 : 99.82, bullish ? 100.02 : 99.98)
    : candle(29 * 60_000, bullish ? 99.1 : 100.9, bullish ? 100.35 : 101.2, bullish ? 98.8 : 99.65, bullish ? 100.25 : 99.75));
  return candles;
}

function buildFutureCandles(start: number): Candle[] {
  return [
    candle(start + 60_000, 100.2, 110, 100.1, 109),
    candle(start + 120_000, 109, 112, 90, 91),
  ];
}

function candle(timestamp: number, open: number, high: number, low: number, close: number): Candle {
  return { time: new Date(timestamp).toISOString(), timestamp, open, high, low, close, volume: 100, isClosed: true };
}
