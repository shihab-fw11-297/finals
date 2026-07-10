import type { Candle, Timeframe } from "../candles/types";
import type { SignalCandidateDebug, TradeSignal } from "../entry-engine/types";
import type { MarketContextResult, TradingSession } from "../market-context/types";

export const MASTER_SIGNAL_SELECTOR_ID = "MASTER_SIGNAL_SELECTOR" as const;

export type MasterDisplayMode = "RAW" | "MASTER" | "BOTH";
export type MasterMode = "easy" | "testing" | "normal" | "strict" | "professional";
export type MasterSuppressionReason =
  | "DUPLICATE_SAME_IDEA"
  | "LOWER_MASTER_SCORE"
  | "LOWER_STRATEGY_PRIORITY"
  | "LOWER_RR_QUALITY"
  | "WEAKER_STOP_QUALITY"
  | "SAME_ZONE_ALREADY_SELECTED"
  | "COOLDOWN_ACTIVE"
  | "MAX_SESSION_SIGNALS_REACHED"
  | "MAX_DAILY_SIGNALS_REACHED"
  | "MAX_CANDLE_SIGNALS_REACHED"
  | "INVALID_ENTRY_SL_TP"
  | "RR_TOO_LOW"
  | "STOP_TOO_WIDE"
  | "MISSING_NO_REPAINT_PROOF"
  | "FORMING_CANDLE_SIGNAL"
  | "STRATEGY_DISABLED"
  | "MARKET_TOO_CHOPPY"
  | "HIGH_NEWS_RISK"
  | "NO_TRADE_DUE_TO_CONFLICT";

export type MasterNoRepaintProof = {
  status: "PASS";
  masterSelectedAtIndex: number;
  rawSignalIdsKnownAtSelection: string[];
  selectedStrategyAtSelection: string;
  entryFrozen: number;
  stopLossFrozen: number;
  takeProfitFrozen: number;
  rrFrozen: number;
  masterScoreFrozen: number;
  maxEvidenceIndex: number;
  passed: boolean;
};

export type MasterScoreCalculation = {
  normalizedStrategyScore: number;
  strategyPriority: number;
  confluence: number;
  rrQuality: number;
  contextAlignment: number;
  sessionQuality: number;
  stopQuality: number;
  confirmationQuality: number;
  macroScore?: number | null;
  macroWeightApplied?: number;
  macroReweighted?: boolean;
  bonuses: string[];
  penalties: string[];
  total: number;
};

export type MasterFinalSignal = TradeSignal & {
  masterSignalId: string;
  action: "BUY" | "SELL";
  selectedStrategy: string;
  strategy: string;
  sourceStrategies: string[];
  confluenceCount: number;
  postEntryConfluenceCount: number;
  confluenceScore: number;
  masterScore: number;
  masterConfidence: "LOW" | "MODERATE" | "STRONG" | "PREMIUM";
  entry: number;
  confirmationIndex: number;
  reason: string;
  suppressedSignalIds: string[];
  conflictSignalIds: string[];
  selectionReason: string;
  riskQuality: number;
  executionQuality: number;
  masterNoRepaintProof: MasterNoRepaintProof;
  masterScoreCalculation: MasterScoreCalculation;
};

export type MasterSuppressedSignal = {
  signalId: string;
  strategy: string;
  direction: "BUY" | "SELL";
  entry: number;
  timestamp: number;
  suppressedBy: string | null;
  reason: MasterSuppressionReason;
  groupId: string;
};

export type MasterSignalGroup = {
  groupId: string;
  direction: "BUY" | "SELL";
  signals: TradeSignal[];
  selectedSignal: MasterFinalSignal | null;
  confluenceCount: number;
  averageEntry: number;
  priceSpread: number;
  timeSpread: number;
  groupScore: number;
  groupDecision: "SELECTED" | "SUPPRESSED" | "NO_TRADE";
  postEntryConfluenceSignalIds: string[];
};

export type MasterConflictSignal = {
  groupId: string;
  buySignals: string[];
  sellSignals: string[];
  conflictType: "OPPOSITE_SIGNAL_CONFLICT";
  decision: "BUY_SELECTED" | "SELL_SELECTED" | "NO_TRADE";
  reason: string;
};

export type MasterSelectorDebug = {
  module: typeof MASTER_SIGNAL_SELECTOR_ID;
  timeframe: Timeframe;
  mode: MasterMode;
  rawSignalCount: number;
  groupCount: number;
  finalSignalCount: number;
  suppressedCount: number;
  conflictCount: number;
  groups: Array<{ groupId: string; decision: MasterSignalGroup["groupDecision"]; selectedStrategy: string | null; score: number; signalIds: string[] }>;
  conflicts: MasterConflictSignal[];
  selectedSignals: Array<{ masterSignalId: string; strategy: string; score: number; reason: string }>;
  noTradeReasons: string[];
  cooldownDecisions: string[];
  riskLimitDecisions: string[];
  warnings: string[];
};

