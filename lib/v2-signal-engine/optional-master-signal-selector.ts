import type { Candle, Timeframe } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { MarketContextResult, TradingSession } from "../market-context/types";
import {
  detectOppositeSignalConflicts,
  getPriceGroupingThreshold,
  groupSimilarSignals,
  type MasterConflictSignal,
  type MasterFinalSignal,
  type MasterNoRepaintProof,
  type MasterScoreCalculation,
  type MasterSignalGroup,
} from "./master-signal-selector";

export const OPTIONAL_MASTER_SIGNAL_SELECTOR_ID = "OPTIONAL_MASTER_SIGNAL_SELECTOR" as const;

export type SignalDisplayMode = "RAW_SIGNALS" | "MASTER_SELECTED" | "BOTH";

export type OptionalMasterSuppressionReason =
  | "DUPLICATE_SAME_IDEA"
  | "LOWER_MASTER_SCORE"
  | "LOWER_CONFIDENCE"
  | "LOWER_RR_QUALITY"
  | "WEAKER_STOP_QUALITY"
  | "LOWER_STRATEGY_PRIORITY"
  | "SAME_ZONE_ALREADY_SELECTED"
  | "COOLDOWN_ACTIVE"
  | "INVALID_ENTRY_SL_TP"
  | "NO_TRADE_DUE_TO_CONFLICT";

export type OptionalMasterNoRepaintProof = MasterNoRepaintProof & {
  selectedRawSignalId: string;
  stopLossFrozen: number;
  takeProfitFrozen: number;
  selectedStrategyFrozen: string;
};

export type MasterSelectedSignal = MasterFinalSignal & {
  optionalMasterSignalId: string;
  masterAction: "MASTER_BUY" | "MASTER_SELL";
  selectedRawSignalId: string;
  directionLabel: "BUY" | "SELL";
  masterNoRepaintProof: OptionalMasterNoRepaintProof;
  optionalNoRepaintProof: OptionalMasterNoRepaintProof;
};

export type SuppressedSignal = {
  signalId: string;
  strategy: string;
  direction: "BUY" | "SELL";
  entry: number;
  timestamp: number;
  suppressedBy: string | null;
  groupId: string;
  reason: OptionalMasterSuppressionReason;
};

export type ConflictSignal = Omit<MasterConflictSignal, "groupId"> & {
  conflictId: string;
  selectedSignalId: string | null;
};

export type SignalGroup = Omit<MasterSignalGroup, "selectedSignal" | "groupDecision"> & {
  selectedSignal: MasterSelectedSignal | null;
  groupReason: string;
  groupDecision: "SELECTED" | "SUPPRESSED" | "NO_TRADE";
};

export type MasterSelectorDebug = {
  module: typeof OPTIONAL_MASTER_SIGNAL_SELECTOR_ID;
  enabled: boolean;
  displayMode?: SignalDisplayMode;
  message?: string;
  rawSignalCount?: number;
  groupCount?: number;
  finalSignalCount?: number;
  suppressedCount?: number;
  conflictCount?: number;
  groups?: Array<{ groupId: string; direction: "BUY" | "SELL"; selectedStrategy: string | null; signalIds: string[]; reason: string }>;
  selectedSignals?: Array<{ masterSignalId: string; strategy: string; score: number; reason: string }>;
  suppressedSignals?: SuppressedSignal[];
  conflictSignals?: ConflictSignal[];
  noTradeReasons?: string[];
  warnings?: string[];
};

export type OptionalMasterSelectionResult = {
  enabled: boolean;
  finalSignals: MasterSelectedSignal[];
  rawSignals: TradeSignal[];
  suppressedSignals: SuppressedSignal[];
  conflictSignals: ConflictSignal[];
  groupedSignals: SignalGroup[];
  debug: MasterSelectorDebug;
};

export type OptionalMasterSelectorOptions = {
  enabled?: boolean;
  displayMode?: SignalDisplayMode;
  cooldownEnabled?: boolean;
  cooldownCandles?: number;
  showSuppressedSignals?: boolean;
  showConflictWarnings?: boolean;
  strategyPriority?: string[];
};

