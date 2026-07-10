import type { Candle } from "../candles/types";
import type {
  EntryEngineResult,
  NoRepaintProof,
  RejectedSetup,
  SignalCandidateDebug,
  SignalRejectionCode,
  SignalScoreBreakdown,
  StopLossResult,
  TakeProfitResult,
  TradeSignal,
  V2AsianRangeSnapshot,
  V2AsianRangeWarningCode,
  V2ConfirmationSnapshot,
  V2GoldmineScoreBreakdown,
  V2SweepSnapshot,
} from "../entry-engine/types";
import type { TradingSession } from "../market-context/types";
import type { LiquidityZone, MarketMarker } from "../market-structure/types";
import {
  ACTIVE_SIGNAL_ENGINE,
  ACTIVE_SIGNAL_ENGINE_LABEL,
  ASIAN_RANGE_CONFIG,
  GOLDMINE_CONFIG,
  GOLDMINE_STRATEGY_ID,
  GOLDMINE_STRATEGY_LABEL,
  UTC_SESSIONS,
} from "./config";
import type {
  GoldmineAsianRange,
  GoldmineConfirmation,
  GoldmineDirection,
  GoldmineDisplacement,
  GoldmineScoreBreakdown,
  GoldmineSweep,
  V2GoldmineAudit,
  V2GoldmineInput,
  V2GoldmineRejectedCandidate,
  V2GoldmineSettings,
} from "./types";

const DEFAULT_SETTINGS: V2GoldmineSettings = {
  maxRiskAmount: 100,
  atrPeriod: 14,
  stopAtrBufferMultiplier: 0.10,
};

const resultCache = new Map<string, EntryEngineResult>();
type DebugWindow = Window & { DEBUG_GOLDMINE?: boolean };

type IndexedCandle = {
  candle: Candle;
  index: number;
};

type CandidateOutcome =
  | { signal: TradeSignal; debug: SignalCandidateDebug }
  | { rejection: V2GoldmineRejectedCandidate; debug: SignalCandidateDebug };

type TargetSelection =
  | { target: TakeProfitResult; rr: { risk: number; reward: number; rr: number } }
  | { target: null; code: SignalRejectionCode; reason: string };

export function clearV2GoldmineCache(): void {
  resultCache.clear();
}

