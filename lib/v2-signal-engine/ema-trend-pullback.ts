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
import {
  ACTIVE_SIGNAL_ENGINE,
  EMA_TREND_PULLBACK_CONFIG as CONFIG,
  EMA_TREND_PULLBACK_STRATEGY_ID,
  EMA_TREND_PULLBACK_STRATEGY_LABEL,
} from "./config";
import { calculateATR, calculateEMA, calculateSlope, clockWindowAt, zonedDateParts } from "./indicators";
import type { V2GoldmineInput } from "./types";

type Direction = "BUY" | "SELL";
type TrendDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
type EmaTouch = "EMA20" | "EMA50" | "EMA_ZONE";
type Stage =
  | "TREND_CONFIRMED"
  | "WAITING_PULLBACK"
  | "PULLBACK_DETECTED"
  | "WAITING_CONFIRMATION"
  | "CONFIRMED_SIGNAL"
  | "REJECTED"
  | "EXPIRED";

type Values = {
  ema20: number;
  ema50: number;
  ema200: number;
  atr: number;
  ema50Slope: number;
  priceDistanceFromEmaAtr: number;
};

type TrendResult = {
  direction: TrendDirection;
  code?: SignalRejectionCode;
  warnings: string[];
  strengthAtr: number;
  choppyCrosses: number;
};

type ScoreParts = {
  trendQuality: number;
  emaStackQuality: number;
  pullbackQuality: number;
  confirmationQuality: number;
  rrQuality: number;
  sessionQuality: number;
};

const resultCache = new Map<string, EntryEngineResult>();
const SLOPE_LOOKBACK = 5;
const CHOP_LOOKBACK = 12;

export function clearEmaTrendPullbackCache(): void {
  resultCache.clear();
}

export function generateEmaTrendPullbackSignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const candles = input.candles.filter((candle) => candle.isClosed);
  const key = `${EMA_TREND_PULLBACK_STRATEGY_ID}:${input.symbol}:${input.timeframe}:${candles.length}:${candles.at(-1)?.timestamp ?? 0}:${input.settings?.maxRiskAmount ?? 100}`;
  const cached = resultCache.get(key);
  if (cached) return cloneResult(cached, "hit");

  const ema20 = calculateEMA(candles, CONFIG.emaFastPeriod);
  const ema50 = calculateEMA(candles, CONFIG.emaMidPeriod);
  const ema200 = calculateEMA(candles, CONFIG.emaSlowPeriod);
  const ema50Slope = calculateSlope(ema50, SLOPE_LOOKBACK);
  const atr = calculateATR(candles, CONFIG.atrPeriod);
  const signals: TradeSignal[] = [];
  const pendingCandidates: SignalCandidateDebug[] = [];
  const candidateDebug: SignalCandidateDebug[] = [];
  const rejectedSetups: RejectedSetup[] = [];
  const rejectionCounts = new Map<string, number>();
  const sessionSignalCounts = new Map<string, number>();
  const daySignalCounts = new Map<string, number>();
  let sessionCandles = 0;
  let bullishTrendCandles = 0;
  let bearishTrendCandles = 0;
  let neutralTrendCandles = 0;
  let pullbacksFound = 0;
  let validPullbacks = 0;
  let confirmationCandlesFound = 0;
  let expiredSetups = 0;

  if (candles.length < CONFIG.emaSlowPeriod) {
    increment(rejectionCounts, "INSUFFICIENT_CANDLES_FOR_EMA");
  }

  const firstIndex = Math.max(CONFIG.emaSlowPeriod - 1, CONFIG.atrPeriod - 1, SLOPE_LOOKBACK);
  for (let index = firstIndex; index < candles.length; index++) {
    const sessionName = sessionNameAt(candles[index].timestamp);
    if (CONFIG.requireSession && !sessionName) {
      increment(rejectionCounts, "OUTSIDE_ALLOWED_SESSION");
      continue;
    }
    if (!sessionName) continue;
    sessionCandles++;

    const values = indicatorValues(index, ema20, ema50, ema200, atr, ema50Slope, candles[index]);
    if (!values) {
      increment(rejectionCounts, "INSUFFICIENT_CANDLES_FOR_EMA");
      continue;
    }

    const trend = classifyTrend(candles, index, values, ema20, ema50);
    if (trend.direction === "BULLISH") bullishTrendCandles++;
    else if (trend.direction === "BEARISH") bearishTrendCandles++;
    else {
      neutralTrendCandles++;
      increment(rejectionCounts, trend.code ?? "NO_CLEAR_TREND");
      if (index === candles.length - 1) {
        candidateDebug.push(makeDebug(`ema-trend:${candles[index].timestamp}:trend`, "BUY", sessionName, "REJECTED", trend.code ?? "NO_CLEAR_TREND", 0, "REJECTED"));
      }
      continue;
    }

    const direction: Direction = trend.direction === "BULLISH" ? "BUY" : "SELL";
    const touch = pullbackTouch(candles[index], values);
    if (!touch) {
      if (index === candles.length - 1) {
        const debug = makeDebug(
          `ema-trend:${candles[index].timestamp}:${direction}:waiting-pullback`,
          direction,
          sessionName,
          "PENDING_CONFIRMATION",
          "NO_VALID_PULLBACK",
          CONFIG.maxPullbackCandles,
          "WAITING_PULLBACK",
        );
        candidateDebug.push(debug);
        pendingCandidates.push(debug);
      }
      continue;
    }
    pullbacksFound++;

    if (!pullbackKeepsTrend(candles[index], values, direction)) {
      addRejection("PULLBACK_BROKE_TREND", index, direction, sessionName);
      continue;
    }
    validPullbacks++;

    const local = zonedDateParts(candles[index].timestamp, CONFIG.allowedSessions[0].timezone);
    const sessionKey = `${local.date}:${sessionName}`;
    if ((sessionSignalCounts.get(sessionKey) ?? 0) >= CONFIG.maxSignalsPerSession) {
      addRejection("MAX_SESSION_SIGNALS_REACHED", index, direction, sessionName);
      continue;
    }
    if ((daySignalCounts.get(local.date) ?? 0) >= CONFIG.maxSignalsPerDay) {
      addRejection("MAX_DAILY_SIGNALS_REACHED", index, direction, sessionName);
      continue;
    }

    let confirmationIndex = -1;
    let sawWeakConfirmation = false;
    const lastConfirmationIndex = Math.min(candles.length - 1, index + CONFIG.maxPullbackCandles);
    for (let check = index + 1; check <= lastConfirmationIndex; check++) {
      const checkSession = sessionNameAt(candles[check].timestamp);
      if (CONFIG.requireSession && !checkSession) break;
      const checkValues = indicatorValues(check, ema20, ema50, ema200, atr, ema50Slope, candles[check]);
      if (!checkValues) continue;
      if (isConfirmation(candles[check], checkValues, direction)) {
        confirmationIndex = check;
        break;
      }
      if (isDirectionalCandle(candles[check], direction)) sawWeakConfirmation = true;
    }

    const setupId = `ema-trend:${local.date}:${sessionName}:${direction}:${index}`;
    if (confirmationIndex < 0) {
      const stillOpen = candles.length - 1 < index + CONFIG.maxPullbackCandles;
      if (sawWeakConfirmation && !stillOpen) increment(rejectionCounts, "WEAK_CONFIRMATION_CANDLE");
      const debug = makeDebug(
        setupId,
        direction,
        sessionName,
        stillOpen ? "PENDING_CONFIRMATION" : "EXPIRED_CONFIRMATION",
        stillOpen ? "WEAK_CONFIRMATION_CANDLE" : "PULLBACK_EXPIRED",
        Math.max(0, index + CONFIG.maxPullbackCandles - (candles.length - 1)),
        stillOpen ? "WAITING_CONFIRMATION" : "EXPIRED",
      );
      candidateDebug.push(debug);
      if (stillOpen) pendingCandidates.push(debug);
      else {
        expiredSetups++;
        increment(rejectionCounts, "PULLBACK_EXPIRED");
        rejectedSetups.push(toRejected(setupId, direction, index, "PULLBACK_EXPIRED", debug));
      }
      continue;
    }

    confirmationCandlesFound++;
    const confirmationValues = indicatorValues(confirmationIndex, ema20, ema50, ema200, atr, ema50Slope, candles[confirmationIndex]) ?? values;
    const confirmation = candles[confirmationIndex];
    const pullbackSlice = candles.slice(index, confirmationIndex + 1);
    const swingExtreme = direction === "BUY"
      ? Math.min(...pullbackSlice.map((candle) => candle.low))
      : Math.max(...pullbackSlice.map((candle) => candle.high));
    const entry = confirmation.close;
    const stopLoss = direction === "BUY"
      ? swingExtreme - confirmationValues.atr * CONFIG.slAtrBuffer
      : swingExtreme + confirmationValues.atr * CONFIG.slAtrBuffer;
    const risk = direction === "BUY" ? entry - stopLoss : stopLoss - entry;
    if (!(risk > 0) || risk > confirmationValues.atr * CONFIG.maxSlAtrMultiple) {
      addRejection("INVALID_STOP_LOSS", index, direction, sessionName);
      continue;
    }

    const target = findTarget(candles, confirmationIndex, direction, entry, risk);
    const reward = direction === "BUY" ? target.price - entry : entry - target.price;
    if (!Number.isFinite(target.price) || !(reward > 0)) {
      addRejection("INVALID_TAKE_PROFIT", index, direction, sessionName);
      continue;
    }
    const rr = reward / risk;
    if (!Number.isFinite(rr) || rr < CONFIG.minRR) {
      addRejection("RR_BELOW_MINIMUM", index, direction, sessionName);
      continue;
    }

    const warnings = buildWarnings(trend, values, confirmationValues, touch, target.fixed, candles, index);
    const scoreParts = scoreSetup(candles[confirmationIndex], confirmationValues, direction, touch, rr, trend);
    const score = Object.values(scoreParts).reduce((sum, value) => sum + value, 0);
    if (score < CONFIG.minSignalScore) {
      addRejection("SIGNAL_SCORE_TOO_LOW", index, direction, sessionName);
      continue;
    }

    const signal = buildSignal({
      input,
      candles,
      direction,
      sessionName,
      pullbackIndex: index,
      confirmationIndex,
      entry,
      stopLoss,
      target: target.price,
      risk,
      reward,
      rr,
      score,
      scoreParts,
      values: confirmationValues,
      trend,
      touch,
      warnings,
      fixedTarget: target.fixed,
    });
    signals.push(signal);
    sessionSignalCounts.set(sessionKey, (sessionSignalCounts.get(sessionKey) ?? 0) + 1);
    daySignalCounts.set(local.date, (daySignalCounts.get(local.date) ?? 0) + 1);
    candidateDebug.push(makeDebug(setupId, direction, sessionName, "CONFIRMED", "CONFIRMED_SIGNAL", 0, "CONFIRMED_SIGNAL", score, rr));
    index = confirmationIndex;
  }

  function addRejection(code: SignalRejectionCode, index: number, direction: Direction, sessionName: string): void {
    increment(rejectionCounts, code);
    const setupId = `ema-trend:${candles[index].timestamp}:${direction}:${code}`;
    const debug = makeDebug(setupId, direction, sessionName, "REJECTED", code, 0, "REJECTED");
    candidateDebug.push(debug);
    rejectedSetups.push(toRejected(setupId, direction, index, code, debug));
  }

  const generationTimeMs = performance.now() - started;
  const topRejectionReasons = rejectionRows(rejectionCounts);
  const audit = makeAudit({
    candles: candles.length,
    signals,
    rejectedSetups,
    pendingCandidates,
    generationTimeMs,
    sessionCandles,
    bullishTrendCandles,
    bearishTrendCandles,
    neutralTrendCandles,
    pullbacksFound,
    validPullbacks,
    confirmationCandlesFound,
    expiredSetups,
    topRejectionReasons,
    candidateDebug,
  });
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
      message: pendingCandidates.length ? "EMA trend pullback setup is still forming." : "No confirmed EMA trend pullback signal found.",
      nearestPossibleSetup: pendingCandidates.at(-1)?.setupId ?? null,
      requiredForSignal: ["EMA 20 / 50 / 200 trend alignment", "Pullback into EMA 20 / EMA 50 zone", "Closed continuation confirmation", "Minimum 1.5R"],
      timestamp: candles.at(-1)?.timestamp ?? null,
    },
    audit,
  };
  if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value ?? "");
  resultCache.set(key, result);
  return result;
}

