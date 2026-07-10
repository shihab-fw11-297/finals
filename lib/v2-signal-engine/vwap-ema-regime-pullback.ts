import type { Candle } from "../candles/types";
import type {
  EntryEngineResult,
  RejectedSetup,
  SignalCandidateDebug,
  SignalRejectionCode,
  SignalScoreBreakdown,
  TradeSignal,
} from "../entry-engine/types";
import type { TradingSession } from "../market-context/types";
import { ACTIVE_SIGNAL_ENGINE, VWAP_EMA_REGIME_PULLBACK_CONFIG as CONFIG, VWAP_EMA_STRATEGY_ID, VWAP_EMA_STRATEGY_LABEL } from "./config";
import { calculateATR, calculateEMA, calculateSessionVWAP, clockWindowAt, zonedDateParts } from "./indicators";
import type { V2GoldmineInput } from "./types";

type Direction = "BUY" | "SELL";
type Regime = "BULLISH" | "BEARISH" | "NEUTRAL";

const resultCache = new Map<string, EntryEngineResult>();

export function clearVwapEmaRegimePullbackCache(): void {
  resultCache.clear();
}

export function generateVwapEmaRegimePullbackSignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const candles = input.candles.filter((candle) => candle.isClosed);
  const key = `${VWAP_EMA_STRATEGY_ID}:${input.symbol}:${input.timeframe}:${candles.length}:${candles.at(-1)?.timestamp ?? 0}:${input.settings?.maxRiskAmount ?? 100}`;
  const cached = resultCache.get(key);
  if (cached) return cloneResult(cached, "hit");

  const ema20 = calculateEMA(candles, CONFIG.emaFastPeriod);
  const ema50 = calculateEMA(candles, CONFIG.emaMidPeriod);
  const ema200 = calculateEMA(candles, CONFIG.emaRegimePeriod);
  const atr = calculateATR(candles, CONFIG.atrPeriod);
  const vwap = calculateSessionVWAP(candles, CONFIG.vwapSessionStart, CONFIG.sessionTimezone);
  const signals: TradeSignal[] = [];
  const pendingCandidates: SignalCandidateDebug[] = [];
  const candidateDebug: SignalCandidateDebug[] = [];
  const rejectedSetups: RejectedSetup[] = [];
  const rejectionCounts = new Map<string, number>();
  const sessionSignalCounts = new Map<string, number>();
  const daySignalCounts = new Map<string, number>();
  let sessionCandles = 0;
  let bullishRegimeCandles = 0;
  let bearishRegimeCandles = 0;
  let neutralRegimeCandles = 0;
  let pullbacksFound = 0;
  let validPullbacks = 0;
  let confirmationCandlesFound = 0;
  let expiredSetups = 0;

  for (let index = CONFIG.emaRegimePeriod - 1; index < candles.length; index++) {
    const sessionName = clockWindowAt(candles[index].timestamp, CONFIG.sessionTimezone, CONFIG.allowedSessions);
    if (!sessionName) continue;
    sessionCandles++;
    const values = indicatorValues(index, ema20, ema50, ema200, atr, vwap);
    if (!values) {
      increment(rejectionCounts, "INSUFFICIENT_CANDLES_FOR_200_EMA");
      continue;
    }
    const slope = values.ema50 - (ema50[Math.max(0, index - 3)] ?? values.ema50);
    const regime = classifyRegime(candles[index], values, slope);
    if (regime === "BULLISH") bullishRegimeCandles++;
    else if (regime === "BEARISH") bearishRegimeCandles++;
    else {
      neutralRegimeCandles++;
      increment(rejectionCounts, "NEUTRAL_REGIME");
      continue;
    }

    const distanceAtr = Math.abs(candles[index].close - values.vwap) / values.atr;
    if (distanceAtr > CONFIG.maxDistanceFromVwapAtr) {
      increment(rejectionCounts, "PRICE_TOO_EXTENDED_FROM_VWAP");
      continue;
    }
    if (distanceAtr < CONFIG.minDistanceFromVwapAtr) {
      increment(rejectionCounts, "PRICE_TOO_CLOSE_TO_VWAP");
      continue;
    }

    const direction: Direction = regime === "BULLISH" ? "BUY" : "SELL";
    const touch = pullbackTouch(candles[index], values.ema20, values.ema50, values.atr, direction);
    if (!touch) continue;
    pullbacksFound++;
    if (!pullbackKeepsRegime(candles[index], values.ema50, values.atr, direction)) {
      addRejection("NO_VALID_PULLBACK", `Pullback closed through EMA 50 and broke the ${regime.toLowerCase()} regime.`, index, direction);
      continue;
    }
    validPullbacks++;

    const local = zonedDateParts(candles[index].timestamp, CONFIG.sessionTimezone);
    const sessionKey = `${local.date}:${sessionName}`;
    if ((sessionSignalCounts.get(sessionKey) ?? 0) >= CONFIG.maxSignalsPerSession) {
      addRejection("MAX_SESSION_SIGNALS_REACHED", `${sessionName} already reached its signal limit.`, index, direction);
      continue;
    }
    if ((daySignalCounts.get(local.date) ?? 0) >= CONFIG.maxSignalsPerDay) {
      addRejection("MAX_DAILY_SIGNALS_REACHED", `${local.date} already reached its daily signal limit.`, index, direction);
      continue;
    }

    let confirmationIndex = -1;
    const lastConfirmationIndex = Math.min(candles.length - 1, index + CONFIG.maxPullbackCandles);
    for (let check = index + 1; check <= lastConfirmationIndex; check++) {
      if (!clockWindowAt(candles[check].timestamp, CONFIG.sessionTimezone, CONFIG.allowedSessions)) break;
      const checkAtr = atr[check];
      if (checkAtr && isConfirmation(candles[check], checkAtr, direction)) {
        confirmationIndex = check;
        break;
      }
    }

    const setupId = `vwap-ema:${local.date}:${sessionName}:${direction}:${index}`;
    if (confirmationIndex < 0) {
      const stillOpen = candles.length - 1 < index + CONFIG.maxPullbackCandles;
      const debug = makeDebug(setupId, direction, sessionName, stillOpen ? "PENDING_CONFIRMATION" : "EXPIRED_CONFIRMATION", stillOpen ? "Waiting for a strong closed continuation candle." : "PULLBACK_EXPIRED", Math.max(0, index + CONFIG.maxPullbackCandles - (candles.length - 1)));
      candidateDebug.push(debug);
      if (stillOpen) pendingCandidates.push(debug);
      else {
        expiredSetups++;
        increment(rejectionCounts, "PULLBACK_EXPIRED");
        rejectedSetups.push(toRejected(setupId, direction, index, "PULLBACK_EXPIRED", "No valid confirmation closed within the pullback window.", debug));
      }
      continue;
    }
    confirmationCandlesFound++;
    const confirmation = candles[confirmationIndex];
    const currentAtr = atr[confirmationIndex] ?? values.atr;
    const pullbackSlice = candles.slice(index, confirmationIndex + 1);
    const swingExtreme = direction === "BUY"
      ? Math.min(...pullbackSlice.map((candle) => candle.low))
      : Math.max(...pullbackSlice.map((candle) => candle.high));
    const entry = confirmation.close;
    const stopLoss = direction === "BUY"
      ? swingExtreme - currentAtr * CONFIG.slAtrBuffer
      : swingExtreme + currentAtr * CONFIG.slAtrBuffer;
    const risk = direction === "BUY" ? entry - stopLoss : stopLoss - entry;
    if (!(risk > 0) || risk > currentAtr * CONFIG.maxSlAtrMultiple) {
      addRejection("INVALID_STOP_LOSS", `Stop risk ${risk.toFixed(3)} is outside the allowed ATR risk.`, index, direction);
      continue;
    }
    const target = findTarget(candles, confirmationIndex, direction, entry, risk);
    const reward = direction === "BUY" ? target.price - entry : entry - target.price;
    const rr = reward / risk;
    if (!Number.isFinite(rr) || rr < CONFIG.minRR) {
      addRejection("RR_BELOW_MINIMUM", `RR ${rr.toFixed(2)} is below ${CONFIG.minRR.toFixed(2)}.`, index, direction);
      continue;
    }
    const scoreParts = scoreSetup(candles[confirmationIndex], values, slope, direction, touch, rr);
    const score = Object.values(scoreParts).reduce((sum, value) => sum + value, 0);
    if (score < CONFIG.minSignalScore) {
      addRejection("SIGNAL_SCORE_TOO_LOW", `Signal score ${score} is below ${CONFIG.minSignalScore}.`, index, direction);
      continue;
    }

    const signal = buildSignal({ input, candles, direction, sessionName, pullbackIndex: index, confirmationIndex, entry, stopLoss, target: target.price, risk, reward, rr, score, scoreParts, values: indicatorValues(confirmationIndex, ema20, ema50, ema200, atr, vwap) ?? values, slope, touch, volumeProxyUsed: vwap[confirmationIndex]?.usedVolumeProxy ?? false, fixedTarget: target.fixed });
    signals.push(signal);
    sessionSignalCounts.set(sessionKey, (sessionSignalCounts.get(sessionKey) ?? 0) + 1);
    daySignalCounts.set(local.date, (daySignalCounts.get(local.date) ?? 0) + 1);
    candidateDebug.push(makeDebug(setupId, direction, sessionName, "CONFIRMED", "Accepted", 0, score, rr));
    index = confirmationIndex;
  }

  function addRejection(code: SignalRejectionCode, reason: string, index: number, direction: Direction): void {
    increment(rejectionCounts, code);
    const sessionName = clockWindowAt(candles[index].timestamp, CONFIG.sessionTimezone, CONFIG.allowedSessions) ?? "OUTSIDE";
    const setupId = `vwap-ema:${candles[index].timestamp}:${direction}:${code}`;
    const debug = makeDebug(setupId, direction, sessionName, "REJECTED", reason, 0);
    candidateDebug.push(debug);
    rejectedSetups.push(toRejected(setupId, direction, index, code, reason, debug));
  }

  const generationTimeMs = performance.now() - started;
  const topRejectionReasons = rejectionRows(rejectionCounts);
  const audit = makeAudit({ candles: candles.length, signals, rejectedSetups, pendingCandidates, generationTimeMs, sessionCandles, bullishRegimeCandles, bearishRegimeCandles, neutralRegimeCandles, pullbacksFound, validPullbacks, confirmationCandlesFound, expiredSetups, topRejectionReasons, candidateDebug });
  const result: EntryEngineResult = {
    signals,
    activeSignals: signals,
    signalMap: new Map(signals.map((signal) => [signal.id, signal])),
    pendingCandidates,
    candidateDebug,
    rejectedSetups,
    noTrade: signals.length ? null : {
      status: "NO_TRADE",
      checkedSetups: pullbacksFound,
      rejectionReasons: topRejectionReasons.map((row) => row.reason),
      message: pendingCandidates.length ? "VWAP/EMA setup is still forming." : "No confirmed VWAP/EMA pullback signal found.",
      nearestPossibleSetup: pendingCandidates.at(-1)?.setupId ?? null,
      requiredForSignal: ["Directional VWAP/EMA regime", "EMA-zone pullback", "Closed continuation candle", "Minimum 1.5R"],
      timestamp: candles.at(-1)?.timestamp ?? null,
    },
    audit,
  };
  if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value ?? "");
  resultCache.set(key, result);
  return result;
}