export function generateV2GoldmineSignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const settings = { ...DEFAULT_SETTINGS, ...input.settings };
  const config = GOLDMINE_CONFIG;
  const candles = input.candles.filter((candle) => candle.isClosed);
  const cacheKey = buildCacheKey(input, candles, settings);
  const cached = resultCache.get(cacheKey);
  if (cached) return cloneResult(cached, "hit");

  const atr = calculateAtrSeries(candles, settings.atrPeriod);
  const asianRanges = calculateAsianRanges(candles, atr, input.timeframe, settings);
  const rejectedCandidates: V2GoldmineRejectedCandidate[] = [];
  const candidateDebug: SignalCandidateDebug[] = [];
  const signalsById = new Map<string, TradeSignal>();
  const consumedSessionSide = new Set<string>();
  let asianHighSweeps = 0;
  let asianLowSweeps = 0;
  let confirmationFound = 0;
  let confirmationExpired = 0;

  for (const range of asianRanges) {
    if (!range.valid) {
      const code = range.invalidCode ?? "NO_USABLE_RANGE";
      const rejection = rejectedCandidate({
        id: `goldmine:${range.date}:invalid-asian-range`,
        code,
        reason: range.invalidReason ?? "Not enough range data to calculate usable Asian/fallback range.",
        date: range.date,
        direction: "NONE",
        sweepType: "NONE",
        candleIndex: null,
        timestamp: null,
        stage: "REJECTED",
        nextRequiredAction: "Load enough pre-scan candles to build a complete, partial, or fallback range.",
        failedStage: code,
      });
      rejectedCandidates.push(rejection);
      candidateDebug.push(candidateDebugFromRejection(rejection));
      
      const candleTime = range.sessionEnd ? new Date(range.sessionEnd).toISOString() : `${range.date}T00:00:00.000Z`;
      logGoldmineStage(candleTime, false, code, rejection.reason);
      continue;
    }

    logGoldmineStage(
      new Date(range.sessionEnd).toISOString(),
      true,
      "ASIAN_RANGE",
      `Built valid Asian range: date=${range.date}, high=${range.high}, low=${range.low}, midpoint=${range.midpoint}`,
    );

    const tradingIndexes = indexesForTradingDay(candles, range, settings);
    let dayHadSweep = false;

    for (const index of tradingIndexes) {
      const sweep = detectGoldmineSweep(candles[index], index, range, settings);
      if (!sweep) {
        logGoldmineStage(
          candles[index].time,
          false,
          "NO_SWEEP",
          `Candle price range [${candles[index].low} - ${candles[index].high}] did not sweep Asian boundaries [${range.low} - ${range.high}]`,
        );
        continue;
      }

      dayHadSweep = true;
      if (sweep.type === "ASIAN_HIGH_SWEEP") asianHighSweeps += 1;
      else asianLowSweeps += 1;

      const sessionSideKey = `${range.date}:${sweep.session}:${sweep.direction}`;
      if (consumedSessionSide.has(sessionSideKey)) continue;

      const outcome = evaluateSweepCandidate({
        input,
        settings,
        range,
        sweep,
        candles,
        atr,
      });

      if ("signal" in outcome) {
        if (signalsById.has(outcome.signal.id)) {
          const rejection = rejectedCandidate({
            id: `${outcome.signal.sourceSetupId}:duplicate`,
            code: "DUPLICATE_SIGNAL",
            reason: "Duplicate V2 Goldmine signal ID was prevented by the signal map.",
            date: range.date,
            direction: sweep.direction,
            sweepType: sweep.type,
            candleIndex: sweep.candleIndex,
            timestamp: sweep.timestamp,
            stage: "REJECTED",
            nextRequiredAction: "Keep the first immutable signal and ignore duplicate evidence.",
          });
          rejectedCandidates.push(rejection);
          candidateDebug.push(candidateDebugFromRejection(rejection));
          continue;
        }

        signalsById.set(outcome.signal.id, outcome.signal);
        candidateDebug.push(outcome.debug);
        consumedSessionSide.add(sessionSideKey);
        confirmationFound += 1;
      } else {
        rejectedCandidates.push(outcome.rejection);
        candidateDebug.push(outcome.debug);
        if (outcome.rejection.code === "NO_CONFIRMATION") confirmationExpired += 1;
      }
    }

    if (!dayHadSweep) {
      const rejection = rejectedCandidate({
        id: `goldmine:${range.date}:no-sweep`,
        code: "NO_SWEEP",
        reason: "No London or New York candle swept the Asian high or Asian low.",
        date: range.date,
        direction: "NONE",
        sweepType: "NONE",
        candleIndex: null,
        timestamp: null,
        stage: "CANDIDATE",
        nextRequiredAction: "Wait for a closed London or New York sweep through the Asian range.",
      });
      rejectedCandidates.push(rejection);
      candidateDebug.push(candidateDebugFromRejection(rejection));
    }
  }

  if (asianRanges.length === 0 && candles.length > 0) {
    const rejection = rejectedCandidate({
      id: "goldmine:no-asian-range",
      code: "NO_USABLE_RANGE",
      reason: "Not enough range data to calculate usable Asian/fallback range.",
      date: null,
      direction: "NONE",
      sweepType: "NONE",
      candleIndex: null,
      timestamp: null,
      stage: "REJECTED",
      nextRequiredAction: "Fetch enough candles to build a complete, partial, or fallback range before scanning.",
    });
    rejectedCandidates.push(rejection);
    candidateDebug.push(candidateDebugFromRejection(rejection));
  }

  const signals = [...signalsById.values()].sort((a, b) => a.confirmedAtIndex - b.confirmedAtIndex);
  const signalMap = new Map(signals.map((signal) => [signal.id, signal]));
  const topRejectionReasons = topReasons(rejectedCandidates);
  const generationTimeMs = round(performance.now() - started, 2);
  const rangeAudit = rangeAuditCounts(asianRanges, signals, rejectedCandidates);
  const v2Audit: V2GoldmineAudit = {
    totalCandlesScanned: candles.length,
    daysDetected: asianRanges.length,
    validAsianRanges: asianRanges.filter((range) => range.valid).length,
    invalidAsianRanges: asianRanges.filter((range) => !range.valid).length,
    ...rangeAudit,
    candidates: asianRanges.filter((range) => range.valid).length,
    asianHighSweeps,
    asianLowSweeps,
    rejectedSweeps: rejectedCandidates.filter((item) => item.sweepType !== "NONE").length,
    rejectionConfirmed: rejectedCandidates.filter((item) => item.stage === "REJECTION_CONFIRMED").length,
    waitingConfirmations: rejectedCandidates.filter((item) => item.stage === "WAITING_CONFIRMATION" || item.stage === "EXPIRED").length,
    confirmationFound,
    confirmationExpired,
    confirmedBuyCount: signals.filter((signal) => signal.type === "CONFIRMED_BUY").length,
    confirmedSellCount: signals.filter((signal) => signal.type === "CONFIRMED_SELL").length,
    rejectedCount: rejectedCandidates.length,
    topRejectionReasons,
    generationTimeMs,
  };
  const rejectedSetups = rejectedCandidates.map((candidate) => rejectedSetupFromCandidate(candidate));
  const noTrade = signals.length === 0
    ? {
        status: "NO_TRADE" as const,
        checkedSetups: asianHighSweeps + asianLowSweeps,
        rejectionReasons: rejectedCandidates.map((candidate) => candidate.reason),
        message: "No V2 Goldmine signals found for this range. Check V2 Goldmine Debug Panel.",
        nearestPossibleSetup: null,
        requiredForSignal: [
          "Usable complete, partial, or fallback range before the trading scan.",
          "Closed London or New York sweep of Asian high or low.",
          "Strong rejection back toward the Asian range.",
          `Displacement/MSS plus closed confirmation within ${config.confirmationWindow} candles.`,
          `RR >= ${config.minRR.toFixed(1)} and score >= ${config.minSignalScore}.`,
        ],
        timestamp: candles.at(-1)?.timestamp ?? null,
      }
    : null;

  const result: EntryEngineResult = {
    signals,
    activeSignals: signals,
    signalMap,
    pendingCandidates: [],
    candidateDebug,
    rejectedSetups,
    noTrade,
    v2AsianRanges: asianRanges,
    audit: {
      activeEngine: ACTIVE_SIGNAL_ENGINE,
      strategyId: GOLDMINE_STRATEGY_ID,
      activeMode: "NORMAL_SCALP",
      minimumScoreRequired: config.minSignalScore,
      minimumSetupScoreRequired: 0,
      minimumSignalScoreRequired: config.minSignalScore,
      minimumRrRequired: config.minRR,
      totalCandlesScanned: candles.length,
      totalMarkersGenerated: input.structure.markers.length,
      totalContextsGenerated: 1,
      totalPhase4Setups: 0,
      watchCount: 0,
      setupCount: 0,
      invalidatedCount: 0,
      expiredCount: 0,
      totalSetupsScanned: asianHighSweeps + asianLowSweeps,
      triggerSetupsFound: asianHighSweeps + asianLowSweeps,
      pendingConfirmationCount: 0,
      expiredConfirmationCount: confirmationExpired,
      invalidatedCandidateCount: 0,
      confirmedBuyCount: v2Audit.confirmedBuyCount,
      confirmedSellCount: v2Audit.confirmedSellCount,
      rapidBuyCount: 0,
      rapidSellCount: 0,
      rapidSignalCount: 0,
      rejectedSetupCount: rejectedCandidates.length,
      lastRejectionReason: rejectedCandidates.at(-1)?.reason ?? null,
      lastConfirmedSignal: signals.at(-1)?.type ?? null,
      topRejectionReasons: topRejectionReasons.map((item) => ({ reason: item.reason, count: item.count })),
      lastFiveTriggerSetups: rejectedCandidates
        .filter((item) => item.sweepType !== "NONE")
        .slice(-5)
        .map((item) => `${item.sweepType} ${item.date ?? "-"} @ ${item.candleIndex ?? "-"}`),
      lastFiveConfirmedSignals: signals
        .slice(-5)
        .map((signal) => `${signal.type} ${new Date(signal.timestamp).toISOString()} ${signal.rr.toFixed(2)}R`),
      noSignalMessage: noTrade?.message ?? null,
      noRepaintWarnings: signals
        .filter((signal) => !signal.noRepaintProof.passed)
        .map((signal) => `${signal.id}: ${signal.noRepaintProof.message}`),
      rrCalculation: signals.at(-1)
        ? `${signals.at(-1)!.rewardPoints.toFixed(2)} / ${signals.at(-1)!.riskPoints.toFixed(2)} = ${signals.at(-1)!.rr.toFixed(2)}R`
        : null,
      stopLossSource: signals.at(-1)?.stopLossDetail.source ?? null,
      takeProfitSource: signals.at(-1)?.takeProfitDetail.source ?? null,
      scoreBreakdown: signals.at(-1)?.scoreBreakdown ?? null,
      lastCandidateDebug: candidateDebug.at(-1) ?? null,
      noRepaintValidation: signals.every((signal) => signal.noRepaintProof.passed) ? "PASS" : "WARNING",
      calculationTimeMs: generationTimeMs,
      generationTimeMs,
      cacheStatus: "miss",
      v2Goldmine: {
        activeEngineLabel: ACTIVE_SIGNAL_ENGINE_LABEL,
        strategyId: GOLDMINE_STRATEGY_ID,
        ...v2Audit,
      },
    },
  };

  if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value ?? "");
  resultCache.set(cacheKey, result);

  return result;
}

export function calculateAsianRanges(
  candles: Candle[],
  atr: number[],
  timeframe: string,
  settings?: Partial<V2GoldmineSettings>,
): GoldmineAsianRange[] {
  const groups = new Map<string, IndexedCandle[]>();
  candles.forEach((candle, index) => {
    const date = utcDateKey(candle.timestamp);
    groups.set(date, [...(groups.get(date) ?? []), { candle, index }]);
  });

  return [...groups.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, group]) => calculateAsianRangeForDay(date, group, atr, timeframe, settings));
}

