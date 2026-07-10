import { GOLDMINE_STRATEGY_ID, BREAKOUT_STRATEGY_ID, ICT_SILVER_BULLET_STRATEGY_ID, VWAP_EMA_STRATEGY_ID, EMA_TREND_PULLBACK_STRATEGY_ID, LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID, ORDER_BLOCK_RETEST_STRATEGY_ID, FVG_CONTINUATION_ENTRY_STRATEGY_ID, PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID, STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID, TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID, ICT_OTE_CONTINUATION_STRATEGY_ID, ICT_IFVG_REVERSAL_STRATEGY_ID } from "./config";
import { generateV2GoldmineSignals, clearV2GoldmineCache } from "./goldmine-asian-sweep";
import { generateV2AsianBreakoutSignals, clearV2AsianBreakoutCache } from "./asian-breakout-retest";
import { clearIctSilverBulletCache, generateIctSilverBulletSignals } from "./ict-silver-bullet";
import { clearVwapEmaRegimePullbackCache, generateVwapEmaRegimePullbackSignals } from "./vwap-ema-regime-pullback";
import { clearEmaTrendPullbackCache, generateEmaTrendPullbackSignals } from "./ema-trend-pullback";
import { clearLiquiditySweepReversalProCache, generateLiquiditySweepReversalProSignals } from "./liquidity-sweep-reversal-pro";
import { clearOrderBlockRetestCache, generateOrderBlockRetestSignals } from "./order-block-retest";
import { clearFvgContinuationEntryCache, generateFvgContinuationEntrySignals } from "./fvg-continuation-entry";
import { clearProLiquidityConfluenceCache, generateProLiquidityConfluenceSignals } from "./pro-liquidity-confluence-engine";
import { clearStockGuruSweepFvgObCache, generateStockGuruSweepFvgObSignals } from "./stock-guru-sweep-fvg-ob-engine";
import { clearTjrSimpleStructurePullbackCache, generateTjrSimpleStructurePullbackSignals } from "./tjr-simple-structure-pullback-engine";
import { clearIctOteContinuationCache, generateIctOteContinuationSignals } from "./ict-ote-continuation-engine";
import { clearIctIfvgReversalCache, generateIctIfvgReversalSignals } from "./ict-ifvg-reversal";
import { calculateATR } from "./indicators";
import { selectMasterSignals } from "./master-signal-selector";
import { attachSignalFollowThrough } from "./signal-follow-through-engine";

import type { V2GoldmineInput } from "./types";
import type { EntryEngineResult, TradeSignal } from "../entry-engine/types";

export function clearV2Cache(): void {
  clearV2GoldmineCache();
  clearV2AsianBreakoutCache();
  clearIctSilverBulletCache();
  clearVwapEmaRegimePullbackCache();
  clearEmaTrendPullbackCache();
  clearLiquiditySweepReversalProCache();
  clearOrderBlockRetestCache();
  clearFvgContinuationEntryCache();
  clearProLiquidityConfluenceCache();
  clearStockGuruSweepFvgObCache();
  clearTjrSimpleStructurePullbackCache();
  clearIctOteContinuationCache();
  clearIctIfvgReversalCache();
}


