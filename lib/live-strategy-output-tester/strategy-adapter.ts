import type { Candle } from "@/lib/candles/types";
import type {
  EntryEngineResult,
  RejectedSetup,
} from "@/lib/entry-engine/types";
import { calculateSharedIndicators } from "@/lib/indicators/indicator-engine";
import { calculateMarketContext } from "@/lib/market-context/engine";
import { calculateMarketStructure, getDefaultMarketStructureSettings } from "@/lib/market-structure/engine";
import type { MarketMarker, MomentumMarker } from "@/lib/market-structure/types";
import { runSelectedStrategy } from "@/lib/strategy-runner/run-selected-strategy";
import { calculateAsianRanges, selectMasterSignals, type MasterSignalSelectionResult } from "@/lib/v2-signal-engine";
import { calculateSessionVWAP } from "@/lib/v2-signal-engine/indicators";
import type { V2GoldmineInput } from "@/lib/v2-signal-engine/types";

import {
  type LiveStrategyError,
  type LiveStrategyRejectionReason,
  type LiveStrategySharedContext,
  type LiveStrategyStatus,
  type LiveStrategySummary,
  type LiveStrategyTestResult,
  type LiveStrategyTimeframe,
  type MacdPoint,
  type SerializableEntryEngineResult,
  type SharedOrderBlockContext,
  type V2StrategyAdapterOutput,
  type V2StrategyId,
  V2_STRATEGIES,
} from "./types";

type LoggerEvent =
  | "FETCH_STARTED"
  | "FETCH_SUCCESS"
  | "FETCH_FAILED"
  | "NORMALIZATION_SUCCESS"
  | "STRATEGY_TEST_STARTED"
  | "STRATEGY_TEST_SUCCESS"
  | "STRATEGY_TEST_BROKEN"
  | "STRATEGY_TEST_ERROR"
  | "FIX_APPLIED";

export type LiveStrategyLogger = {
  lines: string[];
  log: (event: LoggerEvent, message: string) => void;
};

export function isV2StrategyId(value: string): value is V2StrategyId {
  return V2_STRATEGIES.includes(value as V2StrategyId);
}

export function createLiveStrategyLogger(): LiveStrategyLogger {
  const enabled =
    process.env.LIVE_STRATEGY_TEST_LOG === "true" ||
    process.env.LIVE_STRATEGY_TEST_LOG === "1";
  const lines: string[] = [];

  return {
    lines,
    log(event, message) {
      const line = `[${event}] ${message}`;
      lines.push(line);

      if (enabled) {
        console.log(line);
      }
    },
  };
}

export function buildSharedLiveStrategyContext(input: {
  candles: Candle[];
  symbol: string;
  timeframe: LiveStrategyTimeframe;
}): LiveStrategySharedContext {
  const candles = input.candles.filter((candle) => candle.isClosed);
  const startDate = candles[0]?.time ?? new Date().toISOString();
  const endDate = candles.at(-1)?.time ?? startDate;
  const structureSettings = getDefaultMarketStructureSettings();
  const structure = calculateMarketStructure({
    candles,
    symbol: input.symbol,
    timeframe: input.timeframe,
    startDate,
    endDate,
    settings: structureSettings,
  });
  const context = calculateMarketContext({
    candles,
    symbol: input.symbol,
    timeframe: input.timeframe,
    startDate,
    endDate,
    marketStructureSettings: structureSettings,
    displayTimezone: "America/New_York",
  });
  const indicators = calculateSharedIndicators(candles);
  const atrForAsianRange = indicators.atr.map((value) => value ?? 0);

  return {
    candles,
    atr: indicators.atr,
    ema20: indicators.ema20,
    ema50: indicators.ema50,
    ema200: indicators.ema200,
    rsi: calculateRsi(candles),
    macd: calculateMacd(candles),
    vwap: calculateSessionVWAP(candles, "00:00", "America/New_York"),
    swingHighs: structure.markers.filter((marker) => marker.type === "SWING_HIGH"),
    swingLows: structure.markers.filter((marker) => marker.type === "SWING_LOW"),
    liquidityLevels: structure.liquidityZones,
    sessionInfo: context.session,
    asianRange: calculateAsianRanges(candles, atrForAsianRange, input.timeframe),
    fvgList: structure.fvgZones,
    orderBlocks: deriveOrderBlockContext(structure.markers),
    structure,
    context,
  };
}