function indicatorValues(
  index: number,
  ema20: Array<number | null>,
  ema50: Array<number | null>,
  ema200: Array<number | null>,
  atr: Array<number | null>,
  ema50Slope: Array<number | null>,
  candle: Candle,
): Values | null {
  const base = { ema20: ema20[index], ema50: ema50[index], ema200: ema200[index], atr: atr[index], ema50Slope: ema50Slope[index] };
  if (!Object.values(base).every((value) => value !== null && Number.isFinite(value))) return null;
  const typed = base as Omit<Values, "priceDistanceFromEmaAtr">;
  return {
    ...typed,
    priceDistanceFromEmaAtr: distanceFromEmaZone(candle.close, typed.ema20, typed.ema50) / typed.atr,
  };
}

function classifyTrend(
  candles: Candle[],
  index: number,
  values: Values,
  ema20: Array<number | null>,
  ema50: Array<number | null>,
): TrendResult {
  if (values.atr <= Number.EPSILON) return { direction: "NEUTRAL", code: "NO_CLEAR_TREND", warnings: ["ATR_LOW"], strengthAtr: 0, choppyCrosses: 0 };
  const emaSpreadAtr = Math.abs(values.ema20 - values.ema50) / values.atr;
  const slowSpreadAtr = Math.abs(values.ema50 - values.ema200) / values.atr;
  const choppyCrosses = recentZoneCrosses(candles, index, ema20, ema50);
  if (emaSpreadAtr < 0.05 || slowSpreadAtr < 0.05 || choppyCrosses >= 4) {
    return { direction: "NEUTRAL", code: "EMA_TANGLED_CHOPPY", warnings: ["RECENT_CHOPPY_PRICE_ACTION"], strengthAtr: 0, choppyCrosses };
  }
  if (values.priceDistanceFromEmaAtr > CONFIG.maxEmaDistanceAtr) {
    return { direction: "NEUTRAL", code: "PRICE_TOO_EXTENDED_FROM_EMA", warnings: [], strengthAtr: 0, choppyCrosses };
  }
  const trendStrengthAtr = Math.abs(values.ema50Slope * SLOPE_LOOKBACK) / values.atr;
  if (trendStrengthAtr < CONFIG.minTrendStrengthAtr) {
    return { direction: "NEUTRAL", code: "NO_CLEAR_TREND", warnings: ["EMA_50_SLOPE_WEAK"], strengthAtr: trendStrengthAtr, choppyCrosses };
  }

  const warnings = [
    ...(trendStrengthAtr < CONFIG.minTrendStrengthAtr * 1.5 ? ["EMA_50_SLOPE_WEAK"] : []),
    ...(choppyCrosses >= 2 ? ["RECENT_CHOPPY_PRICE_ACTION"] : []),
    ...(values.atr < 0.05 ? ["ATR_LOW"] : []),
  ];
  if (values.ema20 > values.ema50 && values.ema50 > values.ema200 && candles[index].close > values.ema50 && values.ema50Slope >= 0) {
    return { direction: "BULLISH", warnings, strengthAtr: trendStrengthAtr, choppyCrosses };
  }
  if (values.ema20 < values.ema50 && values.ema50 < values.ema200 && candles[index].close < values.ema50 && values.ema50Slope <= 0) {
    return { direction: "BEARISH", warnings, strengthAtr: trendStrengthAtr, choppyCrosses };
  }
  return { direction: "NEUTRAL", code: "NO_CLEAR_TREND", warnings, strengthAtr: trendStrengthAtr, choppyCrosses };
}

