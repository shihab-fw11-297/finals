import type { Candle, Timeframe } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { MarketContextResult, TradingSession } from "../market-context/types";
import { deriveCandleBias, type HTFLiquidityContextResult } from "./htf-liquidity-context";
import type { KillzoneGatekeeperResult } from "./killzone-gatekeeper";
import type {
  InstitutionalFactorName,
  InstitutionalMode,
  InstitutionalReasonCode,
} from "./institutional-types";
import type { StructuralStopResult } from "./structural-stop-engine";
import type { StructuralTakeProfitResult } from "./htf-liquidity-target-engine";

export type InstitutionalConfluenceResult = {
  passed: boolean;
  factorScore: number;
  maxFactors: 6;
  passedFactors: InstitutionalFactorName[];
  failedFactors: InstitutionalFactorName[];
  failureReasons: InstitutionalReasonCode[];
  warnings: string[];
  debug: Record<string, unknown>;
};

export function evaluateInstitutionalConfluence(input: {
  rawSignal: TradeSignal;
  candles: Candle[];
  ltfCandles: Candle[];
  itfCandles: Candle[];
  htfCandles: Candle[];
  timeframe: Timeframe;
  atr: number;
  session: TradingSession;
  marketContext: MarketContextResult;
  htfLiquidityContext: HTFLiquidityContextResult;
  mode: InstitutionalMode;
  killzoneResult?: KillzoneGatekeeperResult;
  structuralStop?: StructuralStopResult;
  structuralTarget?: StructuralTakeProfitResult;
}): InstitutionalConfluenceResult {
  const passedFactors: InstitutionalFactorName[] = [];
  const failedFactors: InstitutionalFactorName[] = [];
  const failureReasons: InstitutionalReasonCode[] = [];
  const warnings: string[] = [];
  const direction = signalDirection(input.rawSignal);
  const htfBias = deriveCandleBias(input.htfCandles.length ? input.htfCandles : input.itfCandles);
  const strongReversal = hasSweep(input.rawSignal) && hasStrongDisplacement(input.rawSignal, input.atr);

  factor(
    "HTF Bias Alignment",
    !input.htfLiquidityContext.suppressed
      && (htfBias === "NEUTRAL" || htfBias === directionBias(direction) || strongReversal),
    htfBias !== "NEUTRAL" && htfBias !== directionBias(direction) ? "HTF_BIAS_NOT_ALIGNED" : "HTF_LIQUIDITY_TARGET_TOO_CLOSE",
  );

  factor(
    "Killzone / Session Timing",
    input.killzoneResult?.passed ?? input.session !== "DEAD_ZONE",
    input.session === "DEAD_ZONE" ? "DEAD_ZONE_REJECTED" : "INVALID_SESSION",
  );

  const sweepQuality = evaluateSweep(input.rawSignal, input.atr);
  factor("Liquidity Sweep Quality", sweepQuality.passed, sweepQuality.reason);

  const displacement = evaluateDisplacement(input.rawSignal, input.atr, input.mode);
  factor("Displacement / MSS Strength", displacement.passed, displacement.reason);
  warnings.push(...displacement.warnings);

  const zone = evaluateZone(input.rawSignal, input.atr);
  factor("Entry Zone Quality", zone.passed, zone.reason);

  const riskPassed = Boolean(
    input.structuralStop?.valid
    && input.structuralTarget
    && input.structuralTarget.rr >= 2.5
    && !input.structuralTarget.htfConflict,
  );
  factor(
    "Risk:Reward and Structural Trade Quality",
    riskPassed,
    !input.structuralStop?.valid
      ? "STOP_NOT_STRUCTURAL"
      : (input.structuralTarget?.rr ?? 0) < 2.5
        ? "RR_BELOW_2_5"
        : "TP_INTO_HTF_OBSTACLE",
  );

  const threshold = input.session === "LONDON" || input.session === "NEW_YORK"
    ? 3
    : 4;

  return {
    passed: passedFactors.length >= threshold && riskPassed && !input.htfLiquidityContext.suppressed,
    factorScore: passedFactors.length,
    maxFactors: 6,
    passedFactors,
    failedFactors,
    failureReasons,
    warnings,
    debug: {
      htfBias,
      threshold,
      strongReversal,
      sweepQuality,
      displacement,
      zone,
      structuralStop: input.structuralStop,
      structuralTarget: input.structuralTarget,
    },
  };

  function factor(
    name: InstitutionalFactorName,
    passed: boolean,
    reason: InstitutionalReasonCode,
  ): void {
    if (passed) passedFactors.push(name);
    else {
      failedFactors.push(name);
      failureReasons.push(reason);
    }
  }
}

