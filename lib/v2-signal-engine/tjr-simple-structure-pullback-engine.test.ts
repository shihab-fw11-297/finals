import { beforeEach, describe, expect, it } from "vitest";

import { runBacktest } from "../backtesting/engine";
import type { Candle } from "../candles/types";
import type { MarketContextResult } from "../market-context/types";
import type { MarketStructureResult } from "../market-structure/types";
import {
  TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID,
  clearTjrSimpleStructurePullbackCache,
  generateTjrSimpleStructurePullbackSignals,
  generateV2Signals,
} from ".";
import type { V2GoldmineInput } from "./types";

describe("TJR Simple Structure Pullback Engine", () => {
  beforeEach(clearTjrSimpleStructurePullbackCache);

  it("creates a BUY after bullish structure, BOS, pullback, confirmation, and RR validation", () => {
    const result = generateTjrSimpleStructurePullbackSignals(input(tjrBuyCandles(), bullishContext()));
    expect(result.signals.some((signal) => signal.type === "CONFIRMED_BUY")).toBe(true);
    const signal = result.signals.find((item) => item.type === "CONFIRMED_BUY")!;
    expect(signal).toMatchObject({ strategyId: TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID, immutable: true });
    expect(signal.tjrSimpleStructurePullback?.modelUsed).toBe("TREND_CONTINUATION");
    expect(signal.rr).toBeGreaterThanOrEqual(1.5);
  });

  it("creates a SELL after bearish structure, BOS, pullback, confirmation, and RR validation", () => {
    const result = generateTjrSimpleStructurePullbackSignals(input(tjrSellCandles(), bearishContext()));
    expect(result.signals.some((signal) => signal.type === "CONFIRMED_SELL")).toBe(true);
    const signal = result.signals.find((item) => item.type === "CONFIRMED_SELL")!;
    expect(signal.tjrSimpleStructurePullback?.modelUsed).toBe("TREND_CONTINUATION");
  });

  it("creates a BUY CHOCH reversal only after retest and confirmation", () => {
    const result = generateTjrSimpleStructurePullbackSignals(input(tjrReversalBuyCandles(), bullishContext(), { currentMode: "testing" }));
    expect(result.signals.some((signal) => signal.type === "CONFIRMED_BUY" && signal.tjrSimpleStructurePullback?.modelUsed === "CHOCH_REVERSAL")).toBe(true);
  });

  it("creates a SELL CHOCH reversal only after retest and confirmation", () => {
    const result = generateTjrSimpleStructurePullbackSignals(input(tjrReversalSellCandles(), bearishContext(), { currentMode: "testing" }));
    expect(result.signals.some((signal) => signal.type === "CONFIRMED_SELL" && signal.tjrSimpleStructurePullback?.modelUsed === "CHOCH_REVERSAL")).toBe(true);
  });

  it("rejects or waits when a pullback touch has no confirmation candle", () => {
    const result = generateTjrSimpleStructurePullbackSignals(input(tjrBuyCandles({ noConfirmation: true }), bullishContext()));
    expect(result.signals.length).toBe(0);
    expect([...result.rejectedSetups.map((setup) => setup.rejectionReasonCodes[0]), ...result.pendingCandidates.map((candidate) => candidate.rejectionReason)]).toContain("NO_CONFIRMATION_CANDLE");
  });

  it("rejects when RR cannot meet the minimum", () => {
    const result = generateTjrSimpleStructurePullbackSignals(input(tjrBuyCandles({ lowRr: true }), bullishContext()));
    expect(result.signals.length).toBe(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("RR_TOO_LOW"))).toBe(true);
  });

  it("rejects when stop loss is too wide in professional mode", () => {
    const result = generateTjrSimpleStructurePullbackSignals(input(tjrBuyCandles({ stopTooWide: true }), bullishContext(), { currentMode: "professional" }));
    expect(result.signals.length).toBe(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("STOP_TOO_WIDE"))).toBe(true);
  });

  it("does not create a signal from a forming confirmation candle", () => {
    const candles = tjrBuyCandles({ formingConfirmation: true });
    const result = generateTjrSimpleStructurePullbackSignals(input(candles, bullishContext()));
    expect(result.signals.length).toBe(0);
  });

  it("does not repaint confirmed entry, stop, target, RR, score, confidence, or timestamp after future candles load", () => {
    const candles = tjrBuyCandles();
    const initial = generateTjrSimpleStructurePullbackSignals(input(candles, bullishContext()));
    const signal = initial.signals.find((item) => item.type === "CONFIRMED_BUY")!;
    const future = Array.from({ length: 8 }, (_, index) => candle(candles.at(-1)!.timestamp + (index + 1) * 300_000, 107, 107.5, 106.8, 107.2));
    clearTjrSimpleStructurePullbackCache();
    const extended = generateTjrSimpleStructurePullbackSignals(input([...candles, ...future], bullishContext()));
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
    expect(signal.noRepaintProof.maxEvidenceIndex).toBeLessThanOrEqual(signal.confirmedAtIndex);
  });

  it("runs through ALL_V2 and backtests with conservative same-candle handling", () => {
    const candles = [...tjrBuyCandles(), candle(Date.UTC(2026, 6, 2, 18, 0), 107.2, 109.5, 107.0, 108.8)];
    const result = generateV2Signals("ALL_V2", input(candles, bullishContext()));
    expect(result.masterSelection?.rawSignals).toHaveLength(result.signals.length);
    const tjrSignals = result.signals.filter((signal) => signal.strategyId === TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID);
    expect(tjrSignals.length).toBeGreaterThan(0);
    const backtest = runBacktest({
      candles,
      signals: tjrSignals,
      rejectedSetups: result.rejectedSetups,
      symbol: "XAUUSD",
      timeframe: "5m",
      startDate: candles[0].time,
      endDate: candles.at(-1)!.time,
      settings: { enablePartials: false, enableBreakeven: false, strategyFilter: TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID },
    });
    expect(backtest.trades.length).toBe(tjrSignals.length);
    expect(backtest.trades.every((trade) => trade.noFutureValidation.passedNoFutureCheck)).toBe(true);
  });
});