export type MasterSignalSelectionResult = {
  finalSignals: MasterFinalSignal[];
  suppressedSignals: MasterSuppressedSignal[];
  conflictSignals: MasterConflictSignal[];
  groupedSignals: MasterSignalGroup[];
  masterDebug: MasterSelectorDebug;
  rawSignals: TradeSignal[];
};

export type MasterSelectorOptions = {
  displayMode?: MasterDisplayMode;
  disabledStrategyIds?: string[];
  requireNoRepaintProof?: boolean;
  maxFinalSignalsPerCandle?: number;
  maxFinalSignalsPerDirectionPerSession?: number;
  maxFinalSignalsPerDay?: number;
  cooldownCandles?: number;
  maxStopAtr?: number;
  highNewsRisk?: boolean;
};

export type SelectMasterSignalsInput = {
  rawSignals: TradeSignal[];
  pendingCandidates?: SignalCandidateDebug[];
  strategyDebugRows?: SignalCandidateDebug[];
  candles: Candle[];
  timeframe: Timeframe;
  mode?: string;
  marketContext: MarketContextResult;
  session?: TradingSession;
  atr: number | Array<number | null>;
  options?: MasterSelectorOptions;
};

const STRATEGY_PRIORITY = [
  "STOCK_GURU_SWEEP_FVG_OB_ENGINE",
  "PRO_LIQUIDITY_CONFLUENCE_ENGINE",
  "ICT_IFVG_REVERSAL_ENGINE",
  "ICT_OTE_CONTINUATION_ENGINE",
  "ICT_SILVER_BULLET",
  "FVG_CONTINUATION_ENTRY",
  "ORDER_BLOCK_RETEST_CONFIRMATION",
  "LIQUIDITY_SWEEP_REVERSAL_PRO",
  "GOLDMINE_ASIAN_SWEEP_REVERSAL",
  "ASIAN_RANGE_BREAKOUT_RETEST",
  "TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE",
  "EMA_TREND_PULLBACK",
  "VWAP_EMA_REGIME_PULLBACK",
] as const;

const MODE_MIN_SCORE: Record<MasterMode, number> = { easy: 58, testing: 58, normal: 65, strict: 75, professional: 75 };
const MODE_MIN_RR: Record<MasterMode, number> = { easy: 1.2, testing: 1.2, normal: 1.5, strict: 2, professional: 2 };
const DEFAULT_COOLDOWN: Partial<Record<Timeframe, number>> = { "1m": 10, "5m": 6, "15m": 4, "30m": 3 };

export function normalizeStrategyScore(signal: TradeSignal): number {
  return clamp(Number.isFinite(signal.score) ? signal.score : 0, 0, 100);
}

export function getStrategyPriority(strategyId: string | undefined): number {
  const index = STRATEGY_PRIORITY.indexOf((strategyId ?? "") as (typeof STRATEGY_PRIORITY)[number]);
  return index < 0 ? STRATEGY_PRIORITY.length + 1 : index + 1;
}

export function getTimeGroupingWindow(timeframe: Timeframe): number {
  if (timeframe === "1m") return 5;
  if (timeframe === "15m") return 3;
  if (timeframe === "30m" || timeframe === "1h") return 2;
  return 4;
}

export function getPriceGroupingThreshold(atr: number, signalRisk: number): number {
  return Math.max(Math.max(0, atr) * 0.35, Math.max(0, signalRisk) * 0.35);
}

export function groupSimilarSignals(rawSignals: TradeSignal[], timeframe: Timeframe, atr: number | Array<number | null>): MasterSignalGroup[] {
  const groups: MasterSignalGroup[] = [];
  const sorted = [...rawSignals].sort(signalOrder);
  for (const signal of sorted) {
    const direction = signalDirection(signal);
    const currentAtr = atrAt(atr, signal.confirmedAtIndex);
    const risk = Math.abs(signal.entryPrice - signal.stopLoss);
    const match = [...groups].reverse().find((group) => {
      if (group.direction !== direction) return false;
      const anchor = group.signals[0];
      const withinTime = Math.abs(signal.confirmedAtIndex - anchor.confirmedAtIndex) <= getTimeGroupingWindow(timeframe);
      const averageRisk = (risk + Math.abs(anchor.entryPrice - anchor.stopLoss)) / 2;
      const withinPrice = Math.abs(signal.entryPrice - group.averageEntry) <= getPriceGroupingThreshold(currentAtr, averageRisk);
      return withinTime && withinPrice && compatibleTradeIdea(anchor, signal, currentAtr);
    });
    if (match) {
      match.signals.push(signal);
      refreshGroup(match);
      continue;
    }
    groups.push({
      groupId: `master-group:${direction}:${signal.confirmedAtIndex}:${round(signal.entryPrice, 3)}`,
      direction,
      signals: [signal],
      selectedSignal: null,
      confluenceCount: 1,
      averageEntry: signal.entryPrice,
      priceSpread: 0,
      timeSpread: 0,
      groupScore: 0,
      groupDecision: "SUPPRESSED",
      postEntryConfluenceSignalIds: [],
    });
  }
  return groups;
}

