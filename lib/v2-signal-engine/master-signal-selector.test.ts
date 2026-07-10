import { describe, expect, it } from "vitest";

import { runMasterBacktestComparison } from "../backtesting/engine";
import type { Candle } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { MarketContextResult } from "../market-context/types";
import {
  getMasterDisplaySignals,
  getStrategyPriority,
  selectMasterSignals,
} from "./master-signal-selector";

describe("MASTER_SIGNAL_SELECTOR", () => {
  it("groups same-direction duplicate BUY signals", () => {
    const result = select([signal({ id: "buy-a" }), signal({ id: "buy-b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION", entryPrice: 100.2 })]);
    expect(result.groupedSignals).toHaveLength(1);
    expect(result.groupedSignals[0]).toMatchObject({ direction: "BUY", confluenceCount: 2 });
  });

  it("groups same-direction duplicate SELL signals", () => {
    const result = select([sellSignal({ id: "sell-a" }), sellSignal({ id: "sell-b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION", entryPrice: 99.8 })]);
    expect(result.groupedSignals).toHaveLength(1);
    expect(result.groupedSignals[0]).toMatchObject({ direction: "SELL", confluenceCount: 2 });
  });

  it("selects the best-scoring signal from a group", () => {
    const result = select([signal({ id: "low", score: 65 }), signal({ id: "high", strategyId: "PRO_LIQUIDITY_CONFLUENCE_ENGINE", score: 92 })]);
    expect(result.finalSignals[0].id).toBe("high");
  });

  it("suppresses the lower-quality duplicate", () => {
    const result = select([signal({ id: "selected", score: 90 }), signal({ id: "duplicate", strategyId: "EMA_TREND_PULLBACK", score: 62 })]);
    expect(result.suppressedSignals).toContainEqual(expect.objectContaining({ signalId: "duplicate", suppressedBy: result.finalSignals[0].masterSignalId }));
  });

  it("creates NO_TRADE for a close BUY and SELL conflict", () => {
    const result = select([signal({ id: "buy", score: 75 }), sellSignal({ id: "sell", score: 75 })], neutralContext());
    expect(result.conflictSignals[0].decision).toBe("NO_TRADE");
    expect(result.finalSignals).toHaveLength(0);
  });

  it("selects a much stronger side in an opposite conflict", () => {
    const result = select([
      signal({ id: "strong-buy", strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE", score: 100, rr: 2.2, takeProfit: 102.2, rewardPoints: 2.2 }),
      sellSignal({ id: "weak-sell", strategyId: "VWAP_EMA_REGIME_PULLBACK", score: 40 }),
    ], neutralContext());
    expect(result.conflictSignals[0].decision).toBe("BUY_SELECTED");
    expect(result.finalSignals.map((item) => item.id)).toEqual(["strong-buy"]);
  });

  it("uses strategy priority to break otherwise equal ties", () => {
    expect(getStrategyPriority("STOCK_GURU_SWEEP_FVG_OB_ENGINE")).toBeLessThan(getStrategyPriority("EMA_TREND_PULLBACK"));
    const result = select([
      signal({ id: "ema", strategyId: "EMA_TREND_PULLBACK" }),
      signal({ id: "stock", strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE" }),
    ]);
    expect(result.finalSignals[0].id).toBe("stock");
  });

  it("increases master score when more strategies confirm on the selection candle", () => {
    const one = select([signal({ id: "one" })]);
    const three = select([
      signal({ id: "one" }),
      signal({ id: "two", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION" }),
      signal({ id: "three", strategyId: "FVG_CONTINUATION_ENTRY" }),
    ]);
    expect(three.finalSignals[0].masterScore).toBeGreaterThan(one.finalSignals[0].masterScore);
    expect(three.finalSignals[0].confluenceCount).toBe(3);
  });

  it("rejects RR below the active mode threshold", () => {
    const result = select([signal({ rr: 1.1, takeProfit: 101.1, rewardPoints: 1.1 })]);
    expect(result.finalSignals).toHaveLength(0);
    expect(result.suppressedSignals[0].reason).toBe("RR_TOO_LOW");
  });

  it("rejects a stop wider than the ATR limit", () => {
    const result = select([signal({ stopLoss: 96, riskPoints: 4 })]);
    expect(result.finalSignals).toHaveLength(0);
    expect(result.suppressedSignals[0].reason).toBe("STOP_TOO_WIDE");
  });

  it("suppresses a repeated same-direction setup during cooldown", () => {
    const result = select([
      signal({ id: "first", confirmedAtIndex: 10, candleIndex: 10, timestamp: timestamp(10) }),
      signal({ id: "repeat", strategyId: "EMA_TREND_PULLBACK", confirmedAtIndex: 15, candleIndex: 15, timestamp: timestamp(15), entryPrice: 100.2, stopLoss: 99.2, takeProfit: 102, rr: 1.8 }),
    ]);
    expect(result.finalSignals.map((item) => item.id)).toEqual(["first"]);
    expect(result.suppressedSignals).toContainEqual(expect.objectContaining({ signalId: "repeat", reason: "COOLDOWN_ACTIVE" }));
  });

  it("does not repaint a selected master signal after future candles and signals arrive", () => {
    const first = select([signal({ id: "original", score: 72 })]);
    const later = select([
      signal({ id: "original", score: 72 }),
      signal({ id: "future", strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE", score: 99, confirmedAtIndex: 12, candleIndex: 12, timestamp: timestamp(12), entryPrice: 100.1, stopLoss: 99.1, takeProfit: 102, rr: 1.9 }),
    ]);
    expect(later.finalSignals[0]).toMatchObject({
      id: first.finalSignals[0].id,
      selectedStrategy: first.finalSignals[0].selectedStrategy,
      entryPrice: first.finalSignals[0].entryPrice,
      stopLoss: first.finalSignals[0].stopLoss,
      takeProfit: first.finalSignals[0].takeProfit,
      rr: first.finalSignals[0].rr,
      masterScore: first.finalSignals[0].masterScore,
    });
    expect(later.finalSignals[0].postEntryConfluenceCount).toBe(1);
  });

  it("does not let later confluence modify old master execution levels", () => {
    const result = select([
      signal({ id: "entry", entryPrice: 100, stopLoss: 99, takeProfit: 101.8, rr: 1.8 }),
      signal({ id: "later", strategyId: "PRO_LIQUIDITY_CONFLUENCE_ENGINE", confirmedAtIndex: 12, candleIndex: 12, timestamp: timestamp(12), entryPrice: 100.15, stopLoss: 98.8, takeProfit: 103, rr: 2.11 }),
    ]);
    expect(result.finalSignals[0].masterNoRepaintProof).toMatchObject({ entryFrozen: 100, stopLossFrozen: 99, takeProfitFrozen: 101.8, rrFrozen: 1.8 });
  });

  it("keeps every raw signal in raw display mode", () => {
    const result = select([signal({ id: "a" }), signal({ id: "b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION" })]);
    expect(getMasterDisplaySignals(result, "RAW").map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("shows only selected signals in master display mode", () => {
    const result = select([signal({ id: "a" }), signal({ id: "b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION" })]);
    expect(getMasterDisplaySignals(result, "MASTER")).toHaveLength(1);
    expect(getMasterDisplaySignals(result, "MASTER")[0]).toHaveProperty("masterSignalId");
  });

  it("compares raw and master-selected backtest performance", () => {
    const selection = select([signal({ id: "a" }), signal({ id: "b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION" })]);
    const comparison = runMasterBacktestComparison({
      candles: candles(),
      signals: selection.rawSignals,
      rejectedSetups: [],
      symbol: "XAUUSD",
      timeframe: "5m",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-02T00:00:00.000Z",
      settings: { maxTradesPerDay: 5, enablePartials: false, enableBreakeven: false },
    }, selection);
    expect(comparison.rawTotalTrades).toBe(2);
    expect(comparison.masterSelectedTrades).toBe(1);
    expect(comparison.suppressedDuplicates).toBeGreaterThan(0);
  });
});

function select(rawSignals: TradeSignal[], context = bullishContext()) {
  return selectMasterSignals({ rawSignals, candles: candles(), timeframe: "5m", mode: "easy", marketContext: context, atr: 1 });
}

function signal(overrides: Partial<TradeSignal> = {}): TradeSignal {
  const confirmedAtIndex = overrides.confirmedAtIndex ?? 10;
  const entryPrice = overrides.entryPrice ?? 100;
  const stopLoss = overrides.stopLoss ?? 99;
  const takeProfit = overrides.takeProfit ?? 101.8;
  return {
    id: "buy",
    engine: "V2_GOLDMINE",
    strategyId: "PRO_LIQUIDITY_CONFLUENCE_ENGINE",
    v2Direction: "BUY",
    type: "CONFIRMED_BUY",
    direction: "BULLISH",
    status: "CONFIRMED",
    sourceSetupId: "setup-buy",
    setupType: "TREND_CONTINUATION",
    strategyModel: "CONTINUATION",
    mode: "V2_DEFAULT",
    timestamp: timestamp(confirmedAtIndex),
    candleIndex: confirmedAtIndex,
    confirmedAtIndex,
    timeframe: "5m",
    session: "LONDON",
    entryPrice,
    stopLoss,
    takeProfit,
    takeProfit2: null,
    takeProfit3: null,
    riskPoints: Math.abs(entryPrice - stopLoss),
    rewardPoints: Math.abs(takeProfit - entryPrice),
    rr: 1.8,
    score: 80,
    confidence: "STRONG",
    positionSizeSuggestion: 1,
    maxRiskAmount: 100,
    invalidationLevel: stopLoss,
    reasons: ["Closed confirmation candle."],
    warnings: [],
    rejectionReasons: [],
    relatedMarkers: [],
    noRepaintProof: { status: "PASS", signalIndex: confirmedAtIndex, latestAllowedCandleIndex: confirmedAtIndex, usedMarkerIndexes: [confirmedAtIndex], usedContextCloseTimes: [], usedSetupId: "setup-buy", passed: true, lastAvailableIndex: confirmedAtIndex, maxEvidenceIndex: confirmedAtIndex, message: "Closed-candle evidence only." },
    stopLossDetail: { price: stopLoss, source: "STRUCTURE", buffer: 0.1, riskPoints: Math.abs(entryPrice - stopLoss), reason: "Behind structure." },
    takeProfitDetail: { tp1: takeProfit, tp2: null, tp3: null, source: "LIQUIDITY", rewardPoints: Math.abs(takeProfit - entryPrice), reason: "Nearest liquidity." },
    scoreBreakdown: { phase4Setup: 15, contextAlignment: 10, confirmationCandle: 10, stopLossQuality: 10, targetQuality: 10, sessionQuality: 5, volatilityQuality: 5, antiReversal: 5 },
    ...overrides,
  };
}

function sellSignal(overrides: Partial<TradeSignal> = {}): TradeSignal {
  return signal({
    id: "sell",
    v2Direction: "SELL",
    type: "CONFIRMED_SELL",
    direction: "BEARISH",
    sourceSetupId: "setup-sell",
    entryPrice: 100,
    stopLoss: 101,
    takeProfit: 98.2,
    invalidationLevel: 101,
    ...overrides,
  });
}

function candles(): Candle[] {
  return Array.from({ length: 30 }, (_, index) => ({
    timestamp: timestamp(index),
    time: new Date(timestamp(index)).toISOString(),
    open: 100,
    high: index === 11 ? 102.2 : 100.5,
    low: index === 11 ? 97.8 : 99.5,
    close: 100,
    volume: 100,
    isClosed: true,
  }));
}

function timestamp(index: number): number {
  return Date.UTC(2026, 6, 1, 8, 0) + index * 300_000;
}

function bullishContext(): MarketContextResult {
  return {
    htfBias: { bias: "BULLISH", strength: 80 },
    itfSetup: { direction: "BULLISH", strength: 75 },
    regime: { regime: "TRENDING_BULLISH" },
    session: { session: "LONDON", sessionQuality: 80 },
  } as MarketContextResult;
}

function neutralContext(): MarketContextResult {
  return {
    htfBias: { bias: "NEUTRAL", strength: 40 },
    itfSetup: { direction: "MIXED", strength: 40 },
    regime: { regime: "RANGING" },
    session: { session: "LONDON", sessionQuality: 70 },
  } as MarketContextResult;
}
