import { beforeEach, describe, expect, it } from "vitest";

import type { Candle } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { RejectedSetup } from "../entry-engine/types";
import {
  calculateMaxDrawdown,
  calculatePerformanceMetrics,
  clearBacktestCache,
  runBacktest,
  runIntermarketMacroBacktestComparison,
  simulatePropFirm,
} from "./engine";

describe("Phase 7 backtesting engine", () => {
  beforeEach(clearBacktestCache);

  it("uses confirmed V2 Goldmine signals and validates no future signal evidence", () => {
    const result = runBacktest({ ...baseInput(), signals: [signalFixture()] });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].signalId).toBe("signal-buy");
    expect(result.trades[0].noFutureValidation).toMatchObject({
      signalId: "signal-buy",
      confirmedAtIndex: 1,
      maxDataIndexUsedForSignal: 1,
      passedNoFutureCheck: true,
    });
  });

  it("ignores active and rapid signals in backtests", () => {
    const result = runBacktest({
      ...baseInput(),
      signals: [
        signalFixture({ id: "active-signal", status: "ACTIVE" }),
        signalFixture({ id: "rapid-signal", type: "RAPID_BUY" }),
      ],
    });
    expect(result.trades).toHaveLength(0);
    expect(result.audit.signalCountInput).toBe(2);
    expect(result.audit.signalCountTested).toBe(0);
  });

  it("does not evaluate results before the signal confirmation candle", () => {
    const result = runBacktest({
      ...baseInput(),
      candles: [
        candle(0, 100, 101, 99, 100),
        candle(1, 100, 100.4, 99.8, 100),
        candle(2, 100, 101.2, 99.9, 101),
      ],
      signals: [signalFixture()],
    });
    expect(result.trades[0].entryIndex).toBe(1);
    expect(result.trades[0].exitIndex).toBe(2);
    expect(result.trades[0].result).toBe("WIN");
  });

  it("calculates a BUY win result", () => {
    const result = runBacktest({ ...baseInput(), signals: [signalFixture()] });
    expect(result.trades[0]).toMatchObject({ result: "WIN", finalR: 1 });
  });

  it("calculates a BUY loss result", () => {
    const result = runBacktest({
      ...baseInput(),
      candles: [candle(0, 100, 100.5, 99.5, 100), candle(1, 100, 100.3, 99.7, 100), candle(2, 100, 100.2, 98.8, 99)],
      signals: [signalFixture()],
    });
    expect(result.trades[0]).toMatchObject({ result: "LOSS", finalR: -1 });
  });

  it("calculates a SELL win result", () => {
    const result = runBacktest({
      ...baseInput(),
      candles: [candle(0, 100, 101, 99, 100), candle(1, 100, 100.3, 99.7, 100), candle(2, 100, 100.1, 98.7, 99)],
      signals: [signalFixture({ id: "signal-sell", direction: "BEARISH", entryPrice: 100, stopLoss: 101, takeProfit: 99, type: "CONFIRMED_SELL" })],
    });
    expect(result.trades[0]).toMatchObject({ result: "WIN", finalR: 1 });
  });

  it("calculates a SELL loss result", () => {
    const result = runBacktest({
      ...baseInput(),
      candles: [candle(0, 100, 101, 99, 100), candle(1, 100, 100.3, 99.7, 100), candle(2, 100, 101.2, 99.9, 101)],
      signals: [signalFixture({ id: "signal-sell", direction: "BEARISH", entryPrice: 100, stopLoss: 101, takeProfit: 99, type: "CONFIRMED_SELL" })],
    });
    expect(result.trades[0]).toMatchObject({ result: "LOSS", finalR: -1 });
  });

  it("uses conservative same-candle TP/SL handling", () => {
    const result = runBacktest({
      ...baseInput(),
      candles: [candle(0, 100, 100.5, 99.5, 100), candle(1, 100, 100.3, 99.7, 100), candle(2, 100, 101.2, 98.8, 100.2)],
      signals: [signalFixture()],
      settings: { sameCandlePolicy: "CONSERVATIVE_SL_FIRST", enablePartials: false, enableBreakeven: false },
    });
    expect(result.trades[0].result).toBe("LOSS");
  });

  it("can mark same-candle ambiguity as unknown", () => {
    const result = runBacktest({
      ...baseInput(),
      candles: [candle(0, 100, 100.5, 99.5, 100), candle(1, 100, 100.3, 99.7, 100), candle(2, 100, 101.2, 98.8, 100.2)],
      signals: [signalFixture()],
      settings: { sameCandlePolicy: "MARK_UNKNOWN", enablePartials: false, enableBreakeven: false },
    });
    expect(result.trades[0].result).toBe("UNKNOWN_INTRACANDLE");
  });

  it("calculates breakeven after price reaches 1R then returns to entry", () => {
    const result = runBacktest({
      ...baseInput(),
      candles: [candle(0, 100, 100.5, 99.5, 100), candle(1, 100, 100.3, 99.7, 100), candle(2, 100, 101.1, 100.1, 100.8), candle(3, 100.7, 100.8, 100, 100.1)],
      signals: [signalFixture({ takeProfit: 103, rr: 3 })],
      settings: { enableBreakeven: true, enablePartials: false },
    });
    expect(result.trades[0].result).toBe("BREAKEVEN");
  });

  it("calculates partial TP result", () => {
    const result = runBacktest({
      ...baseInput(),
      candles: [candle(0, 100, 100.5, 99.5, 100), candle(1, 100, 100.3, 99.7, 100), candle(2, 100, 102.2, 100.1, 101.8), candle(3, 101.8, 101.9, 100, 100.2)],
      signals: [signalFixture({ takeProfit: 102, takeProfit2: 104, rr: 2 })],
      settings: { enablePartials: true, enableBreakeven: true },
    });
    expect(result.trades[0].result).toBe("PARTIAL_WIN");
    expect(result.trades[0].finalR).toBeGreaterThan(0);
  });

  it("calculates expectancy and profit factor", () => {
    const metrics = calculatePerformanceMetrics([
      trade("a", 1, 50),
      trade("b", -1, -50),
      trade("c", 2, 100),
    ]);
    expect(metrics.expectancy).toBeCloseTo(0.667, 3);
    expect(metrics.profitFactor).toBe(3);
  });

  it("calculates max drawdown", () => {
    expect(calculateMaxDrawdown([trade("a", 1, 100), trade("b", -2, -200), trade("c", 1, 100)], 10_000)).toBe(200);
  });

  it("builds session and setup type breakdowns", () => {
    const result = runBacktest({ ...baseInput(), signals: [signalFixture()] });
    expect(result.breakdowns.bySession[0]).toMatchObject({ key: "LONDON", totalTrades: 1 });
    expect(result.breakdowns.byKillzone[0]).toMatchObject({ key: "LONDON", totalTrades: 1 });
    expect(result.breakdowns.bySetupType[0]).toMatchObject({ key: "LIQUIDITY_SWEEP_REVERSAL", totalTrades: 1 });
  });

  it("builds Silver Bullet killzone breakdowns", () => {
    const result = runBacktest({
      ...baseInput(),
      signals: [
        signalFixture({
          strategyId: "ICT_SILVER_BULLET",
          strategyModel: "ICT Silver Bullet",
          session: "NEW_YORK",
          silverBullet: silverBulletFixture("NY_AM_SB"),
        }),
      ],
    });
    expect(result.trades[0].killzoneName).toBe("NY_AM_SB");
    expect(result.breakdowns.byKillzone[0]).toMatchObject({ key: "NY_AM_SB", totalTrades: 1 });
  });

  it("carries macro grade and score onto evaluated backtest trades", () => {
    const result = runBacktest({
      ...baseInput(),
      signals: [signalFixture({ intermarket: intermarketFixture("A", 82) })],
    });

    expect(result.trades[0]).toMatchObject({
      macroGrade: "A",
      macroScore: 82,
      macroGoldBias: "BULLISH_GOLD",
    });
  });

  it("compares raw, score-only, and macro-blocked backtests by macro grade", () => {
    const input = {
      ...baseInput(),
      settings: { ...baseInput().settings, maxTradesPerDay: 10 },
      signals: [
        signalFixture({ id: "macro-a", intermarket: intermarketFixture("A", 84) }),
        signalFixture({ id: "macro-b", intermarket: intermarketFixture("B", 66) }),
        signalFixture({
          id: "macro-conflict",
          direction: "BEARISH",
          v2Direction: "SELL",
          type: "CONFIRMED_SELL",
          stopLoss: 101,
          takeProfit: 99,
          intermarket: intermarketFixture("CONFLICT", 28, true),
        }),
      ],
    };

    const comparison = runIntermarketMacroBacktestComparison(input);

    expect(comparison.rawTotalSignals).toBe(3);
    expect(comparison.scoreOnlySignals).toBe(3);
    expect(comparison.blockingSignals).toBe(2);
    expect(comparison.signalsWithMacroA).toBe(1);
    expect(comparison.signalsWithMacroB).toBe(1);
    expect(comparison.macroConflictSignals).toBe(1);
    expect(comparison.tradesBlocked).toBe(1);
    expect(comparison.raw.trades).toHaveLength(3);
    expect(comparison.scoreOnly.trades).toHaveLength(3);
    expect(comparison.blocking.trades).toHaveLength(2);
    expect(comparison.winRateByMacroGrade.find((row) => row.grade === "A")).toMatchObject({ totalTrades: 1, winRate: 100 });
    expect(comparison.winRateByMacroGrade.find((row) => row.grade === "CONFLICT")).toMatchObject({ totalTrades: 1, winRate: 0 });
    expect(comparison.blockedTradeOutcomes[0]).toMatchObject({ grade: "CONFLICT", totalTrades: 1, expectancy: -1 });
    expect(comparison.expectancyChange).toBeGreaterThan(0);
  });

  it("builds rejection histogram and missed opportunity counts", () => {
    const result = runBacktest({
      ...baseInput(),
      rejectedSetups: [rejected("RR_TOO_LOW"), rejected("RR_TOO_LOW"), rejected("HIGH_REVERSAL")],
    });
    expect(result.rejectionAnalytics.rejectionHistogram[0]).toEqual({ reason: "RR_TOO_LOW", count: 2 });
    expect(result.rejectionAnalytics.rejectedButLaterWouldHaveWonCount).toBeGreaterThanOrEqual(0);
  });

  it("runs calibration comparison sets", () => {
    const result = runBacktest({ ...baseInput(), signals: [signalFixture({ score: 62, rr: 1.2 })] });
    expect(result.calibration.map((item) => item.settingName)).toEqual(["current settings", "relaxed settings", "strict settings", "custom settings"]);
    expect(result.calibration.find((item) => item.settingName === "relaxed settings")?.totalTrades).toBe(1);
  });

  it("fails prop firm rules on daily drawdown", () => {
    const prop = simulatePropFirm([trade("a", -12, -600)], { startingBalance: 10_000, profitTargetPercent: 8, maxDailyLossPercent: 5, maxTotalDrawdownPercent: 10, maxTradesPerDay: 2, minTradingDays: 1, consistencyRulePercent: 50 });
    expect(prop.dailyDrawdownHit).toBe(true);
    expect(prop.passed).toBe(false);
  });

  it("passes prop firm rules when target and trading-day constraints are met", () => {
    const prop = simulatePropFirm([trade("a", 4, 400), trade("b", 4, 400)], { startingBalance: 10_000, profitTargetPercent: 8, maxDailyLossPercent: 5, maxTotalDrawdownPercent: 10, maxTradesPerDay: 2, minTradingDays: 1, consistencyRulePercent: 100 });
    expect(prop.profitTargetHit).toBe(true);
    expect(prop.passed).toBe(true);
  });

  it("memoizes identical backtests", () => {
    const input = { ...baseInput(), signals: [signalFixture()] };
    expect(runBacktest(input).audit.cacheStatus).toBe("miss");
    expect(runBacktest(input).audit.cacheStatus).toBe("hit");
  });
});