export function runV2StrategyAdapter(input: {
  strategyId: V2StrategyId;
  candles: Candle[];
  sharedContext: LiveStrategySharedContext;
  symbol: string;
  timeframe: LiveStrategyTimeframe;
}): V2StrategyAdapterOutput {
  const candles = input.candles.filter((candle) => candle.isClosed);
  const startDate = candles[0]?.time ?? new Date().toISOString();
  const endDate = candles.at(-1)?.time ?? startDate;

  try {
    const engineInput: V2GoldmineInput = {
      candles,
      symbol: input.symbol,
      timeframe: input.timeframe,
      startDate,
      endDate,
      structure: input.sharedContext.structure,
      context: input.sharedContext.context,
      settings: {
        maxRiskAmount: 100,
      },
    };
    const scanResult = runSelectedStrategy(input.strategyId, engineInput);

    if (!isEntryEngineResult(scanResult)) {
      return emptyAdapterOutput(input, {
        message: "Strategy returned an invalid or empty output shape.",
        source: "ADAPTER_OUTPUT_VALIDATION",
      });
    }

    const confirmedSignals = scanResult.signals;
    const rejectedSetups = scanResult.rejectedSetups;
    const pendingSetups = scanResult.pendingCandidates;
    const expiredSetups = findExpiredSetups(rejectedSetups);
    const rejectionReasons = normalizeRejectionReasons(scanResult, rejectedSetups);
    const warnings = uniqueStrings([
      ...scanResult.audit.noRepaintWarnings,
      ...scanResult.signals.flatMap((signal) => signal.warnings),
      ...input.sharedContext.context.score.warnings,
    ]);

    return {
      strategyId: input.strategyId,
      candlesScanned: readCandlesScanned(scanResult, candles.length),
      pendingSetups,
      confirmedSignals,
      rejectedSetups,
      expiredSetups,
      rejectionReasons,
      warnings,
      debug: {
        scanResult: serializeEntryEngineResult(scanResult),
        candidateDebug: scanResult.candidateDebug,
        audit: scanResult.audit,
        sharedContext: summarizeSharedContext(input.sharedContext),
      },
      error: null,
    };
  } catch (error) {
    return emptyAdapterOutput(input, normalizeError(error, "RUNTIME_EXCEPTION"));
  }
}

export function selectLiveMasterSignals(input: {
  outputs: V2StrategyAdapterOutput[];
  candles: Candle[];
  sharedContext: LiveStrategySharedContext;
  timeframe: LiveStrategyTimeframe;
  mode?: string;
}): MasterSignalSelectionResult {
  return selectMasterSignals({
    rawSignals: input.outputs.flatMap((output) => output.confirmedSignals),
    pendingCandidates: input.outputs.flatMap((output) => output.pendingSetups),
    strategyDebugRows: input.outputs.flatMap((output) => output.debug.candidateDebug),
    candles: input.candles.filter((candle) => candle.isClosed),
    timeframe: input.timeframe,
    mode: input.mode ?? "normal",
    marketContext: input.sharedContext.context,
    session: input.sharedContext.sessionInfo.session,
    atr: input.sharedContext.atr,
  });
}

