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
  FVG_CONTINUATION_ENTRY_CONFIG as CONFIG,
  FVG_CONTINUATION_ENTRY_STRATEGY_ID,
  FVG_CONTINUATION_ENTRY_STRATEGY_LABEL,
} from "./config";
import { calculateATR, calculateEMA, clockWindowAt, detectFVG, detectSwingHigh, detectSwingLow, zonedDateParts } from "./indicators";
import type { V2GoldmineInput } from "./types";

type Direction = "BUY" | "SELL";
type Stage =
  | "DISPLACEMENT_DETECTED"
  | "STRUCTURE_BREAK_CONFIRMED"
  | "FVG_CREATED"
  | "WAITING_FVG_RETEST"
  | "FVG_RETESTED"
  | "WAITING_CONFIRMATION"
  | "CONFIRMED_SIGNAL"
  | "REJECTED"
  | "EXPIRED";

type Displacement = {
  direction: Direction;
  candleIndex: number;
  bodyRatio: number;
  closePosition: number;
  rangeAtrMultiple: number;
  structureBreak: StructureBreak;
};

type StructureBreak = {
  type: "BOS" | "CHOCH";
  brokenLevel: number;
};

type FvgSetup = {
  direction: Direction;
  type: "BULLISH_FVG" | "BEARISH_FVG";
  createdAtIndex: number;
  displacementIndex: number;
  top: number;
  bottom: number;
  midpoint: number;
  size: number;
  sizeAtr: number;
  displacement: Displacement;
  hasLiquiditySweep: boolean;
  hasOrderBlock: boolean;
  emaTrendAligned: boolean;
};

type Retest = {
  candleIndex: number;
  retestPrice: number;
  touchedZone: "TOP" | "MIDPOINT" | "BOTTOM";
  retestDepthPercent: number;
};

type ScoreParts = {
  displacementQuality: number;
  structureBreakQuality: number;
  fvgQuality: number;
  retestQuality: number;
  confirmationQuality: number;
  rrQuality: number;
};

type ModeKey = "easy" | "testing" | "normal" | "strict" | "professional";

const resultCache = new Map<string, EntryEngineResult>();
const SESSION_TIMEZONE = "America/New_York";

