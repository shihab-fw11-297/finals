import { beforeEach, describe, expect, it } from "vitest";

import type { Candle } from "../candles/types";
import type { MarketContextResult } from "../market-context/types";
import type { MarketStructureResult } from "../market-structure/types";
import { runBacktest } from "../backtesting/engine";
import type { V2GoldmineInput } from "./types";
import {
  clearFvgContinuationEntryCache,
  clearProLiquidityConfluenceCache,
  clearIctSilverBulletCache,
  clearEmaTrendPullbackCache,
  generateFvgContinuationEntrySignals,
  generateProLiquidityConfluenceSignals,
  generateEmaTrendPullbackSignals,
  clearLiquiditySweepReversalProCache,
  generateLiquiditySweepReversalProSignals,
  clearVwapEmaRegimePullbackCache,
  generateIctSilverBulletSignals,
  generateVwapEmaRegimePullbackSignals,
} from ".";
import { calculateATR, calculateEMA, calculateSessionVWAP, calculateSlope, clockWindowAt } from "./indicators";

describe("reusable V2 indicators", () => {
  it("calculates EMA and Wilder ATR without future values", () => {
    const candles = Array.from({ length: 20 }, (_, index) => candle(Date.UTC(2026, 0, 1, 0, index * 5), 100 + index, 101 + index, 99 + index, 100 + index, 100));
    const ema = calculateEMA(candles, 5);
    const atr = calculateATR(candles, 14);
    expect(ema.slice(0, 4)).toEqual([null, null, null, null]);
    expect(ema[4]).toBe(102);
    expect(atr.slice(0, 13).every((value) => value === null)).toBe(true);
    expect(atr[13]).toBeCloseTo(2);
    expect(calculateSlope(ema, 3)[7]).toBeGreaterThan(0);
  });

  it("uses real volume and falls back to candle range when volume is absent", () => {
    const candles = [
      candle(Date.UTC(2026, 6, 1, 4), 99, 101, 99, 100, 10),
      candle(Date.UTC(2026, 6, 1, 4, 5), 100, 102, 100, 101, 0),
    ];
    const values = calculateSessionVWAP(candles, "00:00", "America/New_York");
    expect(values[0].usedVolumeProxy).toBe(false);
    expect(values[1].usedVolumeProxy).toBe(true);
    expect(values[1].value).toBeTypeOf("number");
  });

  it("recognizes New York killzones across winter and summer DST", () => {
    const windows = [{ name: "LONDON_SB", start: "03:00", end: "04:00" }];
    expect(clockWindowAt(Date.UTC(2026, 0, 15, 8, 30), "America/New_York", windows)).toBe("LONDON_SB");
    expect(clockWindowAt(Date.UTC(2026, 6, 15, 7, 30), "America/New_York", windows)).toBe("LONDON_SB");
  });
});

describe("VWAP EMA Regime Pullback", () => {
  beforeEach(clearVwapEmaRegimePullbackCache);

  it("confirms a closed bullish pullback and keeps its levels immutable", () => {
    const candles = vwapBuyCandles();
    const initial = generateVwapEmaRegimePullbackSignals(input(candles));
    expect(initial.signals.length).toBeGreaterThan(0);
    const signal = initial.signals[0];
    expect(signal).toMatchObject({ strategyId: "VWAP_EMA_REGIME_PULLBACK", type: "CONFIRMED_BUY", immutable: true });
    expect(signal.vwapEma?.regime.direction).toBe("BULLISH");
    expect(signal.rr).toBeGreaterThanOrEqual(1.5);
    expect(signal.noRepaintProof.maxEvidenceIndex).toBe(signal.confirmedAtIndex);

    const future = Array.from({ length: 10 }, (_, index) => candle(candles.at(-1)!.timestamp + (index + 1) * 300_000, 90, 91, 89, 90, 100));
    const extended = generateVwapEmaRegimePullbackSignals(input([...candles, ...future]));
    const same = extended.signals.find((item) => item.id === signal.id);
    expect(same).toMatchObject({ entryPrice: signal.entryPrice, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit, rr: signal.rr });
  });

  it("confirms the mirrored bearish regime and keeps a forming pullback pending", () => {
    const sell = generateVwapEmaRegimePullbackSignals(input(vwapSellCandles()));
    expect(sell.signals.some((signal) => signal.type === "CONFIRMED_SELL")).toBe(true);

    clearVwapEmaRegimePullbackCache();
    const forming = generateVwapEmaRegimePullbackSignals(input(vwapBuyCandles().slice(0, 200)));
    expect(forming.signals).toHaveLength(0);
    expect(forming.pendingCandidates.some((candidate) => candidate.confirmationStatus === "PENDING_CONFIRMATION")).toBe(true);
  });

  it("does not signal in a neutral EMA regime", () => {
    const start = Date.UTC(2026, 6, 1, 20);
    const candles = Array.from({ length: 203 }, (_, index) => candle(start + index * 300_000, 100, 100.1, 99.9, 100, 100));
    const result = generateVwapEmaRegimePullbackSignals(input(candles));
    expect(result.signals).toHaveLength(0);
    expect(result.audit.v2VwapEma?.neutralRegimeCandles).toBeGreaterThan(0);
  });
});