export function detectGoldmineSweep(
  candle: Candle,
  index: number,
  range: GoldmineAsianRange,
  settings?: Partial<V2GoldmineSettings>,
): GoldmineSweep | null {
  const session = tradingSessionAt(candle.timestamp, settings);
  if (!session) return null;

  const candleRange = candle.high - candle.low;
  if (candleRange <= 0) return null;

  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const sweptLow = candle.low < range.low;
  const sweptHigh = candle.high > range.high;

  if (sweptLow) {
    return {
      type: "ASIAN_LOW_SWEEP",
      direction: "BUY",
      candleIndex: index,
      timestamp: candle.timestamp,
      price: range.low,
      extremePrice: candle.low,
      rejectionStrength: round(clamp(lowerWick / candleRange, 0, 1), 3),
      wickRatio: round(clamp(lowerWick / candleRange, 0, 1), 3),
      closedBackInsideRange: candle.close >= range.low && candle.close <= range.high,
      session,
    };
  }

  if (sweptHigh) {
    return {
      type: "ASIAN_HIGH_SWEEP",
      direction: "SELL",
      candleIndex: index,
      timestamp: candle.timestamp,
      price: range.high,
      extremePrice: candle.high,
      rejectionStrength: round(clamp(upperWick / candleRange, 0, 1), 3),
      wickRatio: round(clamp(upperWick / candleRange, 0, 1), 3),
      closedBackInsideRange: candle.close >= range.low && candle.close <= range.high,
      session,
    };
  }

  return null;
}

export function isGoldmineConfirmation(
  candles: Candle[],
  index: number,
  direction: GoldmineDirection,
): GoldmineConfirmation | null {
  const candle = candles[index];
  const previous = candles[index - 1];
  if (!candle?.isClosed || !previous) return null;

  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  if (range <= 0) return null;

  const bodyRatio = body / range;
  const closePosition = direction === "BUY"
    ? (candle.close - candle.low) / range
    : (candle.high - candle.close) / range;
  const directional = direction === "BUY" ? candle.close > candle.open : candle.close < candle.open;
  const previousMidpoint = (previous.high + previous.low) / 2;
  const previousWindow = candles.slice(Math.max(0, index - 4), index);
  const minorBreak = direction === "BUY"
    ? candle.close > Math.max(...previousWindow.map((item) => item.high))
    : candle.close < Math.min(...previousWindow.map((item) => item.low));
  const closesBeyondPreviousMidpoint = direction === "BUY"
    ? candle.close > previousMidpoint
    : candle.close < previousMidpoint;

  if (!directional || closePosition < 0.6 || bodyRatio < 0.40 || (!minorBreak && !closesBeyondPreviousMidpoint)) {
    return null;
  }

  const quality = clamp(
    Math.round(
      (closePosition >= 0.75 ? 5 : 3) +
      (bodyRatio >= 0.55 ? 5 : 3) +
      (minorBreak ? 3 : 0) +
      (closesBeyondPreviousMidpoint ? 2 : 0),
    ),
    0,
    15,
  );

  return {
    candleIndex: index,
    timestamp: candle.timestamp,
    quality,
    reason: `${direction} confirmation closed directionally, held the directional 40%, and cleared ${minorBreak ? "minor structure" : "the previous candle midpoint"}.`,
    candleClose: candle.close,
  };
}

function evaluateSweepCandidate(input: {
  input: V2GoldmineInput;
  settings: V2GoldmineSettings;
  range: GoldmineAsianRange;
  sweep: GoldmineSweep;
  candles: Candle[];
  atr: number[];
}): CandidateOutcome {
  const { input: engineInput, settings, range, sweep, candles, atr } = input;
  const config = GOLDMINE_CONFIG;
  const direction = sweep.direction;
  const latestIndex = candles.length - 1;
  const windowEnd = Math.min(latestIndex, sweep.candleIndex + config.confirmationWindow);
  const baseId = `goldmine:${range.date}:${sweep.type}:${sweep.candleIndex}`;
  const weakSweep = sweep.wickRatio < 0.24 || !sweep.closedBackInsideRange;

  if (weakSweep) {
    return rejectOutcome({
      rejection: rejectedCandidate({
        id: baseId,
        code: "WEAK_SWEEP_REJECTION",
        reason: "Sweep candle closed, but the wick rejection back into the Asian range was too weak.",
        date: range.date,
        direction,
        sweepType: sweep.type,
        candleIndex: sweep.candleIndex,
        timestamp: sweep.timestamp,
        stage: "SWEEP_DETECTED",
        nextRequiredAction: "Wait for a closed sweep candle with a clearer rejection wick and close back inside the Asian range.",
        failedStage: "WEAK_SWEEP_REJECTION",
      }),
    });
  }

  logGoldmineStage(new Date(sweep.timestamp).toISOString(), true, "WEAK_SWEEP_REJECTION", `Valid sweep rejection: wickRatio=${sweep.wickRatio.toFixed(2)}`);

  let displacement: GoldmineDisplacement | null = null;
  let confirmation: GoldmineConfirmation | null = null;

  for (let index = sweep.candleIndex + 1; index <= windowEnd; index += 1) {
    displacement ??= findDisplacementOrMss(engineInput.structure.markers, candles, atr, direction, sweep.candleIndex, index);
    if (!displacement) continue;

    confirmation = isGoldmineConfirmation(candles, index, direction);
    if (confirmation) break;
  }

  if (!displacement) {
    return rejectOutcome({
      rejection: rejectedCandidate({
        id: baseId,
        code: "NO_DISPLACEMENT_OR_MSS",
        reason: "Sweep was valid, but no bullish/bearish displacement or MSS appeared before the confirmation window ended.",
        date: range.date,
        direction,
        sweepType: sweep.type,
        candleIndex: sweep.candleIndex,
        timestamp: sweep.timestamp,
        stage: "REJECTION_CONFIRMED",
        nextRequiredAction: "Wait for displacement or MSS after the sweep before looking for entry confirmation.",
        failedStage: "NO_DISPLACEMENT_OR_MSS",
      }),
    });
  }

  logGoldmineStage(new Date(displacement.timestamp).toISOString(), true, "NO_DISPLACEMENT_OR_MSS", `Displacement/MSS found at candle ${displacement.candleIndex} (${displacement.type})`);

  if (!confirmation) {
    return rejectOutcome({
      rejection: rejectedCandidate({
        id: baseId,
        code: "NO_CONFIRMATION",
        reason: `Confirmation expired after ${config.confirmationWindow} closed candles.`,
        date: range.date,
        direction,
        sweepType: sweep.type,
        candleIndex: sweep.candleIndex,
        timestamp: sweep.timestamp,
        stage: "EXPIRED",
        nextRequiredAction: "Wait for the next Asian sweep; this one did not confirm in time.",
        failedStage: "NO_CONFIRMATION",
      }),
    });
  }

  logGoldmineStage(new Date(confirmation.timestamp).toISOString(), true, "NO_CONFIRMATION", `Confirmation candle found at index ${confirmation.candleIndex}`);

  const confirmationCandle = candles[confirmation.candleIndex];
  const referenceAtr = positive(atr[confirmation.candleIndex]) ?? positive(range.atrReference) ?? averageRange(candles, confirmation.candleIndex);
  const entry = confirmationCandle.close;
  const distanceFromRange = direction === "BUY" ? entry - range.low : range.high - entry;
  if (distanceFromRange > Math.max(range.rangeSize * 1.35, referenceAtr * 4)) {
    return rejectOutcome({
      rejection: rejectedCandidate({
        id: baseId,
        code: "PRICE_TOO_EXTENDED",
        reason: "Confirmation came too far from the Asian sweep area, so the entry would chase price.",
        date: range.date,
        direction,
        sweepType: sweep.type,
        candleIndex: confirmation.candleIndex,
        timestamp: confirmation.timestamp,
        stage: "REJECTED",
        nextRequiredAction: "Wait for a closer confirmation or a pullback near the sweep area.",
        failedStage: "PRICE_TOO_EXTENDED",
      }),
    });
  }

  const stop = buildStopLoss(direction, entry, sweep, referenceAtr, settings.stopAtrBufferMultiplier);
  if (!stop) {
    return rejectOutcome({
      rejection: rejectedCandidate({
        id: baseId,
        code: "STOP_LOSS_INVALID",
        reason: "Could not place stop beyond the sweep extreme with positive risk.",
        date: range.date,
        direction,
        sweepType: sweep.type,
        candleIndex: confirmation.candleIndex,
        timestamp: confirmation.timestamp,
        stage: "REJECTED",
        nextRequiredAction: "Wait for a new sweep with a valid stop location.",
        failedStage: "STOP_LOSS_INVALID",
      }),
    });
  }

  const targetSelection = selectTarget({
    input: engineInput,
    direction,
    entry,
    risk: stop.riskPoints,
    range,
    confirmationIndex: confirmation.candleIndex,
    minRR: config.minRR,
    allowMidpointTP: true,
    allowFixedRRFallback: true,
    fixedRRFallbackOnlyWithoutLiquidity: false,
    noWeakFallbackTP: false,
  });

  if (!targetSelection.target) {
    return rejectOutcome({
      rejection: rejectedCandidate({
        id: baseId,
        code: targetSelection.code,
        reason: targetSelection.reason,
        date: range.date,
        direction,
        sweepType: sweep.type,
        candleIndex: confirmation.candleIndex,
        timestamp: confirmation.timestamp,
        stage: "REJECTED",
        nextRequiredAction: "Wait for a sweep where TP supports the required RR.",
        failedStage: "RR_TOO_LOW",
      }),
    });
  }

  const scoreBreakdown = scoreGoldmineSignal({
    range,
    sweep,
    displacement,
    confirmation,
    rr: targetSelection.rr.rr,
    session: sweep.session,
    atr: referenceAtr,
  });
  const score = Object.values(scoreBreakdown).reduce((total, value) => total + value, 0);

  if (score < config.minSignalScore) {
    return rejectOutcome({
      rejection: rejectedCandidate({
        id: baseId,
        code: "SCORE_TOO_LOW",
        reason: `V2 score ${score} is below requirement ${config.minSignalScore}.`,
        date: range.date,
        direction,
        sweepType: sweep.type,
        candleIndex: confirmation.candleIndex,
        timestamp: confirmation.timestamp,
        stage: "REJECTED",
        nextRequiredAction: "Wait for stronger range quality, sweep rejection, displacement/MSS, confirmation, or RR.",
        failedStage: "SCORE_TOO_LOW",
      }),
    });
  }

  const signal = buildSignal({
    input: engineInput,
    settings,
    range,
    sweep,
    displacement,
    confirmation,
    stop,
    target: targetSelection.target,
    rr: targetSelection.rr,
    score,
    scoreBreakdown,
  });

  logGoldmineStage(
    new Date(signal.timestamp).toISOString(),
    true,
    "CONFIRMED_SIGNAL",
    `Signal confirmed! Type: ${signal.type}, Entry: ${signal.entryPrice}, SL: ${signal.stopLoss}, TP: ${signal.takeProfit}`,
  );

  return {
    signal,
    debug: candidateDebugFromSignal(signal, score, config.minSignalScore, config.minRR),
  };
}