export function detectOppositeSignalConflicts(groups: MasterSignalGroup[], timeframe: Timeframe, atr: number | Array<number | null>): MasterConflictSignal[] {
  const conflicts: MasterConflictSignal[] = [];
  const window = getTimeGroupingWindow(timeframe);
  for (let leftIndex = 0; leftIndex < groups.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex++) {
      const left = groups[leftIndex];
      const right = groups[rightIndex];
      if (left.direction === right.direction) continue;
      const leftAnchor = left.signals[0];
      const rightAnchor = right.signals[0];
      const index = Math.max(leftAnchor.confirmedAtIndex, rightAnchor.confirmedAtIndex);
      const currentAtr = atrAt(atr, index);
      if (Math.abs(leftAnchor.confirmedAtIndex - rightAnchor.confirmedAtIndex) > window) continue;
      if (Math.abs(left.averageEntry - right.averageEntry) > currentAtr * 0.5) continue;
      const buy = left.direction === "BUY" ? left : right;
      const sell = left.direction === "SELL" ? left : right;
      conflicts.push({
        groupId: `master-conflict:${buy.groupId}:${sell.groupId}`,
        buySignals: buy.signals.map((signal) => signal.id),
        sellSignals: sell.signals.map((signal) => signal.id),
        conflictType: "OPPOSITE_SIGNAL_CONFLICT",
        decision: "NO_TRADE",
        reason: "Opposite-direction strategy conflict detected near same price/time.",
      });
    }
  }
  return conflicts;
}

export function calculateConfluenceScore(group: Pick<MasterSignalGroup, "signals">): number {
  const count = new Set(group.signals.map((signal) => signal.strategyId ?? signal.strategyModel)).size;
  if (count >= 4) return 15;
  if (count === 3) return 10;
  if (count === 2) return 5;
  return 0;
}

export function calculateRRQuality(signal: TradeSignal): number {
  if (signal.rr >= 3) return 14;
  if (signal.rr >= 2) return 15;
  if (signal.rr >= 1.5) return 11;
  if (signal.rr >= 1.2) return 6;
  return 0;
}

export function calculateStopQuality(signal: TradeSignal, atr: number): number {
  if (!Number.isFinite(atr) || atr <= 0) return 5;
  const multiple = Math.abs(signal.entryPrice - signal.stopLoss) / atr;
  const logical = signal.stopLossDetail?.source && signal.stopLossDetail.source !== "UNKNOWN";
  if (multiple <= 0.12) return 2;
  if (multiple <= 1.8) return logical ? 10 : 8;
  if (multiple <= 2.5) return 7;
  if (multiple <= 3) return 4;
  return 0;
}

export function calculateConfirmationQuality(signal: TradeSignal): number {
  const snapshot = confirmationSnapshot(signal);
  if (!snapshot) return signal.noRepaintProof.passed ? 7 : 0;
  const bodyRatio = numberValue(snapshot.bodyRatio);
  const rangeAtr = numberValue(snapshot.rangeAtrMultiple);
  const base = bodyRatio === null ? 6 : bodyRatio >= 0.6 ? 10 : bodyRatio >= 0.4 ? 8 : bodyRatio >= 0.25 ? 5 : 2;
  return clamp(base + (rangeAtr !== null && rangeAtr >= 0.8 ? 1 : 0), 0, 10);
}