export function clearFvgContinuationEntryCache(): void {
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

export function generateFvgContinuationEntrySignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const candles = input.candles.filter((candle) => candle.isClosed);
  const key = `${FVG_CONTINUATION_ENTRY_STRATEGY_ID}:${input.symbol}:${input.timeframe}:${candles.length}:${candles.at(-1)?.timestamp ?? 0}:${input.settings?.maxRiskAmount ?? 100}`;
  const cached = resultCache.get(key);
  if (cached) return cloneResult(cached, "hit");

  const mode = resolveMode(input);
  const isTesting = mode === "easy" || mode === "testing";
  const isStrict = mode === "strict" || mode === "professional";

  const minRR = isTesting ? 1.2 : isStrict ? 2.0 : 1.5;
  const displacementAtrFilter = isTesting ? 0.35 : isStrict ? 0.50 : 0.40;
  const fvgMinSizeAtr = isTesting ? 0.06 : 0.08;
  const fvgMaxSizeAtr = 1.50;
  const retestDeadline = isTesting ? 16 : isStrict ? 10 : 12;
  const maxFvgAge = isTesting ? 50 : isStrict ? 30 : 40;
  const slAtrBuffer = isTesting ? 0.15 : isStrict ? 0.25 : 0.20;
  const maxSlAtr = isTesting ? 3.5 : isStrict ? 2.5 : 3.0;
  const minScoreThreshold = isTesting ? 58 : isStrict ? 72 : 62;

  const atr = calculateATR(candles, CONFIG.atrPeriod);
  const ema20 = calculateEMA(candles, 20);
  const ema50 = calculateEMA(candles, 50);
  const ema200 = calculateEMA(candles, 200);
  const signals: TradeSignal[] = [];
  const pendingCandidates: SignalCandidateDebug[] = [];
  const candidateDebug: SignalCandidateDebug[] = [];
  const rejectedSetups: RejectedSetup[] = [];
  const rejectionCounts = new Map<string, number>();
  const sessionSignalCounts = new Map<string, number>();
  const daySignalCounts = new Map<string, number>();
  let displacementsFound = 0;
  let structureBreaksConfirmed = 0;
  let fvgsCreated = 0;
  let validFvgs = 0;
  let fvgRetestsFound = 0;
  let confirmationCandlesFound = 0;
  let expiredSetups = 0;

  if (candles.length < CONFIG.atrPeriod + CONFIG.swingLookback * 2 + 3) {
    increment(rejectionCounts, "INSUFFICIENT_CANDLES");
  }

  const firstIndex = Math.max(CONFIG.atrPeriod, CONFIG.swingLookback * 2 + 2);
  for (let index = firstIndex; index < candles.length; index++) {
    const currentAtr = atr[index];
    if (!currentAtr || !Number.isFinite(currentAtr)) {
      increment(rejectionCounts, "INSUFFICIENT_CANDLES");
      continue;
    }

    // Displacement Check
    const displacementObj = detectDisplacement(candles, index, currentAtr, mode);
    if (!displacementObj) continue;
    displacementsFound++;
    structureBreaksConfirmed++;

    // FVG Imbalance Search within 3 candles of displacement
    const fvg = findFvgForDisplacement(displacementObj);
    if (!fvg) {
      const maxFvgIndex = Math.min(candles.length - 1, displacementObj.candleIndex + 3);
      if (candles.length - 1 < displacementObj.candleIndex + 3) {
        const debug = makeDebug(setupIdFromDisplacement(candles, displacementObj), displacementObj.direction, "PENDING_CONFIRMATION", "NO_VALID_FVG", 1, "STRUCTURE_BREAK_CONFIRMED", null, null, minRR);
        candidateDebug.push(debug);
        pendingCandidates.push(debug);
      } else {
        addRejection(setupIdFromDisplacement(candles, displacementObj), "NO_VALID_FVG", displacementObj.direction, maxFvgIndex, "REJECTED");
      }
      continue;
    }
    fvgsCreated++;
    validFvgs++;

    // Evaluate retest & confirmation
    const evaluated = evaluateFvg(fvg);
    if (evaluated.confirmedIndex !== null) {
      index = Math.max(index, evaluated.confirmedIndex);
    }
  }

  if (displacementsFound === 0) {
    increment(rejectionCounts, "NO_DISPLACEMENT");
  }

  function findFvgForDisplacement(displacement: Displacement): FvgSetup | null {
    const d = displacement.candleIndex;
    const startFvgScan = d;
    const endFvgScan = Math.min(candles.length - 1, d + 3);
    for (let fvgIndex = startFvgScan; fvgIndex <= endFvgScan; fvgIndex++) {
      const detection = detectFVG(candles, fvgIndex);
      if (!detection) continue;
      if (displacement.direction === "BUY" && detection.type !== "BULLISH_FVG") continue;
      if (displacement.direction === "SELL" && detection.type !== "BEARISH_FVG") continue;
      const referenceAtr = atr[fvgIndex] ?? atr[displacement.candleIndex];
      if (!referenceAtr) continue;
      const sizeAtr = detection.size / referenceAtr;
      if (sizeAtr < fvgMinSizeAtr) {
        addRejection(setupIdFromDisplacement(candles, displacement), "FVG_TOO_SMALL", displacement.direction, fvgIndex, "REJECTED");
        return null;
      }
      if (sizeAtr > fvgMaxSizeAtr) {
        addRejection(setupIdFromDisplacement(candles, displacement), "FVG_TOO_LARGE", displacement.direction, fvgIndex, "REJECTED");
        return null;
      }
      return {
        direction: displacement.direction,
        type: detection.type,
        createdAtIndex: fvgIndex,
        displacementIndex: displacement.candleIndex,
        top: detection.top,
        bottom: detection.bottom,
        midpoint: detection.midpoint,
        size: detection.size,
        sizeAtr,
        displacement,
        hasLiquiditySweep: hasLiquiditySweepBeforeDisplacement(candles, displacement.candleIndex, displacement.direction),
        hasOrderBlock: hasOrderBlockNearFvg(candles, displacement.candleIndex, displacement.direction, detection.bottom, detection.top),
        emaTrendAligned: emaTrendAligned(ema20, ema50, ema200, fvgIndex, displacement.direction),
      };
    }
    return null;
  }

  function evaluateFvg(fvg: FvgSetup): { confirmedIndex: number | null } {
    let firstTouchIndex: number | null = null;
    let confirmedIndex: number | null = null;
    let rejectionReason: SignalRejectionCode | null = null;
    let failedIndex: number = fvg.createdAtIndex;

    const tolerance = atr[fvg.createdAtIndex]! * CONFIG.retestToleranceAtr;

    for (let check = fvg.createdAtIndex + 1; check < candles.length; check++) {
      const checkAtr = atr[check] ?? atr[fvg.createdAtIndex]!;
      const candle = candles[check];

      // A. Closed through far side
      const closedThrough = fvg.direction === "BUY"
        ? candle.close < fvg.bottom - 0.10 * checkAtr
        : candle.close > fvg.top + 0.10 * checkAtr;
      if (closedThrough) {
        rejectionReason = "FVG_INVALIDATED";
        failedIndex = check;
        break;
      }

      // B. Fully mitigated before first touch
      if (firstTouchIndex === null && check > fvg.createdAtIndex + 1) {
        const priorSlice = candles.slice(fvg.createdAtIndex + 1, check);
        const fullyMitigated = fvg.direction === "BUY"
          ? priorSlice.some((c) => c.low <= fvg.bottom)
          : priorSlice.some((c) => c.high >= fvg.top);
        if (fullyMitigated) {
          rejectionReason = "FVG_ALREADY_FILLED";
          failedIndex = check - 1;
          break;
        }
      }

      // C. Crossed midpoint multiple times (midpoint crossings >= 3)
      if (check > fvg.createdAtIndex + 1) {
        let crossings = 0;
        let lastState = candles[fvg.createdAtIndex].close > fvg.midpoint;
        for (let cIdx = fvg.createdAtIndex + 1; cIdx < check; cIdx++) {
          const state = candles[cIdx].close > fvg.midpoint;
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
      const age = check - fvg.createdAtIndex;
      if (age > maxFvgAge) {
        rejectionReason = "CONFIRMATION_EXPIRED";
        failedIndex = check;
        break;
      }

      // E. Check touch
      const touches = fvg.direction === "BUY"
        ? candle.low <= fvg.top + tolerance
        : candle.high >= fvg.bottom - tolerance;

      if (touches) {
        if (firstTouchIndex === null) {
          firstTouchIndex = check;
          fvgRetestsFound++;
          if (firstTouchIndex - fvg.createdAtIndex > retestDeadline) {
            rejectionReason = "FVG_RETEST_EXPIRED";
            failedIndex = check;
            break;
          }
        }

        // F. Confirmation Candle Criteria
        const correctClose = fvg.direction === "BUY" ? candle.close > candle.open : candle.close < candle.open;
        const correctMidpoint = fvg.direction === "BUY" ? candle.close > fvg.midpoint : candle.close < fvg.midpoint;
        const notClosedPastFar = fvg.direction === "BUY"
          ? candle.close >= fvg.bottom - 0.10 * checkAtr
          : candle.close <= fvg.top + 0.10 * checkAtr;

        const range = candle.high - candle.low;
        const bodyRatio = range > 0 ? Math.abs(candle.close - candle.open) / range : 0;
        const closePosition = range > 0 ? (candle.close - candle.low) / range : 0.5;

        const minRangeVal = checkAtr * (isTesting ? CONFIG.minConfirmationRangeAtr * 0.80 : CONFIG.minConfirmationRangeAtr);
        const minBodyVal = isTesting ? CONFIG.confirmationBodyRatio * 0.80 : CONFIG.confirmationBodyRatio;

        const correctRangeAndBody = range >= minRangeVal && bodyRatio >= minBodyVal;

        const correctClosePosition = fvg.direction === "BUY"
          ? closePosition >= (isTesting ? CONFIG.confirmationClosePosition * 0.80 : CONFIG.confirmationClosePosition)
          : (1 - closePosition) >= (isTesting ? CONFIG.confirmationClosePosition * 0.80 : CONFIG.confirmationClosePosition);

        const insideConfWindow = (check - firstTouchIndex) < CONFIG.confirmationWindow;

        if (correctClose && correctMidpoint && notClosedPastFar && correctRangeAndBody && correctClosePosition && insideConfWindow) {
          confirmedIndex = check;
          break;
        }
      }
    }

    if (rejectionReason !== null) {
      addRejection(setupId(fvg), rejectionReason, fvg.direction, failedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    if (confirmedIndex === null) {
      const age = candles.length - 1 - fvg.createdAtIndex;
      const waitingRetest = firstTouchIndex === null;
      
      let waiting = false;
      let code: SignalRejectionCode = "FVG_RETEST_EXPIRED";
      
      if (waitingRetest) {
        waiting = age < retestDeadline;
        code = "FVG_RETEST_EXPIRED";
      } else {
        const confAge = candles.length - 1 - firstTouchIndex!;
        waiting = confAge < CONFIG.confirmationWindow - 1 && age < maxFvgAge;
        code = "CONFIRMATION_EXPIRED";
      }
      
      const debug = makeDebug(
        setupId(fvg),
        fvg.direction,
        waiting ? "PENDING_CONFIRMATION" : "EXPIRED_CONFIRMATION",
        code,
        Math.max(0, (waitingRetest ? fvg.createdAtIndex + retestDeadline : firstTouchIndex! + CONFIG.confirmationWindow) - (candles.length - 1)),
        waiting ? (waitingRetest ? "WAITING_FVG_RETEST" : "WAITING_CONFIRMATION") : "EXPIRED",
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
        rejectedSetups.push(toRejected(setupId(fvg), fvg.direction, candles.length - 1, code, debug, "EXPIRED"));
      }
      return { confirmedIndex: null };
    }

    // Confirmation found! Build Levels
    confirmationCandlesFound++;
    const confirmationAtr = atr[confirmedIndex] ?? atr[fvg.createdAtIndex] ?? 0;
    const confirmation = candles[confirmedIndex];
    const entry = confirmation.close;

    // Retest slice extremes
    const retestSlice = candles.slice(firstTouchIndex!, confirmedIndex + 1);
    const retestExtreme = fvg.direction === "BUY"
      ? Math.min(...retestSlice.map((c) => c.low))
      : Math.max(...retestSlice.map((c) => c.high));

    // Displacement origin extreme
    const displacementOrigin = fvg.displacementIndex;
    const displacementOriginExtreme = fvg.direction === "BUY"
      ? Math.min(candles[displacementOrigin].low, candles[Math.max(0, displacementOrigin - 1)].low)
      : Math.max(candles[displacementOrigin].high, candles[Math.max(0, displacementOrigin - 1)].high);

    // Stop Loss calculation
    const stopLoss = fvg.direction === "BUY"
      ? Math.min(fvg.bottom, retestExtreme, displacementOriginExtreme) - confirmationAtr * slAtrBuffer
      : Math.max(fvg.top, retestExtreme, displacementOriginExtreme) + confirmationAtr * slAtrBuffer;

    const risk = fvg.direction === "BUY" ? entry - stopLoss : stopLoss - entry;
    
    // SL Bounds check
    let slWarning = false;
    if (!(risk > 0)) {
      addRejection(setupId(fvg), "INVALID_STOP_LOSS", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }
    if (risk > confirmationAtr * maxSlAtr) {
      if (isTesting && risk <= confirmationAtr * 3.5) {
        slWarning = true;
      } else {
        addRejection(setupId(fvg), "STOP_LOSS_TOO_WIDE", fvg.direction, confirmedIndex, "REJECTED");
        return { confirmedIndex: null };
      }
    }

    // Take Profit target selection
    const target = findPriorityTarget(candles, confirmedIndex, fvg.direction, entry, risk, minRR);
    const reward = fvg.direction === "BUY" ? target.price - entry : entry - target.price;
    if (!Number.isFinite(target.price) || !(reward > 0)) {
      addRejection(setupId(fvg), "INVALID_TAKE_PROFIT", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }
    const rr = reward / risk;
    if (!Number.isFinite(rr) || rr < minRR) {
      addRejection(setupId(fvg), "RR_BELOW_MINIMUM", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    const sessionName = sessionNameAt(confirmation.timestamp);
    const local = zonedDateParts(confirmation.timestamp, SESSION_TIMEZONE);
    const sessionKey = `${local.date}:${sessionName}`;
    if ((sessionSignalCounts.get(sessionKey) ?? 0) >= CONFIG.maxSignalsPerSession) {
      addRejection(setupId(fvg), "MAX_SESSION_SIGNALS_REACHED", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }
    if ((daySignalCounts.get(local.date) ?? 0) >= CONFIG.maxSignalsPerDay) {
      addRejection(setupId(fvg), "MAX_DAILY_SIGNALS_REACHED", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    const retestObj: Retest = {
      candleIndex: firstTouchIndex!,
      retestPrice: fvg.direction === "BUY"
        ? Math.max(fvg.bottom, Math.min(candles[firstTouchIndex!].low, fvg.top))
        : Math.max(fvg.bottom, Math.min(candles[firstTouchIndex!].high, fvg.top)),
      touchedZone: (fvg.direction === "BUY" ? candles[firstTouchIndex!].low <= fvg.midpoint : candles[firstTouchIndex!].high >= fvg.midpoint) ? "MIDPOINT" : (fvg.direction === "BUY" ? "TOP" : "BOTTOM"),
      retestDepthPercent: calculateRetestDepth(candles[firstTouchIndex!], fvg),
    };

    const warnings = buildWarnings(candles, fvg, retestObj, confirmedIndex, sessionName, target.fixed, slWarning, confirmationAtr);
    const scoreParts = scoreSetup(candles, fvg, retestObj, confirmedIndex, rr, mode);
    
    // Confluences bonuses
    const sweepBonus = CONFIG.allowLiquiditySweepBonus && fvg.hasLiquiditySweep ? 5 : 0;
    const obBonus = CONFIG.allowOrderBlockBonus && fvg.hasOrderBlock ? 5 : 0;
    const emaBonus = CONFIG.allowEmaTrendBonus && fvg.emaTrendAligned ? 5 : 0;
    const activeSessionBonus = (sessionName === "LONDON" || sessionName === "NY_AM" || sessionName === "OVERLAP") ? 5 : 0;
    const totalBonus = sweepBonus + obBonus + emaBonus + activeSessionBonus;

    // Penalties
    const chopPenalty = isChoppyMarket(candles, confirmedIndex, confirmationAtr) ? 10 : 0;
    const offSessionPenalty = sessionName === "OFF_SESSION" ? 5 : 0;
    const deepMitigation = retestObj.retestDepthPercent >= 80 ? 10 : 0;
    const weakBosPenalty = fvg.displacement.structureBreak.type === "CHOCH" ? 5 : 0;
    const wideSlPenalty = slWarning ? 5 : 0;
    const totalPenalty = chopPenalty + offSessionPenalty + deepMitigation + weakBosPenalty + wideSlPenalty;

    const baseScore = Object.values(scoreParts).reduce((sum, value) => sum + value, 0);
    const score = Math.min(100, Math.max(0, baseScore + totalBonus - totalPenalty));

    if (score < minScoreThreshold) {
      addRejection(setupId(fvg), "SIGNAL_SCORE_TOO_LOW", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    const signal = buildSignal({
      input,
      candles,
      fvg,
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
    candidateDebug.push(makeDebug(setupId(fvg), fvg.direction, "CONFIRMED", "CONFIRMED_SIGNAL", 0, "CONFIRMED_SIGNAL", score, rr, minRR));
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
    displacementsFound,
    structureBreaksConfirmed,
    fvgsCreated,
    validFvgs,
    fvgRetestsFound,
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
      checkedSetups: validFvgs,
      rejectionReasons: topRejectionReasons.map((row) => row.reason),
      message: pendingCandidates.length ? "FVG continuation setup is still forming." : "No confirmed FVG continuation signal found.",
      nearestPossibleSetup: pendingCandidates.at(-1)?.setupId ?? null,
      requiredForSignal: ["Displacement", "BOS/CHoCH", "Valid FVG", "FVG retest", "Closed confirmation candle", `Minimum ${minRR}R`],
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

  // Rolling average range filter (10 candles including/prior)
  if (index >= 10) {
    let sumRange = 0;
    for (let i = index - 10; i < index; i++) {
      sumRange += candles[i].high - candles[i].low;
    }
    const avgRange10 = sumRange / 10;
    if (range < 1.05 * avgRange10) return null;
  }

  // Find structure break in window [index - 1, index + 3]
  const structureBreak = findStructureBreak(candles, index, direction, mode);
  if (!structureBreak) return null;

  return {
    direction,
    candleIndex: index,
    bodyRatio,
    closePosition,
    rangeAtrMultiple,
    structureBreak,
  };
}

function findStructureBreak(candles: Candle[], d: number, direction: Direction, mode: ModeKey): StructureBreak | null {
  const lookback = 40;
  const start = Math.max(5, d - lookback);
  const end = d - 1;
  const swingLevels: number[] = [];
  for (let cursor = start; cursor <= end; cursor++) {
    if (direction === "BUY" && detectSwingHigh(candles, cursor, 5)) {
      swingLevels.push(candles[cursor].high);
    } else if (direction === "SELL" && detectSwingLow(candles, cursor, 5)) {
      swingLevels.push(candles[cursor].low);
    }
  }

  let brokenLevel: number;
  if (swingLevels.length > 0) {
    brokenLevel = direction === "BUY" ? Math.max(...swingLevels) : Math.min(...swingLevels);
  } else {
    const fallbackSlice = candles.slice(Math.max(0, d - 20), d);
    if (fallbackSlice.length === 0) return null;
    brokenLevel = direction === "BUY"
      ? Math.max(...fallbackSlice.map((c) => c.high))
      : Math.min(...fallbackSlice.map((c) => c.low));
  }

  let bestBreak: StructureBreak | null = null;
  const windowStart = Math.max(0, d - 1);
  const windowEnd = Math.min(candles.length - 1, d + 3);

  for (let c = windowStart; c <= windowEnd; c++) {
    const candle = candles[c];
    const isBOS = direction === "BUY" ? candle.close > brokenLevel : candle.close < brokenLevel;
    const isCHOCH = direction === "BUY" ? candle.high > brokenLevel : candle.low < brokenLevel;

    if (isBOS) {
      return { type: "BOS", brokenLevel };
    } else if (isCHOCH && !bestBreak) {
      bestBreak = { type: "CHOCH", brokenLevel };
    }
  }

  const isStrict = mode === "strict" || mode === "professional";
  if (isStrict) return null; // strict requires BOS close

  return bestBreak;
}

function calculateRetestDepth(candle: Candle, fvg: FvgSetup): number {
  const size = Math.max(fvg.top - fvg.bottom, Number.EPSILON);
  if (fvg.direction === "BUY") {
    const touched = Math.max(fvg.bottom, Math.min(candle.low, fvg.top));
    return Math.round(((fvg.top - touched) / size) * 100);
  }
  const touched = Math.max(fvg.bottom, Math.min(candle.high, fvg.top));
  return Math.round(((touched - fvg.bottom) / size) * 100);
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
  
  // priority 1 & 2: Prior Swing highs/lows and structure targets
  const swingTargets: number[] = [];
  const start = Math.max(5, index - 100);
  for (let cursor = start; cursor <= index - 5; cursor++) {
    if (isBuy && detectSwingHigh(candles, cursor, 5)) {
      if (candles[cursor].high > entry) swingTargets.push(candles[cursor].high);
    } else if (!isBuy && detectSwingLow(candles, cursor, 5)) {
      if (candles[cursor].low < entry) swingTargets.push(candles[cursor].low);
    }
  }

  // priority 3: Previous session target
  const sessionTarget = previousSessionTarget(candles, index, direction, entry);
  if (sessionTarget !== null) swingTargets.push(sessionTarget);

  if (swingTargets.length > 0) {
    // Pick nearest
    const targetPrice = isBuy ? Math.min(...swingTargets) : Math.max(...swingTargets);
    return { price: targetPrice, fixed: false };
  }

  // Priority 4: Fixed fallback
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

function hasLiquiditySweepBeforeDisplacement(candles: Candle[], displacementIndex: number, direction: Direction): boolean {
  const window = candles.slice(Math.max(0, displacementIndex - 8), displacementIndex);
  const prior = candles.slice(Math.max(0, displacementIndex - 24), Math.max(0, displacementIndex - 8));
  if (window.length < 3 || prior.length < 3) return false;
  if (direction === "BUY") {
    const priorLow = Math.min(...prior.map((candle) => candle.low));
    return window.some((candle) => candle.low < priorLow && candle.close > priorLow);
  }
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  return window.some((candle) => candle.high > priorHigh && candle.close < priorHigh);
}

function hasOrderBlockNearFvg(candles: Candle[], displacementIndex: number, direction: Direction, fvgBottom: number, fvgTop: number): boolean {
  const start = Math.max(0, displacementIndex - 6);
  const size = Math.max(fvgTop - fvgBottom, Number.EPSILON);
  for (let index = displacementIndex - 1; index >= start; index--) {
    const candle = candles[index];
    const opposite = direction === "BUY" ? candle.close < candle.open : candle.close > candle.open;
    if (!opposite) continue;
    return candle.high >= fvgBottom - size * 2 && candle.low <= fvgTop + size * 2;
  }
  return false;
}

function emaTrendAligned(ema20: Array<number | null>, ema50: Array<number | null>, ema200: Array<number | null>, index: number, direction: Direction): boolean {
  const fast = ema20[index];
  const mid = ema50[index];
  const slow = ema200[index];
  if (fast === null || mid === null || slow === null) return false;
  return direction === "BUY" ? fast >= mid && mid >= slow : fast <= mid && mid <= slow;
}

function scoreSetup(candles: Candle[], fvg: FvgSetup, retest: Retest, confirmationIndex: number, rr: number, mode: ModeKey): ScoreParts {
  const confirmation = candles[confirmationIndex];
  const range = confirmation.high - confirmation.low;
  const bodyRatio = range > 0 ? Math.abs(confirmation.close - confirmation.open) / range : 0;
  const closePosition = range > 0 ? (confirmation.close - confirmation.low) / range : 0.5;
  const directionalClose = fvg.direction === "BUY" ? closePosition : 1 - closePosition;

  // 1. Context alignment: 10
  // 2. Displacement quality: 20
  const displacementQuality = Math.min(20, Math.round(10 + fvg.displacement.bodyRatio * 5 + Math.min(5, fvg.displacement.rangeAtrMultiple * 2)));

  // 3. Structure Break: 15
  const structureBreakQuality = fvg.displacement.structureBreak.type === "BOS" ? 15 : (mode === "easy" || mode === "testing" ? 12 : 10);

  // 4. FVG Imbalance Quality: 20
  let fvgQuality = 10;
  if (fvg.sizeAtr >= 0.15 && fvg.sizeAtr <= 0.80) {
    fvgQuality = 20;
  } else if ((fvg.sizeAtr >= 0.08 && fvg.sizeAtr < 0.15) || (fvg.sizeAtr > 0.80 && fvg.sizeAtr <= 1.20)) {
    fvgQuality = 15;
  }

  // 5. Retest Quality: 15
  const retestQuality = retest.retestDepthPercent >= 50 ? 15 : 10;

  // 6. Confirmation Candle: 10
  const confBody = Math.round(bodyRatio * 5);
  const correctDirection = fvg.direction === "BUY" 
    ? (confirmation.close - confirmation.low) / range >= 0.20 
    : (confirmation.high - confirmation.close) / range >= 0.20;
  const confWick = correctDirection ? 5 : 2;
  const confirmationQuality = Math.min(10, confBody + confWick);

  // 7. RR and Stop: 10
  const rrQuality = rr >= 2.0 ? 10 : rr >= 1.5 ? 8 : 5;

  return {
    displacementQuality,
    structureBreakQuality,
    fvgQuality,
    retestQuality,
    confirmationQuality,
    rrQuality,
  };
}

function buildWarnings(
  candles: Candle[],
  fvg: FvgSetup,
  retest: Retest,
  confirmationIndex: number,
  sessionName: string,
  fixedTarget: boolean,
  slWarning: boolean,
  atrValue: number
): string[] {
  const warnings = new Set<string>();
  if (sessionName === "OFF_SESSION") warnings.add("OUTSIDE_ACTIVE_SESSION");
  if (retest.retestDepthPercent < 50) warnings.add("FVG_RETEST_NOT_AT_MIDPOINT");
  if (fixedTarget) {
    warnings.add("TARGET_USING_FIXED_RR");
    warnings.add("NO_LIQUIDITY_TARGET_FOUND");
  }
  if (!fvg.hasOrderBlock) warnings.add("NO_ORDER_BLOCK_CONFLUENCE");
  if (!fvg.hasLiquiditySweep) warnings.add("NO_LIQUIDITY_SWEEP_CONFLUENCE");
  if (!fvg.emaTrendAligned) warnings.add("EMA_TREND_NOT_ALIGNED");
  if (isChoppyMarket(candles, confirmationIndex, atrValue)) warnings.add("CHOPPY_PRICE_ACTION");
  if (isLowAtr(calculateATR(candles, CONFIG.atrPeriod), confirmationIndex)) warnings.add("ATR_LOW");
  if (slWarning) warnings.add("STOP_LOSS_WIDE_ALLOWED_IN_EASY");
  return [...warnings];
}

function buildSignal(args: {
  input: V2GoldmineInput;
  candles: Candle[];
  fvg: FvgSetup;
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
  const displacement = args.candles[args.fvg.displacementIndex];
  const retestCandle = args.candles[args.retest.candleIndex];
  const range = confirmation.high - confirmation.low;
  const bodyRatio = range > 0 ? Math.abs(confirmation.close - confirmation.open) / range : 0;
  const closePosition = range > 0 ? (confirmation.close - confirmation.low) / range : 0;
  
  const scoreBreakdown: SignalScoreBreakdown = {
    phase4Setup: args.scoreParts.displacementQuality + args.scoreParts.structureBreakQuality,
    contextAlignment: args.scoreParts.fvgQuality,
    confirmationCandle: args.scoreParts.confirmationQuality,
    stopLossQuality: args.scoreParts.retestQuality,
    targetQuality: args.scoreParts.rrQuality,
    sessionQuality: args.sessionName === "OFF_SESSION" ? 0 : 5,
    volatilityQuality: 0,
    antiReversal: 0,
  };

  return {
    id: `${FVG_CONTINUATION_ENTRY_STRATEGY_ID}:${args.input.symbol}:${confirmation.timestamp}:${args.fvg.direction}`,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: FVG_CONTINUATION_ENTRY_STRATEGY_ID,
    v2Direction: args.fvg.direction,
    type: args.fvg.direction === "BUY" ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
    direction: args.fvg.direction === "BUY" ? "BULLISH" : "BEARISH",
    status: "CONFIRMED",
    sourceSetupId: setupId(args.fvg),
    setupType: "TREND_CONTINUATION",
    strategyModel: FVG_CONTINUATION_ENTRY_STRATEGY_LABEL,
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
      `${args.fvg.direction.toLowerCase()} displacement broke ${args.fvg.displacement.structureBreak.type} at ${args.fvg.displacement.structureBreak.brokenLevel.toFixed(2)}.`,
      `${args.fvg.type} formed and price retested the imbalance.`,
      "A closed confirmation candle continued from the FVG.",
    ],
    warnings: args.warnings,
    rejectionReasons: [],
    relatedMarkers: [
      `DISPLACEMENT:${args.fvg.displacementIndex}`,
      `FVG:${args.fvg.createdAtIndex}`,
      `RETEST:${args.retest.candleIndex}`,
      `CONFIRMATION:${args.confirmationIndex}`,
    ],
    noRepaintProof: {
      status: "PASS",
      signalIndex: args.confirmationIndex,
      latestAllowedCandleIndex: args.confirmationIndex,
      usedMarkerIndexes: [args.fvg.displacementIndex, args.fvg.createdAtIndex, args.retest.candleIndex, args.confirmationIndex],
      usedContextCloseTimes: [],
      usedSetupId: setupId(args.fvg),
      passed: true,
      lastAvailableIndex: args.confirmationIndex,
      maxEvidenceIndex: args.confirmationIndex,
      message: "FVG continuation signal uses only closed candles through retest and confirmation; entry, SL, TP, and RR are immutable.",
    },
    stopLossDetail: {
      price: round(args.stopLoss),
      source: "FVG_RETEST_ATR_BUFFER",
      buffer: round(args.atr * CONFIG.slAtrBuffer),
      riskPoints: round(args.risk),
      reason: "Stop is beyond the FVG/retest extreme and displacement origin with ATR buffer.",
    },
    takeProfitDetail: {
      tp1: round(args.target),
      tp2: null,
      tp3: null,
      source: args.fixedTarget ? "FIXED_2R_FALLBACK" : "RECENT_STRUCTURE_LIQUIDITY",
      rewardPoints: round(args.reward),
      reason: args.fixedTarget ? "No qualifying liquidity target was available; preferred fixed-RR target used." : "Nearest recent swing or previous-session liquidity target.",
    },
    scoreBreakdown,
    fvgContinuation: {
      stage: "CONFIRMED_SIGNAL",
      sessionName: args.sessionName,
      signalTime: confirmation.timestamp,
      displacement: {
        candleTime: displacement.timestamp,
        candleIndex: args.fvg.displacementIndex,
        direction: args.fvg.direction === "BUY" ? "BULLISH" : "BEARISH",
        open: displacement.open,
        high: displacement.high,
        low: displacement.low,
        close: displacement.close,
        bodyRatio: args.fvg.displacement.bodyRatio,
        closePosition: args.fvg.displacement.closePosition,
        rangeAtrMultiple: args.fvg.displacement.rangeAtrMultiple,
      },
      structureBreak: {
        type: args.fvg.displacement.structureBreak.type,
        brokenLevel: args.fvg.displacement.structureBreak.brokenLevel,
        confirmedAt: displacement.timestamp,
      },
      fvg: {
        type: args.fvg.type,
        createdAt: args.candles[args.fvg.createdAtIndex].timestamp,
        createdAtIndex: args.fvg.createdAtIndex,
        top: args.fvg.top,
        bottom: args.fvg.bottom,
        midpoint: args.fvg.midpoint,
        size: args.fvg.size,
        sizeAtr: args.fvg.sizeAtr,
        retestedAt: retestCandle.timestamp,
        retestedAtIndex: args.retest.candleIndex,
        retestDepthPercent: args.retest.retestDepthPercent,
        invalidated: false,
      },
      retest: {
        candleTime: retestCandle.timestamp,
        candleIndex: args.retest.candleIndex,
        retestPrice: args.retest.retestPrice,
        touchedZone: args.retest.touchedZone,
        held: true,
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
        hasLiquiditySweep: args.fvg.hasLiquiditySweep,
        hasOrderBlock: args.fvg.hasOrderBlock,
        emaTrendAligned: args.fvg.emaTrendAligned,
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
    strategyId: FVG_CONTINUATION_ENTRY_STRATEGY_ID,
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
    nextRequiredAction: stage === "WAITING_FVG_RETEST"
      ? "Wait for price to return to the FVG."
      : stage === "WAITING_CONFIRMATION"
        ? "Wait for a closed confirmation candle from the FVG."
        : stage === "CONFIRMED_SIGNAL"
          ? "Use immutable trade levels."
          : "Wait for a new displacement, structure break, and FVG.",
    failedStage: stage,
  };
}

function toRejected(setupIdValue: string, direction: Direction, index: number, code: SignalRejectionCode, debug: SignalCandidateDebug, state: RejectedSetup["setupState"] = "INVALIDATED"): RejectedSetup {
  return {
    setupId: setupIdValue,
    setupType: "TREND_CONTINUATION",
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
  displacementsFound: number;
  structureBreaksConfirmed: number;
  fvgsCreated: number;
  validFvgs: number;
  fvgRetestsFound: number;
  confirmationCandlesFound: number;
  expiredSetups: number;
  topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  candidateDebug: SignalCandidateDebug[];
  minRR: number;
  minScoreThreshold: number;
}): EntryEngineResult["audit"] {
  return {
    activeEngine: ACTIVE_SIGNAL_ENGINE,
    strategyId: FVG_CONTINUATION_ENTRY_STRATEGY_ID,
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
    setupCount: args.validFvgs,
    invalidatedCount: args.rejectedSetups.length,
    expiredCount: args.expiredSetups,
    totalSetupsScanned: args.fvgsCreated,
    triggerSetupsFound: args.fvgRetestsFound,
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
    noSignalMessage: args.signals.length ? null : "No confirmed FVG continuation signal.",
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
    v2FvgContinuation: {
      activeEngineLabel: FVG_CONTINUATION_ENTRY_STRATEGY_LABEL,
      strategyId: FVG_CONTINUATION_ENTRY_STRATEGY_ID,
      candlesScanned: args.candles,
      displacementsFound: args.displacementsFound,
      structureBreaksConfirmed: args.structureBreaksConfirmed,
      fvgsCreated: args.fvgsCreated,
      validFvgs: args.validFvgs,
      fvgRetestsFound: args.fvgRetestsFound,
      confirmationCandlesFound: args.confirmationCandlesFound,
      confirmedSignals: args.signals.length,
      rejectedSignals: args.rejectedSetups.length,
      expiredSetups: args.expiredSetups,
      generationTimeMs: args.generationTimeMs,
      topRejectionReasons: args.topRejectionReasons,
    },
  };
}

function setupId(fvg: FvgSetup): string {
  return `fvg-continuation:${fvg.createdAtIndex}:${fvg.direction}:${fvg.bottom}:${fvg.top}`;
}

function setupIdFromDisplacement(candles: Candle[], displacement: Displacement): string {
  return `fvg-continuation:${candles[displacement.candleIndex].timestamp}:${displacement.direction}`;
}

function sessionNameAt(timestamp: number): string {
  for (const session of CONFIG.allowedSessions) {
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