function calculateAsianRangeForDay(
  date: string,
  group: IndexedCandle[],
  atr: number[],
  timeframe: string,
  settings?: Partial<V2GoldmineSettings>,
): GoldmineAsianRange {
  const sortedGroup = [...group].sort((a, b) => a.index - b.index);
  const hours = settings?.sessionHours ?? {
    asianStart: UTC_SESSIONS.asian.startHour,
    asianEnd: UTC_SESSIONS.asian.endHour,
  };
  const asian = sortedGroup.filter(({ candle }) => {
    const hour = utcHour(candle.timestamp);
    return hour >= hours.asianStart && hour < hours.asianEnd;
  });
  const sessionHourLength = hours.asianEnd - hours.asianStart;
  const expectedAsianCandles = Math.max(1, Math.floor((sessionHourLength * 60) / timeframeMinutes(timeframe)));
  const fallbackExpectedCandles = Math.max(1, Math.floor((ASIAN_RANGE_CONFIG.fallbackLookbackHours * 60) / timeframeMinutes(timeframe)));
  const minCoverage = ASIAN_RANGE_CONFIG.minCoverageRatio;
  const padHour = (h: number) => String(Math.floor(h)).padStart(2, "0");
  const scheduledAsianStart = Date.parse(`${date}T${padHour(hours.asianStart)}:00:00.000Z`);
  const scheduledAsianEnd = Date.parse(`${date}T${padHour(hours.asianEnd)}:00:00.000Z`);

  const buildEmpty = (input: {
    rangeType: GoldmineAsianRange["rangeType"];
    source: IndexedCandle[];
    expectedCandles: number;
    coverageRatio: number;
    sessionStart: number;
    sessionEnd: number;
    warnings: V2AsianRangeWarningCode[];
  }): GoldmineAsianRange => ({
    date,
    rangeType: input.rangeType,
    sessionStart: input.sessionStart,
    sessionEnd: input.sessionEnd,
    high: 0,
    low: 0,
    midpoint: 0,
    rangeSize: 0,
    highTime: input.sessionStart,
    lowTime: input.sessionStart,
    candlesCount: input.source.length,
    expectedCandles: input.expectedCandles,
    coverageRatio: input.coverageRatio,
    isComplete: input.rangeType === "COMPLETE",
    isPartial: input.rangeType === "PARTIAL",
    isFallback: input.rangeType === "FALLBACK",
    warnings: input.warnings,
    startIndex: input.source[0]?.index ?? sortedGroup[0]?.index ?? 0,
    endIndex: input.source.at(-1)?.index ?? sortedGroup.at(-1)?.index ?? 0,
    atrReference: 0,
    valid: false,
  });

  const buildRange = (input: {
    rangeType: GoldmineAsianRange["rangeType"];
    source: IndexedCandle[];
    expectedCandles: number;
    coverageRatio: number;
    sessionStart: number;
    sessionEnd: number;
  }): GoldmineAsianRange => {
    const warnings: V2AsianRangeWarningCode[] = [];
    if (input.rangeType === "PARTIAL") warnings.push("WARNING_PARTIAL_ASIAN_RANGE");
    if (input.rangeType === "FALLBACK") warnings.push("WARNING_FALLBACK_RANGE_USED");

    const empty = buildEmpty({
      ...input,
      warnings,
    });

    if (input.source.length === 0) {
      return {
        ...empty,
        invalidCode: "NO_USABLE_RANGE",
        invalidReason: "Not enough range data to calculate usable Asian/fallback range.",
      };
    }

    if (input.coverageRatio < minCoverage) {
      const minimum = Math.max(1, Math.ceil(input.expectedCandles * minCoverage));
      return {
        ...empty,
        invalidCode: "RANGE_CANDLES_TOO_FEW",
        invalidReason: `Not enough range data to calculate usable Asian/fallback range. Range has ${input.source.length} candles; minimum for ${timeframe} is ${minimum}.`,
      };
    }

    const highItem = input.source.reduce((best, item) => item.candle.high > best.candle.high ? item : best, input.source[0]);
    const lowItem = input.source.reduce((best, item) => item.candle.low < best.candle.low ? item : best, input.source[0]);
    const high = highItem.candle.high;
    const low = lowItem.candle.low;
    const rangeSize = high - low;
    const atrReference = positive(mean(input.source.map((item) => atr[item.index]).filter(Number.isFinite))) ?? averageRangeFromIndexed(input.source);
    const base = {
      ...empty,
      high: round(high),
      low: round(low),
      midpoint: round((high + low) / 2),
      rangeSize: round(rangeSize),
      highTime: highItem.candle.timestamp,
      lowTime: lowItem.candle.timestamp,
      startIndex: input.source[0].index,
      endIndex: input.source.at(-1)!.index,
      atrReference: round(atrReference),
    };

    if (rangeSize <= 0 || high <= low || atrReference <= 0) {
      return {
        ...base,
        valid: false,
        invalidCode: "RANGE_HIGH_LOW_INVALID",
        invalidReason: "Range high/low or ATR reference is invalid.",
      };
    }

    if (rangeSize > atrReference * 6) {
      warnings.push("WARNING_LARGE_ASIAN_RANGE");
    }

    return { ...base, warnings, valid: true };
  };

  if (asian.length > 0) {
    const coverageRatio = round(Math.min(1, asian.length / expectedAsianCandles), 4);
    const isComplete = asian.length >= expectedAsianCandles;
    const sessionStart = isComplete ? scheduledAsianStart : asian[0].candle.timestamp;
    const sessionEnd = isComplete ? scheduledAsianEnd : asian.at(-1)!.candle.closeTime ?? asian.at(-1)!.candle.timestamp;
    return buildRange({
      rangeType: isComplete ? "COMPLETE" : "PARTIAL",
      source: asian,
      expectedCandles: expectedAsianCandles,
      coverageRatio,
      sessionStart,
      sessionEnd,
    });
  }

  const firstTradingCandle = sortedGroup.find(({ candle }) => tradingSessionAt(candle.timestamp, settings));
  const candlesBeforeFirstTrading = firstTradingCandle
    ? sortedGroup.filter((item) => item.index < firstTradingCandle.index)
    : [];
  const fallbackSource = candlesBeforeFirstTrading.length > 0
    ? candlesBeforeFirstTrading.slice(-fallbackExpectedCandles)
    : sortedGroup.slice(0, fallbackExpectedCandles);
  const fallbackCoverageRatio = round(Math.min(1, fallbackSource.length / fallbackExpectedCandles), 4);
  const fallbackStart = fallbackSource[0]?.candle.timestamp ?? scheduledAsianStart;
  const fallbackEnd = fallbackSource.at(-1)?.candle.closeTime ?? fallbackSource.at(-1)?.candle.timestamp ?? scheduledAsianEnd;

  return buildRange({
    rangeType: "FALLBACK",
    source: fallbackSource,
    expectedCandles: fallbackExpectedCandles,
    coverageRatio: fallbackCoverageRatio,
    sessionStart: fallbackStart,
    sessionEnd: fallbackEnd,
  });
}

