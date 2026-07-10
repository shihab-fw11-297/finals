import { describe, expect, it } from "vitest";

import { runOptionalMasterBacktestComparison } from "../backtesting/engine";
import type { Candle } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { MarketContextResult } from "../market-context/types";
import {
  getOptionalMasterDisplaySignals,
  selectOptionalMasterSignals,
} from "./optional-master-signal-selector";

describe("OPTIONAL_MASTER_SIGNAL_SELECTOR", () => {
  it("returns raw signals unchanged when disabled", () => {
    const raw = [signal({ id: "a" }), signal({ id: "b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION" })];
    const result = select(raw, { enabled: false });
    expect(result.enabled).toBe(false);
    expect(result.rawSignals).toEqual(raw);
    expect(result.finalSignals).toHaveLength(0);
    expect(result.debug.message).toBe("Master Selector disabled. Showing raw strategy signals.");
  });

  it("does not suppress any signal when disabled", () => {
    const result = select([signal({ id: "a" }), signal({ id: "b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION" })], { enabled: false });
    expect(result.suppressedSignals).toHaveLength(0);
    expect(result.groupedSignals).toHaveLength(0);
  });

  it("groups same-direction duplicate signals when enabled", () => {
    const result = select([signal({ id: "fvg" }), signal({ id: "ob", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION", entryPrice: 100.1 })]);
    expect(result.groupedSignals).toHaveLength(1);
    expect(result.groupedSignals[0]).toMatchObject({ direction: "BUY" });
  });

  it("selects the best signal by optional master score", () => {
    const result = select([
      signal({ id: "low", strategyId: "EMA_TREND_PULLBACK", score: 60, confidence: "MODERATE" }),
      signal({ id: "high", strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE", score: 95, confidence: "PREMIUM" }),
    ]);
    expect(result.finalSignals[0].selectedRawSignalId).toBe("high");
    expect(result.finalSignals[0].masterAction).toBe("MASTER_BUY");
  });

  it("includes macroScore in optional master score when macro confirmation is available", () => {
    const result = select([
      signal({ id: "macro-c", strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE", score: 80, intermarket: intermarket(45, "C") }),
      signal({ id: "macro-a", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION", score: 80, intermarket: intermarket(95, "A") }),
    ]);

    expect(result.finalSignals[0].selectedRawSignalId).toBe("macro-a");
    expect(result.finalSignals[0].masterScoreCalculation.macroScore).toBe(95);
    expect(result.finalSignals[0].masterScoreCalculation.macroWeightApplied).toBe(0.2);
  });

  it("suppresses lower quality duplicates", () => {
    const result = select([
      signal({ id: "selected", strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE", score: 90 }),
      signal({ id: "duplicate", strategyId: "VWAP_EMA_REGIME_PULLBACK", score: 55 }),
    ]);
    expect(result.suppressedSignals).toContainEqual(expect.objectContaining({ signalId: "duplicate" }));
  });

  it("returns NO_TRADE for close BUY and SELL conflicts when scores are close", () => {
    const result = select([signal({ id: "buy", score: 76 }), sellSignal({ id: "sell", score: 76 })], { enabled: true }, neutralContext());
    expect(result.conflictSignals[0].decision).toBe("NO_TRADE");
    expect(result.finalSignals).toHaveLength(0);
  });

  it("selects the stronger conflict side when master score leads by at least 12 points", () => {
    const result = select([
      signal({ id: "strong-buy", strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE", score: 100, confidence: "PREMIUM", rr: 2.4, takeProfit: 102.4 }),
      sellSignal({ id: "weak-sell", strategyId: "VWAP_EMA_REGIME_PULLBACK", score: 35, confidence: "LOW_CONFIRMED" }),
    ], { enabled: true }, neutralContext());
    expect(result.conflictSignals[0].decision).toBe("BUY_SELECTED");
    expect(result.finalSignals.map((item) => item.selectedRawSignalId)).toEqual(["strong-buy"]);
  });

  it("uses strategy priority as a tie breaker", () => {
    const result = select([
      signal({ id: "ema", strategyId: "EMA_TREND_PULLBACK" }),
      signal({ id: "stock", strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE" }),
    ]);
    expect(result.finalSignals[0].selectedRawSignalId).toBe("stock");
  });

  it("handles missing strategy score with a fallback warning", () => {
    const result = select([signal({ id: "missing-score", score: Number.NaN })]);
    expect(result.finalSignals).toHaveLength(1);
    expect(result.debug.warnings?.[0]).toContain("fallback 50");
  });

  it("applies cooldown only when enabled", () => {
    const raw = [
      signal({ id: "first", confirmedAtIndex: 10, candleIndex: 10, timestamp: timestamp(10) }),
      signal({ id: "repeat", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION", confirmedAtIndex: 16, candleIndex: 16, timestamp: timestamp(16), entryPrice: 100.1, stopLoss: 99.1, takeProfit: 101.9 }),
    ];
    expect(select(raw, { enabled: true, cooldownEnabled: false }).finalSignals).toHaveLength(2);
    const withCooldown = select(raw, { enabled: true, cooldownEnabled: true });
    expect(withCooldown.finalSignals).toHaveLength(1);
    expect(withCooldown.suppressedSignals).toContainEqual(expect.objectContaining({ signalId: expect.stringContaining("repeat"), reason: "COOLDOWN_ACTIVE" }));
  });

  it("RAW_SIGNALS display mode shows all raw markers", () => {
    const result = select([signal({ id: "a" }), signal({ id: "b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION" })]);
    expect(getOptionalMasterDisplaySignals(result, "RAW_SIGNALS").map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("MASTER_SELECTED display mode shows only master markers", () => {
    const result = select([signal({ id: "a" }), signal({ id: "b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION" })]);
    const display = getOptionalMasterDisplaySignals(result, "MASTER_SELECTED");
    expect(display).toHaveLength(1);
    expect(display[0]).toHaveProperty("optionalMasterSignalId");
  });

  it("BOTH display mode shows master and raw markers", () => {
    const result = select([signal({ id: "a" }), signal({ id: "b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION" })]);
    const display = getOptionalMasterDisplaySignals(result, "BOTH");
    expect(display.map((item) => item.id)).toContain("b");
    expect(display.some((item) => "optionalMasterSignalId" in item)).toBe(true);
  });

  it("compares raw and optional master-selected backtest performance", () => {
    const selection = select([signal({ id: "a" }), signal({ id: "b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION" })]);
    const comparison = runOptionalMasterBacktestComparison({
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
    expect(comparison.conflictCount).toBe(0);
  });

  it("does not repaint the selected master signal after future candles arrive", () => {
    const first = select([signal({ id: "original", score: 72 })]);
    const later = select([
      signal({ id: "original", score: 72 }),
      signal({ id: "future", strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE", score: 99, confirmedAtIndex: 12, candleIndex: 12, timestamp: timestamp(12), entryPrice: 100.1, stopLoss: 99.1, takeProfit: 102 }),
    ]);
    expect(later.finalSignals[0]).toMatchObject({
      selectedRawSignalId: first.finalSignals[0].selectedRawSignalId,
      selectedStrategy: first.finalSignals[0].selectedStrategy,
      entryPrice: first.finalSignals[0].entryPrice,
      stopLoss: first.finalSignals[0].stopLoss,
      takeProfit: first.finalSignals[0].takeProfit,
      rr: first.finalSignals[0].rr,
      masterScore: first.finalSignals[0].masterScore,
    });
  });

  it("does not let future raw confluence modify frozen master levels", () => {
    const result = select([
      signal({ id: "entry", entryPrice: 100, stopLoss: 99, takeProfit: 101.8, rr: 1.8 }),
      signal({ id: "later", strategyId: "PRO_LIQUIDITY_CONFLUENCE_ENGINE", confirmedAtIndex: 12, candleIndex: 12, timestamp: timestamp(12), entryPrice: 100.15, stopLoss: 98.8, takeProfit: 103, rr: 2.11 }),
    ]);
    expect(result.finalSignals[0].optionalNoRepaintProof).toMatchObject({
      entryFrozen: 100,
      stopLossFrozen: 99,
      takeProfitFrozen: 101.8,
      rrFrozen: 1.8,
    });
  });

  it("keeps suppressed signals available for debug and audit", () => {
    const result = select([signal({ id: "a" }), signal({ id: "b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION" })]);
    expect(result.debug.suppressedSignals).toEqual(result.suppressedSignals);
    expect(result.rawSignals.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("preserves ALL_V2 raw signal behavior while adding optional output", () => {
    const raw = [signal({ id: "all-v2-a" }), signal({ id: "all-v2-b", strategyId: "ORDER_BLOCK_RETEST_CONFIRMATION" })];
    const result = selectOptionalMasterSignals({
      rawSignals: raw,
      candles: candles(),
      timeframe: "5m",
      atr: 1,
      marketContext: bullishContext(),
      options: { enabled: true, displayMode: "MASTER_SELECTED" },
    });
    expect(result.rawSignals).toEqual(raw);
    expect(getOptionalMasterDisplaySignals({ ...result, enabled: false }, "RAW_SIGNALS")).toEqual(raw);
  });
});

function select(
  rawSignals: TradeSignal[],
  options: Parameters<typeof selectOptionalMasterSignals>[0]["options"] = { enabled: true },
  context: MarketContextResult = bullishContext(),
) {
  return selectOptionalMasterSignals({ rawSignals, candles: candles(), timeframe: "5m", atr: 1, marketContext: context, options: { enabled: true, ...options } });
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
    rr: Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss),
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

function intermarket(
  macroScore: number,
  macroGrade: NonNullable<TradeSignal["intermarket"]>["macroGrade"],
): NonNullable<TradeSignal["intermarket"]> {
  return {
    signalId: "macro-test",
    direction: "BUY",
    macroScore,
    macroGrade,
    goldBias: "BULLISH_GOLD",
    dxyConfirmation: { provider: "DXY", status: "SUPPORTS", score: 15, reasonCode: "DXY_SUPPORTS_GOLD_BUY", reasons: [] },
    tnxConfirmation: { provider: "TNX", status: "SUPPORTS", score: 12, reasonCode: "TNX_SUPPORTS_GOLD_BUY", reasons: [] },
    fredConfirmation: { provider: "FRED", status: "NEUTRAL", score: 5, reasonCode: "FRED_DAILY_NEUTRAL", reasons: [] },
    shouldBlock: false,
    blockReason: null,
    warnings: [],
    debug: {
      module: "INTERMARKET_MACRO_CONFIRMATION_GATE",
      mode: "SCORE_ONLY",
      dxyScore: 15,
      tnxScore: 12,
      fredScore: 5,
      dxyCandlesUsed: 20,
      tnxCandlesUsed: 20,
      xauusdSignalTime: timestamp(10),
      fredDailyBias: "BULLISH_GOLD",
    },
  };
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