function pullbackTouch(candle: Candle, values: Values): EmaTouch | null {
  const tolerance = values.atr * CONFIG.pullbackZoneAtrBuffer;
  const top = Math.max(values.ema20, values.ema50);
  const bottom = Math.min(values.ema20, values.ema50);
  const intersectsZone = candle.low <= top + tolerance && candle.high >= bottom - tolerance;
  if (!intersectsZone) return null;
  if (candle.low <= values.ema50 + tolerance && candle.high >= values.ema50 - tolerance) return "EMA50";
  if (candle.low <= values.ema20 + tolerance && candle.high >= values.ema20 - tolerance) return "EMA20";
  return "EMA_ZONE";
}

function pullbackKeepsTrend(candle: Candle, values: Values, direction: Direction): boolean {
  if (direction === "BUY") {
    return candle.close >= values.ema50 - values.atr * 0.35 && candle.low > values.ema200 - values.atr * 0.2;
  }
  return candle.close <= values.ema50 + values.atr * 0.35 && candle.high < values.ema200 + values.atr * 0.2;
}

function isConfirmation(candle: Candle, values: Values, direction: Direction): boolean {
  const range = candle.high - candle.low;
  if (range <= 0 || range < values.atr * CONFIG.minConfirmationRangeAtr) return false;
  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  const closePosition = (candle.close - candle.low) / range;
  return bodyRatio >= CONFIG.confirmationBodyRatio && (direction === "BUY"
    ? candle.close > candle.open && candle.close > values.ema20 && closePosition >= CONFIG.confirmationClosePosition
    : candle.close < candle.open && candle.close < values.ema20 && closePosition <= 1 - CONFIG.confirmationClosePosition);
}

