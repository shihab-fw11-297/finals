import type { Candle, Timeframe } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { MarketContextResult, TradingSession } from "../market-context/types";
import { evaluateInstitutionalConfluence, type InstitutionalConfluenceResult } from "./institutional-confluence-model";
import { evaluateHTFLiquidityContext, type HTFLiquidityContextResult } from "./htf-liquidity-context";
import { findStructuralTakeProfit, type StructuralTakeProfitResult } from "./htf-liquidity-target-engine";
import { applyKillzoneGatekeeper, type KillzoneGatekeeperResult } from "./killzone-gatekeeper";
import {
  type InstitutionalAction,
  type InstitutionalMasterSignal,
  type InstitutionalMode,
  type InstitutionalReasonCode,
  type InstitutionalRiskState,
  type InstitutionalScore,
  type TradingAppMode,
} from "./institutional-types";
import { evaluateProductionRisk, type RiskManagementResult } from "./risk-management-layer";
import { calculateStructuralStop, type StructuralStopResult } from "./structural-stop-engine";

export const INSTITUTIONAL_MASTER_GATEKEEPER_ID = "INSTITUTIONAL_MASTER_GATEKEEPER" as const;

export const PRODUCTION_STRATEGY_IDS = [
  "STOCK_GURU_SWEEP_FVG_OB_ENGINE",
  "ICT_SILVER_BULLET",
  "GOLDMINE_ASIAN_SWEEP_REVERSAL",
  "ASIAN_RANGE_BREAKOUT_RETEST",
] as const;

export type InstitutionalRejectedSignal = {
  signal: TradeSignal;
  reasons: InstitutionalReasonCode[];
  warnings: string[];
  stage: string;
  confluence?: InstitutionalConfluenceResult;
};

export type InstitutionalSuppressedSignal = InstitutionalRejectedSignal & {
  suppressedBy: string | null;
};

export type InstitutionalConflictSignal = {
  buySignalId: string;
  sellSignalId: string;
  decision: "BUY_SELECTED" | "SELL_SELECTED" | "NO_TRADE";
  reason: InstitutionalReasonCode;
};

export type InstitutionalCandidateDebug = {
  signalId: string;
  strategyId: string;
  killzone: KillzoneGatekeeperResult;
  structuralStop: StructuralStopResult;
  structuralTarget: StructuralTakeProfitResult;
  htfContext: HTFLiquidityContextResult;
  confluence: InstitutionalConfluenceResult;
  risk: RiskManagementResult;
  hardBlockers: InstitutionalReasonCode[];
};

export type InstitutionalMasterSelectionResult = {
  action: InstitutionalAction;
  finalSignal: InstitutionalMasterSignal | null;
  finalSignals: InstitutionalMasterSignal[];
  rejectedSignals: InstitutionalRejectedSignal[];
  suppressedSignals: InstitutionalSuppressedSignal[];
  conflictSignals: InstitutionalConflictSignal[];
  rawSignals: TradeSignal[];
  researchSignals: TradeSignal[];
  debug: {
    module: typeof INSTITUTIONAL_MASTER_GATEKEEPER_ID;
    appMode: TradingAppMode;
    evaluatedCount: number;
    productionEligibleCount: number;
    candidates: InstitutionalCandidateDebug[];
    noTradeReasons: InstitutionalReasonCode[];
  };
  warnings: string[];
};

export type SelectInstitutionalMasterSignalInput = {
  rawSignals: TradeSignal[];
  candles: Candle[];
  ltfCandles?: Candle[];
  itfCandles?: Candle[];
  htfCandles?: Candle[];
  timeframe: Timeframe;
  atr: number | Array<number | null>;
  session?: TradingSession;
  appMode: TradingAppMode;
  marketContext: MarketContextResult;
  previousMasterSignals?: InstitutionalMasterSignal[];
  riskState?: InstitutionalRiskState;
  options?: {
    mode?: InstitutionalMode;
    allowTjrInEasyMode?: boolean;
    maxProductionSignalsPerDay?: number;
  };
};