export function calculateMasterScore(signal: TradeSignal, group: Pick<MasterSignalGroup, "signals">, context: MarketContextResult, atr: number): MasterScoreCalculation {
  const score = normalizeStrategyScore(signal);
  const priority = getStrategyPriority(signal.strategyId);
  const normalizedStrategyScore = score * 0.25;
  const strategyPriority = Math.max(0, 10 - (priority - 1) * 0.7);
  const confluence = calculateConfluenceScore(group);
  const rrQuality = calculateRRQuality(signal);
  const contextAlignment = contextScore(signal, context);
  const sessionQuality = sessionScore(signal.session);
  const stopQuality = calculateStopQuality(signal, atr);
  const confirmationQuality = calculateConfirmationQuality(signal);
  const bonuses: string[] = [];
  const penalties: string[] = [];
  if (confluence >= 5) bonuses.push("MULTI_STRATEGY_CONFLUENCE");
  if (contextAlignment >= 10) bonuses.push("HTF_ITF_ALIGNED");
  if (sessionQuality >= 5) bonuses.push("ACTIVE_SESSION");
  if (score >= 85) bonuses.push("A_PLUS_SOURCE_SCORE");
  if (context.regime.regime === "CHOPPY") penalties.push("CHOPPY_MARKET");
  if (context.htfBias.bias === "NEUTRAL" || context.htfBias.bias === "RANGING") penalties.push("HTF_NEUTRAL");
  const penalty = (context.regime.regime === "CHOPPY" ? 10 : 0) + ((context.htfBias.bias === "NEUTRAL" || context.htfBias.bias === "RANGING") ? 3 : 0);
  const bonus = score >= 85 ? 5 : 0;
  const total = round(clamp(normalizedStrategyScore + strategyPriority + confluence + rrQuality + contextAlignment + sessionQuality + stopQuality + confirmationQuality + bonus - penalty, 0, 100), 2);
  return { normalizedStrategyScore, strategyPriority, confluence, rrQuality, contextAlignment, sessionQuality, stopQuality, confirmationQuality, bonuses, penalties, total };
}

export function selectBestSignalFromGroup(group: MasterSignalGroup, context: MarketContextResult, atr: number | Array<number | null>): { signal: TradeSignal; score: MasterScoreCalculation } {
  const firstIndex = Math.min(...group.signals.map((signal) => signal.confirmedAtIndex));
  const knownAtSelection = group.signals.filter((signal) => signal.confirmedAtIndex === firstIndex);
  return knownAtSelection
    .map((signal) => ({ signal, score: calculateMasterScore(signal, { signals: knownAtSelection }, context, atrAt(atr, signal.confirmedAtIndex)) }))
    .sort(compareScoredSignals)[0];
}

export function suppressDuplicateSignals(group: MasterSignalGroup, selectedSignal: MasterFinalSignal): MasterSuppressedSignal[] {
  return group.signals.filter((signal) => signal.id !== selectedSignal.id).map((signal) => ({
    signalId: signal.id,
    strategy: signal.strategyId ?? signal.strategyModel,
    direction: signalDirection(signal),
    entry: signal.entryPrice,
    timestamp: signal.timestamp,
    suppressedBy: selectedSignal.masterSignalId,
    reason: signal.confirmedAtIndex > selectedSignal.confirmedAtIndex ? "DUPLICATE_SAME_IDEA" : suppressionReason(signal, selectedSignal),
    groupId: group.groupId,
  }));
}

export function resolveConflictGroup(conflict: MasterConflictSignal, groups: MasterSignalGroup[], context: MarketContextResult): MasterConflictSignal {
  const buy = groups.find((group) => conflict.buySignals.includes(group.signals[0]?.id));
  const sell = groups.find((group) => conflict.sellSignals.includes(group.signals[0]?.id));
  if (!buy?.selectedSignal || !sell?.selectedSignal) return conflict;
  const buyIndex = buy.selectedSignal.confirmedAtIndex;
  const sellIndex = sell.selectedSignal.confirmedAtIndex;
  if (buyIndex !== sellIndex) {
    const older = buyIndex < sellIndex ? buy : sell;
    return { ...conflict, decision: older.direction === "BUY" ? "BUY_SELECTED" : "SELL_SELECTED", reason: "Earlier master signal remains frozen; later opposite signal cannot repaint it." };
  }
  const scoreDifference = buy.selectedSignal.masterScore - sell.selectedSignal.masterScore;
  const confluenceDifference = buy.selectedSignal.confluenceCount - sell.selectedSignal.confluenceCount;
  const aligned = alignedDirection(context);
  if (Math.abs(scoreDifference) >= 12) {
    return { ...conflict, decision: scoreDifference > 0 ? "BUY_SELECTED" : "SELL_SELECTED", reason: "The stronger side leads by at least 12 master-score points." };
  }
  if (Math.abs(confluenceDifference) >= 2) {
    return { ...conflict, decision: confluenceDifference > 0 ? "BUY_SELECTED" : "SELL_SELECTED", reason: "The stronger side has at least two additional source strategies." };
  }
  if (aligned === "BUY" || aligned === "SELL") {
    return { ...conflict, decision: aligned === "BUY" ? "BUY_SELECTED" : "SELL_SELECTED", reason: "HTF and ITF context resolve the same-candle conflict." };
  }
  return { ...conflict, decision: "NO_TRADE", reason: "BUY and SELL master quality is too close; no trade selected." };
}

