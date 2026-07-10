import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearStrategyResultCache } from "../cache/strategy-result-cache";
import type { EntryEngineResult, TradeSignal } from "../entry-engine/types";
import type { V2GoldmineInput } from "../v2-signal-engine/types";

const generateV2SignalsMock = vi.fn();
const selectMasterSignalsMock = vi.fn();
const selectOptionalMasterSignalsMock = vi.fn();
const selectInstitutionalMasterSignalMock = vi.fn();

vi.mock("../v2-signal-engine", () => ({
  calculateATR: vi.fn(() => [1, 1, 1]),
  generateV2Signals: generateV2SignalsMock,
  selectOptionalMasterSignals: selectOptionalMasterSignalsMock,
  selectInstitutionalMasterSignal: selectInstitutionalMasterSignalMock,
  selectMasterSignals: selectMasterSignalsMock,
}));

describe("runSelectedStrategies", () => {
  beforeEach(() => {
    clearStrategyResultCache();
    generateV2SignalsMock.mockReset();
    selectMasterSignalsMock.mockReset();
    selectOptionalMasterSignalsMock.mockReset();
    selectInstitutionalMasterSignalMock.mockReset();
    selectMasterSignalsMock.mockImplementation((input: { rawSignals: TradeSignal[] }) => ({
      finalSignals: [],
      suppressedSignals: [],
      conflictSignals: [],
      groupedSignals: [],
      masterDebug: {
        module: "MASTER_SIGNAL_SELECTOR",
        timeframe: "5m",
        mode: "normal",
        rawSignalCount: input.rawSignals.length,
        groupCount: 0,
        finalSignalCount: 0,
        suppressedCount: 0,
        conflictCount: 0,
        groups: [],
        conflicts: [],
        selectedSignals: [],
        noTradeReasons: [],
        cooldownDecisions: [],
        riskLimitDecisions: [],
        warnings: [],
      },
      rawSignals: input.rawSignals,
    }));
    selectOptionalMasterSignalsMock.mockImplementation((input: { rawSignals: TradeSignal[]; options: { enabled?: boolean } }) => ({
      enabled: Boolean(input.options.enabled),
      finalSignals: [],
      rawSignals: input.rawSignals,
      suppressedSignals: [],
      conflictSignals: [],
      groupedSignals: [],
      debug: { module: "OPTIONAL_MASTER_SIGNAL_SELECTOR", enabled: Boolean(input.options.enabled), message: input.options.enabled ? undefined : "Master Selector disabled. Showing raw strategy signals." },
    }));
  });

  it("runs only the selected basket strategies and merges them through the master selector", async () => {
    const { CUSTOM_MULTI_STRATEGY_ID, runSelectedStrategies } = await import("./run-selected-strategy");
    const lateSignal = makeSignal("late", "STRATEGY_A", 5);
    const earlySignal = makeSignal("early", "STRATEGY_B", 2);

    generateV2SignalsMock.mockImplementation((strategyId: string) => {
      if (strategyId === "STRATEGY_A") return makeResult(strategyId, [lateSignal], 1, 0);
      if (strategyId === "STRATEGY_B") return makeResult(strategyId, [earlySignal], 0, 1);
      throw new Error(`Unexpected strategy ${strategyId}`);
    });

    const result = runSelectedStrategies(["STRATEGY_A", "STRATEGY_B", "STRATEGY_A", "ALL_V2", CUSTOM_MULTI_STRATEGY_ID], makeInput());

    expect(generateV2SignalsMock).toHaveBeenCalledTimes(2);
    expect(generateV2SignalsMock.mock.calls.map((call) => call[0])).toEqual(["STRATEGY_A", "STRATEGY_B"]);
    expect(result.audit.strategyId).toBe(CUSTOM_MULTI_STRATEGY_ID);
    expect(result.signals.map((signal) => signal.id)).toEqual(["early", "late"]);
    expect(result.audit.confirmedBuyCount).toBe(1);
    expect(result.audit.confirmedSellCount).toBe(1);
    expect(result.masterSelection?.rawSignals.map((signal) => signal.id)).toEqual(["early", "late"]);
    expect(selectMasterSignalsMock).toHaveBeenCalledWith(expect.objectContaining({
      rawSignals: [earlySignal, lateSignal],
      timeframe: "5m",
    }));
  });

  it("attaches optional master selection in Research mode when requested", async () => {
    const { runSelectedStrategy } = await import("./run-selected-strategy");
    const raw = makeSignal("research-candidate", "STOCK_GURU_SWEEP_FVG_OB_ENGINE", 2);
    generateV2SignalsMock.mockReturnValue(makeResult("STOCK_GURU_SWEEP_FVG_OB_ENGINE", [raw], 1, 0));

    const result = runSelectedStrategy("STOCK_GURU_SWEEP_FVG_OB_ENGINE", makeInput(), {
      appMode: "RESEARCH",
      optionalMasterSelector: { enabled: true, displayMode: "MASTER_SELECTED" },
    });

    expect(result.optionalMasterSelection?.rawSignals).toEqual([raw]);
    expect(selectOptionalMasterSignalsMock).toHaveBeenCalledWith(expect.objectContaining({
      rawSignals: [raw],
      options: expect.objectContaining({ enabled: true, displayMode: "MASTER_SELECTED" }),
    }));
  });

  it("adds the institutional gate only in Production mode while preserving raw signals", async () => {
    const { runSelectedStrategy } = await import("./run-selected-strategy");
    const raw = makeSignal("production-candidate", "STOCK_GURU_SWEEP_FVG_OB_ENGINE", 2);
    const generated = makeResult("STOCK_GURU_SWEEP_FVG_OB_ENGINE", [raw], 1, 0);
    const institutionalSelection = {
      action: "NO_TRADE",
      finalSignal: null,
      finalSignals: [],
      rejectedSignals: [],
      suppressedSignals: [],
      conflictSignals: [],
      rawSignals: [raw],
      researchSignals: [raw],
      debug: { module: "INSTITUTIONAL_MASTER_GATEKEEPER", appMode: "PRODUCTION", evaluatedCount: 1, productionEligibleCount: 0, candidates: [], noTradeReasons: ["RR_BELOW_2_5"] },
      warnings: [],
    };
    generateV2SignalsMock.mockReturnValue(generated);
    selectInstitutionalMasterSignalMock.mockReturnValue(institutionalSelection);

    const result = runSelectedStrategy("STOCK_GURU_SWEEP_FVG_OB_ENGINE", makeInput(), { appMode: "PRODUCTION" });

    expect(result.signals).toEqual([raw]);
    expect(result.institutionalSelection).toBe(institutionalSelection);
    expect(selectInstitutionalMasterSignalMock).toHaveBeenCalledWith(expect.objectContaining({
      rawSignals: [raw],
      appMode: "PRODUCTION",
    }));
  });
});

