import type { EntryEngineResult, TradeSignal } from "../entry-engine/types";
import type { IntermarketGateMode, IntermarketSnapshot } from "../market-data/types";
import {
  createStrategyResultCacheKey,
  getCachedStrategyResult,
  setCachedStrategyResult,
} from "../cache/strategy-result-cache";
import {
  calculateATR,
  evaluateIntermarketConfirmation,
  generateV2Signals,
  selectOptionalMasterSignals,
  selectInstitutionalMasterSignal,
  selectMasterSignals,
  type InstitutionalRiskState,
  type OptionalMasterSelectorOptions,
  type TradingAppMode,
} from "../v2-signal-engine";
import type { V2GoldmineInput } from "../v2-signal-engine/types";

export const CUSTOM_MULTI_STRATEGY_ID = "CUSTOM_MULTI_V2" as const;

export type StrategyRunOptions = {
  appMode?: TradingAppMode;
  riskState?: InstitutionalRiskState;
  optionalMasterSelector?: OptionalMasterSelectorOptions;
  intermarketSnapshot?: IntermarketSnapshot | null;
  intermarketGateMode?: IntermarketGateMode;
};

export function runSelectedStrategy(
  strategyId: string,
  input: V2GoldmineInput,
  options: StrategyRunOptions = {},
): EntryEngineResult {
  const appMode = options.appMode ?? "RESEARCH";
  const cacheKey = createStrategyResultCacheKey(`${strategyId}:${appMode}:${riskStateCacheKey(options.riskState)}:${optionalMasterCacheKey(options.optionalMasterSelector)}:${intermarketCacheKey(options)}`, input);
  const cachedResult = getCachedStrategyResult(cacheKey);

  if (cachedResult) {
    return cachedResult;
  }

  const result = generateV2Signals(strategyId, input);
  return setCachedStrategyResult(cacheKey, withSelections(result, input, options));
}