function isDirectionalCandle(candle: Candle, direction: Direction): boolean {
  return direction === "BUY" ? candle.close > candle.open : candle.close < candle.open;
}

function findTarget(candles: Candle[], index: number, direction: Direction, entry: number, risk: number): { price: number; fixed: boolean } {
  const candidates = candles.slice(Math.max(0, index - 50), index).flatMap((candle) => direction === "BUY" ? [candle.high] : [candle.low]);
  const directionalTargets = candidates.filter((price) => direction === "BUY" ? price > entry : price < entry);
  if (directionalTargets.length) {
    return { price: direction === "BUY" ? Math.min(...directionalTargets) : Math.max(...directionalTargets), fixed: false };
  }
  const minimum = risk * CONFIG.minRR;
  return { price: direction === "BUY" ? entry + minimum : entry - minimum, fixed: true };
}

function scoreSetup(candle: Candle, values: Values, direction: Direction, touch: EmaTouch, rr: number, trend: TrendResult): ScoreParts {
  const range = candle.high - candle.low;
  const bodyRatio = range > 0 ? Math.abs(candle.close - candle.open) / range : 0;
  const closePosition = range > 0 ? (candle.close - candle.low) / range : 0.5;
  const trendQuality = Math.min(25, 17 + Math.round(Math.min(6, trend.strengthAtr * 10)) + (trend.warnings.includes("EMA_50_SLOPE_WEAK") ? 0 : 2));
  const emaStackQuality = Math.min(20, 14 + Math.round(Math.min(6, Math.abs(values.ema50 - values.ema200) / values.atr)));
  const pullbackQuality = touch === "EMA50" ? 20 : touch === "EMA20" ? 18 : 16;
  const directionalCloseQuality = direction === "BUY" ? closePosition : 1 - closePosition;
  const confirmationQuality = Math.min(20, Math.round(8 + bodyRatio * 7 + directionalCloseQuality * 5));
  const rrQuality = Math.min(10, Math.round(7 + Math.min(3, (rr - CONFIG.minRR) * 2)));
  return { trendQuality, emaStackQuality, pullbackQuality, confirmationQuality, rrQuality, sessionQuality: 5 };
}

function buildWarnings(
  trend: TrendResult,
  pullbackValues: Values,
  confirmationValues: Values,
  touch: EmaTouch,
  fixedTarget: boolean,
  candles: Candle[],
  pullbackIndex: number,
): string[] {
  const warnings = new Set<string>(trend.warnings);
  if (fixedTarget) warnings.add("TARGET_USING_FIXED_RR");
  if (touch === "EMA50" && pullbackValues.priceDistanceFromEmaAtr > 0.5) warnings.add("PULLBACK_DEEP");
  if (confirmationValues.atr < 0.05) warnings.add("ATR_LOW");
  if (recentRawCrosses(candles, pullbackIndex) >= 4) warnings.add("RECENT_CHOPPY_PRICE_ACTION");
  return [...warnings];
}

