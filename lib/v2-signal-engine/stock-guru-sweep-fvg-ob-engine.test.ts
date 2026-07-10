import { beforeEach, describe, expect, it } from "vitest";

import { runBacktest } from "../backtesting/engine";
import type { Candle } from "../candles/types";
import type { MarketContextResult } from "../market-context/types";
import type { MarketStructureResult } from "../market-structure/types";
import {
  STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
  clearStockGuruSweepFvgObCache,
  generateStockGuruSweepFvgObSignals,
  generateV2Signals,
} from ".";
import type { V2GoldmineInput } from "./types";

describe("Stock Guru Sweep FVG OB Engine", () => {
  beforeEach(clearStockGuruSweepFvgObCache);

  it("creates a BUY after SSL sweep, reclaim, displacement, BOS, FVG/OB retest, and confirmation", () => {
    const result = generateStockGuruSweepFvgObSignals(input(stockGuruBuyCandles()));
    expect(result.signals).toHaveLength(1);
    const signal = result.signals[0];
    expect(signal).toMatchObject({ strategyId: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID, type: "CONFIRMED_BUY", immutable: true });
    expect(signal.stockGuruSweepFvgOb?.modelUsed).toBe("REVERSAL");
    expect(signal.stockGuruSweepFvgOb?.selectedZone.type).toBe("FVG_OB_OVERLAP");
    expect(signal.rr).toBeGreaterThanOrEqual(1.5);
  });

  it("creates a SELL after BSL sweep, reclaim, displacement, BOS, FVG/OB retest, and confirmation", () => {
    const result = generateStockGuruSweepFvgObSignals(input(stockGuruSellCandles(), bearishContext()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ strategyId: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID, type: "CONFIRMED_SELL" });
    expect(result.signals[0].stockGuruSweepFvgOb?.liquidity.type).toBe("BSL");
  });

  it("does not reuse a cached BUY result for same-timestamp bearish candles", () => {
    const buy = generateStockGuruSweepFvgObSignals(input(stockGuruBuyCandles(), bullishContext()));
    expect(buy.signals[0]).toMatchObject({ type: "CONFIRMED_BUY" });

    const sell = generateStockGuruSweepFvgObSignals(input(stockGuruSellCandles(), bearishContext()));
    expect(sell.signals).toHaveLength(1);
    expect(sell.signals[0]).toMatchObject({ type: "CONFIRMED_SELL" });
    expect(sell.audit.cacheStatus).toBe("miss");
  });

  it("allows a strong FVG-only setup when the order block is missing", () => {
    const result = generateStockGuruSweepFvgObSignals(input(stockGuruBuyCandles({ noOb: true })));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].stockGuruSweepFvgOb?.selectedZone.type).toBe("FVG");
    expect(result.signals[0].stockGuruSweepFvgOb?.orderBlock.found).toBe(false);
  });

  it("allows a strong OB-only setup when the FVG is missing", () => {
    const result = generateStockGuruSweepFvgObSignals(input(stockGuruBuyCandles({ noFvg: true }), bullishContext(), { currentMode: "testing" }));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].stockGuruSweepFvgOb?.selectedZone.type).toBe("OB");
    expect(result.signals[0].stockGuruSweepFvgOb?.fvg.found).toBe(false);
  });

  it("allows no-sweep continuation only with strong bias, BOS, displacement, zone retest, and confirmation", () => {
    const result = generateStockGuruSweepFvgObSignals(input(stockGuruBuyCandles({ noSweep: true }), bullishContext()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].stockGuruSweepFvgOb?.modelUsed).toBe("CONTINUATION");
  });

  it("rejects a setup without a confirmation candle", () => {
    const result = generateStockGuruSweepFvgObSignals(input(stockGuruBuyCandles({ noConfirmation: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.pendingCandidates.length + result.rejectedSetups.length).toBeGreaterThan(0);
    expect([...result.rejectedSetups.map((setup) => setup.rejectionReasonCodes[0]), ...result.pendingCandidates.map((candidate) => candidate.rejectionReason)]).toContain("NO_CONFIRMATION_CANDLE");
  });

  it("rejects when available targets keep RR below the minimum", () => {
    const result = generateStockGuruSweepFvgObSignals(input(stockGuruBuyCandles({ lowRr: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("RR_TOO_LOW"))).toBe(true);
  });

  it("rejects when the stop is too wide", () => {
    const result = generateStockGuruSweepFvgObSignals(input(stockGuruBuyCandles({ noFvg: true }), bullishContext(), { currentMode: "professional" }));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("STOP_TOO_WIDE"))).toBe(true);
  });

  it("rejects when the selected zone is invalidated before confirmation", () => {
    const result = generateStockGuruSweepFvgObSignals(input(stockGuruBuyCandles({ invalidated: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("ZONE_INVALIDATED"))).toBe(true);
  });

  it("does not create a signal from a forming confirmation candle", () => {
    const candles = stockGuruBuyCandles({ formingConfirmation: true });
    const result = generateStockGuruSweepFvgObSignals(input(candles));
    expect(result.signals).toHaveLength(0);
    expect(result.pendingCandidates.length).toBeGreaterThan(0);
  });

  it("does not repaint confirmed entry, stop, target, RR, score, confidence, or timestamp after future candles load", () => {
    const candles = stockGuruBuyCandles();
    const initial = generateStockGuruSweepFvgObSignals(input(candles));
    const signal = initial.signals[0];
    const future = Array.from({ length: 8 }, (_, index) => candle(candles.at(-1)!.timestamp + (index + 1) * 300_000, 96, 96.5, 95.8, 96.1));
    clearStockGuruSweepFvgObCache();
    const extended = generateStockGuruSweepFvgObSignals(input([...candles, ...future]));
    const same = extended.signals.find((item) => item.id === signal.id);
    expect(same).toMatchObject({
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      rr: signal.rr,
      score: signal.score,
      confidence: signal.confidence,
      timestamp: signal.timestamp,
    });
    expect(signal.noRepaintProof.maxEvidenceIndex).toBe(signal.confirmedAtIndex);
  });

  it("runs through ALL_V2 and backtests with conservative same-candle handling", () => {
    const candles = [
      ...stockGuruBuyCandles(),
      candle(Date.UTC(2026, 6, 2, 15, 0), 100.7, 103.4, 100.6, 102.9),
    ];
    const result = generateV2Signals("ALL_V2", input(candles));
    expect(result.signals.some((signal) => signal.strategyId === STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID)).toBe(true);
    const stockGuruSignals = result.signals.filter((signal) => signal.strategyId === STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID);
    const backtest = runBacktest({
      candles,
      signals: stockGuruSignals,
      rejectedSetups: result.rejectedSetups,
      symbol: "XAUUSD",
      timeframe: "5m",
      startDate: candles[0].time,
      endDate: candles.at(-1)!.time,
      settings: { enablePartials: false, enableBreakeven: false, strategyFilter: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID },
    });
    expect(backtest.trades).toHaveLength(stockGuruSignals.length);
    expect(backtest.trades.every((trade) => trade.noFutureValidation.passedNoFutureCheck)).toBe(true);
  });
});

type BuyOptions = {
  noOb?: boolean;
  noFvg?: boolean;
  noSweep?: boolean;
  noConfirmation?: boolean;
  lowRr?: boolean;
  stopTooWide?: boolean;
  invalidated?: boolean;
  formingConfirmation?: boolean;
};

function stockGuruBuyCandles(options: BuyOptions = {}): Candle[] {
  const start = Date.UTC(2026, 6, 2, 12, 0);
  const candles = Array.from({ length: 29 }, (_, index) => {
    const base = 100 + (index % 5) * 0.01;
    return candle(start + index * 300_000, base, options.stopTooWide ? 100.35 : 100.18, options.stopTooWide ? 99.65 : 99.82, base + 0.02);
  });
  candles.push(
    options.noOb
      ? candle(start + 29 * 300_000, 99.92, 100.12, 99.82, 100.06)
      : candle(start + 29 * 300_000, 100.2, 100.25, options.stopTooWide ? 99.0 : 99.82, 99.9),
  );
  candles.push(
    options.noSweep
      ? candle(start + 30 * 300_000, 99.86, 100.18, 99.82, 100.08)
      : candle(start + 30 * 300_000, 99.82, options.noFvg ? 100.35 : 100.18, 99.62, 100.08),
  );
  candles.push(candle(start + 31 * 300_000, 100.08, 100.9, 100.0, 100.82));
  candles.push(
    options.noFvg
      ? candle(start + 32 * 300_000, 100.82, options.lowRr ? 100.95 : 103.0, 100.28, 100.95)
      : candle(start + 32 * 300_000, 100.82, options.lowRr ? 100.95 : 103.0, 100.35, 100.95),
  );
  if (options.invalidated) {
    candles.push(candle(start + 33 * 300_000, 100.2, 100.25, 99.55, 99.7));
    return candles;
  }
  if (options.noConfirmation) {
    candles.push(candle(start + 33 * 300_000, 100.2, 100.26, 100.12, 100.18));
    return candles;
  }
  const confirmation = candle(start + 33 * 300_000, 100.18, 100.75, 100.12, 100.68);
  if (options.formingConfirmation) confirmation.isClosed = false;
  candles.push(confirmation);
  return candles;
}

function stockGuruSellCandles(): Candle[] {
  const start = Date.UTC(2026, 6, 2, 12, 0);
  const candles = Array.from({ length: 29 }, (_, index) => {
    const base = 100 - (index % 5) * 0.01;
    return candle(start + index * 300_000, base, 100.18, 99.82, base - 0.02);
  });
  candles.push(candle(start + 29 * 300_000, 99.75, 100.25, 99.72, 100.2));
  candles.push(candle(start + 30 * 300_000, 100.18, 100.38, 99.82, 99.92));
  candles.push(candle(start + 31 * 300_000, 99.92, 100.0, 99.1, 99.2));
  candles.push(candle(start + 32 * 300_000, 99.2, 99.65, 97.2, 99.05));
  candles.push(candle(start + 33 * 300_000, 99.82, 99.88, 99.25, 99.32));
  return candles;
}

function bullishContext(): MarketContextResult {
  return {
    htfBias: { bias: "BULLISH", strength: 72 },
    itfSetup: { direction: "BULLISH", strength: 70 },
    regime: { regime: "TRENDING_BULLISH" },
    volatility: { state: "NORMAL_VOLATILITY" },
  } as MarketContextResult;
}

function bearishContext(): MarketContextResult {
  return {
    htfBias: { bias: "BEARISH", strength: 72 },
    itfSetup: { direction: "BEARISH", strength: 70 },
    regime: { regime: "TRENDING_BEARISH" },
    volatility: { state: "NORMAL_VOLATILITY" },
  } as MarketContextResult;
}

function input(candles: Candle[], context: MarketContextResult = bullishContext(), settings: V2GoldmineInput["settings"] = undefined): V2GoldmineInput {
  return {
    candles,
    symbol: "XAUUSD",
    timeframe: "5m",
    startDate: candles[0].time,
    endDate: candles.at(-1)!.time,
    structure: {
      candles,
      markers: [],
      markerMap: new Map(),
      liquidityZones: [],
      liquidityZoneMap: new Map(),
      fvgZones: [],
      atr: [],
      audit: {} as MarketStructureResult["audit"],
    },
    context,
    settings,
  };
}

function candle(timestamp: number, open: number, high: number, low: number, close: number): Candle {
  return { time: new Date(timestamp).toISOString(), timestamp, open, high, low, close, volume: 100, closeTime: timestamp + 299_999, isClosed: true };
}