function baseInput() {
  return {
    candles: [candle(0, 100, 100.5, 99.5, 100), candle(1, 100, 100.3, 99.7, 100), candle(2, 100, 101.2, 99.9, 101)],
    signals: [] as TradeSignal[],
    rejectedSetups: [] as RejectedSetup[],
    symbol: "XAUUSD",
    timeframe: "5m" as const,
    startDate: "2026-05-20T00:00",
    endDate: "2026-05-20T01:00",
    settings: { signalMode: "NORMAL_SCALP" as const, accountBalance: 10_000, riskPerTradePercent: 0.5, enablePartials: false, enableBreakeven: false },
    marketRegime: "TRENDING_BULLISH" as const,
  };
}

function signalFixture(overrides: Partial<TradeSignal> = {}): TradeSignal {
  return {
    id: "signal-buy",
    engine: "V2_GOLDMINE",
    strategyId: "GOLDMINE_ASIAN_SWEEP_REVERSAL",
    v2Direction: "BUY",
    type: "CONFIRMED_BUY",
    direction: "BULLISH",
    status: "CONFIRMED",
    sourceSetupId: "setup-1",
    setupType: "LIQUIDITY_SWEEP_REVERSAL",
    strategyModel: "Goldmine Asian Sweep Reversal",
    mode: "NORMAL_SCALP",
    timestamp: candle(1, 100, 100.3, 99.7, 100).timestamp,
    candleIndex: 1,
    confirmedAtIndex: 1,
    timeframe: "5m",
    session: "LONDON",
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 101,
    takeProfit2: null,
    takeProfit3: null,
    riskPoints: 1,
    rewardPoints: 1,
    rr: 1,
    score: 80,
    confidence: "STRONG",
    positionSizeSuggestion: 50,
    maxRiskAmount: 100,
    invalidationLevel: 99,
    reasons: ["Phase 5 confirmed signal."],
    warnings: [],
    rejectionReasons: [],
    relatedMarkers: ["marker-1"],
    noRepaintProof: { status: "PASS", signalIndex: 1, latestAllowedCandleIndex: 1, usedMarkerIndexes: [1], usedContextCloseTimes: [], usedSetupId: "setup-1", passed: true, lastAvailableIndex: 1, maxEvidenceIndex: 1, message: "pass" },
    stopLossDetail: { price: 99, source: "SWEEP_EXTREME", buffer: 0, riskPoints: 1, reason: "stop" },
    takeProfitDetail: { tp1: 101, tp2: null, tp3: null, source: "BSL", rewardPoints: 1, reason: "target" },
    scoreBreakdown: { phase4Setup: 20, contextAlignment: 10, confirmationCandle: 10, stopLossQuality: 10, targetQuality: 10, sessionQuality: 5, volatilityQuality: 5, antiReversal: 10 },
    ...overrides,
  };
}