function buildSignal(args: {
  input: V2GoldmineInput;
  candles: Candle[];
  direction: Direction;
  sessionName: string;
  pullbackIndex: number;
  confirmationIndex: number;
  entry: number;
  stopLoss: number;
  target: number;
  risk: number;
  reward: number;
  rr: number;
  score: number;
  scoreParts: ScoreParts;
  values: Values;
  trend: TrendResult;
  touch: EmaTouch;
  warnings: string[];
  fixedTarget: boolean;
}): TradeSignal {
  const candle = args.candles[args.confirmationIndex];
  const pullback = args.candles[args.pullbackIndex];
  const range = candle.high - candle.low;
  const bodyRatio = range > 0 ? Math.abs(candle.close - candle.open) / range : 0;
  const closePosition = range > 0 ? (candle.close - candle.low) / range : 0;
  const session = toTradingSession(args.sessionName);
  const scoreBreakdown: SignalScoreBreakdown = {
    phase4Setup: args.scoreParts.trendQuality,
    contextAlignment: args.scoreParts.emaStackQuality,
    confirmationCandle: args.scoreParts.confirmationQuality,
    stopLossQuality: args.scoreParts.pullbackQuality,
    targetQuality: args.scoreParts.rrQuality,
    sessionQuality: args.scoreParts.sessionQuality,
    volatilityQuality: 0,
    antiReversal: 0,
  };
  return {
    id: `${EMA_TREND_PULLBACK_STRATEGY_ID}:${args.input.symbol}:${candle.timestamp}:${args.direction}`,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: EMA_TREND_PULLBACK_STRATEGY_ID,
    v2Direction: args.direction,
    type: args.direction === "BUY" ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
    direction: args.direction === "BUY" ? "BULLISH" : "BEARISH",
    status: "CONFIRMED",
    sourceSetupId: `ema-trend:${pullback.timestamp}:${args.direction}`,
    setupType: "TREND_CONTINUATION",
    strategyModel: EMA_TREND_PULLBACK_STRATEGY_LABEL,
    mode: "V2_DEFAULT",
    timestamp: candle.timestamp,
    candleIndex: args.confirmationIndex,
    confirmedAtIndex: args.confirmationIndex,
    timeframe: args.input.timeframe,
    session,
    entryPrice: round(args.entry),
    stopLoss: round(args.stopLoss),
    takeProfit: round(args.target),
    takeProfit2: null,
    takeProfit3: null,
    riskPoints: round(args.risk),
    rewardPoints: round(args.reward),
    rr: round(args.rr, 3),
    score: args.score,
    confidence: confidenceFor(args.score),
    positionSizeSuggestion: round((args.input.settings?.maxRiskAmount ?? 100) / args.risk, 4),
    maxRiskAmount: args.input.settings?.maxRiskAmount ?? 100,
    invalidationLevel: round(args.stopLoss),
    reasons: [
      `${args.sessionName} ${args.direction.toLowerCase()} trend aligned EMA 20 / EMA 50 / EMA 200.`,
      `${args.touch} pullback held the EMA trend zone.`,
      "A strong closed continuation candle confirmed entry.",
    ],
    warnings: args.warnings,
    rejectionReasons: [],
    relatedMarkers: [],
    noRepaintProof: {
      status: "PASS",
      signalIndex: args.confirmationIndex,
      latestAllowedCandleIndex: args.confirmationIndex,
      usedMarkerIndexes: [args.pullbackIndex, args.confirmationIndex],
      usedContextCloseTimes: [],
      usedSetupId: `ema-trend:${pullback.timestamp}:${args.direction}`,
      passed: true,
      lastAvailableIndex: args.confirmationIndex,
      maxEvidenceIndex: args.confirmationIndex,
      message: "EMA trend pullback signal uses only closed candles through confirmation; entry, SL, TP, and RR are immutable.",
    },
    stopLossDetail: {
      price: round(args.stopLoss),
      source: "PULLBACK_SWING_ATR_BUFFER",
      buffer: round(args.values.atr * CONFIG.slAtrBuffer),
      riskPoints: round(args.risk),
      reason: "Stop is beyond the pullback swing with ATR buffer.",
    },
    takeProfitDetail: {
      tp1: round(args.target),
      tp2: null,
      tp3: null,
      source: args.fixedTarget ? "FIXED_1_5R_FALLBACK" : "RECENT_LIQUIDITY",
      rewardPoints: round(args.reward),
      reason: args.fixedTarget ? "No recent liquidity target was available; fixed minimum-RR target used." : "Nearest recent liquidity target.",
    },
    scoreBreakdown,
    emaTrendPullback: {
      stage: "CONFIRMED_SIGNAL",
      sessionName: args.sessionName,
      signalTime: candle.timestamp,
      indicators: { ema20: args.values.ema20, ema50: args.values.ema50, ema200: args.values.ema200, atr: args.values.atr },
      trend: {
        direction: args.direction === "BUY" ? "BULLISH" : "BEARISH",
        emaStack: `${args.values.ema20.toFixed(2)} / ${args.values.ema50.toFixed(2)} / ${args.values.ema200.toFixed(2)}`,
        ema50Slope: args.values.ema50Slope,
        priceDistanceFromEmaAtr: args.values.priceDistanceFromEmaAtr,
      },
      pullback: {
        pullbackStartedAt: pullback.timestamp,
        pullbackConfirmedAt: candle.timestamp,
        candleIndex: args.pullbackIndex,
        touchedEma: args.touch,
        pullbackLow: pullback.low,
        pullbackHigh: pullback.high,
      },
      confirmation: {
        candleTime: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        bodyRatio,
        closePosition,
        rangeAtrMultiple: range / args.values.atr,
      },
    },
    immutable: true,
  };
}