export type SelectOptionalMasterSignalsInput = {
  rawSignals: TradeSignal[];
  candles: Candle[];
  timeframe: Timeframe;
  atr: number | Array<number | null>;
  session?: TradingSession;
  marketContext: MarketContextResult;
  options?: OptionalMasterSelectorOptions;
};

const DEFAULT_STRATEGY_PRIORITY = [
  "STOCK_GURU_SWEEP_FVG_OB_ENGINE",
  "PRO_LIQUIDITY_CONFLUENCE_ENGINE",
  "ICT_SILVER_BULLET",
  "ICT_IFVG_REVERSAL_ENGINE",
  "ICT_OTE_RETRACEMENT_ENGINE",
  "ICT_OTE_CONTINUATION_ENGINE",
  "FVG_CONTINUATION_ENTRY",
  "ORDER_BLOCK_RETEST_CONFIRMATION",
  "LIQUIDITY_SWEEP_REVERSAL_PRO",
  "GOLDMINE_ASIAN_SWEEP_REVERSAL",
  "ASIAN_RANGE_BREAKOUT_RETEST",
  "TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE",
  "EMA_TREND_PULLBACK",
  "VWAP_EMA_REGIME_PULLBACK",
] as const;

const DEFAULT_COOLDOWN: Partial<Record<Timeframe, number>> = { "1m": 15, "5m": 8, "15m": 4, "30m": 3 };

export function selectOptionalMasterSignals(input: SelectOptionalMasterSignalsInput): OptionalMasterSelectionResult {
  const options = input.options ?? {};
  const displayMode = options.displayMode ?? "RAW_SIGNALS";
  const rawSignals = [...input.rawSignals].sort(signalOrder);

  if (!options.enabled) {
    return {
      enabled: false,
      finalSignals: [],
      rawSignals,
      suppressedSignals: [],
      conflictSignals: [],
      groupedSignals: [],
      debug: {
        module: OPTIONAL_MASTER_SIGNAL_SELECTOR_ID,
        enabled: false,
        message: "Master Selector disabled. Showing raw strategy signals.",
      },
    };
  }

  const warnings: string[] = [];
  const invalidSuppressed: SuppressedSignal[] = [];
  const validSignals = rawSignals.filter((signal) => {
    if (isValidTradeSignal(signal, input.candles)) return true;
    invalidSuppressed.push(suppressedFromSignal(signal, "INVALID_ENTRY_SL_TP", `invalid:${signal.id}`, null));
    return false;
  });

  const groups = groupSimilarSignals(validSignals, input.timeframe, input.atr).map((group) => toOptionalGroup(group));
  const suppressedSignals: SuppressedSignal[] = [...invalidSuppressed];
  const priority = options.strategyPriority ?? [...DEFAULT_STRATEGY_PRIORITY];

  for (const group of groups) {
    const best = selectBestOptionalSignal(group, input.marketContext, input.atr, priority, warnings);
    if (!best) continue;
    const firstIndexSignals = group.signals.filter((signal) => signal.confirmedAtIndex === best.signal.confirmedAtIndex);
    const selectionGroup = { ...group, signals: firstIndexSignals };
    const final = buildOptionalMasterSignal(best.signal, group, selectionGroup, best.score);
    group.selectedSignal = final;
    group.groupScore = final.masterScore;
    group.groupDecision = "SELECTED";
    group.groupReason = `${final.sourceStrategies.length} source strategy${final.sourceStrategies.length === 1 ? "" : "ies"} grouped within ${group.timeSpread} candle${group.timeSpread === 1 ? "" : "s"} and ${round(group.priceSpread, 3)} price spread.`;
    group.postEntryConfluenceSignalIds = group.signals.filter((signal) => signal.confirmedAtIndex > final.confirmedAtIndex).map((signal) => signal.id);
    suppressedSignals.push(...suppressGroupDuplicates(group, final, input.atr, priority));
  }

  const conflictSignals = detectOppositeSignalConflicts(groups, input.timeframe, input.atr).map((conflict) => resolveOptionalConflict(conflict, groups, input.marketContext, input.atr));
  for (const conflict of conflictSignals) {
    const involved = groups.filter((group) => conflict.buySignals.includes(group.signals[0]?.id) || conflict.sellSignals.includes(group.signals[0]?.id));
    for (const group of involved) {
      const selected = group.selectedSignal;
      if (!selected) continue;
      const loses = conflict.decision === "NO_TRADE"
        || (conflict.decision === "BUY_SELECTED" && group.direction === "SELL")
        || (conflict.decision === "SELL_SELECTED" && group.direction === "BUY");
      if (loses) {
        group.groupDecision = "NO_TRADE";
        selected.conflictSignalIds = involved.flatMap((item) => item.selectedSignal ? [item.selectedSignal.id] : []).filter((id) => id !== selected.id);
        suppressedSignals.push(suppressedFromSignal(selected, "NO_TRADE_DUE_TO_CONFLICT", conflict.conflictId, selected.masterSignalId));
      } else {
        selected.conflictSignalIds = involved.flatMap((item) => item.selectedSignal ? [item.selectedSignal.id] : []).filter((id) => id !== selected.id);
        if (options.showConflictWarnings ?? true) selected.warnings = [...selected.warnings, conflict.reason];
      }
    }
  }

  const cooldownSuppressed = applyOptionalCooldown(groups, input.timeframe, input.atr, options);
  suppressedSignals.push(...cooldownSuppressed);
  const suppressedIds = new Set(cooldownSuppressed.map((item) => item.signalId));
  const finalSignals = groups
    .filter((group) => group.groupDecision === "SELECTED" && group.selectedSignal && !suppressedIds.has(group.selectedSignal.id))
    .map((group) => group.selectedSignal as MasterSelectedSignal)
    .sort(signalOrder);

  const resultSuppressed = dedupeSuppressed(suppressedSignals);
  return {
    enabled: true,
    finalSignals,
    rawSignals,
    suppressedSignals: resultSuppressed,
    conflictSignals,
    groupedSignals: groups,
    debug: {
      module: OPTIONAL_MASTER_SIGNAL_SELECTOR_ID,
      enabled: true,
      displayMode,
      rawSignalCount: rawSignals.length,
      groupCount: groups.length,
      finalSignalCount: finalSignals.length,
      suppressedCount: resultSuppressed.length,
      conflictCount: conflictSignals.length,
      groups: groups.map((group) => ({
        groupId: group.groupId,
        direction: group.direction,
        selectedStrategy: group.selectedSignal?.selectedStrategy ?? null,
        signalIds: group.signals.map((signal) => signal.id),
        reason: group.groupReason,
      })),
      selectedSignals: finalSignals.map((signal) => ({
        masterSignalId: signal.masterSignalId,
        strategy: signal.selectedStrategy,
        score: signal.masterScore,
        reason: signal.selectionReason,
      })),
      suppressedSignals: resultSuppressed,
      conflictSignals,
      noTradeReasons: conflictSignals.filter((conflict) => conflict.decision === "NO_TRADE").map((conflict) => conflict.reason),
      warnings,
    },
  };
}