function indexesForTradingDay(candles: Candle[], range: GoldmineAsianRange, settings?: Partial<V2GoldmineSettings>): number[] {
  const date = range.date;
  const indexes: number[] = [];
  for (let index = range.endIndex + 1; index < candles.length; index += 1) {
    const candle = candles[index];
    if (utcDateKey(candle.timestamp) !== date) continue;
    if (tradingSessionAt(candle.timestamp, settings)) indexes.push(index);
  }
  return indexes;
}

function findDisplacementOrMss(
  markers: MarketMarker[],
  candles: Candle[],
  atr: number[],
  direction: GoldmineDirection,
  sweepIndex: number,
  currentIndex: number,
): GoldmineDisplacement | null {
  const bias = direction === "BUY" ? "BULLISH" : "BEARISH";
  const marker = markers
    .filter((item) =>
      (item.type === "MSS" || item.type === "DISPLACEMENT") &&
      item.direction === bias &&
      item.confirmedAtIndex >= sweepIndex &&
      item.confirmedAtIndex <= currentIndex,
    )
    .sort((a, b) => b.confirmedAtIndex - a.confirmedAtIndex)[0];

  if (marker) {
    return {
      type: marker.type === "MSS" ? "MSS" : "DISPLACEMENT",
      candleIndex: marker.confirmedAtIndex,
      timestamp: marker.confirmedAtTimestamp,
      quality: marker.type === "MSS" ? 15 : marker.strength >= 3 ? 13 : 10,
      reason: `${marker.type} marker confirmed after the Asian sweep.`,
      markerId: marker.id,
    };
  }

  const candle = candles[currentIndex];
  const previousWindow = candles.slice(Math.max(0, currentIndex - 4), currentIndex);
  if (!candle || previousWindow.length === 0) return null;

  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  const referenceAtr = positive(atr[currentIndex]) ?? averageRange(candles, currentIndex);
  const directional = direction === "BUY" ? candle.close > candle.open : candle.close < candle.open;
  const breaksMinorStructure = direction === "BUY"
    ? candle.close > Math.max(...previousWindow.map((item) => item.high))
    : candle.close < Math.min(...previousWindow.map((item) => item.low));

  if (!directional || range <= 0 || body / range < 0.5 || body < referenceAtr * 0.55 || !breaksMinorStructure) {
    return null;
  }

  return {
    type: "DISPLACEMENT",
    candleIndex: currentIndex,
    timestamp: candle.timestamp,
    quality: clamp(Math.round(8 + Math.min(5, body / Math.max(referenceAtr, Number.EPSILON))), 8, 13),
    reason: "Fallback displacement detected from a closed directional candle that broke minor structure.",
    markerId: null,
  };
}

function buildStopLoss(
  direction: GoldmineDirection,
  entry: number,
  sweep: GoldmineSweep,
  atr: number,
  bufferMultiplier: number,
): StopLossResult | null {
  const buffer = Math.max(atr * bufferMultiplier, 0.01);
  const price = direction === "BUY" ? sweep.extremePrice - buffer : sweep.extremePrice + buffer;
  const riskPoints = direction === "BUY" ? entry - price : price - entry;
  if (riskPoints <= 0) return null;
  return {
    price: round(price),
    source: "ASIAN_SWEEP_EXTREME",
    buffer: round(buffer),
    riskPoints: round(riskPoints),
    reason: `${direction} SL is beyond the Asian sweep extreme with an ATR buffer.`,
  };
}