type Values = { ema20: number; ema50: number; ema200: number; atr: number; vwap: number };

function indicatorValues(index: number, ema20: Array<number | null>, ema50: Array<number | null>, ema200: Array<number | null>, atr: Array<number | null>, vwap: ReturnType<typeof calculateSessionVWAP>): Values | null {
  const values = { ema20: ema20[index], ema50: ema50[index], ema200: ema200[index], atr: atr[index], vwap: vwap[index]?.value };
  return Object.values(values).every((value) => value !== null && Number.isFinite(value)) ? values as Values : null;
}

function classifyRegime(candle: Candle, values: Values, slope: number): Regime {
  const tangled = Math.abs(values.ema20 - values.ema50) < values.atr * 0.05;
  const closeToRegime = Math.abs(candle.close - values.ema200) < values.atr * 0.1;
  if (tangled || closeToRegime || values.atr <= Number.EPSILON) return "NEUTRAL";
  if (candle.close > values.vwap && candle.close > values.ema200 && values.ema20 > values.ema50 && slope >= 0) return "BULLISH";
  if (candle.close < values.vwap && candle.close < values.ema200 && values.ema20 < values.ema50 && slope <= 0) return "BEARISH";
  return "NEUTRAL";
}

function pullbackTouch(candle: Candle, ema20: number, ema50: number, atr: number, direction: Direction): "EMA20" | "EMA50" | "EMA_ZONE" | null {
  const tolerance = atr * CONFIG.pullbackZoneAtrBuffer;
  const top = Math.max(ema20, ema50);
  const bottom = Math.min(ema20, ema50);
  if (candle.high >= bottom - tolerance && candle.low <= top + tolerance) {
    if (candle.low <= ema50 + tolerance && candle.high >= ema50 - tolerance) return "EMA50";
    if (candle.low <= ema20 + tolerance && candle.high >= ema20 - tolerance) return "EMA20";
    return "EMA_ZONE";
  }
  const near = direction === "BUY" ? candle.low <= top + tolerance : candle.high >= bottom - tolerance;
  return near ? "EMA_ZONE" : null;
}