export function runSelectedStrategies(
  strategyIds: string[],
  input: V2GoldmineInput,
  options: StrategyRunOptions = {},
): EntryEngineResult {
  const uniqueStrategyIds = [...new Set(strategyIds)].filter((strategyId) => strategyId !== "ALL_V2" && strategyId !== CUSTOM_MULTI_STRATEGY_ID);
  const appMode = options.appMode ?? "RESEARCH";
  const cacheKey = createStrategyResultCacheKey(`${CUSTOM_MULTI_STRATEGY_ID}:${appMode}:${riskStateCacheKey(options.riskState)}:${optionalMasterCacheKey(options.optionalMasterSelector)}:${intermarketCacheKey(options)}:${uniqueStrategyIds.join(",")}`, input);
  const cachedResult = getCachedStrategyResult(cacheKey);

  if (cachedResult) {
    return cachedResult;
  }

  if (uniqueStrategyIds.length === 0) {
    return setCachedStrategyResult(cacheKey, withSelections(generateV2Signals("ALL_V2", input), input, options));
  }

  const results = uniqueStrategyIds.map((strategyId) => generateV2Signals(strategyId, input));
  const signals = results.flatMap((result) => result.signals).sort(signalOrder);
  const signalMap = new Map<string, TradeSignal>();
  for (const signal of signals) {
    signalMap.set(signal.id, signal);
  }

  const pendingCandidates = results.flatMap((result) => result.pendingCandidates);
  const candidateDebug = results.flatMap((result) => result.candidateDebug);
  const rejectedSetups = results.flatMap((result) => result.rejectedSetups);
  const closedCandles = input.candles.filter((candle) => candle.isClosed);
  const masterSelection = selectMasterSignals({
    rawSignals: signals,
    pendingCandidates,
    strategyDebugRows: candidateDebug,
    candles: closedCandles,
    timeframe: input.timeframe,
    mode: input.settings?.currentMode ?? input.settings?.mode ?? "normal",
    marketContext: input.context,
    session: input.context.session?.session,
    atr: calculateATR(closedCandles, 14),
  });

  const firstAudit = results[0].audit;
  const audit = {
    ...firstAudit,
    strategyId: CUSTOM_MULTI_STRATEGY_ID,
    totalCandlesScanned: Math.max(...results.map((result) => result.audit.totalCandlesScanned), 0),
    confirmedBuyCount: sum(results, (result) => result.audit.confirmedBuyCount),
    confirmedSellCount: sum(results, (result) => result.audit.confirmedSellCount),
    rejectedSetupCount: sum(results, (result) => result.audit.rejectedSetupCount),
    pendingConfirmationCount: sum(results, (result) => result.audit.pendingConfirmationCount),
    expiredCount: sum(results, (result) => result.audit.expiredCount),
    generationTimeMs: sum(results, (result) => result.audit.generationTimeMs),
    calculationTimeMs: sum(results, (result) => result.audit.calculationTimeMs),
    lastRejectionReason: results.find((result) => result.audit.lastRejectionReason)?.audit.lastRejectionReason ?? null,
    lastConfirmedSignal: signals.at(-1)?.id ?? null,
    topRejectionReasons: mergeTopRejectionReasons(results),
    lastFiveConfirmedSignals: signals.slice(-5).map((signal) => signal.id),
    lastCandidateDebug: candidateDebug.at(-1) ?? null,
    noSignalMessage: signals.length ? null : "No confirmed signals found for the selected custom strategy basket.",
    v2Goldmine: pickAudit(results, "v2Goldmine"),
    v2Breakout: pickAudit(results, "v2Breakout"),
    v2SilverBullet: pickAudit(results, "v2SilverBullet"),
    v2VwapEma: pickAudit(results, "v2VwapEma"),
    v2EmaTrendPullback: pickAudit(results, "v2EmaTrendPullback"),
    v2LiquiditySweepReversalPro: pickAudit(results, "v2LiquiditySweepReversalPro"),
    v2OrderBlockRetest: pickAudit(results, "v2OrderBlockRetest"),
    v2FvgContinuation: pickAudit(results, "v2FvgContinuation"),
    v2ProLiquidityConfluence: pickAudit(results, "v2ProLiquidityConfluence"),
    v2StockGuruSweepFvgOb: pickAudit(results, "v2StockGuruSweepFvgOb"),
    v2TjrSimpleStructurePullback: pickAudit(results, "v2TjrSimpleStructurePullback"),
    v2IctOteContinuation: pickAudit(results, "v2IctOteContinuation"),
    v2IctIfvgReversal: pickAudit(results, "v2IctIfvgReversal"),
  };

  return setCachedStrategyResult(cacheKey, withSelections({
    signals,
    activeSignals: signals,
    signalMap,
    pendingCandidates,
    candidateDebug,
    rejectedSetups,
    noTrade: signals.length ? null : {
      status: "NO_TRADE",
      checkedSetups: rejectedSetups.length + pendingCandidates.length,
      rejectionReasons: rejectedSetups.flatMap((setup) => setup.rejectionReasons),
      message: "No confirmed signals found for the selected custom strategy basket.",
      nearestPossibleSetup: null,
      requiredForSignal: ["A valid selected strategy setup", "Closed-candle confirmation"],
      timestamp: closedCandles.at(-1)?.timestamp ?? null,
    },
    audit,
    v2AsianRanges: results.flatMap((result) => result.v2AsianRanges ?? []),
    masterSelection,
  }, input, options));
}

function withSelections(
  result: EntryEngineResult,
  input: V2GoldmineInput,
  options: StrategyRunOptions,
): EntryEngineResult {
  return withInstitutionalSelection(withOptionalMasterSelection(withIntermarketConfirmation(result, input, options), input, options), input, options);
}

function withIntermarketConfirmation(
  result: EntryEngineResult,
  input: V2GoldmineInput,
  options: StrategyRunOptions,
): EntryEngineResult {
  const mode = options.intermarketGateMode ?? "SCORE_ONLY";
  const snapshot = options.intermarketSnapshot;

  if (!snapshot || mode === "OFF") {
    return result;
  }

  const signals = result.signals.map((signal) => {
    const intermarket = evaluateIntermarketConfirmation({
      signal,
      xauusdCandles: input.candles,
      dxyCandles: snapshot.dxy.candles,
      tnxCandles: snapshot.tnx.candles,
      fredMacro: snapshot.fred,
      timeframe: input.timeframe,
      mode,
    });

    return {
      ...signal,
      intermarket,
      warnings: intermarket.warnings.length > 0
        ? [...new Set([...signal.warnings, ...intermarket.warnings])]
        : signal.warnings,
    };
  });
  const activeSignals = mode === "BLOCK_STRONG_CONFLICT_ONLY"
    ? signals.filter((signal) => !signal.intermarket?.shouldBlock)
    : signals;

  return {
    ...result,
    signals,
    activeSignals,
    signalMap: new Map(activeSignals.map((signal) => [signal.id, signal])),
  };
}