function evaluateSweep(signal: TradeSignal, atr: number): { passed: boolean; reason: InstitutionalReasonCode } {
  const stock = signal.stockGuruSweepFvgOb;
  if (stock?.liquidity.sweepFound) {
    if (!stock.liquidity.reclaimFound) return { passed: false, reason: "NO_RECLAIM_AFTER_SWEEP" };
    const distance = Math.abs((stock.liquidity.sweepPrice ?? signal.entryPrice) - (stock.liquidity.level ?? signal.entryPrice)) / Math.max(atr, Number.EPSILON);
    if (distance < 0.04) return { passed: false, reason: "SWEEP_TOO_SHALLOW" };
    if (distance > 1.5) return { passed: false, reason: "SWEEP_TOO_DEEP" };
    return { passed: true, reason: "NO_VALID_LIQUIDITY_SWEEP" };
  }
  const silver = signal.silverBullet;
  if (silver) {
    if (!silver.sweep.reclaimed) return { passed: false, reason: "NO_RECLAIM_AFTER_SWEEP" };
    if (silver.sweep.sweepDistanceAtr < 0.04) return { passed: false, reason: "SWEEP_TOO_SHALLOW" };
    if (silver.sweep.sweepDistanceAtr > 1.5) return { passed: false, reason: "SWEEP_TOO_DEEP" };
    return { passed: true, reason: "NO_VALID_LIQUIDITY_SWEEP" };
  }
  if (signal.sweep) return { passed: true, reason: "NO_VALID_LIQUIDITY_SWEEP" };
  if (signal.liquiditySweepReversal?.sweep.reclaimed) return { passed: true, reason: "NO_VALID_LIQUIDITY_SWEEP" };
  if (signal.breakout?.candleIndex !== undefined && signal.retest?.candleIndex !== undefined) {
    return { passed: true, reason: "NO_VALID_LIQUIDITY_SWEEP" };
  }
  if (hasStrongDisplacement(signal, atr) && hasCloseStructureBreak(signal)) {
    return { passed: true, reason: "NO_VALID_LIQUIDITY_SWEEP" };
  }
  return { passed: false, reason: "NO_VALID_LIQUIDITY_SWEEP" };
}

function evaluateDisplacement(
  signal: TradeSignal,
  atr: number,
  mode: InstitutionalMode,
): { passed: boolean; reason: InstitutionalReasonCode; warnings: string[] } {
  const metrics = displacementMetrics(signal);
  const warnings: string[] = [];
  if (!metrics) return { passed: false, reason: "DISPLACEMENT_TOO_WEAK", warnings };
  if (metrics.rangeAtr > 3.5) return { passed: false, reason: "CONFIRMATION_CANDLE_TOO_LARGE", warnings };
  if (metrics.rangeAtr < (signal.strategyId === "STOCK_GURU_SWEEP_FVG_OB_ENGINE" ? 0.6 : 0.4) || metrics.bodyRatio < 0.55 || metrics.closePosition < 0.6) {
    return { passed: false, reason: "DISPLACEMENT_TOO_WEAK", warnings };
  }
  if (!hasCloseStructureBreak(signal)) {
    if (mode === "strict") return { passed: false, reason: "ONLY_WICK_CHOCH", warnings };
    warnings.push("ONLY_WICK_CHOCH");
  }
  return { passed: true, reason: "DISPLACEMENT_TOO_WEAK", warnings };
}

function evaluateZone(signal: TradeSignal, atr: number): { passed: boolean; reason: InstitutionalReasonCode } {
  const zone = zoneMetrics(signal, atr);
  if (!zone) {
    if (signal.breakout && signal.retest) return { passed: true, reason: "NO_VALID_ENTRY_ZONE" };
    return { passed: false, reason: "NO_VALID_ENTRY_ZONE" };
  }
  if (zone.invalidated) return { passed: false, reason: "ZONE_INVALIDATED" };
  if (zone.sizeAtr > 2) return { passed: false, reason: "ZONE_TOO_LARGE" };
  if (zone.sizeAtr < 0.03) return { passed: false, reason: "ZONE_TOO_SMALL" };
  if (zone.age > 80) return { passed: false, reason: "ZONE_STALE" };
  return { passed: true, reason: "NO_VALID_ENTRY_ZONE" };
}