export function applyCooldownAndTradeLimits(
  finalSignals: MasterFinalSignal[],
  previousMasterSignals: MasterFinalSignal[],
  options: MasterSelectorOptions,
  timeframe: Timeframe,
  atr: number | Array<number | null>,
): { accepted: MasterFinalSignal[]; suppressed: MasterSuppressedSignal[]; decisions: string[] } {
  const accepted = [...previousMasterSignals].sort(signalOrder);
  const suppressed: MasterSuppressedSignal[] = [];
  const decisions: string[] = [];
  const cooldown = options.cooldownCandles ?? DEFAULT_COOLDOWN[timeframe] ?? 4;
  const maxPerCandle = options.maxFinalSignalsPerCandle ?? 1;
  const maxPerDirectionSession = options.maxFinalSignalsPerDirectionPerSession ?? 2;
  const maxPerDay = options.maxFinalSignalsPerDay ?? 5;
  for (const signal of [...finalSignals].sort(signalOrder)) {
    let reason: MasterSuppressionReason | null = null;
    if (accepted.filter((item) => item.confirmedAtIndex === signal.confirmedAtIndex).length >= maxPerCandle) reason = "MAX_CANDLE_SIGNALS_REACHED";
    const sessionCount = accepted.filter((item) => item.action === signal.action && item.session === signal.session && dateKey(item.timestamp) === dateKey(signal.timestamp)).length;
    if (!reason && sessionCount >= maxPerDirectionSession) reason = "MAX_SESSION_SIGNALS_REACHED";
    if (!reason && accepted.filter((item) => dateKey(item.timestamp) === dateKey(signal.timestamp)).length >= maxPerDay) reason = "MAX_DAILY_SIGNALS_REACHED";
    const previous = [...accepted].reverse().find((item) => item.action === signal.action);
    if (!reason && previous && signal.confirmedAtIndex - previous.confirmedAtIndex <= cooldown) {
      const moved = Math.abs(signal.entryPrice - previous.entryPrice);
      if (moved < atrAt(atr, signal.confirmedAtIndex) * 1.5) reason = "COOLDOWN_ACTIVE";
    }
    if (!reason) {
      accepted.push(signal);
      continue;
    }
    decisions.push(`${signal.masterSignalId}: ${reason}`);
    suppressed.push(masterSuppression(signal, reason, signal.masterSignalId));
  }
  return { accepted: accepted.slice(previousMasterSignals.length), suppressed, decisions };
}

export function buildMasterNoRepaintProof(selectedSignal: TradeSignal, group: MasterSignalGroup, masterScore: number): MasterNoRepaintProof {
  const selectedAt = selectedSignal.confirmedAtIndex;
  return {
    status: "PASS",
    masterSelectedAtIndex: selectedAt,
    rawSignalIdsKnownAtSelection: group.signals.filter((signal) => signal.confirmedAtIndex <= selectedAt).map((signal) => signal.id).sort(),
    selectedStrategyAtSelection: selectedSignal.strategyId ?? selectedSignal.strategyModel,
    entryFrozen: selectedSignal.entryPrice,
    stopLossFrozen: selectedSignal.stopLoss,
    takeProfitFrozen: selectedSignal.takeProfit,
    rrFrozen: selectedSignal.rr,
    masterScoreFrozen: masterScore,
    maxEvidenceIndex: selectedSignal.noRepaintProof.maxEvidenceIndex,
    passed: selectedSignal.noRepaintProof.passed && selectedSignal.noRepaintProof.maxEvidenceIndex <= selectedAt,
  };
}