function makeSignal(id: string, strategyId: string, confirmedAtIndex: number): TradeSignal {
  return {
    id,
    strategyId,
    strategyModel: strategyId,
    type: "CONFIRMED_BUY",
    direction: "BUY",
    timestamp: confirmedAtIndex * 60_000,
    confirmedAtIndex,
    timeframe: "5m",
    entryPrice: 2000 + confirmedAtIndex,
    stopLoss: 1990 + confirmedAtIndex,
    takeProfit: 2020 + confirmedAtIndex,
    takeProfit2: null,
    takeProfit3: null,
    rr: 2,
    score: 80,
    immutable: true,
    invalidationLevel: 1990 + confirmedAtIndex,
    noRepaintProof: {
      status: "PASS",
      signalIndex: confirmedAtIndex,
      latestAllowedCandleIndex: confirmedAtIndex,
      usedMarkerIndexes: [confirmedAtIndex],
      usedContextCloseTimes: [],
      usedSetupId: id,
      passed: true,
      lastAvailableIndex: confirmedAtIndex,
      maxEvidenceIndex: confirmedAtIndex,
      message: "closed candle",
    },
  } as unknown as TradeSignal;
}

function makeResult(strategyId: string, signals: TradeSignal[], buys: number, sells: number): EntryEngineResult {
  return {
    signals,
    activeSignals: signals,
    signalMap: new Map(signals.map((signal) => [signal.id, signal])),
    pendingCandidates: [],
    candidateDebug: [],
    rejectedSetups: [],
    noTrade: null,
    audit: {
      activeMode: "NORMAL_SCALP",
      strategyId,
      minimumScoreRequired: 0,
      minimumSetupScoreRequired: 0,
      minimumSignalScoreRequired: 0,
      minimumRrRequired: 1.5,
      totalCandlesScanned: 100,
      totalMarkersGenerated: 0,
      totalContextsGenerated: 0,
      totalPhase4Setups: 0,
      watchCount: 0,
      setupCount: 0,
      invalidatedCount: 0,
      expiredCount: 0,
      totalSetupsScanned: 0,
      triggerSetupsFound: 0,
      pendingConfirmationCount: 0,
      expiredConfirmationCount: 0,
      invalidatedCandidateCount: 0,
      confirmedBuyCount: buys,
      confirmedSellCount: sells,
      rapidBuyCount: 0,
      rapidSellCount: 0,
      rapidSignalCount: 0,
      rejectedSetupCount: 0,
      lastRejectionReason: null,
      lastConfirmedSignal: signals.at(-1)?.id ?? null,
      topRejectionReasons: [],
      lastFiveTriggerSetups: [],
      lastFiveConfirmedSignals: signals.map((signal) => signal.id),
      noSignalMessage: null,
      noRepaintWarnings: [],
      rrCalculation: null,
      stopLossSource: null,
      takeProfitSource: null,
      scoreBreakdown: null,
      lastCandidateDebug: null,
      noRepaintValidation: "PASS",
      calculationTimeMs: 1,
      generationTimeMs: 1,
      cacheStatus: "miss",
    },
  };
}

function makeInput(): V2GoldmineInput {
  return {
    candles: [
      { timestamp: 0, time: "1970-01-01T00:00:00.000Z", open: 1, high: 2, low: 0.5, close: 1.5, volume: 1, isClosed: true },
      { timestamp: 60_000, time: "1970-01-01T00:01:00.000Z", open: 1.5, high: 2.2, low: 1.2, close: 2, volume: 1, isClosed: true },
      { timestamp: 120_000, time: "1970-01-01T00:02:00.000Z", open: 2, high: 2.5, low: 1.8, close: 2.3, volume: 1, isClosed: true },
    ],
    symbol: "XAUUSD",
    timeframe: "5m",
    startDate: "2026-01-01T00:00",
    endDate: "2026-01-01T01:00",
    settings: { maxRiskAmount: 100 },
    structure: {
      markers: [],
      liquidityZones: [],
      fvgZones: [],
      audit: {
        markerSensitivitySettings: {},
        totalSwingHighs: 0,
        totalSwingLows: 0,
        totalBslZones: 0,
        totalSslZones: 0,
        totalFvg: 0,
      },
    },
    context: {
      htfBias: { bias: "NEUTRAL", strength: 0 },
      itfSetup: { setupState: "WAIT", direction: "NONE" },
      regime: { regime: "RANGING", confidence: 0 },
      session: { session: "LONDON", displayTimezone: "UTC" },
      score: { directionPreference: "NEUTRAL", tradeEnvironment: "MIXED" },
    },
  } as unknown as V2GoldmineInput;
}