function selectTarget(input: {
  input: V2GoldmineInput;
  direction: GoldmineDirection;
  entry: number;
  risk: number;
  range: GoldmineAsianRange;
  confirmationIndex: number;
  minRR: number;
  allowMidpointTP: boolean;
  allowFixedRRFallback: boolean;
  fixedRRFallbackOnlyWithoutLiquidity: boolean;
  noWeakFallbackTP: boolean;
}): TargetSelection {
  const liquidityTargets = collectLiquidityTargets(input.input.structure.liquidityZones, input.direction, input.entry, input.confirmationIndex);
  const candidates: Array<{ price: number; source: string }> = [];
  const midpointTarget = input.range.midpoint;
  const rangeExtremeTarget = input.direction === "BUY" ? input.range.high : input.range.low;

  if (input.allowMidpointTP && isDirectionalTarget(input.direction, input.entry, midpointTarget)) {
    candidates.push({ price: midpointTarget, source: "ASIAN_MIDPOINT" });
  }
  if (isDirectionalTarget(input.direction, input.entry, rangeExtremeTarget)) {
    candidates.push({ price: rangeExtremeTarget, source: input.direction === "BUY" ? "ASIAN_HIGH" : "ASIAN_LOW" });
  }
  candidates.push(...liquidityTargets);

  const selected = uniqueTargets(candidates)
    .sort((a, b) => Math.abs(a.price - input.entry) - Math.abs(b.price - input.entry))
    .find((target) => {
      const rr = calculateRiskReward(input.direction, input.entry, input.risk, target.price);
      return rr !== null && rr.rr >= input.minRR;
    });

  if (selected) {
    const rr = calculateRiskReward(input.direction, input.entry, input.risk, selected.price)!;
    const nextTargets = uniqueTargets(candidates)
      .filter((target) => isDirectionalTarget(input.direction, selected.price, target.price))
      .sort((a, b) => Math.abs(a.price - input.entry) - Math.abs(b.price - input.entry));
    return {
      target: {
        tp1: round(selected.price),
        tp2: nextTargets[0]?.price === undefined ? null : round(nextTargets[0].price),
        tp3: nextTargets[1]?.price === undefined ? null : round(nextTargets[1].price),
        source: selected.source,
        rewardPoints: rr.reward,
        reason: `TP1 uses ${selected.source.toLowerCase().replaceAll("_", " ")} after the Asian sweep.`,
      },
      rr,
    };
  }

  const hasLiquidityTarget = liquidityTargets.length > 0;
  const fallbackAllowed = input.allowFixedRRFallback &&
    !input.noWeakFallbackTP &&
    (!input.fixedRRFallbackOnlyWithoutLiquidity || !hasLiquidityTarget);
  if (fallbackAllowed) {
    const fallback = input.direction === "BUY"
      ? input.entry + input.risk * input.minRR
      : input.entry - input.risk * input.minRR;
    const rr = calculateRiskReward(input.direction, input.entry, input.risk, fallback)!;
    return {
      target: {
        tp1: round(fallback),
        tp2: round(input.direction === "BUY" ? input.entry + input.risk * Math.max(input.minRR + 0.5, 2) : input.entry - input.risk * Math.max(input.minRR + 0.5, 2)),
        tp3: null,
        source: `${input.minRR.toFixed(1)}R_V2_FALLBACK`,
        rewardPoints: rr.reward,
        reason: "No causal liquidity target met RR, so this V2 mode used a marked fixed-R fallback.",
      },
      rr,
    };
  }

  return hasLiquidityTarget
    ? { target: null, code: "RR_TOO_LOW", reason: `Available V2 targets did not reach ${input.minRR.toFixed(1)}R.` }
    : { target: null, code: "TP_NOT_FOUND", reason: "No midpoint, Asian-range, liquidity, or allowed fixed-R target was available." };
}

function collectLiquidityTargets(
  zones: LiquidityZone[],
  direction: GoldmineDirection,
  entry: number,
  confirmationIndex: number,
): Array<{ price: number; source: string }> {
  return zones
    .filter((zone) => zone.confirmedAtIndex <= confirmationIndex)
    .filter((zone) => zone.sweptAtIndex === undefined || zone.sweptAtIndex > confirmationIndex)
    .filter((zone) => direction === "BUY" ? zone.type === "BSL" && zone.price > entry : zone.type === "SSL" && zone.price < entry)
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry))
    .map((zone) => ({ price: zone.price, source: zone.type === "BSL" ? "NEAREST_BSL" : "NEAREST_SSL" }));
}

function scoreGoldmineSignal(input: {
  range: GoldmineAsianRange;
  sweep: GoldmineSweep;
  displacement: GoldmineDisplacement;
  confirmation: GoldmineConfirmation;
  rr: number;
  session: TradingSession;
  atr: number;
}): GoldmineScoreBreakdown {
  const asianRangeQuality = clamp(15 - asianRangeRiskPenalty(input.range), 0, 15);
  const sweepQuality = clamp(Math.round(10 + input.sweep.rejectionStrength * 10 + (input.sweep.closedBackInsideRange ? 2 : 0)), 0, 20);
  const rejectionCandleQuality = clamp(Math.round(input.sweep.wickRatio * 15), 0, 15);
  const displacementMssQuality = clamp(input.displacement.quality, 0, 15);
  const confirmationCandleQuality = clamp(input.confirmation.quality, 0, 15);
  const rrTargetQuality = clamp(Math.round(5 + Math.min(5, Math.max(0, input.rr - 1) * 3)), 0, 10);
  const sessionScore = sessionQuality(input.session);
  const volatilityRatio = input.range.rangeSize / Math.max(input.atr, Number.EPSILON);
  const volatilityQuality = clamp(Math.round(5 - Math.max(0, Math.abs(volatilityRatio - 4) - 3) * 0.7), 1, 5);
  return {
    asianRangeQuality,
    sweepQuality,
    rejectionCandleQuality,
    displacementMssQuality,
    confirmationCandleQuality,
    rrTargetQuality,
    sessionQuality: sessionScore,
    volatilityQuality,
  };
}

