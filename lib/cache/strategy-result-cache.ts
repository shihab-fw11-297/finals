import type { EntryEngineResult, TradeSignal } from "../entry-engine/types";
import type { V2GoldmineInput } from "../v2-signal-engine/types";

export type StrategyResultCacheStats = {
  size: number;
  duplicateSignalsPrevented: number;
};

const MAX_CACHE_SIZE = 60;
const resultCache = new Map<string, EntryEngineResult>();
let duplicateSignalsPrevented = 0;

export function getCachedStrategyResult(cacheKey: string): EntryEngineResult | null {
  const cached = resultCache.get(cacheKey);

  return cached ? cloneEntryEngineResult(cached, "hit") : null;
}

export function setCachedStrategyResult(cacheKey: string, result: EntryEngineResult): EntryEngineResult {
  if (resultCache.size >= MAX_CACHE_SIZE) {
    resultCache.delete(resultCache.keys().next().value ?? "");
  }

  const deduped = dedupeStrategyResultSignals(result);
  resultCache.set(cacheKey, deduped);

  return cloneEntryEngineResult(deduped, "miss");
}

export function clearStrategyResultCache(): void {
  resultCache.clear();
  duplicateSignalsPrevented = 0;
}

export function getStrategyResultCacheStats(): StrategyResultCacheStats {
  return {
    size: resultCache.size,
    duplicateSignalsPrevented,
  };
}

export function createStrategyResultCacheKey(strategyId: string, input: V2GoldmineInput): string {
  const lastClosedCandleTime = input.candles.filter((candle) => candle.isClosed).at(-1)?.timestamp ?? 0;
  const structureAudit = input.structure.audit;
  const context = input.context;

  return [
    input.symbol.trim().toUpperCase(),
    input.timeframe,
    strategyId,
    lastClosedCandleTime,
    input.candles.length,
    input.startDate,
    input.endDate,
    stableSerialize(input.settings ?? {}),
    stableSerialize(structureAudit.markerSensitivitySettings),
    structureAudit.totalSwingHighs,
    structureAudit.totalSwingLows,
    structureAudit.totalBslZones,
    structureAudit.totalSslZones,
    structureAudit.totalFvg,
    context.htfBias.bias,
    context.htfBias.strength,
    context.itfSetup.setupState,
    context.itfSetup.direction,
    context.regime.regime,
    context.regime.confidence,
    context.session.session,
    context.session.displayTimezone,
    context.score.directionPreference,
    context.score.tradeEnvironment,
  ].join("|");
}

export function cloneEntryEngineResult(result: EntryEngineResult, cacheStatus: "hit" | "miss"): EntryEngineResult {
  return {
    ...result,
    signals: [...result.signals],
    activeSignals: [...result.activeSignals],
    signalMap: new Map(result.signalMap),
    pendingCandidates: [...result.pendingCandidates],
    candidateDebug: [...result.candidateDebug],
    rejectedSetups: [...result.rejectedSetups],
    v2AsianRanges: result.v2AsianRanges ? [...result.v2AsianRanges] : undefined,
    audit: {
      ...result.audit,
      cacheStatus,
    },
  };
}

function dedupeStrategyResultSignals(result: EntryEngineResult): EntryEngineResult {
  const signalMap = new Map<string, TradeSignal>();

  for (const signal of result.signals) {
    const signalId = createDeterministicSignalId(signal);

    if (signalMap.has(signalId)) {
      duplicateSignalsPrevented += 1;
      continue;
    }

    signalMap.set(signalId, signal);
  }

  const signals = Array.from(signalMap.values()).sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));

  return {
    ...result,
    signals,
    activeSignals: result.activeSignals.filter((signal) => signalMap.has(createDeterministicSignalId(signal))),
    signalMap: new Map(signals.map((signal) => [signal.id, signal])),
  };
}

function createDeterministicSignalId(signal: TradeSignal): string {
  const symbol = "symbol" in signal ? String((signal as { symbol?: string }).symbol ?? "UNKNOWN") : "UNKNOWN";

  return [
    signal.strategyId ?? signal.strategyModel,
    symbol,
    signal.timeframe,
    signal.direction,
    signal.timestamp,
    signal.entryPrice,
  ].join("_");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`)
    .join(",")}}`;
}