export function selectMasterSignals(input: SelectMasterSignalsInput): MasterSignalSelectionResult {
  const mode = normalizeMode(input.mode);
  const options = input.options ?? {};
  const rawSignals = [...input.rawSignals].sort(signalOrder);
  const invalidSuppressed: MasterSuppressedSignal[] = [];
  const riskLimitDecisions: string[] = [];
  const valid = rawSignals.filter((signal) => {
    const reason = invalidReason(signal, input, mode, options);
    if (!reason) return true;
    invalidSuppressed.push(masterSuppression(signal, reason, `invalid:${signal.id}`));
    riskLimitDecisions.push(`${signal.id}: ${reason}`);
    return false;
  });
  const groups = groupSimilarSignals(valid, input.timeframe, input.atr);
  const groupSuppressed: MasterSuppressedSignal[] = [];
  for (const group of groups) {
    const best = selectBestSignalFromGroup(group, input.marketContext, input.atr);
    const firstIndexSignals = group.signals.filter((signal) => signal.confirmedAtIndex === best.signal.confirmedAtIndex);
    const firstIndexGroup = { ...group, signals: firstIndexSignals };
    const final = buildMasterSignal(best.signal, group, firstIndexGroup, best.score);
    group.selectedSignal = final;
    group.groupScore = final.masterScore;
    group.groupDecision = final.masterScore >= MODE_MIN_SCORE[mode] ? "SELECTED" : "SUPPRESSED";
    group.postEntryConfluenceSignalIds = group.signals.filter((signal) => signal.confirmedAtIndex > final.confirmedAtIndex).map((signal) => signal.id);
    if (group.groupDecision === "SUPPRESSED") {
      groupSuppressed.push(masterSuppression(final, "LOWER_MASTER_SCORE", group.groupId));
    }
    groupSuppressed.push(...suppressDuplicateSignals(group, final));
  }

  const rawConflicts = detectOppositeSignalConflicts(groups, input.timeframe, input.atr);
  const conflicts = rawConflicts.map((conflict) => resolveConflictGroup(conflict, groups, input.marketContext));
  const conflictSuppressed: MasterSuppressedSignal[] = [];
  for (const conflict of conflicts) {
    const involved = groups.filter((group) => conflict.buySignals.includes(group.signals[0]?.id) || conflict.sellSignals.includes(group.signals[0]?.id));
    const sameIndex = involved.length === 2 && involved[0].selectedSignal?.confirmedAtIndex === involved[1].selectedSignal?.confirmedAtIndex;
    if (!sameIndex) continue;
    for (const group of involved) {
      const selected = group.selectedSignal;
      if (!selected) continue;
      const loses = conflict.decision === "NO_TRADE" || (conflict.decision === "BUY_SELECTED" && group.direction === "SELL") || (conflict.decision === "SELL_SELECTED" && group.direction === "BUY");
      if (loses) {
        group.groupDecision = "NO_TRADE";
        conflictSuppressed.push(masterSuppression(selected, "NO_TRADE_DUE_TO_CONFLICT", conflict.groupId));
      } else if (selected.masterScore < 75) {
        group.groupDecision = "NO_TRADE";
        conflictSuppressed.push(masterSuppression(selected, "NO_TRADE_DUE_TO_CONFLICT", conflict.groupId));
      }
    }
  }

  const candidates = groups.flatMap((group) => group.groupDecision === "SELECTED" && group.selectedSignal ? [group.selectedSignal] : []);
  const limited = applyCooldownAndTradeLimits(candidates, [], options, input.timeframe, input.atr);
  const acceptedIds = new Set(limited.accepted.map((signal) => signal.masterSignalId));
  for (const group of groups) {
    if (group.selectedSignal && group.groupDecision === "SELECTED" && !acceptedIds.has(group.selectedSignal.masterSignalId)) group.groupDecision = "SUPPRESSED";
  }
  const suppressedSignals = dedupeSuppressed([...invalidSuppressed, ...groupSuppressed, ...conflictSuppressed, ...limited.suppressed]);
  const finalSignals = limited.accepted.map((signal) => ({
    ...signal,
    conflictSignalIds: conflicts.filter((conflict) => conflict.buySignals.includes(signal.id) || conflict.sellSignals.includes(signal.id)).flatMap((conflict) => [...conflict.buySignals, ...conflict.sellSignals]).filter((id) => id !== signal.id),
    warnings: conflicts.some((conflict) => conflict.buySignals.includes(signal.id) || conflict.sellSignals.includes(signal.id))
      ? [...signal.warnings, "Opposite-direction strategy conflict detected near same price/time."]
      : signal.warnings,
  }));
  const result: MasterSignalSelectionResult = {
    finalSignals,
    suppressedSignals,
    conflictSignals: conflicts,
    groupedSignals: groups,
    rawSignals,
    masterDebug: {
      module: MASTER_SIGNAL_SELECTOR_ID,
      timeframe: input.timeframe,
      mode,
      rawSignalCount: rawSignals.length,
      groupCount: groups.length,
      finalSignalCount: finalSignals.length,
      suppressedCount: suppressedSignals.length,
      conflictCount: conflicts.length,
      groups: groups.map((group) => ({ groupId: group.groupId, decision: group.groupDecision, selectedStrategy: group.selectedSignal?.selectedStrategy ?? null, score: group.groupScore, signalIds: group.signals.map((signal) => signal.id) })),
      conflicts,
      selectedSignals: finalSignals.map((signal) => ({ masterSignalId: signal.masterSignalId, strategy: signal.selectedStrategy, score: signal.masterScore, reason: signal.selectionReason })),
      noTradeReasons: conflicts.filter((conflict) => conflict.decision === "NO_TRADE").map((conflict) => conflict.reason),
      cooldownDecisions: limited.decisions,
      riskLimitDecisions,
      warnings: options.highNewsRisk ? ["High news risk blocked master selection."] : [],
    },
  };
  return result;
}