export function getOptionalMasterDisplaySignals(
  result: OptionalMasterSelectionResult,
  mode: SignalDisplayMode,
  options: Pick<OptionalMasterSelectorOptions, "showSuppressedSignals"> = {},
): TradeSignal[] {
  if (!result.enabled || mode === "RAW_SIGNALS") return result.rawSignals;
  if (mode === "MASTER_SELECTED") return result.finalSignals;
  const selectedRawIds = new Set(result.finalSignals.map((signal) => signal.selectedRawSignalId));
  const suppressionById = new Map(result.suppressedSignals.map((item) => [item.signalId, item]));
  const secondary = result.rawSignals
    .filter((signal) => !selectedRawIds.has(signal.id))
    .filter((signal) => (options.showSuppressedSignals ?? true) || !suppressionById.has(signal.id))
    .map((signal) => {
      const suppression = suppressionById.get(signal.id);
      return suppression
        ? {
            ...signal,
            masterDisplayStatus: "SUPPRESSED" as const,
            masterDisplayReason: suppression.reason,
            masterParentId: suppression.suppressedBy,
          }
        : signal;
    });
  return [...result.finalSignals, ...secondary].sort(signalOrder);
}

function selectBestOptionalSignal(
  group: SignalGroup,
  context: MarketContextResult,
  atr: number | Array<number | null>,
  priority: string[],
  warnings: string[],
): { signal: TradeSignal; score: MasterScoreCalculation } | null {
  const firstIndex = Math.min(...group.signals.map((signal) => signal.confirmedAtIndex));
  const knownAtSelection = group.signals.filter((signal) => signal.confirmedAtIndex === firstIndex);
  return knownAtSelection
    .map((signal) => ({ signal, score: calculateOptionalMasterScore(signal, knownAtSelection, context, atrAt(atr, signal.confirmedAtIndex), priority, warnings) }))
    .sort((left, right) => compareScoredSignals(left, right, atrAt(atr, left.signal.confirmedAtIndex), priority))[0] ?? null;
}