export function generateV2Signals(strategyId: string, input: V2GoldmineInput): EntryEngineResult {
  if (strategyId === GOLDMINE_STRATEGY_ID) {
    return withSignalFollowThrough(generateV2GoldmineSignals(input), input);
  }
  
  if (strategyId === BREAKOUT_STRATEGY_ID) {
    return withSignalFollowThrough(generateV2AsianBreakoutSignals(input), input);
  }

  if (strategyId === ICT_SILVER_BULLET_STRATEGY_ID) {
    return withSignalFollowThrough(generateIctSilverBulletSignals(input), input);
  }

  if (strategyId === VWAP_EMA_STRATEGY_ID) {
    return withSignalFollowThrough(generateVwapEmaRegimePullbackSignals(input), input);
  }

  if (strategyId === EMA_TREND_PULLBACK_STRATEGY_ID) {
    return withSignalFollowThrough(generateEmaTrendPullbackSignals(input), input);
  }

  if (strategyId === LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID) {
    return withSignalFollowThrough(generateLiquiditySweepReversalProSignals(input), input);
  }

  if (strategyId === ORDER_BLOCK_RETEST_STRATEGY_ID) {
    return withSignalFollowThrough(generateOrderBlockRetestSignals(input), input);
  }

  if (strategyId === FVG_CONTINUATION_ENTRY_STRATEGY_ID) {
    return withSignalFollowThrough(generateFvgContinuationEntrySignals(input), input);
  }

  if (strategyId === PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID) {
    return withSignalFollowThrough(generateProLiquidityConfluenceSignals(input), input);
  }

  if (strategyId === STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID) {
    return withSignalFollowThrough(generateStockGuruSweepFvgObSignals(input), input);
  }

  if (strategyId === TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID) {
    return withSignalFollowThrough(generateTjrSimpleStructurePullbackSignals(input), input);
  }

  if (strategyId === ICT_OTE_CONTINUATION_STRATEGY_ID) {
    return withSignalFollowThrough(generateIctOteContinuationSignals(input), input);
  }

  if (strategyId === ICT_IFVG_REVERSAL_STRATEGY_ID) {
    return withSignalFollowThrough(generateIctIfvgReversalSignals(input), input);
  }

  // If ALL_V2 or unspecified, run every independent V2 strategy and merge.
  const goldmineResult = generateV2GoldmineSignals(input);
  const breakoutResult = generateV2AsianBreakoutSignals(input);
  const silverBulletResult = generateIctSilverBulletSignals(input);
  const vwapEmaResult = generateVwapEmaRegimePullbackSignals(input);
  const emaTrendPullbackResult = generateEmaTrendPullbackSignals(input);
  const liquiditySweepReversalResult = generateLiquiditySweepReversalProSignals(input);
  const orderBlockRetestResult = generateOrderBlockRetestSignals(input);
  const fvgContinuationResult = generateFvgContinuationEntrySignals(input);
  const proLiquidityConfluenceResult = generateProLiquidityConfluenceSignals(input);
  const stockGuruSweepFvgObResult = generateStockGuruSweepFvgObSignals(input);
  const tjrSimpleStructurePullbackResult = generateTjrSimpleStructurePullbackSignals(input);
  const ictOteContinuationResult = generateIctOteContinuationSignals(input);
  const ictIfvgReversalResult = generateIctIfvgReversalSignals(input);

  const rawSignals = [...goldmineResult.signals, ...breakoutResult.signals, ...silverBulletResult.signals, ...vwapEmaResult.signals, ...emaTrendPullbackResult.signals, ...liquiditySweepReversalResult.signals, ...orderBlockRetestResult.signals, ...fvgContinuationResult.signals, ...proLiquidityConfluenceResult.signals, ...stockGuruSweepFvgObResult.signals, ...tjrSimpleStructurePullbackResult.signals, ...ictOteContinuationResult.signals, ...ictIfvgReversalResult.signals].sort(
    (a, b) => a.confirmedAtIndex - b.confirmedAtIndex
  );
  const atr = calculateATR(input.candles.filter((candle) => candle.isClosed), 14);
  const signals = attachSignalFollowThrough({
    signals: rawSignals,
    candles: input.candles,
    ltfCandles: input.candles,
    itfCandles: input.context.itfCandles,
    htfCandles: input.context.htfCandles,
    timeframe: input.timeframe,
    atr,
    session: input.context.session?.session,
    marketContext: input.context,
  });


  const signalMap = new Map<string, TradeSignal>();
  for (const s of signals) {
    signalMap.set(s.id, s);
  }

  const pendingCandidates = [
    ...goldmineResult.pendingCandidates,
    ...breakoutResult.pendingCandidates,
    ...silverBulletResult.pendingCandidates,
    ...vwapEmaResult.pendingCandidates,
    ...emaTrendPullbackResult.pendingCandidates,
    ...liquiditySweepReversalResult.pendingCandidates,
    ...orderBlockRetestResult.pendingCandidates,
    ...fvgContinuationResult.pendingCandidates,
    ...proLiquidityConfluenceResult.pendingCandidates,
    ...stockGuruSweepFvgObResult.pendingCandidates,
    ...tjrSimpleStructurePullbackResult.pendingCandidates,
    ...ictOteContinuationResult.pendingCandidates,
    ...ictIfvgReversalResult.pendingCandidates,
  ];

  const candidateDebug = [
    ...goldmineResult.candidateDebug,
    ...breakoutResult.candidateDebug,
    ...silverBulletResult.candidateDebug,
    ...vwapEmaResult.candidateDebug,
    ...emaTrendPullbackResult.candidateDebug,
    ...liquiditySweepReversalResult.candidateDebug,
    ...orderBlockRetestResult.candidateDebug,
    ...fvgContinuationResult.candidateDebug,
    ...proLiquidityConfluenceResult.candidateDebug,
    ...stockGuruSweepFvgObResult.candidateDebug,
    ...tjrSimpleStructurePullbackResult.candidateDebug,
    ...ictOteContinuationResult.candidateDebug,
    ...ictIfvgReversalResult.candidateDebug,
  ];

  const rejectedSetups = [
    ...goldmineResult.rejectedSetups,
    ...breakoutResult.rejectedSetups,
    ...silverBulletResult.rejectedSetups,
    ...vwapEmaResult.rejectedSetups,
    ...emaTrendPullbackResult.rejectedSetups,
    ...liquiditySweepReversalResult.rejectedSetups,
    ...orderBlockRetestResult.rejectedSetups,
    ...fvgContinuationResult.rejectedSetups,
    ...proLiquidityConfluenceResult.rejectedSetups,
    ...stockGuruSweepFvgObResult.rejectedSetups,
    ...tjrSimpleStructurePullbackResult.rejectedSetups,
    ...ictOteContinuationResult.rejectedSetups,
    ...ictIfvgReversalResult.rejectedSetups,
  ];

  const goldmineAudit = goldmineResult.audit;
  const breakoutAudit = breakoutResult.audit;

  const combinedAudit = {
    ...goldmineAudit,
    strategyId: "ALL_V2",
    totalCandlesScanned: goldmineAudit.totalCandlesScanned,
    confirmedBuyCount: goldmineAudit.confirmedBuyCount + breakoutAudit.confirmedBuyCount + silverBulletResult.audit.confirmedBuyCount + vwapEmaResult.audit.confirmedBuyCount + emaTrendPullbackResult.audit.confirmedBuyCount + liquiditySweepReversalResult.audit.confirmedBuyCount + orderBlockRetestResult.audit.confirmedBuyCount + fvgContinuationResult.audit.confirmedBuyCount + proLiquidityConfluenceResult.audit.confirmedBuyCount + stockGuruSweepFvgObResult.audit.confirmedBuyCount + tjrSimpleStructurePullbackResult.audit.confirmedBuyCount + ictOteContinuationResult.audit.confirmedBuyCount + ictIfvgReversalResult.audit.confirmedBuyCount,
    confirmedSellCount: goldmineAudit.confirmedSellCount + breakoutAudit.confirmedSellCount + silverBulletResult.audit.confirmedSellCount + vwapEmaResult.audit.confirmedSellCount + emaTrendPullbackResult.audit.confirmedSellCount + liquiditySweepReversalResult.audit.confirmedSellCount + orderBlockRetestResult.audit.confirmedSellCount + fvgContinuationResult.audit.confirmedSellCount + proLiquidityConfluenceResult.audit.confirmedSellCount + stockGuruSweepFvgObResult.audit.confirmedSellCount + tjrSimpleStructurePullbackResult.audit.confirmedSellCount + ictOteContinuationResult.audit.confirmedSellCount + ictIfvgReversalResult.audit.confirmedSellCount,
    rejectedSetupCount: goldmineAudit.rejectedSetupCount + breakoutAudit.rejectedSetupCount + silverBulletResult.audit.rejectedSetupCount + vwapEmaResult.audit.rejectedSetupCount + emaTrendPullbackResult.audit.rejectedSetupCount + liquiditySweepReversalResult.audit.rejectedSetupCount + orderBlockRetestResult.audit.rejectedSetupCount + fvgContinuationResult.audit.rejectedSetupCount + proLiquidityConfluenceResult.audit.rejectedSetupCount + stockGuruSweepFvgObResult.audit.rejectedSetupCount + tjrSimpleStructurePullbackResult.audit.rejectedSetupCount + ictOteContinuationResult.audit.rejectedSetupCount + ictIfvgReversalResult.audit.rejectedSetupCount,
    pendingConfirmationCount: goldmineAudit.pendingConfirmationCount + breakoutAudit.pendingConfirmationCount + silverBulletResult.audit.pendingConfirmationCount + vwapEmaResult.audit.pendingConfirmationCount + emaTrendPullbackResult.audit.pendingConfirmationCount + liquiditySweepReversalResult.audit.pendingConfirmationCount + orderBlockRetestResult.audit.pendingConfirmationCount + fvgContinuationResult.audit.pendingConfirmationCount + proLiquidityConfluenceResult.audit.pendingConfirmationCount + stockGuruSweepFvgObResult.audit.pendingConfirmationCount + tjrSimpleStructurePullbackResult.audit.pendingConfirmationCount + ictOteContinuationResult.audit.pendingConfirmationCount + ictIfvgReversalResult.audit.pendingConfirmationCount,
    expiredCount: goldmineAudit.expiredCount + breakoutAudit.expiredCount + silverBulletResult.audit.expiredCount + vwapEmaResult.audit.expiredCount + emaTrendPullbackResult.audit.expiredCount + liquiditySweepReversalResult.audit.expiredCount + orderBlockRetestResult.audit.expiredCount + fvgContinuationResult.audit.expiredCount + proLiquidityConfluenceResult.audit.expiredCount + stockGuruSweepFvgObResult.audit.expiredCount + tjrSimpleStructurePullbackResult.audit.expiredCount + ictOteContinuationResult.audit.expiredCount + ictIfvgReversalResult.audit.expiredCount,
    generationTimeMs: goldmineAudit.generationTimeMs + breakoutAudit.generationTimeMs + silverBulletResult.audit.generationTimeMs + vwapEmaResult.audit.generationTimeMs + emaTrendPullbackResult.audit.generationTimeMs + liquiditySweepReversalResult.audit.generationTimeMs + orderBlockRetestResult.audit.generationTimeMs + fvgContinuationResult.audit.generationTimeMs + proLiquidityConfluenceResult.audit.generationTimeMs + stockGuruSweepFvgObResult.audit.generationTimeMs + tjrSimpleStructurePullbackResult.audit.generationTimeMs + ictOteContinuationResult.audit.generationTimeMs + ictIfvgReversalResult.audit.generationTimeMs,
    v2Goldmine: goldmineAudit.v2Goldmine,
    v2Breakout: breakoutAudit.v2Breakout,
    v2SilverBullet: silverBulletResult.audit.v2SilverBullet,
    v2VwapEma: vwapEmaResult.audit.v2VwapEma,
    v2EmaTrendPullback: emaTrendPullbackResult.audit.v2EmaTrendPullback,
    v2LiquiditySweepReversalPro: liquiditySweepReversalResult.audit.v2LiquiditySweepReversalPro,
    v2OrderBlockRetest: orderBlockRetestResult.audit.v2OrderBlockRetest,
    v2FvgContinuation: fvgContinuationResult.audit.v2FvgContinuation,
    v2ProLiquidityConfluence: proLiquidityConfluenceResult.audit.v2ProLiquidityConfluence,
    v2StockGuruSweepFvgOb: stockGuruSweepFvgObResult.audit.v2StockGuruSweepFvgOb,
    v2TjrSimpleStructurePullback: tjrSimpleStructurePullbackResult.audit.v2TjrSimpleStructurePullback,
    v2IctOteContinuation: ictOteContinuationResult.audit.v2IctOteContinuation,
    v2IctIfvgReversal: ictIfvgReversalResult.audit.v2IctIfvgReversal,
  };

  const noTrade = signals.length === 0 ? {
    status: "NO_TRADE" as const,
    checkedSetups: (goldmineResult.noTrade?.checkedSetups ?? 0) + (breakoutResult.noTrade?.checkedSetups ?? 0) + (silverBulletResult.noTrade?.checkedSetups ?? 0) + (vwapEmaResult.noTrade?.checkedSetups ?? 0) + (emaTrendPullbackResult.noTrade?.checkedSetups ?? 0) + (liquiditySweepReversalResult.noTrade?.checkedSetups ?? 0) + (orderBlockRetestResult.noTrade?.checkedSetups ?? 0) + (fvgContinuationResult.noTrade?.checkedSetups ?? 0) + (proLiquidityConfluenceResult.noTrade?.checkedSetups ?? 0) + (stockGuruSweepFvgObResult.noTrade?.checkedSetups ?? 0) + (tjrSimpleStructurePullbackResult.noTrade?.checkedSetups ?? 0) + (ictOteContinuationResult.noTrade?.checkedSetups ?? 0) + (ictIfvgReversalResult.noTrade?.checkedSetups ?? 0),
    rejectionReasons: [
      ...(goldmineResult.noTrade?.rejectionReasons ?? []),
      ...(breakoutResult.noTrade?.rejectionReasons ?? []),
      ...(silverBulletResult.noTrade?.rejectionReasons ?? []),
      ...(vwapEmaResult.noTrade?.rejectionReasons ?? []),
      ...(emaTrendPullbackResult.noTrade?.rejectionReasons ?? []),
      ...(liquiditySweepReversalResult.noTrade?.rejectionReasons ?? []),
      ...(orderBlockRetestResult.noTrade?.rejectionReasons ?? []),
      ...(fvgContinuationResult.noTrade?.rejectionReasons ?? []),
      ...(proLiquidityConfluenceResult.noTrade?.rejectionReasons ?? []),
      ...(stockGuruSweepFvgObResult.noTrade?.rejectionReasons ?? []),
      ...(tjrSimpleStructurePullbackResult.noTrade?.rejectionReasons ?? []),
      ...(ictOteContinuationResult.noTrade?.rejectionReasons ?? []),
      ...(ictIfvgReversalResult.noTrade?.rejectionReasons ?? []),
    ],
    message: "No confirmed V2 signals found for the selected candle range.",
    nearestPossibleSetup: null,
    requiredForSignal: ["A valid strategy setup", "Closed-candle confirmation"],
    timestamp: input.candles.filter((c) => c.isClosed).at(-1)?.timestamp ?? null,
  } : null;

  const masterSelection = selectMasterSignals({
    rawSignals: signals,
    pendingCandidates,
    strategyDebugRows: candidateDebug,
    candles: input.candles.filter((candle) => candle.isClosed),
    timeframe: input.timeframe,
    mode: input.settings?.currentMode ?? input.settings?.mode ?? "normal",
    marketContext: input.context,
    session: input.context.session?.session,
    atr,
  });

  return {
    signals,
    activeSignals: signals,
    signalMap,
    pendingCandidates,
    candidateDebug,
    rejectedSetups,
    noTrade,
    v2AsianRanges: goldmineResult.v2AsianRanges ?? breakoutResult.v2AsianRanges ?? [],
    audit: combinedAudit,
    masterSelection,
  };
}

function withSignalFollowThrough(result: EntryEngineResult, input: V2GoldmineInput): EntryEngineResult {
  const atr = calculateATR(input.candles.filter((candle) => candle.isClosed), 14);
  const signals = attachSignalFollowThrough({
    signals: result.signals,
    candles: input.candles,
    ltfCandles: input.candles,
    itfCandles: input.context.itfCandles,
    htfCandles: input.context.htfCandles,
    timeframe: input.timeframe,
    atr,
    session: input.context.session?.session,
    marketContext: input.context,
  });
  const signalMap = new Map<string, TradeSignal>();
  for (const signal of signals) {
    signalMap.set(signal.id, signal);
  }
  return {
    ...result,
    signals,
    activeSignals: signals,
    signalMap,
  };
}