type PassedCandidate = {
  final: InstitutionalMasterSignal;
  debug: InstitutionalCandidateDebug;
};

export function selectInstitutionalMasterSignal(
  input: SelectInstitutionalMasterSignalInput,
): InstitutionalMasterSelectionResult {
  const rawSignals = [...input.rawSignals];
  const rejectedSignals: InstitutionalRejectedSignal[] = [];
  const suppressedSignals: InstitutionalSuppressedSignal[] = [];
  const conflictSignals: InstitutionalConflictSignal[] = [];
  const candidateDebug: InstitutionalCandidateDebug[] = [];
  const warnings: string[] = [];
  const passed: PassedCandidate[] = [];

  if (input.appMode === "RESEARCH") {
    return result([], []);
  }

  for (const signal of rawSignals) {
    const strategyId = signal.strategyId ?? signal.strategyModel;
    const productionEnabled = PRODUCTION_STRATEGY_IDS.includes(strategyId as (typeof PRODUCTION_STRATEGY_IDS)[number])
      || Boolean(input.options?.allowTjrInEasyMode && strategyId === "TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE");
    if (!productionEnabled) {
      rejectedSignals.push({ signal, reasons: ["STRATEGY_NOT_PRODUCTION_ENABLED"], warnings: [], stage: "STRATEGY_FILTER" });
      continue;
    }
    if (!signal.noRepaintProof.passed || signal.noRepaintProof.maxEvidenceIndex > signal.confirmedAtIndex) {
      rejectedSignals.push({ signal, reasons: ["STOP_NOT_STRUCTURAL"], warnings: ["MISSING_NO_REPAINT_PROOF"], stage: "NO_REPAINT" });
      continue;
    }

    const confirmationCandles = input.candles
      .filter((candle) => candle.isClosed)
      .slice(0, signal.confirmedAtIndex + 1);
    const confirmationTime = signal.timestamp;
    const ltfCandles = (input.ltfCandles ?? confirmationCandles).filter((candle) => candle.isClosed && candle.timestamp <= confirmationTime);
    const itfCandles = (input.itfCandles ?? input.marketContext.itfCandles).filter((candle) => candle.isClosed && candle.timestamp <= confirmationTime);
    const htfCandles = (input.htfCandles ?? input.marketContext.htfCandles).filter((candle) => candle.isClosed && candle.timestamp <= confirmationTime);
    const atr = atrAt(input.atr, signal.confirmedAtIndex);
    const direction = signalDirection(signal);
    const session = signal.session ?? input.session ?? "DEAD_ZONE";
    const killzone = applyKillzoneGatekeeper({
      signal,
      strategyId,
      session,
      confirmationTime,
      appMode: input.appMode,
      marketContext: input.marketContext,
    });
    const structuralStop = calculateStructuralStop({
      signal,
      setupEvidence: signal,
      direction,
      atr,
      candles: confirmationCandles,
      strategyId,
      mode: input.options?.mode ?? "normal",
    });
    const structuralTarget = findStructuralTakeProfit({
      direction,
      entry: signal.entryPrice,
      stopLoss: structuralStop.stopLoss,
      ltfCandles,
      itfCandles,
      htfCandles,
      atr,
      minRR: 2.5,
    });
    const htfContext = evaluateHTFLiquidityContext({
      direction,
      entry: signal.entryPrice,
      stopLoss: structuralStop.stopLoss,
      takeProfit: structuralTarget.takeProfit,
      itfCandles,
      htfCandles,
      atr,
    });
    const confluence = evaluateInstitutionalConfluence({
      rawSignal: signal,
      candles: confirmationCandles,
      ltfCandles,
      itfCandles,
      htfCandles,
      timeframe: input.timeframe,
      atr,
      session,
      marketContext: input.marketContext,
      htfLiquidityContext: htfContext,
      mode: input.options?.mode ?? "normal",
      killzoneResult: killzone,
      structuralStop,
      structuralTarget,
    });
    const risk = evaluateProductionRisk({
      riskState: input.riskState,
      entry: signal.entryPrice,
      stopLoss: structuralStop.stopLoss,
      maxSignalsPerDay: input.options?.maxProductionSignalsPerDay,
    });
    const hardBlockers = collectHardBlockers(signal, killzone, structuralStop, structuralTarget, htfContext, confluence, risk);
    const debug: InstitutionalCandidateDebug = {
      signalId: signal.id,
      strategyId,
      killzone,
      structuralStop,
      structuralTarget,
      htfContext,
      confluence,
      risk,
      hardBlockers,
    };
    candidateDebug.push(debug);
    warnings.push(...risk.warnings, ...confluence.warnings);

    if (hardBlockers.length) {
      rejectedSignals.push({
        signal,
        reasons: [...new Set(hardBlockers)],
        warnings: [...risk.warnings, ...confluence.warnings],
        stage: rejectionStage(hardBlockers),
        confluence,
      });
      continue;
    }
    passed.push({ final: createFinalSignal(signal, debug, session), debug });
  }

  const conflictResolved = resolveConflicts(passed, conflictSignals, suppressedSignals);
  const finalSignals = applyProductionLimits(
    conflictResolved.map((candidate) => candidate.final),
    input.previousMasterSignals ?? [],
    suppressedSignals,
    input.options?.maxProductionSignalsPerDay ?? 3,
  );
  return result(finalSignals, candidateDebug);

  function result(finalSignals: InstitutionalMasterSignal[], candidates: InstitutionalCandidateDebug[]): InstitutionalMasterSelectionResult {
    const finalSignal = finalSignals.at(-1) ?? null;
    const noTradeReasons = [...new Set([
      ...rejectedSignals.flatMap((item) => item.reasons),
      ...conflictSignals.filter((item) => item.decision === "NO_TRADE").map((item) => item.reason),
    ])];
    return {
      action: finalSignal?.action ?? "NO_TRADE",
      finalSignal,
      finalSignals,
      rejectedSignals,
      suppressedSignals,
      conflictSignals,
      rawSignals,
      researchSignals: rawSignals,
      debug: {
        module: INSTITUTIONAL_MASTER_GATEKEEPER_ID,
        appMode: input.appMode,
        evaluatedCount: candidates.length,
        productionEligibleCount: finalSignals.length,
        candidates,
        noTradeReasons,
      },
      warnings: [...new Set(warnings)],
    };
  }
}