function calculateOptionalMasterScore(
  signal: TradeSignal,
  sourceSignals: TradeSignal[],
  context: MarketContextResult,
  atr: number,
  priority: string[],
  warnings: string[],
): MasterScoreCalculation {
  const normalized = normalizeOptionalStrategyScore(signal, warnings);
  const confidence = confidenceScore(signal.confidence);
  const rrQuality = rrQualityScore(signal);
  const stopQuality = stopQualityScore(signal, atr);
  const strategyPriority = strategyPriorityScore(signal.strategyId ?? signal.strategyModel, priority);
  const sessionQuality = sessionQualityScore(signal.session);
  const contextAlignment = contextScore(signal, context);
  const confluence = Math.min(10, new Set(sourceSignals.map((item) => item.strategyId ?? item.strategyModel)).size * 2.5);
  const confirmationQuality = confidence / 10;
  const macroScore = usableMacroScore(signal);
  const macroMissing = macroScore === null;
  if (macroMissing) {
    warnings.push(`${signal.id}: MACRO_DATA_MISSING_SCORE_REWEIGHTED`);
  }
  const total = round(clamp(
    macroMissing
      ? normalized * 0.40
        + confidence * 0.25
        + rrQuality * 0.15
        + stopQuality * 0.10
        + strategyPriority * 0.10
      : normalized * 0.30
        + confidence * 0.15
        + rrQuality * 0.15
        + stopQuality * 0.10
        + strategyPriority * 0.10
        + macroScore * 0.20,
    0,
    100,
  ), 2);
  const bonuses = [
    ...(confluence >= 5 ? ["MULTI_STRATEGY_CONFLUENCE"] : []),
    ...(contextAlignment >= 8 ? ["HTF_ITF_ALIGNED"] : []),
    ...(sessionQuality >= 8 ? ["QUALITY_SESSION"] : []),
  ];
  return {
    normalizedStrategyScore: normalized,
    strategyPriority,
    confluence,
    rrQuality,
    contextAlignment,
    sessionQuality,
    stopQuality,
    confirmationQuality,
    macroScore,
    macroWeightApplied: macroMissing ? 0 : 0.2,
    macroReweighted: macroMissing,
    bonuses,
    penalties: [],
    total,
  };
}

function buildOptionalMasterSignal(
  selected: TradeSignal,
  fullGroup: SignalGroup,
  selectionGroup: SignalGroup,
  score: MasterScoreCalculation,
): MasterSelectedSignal {
  const direction = signalDirection(selected);
  const strategy = selected.strategyId ?? selected.strategyModel;
  const sourceStrategies = [...new Set(selectionGroup.signals.map((signal) => signal.strategyId ?? signal.strategyModel))];
  const postEntryConfluenceCount = new Set(fullGroup.signals.filter((signal) => signal.confirmedAtIndex > selected.confirmedAtIndex).map((signal) => signal.strategyId ?? signal.strategyModel)).size;
  const masterSignalId = `optional-master:${selected.confirmedAtIndex}:${direction}:${selected.id}`;
  const suppressedSignalIds = fullGroup.signals.filter((signal) => signal.id !== selected.id).map((signal) => signal.id);
  const reason = `Selected because ${strategy} had the strongest optional master score from normalized score, confidence, RR, stop quality, and strategy priority.`;
  const noRepaintProof = buildOptionalNoRepaintProof(selected, selectionGroup, score.total);
  return {
    ...selected,
    id: masterSignalId,
    strategyId: OPTIONAL_MASTER_SIGNAL_SELECTOR_ID,
    masterDisplayStatus: "MASTER",
    masterParentId: masterSignalId,
    masterSignalId,
    optionalMasterSignalId: masterSignalId,
    action: direction,
    masterAction: direction === "BUY" ? "MASTER_BUY" : "MASTER_SELL",
    selectedRawSignalId: selected.id,
    selectedStrategy: strategy,
    strategy,
    sourceStrategies,
    confluenceCount: sourceStrategies.length,
    postEntryConfluenceCount,
    confluenceScore: score.confluence,
    masterScore: score.total,
    masterConfidence: masterConfidence(score.total),
    entry: selected.entryPrice,
    confirmationIndex: selected.confirmedAtIndex,
    directionLabel: direction,
    reason,
    suppressedSignalIds,
    conflictSignalIds: [],
    selectionReason: reason,
    riskQuality: score.stopQuality,
    executionQuality: score.confirmationQuality,
    masterNoRepaintProof: noRepaintProof,
    optionalNoRepaintProof: noRepaintProof,
    masterScoreCalculation: score,
  };
}