function buildSignal(input: {
  input: V2GoldmineInput;
  settings: V2GoldmineSettings;
  range: GoldmineAsianRange;
  sweep: GoldmineSweep;
  displacement: GoldmineDisplacement;
  confirmation: GoldmineConfirmation;
  stop: StopLossResult;
  target: TakeProfitResult;
  rr: { risk: number; reward: number; rr: number };
  score: number;
  scoreBreakdown: GoldmineScoreBreakdown;
}): TradeSignal {
  const bias = input.sweep.direction === "BUY" ? "BULLISH" : "BEARISH";
  const type = input.sweep.direction === "BUY" ? "CONFIRMED_BUY" : "CONFIRMED_SELL";
  const id = [
    input.input.symbol.trim().toUpperCase(),
    input.input.timeframe,
    GOLDMINE_STRATEGY_ID,
    input.confirmation.timestamp,
    input.sweep.direction,
  ].join(":");
  const evidenceIndexes = [
    ...rangeIndexes(input.range),
    input.sweep.candleIndex,
    input.displacement.candleIndex,
    input.confirmation.candleIndex,
  ];
  const maxEvidenceIndex = Math.max(...evidenceIndexes);
  const noRepaintPassed = maxEvidenceIndex <= input.confirmation.candleIndex && input.range.endIndex < input.sweep.candleIndex;
  const noRepaintProof: NoRepaintProof = {
    status: noRepaintPassed ? "PASS" : "WARNING",
    signalIndex: input.confirmation.candleIndex,
    latestAllowedCandleIndex: input.confirmation.candleIndex,
    usedMarkerIndexes: [...new Set(evidenceIndexes)].sort((a, b) => a - b),
    usedContextCloseTimes: [],
    usedSetupId: `goldmine:${input.range.date}:${input.sweep.type}:${input.sweep.candleIndex}`,
    passed: noRepaintPassed,
    lastAvailableIndex: input.confirmation.candleIndex,
    maxEvidenceIndex,
    message: noRepaintPassed
      ? `V2 signal uses the ${input.range.rangeType.toLowerCase()} range and closed candles at or before confirmation; entry, SL, TP, and RR are immutable.`
      : "V2 signal attempted to use evidence after confirmation.",
  };
  const v2ScoreBreakdown: V2GoldmineScoreBreakdown = { ...input.scoreBreakdown };
  const scoreBreakdown: SignalScoreBreakdown = {
    phase4Setup: input.scoreBreakdown.asianRangeQuality,
    contextAlignment: input.scoreBreakdown.sweepQuality,
    confirmationCandle: input.scoreBreakdown.rejectionCandleQuality + input.scoreBreakdown.confirmationCandleQuality,
    stopLossQuality: input.scoreBreakdown.displacementMssQuality,
    targetQuality: input.scoreBreakdown.rrTargetQuality,
    sessionQuality: input.scoreBreakdown.sessionQuality,
    volatilityQuality: input.scoreBreakdown.volatilityQuality,
    antiReversal: 0,
  };
  const asianRange: V2AsianRangeSnapshot = {
    date: input.range.date,
    rangeType: input.range.rangeType,
    sessionStart: input.range.sessionStart,
    sessionEnd: input.range.sessionEnd,
    high: input.range.high,
    low: input.range.low,
    midpoint: input.range.midpoint,
    rangeSize: input.range.rangeSize,
    highTime: input.range.highTime,
    lowTime: input.range.lowTime,
    candlesCount: input.range.candlesCount,
    expectedCandles: input.range.expectedCandles,
    coverageRatio: input.range.coverageRatio,
    isComplete: input.range.isComplete,
    isPartial: input.range.isPartial,
    isFallback: input.range.isFallback,
    warnings: input.range.warnings,
    valid: input.range.valid,
    invalidCode: input.range.invalidCode,
    invalidReason: input.range.invalidReason,
  };
  const sweep: V2SweepSnapshot = {
    type: input.sweep.type,
    candleIndex: input.sweep.candleIndex,
    timestamp: input.sweep.timestamp,
    price: input.sweep.price,
    extremePrice: input.sweep.extremePrice,
    rejectionStrength: input.sweep.rejectionStrength,
    session: input.sweep.session,
  };
  const confirmation: V2ConfirmationSnapshot = {
    candleIndex: input.confirmation.candleIndex,
    timestamp: input.confirmation.timestamp,
    quality: input.confirmation.quality,
    reason: input.confirmation.reason,
    displacementType: input.displacement.type,
    displacementIndex: input.displacement.candleIndex,
  };

  return {
    id,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: GOLDMINE_STRATEGY_ID,
    v2Direction: input.sweep.direction,
    type,
    direction: bias,
    status: "CONFIRMED",
    sourceSetupId: `goldmine:${input.range.date}:${input.sweep.type}:${input.sweep.candleIndex}`,
    setupType: "LIQUIDITY_SWEEP_REVERSAL",
    strategyModel: GOLDMINE_STRATEGY_LABEL,
    mode: "NORMAL_SCALP",
    timestamp: input.confirmation.timestamp,
    candleIndex: input.confirmation.candleIndex,
    confirmedAtIndex: input.confirmation.candleIndex,
    timeframe: input.input.timeframe,
    session: input.sweep.session,
    entryPrice: round(input.confirmation.candleClose),
    stopLoss: input.stop.price,
    takeProfit: input.target.tp1,
    takeProfit2: input.target.tp2,
    takeProfit3: input.target.tp3,
    riskPoints: input.rr.risk,
    rewardPoints: input.rr.reward,
    rr: input.rr.rr,
    score: input.score,
    confidence: confidenceFor(input.score),
    positionSizeSuggestion: round(input.settings.maxRiskAmount / input.rr.risk, 4),
    maxRiskAmount: input.settings.maxRiskAmount,
    invalidationLevel: input.sweep.extremePrice,
    reasons: [
      `${input.sweep.type === "ASIAN_LOW_SWEEP" ? "Asian low" : "Asian high"} was swept during ${input.sweep.session}.`,
      input.displacement.reason,
      input.confirmation.reason,
      input.stop.reason,
      input.target.reason,
    ],
    warnings: [
      ...input.range.warnings.map(rangeWarningMessage),
      ...(input.target.source.includes("FALLBACK") ? ["V2 used a marked fixed-R fallback target because no qualifying liquidity target was available."] : []),
    ],
    rejectionReasons: [],
    relatedMarkers: [input.displacement.markerId].filter((value): value is string => Boolean(value)),
    noRepaintProof,
    stopLossDetail: input.stop,
    takeProfitDetail: input.target,
    scoreBreakdown,
    v2ScoreBreakdown,
    asianRange,
    sweep,
    confirmation,
    immutable: true,
  };
}

function candidateDebugFromSignal(
  signal: TradeSignal,
  score: number,
  requiredSignalScore: number,
  requiredRR: number,
): SignalCandidateDebug {
  return {
    setupId: signal.sourceSetupId,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: GOLDMINE_STRATEGY_ID,
    setupScore: 0,
    requiredSetupScore: 0,
    finalSignalScore: score,
    requiredSignalScore,
    signalScore: score,
    rr: signal.rr,
    requiredRR,
    htfBias: "-",
    directionBias: signal.direction,
    asianRangeDate: signal.asianRange?.date,
    sweepType: signal.sweep?.type,
    session: signal.session,
    confirmationStatus: "CONFIRMED",
    confirmationWindowRemaining: 0,
    rejectionReason: "Accepted",
    nextRequiredAction: "V2 Goldmine signal confirmed; use immutable entry, SL, TP, and RR.",
  };
}

function candidateDebugFromRejection(candidate: V2GoldmineRejectedCandidate): SignalCandidateDebug {
  return {
    setupId: candidate.id,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: GOLDMINE_STRATEGY_ID,
    setupScore: 0,
    requiredSetupScore: 0,
    finalSignalScore: null,
    requiredSignalScore: GOLDMINE_CONFIG.minSignalScore,
    signalScore: null,
    rr: null,
    requiredRR: GOLDMINE_CONFIG.minRR,
    htfBias: "-",
    directionBias: candidate.direction === "BUY" ? "BULLISH" : candidate.direction === "SELL" ? "BEARISH" : "NEUTRAL",
    asianRangeDate: candidate.date ?? undefined,
    sweepType: candidate.sweepType,
    session: "-",
    confirmationStatus: candidate.code === "NO_CONFIRMATION" ? "EXPIRED_CONFIRMATION" : "REJECTED",
    confirmationWindowRemaining: 0,
    rejectionReason: candidate.reason,
    nextRequiredAction: candidate.nextRequiredAction,
    failedStage: candidate.failedStage ?? candidate.code,
  };
}

function logGoldmineStage(candleTime: string, passed: boolean, failedStage: string, reason: string): void {
  const isDebug = process.env.DEBUG_GOLDMINE === "true" ||
    (typeof window !== "undefined" && (window as DebugWindow).DEBUG_GOLDMINE === true);
  if (!isDebug) return;

  console.log(JSON.stringify({
    strategy: "GOLDMINE_ASIAN_SWEEP_REVERSAL",
    candleTime,
    passed,
    failedStage,
    reason,
  }));
}

function rejectOutcome(input: { rejection: V2GoldmineRejectedCandidate }): CandidateOutcome {
  const rej = input.rejection;
  const candleTime = rej.timestamp ? new Date(rej.timestamp).toISOString() : (rej.date ? `${rej.date}T00:00:00.000Z` : "unknown");
  
  logGoldmineStage(candleTime, false, rej.failedStage ?? rej.code, rej.reason);

  return {
    rejection: rej,
    debug: candidateDebugFromRejection(rej),
  };
}

function rejectedCandidate(input: V2GoldmineRejectedCandidate): V2GoldmineRejectedCandidate {
  return input;
}

