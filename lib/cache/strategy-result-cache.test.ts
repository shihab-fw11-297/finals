import { describe, expect, it } from "vitest";

import type { EntryEngineResult, TradeSignal } from "../entry-engine/types";
import {
  clearStrategyResultCache,
  getCachedStrategyResult,
  getStrategyResultCacheStats,
  setCachedStrategyResult,
} from "./strategy-result-cache";

describe("strategy result cache", () => {
  it("prevents duplicate deterministic signals and clones cached hits", () => {
    clearStrategyResultCache();

    const firstSignal = makeSignal("internal-a");
    const duplicateSignal = makeSignal("internal-b");
    const result = makeResult([firstSignal, duplicateSignal]);

    const stored = setCachedStrategyResult("key", result);
    const cached = getCachedStrategyResult("key");

    expect(stored.signals).toHaveLength(1);
    expect(cached?.signals).toHaveLength(1);
    expect(cached?.audit.cacheStatus).toBe("hit");
    expect(cached?.signals).not.toBe(stored.signals);
    expect(cached?.signalMap).not.toBe(stored.signalMap);
    expect(getStrategyResultCacheStats().duplicateSignalsPrevented).toBe(1);
  });
});

function makeSignal(id: string): TradeSignal {
  return {
    id,
    strategyId: "EMA_TREND_PULLBACK",
    strategyModel: "EMA_TREND_PULLBACK",
    symbol: "XAUUSD",
    timeframe: "5m",
    direction: "BULLISH",
    timestamp: 60_000,
    entryPrice: 100,
  } as unknown as TradeSignal;
}

function makeResult(signals: TradeSignal[]): EntryEngineResult {
  return {
    signals,
    activeSignals: signals,
    signalMap: new Map(signals.map((signal) => [signal.id, signal])),
    pendingCandidates: [],
    candidateDebug: [],
    rejectedSetups: [],
    noTrade: null,
    audit: {
      cacheStatus: "miss",
    },
  } as unknown as EntryEngineResult;
}