function collectHardBlockers(
  signal: TradeSignal,
  killzone: KillzoneGatekeeperResult,
  stop: StructuralStopResult,
  target: StructuralTakeProfitResult,
  htf: HTFLiquidityContextResult,
  confluence: InstitutionalConfluenceResult,
  risk: RiskManagementResult,
): InstitutionalReasonCode[] {
  const blockers: InstitutionalReasonCode[] = [];
  blockers.push(...killzone.reasons.filter((reason) => reason !== "SESSION_ALLOWED"));
  if (signal.rr < 2.5) blockers.push("RR_BELOW_2_5");
  if (!stop.valid) blockers.push(...stop.reasons.filter(isStopBlocker));
  if (target.rr < 2.5) blockers.push("RR_BELOW_2_5");
  if (target.targetSource === "NONE") blockers.push("NO_STRUCTURAL_TP_TARGET", "NO_VALID_2_5R_TARGET");
  if (target.htfConflict) blockers.push("TP_INTO_HTF_OBSTACLE");
  if (htf.suppressed) blockers.push(...htf.reasons.filter((reason) => reason !== "HTF_CONTEXT_ALIGNED"));
  if (!confluence.passed) blockers.push("FACTOR_THRESHOLD_NOT_MET", ...confluence.failureReasons);
  blockers.push(...risk.reasons);
  return blockers;
}