function rejectedSetupFromCandidate(candidate: V2GoldmineRejectedCandidate): RejectedSetup {
  return {
    setupId: candidate.id,
    setupType: "LIQUIDITY_SWEEP_REVERSAL",
    setupState: candidate.sweepType === "NONE" ? "WATCH" : "TRIGGER",
    direction: candidate.direction === "BUY" ? "BULLISH" : candidate.direction === "SELL" ? "BEARISH" : "NEUTRAL",
    triggerIndex: candidate.candleIndex,
    rejectionReasons: [candidate.reason],
    rejectionReasonCodes: [candidate.code],
    debug: candidateDebugFromRejection(candidate),
  };
}

function calculateRiskReward(
  direction: GoldmineDirection,
  entry: number,
  risk: number,
  target: number,
): { risk: number; reward: number; rr: number } | null {
  const reward = direction === "BUY" ? target - entry : entry - target;
  if (risk <= 0 || reward <= 0) return null;
  return { risk: round(risk), reward: round(reward), rr: round(reward / risk, 2) };
}

function isDirectionalTarget(direction: GoldmineDirection, entry: number, target: number): boolean {
  return direction === "BUY" ? target > entry : target < entry;
}

function topReasons(candidates: V2GoldmineRejectedCandidate[]): Array<{ reason: SignalRejectionCode; count: number }> {
  const counts = new Map<SignalRejectionCode, number>();
  for (const candidate of candidates) counts.set(candidate.code, (counts.get(candidate.code) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 10);
}

function rangeAuditCounts(
  ranges: GoldmineAsianRange[],
  signals: TradeSignal[],
  rejectedCandidates: V2GoldmineRejectedCandidate[],
) {
  const hardRangeCodes: SignalRejectionCode[] = ["NO_USABLE_RANGE", "RANGE_HIGH_LOW_INVALID", "RANGE_CANDLES_TOO_FEW"];
  return {
    completeAsianRanges: ranges.filter((range) => range.valid && range.isComplete).length,
    partialAsianRanges: ranges.filter((range) => range.valid && range.isPartial).length,
    fallbackRanges: ranges.filter((range) => range.valid && range.isFallback).length,
    largeRangeWarnings: ranges.filter((range) => range.warnings.includes("WARNING_LARGE_ASIAN_RANGE")).length,
    noUsableRangeRejections: rejectedCandidates.filter((candidate) => hardRangeCodes.includes(candidate.code)).length,
    confirmedSignalsUsingPartialRange: signals.filter((signal) => signal.asianRange?.isPartial).length,
    confirmedSignalsUsingLargeRange: signals.filter((signal) => signal.asianRange?.warnings.includes("WARNING_LARGE_ASIAN_RANGE")).length,
  };
}

function calculateAtrSeries(candles: Candle[], period: number): number[] {
  return candles.map((candle, index) => {
    const start = Math.max(0, index - period + 1);
    const trueRanges = candles.slice(start, index + 1).map((item, offset, window) => {
      const previous = index === start + offset ? candles[start + offset - 1] : window[offset - 1];
      const previousClose = previous?.close ?? item.close;
      return Math.max(item.high - item.low, Math.abs(item.high - previousClose), Math.abs(item.low - previousClose));
    });
    return round(mean(trueRanges));
  });
}

function tradingSessionAt(timestamp: number, settings?: Partial<V2GoldmineSettings>): TradingSession | null {
  const hour = utcHour(timestamp);
  const hours = settings?.sessionHours ?? {
    londonStart: UTC_SESSIONS.london.startHour,
    londonEnd: UTC_SESSIONS.london.endHour,
    newYorkStart: UTC_SESSIONS.newYork.startHour,
    newYorkEnd: UTC_SESSIONS.newYork.endHour,
  };
  if (hour >= hours.londonStart && hour < hours.londonEnd) return "LONDON";
  if (hour >= hours.newYorkStart && hour < hours.newYorkEnd) return "NEW_YORK";
  return null;
}

function sessionQuality(session: TradingSession): number {
  if (session === "LONDON" || session === "LONDON_NEW_YORK_OVERLAP") return 5;
  if (session === "NEW_YORK") return 4;
  return 1;
}

function asianRangeRiskPenalty(range: GoldmineAsianRange): number {
  if (!range.warnings.includes("WARNING_LARGE_ASIAN_RANGE")) return 0;
  const ratio = range.rangeSize / Math.max(range.atrReference, Number.EPSILON);
  return ratio > 10 ? 10 : 5;
}

function rangeWarningMessage(warning: V2AsianRangeWarningCode): string {
  switch (warning) {
    case "WARNING_LARGE_ASIAN_RANGE":
      return "Asian range is large compared with ATR. Signal risk may be higher.";
    case "WARNING_PARTIAL_ASIAN_RANGE":
      return "Partial Asian range used because the full 00:00-07:00 UTC range was unavailable.";
    case "WARNING_FALLBACK_RANGE_USED":
      return "Fallback range used because no usable 00:00-07:00 UTC Asian candles were available.";
  }
}

function uniqueTargets(targets: Array<{ price: number; source: string }>): Array<{ price: number; source: string }> {
  const byPrice = new Map<number, { price: number; source: string }>();
  for (const target of targets) byPrice.set(round(target.price), { price: round(target.price), source: target.source });
  return [...byPrice.values()];
}

function rangeIndexes(range: GoldmineAsianRange): number[] {
  const indexes: number[] = [];
  for (let index = range.startIndex; index <= range.endIndex; index += 1) indexes.push(index);
  return indexes;
}

function buildCacheKey(input: V2GoldmineInput, candles: Candle[], settings: V2GoldmineSettings): string {
  const last = candles.at(-1);
  return [
    ACTIVE_SIGNAL_ENGINE,
    input.symbol,
    input.timeframe,
    input.startDate,
    input.endDate,
    candles.length,
    last?.timestamp ?? 0,
    input.structure.markers.length,
    input.structure.liquidityZones.length,
    JSON.stringify(settings),
  ].join(":");
}

function cloneResult(result: EntryEngineResult, cacheStatus: "hit" | "miss"): EntryEngineResult {
  return { ...result, signalMap: new Map(result.signalMap), audit: { ...result.audit, cacheStatus } };
}

function confidenceFor(score: number): TradeSignal["confidence"] {
  if (score >= 90) return "PREMIUM";
  if (score >= 78) return "STRONG";
  if (score >= 65) return "MODERATE";
  return "LOW_CONFIRMED";
}

function timeframeMinutes(timeframe: string): number {
  if (timeframe.endsWith("m")) return Math.max(1, Number(timeframe.slice(0, -1)) || 1);
  if (timeframe.endsWith("h")) return Math.max(1, Number(timeframe.slice(0, -1)) || 1) * 60;
  return 5;
}

function utcDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function utcHour(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getUTCHours() + date.getUTCMinutes() / 60;
}

function averageRange(candles: Candle[], index: number): number {
  const window = candles.slice(Math.max(0, index - 13), index + 1);
  return averageRangeFromCandles(window);
}

function averageRangeFromIndexed(candles: IndexedCandle[]): number {
  return averageRangeFromCandles(candles.map((item) => item.candle));
}

function averageRangeFromCandles(candles: Candle[]): number {
  return mean(candles.map((candle) => candle.high - candle.low).filter((value) => value > 0));
}

function positive(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function mean(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? finite.reduce((total, value) => total + value, 0) / finite.length : 0;
}

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