export async function testStrategyLiveOutput(input: {
  strategyId: V2StrategyId;
  symbol: string;
  timeframe: LiveStrategyTimeframe;
  candles: Candle[];
  sharedContext: LiveStrategySharedContext;
  candlesReceived: number;
  logger?: LiveStrategyLogger;
}): Promise<LiveStrategyTestResult> {
  input.logger?.log("STRATEGY_TEST_STARTED", `${input.strategyId}: candles=${input.candles.length}`);

  const closedCandles = input.candles.filter((candle) => candle.isClosed);
  const lastClosedCandle = closedCandles.at(-1) ?? null;
  const notes: string[] = [];

  if (closedCandles.length === 0) {
    const error = {
      message: "No closed candles were available for strategy testing.",
      source: "CLOSED_CANDLE_FILTER",
    };

    input.logger?.log("STRATEGY_TEST_BROKEN", `${input.strategyId}: ${error.message}`);
    return buildTestResult({
      strategyId: input.strategyId,
      status: "BROKEN",
      candlesReceived: input.candlesReceived,
      closedCandles,
      adapterOutput: emptyAdapterOutput(input, error),
      notes: ["No open candle was passed to the strategy runner."],
    });
  }

  const adapterOutput = runV2StrategyAdapter({
    strategyId: input.strategyId,
    symbol: input.symbol,
    timeframe: input.timeframe,
    candles: closedCandles,
    sharedContext: input.sharedContext,
  });
  const status = classifyAdapterOutput(adapterOutput);

  if (adapterOutput.error) {
    notes.push(adapterOutput.error.message);
  } else if (status === "WORKING_NO_SIGNAL") {
    notes.push("Strategy ran successfully; current live candles did not match a setup.");
  } else if (status === "REJECTED_ONLY") {
    notes.push("Strategy ran successfully and rejected setups with recorded reasons.");
  } else {
    notes.push("Strategy ran successfully with standardized output.");
  }

  const logEvent =
    status === "ERROR"
      ? "STRATEGY_TEST_ERROR"
      : status === "BROKEN"
        ? "STRATEGY_TEST_BROKEN"
        : "STRATEGY_TEST_SUCCESS";
  input.logger?.log(
    logEvent,
    `${input.strategyId}: ${status}, candles=${closedCandles.length}, rejected=${adapterOutput.rejectedSetups.length}`,
  );

  return buildTestResult({
    strategyId: input.strategyId,
    status,
    candlesReceived: input.candlesReceived,
    closedCandles,
    adapterOutput,
    notes,
    lastClosedCandle,
  });
}

export function summarizeLiveStrategyResults(
  results: LiveStrategyTestResult[],
): LiveStrategySummary {
  return {
    totalStrategies: results.length,
    working: results.filter((result) => result.status === "WORKING").length,
    workingNoSignal: results.filter((result) => result.status === "WORKING_NO_SIGNAL").length,
    pendingFound: results.filter((result) => result.status === "PENDING_SETUP_FOUND").length,
    confirmedFound: results.filter((result) => result.status === "CONFIRMED_SIGNAL_FOUND").length,
    rejectedOnly: results.filter((result) => result.status === "REJECTED_ONLY").length,
    broken: results.filter((result) => result.status === "BROKEN").length,
    errors: results.filter((result) => result.status === "ERROR").length,
    fixed: results.filter((result) => result.fixed).length,
    stillFailing: results.filter((result) => result.status === "BROKEN" || result.status === "ERROR").length,
  };
}

function classifyAdapterOutput(output: V2StrategyAdapterOutput): LiveStrategyStatus {
  if (output.error) {
    return output.error.source === "RUNTIME_EXCEPTION" ? "ERROR" : "BROKEN";
  }

  if (!output.debug.scanResult || output.candlesScanned <= 0) {
    return "BROKEN";
  }

  if (output.confirmedSignals.length > 0) {
    return "CONFIRMED_SIGNAL_FOUND";
  }

  if (output.pendingSetups.length > 0) {
    return "PENDING_SETUP_FOUND";
  }

  if (output.rejectedSetups.length > 0) {
    return "REJECTED_ONLY";
  }

  return "WORKING_NO_SIGNAL";
}