function buildOptionalNoRepaintProof(selectedSignal: TradeSignal, group: SignalGroup, masterScore: number): OptionalMasterNoRepaintProof {
  const selectedAt = selectedSignal.confirmedAtIndex;
  const selectedStrategy = selectedSignal.strategyId ?? selectedSignal.strategyModel;
  return {
    status: "PASS",
    masterSelectedAtIndex: selectedAt,
    selectedRawSignalId: selectedSignal.id,
    rawSignalIdsKnownAtSelection: group.signals.filter((signal) => signal.confirmedAtIndex <= selectedAt).map((signal) => signal.id).sort(),
    selectedStrategyAtSelection: selectedStrategy,
    selectedStrategyFrozen: selectedStrategy,
    entryFrozen: selectedSignal.entryPrice,
    stopLossFrozen: selectedSignal.stopLoss,
    takeProfitFrozen: selectedSignal.takeProfit,
    rrFrozen: selectedSignal.rr,
    masterScoreFrozen: masterScore,
    maxEvidenceIndex: selectedSignal.noRepaintProof.maxEvidenceIndex,
    passed: selectedSignal.noRepaintProof.passed && selectedSignal.noRepaintProof.maxEvidenceIndex <= selectedAt,
  };
}

function resolveOptionalConflict(
  conflict: MasterConflictSignal,
  groups: SignalGroup[],
  context: MarketContextResult,
  atr: number | Array<number | null>,
): ConflictSignal {
  const buy = groups.find((group) => conflict.buySignals.includes(group.signals[0]?.id));
  const sell = groups.find((group) => conflict.sellSignals.includes(group.signals[0]?.id));
  if (!buy?.selectedSignal || !sell?.selectedSignal) return { ...conflict, conflictId: conflict.groupId, selectedSignalId: null };
  if (buy.selectedSignal.confirmedAtIndex !== sell.selectedSignal.confirmedAtIndex) {
    const older = buy.selectedSignal.confirmedAtIndex < sell.selectedSignal.confirmedAtIndex ? buy : sell;
    const selected = older.selectedSignal;
    if (!selected) return { ...conflict, conflictId: conflict.groupId, selectedSignalId: null };
    return {
      ...conflict,
      conflictId: conflict.groupId,
      decision: older.direction === "BUY" ? "BUY_SELECTED" : "SELL_SELECTED",
      selectedSignalId: selected.masterSignalId,
      reason: "Earlier master signal remains frozen; later opposite signal cannot repaint it.",
    };
  }
  const scoreDifference = buy.selectedSignal.masterScore - sell.selectedSignal.masterScore;
  if (Math.abs(scoreDifference) >= 12) {
    const selected = scoreDifference > 0 ? buy.selectedSignal : sell.selectedSignal;
    return {
      ...conflict,
      conflictId: conflict.groupId,
      decision: scoreDifference > 0 ? "BUY_SELECTED" : "SELL_SELECTED",
      selectedSignalId: selected.masterSignalId,
      reason: "The stronger side leads by at least 12 optional master-score points.",
    };
  }
  const buyQuality = buy.selectedSignal.masterScoreCalculation.rrQuality + buy.selectedSignal.masterScoreCalculation.stopQuality;
  const sellQuality = sell.selectedSignal.masterScoreCalculation.rrQuality + sell.selectedSignal.masterScoreCalculation.stopQuality;
  const qualityDifference = buyQuality - sellQuality;
  if (Math.abs(qualityDifference) >= 20) {
    const selected = qualityDifference > 0 ? buy.selectedSignal : sell.selectedSignal;
    return {
      ...conflict,
      conflictId: conflict.groupId,
      decision: qualityDifference > 0 ? "BUY_SELECTED" : "SELL_SELECTED",
      selectedSignalId: selected.masterSignalId,
      reason: "The stronger side has much better RR and stop quality.",
    };
  }
  const aligned = alignedDirection(context);
  if (aligned === "BUY" || aligned === "SELL") {
    const selected = aligned === "BUY" ? buy.selectedSignal : sell.selectedSignal;
    return {
      ...conflict,
      conflictId: conflict.groupId,
      decision: aligned === "BUY" ? "BUY_SELECTED" : "SELL_SELECTED",
      selectedSignalId: selected.masterSignalId,
      reason: "HTF and ITF context resolve the conflict.",
    };
  }
  return {
    ...conflict,
    conflictId: conflict.groupId,
    decision: "NO_TRADE",
    selectedSignalId: null,
    reason: `BUY and SELL signals conflicted within ${getTimeGroupingWindowFromGroups(buy, sell)} candles and ${round(atrAt(atr, Math.max(buy.selectedSignal.confirmedAtIndex, sell.selectedSignal.confirmedAtIndex)) * 0.5, 3)} price; master scores were too close.`,
  };
}