export function getMasterDisplaySignals(result: MasterSignalSelectionResult, mode: MasterDisplayMode): TradeSignal[] {
  if (mode === "RAW") return result.rawSignals;
  if (mode === "MASTER") return result.finalSignals;
  const selectedRawIds = new Set(result.finalSignals.map((signal) => signal.id));
  const suppressionById = new Map(result.suppressedSignals.map((item) => [item.signalId, item]));
  const secondary = result.rawSignals.filter((signal) => !selectedRawIds.has(signal.id)).map((signal) => {
    const suppression = suppressionById.get(signal.id);
    return {
      ...signal,
      masterDisplayStatus: "SUPPRESSED" as const,
      masterDisplayReason: suppression?.reason ?? "DUPLICATE_SAME_IDEA",
      masterParentId: suppression?.suppressedBy ?? null,
    };
  });
  return [...result.finalSignals, ...secondary].sort(signalOrder);
}

export function buildMasterDebug(result: MasterSignalSelectionResult): MasterSelectorDebug {
  return result.masterDebug;
}

function buildMasterSignal(selected: TradeSignal, fullGroup: MasterSignalGroup, selectionGroup: MasterSignalGroup, score: MasterScoreCalculation): MasterFinalSignal {
  const strategy = selected.strategyId ?? selected.strategyModel;
  const sourceStrategies = [...new Set(selectionGroup.signals.map((signal) => signal.strategyId ?? signal.strategyModel))];
  const postEntryConfluenceCount = new Set(fullGroup.signals.filter((signal) => signal.confirmedAtIndex > selected.confirmedAtIndex).map((signal) => signal.strategyId ?? signal.strategyModel)).size;
  const masterSignalId = `master:${selected.confirmedAtIndex}:${signalDirection(selected)}:${selected.id}`;
  const suppressedSignalIds = fullGroup.signals.filter((signal) => signal.id !== selected.id).map((signal) => signal.id);
  const selectionReason = `${sourceStrategies.length} strategy${sourceStrategies.length === 1 ? "" : "ies"} confirmed this ${signalDirection(selected)} idea. ${strategy} was selected by master score, risk quality, RR, context, and strategy priority.`;
  return {
    ...selected,
    masterDisplayStatus: "MASTER",
    masterParentId: masterSignalId,
    masterSignalId,
    action: signalDirection(selected),
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
    reason: selectionReason,
    suppressedSignalIds,
    conflictSignalIds: [],
    selectionReason,
    riskQuality: score.stopQuality,
    executionQuality: score.confirmationQuality,
    masterNoRepaintProof: buildMasterNoRepaintProof(selected, selectionGroup, score.total),
    masterScoreCalculation: score,
  };
}

function invalidReason(signal: TradeSignal, input: SelectMasterSignalsInput, mode: MasterMode, options: MasterSelectorOptions): MasterSuppressionReason | null {
  if (options.disabledStrategyIds?.includes(signal.strategyId ?? "")) return "STRATEGY_DISABLED";
  if (options.highNewsRisk) return "HIGH_NEWS_RISK";
  if (![signal.entryPrice, signal.stopLoss, signal.takeProfit].every(Number.isFinite)) return "INVALID_ENTRY_SL_TP";
  if (signalDirection(signal) === "BUY" ? signal.stopLoss >= signal.entryPrice || signal.takeProfit <= signal.entryPrice : signal.stopLoss <= signal.entryPrice || signal.takeProfit >= signal.entryPrice) return "INVALID_ENTRY_SL_TP";
  if (signal.rr < MODE_MIN_RR[mode]) return "RR_TOO_LOW";
  const candle = input.candles[signal.confirmedAtIndex];
  if (candle?.isClosed === false) return "FORMING_CANDLE_SIGNAL";
  if ((options.requireNoRepaintProof ?? true) && (!signal.noRepaintProof?.passed || signal.noRepaintProof.maxEvidenceIndex > signal.confirmedAtIndex)) return "MISSING_NO_REPAINT_PROOF";
  const stopAtr = Math.abs(signal.entryPrice - signal.stopLoss) / atrAt(input.atr, signal.confirmedAtIndex);
  const maxStopAtr = options.maxStopAtr ?? (mode === "strict" || mode === "professional" ? 2.5 : mode === "normal" ? 3 : 3.5);
  if (!Number.isFinite(stopAtr) || stopAtr > maxStopAtr) return "STOP_TOO_WIDE";
  if (input.marketContext.regime.regime === "CHOPPY" && signal.score < 75) return "MARKET_TOO_CHOPPY";
  return null;
}