function buildTestResult(input: {
  strategyId: V2StrategyId;
  status: LiveStrategyStatus;
  candlesReceived: number;
  closedCandles: Candle[];
  adapterOutput: V2StrategyAdapterOutput;
  notes: string[];
  lastClosedCandle?: Candle | null;
}): LiveStrategyTestResult {
  const latestCandle = input.lastClosedCandle ?? input.closedCandles.at(-1) ?? null;

  return {
    strategyId: input.strategyId,
    status: input.status,
    candlesReceived: input.candlesReceived,
    closedCandlesUsed: input.closedCandles.length,
    lastClosedCandleTime: latestCandle?.timestamp ?? null,
    outputExists: input.adapterOutput.debug.scanResult !== null,
    pendingCount: input.adapterOutput.pendingSetups.length,
    confirmedCount: input.adapterOutput.confirmedSignals.length,
    rejectedCount: input.adapterOutput.rejectedSetups.length,
    expiredCount: input.adapterOutput.expiredSetups.length,
    latestPendingSetup: input.adapterOutput.pendingSetups.at(-1) ?? null,
    latestConfirmedSignal: input.adapterOutput.confirmedSignals.at(-1) ?? null,
    latestRejectedSetup: input.adapterOutput.rejectedSetups.at(-1) ?? null,
    rejectionReasons: input.adapterOutput.rejectionReasons,
    warnings: input.adapterOutput.warnings,
    error: input.adapterOutput.error,
    fixed: false,
    notes: input.notes,
    details: {
      strategyId: input.strategyId,
      candleCount: input.candlesReceived,
      closedCandleCount: input.closedCandles.length,
      latestCandle,
      scanResult: input.adapterOutput.debug.scanResult,
      pendingSetups: input.adapterOutput.pendingSetups,
      confirmedSignals: input.adapterOutput.confirmedSignals,
      rejectedSetups: input.adapterOutput.rejectedSetups,
      rejectionReasons: input.adapterOutput.rejectionReasons,
      warnings: input.adapterOutput.warnings,
      error: input.adapterOutput.error,
    },
  };
}

function emptyAdapterOutput(
  input: { strategyId: V2StrategyId; sharedContext: LiveStrategySharedContext },
  error: LiveStrategyError,
): V2StrategyAdapterOutput {
  return {
    strategyId: input.strategyId,
    candlesScanned: 0,
    pendingSetups: [],
    confirmedSignals: [],
    rejectedSetups: [],
    expiredSetups: [],
    rejectionReasons: [],
    warnings: [],
    debug: {
      scanResult: null,
      candidateDebug: [],
      audit: null,
      sharedContext: summarizeSharedContext(input.sharedContext),
    },
    error,
  };
}

function isEntryEngineResult(value: unknown): value is EntryEngineResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.signals) &&
    Array.isArray(value.activeSignals) &&
    Array.isArray(value.pendingCandidates) &&
    Array.isArray(value.candidateDebug) &&
    Array.isArray(value.rejectedSetups) &&
    isRecord(value.audit)
  );
}

function serializeEntryEngineResult(
  result: EntryEngineResult,
): SerializableEntryEngineResult {
  const { signalMap, ...serializableResult } = result;

  return {
    ...serializableResult,
    signalMapKeys: Array.from(signalMap.keys()),
  };
}

function readCandlesScanned(result: EntryEngineResult, fallback: number): number {
  const candidates = [
    result.audit.totalCandlesScanned,
    result.audit.v2Goldmine?.totalCandlesScanned,
    result.audit.v2Breakout?.totalCandlesScanned,
    result.audit.v2SilverBullet?.candlesScanned,
    result.audit.v2VwapEma?.candlesScanned,
    result.audit.v2EmaTrendPullback?.candlesScanned,
    result.audit.v2OrderBlockRetest?.candlesScanned,
    result.audit.v2FvgContinuation?.candlesScanned,
    result.audit.v2ProLiquidityConfluence?.candlesScanned,
    result.audit.v2IctOteContinuation?.candlesScanned,
    result.audit.v2IctIfvgReversal?.candlesScanned,
    result.audit.v2LiquiditySweepReversalPro?.candlesScanned,
  ];

  return candidates.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0) ?? fallback;
}