function createFinalSignal(
  signal: TradeSignal,
  debug: InstitutionalCandidateDebug,
  session: TradingSession,
): InstitutionalMasterSignal {
  const direction = signalDirection(signal);
  const score = institutionalScore(debug);
  const stopLoss = debug.structuralStop.stopLoss;
  const takeProfit = debug.structuralTarget.takeProfit;
  const rr = debug.structuralTarget.rr;
  return {
    ...signal,
    id: `institutional:${signal.id}`,
    institutionalSignalId: `institutional:${signal.id}`,
    action: direction === "BUY" ? "MASTER_BUY" : "MASTER_SELL",
    selectedStrategy: signal.strategyId ?? signal.strategyModel,
    strategyId: INSTITUTIONAL_MASTER_GATEKEEPER_ID,
    masterDisplayStatus: "MASTER",
    entryPrice: signal.entryPrice,
    stopLoss,
    takeProfit,
    riskPoints: Math.abs(signal.entryPrice - stopLoss),
    rewardPoints: Math.abs(takeProfit - signal.entryPrice),
    rr,
    invalidationLevel: debug.structuralStop.structuralInvalidationPrice,
    structuralStopLoss: stopLoss,
    structuralTakeProfit: takeProfit,
    stopSource: debug.structuralStop.stopSource,
    targetSource: debug.structuralTarget.targetSource,
    factorScore: debug.confluence.factorScore,
    maxFactors: 6,
    sessionThreshold: session === "LONDON" || session === "NEW_YORK"
      ? "3/6 London/NY"
      : "4/6 Asian/Overlap",
    passedFactors: debug.confluence.passedFactors,
    failedFactors: debug.confluence.failedFactors,
    killzoneStatus: debug.killzone.passed ? "PASS" : debug.killzone.reasons.join(", "),
    htfLiquidityContext: debug.htfContext.reasons.join(", "),
    riskStatus: debug.risk.status,
    institutionalScore: score,
    institutionalNoRepaintProof: {
      status: "PASS",
      selectedAtIndex: signal.confirmedAtIndex,
      maxEvidenceIndex: signal.noRepaintProof.maxEvidenceIndex,
      rawSignalId: signal.id,
      entryFrozen: signal.entryPrice,
      stopLossFrozen: stopLoss,
      takeProfitFrozen: takeProfit,
      rrFrozen: rr,
      factorScoreFrozen: debug.confluence.factorScore,
      passed: true,
    },
    productionWarnings: [...debug.confluence.warnings, ...debug.risk.warnings],
    reasons: [...signal.reasons, `Institutional ${debug.confluence.factorScore}/6 confluence`],
    warnings: [...signal.warnings, ...debug.confluence.warnings, ...debug.risk.warnings],
    immutable: true,
  };
}

function institutionalScore(debug: InstitutionalCandidateDebug): InstitutionalScore {
  const rrScore = Math.min(100, debug.structuralTarget.rr * 25);
  const score = {
    factorScore: debug.confluence.factorScore,
    rrScore,
    htfContextScore: debug.htfContext.aligned ? 100 : 0,
    sessionScore: debug.killzone.passed ? 100 : 0,
    structuralStopScore: debug.structuralStop.valid ? Math.max(60, 100 - debug.structuralStop.atrDistance * 10) : 0,
    targetQualityScore: debug.structuralTarget.targetQuality,
    total: 0,
  };
  score.total = (
    (score.factorScore / 6) * 40
    + score.rrScore * 0.15
    + score.htfContextScore * 0.15
    + score.sessionScore * 0.1
    + score.structuralStopScore * 0.1
    + score.targetQualityScore * 0.1
  );
  return score;
}