function applyOptionalCooldown(
  groups: SignalGroup[],
  timeframe: Timeframe,
  atr: number | Array<number | null>,
  options: OptionalMasterSelectorOptions,
): SuppressedSignal[] {
  if (!options.cooldownEnabled) return [];
  const cooldown = options.cooldownCandles ?? DEFAULT_COOLDOWN[timeframe] ?? 4;
  const accepted: MasterSelectedSignal[] = [];
  const suppressed: SuppressedSignal[] = [];
  for (const group of [...groups].sort((left, right) => signalOrder(left.selectedSignal ?? left.signals[0], right.selectedSignal ?? right.signals[0]))) {
    const signal = group.selectedSignal;
    if (!signal || group.groupDecision !== "SELECTED") continue;
    const previous = [...accepted].reverse().find((item) => item.action === signal.action);
    if (previous && signal.confirmedAtIndex - previous.confirmedAtIndex <= cooldown) {
      const moved = Math.abs(signal.entryPrice - previous.entryPrice);
      const averageRisk = (Math.abs(signal.entryPrice - signal.stopLoss) + Math.abs(previous.entryPrice - previous.stopLoss)) / 2;
      if (moved <= getPriceGroupingThreshold(atrAt(atr, signal.confirmedAtIndex), averageRisk)) {
        group.groupDecision = "SUPPRESSED";
        suppressed.push(suppressedFromSignal(signal, "COOLDOWN_ACTIVE", group.groupId, previous.masterSignalId));
        continue;
      }
    }
    accepted.push(signal);
  }
  return suppressed;
}

function suppressGroupDuplicates(
  group: SignalGroup,
  selectedSignal: MasterSelectedSignal,
  atr: number | Array<number | null>,
  priority: string[],
): SuppressedSignal[] {
  return group.signals
    .filter((signal) => signal.id !== selectedSignal.selectedRawSignalId)
    .map((signal) => suppressedFromSignal(signal, suppressionReason(signal, selectedSignal, atrAt(atr, signal.confirmedAtIndex), priority), group.groupId, selectedSignal.masterSignalId));
}

function suppressionReason(signal: TradeSignal, selected: MasterSelectedSignal, atr: number, priority: string[]): OptionalMasterSuppressionReason {
  if (normalizeScoreOnly(signal) < normalizeScoreOnly(selected)) return "LOWER_MASTER_SCORE";
  if (confidenceScore(signal.confidence) < confidenceScore(selected.confidence)) return "LOWER_CONFIDENCE";
  if (rrQualityScore(signal) < rrQualityScore(selected)) return "LOWER_RR_QUALITY";
  if (stopQualityScore(signal, atr) < selected.riskQuality) return "WEAKER_STOP_QUALITY";
  if (strategyPriorityRank(signal.strategyId ?? signal.strategyModel, priority) > strategyPriorityRank(selected.selectedStrategy, priority)) return "LOWER_STRATEGY_PRIORITY";
  return signal.confirmedAtIndex > selected.confirmedAtIndex ? "SAME_ZONE_ALREADY_SELECTED" : "DUPLICATE_SAME_IDEA";
}