function rejected(reason: string): RejectedSetup {
  return {
    setupId: `rejected-${reason}`,
    setupType: "LIQUIDITY_SWEEP_REVERSAL",
    setupState: "TRIGGER",
    direction: "BULLISH",
    triggerIndex: 1,
    rejectionReasons: [reason],
    rejectionReasonCodes: [reason === "RR_TOO_LOW" ? "RR_TOO_LOW" : "REVERSAL_RISK_HIGH"],
  };
}

function silverBulletFixture(killzoneName: string): NonNullable<TradeSignal["silverBullet"]> {
  return {
    stage: "CONFIRMED_SIGNAL",
    killzoneName,
    signalTime: candle(1, 100, 100.3, 99.7, 100).timestamp,
    liquidity: { type: "SSL", source: "SWING", level: 99.5, detectedAt: candle(0, 100, 100.5, 99.5, 100).timestamp },
    sweep: { candleIndex: 1, timestamp: candle(1, 100, 100.3, 99.7, 100).timestamp, level: 99.5, extreme: 99.2, type: "SSL", sweepPrice: 99.2, sweepDistanceAtr: 0.3, reclaimed: true, reclaimedAt: candle(1, 100, 100.3, 99.7, 100).timestamp, reclaimedAtIndex: 1 },
    displacement: { candleIndex: 1, timestamp: candle(1, 100, 100.3, 99.7, 100).timestamp, direction: "BULLISH", bodyRatio: 0.7, closePosition: 0.8, rangeAtrMultiple: 1.2 },
    structureShift: { type: "MSS", brokenLevel: 100.2, confirmedAt: candle(1, 100, 100.3, 99.7, 100).timestamp },
    fvg: { type: "BULLISH_FVG", createdAtIndex: 1, timestamp: candle(1, 100, 100.3, 99.7, 100).timestamp, low: 99.8, high: 100.1, bottom: 99.8, top: 100.1, midpoint: 99.95, sizeAtr: 0.2, retestedAtIndex: 1, retestedAt: candle(1, 100, 100.3, 99.7, 100).timestamp, retestDepthPercent: 50 },
    confirmation: { candleTime: candle(1, 100, 100.3, 99.7, 100).timestamp, open: 100, high: 100.3, low: 99.7, close: 100, bodyRatio: 0.6, closePosition: 0.7, rangeAtrMultiple: 1 },
  };
}