function withOptionalMasterSelection(
  result: EntryEngineResult,
  input: V2GoldmineInput,
  options: StrategyRunOptions,
): EntryEngineResult {
  if ((options.appMode ?? "RESEARCH") !== "RESEARCH" || !options.optionalMasterSelector) return result;
  const closedCandles = input.candles.filter((candle) => candle.isClosed);
  return {
    ...result,
    optionalMasterSelection: selectOptionalMasterSignals({
      rawSignals: result.activeSignals,
      candles: closedCandles,
      timeframe: input.timeframe,
      atr: calculateATR(closedCandles, 14),
      session: input.context.session.session,
      marketContext: input.context,
      options: options.optionalMasterSelector,
    }),
  };
}

function withInstitutionalSelection(
  result: EntryEngineResult,
  input: V2GoldmineInput,
  options: StrategyRunOptions,
): EntryEngineResult {
  if ((options.appMode ?? "RESEARCH") !== "PRODUCTION") return result;
  const closedCandles = input.candles.filter((candle) => candle.isClosed);
  return {
    ...result,
    institutionalSelection: selectInstitutionalMasterSignal({
      rawSignals: result.activeSignals,
      candles: closedCandles,
      ltfCandles: closedCandles,
      itfCandles: input.context.itfCandles,
      htfCandles: input.context.htfCandles,
      timeframe: input.timeframe,
      atr: calculateATR(closedCandles, 14),
      session: input.context.session.session,
      appMode: "PRODUCTION",
      marketContext: input.context,
      riskState: options.riskState,
    }),
  };
}

function signalOrder(left: TradeSignal, right: TradeSignal): number {
  return left.confirmedAtIndex - right.confirmedAtIndex || left.timestamp - right.timestamp || left.id.localeCompare(right.id);
}

function sum(results: EntryEngineResult[], select: (result: EntryEngineResult) => number): number {
  return results.reduce((total, result) => total + select(result), 0);
}

function mergeTopRejectionReasons(results: EntryEngineResult[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const result of results) {
    for (const item of result.audit.topRejectionReasons) {
      counts.set(item.reason, (counts.get(item.reason) ?? 0) + item.count);
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);
}

function pickAudit<Key extends keyof EntryEngineResult["audit"]>(results: EntryEngineResult[], key: Key): EntryEngineResult["audit"][Key] | undefined {
  return results.find((result) => result.audit[key])?.audit[key];
}

function riskStateCacheKey(riskState: InstitutionalRiskState | undefined): string {
  if (!riskState) return "default-risk";
  return JSON.stringify(Object.entries(riskState).sort(([left], [right]) => left.localeCompare(right)));
}

function optionalMasterCacheKey(options: OptionalMasterSelectorOptions | undefined): string {
  if (!options) return "optional-master-none";
  return JSON.stringify(Object.entries(options).sort(([left], [right]) => left.localeCompare(right)));
}

function intermarketCacheKey(options: StrategyRunOptions): string {
  const mode = options.intermarketGateMode ?? "SCORE_ONLY";
  const snapshot = options.intermarketSnapshot;
  if (!snapshot || mode === "OFF") return `intermarket:${mode}:none`;
  return [
    "intermarket",
    mode,
    snapshot.updatedAt,
    snapshot.dxy.candles.at(-1)?.timestamp ?? 0,
    snapshot.tnx.candles.at(-1)?.timestamp ?? 0,
    snapshot.fred.dgs10?.latestDate ?? "no-dgs10",
    snapshot.fred.dfii10?.latestDate ?? "no-dfii10",
  ].join(":");
}