function pullbackKeepsRegime(candle: Candle, ema50: number, atr: number, direction: Direction): boolean {
  return direction === "BUY" ? candle.close >= ema50 - atr * 0.35 : candle.close <= ema50 + atr * 0.35;
}

function isConfirmation(candle: Candle, atr: number, direction: Direction): boolean {
  const range = candle.high - candle.low;
  if (range <= 0 || range < atr * CONFIG.minConfirmationAtr) return false;
  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  const closePosition = (candle.close - candle.low) / range;
  return bodyRatio >= CONFIG.confirmationBodyRatio && (direction === "BUY"
    ? candle.close > candle.open && closePosition >= CONFIG.confirmationClosePosition
    : candle.close < candle.open && closePosition <= 1 - CONFIG.confirmationClosePosition);
}

function findTarget(candles: Candle[], index: number, direction: Direction, entry: number, risk: number): { price: number; fixed: boolean } {
  const candidates = candles.slice(Math.max(0, index - 50), index).flatMap((candle) => direction === "BUY" ? [candle.high] : [candle.low]);
  const minimum = risk * CONFIG.minRR;
  const valid = candidates.filter((price) => direction === "BUY" ? price - entry >= minimum : entry - price >= minimum);
  if (valid.length) return { price: direction === "BUY" ? Math.min(...valid) : Math.max(...valid), fixed: false };
  return { price: direction === "BUY" ? entry + minimum : entry - minimum, fixed: true };
}