function intermarketFixture(
  macroGrade: NonNullable<TradeSignal["intermarket"]>["macroGrade"],
  macroScore: number,
  shouldBlock = false,
): NonNullable<TradeSignal["intermarket"]> {
  return {
    signalId: "macro-fixture",
    direction: macroGrade === "CONFLICT" ? "SELL" : "BUY",
    macroScore,
    macroGrade,
    goldBias: macroGrade === "CONFLICT" ? "BEARISH_GOLD" : "BULLISH_GOLD",
    dxyConfirmation: {
      provider: "DXY",
      status: macroGrade === "CONFLICT" ? "STRONGLY_CONFLICTS" : "SUPPORTS",
      score: macroGrade === "CONFLICT" ? -35 : 15,
      reasonCode: macroGrade === "CONFLICT" ? "DXY_STRONG_CONFLICT" : "DXY_SUPPORTS_GOLD_BUY",
      reasons: [],
    },
    tnxConfirmation: {
      provider: "TNX",
      status: macroGrade === "CONFLICT" ? "STRONGLY_CONFLICTS" : "SUPPORTS",
      score: macroGrade === "CONFLICT" ? -30 : 12,
      reasonCode: macroGrade === "CONFLICT" ? "TNX_STRONG_CONFLICT" : "TNX_SUPPORTS_GOLD_BUY",
      reasons: [],
    },
    fredConfirmation: {
      provider: "FRED",
      status: "NEUTRAL",
      score: 5,
      reasonCode: "FRED_DAILY_NEUTRAL",
      reasons: [],
    },
    shouldBlock,
    blockReason: shouldBlock ? "DXY_AND_TNX_STRONG_MACRO_CONFLICT" : null,
    warnings: shouldBlock ? ["INTERMARKET_MACRO_CONFLICT"] : [],
    debug: {
      module: "INTERMARKET_MACRO_CONFIRMATION_GATE",
      mode: shouldBlock ? "BLOCK_STRONG_CONFLICT_ONLY" : "SCORE_ONLY",
      dxyScore: macroGrade === "CONFLICT" ? -35 : 15,
      tnxScore: macroGrade === "CONFLICT" ? -30 : 12,
      fredScore: 5,
      dxyCandlesUsed: 20,
      tnxCandlesUsed: 20,
      xauusdSignalTime: candle(1, 100, 100.3, 99.7, 100).timestamp,
      fredDailyBias: macroGrade === "CONFLICT" ? "BEARISH_GOLD" : "BULLISH_GOLD",
    },
  };
}

