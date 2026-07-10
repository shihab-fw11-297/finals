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
  LIQUIDITY_SWEEP_REVERSAL_PRO_CONFIG as CONFIG,
  LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID,
  LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_LABEL,
} from "./config";
import { calculateATR, calculateEMA, clockWindowAt, detectSwingHigh, detectSwingLow, zonedDateParts } from "./indicators";
import type { V2GoldmineInput } from "./types";

type Direction = "BUY" | "SELL";
type LiquidityType = "SSL" | "BSL";
type LiquiditySource = "SWING" | "EQUAL_HIGH_LOW" | "PREVIOUS_DAY" | "SESSION" | "ROUND_NUMBER";
type Stage =
  | "LIQUIDITY_LEVEL_FOUND"
  | "SWEEP_DETECTED"
  | "RECLAIM_CONFIRMED"
  | "WAITING_CONFIRMATION"
  | "CONFIRMED_SIGNAL"
  | "REJECTED"
  | "EXPIRED";

type LiquidityLevel = {
  type: LiquidityType;
  source: LiquiditySource;
  level: number;
  detectedAt: number;
  detectedAtIndex: number;
  quality: number;
};

type SweepSetup = {
  liquidity: LiquidityLevel;
  direction: Direction;
  sweepIndex: number;
  sweepPrice: number;
  sweepDistanceAtr: number;
  atr: number;
};

type EvaluatedSweep = {
  confirmedIndex: number | null;
};

type ScoreParts = {
  liquidityLevelQuality: number;
  sweepQuality: number;
  reclaimQuality: number;
  confirmationQuality: number;
  rrQuality: number;
  sessionQuality: number;
  confluenceBonus: number;
};

const resultCache = new Map<string, EntryEngineResult>();
const SESSION_TIMEZONE = "America/New_York";
const ROUND_NUMBER_STEP = 5;
const CHOP_LOOKBACK = 12;

export function clearLiquiditySweepReversalProCache(): void {
  resultCache.clear();
}

export function generateLiquiditySweepReversalProSignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const candles = input.candles.filter((candle) => candle.isClosed);
  const key = `${LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID}:${input.symbol}:${input.timeframe}:${candles.length}:${candles.at(-1)?.timestamp ?? 0}:${input.settings?.maxRiskAmount ?? 100}`;
  const cached = resultCache.get(key);
  if (cached) return cloneResult(cached, "hit");

  const atr = calculateATR(candles, CONFIG.atrPeriod);
  const ema20 = calculateEMA(candles, 20);
  const candleDates = candles.map((c) => zonedDateParts(c.timestamp, SESSION_TIMEZONE).date);
  const candleSessions = candles.map((c) => sessionNameAt(c.timestamp));
  const isSwingLowArray = candles.map((_, i) => detectSwingLow(candles, i, CONFIG.swingLookback));
  const isSwingHighArray = candles.map((_, i) => detectSwingHigh(candles, i, CONFIG.swingLookback));

  const signals: TradeSignal[] = [];
  const pendingCandidates: SignalCandidateDebug[] = [];
  const candidateDebug: SignalCandidateDebug[] = [];
  const rejectedSetups: RejectedSetup[] = [];
  const rejectionCounts = new Map<string, number>();
  const daySignalCounts = new Map<string, number>();
  let liquidityLevelsFound = 0;
  let sweepsDetected = 0;
  let reclaimsConfirmed = 0;
  let confirmationCandlesFound = 0;
  let expiredSetups = 0;

  if (candles.length < CONFIG.atrPeriod + CONFIG.swingLookback * 2 + 2) {
    increment(rejectionCounts, "INSUFFICIENT_CANDLES");
  }

  const firstIndex = Math.max(CONFIG.atrPeriod, CONFIG.swingLookback * 2 + 2);
  for (let index = firstIndex; index < candles.length; index++) {
    const currentAtr = atr[index];
    if (!currentAtr || !Number.isFinite(currentAtr)) {
      increment(rejectionCounts, "INSUFFICIENT_CANDLES");
      continue;
    }

    const levels = findLiquidityLevels(candles, index, currentAtr, candleDates, candleSessions, isSwingLowArray, isSwingHighArray);
    liquidityLevelsFound += levels.length;
    if (!levels.length) {
      increment(rejectionCounts, "NO_LIQUIDITY_LEVEL_FOUND");
      continue;
    }

    const setup = bestSweepSetup(candles, index, levels, currentAtr);
    if (!setup) continue;
    sweepsDetected++;

    const evaluated = evaluateSweep(setup);
    if (evaluated.confirmedIndex !== null) {
      index = Math.max(index, evaluated.confirmedIndex);
    }
  }

  function evaluateSweep(setup: SweepSetup): EvaluatedSweep {
    if (setup.sweepDistanceAtr < CONFIG.minSweepBufferAtr) {
      addRejection(setup, "SWEEP_TOO_SMALL", setup.sweepIndex, "REJECTED");
      return { confirmedIndex: null };
    }
    if (setup.sweepDistanceAtr > CONFIG.maxSweepDistanceAtr) {
      addRejection(setup, "SWEEP_TOO_LARGE", setup.sweepIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    const sweep = candles[setup.sweepIndex];
    const sameCandleReclaim = reclaimed(sweep, setup);
    const nextIndex = setup.sweepIndex + 1;
    let reclaimIndex = sameCandleReclaim ? setup.sweepIndex : -1;

    if (reclaimIndex < 0 && CONFIG.allowNextCandleReclaim) {
      if (nextIndex >= candles.length) {
        const debug = makeDebug(setupId(setup), setup.direction, "PENDING_CONFIRMATION", "NO_RECLAIM_CLOSE", 1, "SWEEP_DETECTED");
        candidateDebug.push(debug);
        pendingCandidates.push(debug);
        return { confirmedIndex: null };
      }
      if (reclaimed(candles[nextIndex], setup)) reclaimIndex = nextIndex;
    }

    if (CONFIG.requireCloseBackInside && reclaimIndex < 0) {
      addRejection(setup, "NO_RECLAIM_CLOSE", setup.sweepIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    reclaimsConfirmed++;
    const confirmationLimit = reclaimIndex + CONFIG.confirmationWindow;
    let confirmationIndex = -1;
    let weakConfirmation = false;
    for (let check = reclaimIndex + 1; check <= Math.min(candles.length - 1, confirmationLimit); check++) {
      const checkAtr = atr[check] ?? setup.atr;
      if (isConfirmation(candles[check], checkAtr, setup.direction)) {
        confirmationIndex = check;
        break;
      }
      if (isDirectionalCandle(candles[check], setup.direction)) weakConfirmation = true;
    }

    if (confirmationIndex < 0) {
      const waiting = candles.length - 1 < confirmationLimit;
      const code: SignalRejectionCode = waiting ? "WEAK_CONFIRMATION_CANDLE" : weakConfirmation ? "WEAK_CONFIRMATION_CANDLE" : "CONFIRMATION_EXPIRED";
      const debug = makeDebug(
        setupId(setup),
        setup.direction,
        waiting ? "PENDING_CONFIRMATION" : "EXPIRED_CONFIRMATION",
        code,
        Math.max(0, confirmationLimit - (candles.length - 1)),
        waiting ? "WAITING_CONFIRMATION" : "EXPIRED",
      );
      candidateDebug.push(debug);
      if (waiting) {
        pendingCandidates.push(debug);
      } else {
        expiredSetups++;
        increment(rejectionCounts, code);
        rejectedSetups.push(toRejected(setupId(setup), setup.direction, reclaimIndex, code, debug, "EXPIRED"));
      }
      return { confirmedIndex: null };
    }

    confirmationCandlesFound++;
    const confirmation = candles[confirmationIndex];
    const confirmationAtr = atr[confirmationIndex] ?? setup.atr;
    const entry = confirmation.close;
    const stopLoss = setup.direction === "BUY"
      ? setup.sweepPrice - confirmationAtr * CONFIG.slAtrBuffer
      : setup.sweepPrice + confirmationAtr * CONFIG.slAtrBuffer;
    const risk = setup.direction === "BUY" ? entry - stopLoss : stopLoss - entry;
    if (!(risk > 0) || risk > confirmationAtr * CONFIG.maxSlAtrMultiple) {
      addRejection(setup, "INVALID_STOP_LOSS", confirmationIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    const target = findTarget(candles, confirmationIndex, setup.direction, entry, risk, confirmationAtr, candleDates, candleSessions, isSwingLowArray, isSwingHighArray);
    const reward = setup.direction === "BUY" ? target.price - entry : entry - target.price;
    if (!Number.isFinite(target.price) || !(reward > 0)) {
      addRejection(setup, "INVALID_TAKE_PROFIT", confirmationIndex, "REJECTED");
      return { confirmedIndex: null };
    }
    const rr = reward / risk;
    if (!Number.isFinite(rr) || rr < CONFIG.minRR) {
      addRejection(setup, "RR_BELOW_MINIMUM", confirmationIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    const local = zonedDateParts(confirmation.timestamp, SESSION_TIMEZONE);
    if ((daySignalCounts.get(local.date) ?? 0) >= CONFIG.maxSignalsPerDay) {
      addRejection(setup, "MAX_DAILY_SIGNALS_REACHED", confirmationIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    const sessionName = sessionNameAt(confirmation.timestamp);
    const hasMss = detectMss(candles, setup.sweepIndex, confirmationIndex, setup.direction);
    const hasFvg = detectFvg(candles, confirmationIndex, setup.direction);
    const shortEma = ema20[confirmationIndex];
    const shortEmaAligned = shortEma !== null && (setup.direction === "BUY" ? confirmation.close > shortEma : confirmation.close < shortEma);
    const warnings = buildWarnings(input, setup, confirmationIndex, sessionName, hasMss, hasFvg, target.fixed);
    const scoreParts = scoreSetup(setup, reclaimIndex, confirmationIndex, rr, sessionName, hasMss, hasFvg, target.fixed, shortEmaAligned);
    const score = Math.min(100, Object.values(scoreParts).reduce((sum, value) => sum + value, 0));
    if (score < CONFIG.minSignalScore) {
      addRejection(setup, "SIGNAL_SCORE_TOO_LOW", confirmationIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    const signal = buildSignal({
      input,
      setup,
      reclaimIndex,
      confirmationIndex,
      entry,
      stopLoss,
      target: target.price,
      risk,
      reward,
      rr,
      score,
      scoreParts,
      sessionName,
      hasMss,
      hasFvg,
      warnings,
      fixedTarget: target.fixed,
      atr: confirmationAtr,
    });
    signals.push(signal);
    daySignalCounts.set(local.date, (daySignalCounts.get(local.date) ?? 0) + 1);
    candidateDebug.push(makeDebug(setupId(setup), setup.direction, "CONFIRMED", "CONFIRMED_SIGNAL", 0, "CONFIRMED_SIGNAL", score, rr));
    return { confirmedIndex: confirmationIndex };
  }

  function addRejection(setup: SweepSetup, code: SignalRejectionCode, index: number, stage: Stage): void {
    increment(rejectionCounts, code);
    const debug = makeDebug(setupId(setup), setup.direction, "REJECTED", code, 0, stage);
    candidateDebug.push(debug);
    rejectedSetups.push(toRejected(setupId(setup), setup.direction, index, code, debug, "INVALIDATED"));
  }

  const generationTimeMs = performance.now() - started;
  const topRejectionReasons = rejectionRows(rejectionCounts);
  const audit = makeAudit({
    candles: candles.length,
    signals,
    rejectedSetups,
    pendingCandidates,
    generationTimeMs,
    liquidityLevelsFound,
    sweepsDetected,
    reclaimsConfirmed,
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
      checkedSetups: sweepsDetected,
      rejectionReasons: topRejectionReasons.map((row) => row.reason),
      message: pendingCandidates.length ? "Liquidity sweep reversal setup is still forming." : "No confirmed liquidity sweep reversal signal found.",
      nearestPossibleSetup: pendingCandidates.at(-1)?.setupId ?? null,
      requiredForSignal: ["Universal liquidity level", "Sweep beyond level", "Closed reclaim", "Closed reversal confirmation", "Minimum 1.5R"],
      timestamp: candles.at(-1)?.timestamp ?? null,
    },
    audit,
  };
  if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value ?? "");
  resultCache.set(key, result);
  return result;
}

function findLiquidityLevels(
  candles: Candle[],
  index: number,
  atr: number,
  candleDates: string[],
  candleSessions: (string | null)[],
  isSwingLowArray: boolean[],
  isSwingHighArray: boolean[]
): LiquidityLevel[] {
  const levels: LiquidityLevel[] = [];
  const lookbackStart = Math.max(0, index - CONFIG.liquidityLookback);
  const swingStart = Math.max(CONFIG.swingLookback, lookbackStart);
  const swingEnd = index - CONFIG.swingLookback - 1;

  for (let cursor = swingStart; cursor <= swingEnd; cursor++) {
    if (isSwingLowArray[cursor]) {
      levels.push({ type: "SSL", source: "SWING", level: candles[cursor].low, detectedAt: candles[cursor].timestamp, detectedAtIndex: cursor, quality: 17 });
    }
    if (isSwingHighArray[cursor]) {
      levels.push({ type: "BSL", source: "SWING", level: candles[cursor].high, detectedAt: candles[cursor].timestamp, detectedAtIndex: cursor, quality: 17 });
    }
  }

  levels.push(...findEqualLevels(candles, index, atr, "SSL", isSwingLowArray, isSwingHighArray));
  levels.push(...findEqualLevels(candles, index, atr, "BSL", isSwingLowArray, isSwingHighArray));
  levels.push(...getPreviousDayLevels(candles, index, candleDates));
  levels.push(...getSessionLevels(candles, index, candleDates, candleSessions));
  levels.push(...roundNumberLevels(candles[index - 1] ?? candles[index], index));

  return dedupeLevels(levels, atr);
}

function findEqualLevels(
  candles: Candle[],
  index: number,
  atr: number,
  type: LiquidityType,
  isSwingLowArray: boolean[],
  isSwingHighArray: boolean[]
): LiquidityLevel[] {
  const tolerance = atr * CONFIG.equalHighLowToleranceAtr;
  const start = Math.max(0, index - CONFIG.liquidityLookback);
  const source: Array<{ price: number; index: number; timestamp: number }> = [];
  for (let cursor = Math.max(CONFIG.swingLookback, start); cursor <= index - CONFIG.swingLookback - 1; cursor++) {
    if (type === "SSL" && isSwingLowArray[cursor]) {
      source.push({ price: candles[cursor].low, index: cursor, timestamp: candles[cursor].timestamp });
    }
    if (type === "BSL" && isSwingHighArray[cursor]) {
      source.push({ price: candles[cursor].high, index: cursor, timestamp: candles[cursor].timestamp });
    }
  }
  const levels: LiquidityLevel[] = [];
  for (let left = 0; left < source.length; left++) {
    for (let right = left + 2; right < source.length; right++) {
      if (Math.abs(source[left].price - source[right].price) > tolerance) continue;
      const level = (source[left].price + source[right].price) / 2;
      levels.push({ type, source: "EQUAL_HIGH_LOW", level, detectedAt: source[right].timestamp, detectedAtIndex: source[right].index, quality: 20 });
      return levels;
    }
  }
  return levels;
}

function getPreviousDayLevels(candles: Candle[], index: number, candleDates: string[]): LiquidityLevel[] {
  const currentDate = candleDates[index];
  let p = index - 1;
  while (p >= 0 && candleDates[p] === currentDate) {
    p--;
  }
  if (p < 0) return [];
  const prevDate = candleDates[p];
  let start = p;
  while (start >= 0 && candleDates[start] === prevDate) {
    start--;
  }
  start++;
  let highCandle = candles[start];
  let lowCandle = candles[start];
  let highIdx = start;
  let lowIdx = start;
  for (let i = start + 1; i <= p; i++) {
    if (candles[i].high > highCandle.high) {
      highCandle = candles[i];
      highIdx = i;
    }
    if (candles[i].low < lowCandle.low) {
      lowCandle = candles[i];
      lowIdx = i;
    }
  }
  return [
    { type: "BSL", source: "PREVIOUS_DAY", level: highCandle.high, detectedAt: highCandle.timestamp, detectedAtIndex: highIdx, quality: 20 },
    { type: "SSL", source: "PREVIOUS_DAY", level: lowCandle.low, detectedAt: lowCandle.timestamp, detectedAtIndex: lowIdx, quality: 20 },
  ];
}

function getSessionLevels(candles: Candle[], index: number, candleDates: string[], candleSessions: (string | null)[]): LiquidityLevel[] {
  const sessionName = candleSessions[index];
  if (!sessionName) return [];
  const localDate = candleDates[index];
  let highCandle: Candle | null = null;
  let lowCandle: Candle | null = null;
  let highIdx = -1;
  let lowIdx = -1;
  for (let i = index - 1; i >= 0; i--) {
    if (candleDates[i] !== localDate) break;
    if (candleSessions[i] === sessionName) {
      if (highCandle === null || candles[i].high > highCandle.high) {
        highCandle = candles[i];
        highIdx = i;
      }
      if (lowCandle === null || candles[i].low < lowCandle.low) {
        lowCandle = candles[i];
        lowIdx = i;
      }
    }
  }
  if (highIdx < 0 || lowIdx < 0) return [];
  return [
    { type: "BSL", source: "SESSION", level: highCandle!.high, detectedAt: highCandle!.timestamp, detectedAtIndex: highIdx, quality: 16 },
    { type: "SSL", source: "SESSION", level: lowCandle!.low, detectedAt: lowCandle!.timestamp, detectedAtIndex: lowIdx, quality: 16 },
  ];
}

function roundNumberLevels(reference: Candle, index: number): LiquidityLevel[] {
  const below = Math.floor(reference.close / ROUND_NUMBER_STEP) * ROUND_NUMBER_STEP;
  const above = Math.ceil(reference.close / ROUND_NUMBER_STEP) * ROUND_NUMBER_STEP;
  const levels: LiquidityLevel[] = [];
  if (below > 0) levels.push({ type: "SSL", source: "ROUND_NUMBER", level: below, detectedAt: reference.timestamp, detectedAtIndex: Math.max(0, index - 1), quality: 12 });
  if (above > 0 && above !== below) levels.push({ type: "BSL", source: "ROUND_NUMBER", level: above, detectedAt: reference.timestamp, detectedAtIndex: Math.max(0, index - 1), quality: 12 });
  return levels;
}

function dedupeLevels(levels: LiquidityLevel[], atr: number): LiquidityLevel[] {
  const sorted = [...levels].sort((a, b) => b.quality - a.quality || b.detectedAt - a.detectedAt);
  const output: LiquidityLevel[] = [];
  const tolerance = atr * CONFIG.equalHighLowToleranceAtr;
  for (const level of sorted) {
    if (output.some((item) => item.type === level.type && Math.abs(item.level - level.level) <= tolerance)) continue;
    output.push(level);
  }
  return output;
}

function bestSweepSetup(candles: Candle[], index: number, levels: LiquidityLevel[], atr: number): SweepSetup | null {
  const candle = candles[index];
  const valid: SweepSetup[] = [];
  for (const liquidity of levels) {
    const distance = liquidity.type === "SSL" ? liquidity.level - candle.low : candle.high - liquidity.level;
    if (!(distance > 0)) continue;
    const direction: Direction = liquidity.type === "SSL" ? "BUY" : "SELL";
    const distanceAtr = distance / atr;
    const setup: SweepSetup = {
      liquidity,
      direction,
      sweepIndex: index,
      sweepPrice: liquidity.type === "SSL" ? candle.low : candle.high,
      sweepDistanceAtr: distanceAtr,
      atr,
    };
    valid.push(setup);
  }
  if (!valid.length) return null;
  const sorted = valid.sort((a, b) => {
    const aTradable = a.sweepDistanceAtr >= CONFIG.minSweepBufferAtr && a.sweepDistanceAtr <= CONFIG.maxSweepDistanceAtr ? 1 : 0;
    const bTradable = b.sweepDistanceAtr >= CONFIG.minSweepBufferAtr && b.sweepDistanceAtr <= CONFIG.maxSweepDistanceAtr ? 1 : 0;
    return bTradable - aTradable || b.liquidity.quality - a.liquidity.quality || a.sweepDistanceAtr - b.sweepDistanceAtr;
  });
  return sorted[0];
}

function reclaimed(candle: Candle, setup: SweepSetup): boolean {
  return setup.direction === "BUY"
    ? candle.close > setup.liquidity.level
    : candle.close < setup.liquidity.level;
}

function isConfirmation(candle: Candle, atr: number, direction: Direction): boolean {
  const range = candle.high - candle.low;
  if (range <= 0 || range < atr * CONFIG.minConfirmationRangeAtr) return false;
  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  const closePosition = (candle.close - candle.low) / range;
  return bodyRatio >= CONFIG.confirmationBodyRatio && (direction === "BUY"
    ? candle.close > candle.open && closePosition >= CONFIG.confirmationClosePosition
    : candle.close < candle.open && closePosition <= 1 - CONFIG.confirmationClosePosition);
}

function isDirectionalCandle(candle: Candle, direction: Direction): boolean {
  return direction === "BUY" ? candle.close > candle.open : candle.close < candle.open;
}

function findTarget(
  candles: Candle[],
  index: number,
  direction: Direction,
  entry: number,
  risk: number,
  atr: number,
  candleDates: string[],
  candleSessions: (string | null)[],
  isSwingLowArray: boolean[],
  isSwingHighArray: boolean[]
): { price: number; fixed: boolean } {
  const levels = findLiquidityLevels(candles, index, atr, candleDates, candleSessions, isSwingLowArray, isSwingHighArray);
  const liquidityTargets = levels
    .filter((level) => direction === "BUY" ? level.type === "BSL" && level.level > entry : level.type === "SSL" && level.level < entry)
    .map((level) => level.level);
  if (liquidityTargets.length) {
    return { price: direction === "BUY" ? Math.min(...liquidityTargets) : Math.max(...liquidityTargets), fixed: false };
  }

  const swingTargets: number[] = [];
  for (let cursor = Math.max(CONFIG.swingLookback, index - CONFIG.liquidityLookback); cursor <= index - CONFIG.swingLookback; cursor++) {
    if (direction === "BUY" && isSwingHighArray[cursor] && candles[cursor].high > entry) swingTargets.push(candles[cursor].high);
    if (direction === "SELL" && isSwingLowArray[cursor] && candles[cursor].low < entry) swingTargets.push(candles[cursor].low);
  }
  if (swingTargets.length) {
    return { price: direction === "BUY" ? Math.min(...swingTargets) : Math.max(...swingTargets), fixed: false };
  }

  const minimum = risk * CONFIG.minRR;
  return { price: direction === "BUY" ? entry + minimum : entry - minimum, fixed: true };
}

function detectMss(candles: Candle[], sweepIndex: number, confirmationIndex: number, direction: Direction): boolean {
  const prior = candles.slice(Math.max(0, sweepIndex - 8), sweepIndex);
  if (prior.length < 3) return false;
  if (direction === "BUY") return candles[confirmationIndex].close > Math.max(...prior.map((candle) => candle.high));
  return candles[confirmationIndex].close < Math.min(...prior.map((candle) => candle.low));
}

function detectFvg(candles: Candle[], confirmationIndex: number, direction: Direction): boolean {
  if (confirmationIndex < 2) return false;
  const first = candles[confirmationIndex - 2];
  const confirmation = candles[confirmationIndex];
  return direction === "BUY" ? confirmation.low > first.high : confirmation.high < first.low;
}

function scoreSetup(
  setup: SweepSetup,
  reclaimIndex: number,
  confirmationIndex: number,
  rr: number,
  sessionName: string | null,
  hasMss: boolean,
  hasFvg: boolean,
  fixedTarget: boolean,
  shortEmaAligned: boolean,
): ScoreParts {
  const reclaimSpeed = reclaimIndex === setup.sweepIndex ? 1 : 0.75;
  const sweepMid = (CONFIG.minSweepBufferAtr + CONFIG.maxSweepDistanceAtr) / 2;
  const sweepQuality = Math.max(12, 20 - Math.round(Math.abs(setup.sweepDistanceAtr - sweepMid) * 4));
  const confirmationDelay = Math.max(1, confirmationIndex - reclaimIndex);
  const confirmationQuality = Math.max(12, 21 - confirmationDelay * 2);
  const confluenceBonus = Math.min(5, (CONFIG.allowMssBonus && hasMss ? 2 : 0) + (CONFIG.allowFvgBonus && hasFvg ? 2 : 0) + (shortEmaAligned ? 1 : 0) + (fixedTarget ? 0 : 1));
  return {
    liquidityLevelQuality: setup.liquidity.quality,
    sweepQuality,
    reclaimQuality: Math.round(14 + reclaimSpeed * 6),
    confirmationQuality,
    rrQuality: Math.min(10, Math.round(7 + Math.min(3, (rr - CONFIG.minRR) * 2))),
    sessionQuality: sessionName ? 5 : 3,
    confluenceBonus,
  };
}

function buildWarnings(
  input: V2GoldmineInput,
  setup: SweepSetup,
  confirmationIndex: number,
  sessionName: string | null,
  hasMss: boolean,
  hasFvg: boolean,
  fixedTarget: boolean,
): string[] {
  const warnings = new Set<string>();
  if (!sessionName) warnings.add("OUTSIDE_ACTIVE_SESSION");
  if (!hasMss) warnings.add("NO_MSS_CONFIRMATION");
  if (!hasFvg) warnings.add("NO_FVG_CONFIRMATION");
  if (fixedTarget) warnings.add("TARGET_USING_FIXED_RR");
  const htfBias = input.context.htfBias?.bias ?? "UNKNOWN";
  if ((setup.direction === "BUY" && htfBias === "BEARISH") || (setup.direction === "SELL" && htfBias === "BULLISH")) {
    warnings.add("SWEEP_AGAINST_HTF_CONTEXT");
  }
  if (recentChoppyPriceAction(input.candles.filter((candle) => candle.isClosed), confirmationIndex)) warnings.add("CHOPPY_PRICE_ACTION");
  return [...warnings];
}

function recentChoppyPriceAction(candles: Candle[], index: number): boolean {
  let flips = 0;
  for (let cursor = Math.max(1, index - CHOP_LOOKBACK); cursor <= index; cursor++) {
    const current = candles[cursor].close - candles[cursor].open;
    const previous = candles[cursor - 1].close - candles[cursor - 1].open;
    if (current !== 0 && previous !== 0 && Math.sign(current) !== Math.sign(previous)) flips++;
  }
  return flips >= 5;
}

function buildSignal(args: {
  input: V2GoldmineInput;
  setup: SweepSetup;
  reclaimIndex: number;
  confirmationIndex: number;
  entry: number;
  stopLoss: number;
  target: number;
  risk: number;
  reward: number;
  rr: number;
  score: number;
  scoreParts: ScoreParts;
  sessionName: string | null;
  hasMss: boolean;
  hasFvg: boolean;
  warnings: string[];
  fixedTarget: boolean;
  atr: number;
}): TradeSignal {
  const candles = args.input.candles.filter((candle) => candle.isClosed);
  const confirmation = candles[args.confirmationIndex];
  const sweep = candles[args.setup.sweepIndex];
  const reclaim = candles[args.reclaimIndex];
  const range = confirmation.high - confirmation.low;
  const bodyRatio = range > 0 ? Math.abs(confirmation.close - confirmation.open) / range : 0;
  const closePosition = range > 0 ? (confirmation.close - confirmation.low) / range : 0.5;
  const htfContext = args.input.context.htfBias?.bias ?? "UNKNOWN";
  const scoreBreakdown: SignalScoreBreakdown = {
    phase4Setup: args.scoreParts.liquidityLevelQuality,
    contextAlignment: args.scoreParts.reclaimQuality,
    confirmationCandle: args.scoreParts.confirmationQuality,
    stopLossQuality: args.scoreParts.sweepQuality,
    targetQuality: args.scoreParts.rrQuality,
    sessionQuality: args.scoreParts.sessionQuality,
    volatilityQuality: args.scoreParts.confluenceBonus,
    antiReversal: 0,
  };
  const setupKey = setupId(args.setup);
  return {
    id: `${LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID}:${args.input.symbol}:${confirmation.timestamp}:${args.setup.direction}:${round(args.setup.liquidity.level, 2)}`,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID,
    v2Direction: args.setup.direction,
    type: args.setup.direction === "BUY" ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
    direction: args.setup.direction === "BUY" ? "BULLISH" : "BEARISH",
    status: "CONFIRMED",
    sourceSetupId: setupKey,
    setupType: "LIQUIDITY_SWEEP_REVERSAL",
    strategyModel: LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_LABEL,
    mode: "V2_DEFAULT",
    timestamp: confirmation.timestamp,
    candleIndex: args.confirmationIndex,
    confirmedAtIndex: args.confirmationIndex,
    timeframe: args.input.timeframe,
    session: toTradingSession(args.sessionName),
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
      `${args.setup.liquidity.type} ${args.setup.liquidity.source.toLowerCase().replaceAll("_", " ")} liquidity was swept.`,
      "Price reclaimed the liquidity level before entry.",
      "A separate closed reversal candle confirmed the signal.",
    ],
    warnings: args.warnings,
    rejectionReasons: [],
    relatedMarkers: [],
    noRepaintProof: {
      status: "PASS",
      signalIndex: args.confirmationIndex,
      latestAllowedCandleIndex: args.confirmationIndex,
      usedMarkerIndexes: [args.setup.sweepIndex, args.reclaimIndex, args.confirmationIndex],
      usedContextCloseTimes: [],
      usedSetupId: setupKey,
      passed: true,
      lastAvailableIndex: args.confirmationIndex,
      maxEvidenceIndex: args.confirmationIndex,
      message: "Liquidity sweep signal uses only closed candles through reclaim and confirmation; entry, SL, TP, and RR are immutable.",
    },
    stopLossDetail: {
      price: round(args.stopLoss),
      source: "SWEEP_EXTREME_ATR_BUFFER",
      buffer: round(args.atr * CONFIG.slAtrBuffer),
      riskPoints: round(args.risk),
      reason: "Stop is beyond the sweep extreme with ATR buffer.",
    },
    takeProfitDetail: {
      tp1: round(args.target),
      tp2: null,
      tp3: null,
      source: args.fixedTarget ? "FIXED_1_5R_FALLBACK" : "OPPOSITE_LIQUIDITY",
      rewardPoints: round(args.reward),
      reason: args.fixedTarget ? "No opposite liquidity target was available; fixed minimum-RR target used." : "Nearest opposite liquidity target.",
    },
    scoreBreakdown,
    liquiditySweepReversal: {
      stage: "CONFIRMED_SIGNAL",
      signalTime: confirmation.timestamp,
      liquidity: {
        type: args.setup.liquidity.type,
        source: args.setup.liquidity.source,
        level: args.setup.liquidity.level,
        detectedAt: args.setup.liquidity.detectedAt,
      },
      sweep: {
        candleTime: sweep.timestamp,
        candleIndex: args.setup.sweepIndex,
        sweepPrice: args.setup.sweepPrice,
        sweepDistanceAtr: args.setup.sweepDistanceAtr,
        reclaimed: true,
        reclaimedAt: reclaim.timestamp,
        reclaimedAtIndex: args.reclaimIndex,
      },
      confirmation: {
        candleTime: confirmation.timestamp,
        open: confirmation.open,
        high: confirmation.high,
        low: confirmation.low,
        close: confirmation.close,
        bodyRatio,
        closePosition,
        rangeAtrMultiple: range / args.atr,
      },
      confluence: {
        hasMss: args.hasMss,
        hasFvg: args.hasFvg,
        sessionName: args.sessionName,
        htfContext,
      },
    },
    immutable: true,
  };
}

function makeDebug(
  setupIdValue: string,
  direction: Direction,
  status: SignalCandidateDebug["confirmationStatus"],
  reason: string,
  remaining: number,
  stage: Stage,
  score: number | null = null,
  rr: number | null = null,
): SignalCandidateDebug {
  return {
    setupId: setupIdValue,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID,
    setupScore: 0,
    requiredSetupScore: 0,
    finalSignalScore: score,
    requiredSignalScore: CONFIG.minSignalScore,
    signalScore: score,
    rr,
    requiredRR: CONFIG.minRR,
    directionBias: direction === "BUY" ? "BULLISH" : "BEARISH",
    confirmationStatus: status,
    confirmationWindowRemaining: remaining,
    rejectionReason: reason,
    nextRequiredAction: stage === "SWEEP_DETECTED"
      ? "Wait for a closed reclaim back inside the swept liquidity level."
      : stage === "WAITING_CONFIRMATION"
        ? "Wait for a separate strong closed reversal candle."
        : stage === "CONFIRMED_SIGNAL"
          ? "Use immutable trade levels."
          : "Wait for a new liquidity sweep reversal setup.",
    failedStage: stage,
  };
}

function toRejected(setupIdValue: string, direction: Direction, index: number, code: SignalRejectionCode, debug: SignalCandidateDebug, state: RejectedSetup["setupState"]): RejectedSetup {
  return {
    setupId: setupIdValue,
    setupType: "LIQUIDITY_SWEEP_REVERSAL",
    setupState: state,
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
  liquidityLevelsFound: number;
  sweepsDetected: number;
  reclaimsConfirmed: number;
  confirmationCandlesFound: number;
  expiredSetups: number;
  topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  candidateDebug: SignalCandidateDebug[];
}): EntryEngineResult["audit"] {
  return {
    activeEngine: ACTIVE_SIGNAL_ENGINE,
    strategyId: LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID,
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
    setupCount: args.sweepsDetected,
    invalidatedCount: args.rejectedSetups.length,
    expiredCount: args.expiredSetups,
    totalSetupsScanned: args.sweepsDetected,
    triggerSetupsFound: args.reclaimsConfirmed,
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
    noSignalMessage: args.signals.length ? null : "No confirmed liquidity sweep reversal signal.",
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
    v2LiquiditySweepReversalPro: {
      activeEngineLabel: LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_LABEL,
      strategyId: LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID,
      candlesScanned: args.candles,
      liquidityLevelsFound: args.liquidityLevelsFound,
      sweepsDetected: args.sweepsDetected,
      reclaimsConfirmed: args.reclaimsConfirmed,
      confirmationCandlesFound: args.confirmationCandlesFound,
      confirmedSignals: args.signals.length,
      rejectedSignals: args.rejectedSetups.length,
      expiredSetups: args.expiredSetups,
      generationTimeMs: args.generationTimeMs,
      topRejectionReasons: args.topRejectionReasons,
    },
  };
}

function setupId(setup: SweepSetup): string {
  return `liquidity-sweep:${setup.liquidity.type}:${setup.liquidity.source}:${round(setup.liquidity.level, 2)}:${setup.sweepIndex}:${setup.direction}`;
}

function sessionNameAt(timestamp: number): string | null {
  return clockWindowAt(timestamp, CONFIG.allowedSessions[0].timezone, CONFIG.allowedSessions);
}

function toTradingSession(sessionName: string | null): TradingSession {
  return sessionName === "LONDON" ? "LONDON" : sessionName === "OVERLAP" ? "LONDON_NEW_YORK_OVERLAP" : sessionName === "NY_AM" ? "NEW_YORK" : "DEAD_ZONE";
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

function confidenceFor(score: number): TradeSignal["confidence"] {
  return score >= 90 ? "PREMIUM" : score >= 78 ? "STRONG" : score >= 65 ? "MODERATE" : "LOW_CONFIRMED";
}

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