function makeDebug(
  setupId: string,
  direction: Direction,
  session: string,
  status: SignalCandidateDebug["confirmationStatus"],
  reason: string,
  remaining: number,
  stage: Stage,
  score: number | null = null,
  rr: number | null = null,
): SignalCandidateDebug {
  return {
    setupId,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: EMA_TREND_PULLBACK_STRATEGY_ID,
    setupScore: 0,
    requiredSetupScore: 0,
    finalSignalScore: score,
    requiredSignalScore: CONFIG.minSignalScore,
    signalScore: score,
    rr,
    requiredRR: CONFIG.minRR,
    directionBias: direction === "BUY" ? "BULLISH" : "BEARISH",
    session,
    confirmationStatus: status,
    confirmationWindowRemaining: remaining,
    rejectionReason: reason,
    nextRequiredAction: stage === "WAITING_PULLBACK"
      ? "Wait for price to pull back into the EMA 20 / EMA 50 zone."
      : stage === "WAITING_CONFIRMATION"
        ? "Wait for a strong closed continuation candle."
        : stage === "CONFIRMED_SIGNAL"
          ? "Use immutable trade levels."
          : "Wait for a new EMA trend pullback setup.",
    failedStage: stage,
  };
}

function toRejected(setupId: string, direction: Direction, index: number, code: SignalRejectionCode, debug: SignalCandidateDebug): RejectedSetup {
  return {
    setupId,
    setupType: "TREND_CONTINUATION",
    setupState: code === "PULLBACK_EXPIRED" ? "EXPIRED" : "INVALIDATED",
    direction: direction === "BUY" ? "BULLISH" : "BEARISH",
    triggerIndex: index,
    rejectionReasons: [code],
    rejectionReasonCodes: [code],
    debug,
  };
}

function makeAudit(args: {
  candles: number;
  signals: TradeSignal[];
  rejectedSetups: RejectedSetup[];
  pendingCandidates: SignalCandidateDebug[];
  generationTimeMs: number;
  sessionCandles: number;
  bullishTrendCandles: number;
  bearishTrendCandles: number;
  neutralTrendCandles: number;
  pullbacksFound: number;
  validPullbacks: number;
  confirmationCandlesFound: number;
  expiredSetups: number;
  topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  candidateDebug: SignalCandidateDebug[];
}): EntryEngineResult["audit"] {
  return {
    activeEngine: ACTIVE_SIGNAL_ENGINE,
    strategyId: EMA_TREND_PULLBACK_STRATEGY_ID,
    activeMode: "V2_DEFAULT",
    minimumScoreRequired: CONFIG.minSignalScore,
    minimumSetupScoreRequired: 0,
    minimumSignalScoreRequired: CONFIG.minSignalScore,
    minimumRrRequired: CONFIG.minRR,
    totalCandlesScanned: args.candles,
    totalMarkersGenerated: 0,
    totalContextsGenerated: 0,
    totalPhase4Setups: 0,
    watchCount: args.pendingCandidates.length,
    setupCount: args.pullbacksFound,
    invalidatedCount: args.rejectedSetups.length,
    expiredCount: args.expiredSetups,
    totalSetupsScanned: args.pullbacksFound,
    triggerSetupsFound: args.validPullbacks,
    pendingConfirmationCount: args.pendingCandidates.length,
    expiredConfirmationCount: args.expiredSetups,
    invalidatedCandidateCount: args.rejectedSetups.length,
    confirmedBuyCount: args.signals.filter((signal) => signal.direction === "BULLISH").length,
    confirmedSellCount: args.signals.filter((signal) => signal.direction === "BEARISH").length,
    rapidBuyCount: 0,
    rapidSellCount: 0,
    rapidSignalCount: 0,
    rejectedSetupCount: args.rejectedSetups.length,
    lastRejectionReason: args.rejectedSetups.at(-1)?.rejectionReasons[0] ?? null,
    lastConfirmedSignal: args.signals.at(-1)?.id ?? null,
    topRejectionReasons: args.topRejectionReasons.map(({ reason, count }) => ({ reason, count })),
    lastFiveTriggerSetups: args.candidateDebug.slice(-5).map((item) => item.setupId),
    lastFiveConfirmedSignals: args.signals.slice(-5).map((signal) => signal.id),
    noSignalMessage: args.signals.length ? null : "No confirmed EMA trend pullback signal.",
    noRepaintWarnings: [],
    rrCalculation: args.signals.at(-1) ? `${args.signals.at(-1)!.rr.toFixed(2)}R` : null,
    stopLossSource: args.signals.at(-1)?.stopLossDetail.source ?? null,
    takeProfitSource: args.signals.at(-1)?.takeProfitDetail.source ?? null,
    scoreBreakdown: args.signals.at(-1)?.scoreBreakdown ?? null,
    lastCandidateDebug: args.candidateDebug.at(-1) ?? null,
    noRepaintValidation: "PASS",
    calculationTimeMs: args.generationTimeMs,
    generationTimeMs: args.generationTimeMs,
    cacheStatus: "miss",
    v2EmaTrendPullback: {
      activeEngineLabel: EMA_TREND_PULLBACK_STRATEGY_LABEL,
      strategyId: EMA_TREND_PULLBACK_STRATEGY_ID,
      candlesScanned: args.candles,
      sessionCandles: args.sessionCandles,
      bullishTrendCandles: args.bullishTrendCandles,
      bearishTrendCandles: args.bearishTrendCandles,
      neutralTrendCandles: args.neutralTrendCandles,
      pullbacksFound: args.pullbacksFound,
      validPullbacks: args.validPullbacks,
      confirmationCandlesFound: args.confirmationCandlesFound,
      confirmedSignals: args.signals.length,
      rejectedSignals: args.rejectedSetups.length,
      expiredSetups: args.expiredSetups,
      generationTimeMs: args.generationTimeMs,
      topRejectionReasons: args.topRejectionReasons,
    },
  };
}