function displacementMetrics(signal: TradeSignal): { rangeAtr: number; bodyRatio: number; closePosition: number } | null {
  if (signal.stockGuruSweepFvgOb) return {
    rangeAtr: signal.stockGuruSweepFvgOb.displacement.rangeAtrMultiple,
    bodyRatio: signal.stockGuruSweepFvgOb.displacement.bodyRatio,
    closePosition: signal.stockGuruSweepFvgOb.displacement.closePosition,
  };
  const item = signal.silverBullet?.displacement ?? signal.fvgContinuation?.displacement;
  if (item) return { rangeAtr: item.rangeAtrMultiple, bodyRatio: item.bodyRatio, closePosition: item.closePosition };
  if (signal.orderBlockRetest) return {
    rangeAtr: signal.orderBlockRetest.displacement.rangeAtrMultiple,
    bodyRatio: signal.orderBlockRetest.displacement.bodyRatio,
    closePosition: signal.orderBlockRetest.confirmation.closePosition,
  };
  if (signal.confirmation) return {
    rangeAtr: signal.confirmation.quality,
    bodyRatio: signal.confirmation.quality,
    closePosition: signal.confirmation.quality,
  };
  return null;
}

function zoneMetrics(signal: TradeSignal, atr: number): { sizeAtr: number; age: number; invalidated: boolean } | null {
  const stock = signal.stockGuruSweepFvgOb;
  if (
    stock
    && typeof stock.selectedZone.low === "number"
    && typeof stock.selectedZone.high === "number"
  ) return {
    sizeAtr: Math.abs(stock.selectedZone.high - stock.selectedZone.low) / Math.max(atr, Number.EPSILON),
    age: signal.confirmedAtIndex - (stock.selectedZone.createdAtIndex ?? signal.confirmedAtIndex),
    invalidated: false,
  };
  if (signal.silverBullet) return {
    sizeAtr: Math.abs(signal.silverBullet.fvg.top - signal.silverBullet.fvg.bottom) / Math.max(atr, Number.EPSILON),
    age: signal.confirmedAtIndex - signal.silverBullet.fvg.createdAtIndex,
    invalidated: false,
  };
  if (signal.fvgContinuation) return {
    sizeAtr: signal.fvgContinuation.fvg.sizeAtr,
    age: signal.confirmedAtIndex - signal.fvgContinuation.fvg.createdAtIndex,
    invalidated: signal.fvgContinuation.fvg.invalidated,
  };
  if (signal.orderBlockRetest) return {
    sizeAtr: signal.orderBlockRetest.orderBlock.sizeAtr,
    age: signal.orderBlockRetest.orderBlock.ageCandles,
    invalidated: false,
  };
  if (signal.asianRange) return {
    sizeAtr: signal.asianRange.rangeSize / Math.max(atr, Number.EPSILON),
    age: 0,
    invalidated: !signal.asianRange.valid,
  };
  return null;
}

function hasSweep(signal: TradeSignal): boolean {
  return Boolean(
    signal.sweep
    || signal.silverBullet?.sweep.reclaimed
    || signal.liquiditySweepReversal?.sweep.reclaimed
    || signal.stockGuruSweepFvgOb?.liquidity.sweepFound,
  );
}

function hasStrongDisplacement(signal: TradeSignal, atr: number): boolean {
  const metrics = displacementMetrics(signal);
  return Boolean(metrics && metrics.rangeAtr >= 0.6 && metrics.bodyRatio >= 0.55 && atr > 0);
}

function hasCloseStructureBreak(signal: TradeSignal): boolean {
  if (signal.stockGuruSweepFvgOb) return signal.stockGuruSweepFvgOb.structure.bosType === "CLOSE_BOS";
  if (signal.silverBullet) return signal.silverBullet.structureShift.type === "MSS";
  if (signal.fvgContinuation) return signal.fvgContinuation.structureBreak.type === "BOS";
  if (signal.orderBlockRetest) return true;
  if (signal.confirmation) return signal.confirmation.displacementType === "MSS";
  return false;
}

function signalDirection(signal: TradeSignal): "BUY" | "SELL" {
  return signal.v2Direction ?? (signal.direction === "BULLISH" ? "BUY" : "SELL");
}

function directionBias(direction: "BUY" | "SELL"): "BULLISH" | "BEARISH" {
  return direction === "BUY" ? "BULLISH" : "BEARISH";
}