function scoreSetup(candle: Candle, values: Values, slope: number, direction: Direction, touch: string, rr: number) {
  const range = candle.high - candle.low;
  const bodyRatio = range > 0 ? Math.abs(candle.close - candle.open) / range : 0;
  const regimeQuality = Math.min(25, 20 + Math.round(Math.min(5, Math.abs(candle.close - values.ema200) / values.atr)));
  const vwapAlignment = Math.min(15, 11 + Math.round(Math.min(4, Math.abs(candle.close - values.vwap) / values.atr)));
  const emaStackQuality = Math.min(15, 11 + (Math.abs(slope) > values.atr * 0.03 ? 2 : 0) + ((direction === "BUY" ? values.ema50 > values.ema200 : values.ema50 < values.ema200) ? 2 : 0));
  const pullbackQuality = touch === "EMA50" ? 20 : touch === "EMA20" ? 18 : 16;
  const confirmationCandleQuality = Math.min(15, Math.round(10 + bodyRatio * 5));
  const rrQuality = Math.min(10, Math.round(7 + Math.min(3, rr - CONFIG.minRR)));
  return { regimeQuality, vwapAlignment, emaStackQuality, pullbackQuality, confirmationCandleQuality, rrQuality };
}

function buildSignal(args: {
  input: V2GoldmineInput; candles: Candle[]; direction: Direction; sessionName: string; pullbackIndex: number; confirmationIndex: number;
  entry: number; stopLoss: number; target: number; risk: number; reward: number; rr: number; score: number;
  scoreParts: ReturnType<typeof scoreSetup>; values: Values; slope: number; touch: "EMA20" | "EMA50" | "EMA_ZONE"; volumeProxyUsed: boolean; fixedTarget: boolean;
}): TradeSignal {
  const candle = args.candles[args.confirmationIndex];
  const pullback = args.candles[args.pullbackIndex];
  const range = candle.high - candle.low;
  const bodyRatio = range > 0 ? Math.abs(candle.close - candle.open) / range : 0;
  const closePosition = range > 0 ? (candle.close - candle.low) / range : 0;
  const session = toTradingSession(args.sessionName);
  const scoreBreakdown: SignalScoreBreakdown = {
    phase4Setup: args.scoreParts.regimeQuality,
    contextAlignment: args.scoreParts.vwapAlignment + args.scoreParts.emaStackQuality,
    confirmationCandle: args.scoreParts.confirmationCandleQuality,
    stopLossQuality: args.scoreParts.pullbackQuality,
    targetQuality: args.scoreParts.rrQuality,
    sessionQuality: 0,
    volatilityQuality: 0,
    antiReversal: 0,
  };
  return {
    id: `${VWAP_EMA_STRATEGY_ID}:${args.input.symbol}:${candle.timestamp}:${args.direction}`,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: VWAP_EMA_STRATEGY_ID,
    v2Direction: args.direction,
    type: args.direction === "BUY" ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
    direction: args.direction === "BUY" ? "BULLISH" : "BEARISH",
    status: "CONFIRMED",
    sourceSetupId: `vwap-ema:${pullback.timestamp}:${args.direction}`,
    setupType: "TREND_CONTINUATION",
    strategyModel: VWAP_EMA_STRATEGY_LABEL,
    mode: "NORMAL_SCALP",
    timestamp: candle.timestamp,
    candleIndex: args.confirmationIndex,
    confirmedAtIndex: args.confirmationIndex,
    timeframe: args.input.timeframe,
    session,
    entryPrice: round(args.entry), stopLoss: round(args.stopLoss), takeProfit: round(args.target), takeProfit2: null, takeProfit3: null,
    riskPoints: round(args.risk), rewardPoints: round(args.reward), rr: round(args.rr, 3), score: args.score,
    confidence: confidenceFor(args.score),
    positionSizeSuggestion: round((args.input.settings?.maxRiskAmount ?? 100) / args.risk, 4),
    maxRiskAmount: args.input.settings?.maxRiskAmount ?? 100,
    invalidationLevel: round(args.stopLoss),
    reasons: [`${args.sessionName} ${args.direction.toLowerCase()} regime aligned with session VWAP and EMA 200.`, `${args.touch} pullback held the EMA trend zone.`, "A strong closed continuation candle confirmed entry."],
    warnings: [...(args.volumeProxyUsed ? ["VWAP_VOLUME_PROXY_USED"] : []), ...(Math.abs(args.slope) < args.values.atr * 0.03 ? ["EMA_50_SLOPE_WEAK"] : []), ...(args.fixedTarget ? ["TARGET_USING_FIXED_RR"] : [])],
    rejectionReasons: [], relatedMarkers: [],
    noRepaintProof: { status: "PASS", signalIndex: args.confirmationIndex, latestAllowedCandleIndex: args.confirmationIndex, usedMarkerIndexes: [args.pullbackIndex, args.confirmationIndex], usedContextCloseTimes: [], usedSetupId: `vwap-ema:${pullback.timestamp}:${args.direction}`, passed: true, lastAvailableIndex: args.confirmationIndex, maxEvidenceIndex: args.confirmationIndex, message: "VWAP/EMA signal uses only closed candles through confirmation; entry, SL, TP, and RR are immutable." },
    stopLossDetail: { price: round(args.stopLoss), source: "PULLBACK_SWING_ATR_BUFFER", buffer: round(args.values.atr * CONFIG.slAtrBuffer), riskPoints: round(args.risk), reason: "Stop is beyond the pullback swing with ATR buffer." },
    takeProfitDetail: { tp1: round(args.target), tp2: null, tp3: null, source: args.fixedTarget ? "FIXED_1_5R_FALLBACK" : "RECENT_LIQUIDITY", rewardPoints: round(args.reward), reason: args.fixedTarget ? "No qualifying historical liquidity target; fixed minimum-RR target used." : "Nearest qualifying historical liquidity target." },
    scoreBreakdown,
    vwapEma: {
      stage: "CONFIRMED_SIGNAL", sessionName: args.sessionName,
      indicators: { ema20: args.values.ema20, ema50: args.values.ema50, ema200: args.values.ema200, atr: args.values.atr, sessionVwap: args.values.vwap },
      regime: { direction: args.direction === "BUY" ? "BULLISH" : "BEARISH", priceVsVwap: candle.close - args.values.vwap, priceVsEma200: candle.close - args.values.ema200, emaStack: `${args.values.ema20.toFixed(2)} / ${args.values.ema50.toFixed(2)} / ${args.values.ema200.toFixed(2)}`, ema50Slope: args.slope },
      pullback: { pullbackStartedAt: pullback.timestamp, pullbackConfirmedAt: candle.timestamp, candleIndex: args.pullbackIndex, touchedEma: args.touch, pullbackLow: pullback.low, pullbackHigh: pullback.high },
      confirmation: { candleTime: candle.timestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close, bodyRatio, closePosition, rangeAtrMultiple: range / args.values.atr },
    },
    immutable: true,
  };
}