function resolveConflicts(
  candidates: PassedCandidate[],
  conflicts: InstitutionalConflictSignal[],
  suppressed: InstitutionalSuppressedSignal[],
): PassedCandidate[] {
  const removed = new Set<string>();
  for (const buy of candidates.filter((item) => item.final.action === "MASTER_BUY")) {
    for (const sell of candidates.filter((item) => item.final.action === "MASTER_SELL")) {
      if (Math.abs(buy.final.confirmedAtIndex - sell.final.confirmedAtIndex) > 3) continue;
      let winner: PassedCandidate | null = null;
      if (buy.debug.htfContext.suppressed !== sell.debug.htfContext.suppressed) {
        winner = buy.debug.htfContext.suppressed ? sell : buy;
      } else if (Math.abs(buy.final.factorScore - sell.final.factorScore) >= 1) {
        winner = buy.final.factorScore > sell.final.factorScore ? buy : sell;
      } else if (Math.abs(buy.final.institutionalScore.total - sell.final.institutionalScore.total) >= 8) {
        winner = buy.final.institutionalScore.total > sell.final.institutionalScore.total ? buy : sell;
      }
      if (!winner) {
        removed.add(buy.final.id);
        removed.add(sell.final.id);
        conflicts.push({ buySignalId: buy.final.id, sellSignalId: sell.final.id, decision: "NO_TRADE", reason: "BUY_SELL_CONFLICT_UNRESOLVED" });
      } else {
        const loser = winner === buy ? sell : buy;
        removed.add(loser.final.id);
        conflicts.push({
          buySignalId: buy.final.id,
          sellSignalId: sell.final.id,
          decision: winner === buy ? "BUY_SELECTED" : "SELL_SELECTED",
          reason: loser.debug.htfContext.suppressed ? "HTF_OBSTACLE_TOO_CLOSE" : "FACTOR_THRESHOLD_NOT_MET",
        });
        suppressed.push({ signal: loser.final, reasons: ["HTF_OBSTACLE_TOO_CLOSE"], warnings: [], stage: "CONFLICT", suppressedBy: winner.final.id });
      }
    }
  }
  return candidates.filter((candidate) => !removed.has(candidate.final.id));
}

function applyProductionLimits(
  signals: InstitutionalMasterSignal[],
  previous: InstitutionalMasterSignal[],
  suppressed: InstitutionalSuppressedSignal[],
  maxPerDay: number,
): InstitutionalMasterSignal[] {
  const selected: InstitutionalMasterSignal[] = [];
  const all = [...previous];
  for (const signal of [...signals].sort((left, right) => left.confirmedAtIndex - right.confirmedAtIndex)) {
    const day = new Date(signal.timestamp).toISOString().slice(0, 10);
    const sameDay = all.filter((item) => new Date(item.timestamp).toISOString().slice(0, 10) === day);
    const sameSession = sameDay.filter((item) => item.session === signal.session);
    const reason = sameDay.length >= maxPerDay
      ? "MAX_DAILY_SIGNALS_REACHED"
      : sameSession.length >= 1
        ? "MAX_SESSION_SIGNALS_REACHED"
        : null;
    if (reason) {
      suppressed.push({ signal, reasons: [reason], warnings: [], stage: "RISK_LIMIT", suppressedBy: null });
      continue;
    }
    selected.push(signal);
    all.push(signal);
  }
  return selected;
}

function rejectionStage(reasons: InstitutionalReasonCode[]): string {
  if (reasons.some((reason) => reason.includes("SESSION") || reason.includes("KILLZONE") || reason === "DEAD_ZONE_REJECTED")) return "KILLZONE";
  if (reasons.some((reason) => reason.includes("STOP"))) return "STRUCTURAL_STOP";
  if (reasons.some((reason) => reason.includes("HTF") || reason.includes("TARGET") || reason.includes("TP_"))) return "HTF_TARGET";
  if (reasons.some((reason) => reason.includes("RISK") || reason.includes("LOSS") || reason.includes("SIGNALS"))) return "RISK";
  return "CONFLUENCE";
}

function isStopBlocker(reason: InstitutionalReasonCode): boolean {
  return reason === "STOP_NOT_STRUCTURAL" || reason === "STOP_TOO_WIDE" || reason === "STOP_INSIDE_NOISE";
}

function atrAt(atr: number | Array<number | null>, index: number): number {
  if (typeof atr === "number") return Math.max(atr, 0.01);
  for (let cursor = Math.min(index, atr.length - 1); cursor >= 0; cursor -= 1) {
    if (typeof atr[cursor] === "number" && atr[cursor]! > 0) return atr[cursor]!;
  }
  return 0.01;
}

function signalDirection(signal: TradeSignal): "BUY" | "SELL" {
  return signal.v2Direction ?? (signal.direction === "BULLISH" ? "BUY" : "SELL");
}