function isValidTradeSignal(signal: TradeSignal, candles: Candle[]): boolean {
  if (![signal.entryPrice, signal.stopLoss, signal.takeProfit, signal.rr].every(Number.isFinite)) return false;
  const direction = signalDirection(signal);
  const levelsValid = direction === "BUY"
    ? signal.entryPrice > signal.stopLoss && signal.takeProfit > signal.entryPrice
    : signal.entryPrice < signal.stopLoss && signal.takeProfit < signal.entryPrice;
  if (!levelsValid || signal.rr <= 0) return false;
  const candle = candles[signal.confirmedAtIndex];
  if (candle?.isClosed === false) return false;
  return signal.noRepaintProof.passed && signal.noRepaintProof.maxEvidenceIndex <= signal.confirmedAtIndex;
}

function toOptionalGroup(group: MasterSignalGroup): SignalGroup {
  return {
    ...group,
    selectedSignal: null,
    groupDecision: "SUPPRESSED",
    groupReason: "Signals share direction, confirmation window, price proximity, and compatible strategy evidence.",
  };
}

function suppressedFromSignal(signal: TradeSignal, reason: OptionalMasterSuppressionReason, groupId: string, suppressedBy: string | null): SuppressedSignal {
  return {
    signalId: signal.id,
    strategy: signal.strategyId ?? signal.strategyModel,
    direction: signalDirection(signal),
    entry: signal.entryPrice,
    timestamp: signal.timestamp,
    suppressedBy,
    groupId,
    reason,
  };
}

function normalizeOptionalStrategyScore(signal: TradeSignal, warnings: string[]): number {
  if (!Number.isFinite(signal.score)) {
    warnings.push(`${signal.id}: missing strategy score; fallback 50 used.`);
    return confidenceCombinedScore(50, signal.confidence);
  }
  return confidenceCombinedScore(normalizeScoreOnly(signal), signal.confidence);
}

function usableMacroScore(signal: TradeSignal): number | null {
  const intermarket = signal.intermarket;
  if (!intermarket || intermarket.macroGrade === "UNKNOWN") return null;
  return clamp(intermarket.macroScore, 0, 100);
}

function normalizeScoreOnly(signal: Pick<TradeSignal, "score">): number {
  if (!Number.isFinite(signal.score)) return 50;
  if (signal.score >= 0 && signal.score <= 8) return clamp(signal.score / 8 * 100, 0, 100);
  return clamp(signal.score, 0, 100);
}

function confidenceCombinedScore(score: number, confidence: TradeSignal["confidence"]): number {
  return round(score * 0.8 + confidenceScore(confidence) * 0.2, 2);
}

function confidenceScore(confidence: TradeSignal["confidence"]): number {
  if (confidence === "PREMIUM") return 100;
  if (confidence === "STRONG") return 80;
  if (confidence === "MODERATE") return 60;
  return 35;
}

function rrQualityScore(signal: Pick<TradeSignal, "rr">): number {
  if (signal.rr >= 3) return 100;
  if (signal.rr >= 2) return 85;
  if (signal.rr >= 1.5) return 70;
  if (signal.rr >= 1.2) return 50;
  return 20;
}

function stopQualityScore(signal: Pick<TradeSignal, "entryPrice" | "stopLoss" | "stopLossDetail">, atr: number): number {
  if (!Number.isFinite(atr) || atr <= 0) return 50;
  const multiple = Math.abs(signal.entryPrice - signal.stopLoss) / atr;
  const logical = signal.stopLossDetail?.source && signal.stopLossDetail.source !== "UNKNOWN";
  if (multiple <= 0.12) return 45;
  if (multiple <= 1.2) return logical ? 100 : 90;
  if (multiple <= 1.8) return logical ? 88 : 78;
  if (multiple <= 2.5) return 65;
  if (multiple <= 3) return 45;
  return 20;
}