function trade(id: string, finalR: number, pnl: number) {
  const base = signalFixture({ id });
  return {
    tradeId: id,
    signalId: id,
    direction: base.direction,
    setupType: base.setupType,
    session: base.session,
    mode: "NORMAL_SCALP" as const,
    symbol: "XAUUSD",
    timeframe: "5m" as const,
    entryTime: base.timestamp,
    exitTime: base.timestamp + 300_000,
    entryIndex: 1,
    exitIndex: 2,
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 101,
    takeProfit2: null,
    takeProfit3: null,
    rr: 1,
    result: finalR > 0 ? "WIN" as const : "LOSS" as const,
    finalR,
    pnl,
    mfe: Math.max(finalR, 0),
    mae: Math.max(-finalR, 0),
    candlesHeld: 1,
    exitReason: "fixture",
    reason: "fixture",
    score: 80,
    confidence: "STRONG" as const,
    warnings: [],
    noFutureValidation: { signalId: id, confirmedAtIndex: 1, maxDataIndexUsedForSignal: 1, passedNoFutureCheck: true },
  };
}

function candle(index: number, open: number, high: number, low: number, close: number): Candle {
  const timestamp = Date.UTC(2026, 4, 20, 0, index * 5);
  return { time: new Date(timestamp).toISOString(), timestamp, open, high, low, close, volume: 100, closeTime: timestamp + 299_999, isClosed: true };
}