function recentZoneCrosses(candles: Candle[], index: number, ema20: Array<number | null>, ema50: Array<number | null>): number {
  let crosses = 0;
  let previous = 0;
  for (let cursor = Math.max(0, index - CHOP_LOOKBACK); cursor <= index; cursor++) {
    const fast = ema20[cursor];
    const mid = ema50[cursor];
    if (fast === null || mid === null) continue;
    const top = Math.max(fast, mid);
    const bottom = Math.min(fast, mid);
    const state = candles[cursor].close > top ? 1 : candles[cursor].close < bottom ? -1 : 0;
    if (previous !== 0 && state !== 0 && state !== previous) crosses++;
    if (state !== 0) previous = state;
  }
  return crosses;
}

function recentRawCrosses(candles: Candle[], index: number): number {
  let crosses = 0;
  for (let cursor = Math.max(1, index - CHOP_LOOKBACK); cursor <= index; cursor++) {
    const currentBody = candles[cursor].close - candles[cursor].open;
    const previousBody = candles[cursor - 1].close - candles[cursor - 1].open;
    if (currentBody === 0 || previousBody === 0) continue;
    if (Math.sign(currentBody) !== Math.sign(previousBody)) crosses++;
  }
  return crosses;
}

function distanceFromEmaZone(price: number, ema20: number, ema50: number): number {
  const top = Math.max(ema20, ema50);
  const bottom = Math.min(ema20, ema50);
  if (price > top) return price - top;
  if (price < bottom) return bottom - price;
  return 0;
}

function sessionNameAt(timestamp: number): string | null {
  return clockWindowAt(timestamp, CONFIG.allowedSessions[0].timezone, CONFIG.allowedSessions);
}

function rejectionRows(counts: Map<string, number>) {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count, percentage: total ? Math.round((count / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function cloneResult(result: EntryEngineResult, cacheStatus: "hit" | "miss"): EntryEngineResult {
  return { ...result, signalMap: new Map(result.signalMap), audit: { ...result.audit, cacheStatus } };
}

function toTradingSession(session: string): TradingSession {
  return session === "LONDON" ? "LONDON" : session === "OVERLAP" ? "LONDON_NEW_YORK_OVERLAP" : "NEW_YORK";
}

function confidenceFor(score: number): TradeSignal["confidence"] {
  return score >= 90 ? "PREMIUM" : score >= 78 ? "STRONG" : score >= 65 ? "MODERATE" : "LOW_CONFIRMED";
}

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