function normalizeRejectionReasons(
  result: EntryEngineResult,
  rejectedSetups: RejectedSetup[],
): LiveStrategyRejectionReason[] {
  if (result.audit.topRejectionReasons.length > 0) {
    return result.audit.topRejectionReasons.map((item) => ({
      reason: String(item.reason),
      count: item.count,
    }));
  }

  const counts = new Map<string, number>();

  for (const setup of rejectedSetups) {
    const reasons = setup.rejectionReasonCodes.length > 0
      ? setup.rejectionReasonCodes
      : setup.rejectionReasons;

    for (const reason of reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

function findExpiredSetups(rejectedSetups: RejectedSetup[]): RejectedSetup[] {
  return rejectedSetups.filter((setup) => {
    if (setup.setupState === "EXPIRED") {
      return true;
    }

    return [...setup.rejectionReasonCodes, ...setup.rejectionReasons].some((reason) =>
      reason.toUpperCase().includes("EXPIRED"),
    );
  });
}

function summarizeSharedContext(context: LiveStrategySharedContext) {
  return {
    atrPoints: context.atr.filter((value) => value !== null).length,
    ema20Points: context.ema20.filter((value) => value !== null).length,
    ema50Points: context.ema50.filter((value) => value !== null).length,
    ema200Points: context.ema200.filter((value) => value !== null).length,
    swingHighs: context.swingHighs.length,
    swingLows: context.swingLows.length,
    liquidityLevels: context.liquidityLevels.length,
    fvgList: context.fvgList.length,
    orderBlocks: context.orderBlocks.length,
    asianRanges: context.asianRange.length,
    session: context.sessionInfo.session,
  };
}

function deriveOrderBlockContext(markers: MarketMarker[]): SharedOrderBlockContext[] {
  return markers
    .filter(isDisplacementMarker)
    .slice(-40)
    .map((marker) => ({
      direction: marker.direction,
      createdAt: marker.timestamp,
      confirmedAtIndex: marker.confirmedAtIndex,
      sourceMarkerId: marker.id,
    }));
}

function isDisplacementMarker(marker: MarketMarker): marker is MomentumMarker {
  return marker.type === "DISPLACEMENT";
}

function calculateRsi(candles: Candle[], period = 14): Array<number | null> {
  const output: Array<number | null> = Array(candles.length).fill(null);

  if (candles.length <= period) {
    return output;
  }

  let gainSum = 0;
  let lossSum = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    gainSum += Math.max(change, 0);
    lossSum += Math.max(-change, 0);
  }

  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;
  output[period] = toRsi(averageGain, averageLoss);

  for (let index = period + 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    output[index] = toRsi(averageGain, averageLoss);
  }

  return output;
}

function calculateMacd(candles: Candle[]): MacdPoint[] {
  const closes = candles.map((candle) => candle.close);
  const fast = calculateNumberEma(closes, 12);
  const slow = calculateNumberEma(closes, 26);
  const macdLine = closes.map((_, index) => {
    const fastValue = fast[index];
    const slowValue = slow[index];
    return fastValue !== null && slowValue !== null ? fastValue - slowValue : null;
  });
  const signalLine = calculateNumberEma(macdLine, 9);

  return macdLine.map((macd, index) => {
    const signal = signalLine[index];
    return {
      macd,
      signal,
      histogram: macd !== null && signal !== null ? macd - signal : null,
    };
  });
}

function calculateNumberEma(
  values: Array<number | null>,
  period: number,
): Array<number | null> {
  const output: Array<number | null> = Array(values.length).fill(null);
  const seedValues = values.filter((value): value is number => value !== null).slice(0, period);

  if (seedValues.length < period) {
    return output;
  }

  const seedEndIndex = values.findIndex((_, index) =>
    values.slice(0, index + 1).filter((value) => value !== null).length === period,
  );

  if (seedEndIndex < 0) {
    return output;
  }

  const seed = seedValues.reduce((sum, value) => sum + value, 0) / period;
  const multiplier = 2 / (period + 1);
  output[seedEndIndex] = seed;

  for (let index = seedEndIndex + 1; index < values.length; index += 1) {
    const value = values[index];
    const previous = output[index - 1];

    output[index] = value !== null && previous !== null
      ? value * multiplier + previous * (1 - multiplier)
      : previous;
  }

  return output;
}

function toRsi(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0) {
    return 100;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function normalizeError(error: unknown, source: string): LiveStrategyError {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      source,
    };
  }

  return {
    message: "Unknown strategy test error.",
    source,
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
