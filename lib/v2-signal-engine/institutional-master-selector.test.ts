import { describe, expect, it } from "vitest";

import type { Candle } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { MarketContextResult } from "../market-context/types";
import { evaluateInstitutionalConfluence } from "./institutional-confluence-model";
import { evaluateHTFLiquidityContext } from "./htf-liquidity-context";
import { findStructuralTakeProfit } from "./htf-liquidity-target-engine";
import { applyKillzoneGatekeeper } from "./killzone-gatekeeper";
import { selectInstitutionalMasterSignal } from "./institutional-master-selector";
import { evaluateProductionRisk } from "./risk-management-layer";
import { calculateStructuralStop } from "./structural-stop-engine";

describe("INSTITUTIONAL_MASTER_GATEKEEPER", () => {
  it("keeps every raw strategy output in Research mode", () => {
    const signals = [stockSignal(), stockSignal({ id: "second" })];
    const result = select(signals, "RESEARCH");
    expect(result.researchSignals).toEqual(signals);
    expect(result.finalSignals).toHaveLength(0);
  });

  it("requires at least 2.5R in Production mode", () => {
    expect(select([stockSignal({ rr: 1.5 })]).rejectedSignals[0].reasons).toContain("RR_BELOW_2_5");
  });

  it("accepts a structural stop behind a sweep", () => {
    const result = calculateStructuralStop({
      signal: stockSignal(),
      direction: "BUY",
      atr: 1,
      candles: ltfCandles(),
      strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE",
    });
    expect(result).toMatchObject({ valid: true, stopSource: "SWEEP" });
    expect(result.reasons).toContain("STOP_BEHIND_SWEEP");
  });

  it("rejects an ATR-only stop with no structural evidence", () => {
    const signal = stockSignal({ stockGuruSweepFvgOb: undefined });
    const result = calculateStructuralStop({
      signal,
      direction: "BUY",
      atr: 1,
      candles: flatCandles(),
      strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE",
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("STOP_NOT_STRUCTURAL");
  });

  it("rejects a structural stop beyond the Production ATR maximum", () => {
    const signal = stockSignal();
    signal.stockGuruSweepFvgOb!.liquidity.sweepPrice = 95;
    const result = calculateStructuralStop({
      signal,
      direction: "BUY",
      atr: 1,
      candles: ltfCandles(),
      strategyId: signal.strategyId!,
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("STOP_TOO_WIDE");
  });

  it("rejects continuation outside London and New York", () => {
    const signal = stockSignal({
      strategyId: "FVG_CONTINUATION_ENTRY",
      session: "ASIAN",
      fvgContinuation: fvgSnapshot(),
      stockGuruSweepFvgOb: undefined,
    });
    const result = applyKillzoneGatekeeper({
      signal,
      strategyId: signal.strategyId!,
      session: "ASIAN",
      confirmationTime: signal.timestamp,
      appMode: "PRODUCTION",
    });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("CONTINUATION_REJECTED_OUTSIDE_KILLZONE");
  });

  it("requires 4/6 factors during Asian session", () => {
    const result = confluenceWithThreeFactors("ASIAN");
    expect(result.factorScore).toBe(3);
    expect(result.passed).toBe(false);
  });

  it("allows 3/6 factors during London session when risk is valid", () => {
    const result = confluenceWithThreeFactors("LONDON");
    expect(result.factorScore).toBe(3);
    expect(result.passed).toBe(true);
  });

  it("suppresses a signal entering an HTF obstacle", () => {
    const result = evaluateHTFLiquidityContext({
      direction: "BUY",
      entry: 100,
      stopLoss: 99,
      takeProfit: 103,
      itfCandles: [],
      htfCandles: htfWithLevel(101),
      atr: 1,
    });
    expect(result.suppressed).toBe(true);
    expect(result.reasons).toContain("BUY_INTO_HTF_BSL");
  });

  it("suppresses a 5m SELL while HTF is drawing toward upside BSL", () => {
    const result = evaluateHTFLiquidityContext({
      direction: "SELL",
      entry: 104,
      stopLoss: 105,
      takeProfit: 101,
      itfCandles: [],
      htfCandles: trendingCandles("BULLISH"),
      atr: 1,
    });
    expect(result.suppressed).toBe(true);
    expect(result.reasons).toContain("HTF_DRAW_ON_LIQUIDITY_OPPOSES_SIGNAL");
  });

  it("requires an HTF structural target to provide 2.5R", () => {
    const result = findStructuralTakeProfit({
      direction: "BUY",
      entry: 100,
      stopLoss: 99,
      ltfCandles: htfWithLevel(101),
      itfCandles: [],
      htfCandles: htfWithLevel(101),
      atr: 1,
      minRR: 2.5,
    });
    expect(result.rr).toBe(0);
    expect(result.reasons).toContain("NO_VALID_2_5R_TARGET");
  });

  it("does not use raw strategy score as the institutional score", () => {
    const low = select([stockSignal({ score: 10 })]).finalSignal;
    const high = select([stockSignal({ score: 99 })]).finalSignal;
    expect(low?.institutionalScore).toEqual(high?.institutionalScore);
  });

  it("normalizes different raw score systems through six factors", () => {
    const low = select([stockSignal({ score: 6 })]).debug.candidates[0].confluence.factorScore;
    const high = select([stockSignal({ score: 100 })]).debug.candidates[0].confluence.factorScore;
    expect(low).toBe(high);
  });

  it("checks HTF context before resolving BUY and SELL conflicts", () => {
    const buy = stockSignal({ id: "buy" });
    const sell = stockSignal({
      id: "sell",
      v2Direction: "SELL",
      direction: "BEARISH",
      type: "CONFIRMED_SELL",
      entryPrice: 104,
      stopLoss: 105,
      takeProfit: 100,
      rr: 4,
    });
    sell.stockGuruSweepFvgOb = sellStockSnapshot();
    const result = select([buy, sell], "PRODUCTION", trendingCandles("BULLISH"));
    expect(result.finalSignals.every((signal) => signal.action !== "MASTER_SELL")).toBe(true);
  });

  it("freezes a confirmed master signal against future candles", () => {
    const initial = select([stockSignal()]);
    const later = select([stockSignal()], "PRODUCTION", [
      ...htfCandles(),
      candle(200, 120, 80, 110, 50),
    ]);
    expect(later.finalSignal?.institutionalNoRepaintProof).toEqual(initial.finalSignal?.institutionalNoRepaintProof);
  });

  it("does not let future candles modify old structural SL, TP, or RR", () => {
    const initialResult = select([stockSignal()]);
    const laterResult = select([stockSignal()], "PRODUCTION", [...htfCandles(), candle(200, 150, 50, 140, 50)]);
    const initial = initialResult.finalSignal;
    const later = laterResult.finalSignal;
    expect(initial, JSON.stringify(initialResult.debug.candidates[0])).not.toBeNull();
    expect(later, JSON.stringify(laterResult.debug.noTradeReasons)).not.toBeNull();
    expect(later).toMatchObject({
      stopLoss: initial?.stopLoss,
      takeProfit: initial?.takeProfit,
      rr: initial?.rr,
    });
  });

  it("warns that lot size is estimate-only without broker contract data", () => {
    expect(evaluateProductionRisk({ entry: 100, stopLoss: 99 }).warnings).toContain("LOT_SIZE_ESTIMATE_ONLY");
  });

  it("enforces daily and weekly loss limits", () => {
    const result = evaluateProductionRisk({
      entry: 100,
      stopLoss: 99,
      riskState: { dailyLossR: 3, weeklyLossR: 6 },
    });
    expect(result.reasons).toEqual(expect.arrayContaining(["DAILY_RISK_LIMIT_REACHED", "WEEKLY_RISK_LIMIT_REACHED"]));
  });

  it("halves risk after two consecutive losses", () => {
    expect(evaluateProductionRisk({
      entry: 100,
      stopLoss: 99,
      riskState: { consecutiveLosses: 2 },
    }).riskPercent).toBe(0.5);
  });

  it("returns an exact NO_TRADE reason when no candidate passes", () => {
    const result = select([stockSignal({ rr: 1.5 })]);
    expect(result.action).toBe("NO_TRADE");
    expect(result.debug.noTradeReasons).toContain("RR_BELOW_2_5");
  });
});

function select(
  signals: TradeSignal[],
  appMode: "RESEARCH" | "PRODUCTION" = "PRODUCTION",
  htf = htfCandles(),
) {
  return selectInstitutionalMasterSignal({
    rawSignals: signals,
    candles: ltfCandles(),
    ltfCandles: ltfCandles(),
    itfCandles: htf,
    htfCandles: htf,
    timeframe: "5m",
    atr: 1,
    session: "LONDON",
    appMode,
    marketContext: context(htf),
  });
}

function confluenceWithThreeFactors(session: "ASIAN" | "LONDON") {
  const signal = stockSignal({ session });
  signal.stockGuruSweepFvgOb = {
    ...signal.stockGuruSweepFvgOb!,
    liquidity: {
      ...signal.stockGuruSweepFvgOb!.liquidity,
      sweepFound: false,
      reclaimFound: false,
    },
    displacement: {
      ...signal.stockGuruSweepFvgOb!.displacement,
      rangeAtrMultiple: 0.1,
      bodyRatio: 0.2,
      closePosition: 0.5,
    },
    selectedZone: {
      ...signal.stockGuruSweepFvgOb!.selectedZone,
      low: null,
      high: null,
    },
    fvg: { ...signal.stockGuruSweepFvgOb!.fvg, found: false, low: null, high: null },
    orderBlock: { ...signal.stockGuruSweepFvgOb!.orderBlock, found: false, low: null, high: null },
  };
  return evaluateInstitutionalConfluence({
    rawSignal: signal,
    candles: ltfCandles(),
    ltfCandles: ltfCandles(),
    itfCandles: [],
    htfCandles: [],
    timeframe: "5m",
    atr: 1,
    session,
    marketContext: context([]),
    htfLiquidityContext: {
      aligned: true,
      suppressed: false,
      nearestHTFTarget: null,
      nearestHTFObstacle: null,
      distanceToTargetAtr: null,
      distanceToObstacleAtr: null,
      reasons: ["HTF_CONTEXT_ALIGNED"],
      warnings: [],
    },
    mode: "normal",
    killzoneResult: {
      passed: true,
      sessionType: session,
      allowedStrategyType: "LIQUIDITY_REVERSAL",
      reasons: ["SESSION_ALLOWED"],
      warnings: [],
    },
    structuralStop: {
      stopLoss: 99,
      stopSource: "SWEEP",
      structuralInvalidationPrice: 99.1,
      atrDistance: 1,
      valid: true,
      reasons: ["STRUCTURAL_STOP_FOUND"],
      warnings: [],
    },
    structuralTarget: {
      takeProfit: 103,
      targetSource: "HTF_BSL",
      rr: 3,
      targetQuality: 100,
      htfConflict: false,
      reasons: ["HTF_BSL_TARGET_SELECTED"],
      warnings: [],
    },
  });
}

function stockSignal(overrides: Partial<TradeSignal> = {}): TradeSignal {
  const confirmedAtIndex = 10;
  return {
    id: "stock-buy",
    strategyId: "STOCK_GURU_SWEEP_FVG_OB_ENGINE",
    v2Direction: "BUY",
    type: "CONFIRMED_BUY",
    direction: "BULLISH",
    status: "CONFIRMED",
    sourceSetupId: "stock-setup",
    setupType: "LIQUIDITY_SWEEP_REVERSAL",
    strategyModel: "REVERSAL",
    mode: "V2_DEFAULT",
    timestamp: time(confirmedAtIndex),
    candleIndex: confirmedAtIndex,
    confirmedAtIndex,
    timeframe: "5m",
    session: "LONDON",
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 103,
    takeProfit2: null,
    takeProfit3: null,
    riskPoints: 1,
    rewardPoints: 3,
    rr: 3,
    score: 80,
    confidence: "STRONG",
    positionSizeSuggestion: 0,
    maxRiskAmount: 100,
    invalidationLevel: 99,
    reasons: [],
    warnings: [],
    rejectionReasons: [],
    relatedMarkers: [],
    noRepaintProof: {
      status: "PASS",
      signalIndex: confirmedAtIndex,
      latestAllowedCandleIndex: confirmedAtIndex,
      usedMarkerIndexes: [6, 8, 10],
      usedContextCloseTimes: [],
      usedSetupId: "stock-setup",
      passed: true,
      lastAvailableIndex: confirmedAtIndex,
      maxEvidenceIndex: confirmedAtIndex,
      message: "Closed candles only.",
    },
    stopLossDetail: { price: 99, source: "STRUCTURE", buffer: 0.1, riskPoints: 1, reason: "Sweep." },
    takeProfitDetail: { tp1: 103, tp2: null, tp3: null, source: "LIQUIDITY", rewardPoints: 3, reason: "HTF." },
    scoreBreakdown: { phase4Setup: 0, contextAlignment: 0, confirmationCandle: 0, stopLossQuality: 0, targetQuality: 0, sessionQuality: 0, volatilityQuality: 0, antiReversal: 0 },
    stockGuruSweepFvgOb: stockSnapshot(),
    ...overrides,
  };
}

function stockSnapshot(): NonNullable<TradeSignal["stockGuruSweepFvgOb"]> {
  return {
    stage: "CONFIRMED_SIGNAL",
    strategyName: "STOCK_GURU_SWEEP_FVG_OB_ENGINE",
    checkedCandles: 11,
    timeframe: "5m",
    direction: "BUY",
    mode: "normal",
    atr: 1,
    htfBias: "NEUTRAL",
    itfBias: "BULLISH",
    marketRegime: "TRENDING",
    modelUsed: "REVERSAL",
    signalTime: time(10),
    liquidity: { levelFound: true, type: "SSL", level: 99.2, source: "SWING_LOW", sweepFound: true, sweepIndex: 5, sweepAt: time(5), sweepPrice: 99, reclaimFound: true, reclaimIndex: 6, reclaimAt: time(6), reclaimQuality: 90 },
    displacement: { found: true, candleIndex: 7, candleTime: time(7), strength: 90, bodyRatio: 0.72, closePosition: 0.8, rangeAtrMultiple: 0.8, averageRangeMultiple: 1.4 },
    structure: { found: true, bosType: "CLOSE_BOS", brokenLevel: 100, confirmedAtIndex: 8, confirmedAt: time(8) },
    fvg: { found: true, type: "BULLISH_FVG", createdAt: time(7), createdAtIndex: 7, low: 99.4, high: 99.9, midpoint: 99.65, sizeAtr: 0.5, quality: 90 },
    orderBlock: { found: true, type: "BULLISH_OB", createdAt: time(6), createdAtIndex: 6, low: 99.3, high: 99.8, midpoint: 99.55, sizeAtr: 0.5, quality: 90 },
    selectedZone: { type: "FVG_OB_OVERLAP", low: 99.4, high: 99.8, midpoint: 99.6, createdAt: time(7), createdAtIndex: 7, retestedAt: time(9), retestedAtIndex: 9, retestDepthPercent: 50 },
    confirmation: { found: true, candleTime: time(10), candleIndex: 10, open: 99.7, high: 100.1, low: 99.5, close: 100, bodyRatio: 0.5, closePosition: 0.83, rejectionWickRatio: 0.3, pressure: "BUYERS" },
    risk: { entry: 100, stopLoss: 99, takeProfit: 103, rr: 3, maxSlAtr: 3 },
    score: { total: 80, confidence: "STRONG", bonuses: [], penalties: [] },
    rejectionReasons: [],
    warnings: [],
    noRepaintProof: "PASS",
  };
}

function sellStockSnapshot(): NonNullable<TradeSignal["stockGuruSweepFvgOb"]> {
  const snapshot = stockSnapshot();
  return {
    ...snapshot,
    direction: "SELL",
    liquidity: { ...snapshot.liquidity, type: "BSL", level: 104.8, sweepPrice: 105 },
    displacement: { ...snapshot.displacement, closePosition: 0.2 },
    fvg: { ...snapshot.fvg, type: "BEARISH_FVG", low: 104.1, high: 104.6, midpoint: 104.35 },
    orderBlock: { ...snapshot.orderBlock, type: "BEARISH_OB", low: 104.2, high: 104.7, midpoint: 104.45 },
    selectedZone: { ...snapshot.selectedZone, low: 104.2, high: 104.6, midpoint: 104.4 },
    confirmation: { ...snapshot.confirmation, open: 104.3, high: 104.5, low: 103.9, close: 104, closePosition: 0.17, pressure: "SELLERS" },
    risk: { entry: 104, stopLoss: 105, takeProfit: 100, rr: 4, maxSlAtr: 3 },
  };
}

function fvgSnapshot(): NonNullable<TradeSignal["fvgContinuation"]> {
  return {
    stage: "CONFIRMED_SIGNAL",
    sessionName: "ASIAN",
    signalTime: time(10),
    displacement: { candleTime: time(6), candleIndex: 6, direction: "BULLISH", open: 99, high: 100, low: 98.9, close: 99.9, bodyRatio: 0.8, closePosition: 0.9, rangeAtrMultiple: 1.1 },
    structureBreak: { type: "BOS", brokenLevel: 99.5, confirmedAt: time(6) },
    fvg: { type: "BULLISH_FVG", createdAt: time(6), createdAtIndex: 6, top: 99.8, bottom: 99.4, midpoint: 99.6, size: 0.4, sizeAtr: 0.4, retestedAt: time(9), retestedAtIndex: 9, retestDepthPercent: 50, invalidated: false },
    retest: { candleTime: time(9), candleIndex: 9, retestPrice: 99.6, touchedZone: "MIDPOINT", held: true },
    confirmation: { candleTime: time(10), open: 99.6, high: 100.1, low: 99.5, close: 100, bodyRatio: 0.67, closePosition: 0.83, rangeAtrMultiple: 0.6 },
    confluence: { hasLiquiditySweep: false, hasOrderBlock: false, emaTrendAligned: true },
  };
}

function context(htf: Candle[]): MarketContextResult {
  return {
    itfCandles: htf.map((item, index) => ({ ...item, closeTime: item.timestamp, sourceStartIndex: index, sourceEndIndex: index })),
    htfCandles: htf.map((item, index) => ({ ...item, closeTime: item.timestamp, sourceStartIndex: index, sourceEndIndex: index })),
    session: { session: "LONDON" },
  } as MarketContextResult;
}

function ltfCandles(): Candle[] {
  return Array.from({ length: 20 }, (_, index) => candle(99.7, 100.3, 99.4, 100, index));
}

function flatCandles(): Candle[] {
  return Array.from({ length: 20 }, (_, index) => candle(100, 100.2, 99.8, 100, index));
}

function htfCandles(): Candle[] {
  return [
    candle(99, 100, 98, 99, 0),
    candle(99, 101, 98.5, 100, 1),
    candle(100, 105, 99.5, 103, 2),
    candle(103, 104, 100, 102, 3),
    candle(102, 103, 100, 101, 4),
  ];
}

function htfWithLevel(level: number): Candle[] {
  return [
    candle(100, 100.2, 99.7, 100, 0),
    candle(100, 100.4, 99.8, 100.2, 1),
    candle(100.2, level, 100, 100.4, 2),
    candle(100.4, 100.5, 100, 100.2, 3),
    candle(100.2, 100.3, 99.9, 100.1, 4),
  ];
}

function trendingCandles(direction: "BULLISH" | "BEARISH"): Candle[] {
  return Array.from({ length: 8 }, (_, index) => {
    const price = direction === "BULLISH" ? 100 + index : 108 - index;
    return candle(price, price + 1, price - 1, price + (direction === "BULLISH" ? 0.7 : -0.7), index);
  });
}

function candle(open: number, high: number, low: number, close: number, index: number): Candle {
  return {
    time: new Date(time(index)).toISOString(),
    timestamp: time(index),
    open,
    high,
    low,
    close,
    volume: 100,
    isClosed: true,
  };
}

function time(index: number): number {
  return Date.UTC(2026, 6, 1, 8, 0) + index * 300_000;
}