describe("EMA Trend Pullback", () => {
  beforeEach(clearEmaTrendPullbackCache);

  it("confirms a BUY when EMA20 > EMA50 > EMA200, price pulls back, and a bullish candle closes", () => {
    const result = generateEmaTrendPullbackSignals(input(emaTrendBuyCandles()));
    expect(result.signals.length).toBeGreaterThan(0);
    const signal = result.signals[0];
    expect(signal).toMatchObject({ strategyId: "EMA_TREND_PULLBACK", type: "CONFIRMED_BUY", immutable: true, mode: "V2_DEFAULT" });
    expect(signal.emaTrendPullback?.trend.direction).toBe("BULLISH");
    expect(signal.emaTrendPullback?.stage).toBe("CONFIRMED_SIGNAL");
    expect(signal.asianRange).toBeUndefined();
    expect(signal.rr).toBeGreaterThanOrEqual(1.5);
  });

  it("confirms a SELL when EMA20 < EMA50 < EMA200, price pulls back, and a bearish candle closes", () => {
    const result = generateEmaTrendPullbackSignals(input(emaTrendSellCandles()));
    expect(result.signals.some((signal) => signal.type === "CONFIRMED_SELL")).toBe(true);
    expect(result.signals[0].emaTrendPullback?.trend.direction).toBe("BEARISH");
  });

  it("does not signal when EMAs are tangled", () => {
    const start = Date.UTC(2026, 6, 1, 20);
    const candles = Array.from({ length: 205 }, (_, index) => candle(start + index * 300_000, 100, 100.1, 99.9, 100, 100));
    const result = generateEmaTrendPullbackSignals(input(candles));
    expect(result.signals).toHaveLength(0);
    expect(result.audit.v2EmaTrendPullback?.topRejectionReasons.some((row) => row.reason === "EMA_TANGLED_CHOPPY")).toBe(true);
  });

  it("does not signal outside the allowed New York sessions", () => {
    const result = generateEmaTrendPullbackSignals(input(emaTrendBuyCandles({ outsideSession: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.noTrade?.rejectionReasons).toContain("OUTSIDE_ALLOWED_SESSION");
  });

  it("does not signal when price is too far from the EMA zone", () => {
    const result = generateEmaTrendPullbackSignals(input(emaTrendBuyCandles({ extended: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.noTrade?.rejectionReasons).toContain("PRICE_TOO_EXTENDED_FROM_EMA");
  });

  it("keeps a pullback pending when no confirmation candle has closed yet", () => {
    const result = generateEmaTrendPullbackSignals(input(emaTrendBuyCandles().slice(0, 201)));
    expect(result.signals).toHaveLength(0);
    expect(result.pendingCandidates.some((candidate) => candidate.failedStage === "WAITING_CONFIRMATION")).toBe(true);
  });

  it("rejects confirmed candles when the nearest liquidity target is below 1.5R", () => {
    const result = generateEmaTrendPullbackSignals(input(emaTrendBuyCandles({ lowRr: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("RR_BELOW_MINIMUM"))).toBe(true);
  });

  it("does not repaint confirmed entry, stop, target, or RR after future candles load", () => {
    const candles = emaTrendBuyCandles();
    const initial = generateEmaTrendPullbackSignals(input(candles));
    const signal = initial.signals[0];
    const future = Array.from({ length: 12 }, (_, index) => candle(candles.at(-1)!.timestamp + (index + 1) * 300_000, 90, 91, 89, 90, 100));
    clearEmaTrendPullbackCache();
    const extended = generateEmaTrendPullbackSignals(input([...candles, ...future]));
    const same = extended.signals.find((item) => item.id === signal.id);
    expect(same).toMatchObject({ entryPrice: signal.entryPrice, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit, rr: signal.rr });
    expect(signal.noRepaintProof.maxEvidenceIndex).toBe(signal.confirmedAtIndex);
  });

  it("works on both 1m and 5m candles", () => {
    const oneMinute = generateEmaTrendPullbackSignals(input(emaTrendBuyCandles({ timeframe: "1m" }), "1m"));
    const fiveMinute = generateEmaTrendPullbackSignals(input(emaTrendBuyCandles(), "5m"));
    expect(oneMinute.signals.some((signal) => signal.strategyId === "EMA_TREND_PULLBACK")).toBe(true);
    expect(fiveMinute.signals.some((signal) => signal.strategyId === "EMA_TREND_PULLBACK")).toBe(true);
  });
});

describe("Liquidity Sweep Reversal Pro", () => {
  beforeEach(clearLiquiditySweepReversalProCache);

  it("confirms a BUY after SSL sweep, reclaim, and bullish confirmation", () => {
    const result = generateLiquiditySweepReversalProSignals(input(liquiditySweepBuyCandles()));
    expect(result.signals.length).toBeGreaterThan(0);
    const signal = result.signals[0];
    expect(signal).toMatchObject({ strategyId: "LIQUIDITY_SWEEP_REVERSAL_PRO", type: "CONFIRMED_BUY", immutable: true, mode: "V2_DEFAULT" });
    expect(signal.liquiditySweepReversal?.liquidity.type).toBe("SSL");
    expect(signal.liquiditySweepReversal?.stage).toBe("CONFIRMED_SIGNAL");
    expect(signal.asianRange).toBeUndefined();
    expect(signal.rr).toBeGreaterThanOrEqual(1.5);
  });

  it("confirms a SELL after BSL sweep, reclaim, and bearish confirmation", () => {
    const result = generateLiquiditySweepReversalProSignals(input(liquiditySweepSellCandles()));
    expect(result.signals.some((signal) => signal.type === "CONFIRMED_SELL")).toBe(true);
    expect(result.signals[0].liquiditySweepReversal?.liquidity.type).toBe("BSL");
  });

  it("keeps a swept and reclaimed setup pending when confirmation is not closed yet", () => {
    const result = generateLiquiditySweepReversalProSignals(input(liquiditySweepBuyCandles({ pending: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.pendingCandidates.some((candidate) => candidate.failedStage === "WAITING_CONFIRMATION")).toBe(true);
  });

  it("rejects sweeps that are too small", () => {
    const result = generateLiquiditySweepReversalProSignals(input(liquiditySweepBuyCandles({ smallSweep: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("SWEEP_TOO_SMALL"))).toBe(true);
  });

  it("rejects sweeps that are too large", () => {
    const result = generateLiquiditySweepReversalProSignals(input(liquiditySweepBuyCandles({ largeSweep: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("SWEEP_TOO_LARGE"))).toBe(true);
  });

  it("rejects when price does not reclaim the swept level", () => {
    const result = generateLiquiditySweepReversalProSignals(input(liquiditySweepBuyCandles({ noReclaim: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("NO_RECLAIM_CLOSE"))).toBe(true);
  });

  it("rejects when the nearest liquidity target is below 1.5R", () => {
    const result = generateLiquiditySweepReversalProSignals(input(liquiditySweepBuyCandles({ lowRr: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("RR_BELOW_MINIMUM"))).toBe(true);
  });

  it("does not repaint confirmed entry, stop, target, or RR after future candles load", () => {
    const candles = liquiditySweepBuyCandles();
    const initial = generateLiquiditySweepReversalProSignals(input(candles));
    const signal = initial.signals[0];
    const future = Array.from({ length: 10 }, (_, index) => candle(candles.at(-1)!.timestamp + (index + 1) * 300_000, 99, 99.4, 98.8, 99.1, 100));
    clearLiquiditySweepReversalProCache();
    const extended = generateLiquiditySweepReversalProSignals(input([...candles, ...future]));
    const same = extended.signals.find((item) => item.id === signal.id);
    expect(same).toMatchObject({ entryPrice: signal.entryPrice, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit, rr: signal.rr });
    expect(signal.noRepaintProof.maxEvidenceIndex).toBe(signal.confirmedAtIndex);
  });

  it("works without Asian range and only warns outside the active sessions", () => {
    const result = generateLiquiditySweepReversalProSignals(input(liquiditySweepBuyCandles({ outsideSession: true })));
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.signals[0].asianRange).toBeUndefined();
    expect(result.signals[0].warnings).toContain("OUTSIDE_ACTIVE_SESSION");
  });
});

describe("ICT Silver Bullet", () => {
  beforeEach(clearIctSilverBulletCache);

  it("confirms sweep, displacement, FVG retest, and closed-candle entry", () => {
    const result = generateIctSilverBulletSignals(input(silverBulletBuyCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ strategyId: "ICT_SILVER_BULLET", type: "CONFIRMED_BUY", immutable: true });
    expect(result.signals[0].silverBullet).toMatchObject({ killzoneName: "LONDON_SB", stage: "CONFIRMED_SIGNAL" });
    expect(result.signals[0].noRepaintProof.passed).toBe(true);
    expect(result.audit.v2SilverBullet?.fvgs).toBe(1);
  });

  it("confirms the mirrored sell-side setup", () => {
    const result = generateIctSilverBulletSignals(input(silverBulletSellCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ strategyId: "ICT_SILVER_BULLET", type: "CONFIRMED_SELL" });
  });

  it("does not signal outside a Silver Bullet killzone", () => {
    const result = generateIctSilverBulletSignals(input(silverBulletBuyCandles({ outsideKillzone: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.noTrade?.rejectionReasons).toContain("OUTSIDE_KILLZONE");
  });

  it("keeps a sweep pending when the reclaim candle is not closed yet", () => {
    const result = generateIctSilverBulletSignals(input(silverBulletBuyCandles({ pendingReclaim: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.pendingCandidates.some((candidate) => candidate.failedStage === "LIQUIDITY_SWEEP_DETECTED")).toBe(true);
  });

  it("keeps an FVG setup pending while waiting for the retest", () => {
    const result = generateIctSilverBulletSignals(input(silverBulletBuyCandles({ pendingFvgRetest: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.pendingCandidates.some((candidate) => candidate.failedStage === "WAITING_FVG_RETEST")).toBe(true);
  });

  it("rejects when the FVG retest expires", () => {
    const result = generateIctSilverBulletSignals(input(silverBulletBuyCandles({ expireFvgRetest: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("FVG_RETEST_EXPIRED"))).toBe(true);
  });

  it("rejects when confirmation expires after the FVG retest", () => {
    const result = generateIctSilverBulletSignals(input(silverBulletBuyCandles({ expireConfirmation: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("CONFIRMATION_EXPIRED") || setup.rejectionReasonCodes.includes("WEAK_CONFIRMATION_CANDLE"))).toBe(true);
  });

  it("rejects when the nearest target keeps RR below 1.5", () => {
    const result = generateIctSilverBulletSignals(input(silverBulletBuyCandles({ lowRr: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("RR_BELOW_MINIMUM"))).toBe(true);
  });

  it("does not repaint confirmed levels after future candles load", () => {
    const candles = silverBulletBuyCandles();
    const initial = generateIctSilverBulletSignals(input(candles));
    const signal = initial.signals[0];
    const future = Array.from({ length: 8 }, (_, index) => candle(candles.at(-1)!.timestamp + (index + 1) * 300_000, 98, 98.5, 97.8, 98.2, 100));
    clearIctSilverBulletCache();
    const extended = generateIctSilverBulletSignals(input([...candles, ...future]));
    const same = extended.signals.find((item) => item.id === signal.id);
    expect(same).toMatchObject({ entryPrice: signal.entryPrice, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit, rr: signal.rr, score: signal.score });
    expect(signal.noRepaintProof.maxEvidenceIndex).toBe(signal.confirmedAtIndex);
  });

  it("works without Asian range and keeps backtest evidence after confirmation", () => {
    const result = generateIctSilverBulletSignals(input(silverBulletBuyCandles()));
    expect(result.signals[0].asianRange).toBeUndefined();
    expect(result.signals[0].noRepaintProof.usedMarkerIndexes.every((index) => index <= result.signals[0].confirmedAtIndex)).toBe(true);
  });

  it("handles New York daylight saving for killzones", () => {
    const windows = [{ name: "NY_AM_SB", start: "10:00", end: "11:00" }];
    expect(clockWindowAt(Date.UTC(2026, 0, 15, 15, 30), "America/New_York", windows)).toBe("NY_AM_SB");
    expect(clockWindowAt(Date.UTC(2026, 6, 15, 14, 30), "America/New_York", windows)).toBe("NY_AM_SB");
  });
});

describe("FVG Continuation Entry", () => {
  beforeEach(clearFvgContinuationEntryCache);

  it("confirms a BUY after bullish displacement, BOS, bullish FVG retest, and bullish confirmation", () => {
    const result = generateFvgContinuationEntrySignals(input(fvgContinuationBuyCandles()));
    expect(result.signals).toHaveLength(1);
    const signal = result.signals[0];
    expect(signal).toMatchObject({ strategyId: "FVG_CONTINUATION_ENTRY", type: "CONFIRMED_BUY", immutable: true, mode: "V2_DEFAULT" });
    expect(signal.fvgContinuation).toMatchObject({ stage: "CONFIRMED_SIGNAL", sessionName: "NY_AM" });
    expect(signal.fvgContinuation?.structureBreak.type).toBe("BOS");
    expect(signal.fvgContinuation?.fvg.type).toBe("BULLISH_FVG");
    expect(signal.asianRange).toBeUndefined();
    expect(signal.rr).toBeGreaterThanOrEqual(1.5);
  });

  it("confirms a SELL after bearish displacement, BOS, bearish FVG retest, and bearish confirmation", () => {
    const result = generateFvgContinuationEntrySignals(input(fvgContinuationSellCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ strategyId: "FVG_CONTINUATION_ENTRY", type: "CONFIRMED_SELL" });
    expect(result.signals[0].fvgContinuation?.fvg.type).toBe("BEARISH_FVG");
  });

  it("does not signal from FVG alone without displacement", () => {
    const result = generateFvgContinuationEntrySignals(input(fvgContinuationBuyCandles({ noDisplacement: true })));
    expect(result.signals).toHaveLength(0);
  });

  it("keeps a valid FVG pending while waiting for retest", () => {
    const result = generateFvgContinuationEntrySignals(input(fvgContinuationBuyCandles({ pendingRetest: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.pendingCandidates.some((candidate) => candidate.failedStage === "WAITING_FVG_RETEST")).toBe(true);
  });

  it("rejects when FVG retest expires", () => {
    const result = generateFvgContinuationEntrySignals(input(fvgContinuationBuyCandles({ expireRetest: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("FVG_RETEST_EXPIRED"))).toBe(true);
  });

  it("rejects when the FVG is invalidated", () => {
    const result = generateFvgContinuationEntrySignals(input(fvgContinuationBuyCandles({ invalidateFvg: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("FVG_INVALIDATED") || setup.rejectionReasonCodes.includes("FVG_ALREADY_FILLED"))).toBe(true);
  });

  it("rejects when confirmation expires after retest", () => {
    const result = generateFvgContinuationEntrySignals(input(fvgContinuationBuyCandles({ expireConfirmation: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("CONFIRMATION_EXPIRED") || setup.rejectionReasonCodes.includes("WEAK_CONFIRMATION_CANDLE"))).toBe(true);
  });

  it("rejects when the nearest target keeps RR below 1.5", () => {
    const result = generateFvgContinuationEntrySignals(input(fvgContinuationBuyCandles({ lowRr: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("RR_BELOW_MINIMUM"))).toBe(true);
  });

  it("does not repaint confirmed levels after future candles load", () => {
    const candles = fvgContinuationBuyCandles();
    const initial = generateFvgContinuationEntrySignals(input(candles));
    const signal = initial.signals[0];
    const future = Array.from({ length: 8 }, (_, index) => candle(candles.at(-1)!.timestamp + (index + 1) * 300_000, 98, 98.5, 97.8, 98.2, 100));
    clearFvgContinuationEntryCache();
    const extended = generateFvgContinuationEntrySignals(input([...candles, ...future]));
    const same = extended.signals.find((item) => item.id === signal.id);
    expect(same).toMatchObject({ entryPrice: signal.entryPrice, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit, rr: signal.rr, score: signal.score });
    expect(signal.noRepaintProof.maxEvidenceIndex).toBe(signal.confirmedAtIndex);
  });

  it("backtests only after confirmation while preserving no-future evidence", () => {
    const candles = [
      ...fvgContinuationBuyCandles(),
      candle(Date.UTC(2026, 6, 2, 14, 0), 101.1, 103.4, 101.0, 103.1, 100),
    ];
    const result = generateFvgContinuationEntrySignals(input(candles));
    const backtest = runBacktest({
      candles,
      signals: result.signals,
      rejectedSetups: result.rejectedSetups,
      symbol: "XAUUSD",
      timeframe: "5m",
      startDate: candles[0].time,
      endDate: candles.at(-1)!.time,
      settings: { enablePartials: false, enableBreakeven: false, strategyFilter: "FVG_CONTINUATION_ENTRY" },
    });
    expect(backtest.trades).toHaveLength(1);
    expect(backtest.trades[0].entryIndex).toBe(result.signals[0].confirmedAtIndex);
    expect(backtest.trades[0].noFutureValidation.passedNoFutureCheck).toBe(true);
  });
});

describe("Pro Liquidity Confluence Engine", () => {
  beforeEach(clearProLiquidityConfluenceCache);

  it("confirms a BUY after SSL sweep, bullish displacement, MSS, FVG retest, and bullish confirmation", () => {
    const result = generateProLiquidityConfluenceSignals(input(proLiquidityBuyCandles()));
    expect(result.signals).toHaveLength(1);
    const signal = result.signals[0];
    expect(signal).toMatchObject({ strategyId: "PRO_LIQUIDITY_CONFLUENCE_ENGINE", type: "CONFIRMED_BUY", immutable: true, mode: "V2_DEFAULT" });
    expect(signal.proLiquidityConfluence?.liquiditySweep.type).toBe("SSL");
    expect(signal.proLiquidityConfluence?.entryZone.source).toBe("FVG");
    expect(signal.proLiquidityConfluence?.confluence.score).toBeGreaterThanOrEqual(6);
    expect(signal.rr).toBeGreaterThanOrEqual(1.5);
    expect(signal.noRepaintProof.maxEvidenceIndex).toBe(signal.confirmedAtIndex);
  });

  it("confirms the mirrored SELL sequence after BSL sweep and bearish confluence", () => {
    const result = generateProLiquidityConfluenceSignals(input(proLiquiditySellCandles()));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ strategyId: "PRO_LIQUIDITY_CONFLUENCE_ENGINE", type: "CONFIRMED_SELL" });
    expect(result.signals[0].proLiquidityConfluence?.liquiditySweep.type).toBe("BSL");
    expect(result.signals[0].proLiquidityConfluence?.entryZone.type).toBe("BEARISH_FVG");
  });

  it("does not turn pressure or displacement alone into an executable signal", () => {
    const result = generateProLiquidityConfluenceSignals(input(proLiquidityBuyCandles({ noSweep: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.noTrade?.rejectionReasons).toContain("NO_SWEEP");
  });

  it("allows a neutral HTF bias as score impact and warning, not a hard rejection", () => {
    const base = input(proLiquidityBuyCandles());
    const result = generateProLiquidityConfluenceSignals({
      ...base,
      context: {
        htfBias: { bias: "NEUTRAL", strength: 30 },
        itfSetup: { direction: "NONE", strength: 0 },
        volatility: { state: "NORMAL_VOLATILITY" },
      } as MarketContextResult,
    });
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].warnings).toContain("HTF_BIAS_NEUTRAL_ALLOWED_BY_CONFLUENCE");
    expect(result.signals[0].proLiquidityConfluence?.confluence.biasAligned).toBe(false);
  });

  it("rejects confirmed sequences when the nearest target keeps RR below the mode threshold", () => {
    const result = generateProLiquidityConfluenceSignals(input(proLiquidityBuyCandles({ lowRr: true })));
    expect(result.signals).toHaveLength(0);
    expect(result.rejectedSetups.some((setup) => setup.rejectionReasonCodes.includes("RR_BELOW_MINIMUM"))).toBe(true);
  });

  it("does not repaint confirmed entry, stop, target, or RR after future candles load", () => {
    const candles = proLiquidityBuyCandles();
    const initial = generateProLiquidityConfluenceSignals(input(candles));
    const signal = initial.signals[0];
    const future = Array.from({ length: 8 }, (_, index) => candle(candles.at(-1)!.timestamp + (index + 1) * 300_000, 98, 98.4, 97.8, 98.1, 100));
    clearProLiquidityConfluenceCache();
    const extended = generateProLiquidityConfluenceSignals(input([...candles, ...future]));
    const same = extended.signals.find((item) => item.id === signal.id);
    expect(same).toMatchObject({ entryPrice: signal.entryPrice, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit, rr: signal.rr, score: signal.score });
    expect(signal.noRepaintProof.usedMarkerIndexes.every((index) => index <= signal.confirmedAtIndex)).toBe(true);
  });
});

function vwapBuyCandles(): Candle[] {
  const start = Date.UTC(2026, 6, 1, 20, 0);
  return Array.from({ length: 203 }, (_, index) => {
    const base = index < 96 ? 100 + index * 0.01 : 100.96 + (index - 96) * 0.001;
    if (index === 201) return candle(start + index * 300_000, base - 0.08, base + 0.10, base - 0.10, base + 0.08, 100);
    return candle(start + index * 300_000, base, base + 0.10, base - 0.10, base + 0.002, 100);
  });
}

function vwapSellCandles(): Candle[] {
  const start = Date.UTC(2026, 6, 1, 20, 0);
  return Array.from({ length: 203 }, (_, index) => {
    const base = index < 96 ? 102 - index * 0.01 : 101.04 - (index - 96) * 0.001;
    if (index === 201) return candle(start + index * 300_000, base + 0.08, base + 0.10, base - 0.10, base - 0.08, 100);
    return candle(start + index * 300_000, base, base + 0.10, base - 0.10, base - 0.002, 100);
  });
}

function silverBulletBuyCandles(options: { outsideKillzone?: boolean; pendingReclaim?: boolean; pendingFvgRetest?: boolean; expireFvgRetest?: boolean; expireConfirmation?: boolean; lowRr?: boolean } = {}): Candle[] {
  const start = options.outsideKillzone ? Date.UTC(2026, 6, 2, 0, 0) : Date.UTC(2026, 6, 2, 5, 55);
  const candles = Array.from({ length: 20 }, (_, index) => candle(start + index * 300_000, 100, 100.2, 99.8, 100, 100));
  candles.push(candle(start + 20 * 300_000, 100, 100.1, 99.6, options.pendingReclaim ? 99.75 : 100.05, 100));
  if (options.pendingReclaim) return candles;
  candles.push(candle(start + 21 * 300_000, 100, 100.55, 99.95, 100.5, 100));
  candles.push(candle(start + 22 * 300_000, 100.45, options.lowRr ? 101.02 : 100.75, 100.2, 100.7, 100));
  if (options.pendingFvgRetest) return candles;
  if (options.expireFvgRetest) {
    candles.push(candle(start + 23 * 300_000, 100.8, 101.0, 100.62, 100.9, 100));
    candles.push(candle(start + 24 * 300_000, 100.9, 101.05, 100.58, 100.95, 100));
    candles.push(candle(start + 25 * 300_000, 100.95, 101.1, 100.7, 101.0, 100));
    return candles;
  }
  candles.push(candle(start + 23 * 300_000, 100.45, options.lowRr ? 101.02 : 100.5, 100.15, 100.3, 100));
  if (options.expireConfirmation) {
    candles.push(candle(start + 24 * 300_000, 100.25, 100.32, 100.18, 100.27, 100));
    candles.push(candle(start + 25 * 300_000, 100.27, 100.3, 100.1, 100.2, 100));
    return candles;
  }
  candles.push(candle(start + 24 * 300_000, 100.25, 100.7, 100.2, 100.65, 100));
  return candles;
}

function silverBulletSellCandles(): Candle[] {
  const start = Date.UTC(2026, 6, 2, 5, 55);
  const candles = Array.from({ length: 20 }, (_, index) => candle(start + index * 300_000, 100, 100.2, 99.8, 100, 100));
  candles.push(candle(start + 20 * 300_000, 100, 100.4, 99.9, 99.95, 100));
  candles.push(candle(start + 21 * 300_000, 100, 100.05, 99.45, 99.5, 100));
  candles.push(candle(start + 22 * 300_000, 99.55, 99.8, 99.25, 99.3, 100));
  candles.push(candle(start + 23 * 300_000, 99.55, 99.85, 99.5, 99.7, 100));
  candles.push(candle(start + 24 * 300_000, 99.75, 99.8, 99.3, 99.35, 100));
  return candles;
}

function emaTrendBuyCandles(options: { timeframe?: "1m" | "5m"; outsideSession?: boolean; extended?: boolean; lowRr?: boolean } = {}): Candle[] {
  const step = options.timeframe === "1m" ? 60_000 : 300_000;
  const start = options.outsideSession
    ? Date.UTC(2026, 6, 2, 0, 0)
    : options.timeframe === "1m"
      ? Date.UTC(2026, 6, 2, 11, 0)
      : Date.UTC(2026, 6, 1, 20, 0);
  return Array.from({ length: 202 }, (_, index) => {
    const timestamp = start + index * step;
    const base = 100 + index * 0.03;
    if (options.extended && index >= 199) {
      const extended = base + 6;
      return candle(timestamp, extended - 0.1, extended + 0.35, extended - 0.25, extended + 0.25, 100);
    }
    if (index === 200) return candle(timestamp, base + 0.02, base + 0.22, base - 0.78, base - 0.20, 100);
    if (index === 201 && options.lowRr) return candle(timestamp, base - 0.48, base + 0.02, base - 0.58, base - 0.03, 100);
    if (index === 201) return candle(timestamp, base - 0.25, base + 0.55, base - 0.35, base + 0.42, 100);
    return candle(timestamp, base, base + 0.35, base - 0.35, base + 0.02, 100);
  });
}

function emaTrendSellCandles(): Candle[] {
  const start = Date.UTC(2026, 6, 1, 20, 0);
  return Array.from({ length: 202 }, (_, index) => {
    const timestamp = start + index * 300_000;
    const base = 106 - index * 0.03;
    if (index === 200) return candle(timestamp, base - 0.02, base + 0.78, base - 0.22, base + 0.20, 100);
    if (index === 201) return candle(timestamp, base + 0.25, base + 0.35, base - 0.55, base - 0.42, 100);
    return candle(timestamp, base, base + 0.35, base - 0.35, base - 0.02, 100);
  });
}

function liquiditySweepBuyCandles(options: { smallSweep?: boolean; largeSweep?: boolean; noReclaim?: boolean; lowRr?: boolean; pending?: boolean; outsideSession?: boolean } = {}): Candle[] {
  const start = options.outsideSession ? Date.UTC(2026, 6, 2, 0, 0) : Date.UTC(2026, 6, 2, 12, 0);
  const level = 100.23;
  const targetHigh = options.lowRr ? 102.05 : 104.4;
  const candles = Array.from({ length: options.pending ? 35 : 36 }, (_, index) => {
    const timestamp = start + index * 300_000;
    const base = 100.72 + (index % 7) * 0.015;
    if (index === 18) return candle(timestamp, 100.62, 100.95, level, 100.7, 100);
    if (index === 25) return candle(timestamp, 100.82, targetHigh, 100.58, 100.9, 100);
    if (index === 34) {
      const sweepLow = options.smallSweep ? level - 0.01 : options.largeSweep ? level - 1.35 : level - 0.16;
      const sweepClose = options.noReclaim ? level - 0.08 : level + 0.22;
      return candle(timestamp, level + 0.35, level + 0.48, sweepLow, sweepClose, 100);
    }
    if (index === 35) {
      const close = options.noReclaim ? level - 0.04 : 101.18;
      return candle(timestamp, 100.48, 101.45, 100.36, close, 100);
    }
    const low = 100.48 + (index % 5) * 0.09 + Math.floor(index / 5) * 0.006;
    return candle(timestamp, base, Math.max(base + 0.28, low + 0.25), low, base + 0.04, 100);
  });
  return candles;
}

function liquiditySweepSellCandles(): Candle[] {
  const start = Date.UTC(2026, 6, 2, 12, 0);
  const level = 103.77;
  return Array.from({ length: 36 }, (_, index) => {
    const timestamp = start + index * 300_000;
    const base = 103.28 - (index % 7) * 0.015;
    if (index === 18) return candle(timestamp, 103.38, level, 103.05, 103.3, 100);
    if (index === 25) return candle(timestamp, 103.18, 103.42, 99.6, 103.1, 100);
    if (index === 34) return candle(timestamp, level - 0.35, level + 0.16, level - 0.48, level - 0.22, 100);
    if (index === 35) return candle(timestamp, 103.52, 103.64, 102.55, 102.82, 100);
    const high = 103.52 - (index % 5) * 0.09 - Math.floor(index / 5) * 0.006;
    return candle(timestamp, base, high, Math.min(base - 0.28, high - 0.25), base - 0.04, 100);
  });
}

function fvgContinuationBuyCandles(options: { noDisplacement?: boolean; pendingRetest?: boolean; expireRetest?: boolean; invalidateFvg?: boolean; expireConfirmation?: boolean; lowRr?: boolean } = {}): Candle[] {
  const start = Date.UTC(2026, 6, 2, 12, 0);
  const candles = Array.from({ length: 20 }, (_, index) => candle(start + index * 300_000, 100, 100.2, 99.8, 100, 100));
  if (options.lowRr) {
    candles[10] = candle(start + 10 * 300_000, 100.0, 101.2, 99.8, 100.1, 100);
  }
  const displacementClose = options.lowRr ? 101.35 : options.noDisplacement ? 100.55 : 101.1;
  const displacementHigh = options.lowRr ? 101.45 : options.noDisplacement ? 100.65 : 101.2;
  candles.push(candle(start + 20 * 300_000, 100.4, displacementHigh, 100.35, displacementClose, 100));
  if (options.pendingRetest) return candles;
  if (options.expireRetest) {
    for (let offset = 1; offset <= 13; offset++) {
      candles.push(candle(start + (20 + offset) * 300_000, 100.75, 101.0, 100.55, 100.85, 100));
    }
    return candles;
  }
  if (options.invalidateFvg) {
    candles.push(candle(start + 21 * 300_000, 100.5, 100.6, 100.1, 100.05, 100));
    return candles;
  }
  candles.push(candle(start + 21 * 300_000, 100.5, 100.8, 100.22, 100.45, 100));
  if (options.expireConfirmation) {
    candles.push(candle(start + 22 * 300_000, 100.45, 100.52, 100.32, 100.48, 100));
    candles.push(candle(start + 23 * 300_000, 100.48, 100.55, 100.31, 100.46, 100));
    candles.push(candle(start + 24 * 300_000, 100.46, 100.53, 100.30, 100.44, 100));
    candles.push(candle(start + 25 * 300_000, 100.44, 100.51, 100.29, 100.43, 100));
    return candles;
  }
  candles.push(candle(start + 22 * 300_000, 100.45, 101.18, 100.38, 101.1, 100));
  return candles;
}

function fvgContinuationSellCandles(): Candle[] {
  const start = Date.UTC(2026, 6, 2, 12, 0);
  const candles = Array.from({ length: 20 }, (_, index) => candle(start + index * 300_000, 100, 100.2, 99.8, 100, 100));
  candles.push(candle(start + 20 * 300_000, 99.6, 99.65, 98.8, 98.9, 100));
  candles.push(candle(start + 21 * 300_000, 99.45, 99.78, 99.2, 99.55, 100));
  candles.push(candle(start + 22 * 300_000, 99.55, 99.62, 98.82, 98.9, 100));
  return candles;
}

function proLiquidityBuyCandles(options: { noSweep?: boolean; lowRr?: boolean } = {}): Candle[] {
  const start = Date.UTC(2026, 6, 2, 12, 0);
  const level = 100.2;
  const candles = Array.from({ length: 34 }, (_, index) => {
    const timestamp = start + index * 300_000;
    const base = 100.55 + (index % 6) * 0.015;
    if (index === 12) return candle(timestamp, 100.48, 100.86, level, 100.58, 100);
    if (index === 24) return candle(timestamp, 100.62, options.lowRr ? 101.16 : 100.88, 100.34, 100.7, 100);
    return candle(timestamp, base, base + 0.24, 100.31 + (index % 4) * 0.03, base + 0.03, 100);
  });
  candles.push(candle(start + 34 * 300_000, 100.55, 100.7, options.noSweep ? 100.24 : 100.04, 100.35, 100));
  if (options.lowRr) {
    candles.push(candle(start + 35 * 300_000, 100.35, 101.2, 100.28, 101.15, 100));
    candles.push(candle(start + 36 * 300_000, 101.05, 101.32, 100.82, 101.18, 100));
    candles.push(candle(start + 37 * 300_000, 101.0, 101.05, 100.74, 100.88, 100));
    candles.push(candle(start + 38 * 300_000, 100.86, 101.05, 100.82, 100.98, 100));
    return candles;
  }
  candles.push(candle(start + 35 * 300_000, 100.35, 101.05, 100.28, 101.0, 100));
  candles.push(candle(start + 36 * 300_000, 101.0, 101.25, 100.82, 101.18, 100));
  candles.push(candle(start + 37 * 300_000, 101.0, 101.05, 100.74, 100.88, 100));
  candles.push(candle(start + 38 * 300_000, 100.86, 101.45, 100.82, 101.35, 100));
  return candles;
}

function proLiquiditySellCandles(): Candle[] {
  const start = Date.UTC(2026, 6, 2, 12, 0);
  const level = 103.8;
  const candles = Array.from({ length: 34 }, (_, index) => {
    const timestamp = start + index * 300_000;
    const base = 103.45 - (index % 6) * 0.015;
    if (index === 12) return candle(timestamp, 103.52, level, 103.12, 103.42, 100);
    return candle(timestamp, base, 103.69 - (index % 4) * 0.03, base - 0.24, base - 0.03, 100);
  });
  candles.push(candle(start + 34 * 300_000, 103.45, 103.96, 103.3, 103.65, 100));
  candles.push(candle(start + 35 * 300_000, 103.65, 103.72, 102.95, 103.0, 100));
  candles.push(candle(start + 36 * 300_000, 103.0, 103.18, 102.75, 102.82, 100));
  candles.push(candle(start + 37 * 300_000, 103.0, 103.24, 102.94, 103.12, 100));
  candles.push(candle(start + 38 * 300_000, 103.14, 103.18, 102.55, 102.65, 100));
  return candles;
}

function input(candles: Candle[], timeframe: "1m" | "5m" = "5m"): V2GoldmineInput {
  return { candles, symbol: "XAUUSD", timeframe, startDate: candles[0].time, endDate: candles.at(-1)!.time, structure: {} as MarketStructureResult, context: {} as MarketContextResult };
}

function candle(timestamp: number, open: number, high: number, low: number, close: number, volume: number): Candle {
  return { time: new Date(timestamp).toISOString(), timestamp, open, high, low, close, volume, closeTime: timestamp + 299_999, isClosed: true };
}