type Options = {
  noConfirmation?: boolean;
  lowRr?: boolean;
  stopTooWide?: boolean;
  formingConfirmation?: boolean;
};

function tjrBuyCandles(options: Options = {}): Candle[] {
  const start = Date.UTC(2026, 6, 2, 12, 0);
  const candles = trendCandles(start, "BUY");
  const base = start + candles.length * 300_000;
  candles.push(candle(base, 103.05, options.lowRr ? 104.95 : 105.2, 102.9, 104.7));
  candles.push(candle(base + 300_000, 104.7, options.lowRr ? 106.1 : 111.0, 104.4, 105.6));
  candles.push(candle(base + 600_000, 105.6, 105.9, options.stopTooWide ? 99.2 : 104.1, 104.5));
  if (options.noConfirmation) {
    candles.push(candle(base + 900_000, 104.5, 104.72, 104.2, 104.42));
    return candles;
  }
  const confirmation = candle(base + 900_000, 104.5, 106.2, 104.22, 105.9);
  if (options.formingConfirmation) confirmation.isClosed = false;
  candles.push(confirmation);
  return candles;
}

function tjrSellCandles(options: Options = {}): Candle[] {
  return mirrorCandles(tjrBuyCandles(options));
}

function tjrReversalBuyCandles(): Candle[] {
  const start = Date.UTC(2026, 6, 2, 12, 0);
  const candles = trendCandles(start, "SELL", 0.2, 0.2);
  const base = start + candles.length * 300_000;
  candles.push(candle(base, 96.8, 99.0, 94.8, 95.0));
  candles.push(candle(base + 300_000, 98.8, 100.0, 98.7, 99.6));
  candles.push(candle(base + 600_000, 99.6, 106.0, 99.5, 100.4));
  candles.push(candle(base + 900_000, 100.4, 100.6, 99.1, 99.5));
  candles.push(candle(base + 1_200_000, 99.5, 101.2, 99.3, 100.9));
  return candles;
}

function tjrReversalSellCandles(): Candle[] {
  return mirrorCandles(tjrReversalBuyCandles());
}

function trendCandles(start: number, direction: "BUY" | "SELL", upperWick = 0.8, lowerWick = 0.7): Candle[] {
  return Array.from({ length: 58 }, (_, index) => {
    const drift = index * 0.045;
    const base = direction === "BUY" ? 100 + drift : 100 - drift;
    const open = direction === "BUY" ? base : base + 0.05;
    const close = direction === "BUY" ? base + 0.05 : base;
    return candle(start + index * 300_000, open, Math.max(open, close) + upperWick, Math.min(open, close) - lowerWick, close);
  });
}

function mirrorCandles(source: Candle[]): Candle[] {
  return source.map((item) => {
    const open = 200 - item.open;
    const close = 200 - item.close;
    const high = 200 - item.low;
    const low = 200 - item.high;
    return { ...item, open, high, low, close };
  });
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

function input(candles: Candle[], context: MarketContextResult, settings: V2GoldmineInput["settings"] = undefined): V2GoldmineInput {
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
