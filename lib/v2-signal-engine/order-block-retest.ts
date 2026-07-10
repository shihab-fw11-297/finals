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
  ORDER_BLOCK_RETEST_CONFIG as CONFIG,
  ORDER_BLOCK_RETEST_STRATEGY_ID,
  ORDER_BLOCK_RETEST_STRATEGY_LABEL,
} from "./config";
import { calculateATR, detectSwingHigh, detectSwingLow, zonedDateParts, clockWindowAt } from "./indicators";
import type { V2GoldmineInput } from "./types";

type Direction = "BUY" | "SELL";
type Stage =
  | "STRUCTURE_BREAK_DETECTED"
  | "ORDER_BLOCK_CREATED"
  | "WAITING_RETEST"
  | "ORDER_BLOCK_RETESTED"
  | "WAITING_CONFIRMATION"
  | "CONFIRMED_SIGNAL"
  | "REJECTED"
  | "EXPIRED";
type OrderBlockType = "BULLISH_OB" | "BEARISH_OB";

type Displacement = {
  direction: Direction;
  candleIndex: number;
  bodyRatio: number;
  rangeAtrMultiple: number;
  structureLevel: number;
};

type OrderBlock = {
  type: OrderBlockType;
  direction: Direction;
  createdAt: number;
  candleIndex: number;
  displacementIndex: number;
  top: number;
  bottom: number;
  midpoint: number;
  sizeAtr: number;
  structureLevel: number;
  displacementBodyRatio: number;
  displacementRangeAtr: number;
  hasFvg: boolean;
  hasLiquiditySweep: boolean;
  isFullWickZone: boolean;
};

type Retest = {
  candleIndex: number;
  retestPrice: number;
  retestDepthPercent: number;
};

type ScoreParts = {
  structureBreakQuality: number;
  displacementQuality: number;
  orderBlockQuality: number;
  retestQuality: number;
  confirmationQuality: number;
  rrQuality: number;
};

type ModeKey = "easy" | "testing" | "normal" | "strict" | "professional";

const resultCache = new Map<string, EntryEngineResult>();
const SESSION_TIMEZONE = "America/New_York";

const ALLOWED_SESSIONS = [
  { name: "LONDON", start: "03:00", end: "06:00", timezone: "America/New_York" },
  { name: "NY_AM", start: "08:30", end: "11:30", timezone: "America/New_York" },
  { name: "OVERLAP", start: "08:00", end: "11:00", timezone: "America/New_York" },
];

export function clearOrderBlockRetestCache(): void {
  resultCache.clear();
}

function resolveMode(input: V2GoldmineInput): ModeKey {
  const settings = input.settings as (Partial<Record<"currentMode" | "mode", string>> | undefined);
  const raw = (settings?.currentMode ?? settings?.mode ?? "normal").toLowerCase();
  if (raw.includes("easy") || raw.includes("calibration")) return "easy";
  if (raw.includes("test")) return "testing";
  if (raw.includes("strict")) return "strict";
  if (raw.includes("pro")) return "professional";
  return "normal";
}

function isChoppyMarket(candles: Candle[], index: number, atrValue: number): boolean {
  if (index < 20) return false;
  let flips = 0;
  for (let cursor = index - 19; cursor <= index; cursor++) {
    const current = candles[cursor].close - candles[cursor].open;
    const previous = candles[cursor - 1].close - candles[cursor - 1].open;
    if (current !== 0 && previous !== 0 && Math.sign(current) !== Math.sign(previous)) {
      flips++;
    }
  }
  const windowCandles = candles.slice(index - 19, index + 1);
  const highest = Math.max(...windowCandles.map((c) => c.high));
  const lowest = Math.min(...windowCandles.map((c) => c.low));
  const range = highest - lowest;
  return flips >= 8 || range <= 2.2 * atrValue;
}

function isLowAtr(atrValues: Array<number | null>, index: number): boolean {
  const lookback = 30;
  if (index < lookback) return false;
  let sum = 0;
  let count = 0;
  for (let i = index - lookback + 1; i <= index; i++) {
    const val = atrValues[i];
    if (val !== null && val > 0) {
      sum += val;
      count++;
    }
  }
  if (count === 0) return false;
  const avg = sum / count;
  const current = atrValues[index];
  return current !== null && current < 0.65 * avg;
}

export function generateOrderBlockRetestSignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const candles = input.candles.filter((candle) => candle.isClosed);
  const key = `${ORDER_BLOCK_RETEST_STRATEGY_ID}:${input.symbol}:${input.timeframe}:${candles.length}:${candles.at(-1)?.timestamp ?? 0}:${input.settings?.maxRiskAmount ?? 100}`;
  const cached = resultCache.get(key);
  if (cached) return cloneResult(cached, "hit");

  const mode = resolveMode(input);
  const isTesting = mode === "easy" || mode === "testing";
  const isStrict = mode === "strict" || mode === "professional";

  const minRR = isTesting ? 1.2 : isStrict ? 2.0 : 1.5;
  const displacementAtrFilter = isTesting ? 0.35 : isStrict ? 0.50 : 0.40;
  const obMinSizeAtr = 0.08;
  const obMaxSizeAtr = 1.80;
  const retestWindow = isTesting ? 50 : isStrict ? 25 : 40;
  const maxObAge = isTesting ? 100 : isStrict ? 60 : 80;
  const slAtrBuffer = isTesting ? 0.15 : isStrict ? 0.25 : 0.20;
  const maxSlAtr = isTesting ? 3.5 : isStrict ? 2.5 : 3.0;
  const minScoreThreshold = isTesting ? 55 : isStrict ? 72 : 62;
  const confirmationWindow = 4;

  const atr = calculateATR(candles, CONFIG.atrPeriod);
  const signals: TradeSignal[] = [];
  const pendingCandidates: SignalCandidateDebug[] = [];
  const candidateDebug: SignalCandidateDebug[] = [];
  const rejectedSetups: RejectedSetup[] = [];
  const rejectionCounts = new Map<string, number>();
  const sessionSignalCounts = new Map<string, number>();
  const daySignalCounts = new Map<string, number>();
  let structureBreaksFound = 0;
  let orderBlocksCreated = 0;
  let validOrderBlocks = 0;
  let retestsFound = 0;
  let confirmationCandlesFound = 0;
  let expiredSetups = 0;

  if (candles.length < CONFIG.atrPeriod + CONFIG.swingLookback * 2 + 2) {
    increment(rejectionCounts, "INSUFFICIENT_CANDLES");
  }

  const firstIndex = Math.max(CONFIG.atrPeriod, CONFIG.swingLookback * 2 + 1);
  for (let index = firstIndex; index < candles.length; index++) {
    const currentAtr = atr[index];
    if (!currentAtr || !Number.isFinite(currentAtr)) {
      increment(rejectionCounts, "INSUFFICIENT_CANDLES");
      continue;
    }

    const displacementObj = detectDisplacement(candles, index, currentAtr, mode);
    if (!displacementObj) continue;
    structureBreaksFound++;

    const orderBlock = createOrderBlock(candles, atr, displacementObj);
    if (!orderBlock) {
      addRejection(`ob:${candles[index].timestamp}:${displacementObj.direction}:NO_VALID_ORDER_BLOCK`, "NO_VALID_ORDER_BLOCK", displacementObj.direction, index, "REJECTED");
      continue;
    }
    orderBlocksCreated++;

    if (orderBlock.sizeAtr < obMinSizeAtr) {
      addRejection(setupId(orderBlock), "ORDER_BLOCK_TOO_SMALL", orderBlock.direction, orderBlock.candleIndex, "REJECTED");
      continue;
    }
    if (orderBlock.sizeAtr > obMaxSizeAtr) {
      addRejection(setupId(orderBlock), "ORDER_BLOCK_TOO_LARGE", orderBlock.direction, orderBlock.candleIndex, "REJECTED");
      continue;
    }
    validOrderBlocks++;

    const evaluated = evaluateOrderBlock(orderBlock, index);
    if (evaluated.confirmedIndex !== null) {
      index = Math.max(index, evaluated.confirmedIndex);
    }
  }

  function evaluateOrderBlock(orderBlock: OrderBlock, displacementIndex: number): { confirmedIndex: number | null } {
    let firstTouchIndex: number | null = null;
    let confirmedIndex: number | null = null;
    let rejectionReason: SignalRejectionCode | null = null;
    let failedIndex = displacementIndex;

    const tolerance = atr[displacementIndex]! * CONFIG.retestToleranceAtr;

    for (let check = displacementIndex + 1; check < candles.length; check++) {
      const checkAtr = atr[check] ?? atr[displacementIndex]!;
      const candle = candles[check];

      // A. Closed through far side by > 0.15 ATR
      const closedThrough = orderBlock.direction === "BUY"
        ? candle.close < orderBlock.bottom - 0.15 * checkAtr
        : candle.close > orderBlock.top + 0.15 * checkAtr;
      if (closedThrough) {
        rejectionReason = "ORDER_BLOCK_INVALIDATED";
        failedIndex = check;
        break;
      }

      // B. Fully mitigated before first touch
      if (firstTouchIndex === null && check > orderBlock.candleIndex + 1) {
        const priorSlice = candles.slice(orderBlock.candleIndex + 1, check);
        const fullyMitigated = orderBlock.direction === "BUY"
          ? priorSlice.some((c) => c.low <= orderBlock.bottom)
          : priorSlice.some((c) => c.high >= orderBlock.top);
        if (fullyMitigated) {
          rejectionReason = "ORDER_BLOCK_INVALIDATED";
          failedIndex = check - 1;
          break;
        }

        // Strict: Reject if mitigation >= 80%
        if (isStrict) {
          const size = Math.max(orderBlock.top - orderBlock.bottom, Number.EPSILON);
          const deepMitigated = priorSlice.some((c) => {
            const depth = orderBlock.direction === "BUY"
              ? (orderBlock.top - c.low) / size
              : (c.high - orderBlock.bottom) / size;
            return depth >= 0.80;
          });
          if (deepMitigated) {
            rejectionReason = "ORDER_BLOCK_INVALIDATED";
            failedIndex = check - 1;
            break;
          }
        }
      }

      // C. Crossed midpoint >= 3 times
      if (check > orderBlock.candleIndex + 1) {
        let crossings = 0;
        let lastState = candles[orderBlock.candleIndex].close > orderBlock.midpoint;
        for (let cIdx = orderBlock.candleIndex + 1; cIdx < check; cIdx++) {
          const state = candles[cIdx].close > orderBlock.midpoint;
          if (state !== lastState) {
            crossings++;
            lastState = state;
          }
        }
        if (crossings >= 3) {
          rejectionReason = "MARKET_LOW_QUALITY";
          failedIndex = check - 1;
          break;
        }
      }

      // D. Age limits
      const age = check - orderBlock.candleIndex;
      if (age > maxObAge) {
        rejectionReason = "ORDER_BLOCK_EXPIRED";
        failedIndex = check;
        break;
      }

      // E. Check touch
      const touches = orderBlock.direction === "BUY"
        ? candle.low <= orderBlock.top + tolerance
        : candle.high >= orderBlock.bottom - tolerance;

      if (touches) {
        if (firstTouchIndex === null) {
          firstTouchIndex = check;
          retestsFound++;
          if (firstTouchIndex - displacementIndex > retestWindow) {
            rejectionReason = "RETEST_EXPIRED";
            failedIndex = check;
            break;
          }
        }

        // F. Confirmation Candle Criteria
        const correctClose = orderBlock.direction === "BUY" ? candle.close > candle.open : candle.close < candle.open;

        const prevCandle = candles[check - 1];
        const correctMidpointOrPrev = orderBlock.direction === "BUY"
          ? (candle.close > orderBlock.midpoint || candle.close > prevCandle.high)
          : (candle.close < orderBlock.midpoint || candle.close < prevCandle.low);

        const notClosedPastFar = orderBlock.direction === "BUY"
          ? candle.close >= orderBlock.bottom - 0.15 * checkAtr
          : candle.close <= orderBlock.top + 0.15 * checkAtr;

        const range = candle.high - candle.low;
        const bodyRatio = range > 0 ? Math.abs(candle.close - candle.open) / range : 0;
        const minRangeVal = checkAtr * (isTesting ? 0.20 : 0.25);
        const minBodyVal = isTesting ? 0.40 : 0.45;
        const correctRangeAndBody = range >= minRangeVal && bodyRatio >= minBodyVal;

        const insideConfWindow = (check - firstTouchIndex) < confirmationWindow;

        if (correctClose && correctMidpointOrPrev && notClosedPastFar && correctRangeAndBody && insideConfWindow) {
          confirmedIndex = check;
          break;
        }
      }
    }

    if (rejectionReason !== null) {
      addRejection(setupId(orderBlock), rejectionReason, orderBlock.direction, failedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    if (confirmedIndex === null) {
      const age = candles.length - 1 - orderBlock.candleIndex;
      const waitingRetest = firstTouchIndex === null;
      
      let waiting = false;
      let code: SignalRejectionCode = "RETEST_EXPIRED";
      
      if (waitingRetest) {
        waiting = (candles.length - 1 - displacementIndex) < retestWindow && age < maxObAge;
        code = "RETEST_EXPIRED";
      } else {
        const confAge = candles.length - 1 - firstTouchIndex!;
        waiting = confAge < confirmationWindow - 1 && age < maxObAge;
        code = "CONFIRMATION_EXPIRED";
      }
      
      const debug = makeDebug(
        setupId(orderBlock),
        orderBlock.direction,
        waiting ? "PENDING_CONFIRMATION" : "EXPIRED_CONFIRMATION",
        code,
        Math.max(0, (waitingRetest ? displacementIndex + retestWindow : firstTouchIndex! + confirmationWindow) - (candles.length - 1)),
        waiting ? (waitingRetest ? "WAITING_RETEST" : "WAITING_CONFIRMATION") : "EXPIRED",
        null,
        null,
        minRR
      );
      candidateDebug.push(debug);
      if (waiting) {
        pendingCandidates.push(debug);
      } else {
        expiredSetups++;
        increment(rejectionCounts, code);
        rejectedSetups.push(toRejected(setupId(orderBlock), orderBlock.direction, candles.length - 1, code, debug));
      }
      return { confirmedIndex: null };
    }

    // Retest & Confirmation confirmed! Build levels
    confirmationCandlesFound++;
    const confirmationAtr = atr[confirmedIndex] ?? atr[displacementIndex] ?? 0;
    const confirmation = candles[confirmedIndex];
    const entry = confirmation.close;

    const retestSlice = candles.slice(firstTouchIndex!, confirmedIndex + 1);
    const retestExtreme = orderBlock.direction === "BUY"
      ? Math.min(...retestSlice.map((c) => c.low))
      : Math.max(...retestSlice.map((c) => c.high));

    const displacementOrigin = orderBlock.displacementIndex;
    const displacementOriginExtreme = orderBlock.direction === "BUY"
      ? Math.min(candles[displacementOrigin].low, candles[Math.max(0, displacementOrigin - 1)].low)
      : Math.max(candles[displacementOrigin].high, candles[Math.max(0, displacementOrigin - 1)].high);

    const stopLoss = orderBlock.direction === "BUY"
      ? Math.min(orderBlock.bottom, retestExtreme, displacementOriginExtreme) - confirmationAtr * slAtrBuffer
      : Math.max(orderBlock.top, retestExtreme, displacementOriginExtreme) + confirmationAtr * slAtrBuffer;

    const risk = orderBlock.direction === "BUY" ? entry - stopLoss : stopLoss - entry;
    
    let slWarning = false;
    if (!(risk > 0)) {
      addRejection(setupId(orderBlock), "INVALID_STOP_LOSS", orderBlock.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }
    if (risk > confirmationAtr * maxSlAtr) {
      if (isTesting && risk <= confirmationAtr * 3.5) {
        slWarning = true;
      } else {
        addRejection(setupId(orderBlock), "STOP_LOSS_TOO_WIDE", orderBlock.direction, confirmedIndex, "REJECTED");
        return { confirmedIndex: null };
      }
    }

    const target = findPriorityTarget(candles, confirmedIndex, orderBlock.direction, entry, risk, minRR);
    const reward = orderBlock.direction === "BUY" ? target.price - entry : entry - target.price;
    if (!Number.isFinite(target.price) || !(reward > 0)) {
      addRejection(setupId(orderBlock), "INVALID_TAKE_PROFIT", orderBlock.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }
    const rr = reward / risk;
    if (!Number.isFinite(rr) || rr < minRR) {
      addRejection(setupId(orderBlock), "RR_BELOW_MINIMUM", orderBlock.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    const sessionName = sessionNameAt(confirmation.timestamp);
    const local = zonedDateParts(confirmation.timestamp, SESSION_TIMEZONE);
    const sessionKey = `${local.date}:${sessionName}`;
    if ((sessionSignalCounts.get(sessionKey) ?? 0) >= CONFIG.maxSignalsPerSession) {
      addRejection(setupId(orderBlock), "MAX_SESSION_SIGNALS_REACHED", orderBlock.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }
    if ((daySignalCounts.get(local.date) ?? 0) >= CONFIG.maxSignalsPerDay) {
      addRejection(setupId(orderBlock), "MAX_DAILY_SIGNALS_REACHED", orderBlock.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    const retestObj: Retest = {
      candleIndex: firstTouchIndex!,
      retestPrice: orderBlock.direction === "BUY"
        ? Math.max(orderBlock.bottom, Math.min(candles[firstTouchIndex!].low, orderBlock.top))
        : Math.max(orderBlock.bottom, Math.min(candles[firstTouchIndex!].high, orderBlock.top)),
      retestDepthPercent: retestDepth(candles[firstTouchIndex!], orderBlock),
    };

    const warnings = buildWarnings(candles, orderBlock, retestObj, confirmedIndex, target.fixed, slWarning, confirmationAtr);
    const scoreParts = scoreSetup(candles, orderBlock, retestObj, confirmedIndex, rr, mode);
    
    // Confluences
    const fvgBonus = CONFIG.allowFvgBonus && orderBlock.hasFvg ? 5 : 0;
    const sweepBonus = CONFIG.allowLiquiditySweepBonus && orderBlock.hasLiquiditySweep ? 5 : 0;
    const activeSessionBonus = (sessionName === "LONDON" || sessionName === "NY_AM" || sessionName === "OVERLAP") ? 5 : 0;
    const totalBonus = fvgBonus + sweepBonus + activeSessionBonus;

    // Penalties
    const chopPenalty = isChoppyMarket(candles, confirmedIndex, confirmationAtr) ? 10 : 0;
    const offSessionPenalty = sessionName === "OFF_SESSION" ? 5 : 0;
    const deepMitigationPenalty = retestObj.retestDepthPercent >= 80 ? 10 : 0;
    const fullWickPenalty = orderBlock.isFullWickZone ? 5 : 0;
    const wideSlPenalty = slWarning ? 5 : 0;
    const totalPenalty = chopPenalty + offSessionPenalty + deepMitigationPenalty + fullWickPenalty + wideSlPenalty;

    const baseScore = Object.values(scoreParts).reduce((sum, value) => sum + value, 0);
    const score = Math.min(100, Math.max(0, baseScore + totalBonus - totalPenalty));

    if (score < minScoreThreshold) {
      addRejection(setupId(orderBlock), "SIGNAL_SCORE_TOO_LOW", orderBlock.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    const signal = buildSignal({
      input,
      candles,
      orderBlock,
      retest: retestObj,
      confirmationIndex: confirmedIndex,
      entry,
      stopLoss,
      target: target.price,
      risk,
      reward,
      rr,
      score,
      scoreParts,
      warnings,
      fixedTarget: target.fixed,
      sessionName,
      atr: confirmationAtr,
      mode,
    });
    signals.push(signal);
    sessionSignalCounts.set(sessionKey, (sessionSignalCounts.get(sessionKey) ?? 0) + 1);
    daySignalCounts.set(local.date, (daySignalCounts.get(local.date) ?? 0) + 1);
    candidateDebug.push(makeDebug(setupId(orderBlock), orderBlock.direction, "CONFIRMED", "CONFIRMED_SIGNAL", 0, "CONFIRMED_SIGNAL", score, rr, minRR));
    return { confirmedIndex: confirmedIndex };
  }

  function addRejection(setupIdValue: string, code: SignalRejectionCode, direction: Direction, index: number, stage: Stage): void {
    increment(rejectionCounts, code);
    const debug = makeDebug(setupIdValue, direction, "REJECTED", code, 0, stage, null, null, minRR);
    candidateDebug.push(debug);
    rejectedSetups.push(toRejected(setupIdValue, direction, index, code, debug));
  }

  const generationTimeMs = performance.now() - started;
  const topRejectionReasons = rejectionRows(rejectionCounts);
  const audit = makeAudit({
    candles: candles.length,
    signals,
    rejectedSetups,
    pendingCandidates,
    generationTimeMs,
    structureBreaksFound,
    orderBlocksCreated,
    validOrderBlocks,
    retestsFound,
    confirmationCandlesFound,
    expiredSetups,
    topRejectionReasons,
    candidateDebug,
    minRR,
    minScoreThreshold,
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
      checkedSetups: validOrderBlocks,
      rejectionReasons: topRejectionReasons.map((row) => row.reason),
      message: pendingCandidates.length ? "Order block retest setup is still forming." : "No confirmed order block retest signal found.",
      nearestPossibleSetup: pendingCandidates.at(-1)?.setupId ?? null,
      requiredForSignal: ["Structure-breaking displacement", "Valid order block", "Retest into OB zone", "Closed confirmation candle", `Minimum ${minRR}R`],
      timestamp: candles.at(-1)?.timestamp ?? null,
    },
    audit,
  };
  if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value ?? "");
  resultCache.set(key, result);
  return result;
}

function detectDisplacement(candles: Candle[], index: number, atrValue: number, mode: ModeKey): Displacement | null {
  const candle = candles[index];
  const range = candle.high - candle.low;
  if (range <= 0) return null;
  const rangeAtrMultiple = range / atrValue;

  const isTesting = mode === "easy" || mode === "testing";
  const isStrict = mode === "strict" || mode === "professional";
  const limit = isTesting ? 0.35 : isStrict ? 0.50 : 0.40;
  if (rangeAtrMultiple < limit) return null;

  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  if (bodyRatio < 0.55) return null;

  const closePosition = (candle.close - candle.low) / range;
  const direction: Direction | null = candle.close > candle.open && closePosition >= 0.65
    ? "BUY"
    : candle.close < candle.open && closePosition <= 1 - 0.65
      ? "SELL"
      : null;
  if (!direction) return null;

  // Rolling range average (10-candle average of ranges prior to index)
  if (index >= 10) {
    let sumRange = 0;
    for (let i = index - 10; i < index; i++) {
      sumRange += candles[i].high - candles[i].low;
    }
    const avgRange10 = sumRange / 10;
    if (range < 1.05 * avgRange10) return null;
  }

  const structureLevel = recentStructureLevel(candles, index, direction);
  if (CONFIG.requireStructureBreak && structureLevel === null) return null;
  if (structureLevel !== null) {
    const broke = direction === "BUY" ? candle.close > structureLevel : candle.close < structureLevel;
    if (!broke) return null;
  }

  return { direction, candleIndex: index, bodyRatio, rangeAtrMultiple, structureLevel: structureLevel ?? candle.close };
}

function recentStructureLevel(candles: Candle[], index: number, direction: Direction): number | null {
  const candidates: number[] = [];
  const start = Math.max(CONFIG.swingLookback, index - 40);
  const end = index - CONFIG.swingLookback;
  for (let cursor = start; cursor <= end; cursor++) {
    if (direction === "BUY" && detectSwingHigh(candles, cursor, CONFIG.swingLookback)) candidates.push(candles[cursor].high);
    if (direction === "SELL" && detectSwingLow(candles, cursor, CONFIG.swingLookback)) candidates.push(candles[cursor].low);
  }
  if (candidates.length) return direction === "BUY" ? Math.max(...candidates) : Math.min(...candidates);
  const fallback = candles.slice(Math.max(0, index - 20), index);
  if (fallback.length < CONFIG.swingLookback) return null;
  return direction === "BUY" ? Math.max(...fallback.map((candle) => candle.high)) : Math.min(...fallback.map((candle) => candle.low));
}

function createOrderBlock(candles: Candle[], atr: Array<number | null>, displacement: Displacement): OrderBlock | null {
  const start = displacement.candleIndex - 3;
  const end = Math.max(0, displacement.candleIndex - 12);
  for (let index = start; index >= end; index--) {
    const candle = candles[index];
    const opposite = displacement.direction === "BUY" ? candle.close < candle.open : candle.close > candle.open;
    if (!opposite) continue;
    const referenceAtr = atr[displacement.candleIndex] ?? atr[index];
    if (!referenceAtr) return null;

    const range = candle.high - candle.low;
    if (range <= 0) continue;
    const bodyRatio = Math.abs(candle.close - candle.open) / range;
    const isFullWick = bodyRatio < 0.25;

    let top = 0;
    let bottom = 0;
    if (displacement.direction === "BUY") {
      top = isFullWick ? candle.high : candle.open;
      bottom = candle.low;
    } else {
      top = candle.high;
      bottom = isFullWick ? candle.low : candle.open;
    }

    const size = top - bottom;
    if (!(size > 0)) continue;

    return {
      type: displacement.direction === "BUY" ? "BULLISH_OB" : "BEARISH_OB",
      direction: displacement.direction,
      createdAt: candle.timestamp,
      candleIndex: index,
      displacementIndex: displacement.candleIndex,
      top,
      bottom,
      midpoint: (top + bottom) / 2,
      sizeAtr: size / referenceAtr,
      structureLevel: displacement.structureLevel,
      displacementBodyRatio: displacement.bodyRatio,
      displacementRangeAtr: displacement.rangeAtrMultiple,
      hasFvg: hasFvgNearOrderBlock(candles, displacement.candleIndex, displacement.direction, top, bottom),
      hasLiquiditySweep: hasLiquiditySweepBeforeDisplacement(candles, displacement.candleIndex, displacement.direction),
      isFullWickZone: isFullWick,
    };
  }
  return null;
}

function hasFvgNearOrderBlock(candles: Candle[], displacementIndex: number, direction: Direction, top: number, bottom: number): boolean {
  if (displacementIndex <= 0 || displacementIndex + 1 >= candles.length) return false;
  if (direction === "BUY") {
    const low = candles[displacementIndex + 1].low;
    const high = candles[displacementIndex - 1].high;
    return high < low && Math.abs(high - top) <= Math.max(top - bottom, Number.EPSILON) * 3;
  }
  const low = candles[displacementIndex - 1].low;
  const high = candles[displacementIndex + 1].high;
  return high < low && Math.abs(low - bottom) <= Math.max(top - bottom, Number.EPSILON) * 3;
}

function hasLiquiditySweepBeforeDisplacement(candles: Candle[], displacementIndex: number, direction: Direction): boolean {
  const window = candles.slice(Math.max(0, displacementIndex - 8), displacementIndex);
  if (window.length < 3) return false;
  const prior = candles.slice(Math.max(0, displacementIndex - 20), Math.max(0, displacementIndex - 8));
  if (prior.length < 3) return false;
  if (direction === "BUY") {
    const priorLow = Math.min(...prior.map((candle) => candle.low));
    return window.some((candle) => candle.low < priorLow && candle.close > priorLow);
  }
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  return window.some((candle) => candle.high > priorHigh && candle.close < priorHigh);
}

function retestDepth(candle: Candle, orderBlock: OrderBlock): number {
  const size = Math.max(orderBlock.top - orderBlock.bottom, Number.EPSILON);
  if (orderBlock.direction === "BUY") {
    const touched = Math.max(orderBlock.bottom, Math.min(candle.low, orderBlock.top));
    return Math.round(((orderBlock.top - touched) / size) * 100);
  }
  const touched = Math.max(orderBlock.bottom, Math.min(candle.high, orderBlock.top));
  return Math.round(((touched - orderBlock.bottom) / size) * 100);
}

function findPriorityTarget(
  candles: Candle[],
  index: number,
  direction: Direction,
  entry: number,
  risk: number,
  minRR: number
): { price: number; fixed: boolean } {
  const isBuy = direction === "BUY";
  
  // swing targets
  const swingTargets: number[] = [];
  const start = Math.max(5, index - 100);
  for (let cursor = start; cursor <= index - 5; cursor++) {
    if (isBuy && detectSwingHigh(candles, cursor, 5)) {
      if (candles[cursor].high > entry) swingTargets.push(candles[cursor].high);
    } else if (!isBuy && detectSwingLow(candles, cursor, 5)) {
      if (candles[cursor].low < entry) swingTargets.push(candles[cursor].low);
    }
  }

  // previous session target
  const sessionTarget = previousSessionTarget(candles, index, direction, entry);
  if (sessionTarget !== null) swingTargets.push(sessionTarget);

  if (swingTargets.length > 0) {
    const targetPrice = isBuy ? Math.min(...swingTargets) : Math.max(...swingTargets);
    return { price: targetPrice, fixed: false };
  }

  // Fallback fixed
  const fallbackRR = Math.max(1.5, minRR);
  const fallbackPrice = isBuy ? entry + risk * fallbackRR : entry - risk * fallbackRR;
  return { price: fallbackPrice, fixed: true };
}

function previousSessionTarget(candles: Candle[], index: number, direction: Direction, entry: number): number | null {
  const current = zonedDateParts(candles[index].timestamp, SESSION_TIMEZONE).date;
  const previous = candles.slice(Math.max(0, index - 288), index).filter((candle) => zonedDateParts(candle.timestamp, SESSION_TIMEZONE).date < current);
  if (previous.length < 3) return null;
  const level = direction === "BUY" ? Math.max(...previous.map((candle) => candle.high)) : Math.min(...previous.map((candle) => candle.low));
  return direction === "BUY" ? (level > entry ? level : null) : (level < entry ? level : null);
}

function scoreSetup(candles: Candle[], orderBlock: OrderBlock, retest: Retest, confirmationIndex: number, rr: number, mode: ModeKey): ScoreParts {
  const confirmation = candles[confirmationIndex];
  const range = confirmation.high - confirmation.low;
  const bodyRatio = range > 0 ? Math.abs(confirmation.close - confirmation.open) / range : 0;
  const closePosition = range > 0 ? (confirmation.close - confirmation.low) / range : 0.5;
  const directionalClose = orderBlock.direction === "BUY" ? closePosition : 1 - closePosition;

  // 1. Structure Break Quality: 20
  const structureBreakQuality = 20;

  // 2. Displacement Quality: 20
  const displacementQuality = Math.min(20, Math.round(10 + orderBlock.displacementBodyRatio * 5 + Math.min(5, orderBlock.displacementRangeAtr * 2)));

  // 3. Order Block Quality: 20
  let orderBlockQuality = 10;
  if (orderBlock.sizeAtr >= 0.15 && orderBlock.sizeAtr <= 0.80) {
    orderBlockQuality = 20;
  } else if ((orderBlock.sizeAtr >= 0.08 && orderBlock.sizeAtr < 0.15) || (orderBlock.sizeAtr > 0.80 && orderBlock.sizeAtr <= 1.20)) {
    orderBlockQuality = 17;
  } else {
    orderBlockQuality = 14;
  }

  // 4. Retest Quality: 15
  const retestQuality = Math.min(15, Math.round(10 + Math.max(0, 50 - retest.retestDepthPercent) / 10));

  // 5. Confirmation Quality: 15
  const confirmationQuality = Math.min(15, Math.round(6 + bodyRatio * 5 + directionalClose * 4));

  // 6. RR and Stop: 10
  const rrQuality = rr >= 2.0 ? 10 : rr >= 1.5 ? 7 : 5;

  return {
    structureBreakQuality,
    displacementQuality,
    orderBlockQuality,
    retestQuality,
    confirmationQuality,
    rrQuality,
  };
}

function buildWarnings(
  candles: Candle[],
  orderBlock: OrderBlock,
  retest: Retest,
  confirmationIndex: number,
  fixedTarget: boolean,
  slWarning: boolean,
  atrValue: number
): string[] {
  const warnings = new Set<string>();
  if (retest.candleIndex - orderBlock.candleIndex > CONFIG.orderBlockMaxAgeCandles * 0.65) warnings.add("ORDER_BLOCK_OLD");
  if (retest.retestDepthPercent >= 70) warnings.add("ORDER_BLOCK_DEEP_RETEST");
  if (fixedTarget) warnings.add("TARGET_USING_FIXED_RR");
  if (!orderBlock.hasFvg) warnings.add("NO_FVG_CONFLUENCE");
  if (!orderBlock.hasLiquiditySweep) warnings.add("NO_LIQUIDITY_SWEEP_CONFLUENCE");
  if (orderBlock.isFullWickZone) warnings.add("FULL_WICK_ZONE_FALLBACK");
  if (isChoppyMarket(candles, confirmationIndex, atrValue)) warnings.add("CHOPPY_PRICE_ACTION");
  if (isLowAtr(calculateATR(candles, CONFIG.atrPeriod), confirmationIndex)) warnings.add("ATR_LOW");
  if (slWarning) warnings.add("STOP_LOSS_WIDE_ALLOWED_IN_EASY");
  return [...warnings];
}

function buildSignal(args: {
  input: V2GoldmineInput;
  candles: Candle[];
  orderBlock: OrderBlock;
  retest: Retest;
  confirmationIndex: number;
  entry: number;
  stopLoss: number;
  target: number;
  risk: number;
  reward: number;
  rr: number;
  score: number;
  scoreParts: ScoreParts;
  warnings: string[];
  fixedTarget: boolean;
  sessionName: string;
  atr: number;
  mode: ModeKey;
}): TradeSignal {
  const confirmation = args.candles[args.confirmationIndex];
  const orderBlockCandle = args.candles[args.orderBlock.candleIndex];
  const displacement = args.candles[args.orderBlock.displacementIndex];
  const range = confirmation.high - confirmation.low;
  const bodyRatio = range > 0 ? Math.abs(confirmation.close - confirmation.open) / range : 0;
  const closePosition = range > 0 ? (confirmation.close - confirmation.low) / range : 0;

  const scoreBreakdown: SignalScoreBreakdown = {
    phase4Setup: args.scoreParts.structureBreakQuality + args.scoreParts.displacementQuality,
    contextAlignment: args.scoreParts.orderBlockQuality,
    confirmationCandle: args.scoreParts.confirmationQuality,
    stopLossQuality: args.scoreParts.retestQuality,
    targetQuality: args.scoreParts.rrQuality,
    sessionQuality: 0,
    volatilityQuality: 0,
    antiReversal: 0,
  };

  return {
    id: `${ORDER_BLOCK_RETEST_STRATEGY_ID}:${args.input.symbol}:${confirmation.timestamp}:${args.orderBlock.direction}`,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: ORDER_BLOCK_RETEST_STRATEGY_ID,
    v2Direction: args.orderBlock.direction,
    type: args.orderBlock.direction === "BUY" ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
    direction: args.orderBlock.direction === "BUY" ? "BULLISH" : "BEARISH",
    status: "CONFIRMED",
    sourceSetupId: setupId(args.orderBlock),
    setupType: "TREND_CONTINUATION",
    strategyModel: ORDER_BLOCK_RETEST_STRATEGY_LABEL,
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
      `${args.orderBlock.direction.toLowerCase()} displacement broke structure at ${args.orderBlock.structureLevel.toFixed(2)}.`,
      `${args.orderBlock.type} was retested and held.`,
      "A closed confirmation candle accepted the order-block retest.",
    ],
    warnings: args.warnings,
    rejectionReasons: [],
    relatedMarkers: [
      `OB:${args.orderBlock.candleIndex}`,
      `DISPLACEMENT:${args.orderBlock.displacementIndex}`,
      `RETEST:${args.retest.candleIndex}`,
      `CONFIRMATION:${args.confirmationIndex}`,
    ],
    noRepaintProof: {
      status: "PASS",
      signalIndex: args.confirmationIndex,
      latestAllowedCandleIndex: args.confirmationIndex,
      usedMarkerIndexes: [args.orderBlock.candleIndex, args.orderBlock.displacementIndex, args.retest.candleIndex, args.confirmationIndex],
      usedContextCloseTimes: [],
      usedSetupId: setupId(args.orderBlock),
      passed: true,
      lastAvailableIndex: args.confirmationIndex,
      maxEvidenceIndex: args.confirmationIndex,
      message: "Order block retest signal uses only closed candles through confirmation; entry, SL, TP, and RR are immutable.",
    },
    stopLossDetail: {
      price: round(args.stopLoss),
      source: "ORDER_BLOCK_RETEST_ATR_BUFFER",
      buffer: round(args.atr * CONFIG.slAtrBuffer),
      riskPoints: round(args.risk),
      reason: "Stop is beyond the order-block edge or retest extreme with ATR buffer.",
    },
    takeProfitDetail: {
      tp1: round(args.target),
      tp2: null,
      tp3: null,
      source: args.fixedTarget ? "FIXED_1_5R_FALLBACK" : "RECENT_STRUCTURE_LIQUIDITY",
      rewardPoints: round(args.reward),
      reason: args.fixedTarget ? "No qualifying swing liquidity target was available; fixed minimum-RR target used." : "Nearest recent swing liquidity target.",
    },
    scoreBreakdown,
    orderBlockRetest: {
      stage: "CONFIRMED_SIGNAL",
      signalTime: confirmation.timestamp,
      orderBlock: {
        type: args.orderBlock.type,
        createdAt: orderBlockCandle.timestamp,
        candleIndex: args.orderBlock.candleIndex,
        top: args.orderBlock.top,
        bottom: args.orderBlock.bottom,
        midpoint: args.orderBlock.midpoint,
        sizeAtr: args.orderBlock.sizeAtr,
        ageCandles: args.confirmationIndex - args.orderBlock.candleIndex,
      },
      displacement: {
        candleTime: displacement.timestamp,
        candleIndex: args.orderBlock.displacementIndex,
        bodyRatio: args.orderBlock.displacementBodyRatio,
        rangeAtrMultiple: args.orderBlock.displacementRangeAtr,
        brokeStructureLevel: args.orderBlock.structureLevel,
      },
      retest: {
        retestedAt: args.candles[args.retest.candleIndex].timestamp,
        candleIndex: args.retest.candleIndex,
        retestPrice: args.retest.retestPrice,
        retestDepthPercent: args.retest.retestDepthPercent,
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
        hasFvg: args.orderBlock.hasFvg,
        hasLiquiditySweep: args.orderBlock.hasLiquiditySweep,
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
  minRR: number = 1.5
): SignalCandidateDebug {
  return {
    setupId: setupIdValue,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: ORDER_BLOCK_RETEST_STRATEGY_ID,
    setupScore: score ?? 0,
    requiredSetupScore: 0,
    finalSignalScore: score,
    requiredSignalScore: CONFIG.minSignalScore,
    signalScore: score,
    rr,
    requiredRR: minRR,
    directionBias: direction === "BUY" ? "BULLISH" : "BEARISH",
    confirmationStatus: status,
    confirmationWindowRemaining: remaining,
    rejectionReason: reason,
    nextRequiredAction: stage === "WAITING_RETEST"
      ? "Wait for price to return to the order-block zone."
      : stage === "WAITING_CONFIRMATION"
        ? "Wait for a closed confirmation candle from the order block."
        : stage === "CONFIRMED_SIGNAL"
          ? "Use immutable trade levels."
          : "Wait for a new displacement and order block.",
    failedStage: stage,
  };
}

function toRejected(setupIdValue: string, direction: Direction, index: number, code: SignalRejectionCode, debug: SignalCandidateDebug): RejectedSetup {
  return {
    setupId: setupIdValue,
    setupType: "TREND_CONTINUATION",
    setupState: code === "ORDER_BLOCK_EXPIRED" || code === "RETEST_EXPIRED" ? "EXPIRED" : "INVALIDATED",
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
  structureBreaksFound: number;
  orderBlocksCreated: number;
  validOrderBlocks: number;
  retestsFound: number;
  confirmationCandlesFound: number;
  expiredSetups: number;
  topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  candidateDebug: SignalCandidateDebug[];
  minRR: number;
  minScoreThreshold: number;
}): EntryEngineResult["audit"] {
  return {
    activeEngine: ACTIVE_SIGNAL_ENGINE,
    strategyId: ORDER_BLOCK_RETEST_STRATEGY_ID,
    activeMode: "V2_DEFAULT",
    minimumScoreRequired: args.minScoreThreshold,
    minimumSetupScoreRequired: 0,
    minimumSignalScoreRequired: args.minScoreThreshold,
    minimumRrRequired: args.minRR,
    totalCandlesScanned: args.candles,
    totalMarkersGenerated: 0,
    totalContextsGenerated: 0,
    totalPhase4Setups: 0,
    watchCount: args.pendingCandidates.length,
    setupCount: args.validOrderBlocks,
    invalidatedCount: args.rejectedSetups.length,
    expiredCount: args.expiredSetups,
    totalSetupsScanned: args.orderBlocksCreated,
    triggerSetupsFound: args.retestsFound,
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
    noSignalMessage: args.signals.length ? null : "No confirmed order block retest signal.",
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
    v2OrderBlockRetest: {
      activeEngineLabel: ORDER_BLOCK_RETEST_STRATEGY_LABEL,
      strategyId: ORDER_BLOCK_RETEST_STRATEGY_ID,
      candlesScanned: args.candles,
      structureBreaksFound: args.structureBreaksFound,
      orderBlocksCreated: args.orderBlocksCreated,
      validOrderBlocks: args.validOrderBlocks,
      retestsFound: args.retestsFound,
      confirmationCandlesFound: args.confirmationCandlesFound,
      confirmedSignals: args.signals.length,
      rejectedSignals: args.rejectedSetups.length,
      expiredSetups: args.expiredSetups,
      generationTimeMs: args.generationTimeMs,
      topRejectionReasons: args.topRejectionReasons,
    },
  };
}

function setupId(orderBlock: OrderBlock): string {
  return `order-block:${orderBlock.createdAt}:${orderBlock.direction}:${orderBlock.displacementIndex}`;
}

function sessionNameAt(timestamp: number): string {
  for (const session of ALLOWED_SESSIONS) {
    const name = clockWindowAt(timestamp, session.timezone, [{ name: session.name, start: session.start, end: session.end }]);
    if (name) return name;
  }
  return "OFF_SESSION";
}

function toTradingSession(session: string): TradingSession {
  if (session === "LONDON") return "LONDON";
  if (session === "OVERLAP") return "LONDON_NEW_YORK_OVERLAP";
  if (session === "NY_AM") return "NEW_YORK";
  return "DEAD_ZONE";
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