function strategyPriorityScore(strategyId: string, priority: string[]): number {
  const rank = strategyPriorityRank(strategyId, priority);
  if (rank < 0) return 40;
  const denominator = Math.max(1, priority.length - 1);
  return round(clamp(100 - (rank / denominator) * 70, 30, 100), 2);
}

function strategyPriorityRank(strategyId: string, priority: string[]): number {
  const exact = priority.indexOf(strategyId);
  if (exact >= 0) return exact;
  if (strategyId === "ICT_OTE_CONTINUATION_ENGINE") return priority.indexOf("ICT_OTE_RETRACEMENT_ENGINE");
  return -1;
}

function sessionQualityScore(session: TradingSession): number {
  if (session === "LONDON_NEW_YORK_OVERLAP") return 100;
  if (session === "LONDON" || session === "NEW_YORK") return 85;
  if (session === "ASIAN") return 55;
  return 25;
}

function contextScore(signal: TradeSignal, context: MarketContextResult): number {
  const desired = signalDirection(signal) === "BUY" ? "BULLISH" : "BEARISH";
  const htf = context.htfBias.bias;
  const itf = context.itfSetup.direction;
  if (htf === desired && itf === desired) return 10;
  if (htf === desired || itf === desired) return 7;
  if (htf === "NEUTRAL" || htf === "RANGING" || htf === "UNKNOWN") return 4;
  return 0;
}

function alignedDirection(context: MarketContextResult): "BUY" | "SELL" | "NONE" {
  if (context.htfBias.bias === "BULLISH" && context.itfSetup.direction === "BULLISH") return "BUY";
  if (context.htfBias.bias === "BEARISH" && context.itfSetup.direction === "BEARISH") return "SELL";
  return "NONE";
}

function compareScoredSignals(
  left: { signal: TradeSignal; score: MasterScoreCalculation },
  right: { signal: TradeSignal; score: MasterScoreCalculation },
  atr: number,
  priority: string[],
): number {
  return right.score.total - left.score.total
    || normalizeScoreOnly(right.signal) - normalizeScoreOnly(left.signal)
    || confidenceScore(right.signal.confidence) - confidenceScore(left.signal.confidence)
    || right.signal.rr - left.signal.rr
    || stopQualityScore(right.signal, atr) - stopQualityScore(left.signal, atr)
    || strategyPriorityRank(left.signal.strategyId ?? left.signal.strategyModel, priority) - strategyPriorityRank(right.signal.strategyId ?? right.signal.strategyModel, priority)
    || left.signal.confirmedAtIndex - right.signal.confirmedAtIndex
    || left.signal.id.localeCompare(right.signal.id);
}

function getTimeGroupingWindowFromGroups(left: SignalGroup, right: SignalGroup): number {
  return Math.abs(left.signals[0].confirmedAtIndex - right.signals[0].confirmedAtIndex);
}

function dedupeSuppressed(items: SuppressedSignal[]): SuppressedSignal[] {
  const byId = new Map<string, SuppressedSignal>();
  for (const item of items) {
    const current = byId.get(item.signalId);
    if (!current || current.reason === "DUPLICATE_SAME_IDEA") byId.set(item.signalId, item);
  }
  return [...byId.values()];
}

function atrAt(atr: number | Array<number | null>, index: number): number {
  const value = Array.isArray(atr) ? atr[index] ?? [...atr.slice(0, index + 1)].reverse().find((item): item is number => typeof item === "number" && item > 0) : atr;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function signalDirection(signal: TradeSignal): "BUY" | "SELL" {
  return signal.v2Direction ?? (signal.direction === "BULLISH" ? "BUY" : "SELL");
}

function signalOrder(left: Pick<TradeSignal, "confirmedAtIndex" | "timestamp" | "id">, right: Pick<TradeSignal, "confirmedAtIndex" | "timestamp" | "id">): number {
  return left.confirmedAtIndex - right.confirmedAtIndex || left.timestamp - right.timestamp || left.id.localeCompare(right.id);
}

function masterConfidence(score: number): MasterFinalSignal["masterConfidence"] {
  if (score >= 90) return "PREMIUM";
  if (score >= 80) return "STRONG";
  if (score >= 65) return "MODERATE";
  return "LOW";
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