function makeDebug(setupId: string, direction: Direction, session: string, status: SignalCandidateDebug["confirmationStatus"], reason: string, remaining: number, score: number | null = null, rr: number | null = null): SignalCandidateDebug {
  return { setupId, engine: ACTIVE_SIGNAL_ENGINE, strategyId: VWAP_EMA_STRATEGY_ID, setupScore: 0, requiredSetupScore: 0, finalSignalScore: score, requiredSignalScore: CONFIG.minSignalScore, signalScore: score, rr, requiredRR: CONFIG.minRR, directionBias: direction === "BUY" ? "BULLISH" : "BEARISH", session, confirmationStatus: status, confirmationWindowRemaining: remaining, rejectionReason: reason, nextRequiredAction: status === "PENDING_CONFIRMATION" ? "Wait for a closed continuation candle." : status === "CONFIRMED" ? "Use immutable trade levels." : "Wait for a new regime and pullback." };
}

function toRejected(setupId: string, direction: Direction, index: number, code: SignalRejectionCode, reason: string, debug: SignalCandidateDebug): RejectedSetup {
  return { setupId, setupType: "TREND_CONTINUATION", setupState: code === "PULLBACK_EXPIRED" ? "EXPIRED" : "INVALIDATED", direction: direction === "BUY" ? "BULLISH" : "BEARISH", triggerIndex: index, rejectionReasons: [reason], rejectionReasonCodes: [code], debug };
}