function compatibleTradeIdea(left: TradeSignal, right: TradeSignal, atr: number): boolean {
  const leftModel = modelKind(left);
  const rightModel = modelKind(right);
  if (leftModel !== "UNKNOWN" && rightModel !== "UNKNOWN" && leftModel !== rightModel) {
    const invalidationGap = Math.abs(left.stopLoss - right.stopLoss);
    if (invalidationGap > atr * 0.5) return false;
  }
  if (left.session !== right.session && left.session !== "LONDON_NEW_YORK_OVERLAP" && right.session !== "LONDON_NEW_YORK_OVERLAP") return false;
  return true;
}

function modelKind(signal: TradeSignal): "CONTINUATION" | "REVERSAL" | "UNKNOWN" {
  const value = `${signal.strategyModel} ${signal.reasons.join(" ")}`.toUpperCase();
  if (value.includes("REVERSAL") || value.includes("CHOCH") || value.includes("SWEEP")) return "REVERSAL";
  if (value.includes("CONTINUATION") || value.includes("PULLBACK") || value.includes("BREAKOUT")) return "CONTINUATION";
  return "UNKNOWN";
}

function compareScoredSignals(left: { signal: TradeSignal; score: MasterScoreCalculation }, right: { signal: TradeSignal; score: MasterScoreCalculation }): number {
  return right.score.total - left.score.total
    || normalizeStrategyScore(right.signal) - normalizeStrategyScore(left.signal)
    || calculateRRQuality(right.signal) - calculateRRQuality(left.signal)
    || right.score.stopQuality - left.score.stopQuality
    || getStrategyPriority(left.signal.strategyId) - getStrategyPriority(right.signal.strategyId)
    || left.signal.confirmedAtIndex - right.signal.confirmedAtIndex
    || left.signal.id.localeCompare(right.signal.id);
}

function suppressionReason(signal: TradeSignal, selected: MasterFinalSignal): MasterSuppressionReason {
  if (normalizeStrategyScore(signal) < normalizeStrategyScore(selected)) return "LOWER_MASTER_SCORE";
  if (calculateRRQuality(signal) < calculateRRQuality(selected)) return "LOWER_RR_QUALITY";
  if (getStrategyPriority(signal.strategyId) > getStrategyPriority(selected.strategyId)) return "LOWER_STRATEGY_PRIORITY";
  return "DUPLICATE_SAME_IDEA";
}

function masterSuppression(signal: TradeSignal, reason: MasterSuppressionReason, groupId: string): MasterSuppressedSignal {
  return { signalId: signal.id, strategy: signal.strategyId ?? signal.strategyModel, direction: signalDirection(signal), entry: signal.entryPrice, timestamp: signal.timestamp, suppressedBy: null, reason, groupId };
}

function dedupeSuppressed(items: MasterSuppressedSignal[]): MasterSuppressedSignal[] {
  const byId = new Map<string, MasterSuppressedSignal>();
  for (const item of items) if (!byId.has(item.signalId)) byId.set(item.signalId, item);
  return [...byId.values()];
}

function refreshGroup(group: MasterSignalGroup): void {
  group.confluenceCount = new Set(group.signals.map((signal) => signal.strategyId ?? signal.strategyModel)).size;
  group.averageEntry = group.signals.reduce((sum, signal) => sum + signal.entryPrice, 0) / group.signals.length;
  const entries = group.signals.map((signal) => signal.entryPrice);
  const indexes = group.signals.map((signal) => signal.confirmedAtIndex);
  group.priceSpread = Math.max(...entries) - Math.min(...entries);
  group.timeSpread = Math.max(...indexes) - Math.min(...indexes);
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

function sessionScore(session: TradingSession): number {
  return session === "LONDON" || session === "NEW_YORK" || session === "LONDON_NEW_YORK_OVERLAP" ? 5 : session === "ASIAN" ? 3 : 0;
}

function confirmationSnapshot(signal: TradeSignal): Record<string, unknown> | null {
  const possible = [signal.silverBullet?.confirmation, signal.vwapEma?.confirmation, signal.emaTrendPullback?.confirmation, signal.orderBlockRetest?.confirmation, signal.liquiditySweepReversal?.confirmation, signal.fvgContinuation?.confirmation, signal.proLiquidityConfluence?.confirmation, signal.stockGuruSweepFvgOb?.confirmation, signal.ictIfvgReversal?.confirmation];
  return possible.find(Boolean) as Record<string, unknown> | null ?? null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function normalizeMode(mode?: string): MasterMode {
  const value = (mode ?? "normal").toLowerCase();
  if (value.includes("test")) return "testing";
  if (value.includes("easy") || value.includes("calibration")) return "easy";
  if (value.includes("strict")) return "strict";
  if (value.includes("pro")) return "professional";
  return "normal";
}

function masterConfidence(score: number): MasterFinalSignal["masterConfidence"] {
  if (score >= 90) return "PREMIUM";
  if (score >= 80) return "STRONG";
  if (score >= 65) return "MODERATE";
  return "LOW";
}

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