function makeAudit(args: { candles: number; signals: TradeSignal[]; rejectedSetups: RejectedSetup[]; pendingCandidates: SignalCandidateDebug[]; generationTimeMs: number; sessionCandles: number; bullishRegimeCandles: number; bearishRegimeCandles: number; neutralRegimeCandles: number; pullbacksFound: number; validPullbacks: number; confirmationCandlesFound: number; expiredSetups: number; topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>; candidateDebug: SignalCandidateDebug[] }): EntryEngineResult["audit"] {
  return {
    activeEngine: ACTIVE_SIGNAL_ENGINE, strategyId: VWAP_EMA_STRATEGY_ID, activeMode: "NORMAL_SCALP", minimumScoreRequired: CONFIG.minSignalScore, minimumSetupScoreRequired: 0, minimumSignalScoreRequired: CONFIG.minSignalScore, minimumRrRequired: CONFIG.minRR,
    totalCandlesScanned: args.candles, totalMarkersGenerated: 0, totalContextsGenerated: 0, totalPhase4Setups: 0, watchCount: args.pendingCandidates.length, setupCount: args.pullbacksFound, invalidatedCount: args.rejectedSetups.length, expiredCount: args.expiredSetups, totalSetupsScanned: args.pullbacksFound, triggerSetupsFound: args.validPullbacks, pendingConfirmationCount: args.pendingCandidates.length, expiredConfirmationCount: args.expiredSetups, invalidatedCandidateCount: args.rejectedSetups.length,
    confirmedBuyCount: args.signals.filter((signal) => signal.direction === "BULLISH").length, confirmedSellCount: args.signals.filter((signal) => signal.direction === "BEARISH").length, rapidBuyCount: 0, rapidSellCount: 0, rapidSignalCount: 0, rejectedSetupCount: args.rejectedSetups.length,
    lastRejectionReason: args.rejectedSetups.at(-1)?.rejectionReasons[0] ?? null, lastConfirmedSignal: args.signals.at(-1)?.id ?? null, topRejectionReasons: args.topRejectionReasons.map(({ reason, count }) => ({ reason, count })), lastFiveTriggerSetups: args.candidateDebug.slice(-5).map((item) => item.setupId), lastFiveConfirmedSignals: args.signals.slice(-5).map((signal) => signal.id), noSignalMessage: args.signals.length ? null : "No confirmed VWAP/EMA pullback signal.", noRepaintWarnings: [], rrCalculation: args.signals.at(-1) ? `${args.signals.at(-1)!.rr.toFixed(2)}R` : null, stopLossSource: args.signals.at(-1)?.stopLossDetail.source ?? null, takeProfitSource: args.signals.at(-1)?.takeProfitDetail.source ?? null, scoreBreakdown: args.signals.at(-1)?.scoreBreakdown ?? null, lastCandidateDebug: args.candidateDebug.at(-1) ?? null, noRepaintValidation: "PASS", calculationTimeMs: args.generationTimeMs, generationTimeMs: args.generationTimeMs, cacheStatus: "miss",
    v2VwapEma: { activeEngineLabel: VWAP_EMA_STRATEGY_LABEL, strategyId: VWAP_EMA_STRATEGY_ID, candlesScanned: args.candles, sessionCandles: args.sessionCandles, bullishRegimeCandles: args.bullishRegimeCandles, bearishRegimeCandles: args.bearishRegimeCandles, neutralRegimeCandles: args.neutralRegimeCandles, pullbacksFound: args.pullbacksFound, validPullbacks: args.validPullbacks, confirmationCandlesFound: args.confirmationCandlesFound, confirmedSignals: args.signals.length, rejectedSignals: args.rejectedSetups.length, expiredSetups: args.expiredSetups, generationTimeMs: args.generationTimeMs, topRejectionReasons: args.topRejectionReasons },
  };
}

function rejectionRows(counts: Map<string, number>) {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return [...counts.entries()].map(([reason, count]) => ({ reason, count, percentage: total ? Math.round(count / total * 1000) / 10 : 0 })).sort((a, b) => b.count - a.count);
}
function increment(map: Map<string, number>, key: string) { map.set(key, (map.get(key) ?? 0) + 1); }
function cloneResult(result: EntryEngineResult, cacheStatus: "hit" | "miss"): EntryEngineResult { return { ...result, signalMap: new Map(result.signalMap), audit: { ...result.audit, cacheStatus } }; }
function toTradingSession(session: string): TradingSession { return session === "LONDON" ? "LONDON" : session === "OVERLAP" ? "LONDON_NEW_YORK_OVERLAP" : "NEW_YORK"; }
function confidenceFor(score: number): TradeSignal["confidence"] { return score >= 90 ? "PREMIUM" : score >= 78 ? "STRONG" : score >= 65 ? "MODERATE" : "LOW_CONFIRMED"; }
function round(value: number, digits = 5) { const factor = 10 ** digits; return Math.round((value + Number.EPSILON) * factor) / factor; }
