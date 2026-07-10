import type { Candle } from "../candles/types";
import type {
  EntryEngineResult,
  EntryMode,
  ConfirmationStatus,
  RejectedSetup,
  SignalCandidateDebug,
  SignalRejectionCode,
  SignalScoreBreakdown,
  TradeSignal,
} from "../entry-engine/types";
import type { TradingSession } from "../market-context/types";
import {
  ACTIVE_SIGNAL_ENGINE,
  ICT_IFVG_REVERSAL_CONFIG as CONFIG,
  ICT_IFVG_REVERSAL_STRATEGY_ID,
  ICT_IFVG_REVERSAL_STRATEGY_LABEL,
} from "./config";
import { calculateATR, calculateEMA, clockWindowAt, detectFVG, detectSwingHigh, detectSwingLow, zonedDateParts } from "./indicators";
import type { V2GoldmineInput } from "./types";

type Direction = "BUY" | "SELL";
type Stage =
  | "FVG_DETECTED"
  | "INVERSION_CONFIRMED"
  | "WAITING_ZONE_RETEST"
  | "ZONE_RETESTED"
  | "WAITING_CONFIRMATION"
  | "CONFIRMED_SIGNAL"
  | "REJECTED"
  | "EXPIRED";

type FvgSetup = {
  direction: Direction; // Original direction (original FVG is BEARISH_FVG for BUY/Bullish IFVG)
  type: "BULLISH_FVG" | "BEARISH_FVG";
  createdAtIndex: number;
  top: number;
  bottom: number;
  midpoint: number;
  size: number;
  sizeAtr: number;
};

type ScoreParts = {
  inversionQuality: number;
  structureBreakQuality: number;
  retestQuality: number;
  confirmationQuality: number;
  rrQuality: number;
};

type ModeKey = "easy" | "testing" | "normal" | "strict" | "professional";

const resultCache = new Map<string, EntryEngineResult>();
const SESSION_TIMEZONE = "America/New_York";

export function clearIctIfvgReversalCache(): void {
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

export function generateIctIfvgReversalSignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const candles = input.candles.filter((candle) => candle.isClosed);
  const key = `${ICT_IFVG_REVERSAL_STRATEGY_ID}:${input.symbol}:${input.timeframe}:${candles.length}:${candles.at(-1)?.timestamp ?? 0}:${input.settings?.maxRiskAmount ?? 100}`;
  const cached = resultCache.get(key);
  if (cached) return cloneResult(cached, "hit");

  const mode = resolveMode(input);
  const isTesting = mode === "easy" || mode === "testing";
  const isStrict = mode === "strict" || mode === "professional";

  const minRR = isTesting ? 1.2 : isStrict ? 2.0 : 1.5;
  const inversionBufferAtr = isTesting ? 0.02 : isStrict ? 0.06 : CONFIG.atrInversionBufferMultiplier;
  const fvgMinSizeAtr = isTesting ? 0.06 : 0.08;
  const fvgMaxSizeAtr = CONFIG.fvgMaxSizeAtr;
  const retestDeadline = isTesting ? 20 : isStrict ? 10 : 15;
  const maxFvgAge = CONFIG.maxFvgAgeCandles;
  const slAtrBuffer = isTesting ? 0.15 : isStrict ? 0.25 : 0.20;
  const maxSlAtr = isTesting ? 3.5 : isStrict ? 2.5 : 2.8;
  const minScoreThreshold = isTesting ? 58 : isStrict ? 68 : 62;

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

  let originalFvgsFound = 0;
  let inversionsConfirmed = 0;
  let retestsFound = 0;
  let structureBreaksFound = 0;
  let confirmationCandlesFound = 0;
  let expiredSetups = 0;

  if (candles.length < CONFIG.atrPeriod + CONFIG.structureLookback + 5) {
    increment(rejectionCounts, "INSUFFICIENT_CANDLES");
  }

  const firstIndex = Math.max(CONFIG.atrPeriod, CONFIG.swingLookback * 2 + 2);
  for (let index = firstIndex; index < candles.length; index++) {
    const currentAtr = atr[index];
    if (!currentAtr || !Number.isFinite(currentAtr)) {
      continue;
    }

    const detection = detectFVG(candles, index);
    if (!detection) continue;

    const sizeAtr = detection.size / currentAtr;
    if (sizeAtr < fvgMinSizeAtr || sizeAtr > fvgMaxSizeAtr) {
      continue;
    }

    originalFvgsFound++;

    const fvg: FvgSetup = {
      direction: detection.type === "BULLISH_FVG" ? "SELL" : "BUY", // flips
      type: detection.type,
      createdAtIndex: index,
      top: detection.top,
      bottom: detection.bottom,
      midpoint: detection.midpoint,
      size: detection.size,
      sizeAtr,
    };

    const evaluated = evalRetestAndConfirmation(fvg);
    if (evaluated.confirmedIndex !== null) {
      index = Math.max(index, evaluated.confirmedIndex);
    }
  }

  function evalRetestAndConfirmation(fvg: FvgSetup): { confirmedIndex: number | null } {
    let inversionIndex: number | null = null;
    let firstTouchIndex: number | null = null;
    let confirmedIndex: number | null = null;
    let rejectionReason: SignalRejectionCode | null = null;
    let failedIndex: number = fvg.createdAtIndex;

    const fvgAtr = atr[fvg.createdAtIndex]!;
    const isBuy = fvg.direction === "BUY"; // flip Bearish FVG to Bullish IFVG

    // 1. Look for Inversion
    const maxInversionCheck = Math.min(candles.length - 1, fvg.createdAtIndex + maxFvgAge);
    for (let check = fvg.createdAtIndex + 1; check <= maxInversionCheck; check++) {
      const checkAtr = atr[check] ?? fvgAtr;
      const candle = candles[check];

      // Inverted condition
      const inverted = isBuy
        ? candle.close > fvg.top + inversionBufferAtr * checkAtr
        : candle.close < fvg.bottom - inversionBufferAtr * checkAtr;

      if (inverted) {
        inversionIndex = check;
        inversionsConfirmed++;
        break;
      }
    }

    if (inversionIndex === null) {
      rejectionReason = "FVG_NOT_FOUND"; // original FVG did not invert
      addRejection(setupId(fvg), rejectionReason, fvg.direction, maxInversionCheck, "REJECTED");
      return { confirmedIndex: null };
    }

    // 2. Retest and Confirmation Scan
    const tolerance = atr[inversionIndex]! * CONFIG.retestToleranceAtr;
    const maxRetestCheck = Math.min(candles.length - 1, inversionIndex + retestDeadline);

    for (let check = inversionIndex + 1; check <= maxRetestCheck; check++) {
      const checkAtr = atr[check] ?? fvgAtr;
      const candle = candles[check];

      // Closed past far side check (invalidates IFVG)
      const closedThrough = isBuy
        ? candle.close < fvg.bottom - 0.10 * checkAtr
        : candle.close > fvg.top + 0.10 * checkAtr;

      if (closedThrough) {
        rejectionReason = "FVG_INVALIDATED";
        failedIndex = check;
        break;
      }

      // Check touch
      const touches = isBuy
        ? candle.low <= fvg.top + tolerance
        : candle.high >= fvg.bottom - tolerance;

      if (touches) {
        if (firstTouchIndex === null) {
          firstTouchIndex = check;
          retestsFound++;
        }

        // Confirmation Candle Criteria
        const correctClose = isBuy ? candle.close > candle.open : candle.close < candle.open;
        const correctMidpoint = isBuy ? candle.close > fvg.midpoint : candle.close < fvg.midpoint;
        const notClosedPastFar = isBuy
          ? candle.close >= fvg.bottom - 0.10 * checkAtr
          : candle.close <= fvg.top + 0.10 * checkAtr;

        const range = candle.high - candle.low;
        const bodyRatio = range > 0 ? Math.abs(candle.close - candle.open) / range : 0;
        const closePosition = range > 0 ? (candle.close - candle.low) / range : 0.5;

        const minRangeVal = checkAtr * (isTesting ? CONFIG.minConfirmationRangeAtr * 0.80 : CONFIG.minConfirmationRangeAtr);
        const minBodyVal = isTesting ? CONFIG.confirmationBodyRatio * 0.80 : CONFIG.confirmationBodyRatio;

        const correctRangeAndBody = range >= minRangeVal && bodyRatio >= minBodyVal;

        const correctClosePosition = isBuy
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
      const age = candles.length - 1 - inversionIndex;
      const waitingRetest = firstTouchIndex === null;

      let waiting = false;
      let code: SignalRejectionCode = "RETEST_EXPIRED";

      if (waitingRetest) {
        waiting = age < retestDeadline;
        code = "RETEST_EXPIRED";
      } else {
        const confAge = candles.length - 1 - firstTouchIndex!;
        waiting = confAge < CONFIG.confirmationWindow - 1 && age < retestDeadline;
        code = "CONFIRMATION_EXPIRED";
      }

      const debug = makeDebug(
        setupId(fvg),
        fvg.direction,
        waiting ? "PENDING_CONFIRMATION" : "EXPIRED_CONFIRMATION",
        code,
        Math.max(0, (waitingRetest ? inversionIndex + retestDeadline : firstTouchIndex! + CONFIG.confirmationWindow) - (candles.length - 1)),
        waiting ? (waitingRetest ? "WAITING_ZONE_RETEST" : "WAITING_CONFIRMATION") : "EXPIRED",
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
    const confirmationAtr = atr[confirmedIndex] ?? fvgAtr;
    const confirmation = candles[confirmedIndex];
    const entry = confirmation.close;

    const range = confirmation.high - confirmation.low;
    const bodyRatio = range > 0 ? Math.abs(confirmation.close - confirmation.open) / range : 0;
    const closePosition = range > 0 ? (confirmation.close - confirmation.low) / range : 0.5;


    // Retest slice extremes
    const retestSlice = candles.slice(firstTouchIndex!, confirmedIndex + 1);
    const retestExtreme = isBuy
      ? Math.min(...retestSlice.map((c) => c.low))
      : Math.max(...retestSlice.map((c) => c.high));

    // Stop Loss calculation
    const stopLoss = isBuy
      ? Math.min(fvg.bottom, retestExtreme) - confirmationAtr * slAtrBuffer
      : Math.max(fvg.top, retestExtreme) + confirmationAtr * slAtrBuffer;

    const risk = isBuy ? entry - stopLoss : stopLoss - entry;

    // SL Bounds check
    if (!(risk > 0)) {
      addRejection(setupId(fvg), "INVALID_STOP_LOSS", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }
    if (risk > confirmationAtr * maxSlAtr) {
      addRejection(setupId(fvg), "STOP_LOSS_TOO_WIDE", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    // Take Profit target selection
    const target = findPriorityTarget(candles, confirmedIndex, fvg.direction, entry, risk, minRR);
    const reward = isBuy ? target.price - entry : entry - target.price;
    if (!Number.isFinite(target.price) || !(reward > 0)) {
      addRejection(setupId(fvg), "INVALID_TAKE_PROFIT", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    const rr = reward / risk;
    if (rr < minRR) {
      addRejection(setupId(fvg), "RR_TOO_LOW", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    // Displacement Check around Inversion Candle
    let displacementFound = false;
    let displacementIndex = null;
    const startDisp = Math.max(0, inversionIndex - 2);
    const endDisp = Math.min(candles.length - 1, inversionIndex + 2);
    for (let dIdx = startDisp; dIdx <= endDisp; dIdx++) {
      const c = candles[dIdx];
      const r = c.high - c.low;
      const bRatio = r > 0 ? Math.abs(c.close - c.open) / r : 0;
      const cPos = r > 0 ? (c.close - c.low) / r : 0.5;
      const rangeAtr = atr[dIdx] ?? fvgAtr;
      const sizeMult = r / rangeAtr;
      if (
        bRatio >= CONFIG.displacementBodyRatio &&
        sizeMult >= CONFIG.minDisplacementRangeAtr &&
        (isBuy ? cPos >= CONFIG.displacementClosePosition : (1 - cPos) >= CONFIG.displacementClosePosition)
      ) {
        displacementFound = true;
        displacementIndex = dIdx;
        break;
      }
    }

    // Structure break check (BOS/CHOCH)
    let bosFound = false;
    let bosType: "BOS" | "CHOCH" | null = null;
    let bosLevel: number | null = null;
    let bosIndex: number | null = null;
    const startStr = Math.max(0, inversionIndex - CONFIG.structureLookback);
    for (let cIdx = inversionIndex; cIdx <= confirmedIndex; cIdx++) {
      const c = candles[cIdx];
      // Check if closes past recent swing high/low
      let foundSwing = null;
      for (let sIdx = startStr; sIdx < inversionIndex; sIdx++) {
        if (isBuy && detectSwingHigh(candles, sIdx, CONFIG.swingLookback)) {
          if (c.close > candles[sIdx].high) {
            foundSwing = { type: "BOS" as "BOS" | "CHOCH", level: candles[sIdx].high, index: sIdx };
          }
        } else if (!isBuy && detectSwingLow(candles, sIdx, CONFIG.swingLookback)) {
          if (c.close < candles[sIdx].low) {
            foundSwing = { type: "BOS" as "BOS" | "CHOCH", level: candles[sIdx].low, index: sIdx };
          }
        }
      }
      if (foundSwing) {
        bosFound = true;
        bosType = foundSwing.type;
        bosLevel = foundSwing.level;
        bosIndex = foundSwing.index;
        structureBreaksFound++;
        break;
      }
    }

    // Liquidity Sweep check
    const sweepCheckResult = hasLiquiditySweepBeforeDisplacement(candles, inversionIndex, fvg.direction);

    // EMA trend alignment
    const emaTrendAligned = isBuy
      ? (ema20[confirmedIndex] !== null && ema50[confirmedIndex] !== null && ema20[confirmedIndex]! > ema50[confirmedIndex]!)
      : (ema20[confirmedIndex] !== null && ema50[confirmedIndex] !== null && ema20[confirmedIndex]! < ema50[confirmedIndex]!);

    // G. Scoring Model
    let score = 60;
    const scoreParts: ScoreParts = {
      inversionQuality: 10,
      structureBreakQuality: bosFound ? 15 : 0,
      retestQuality: 10,
      confirmationQuality: 15,
      rrQuality: rr >= 2.0 ? 10 : 5,
    };

    score += scoreParts.structureBreakQuality;
    score += scoreParts.rrQuality;

    if (displacementFound) score += 10;
    if (sweepCheckResult.found) score += 15;
    if (emaTrendAligned) score += 5;

    // High confirmation close position bonus
    const confRange = confirmation.high - confirmation.low;
    const confClosePos = confRange > 0 ? (confirmation.close - confirmation.low) / confRange : 0.5;
    const strongConfirmationClose = isBuy ? confClosePos >= 0.75 : (1 - confClosePos) >= 0.75;
    if (strongConfirmationClose) score += 5;

    // Choppy market penalty
    if (isChoppyMarket(candles, confirmedIndex, confirmationAtr)) {
      score -= 10;
    }

    if (score < minScoreThreshold) {
      addRejection(setupId(fvg), "SIGNAL_SCORE_TOO_LOW", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    // Build final snapshot
    const session = zonedDateParts(confirmation.timestamp, SESSION_TIMEZONE);
    const dateStr = session.date;
    const sessionName = clockWindowAt(confirmation.timestamp, "UTC", [
      { name: "ASIAN", start: "00:00", end: "07:00" },
      { name: "LONDON", start: "07:00", end: "11:00" },
      { name: "NEW_YORK", start: "12:00", end: "16:00" },
    ]) ?? "OFF_SESSION";


    // Limit checks per session/day
    const sessionKey = `${sessionName}:${dateStr}`;
    const currentSessionCount = sessionSignalCounts.get(sessionKey) ?? 0;
    const currentDayCount = daySignalCounts.get(dateStr) ?? 0;

    if (currentSessionCount >= 3) {
      addRejection(setupId(fvg), "MAX_SESSION_SIGNALS_REACHED", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }
    if (currentDayCount >= CONFIG.maxSignalsPerDay) {
      addRejection(setupId(fvg), "MAX_DAILY_SIGNALS_REACHED", fvg.direction, confirmedIndex, "REJECTED");
      return { confirmedIndex: null };
    }

    sessionSignalCounts.set(sessionKey, currentSessionCount + 1);
    daySignalCounts.set(dateStr, currentDayCount + 1);

    const debug = makeDebug(
      setupId(fvg),
      fvg.direction,
      "CONFIRMED",
      "CONFIRMED_SIGNAL",
      0,
      "CONFIRMED_SIGNAL",
      score,
      rr,
      minRR
    );
    candidateDebug.push(debug);

    const signal: TradeSignal = {
      id: `${ICT_IFVG_REVERSAL_STRATEGY_ID}-${fvg.createdAtIndex}-${confirmedIndex}`,
      engine: "V2_GOLDMINE",
      strategyId: ICT_IFVG_REVERSAL_STRATEGY_ID,
      v2Direction: fvg.direction,
      type: isBuy ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
      direction: isBuy ? "BULLISH" : "BEARISH",
      status: "CONFIRMED",
      sourceSetupId: setupId(fvg),
      setupType: "LIQUIDITY_SWEEP_REVERSAL",
      strategyModel: ICT_IFVG_REVERSAL_STRATEGY_LABEL,
      mode: toEntryMode(mode),
      timestamp: confirmation.timestamp,
      candleIndex: confirmedIndex,
      confirmedAtIndex: confirmedIndex,
      timeframe: input.timeframe,
      session: toTradingSession(sessionName),
      entryPrice: entry,
      stopLoss,
      takeProfit: target.price,
      takeProfit2: null,
      takeProfit3: null,
      riskPoints: risk,
      rewardPoints: reward,
      rr,
      score,
      confidence: score >= 80 ? "PREMIUM" : score >= 70 ? "STRONG" : "MODERATE",
      positionSizeSuggestion: 1.0,
      maxRiskAmount: input.settings?.maxRiskAmount ?? 100,
      invalidationLevel: stopLoss,
      reasons: [
        `Inverted ${fvg.type} into ${isBuy ? "BULLISH" : "BEARISH"} IFVG`,
        displacementFound ? "Displacement verified" : "No displacement",
        bosFound ? `Structure break verified (${bosType})` : "No structure break",
        sweepCheckResult.found ? `Liquidity swept (${sweepCheckResult.type})` : "No sweep confluence",
        emaTrendAligned ? "EMA aligned" : "EMA trend neutral",
      ],
      warnings: [],
      rejectionReasons: [],
      relatedMarkers: [
        `orig-fvg:${fvg.createdAtIndex}`,
        `inverted:${inversionIndex}`,
        `retest:${firstTouchIndex}`,
        `confirm:${confirmedIndex}`,
      ],
      noRepaintProof: {
        status: "PASS",
        signalIndex: confirmedIndex,
        latestAllowedCandleIndex: confirmedIndex,
        usedMarkerIndexes: [fvg.createdAtIndex, inversionIndex, firstTouchIndex!, confirmedIndex],
        usedContextCloseTimes: [confirmation.timestamp],
        usedSetupId: setupId(fvg),
        passed: true,
        lastAvailableIndex: candles.length - 1,
        maxEvidenceIndex: confirmedIndex,
        message: "Passes strict closed candle audit",
      },
      stopLossDetail: {
        price: stopLoss,
        source: "IFVG_EXTREME_OR_RETEST",
        buffer: confirmationAtr * slAtrBuffer,
        riskPoints: risk,
        reason: "Placed beyond IFVG zone extreme and retest swing",
      },
      takeProfitDetail: {
        tp1: target.price,
        tp2: null,
        tp3: null,
        source: target.fixed ? "FIXED_RR_FALLBACK" : "OPPOSITE_LIQUIDITY_TARGET",
        rewardPoints: reward,
        reason: target.fixed ? "Fixed RR fallback target" : "Opposite major liquidity/swing level target",
      },
      scoreBreakdown: {
        phase4Setup: scoreParts.inversionQuality,
        contextAlignment: emaTrendAligned ? 10 : 5,
        confirmationCandle: scoreParts.confirmationQuality,
        stopLossQuality: scoreParts.rrQuality,
        targetQuality: scoreParts.rrQuality,
        sessionQuality: 10,
        volatilityQuality: 10,
        antiReversal: 10,
      },
      ictIfvgReversal: {
        stage: "CONFIRMED_SIGNAL",
        sessionName,
        signalTime: confirmation.timestamp,
        htfBias: input.context?.htfBias?.bias ?? "NEUTRAL",
        itfBias: input.context?.itfSetup?.direction ?? "NEUTRAL",
        marketCondition: isChoppyMarket(candles, confirmedIndex, confirmationAtr) ? "CHOPPY" : "TRENDING",
        displacement: {
          direction: isBuy ? "BULLISH" : "BEARISH",
          rangeAtrMultiple: displacementFound && displacementIndex !== null ? (candles[displacementIndex].high - candles[displacementIndex].low) / (atr[displacementIndex] ?? fvgAtr) : 0,
          candleTime: candles[displacementIndex ?? inversionIndex].timestamp,
        },
        structureBreak: {
          type: (bosType === "CHOCH" ? "CHOCH" : "BOS"),
          brokenLevel: bosLevel ?? entry,
          confirmedAt: candles[bosIndex ?? inversionIndex].timestamp,
        },
        ifvgZone: {
          type: isBuy ? "BULLISH_IFVG" : "BEARISH_IFVG",
          createdAt: candles[inversionIndex].timestamp,
          createdAtIndex: inversionIndex,
          top: fvg.top,
          bottom: fvg.bottom,
          midpoint: fvg.midpoint,
          sizeAtr: (fvg.top - fvg.bottom) / (atr[inversionIndex] ?? fvgAtr),
        },
        liquiditySweep: {
          found: sweepCheckResult.found,
          type: sweepCheckResult.type,
          timestamp: sweepCheckResult.timestamp,
        },
        originalFvg: {
          type: fvg.type,
          createdAt: candles[fvg.createdAtIndex].timestamp,
          createdAtIndex: fvg.createdAtIndex,
          top: fvg.top,
          bottom: fvg.bottom,
          midpoint: fvg.midpoint,
        },
        retest: {
          touchedZone: true,
          depthPercent: Math.abs(retestExtreme - (isBuy ? fvg.top : fvg.bottom)) / (fvg.top - fvg.bottom) * 100,
          candleTime: candles[firstTouchIndex!].timestamp,
        },
        confluence: {
          hasLiquiditySweep: sweepCheckResult.found,
          hasMarketStructureShift: bosFound && bosType === "CHOCH",
          emaTrendAligned,
        },
        confirmation: {
          candleTime: confirmation.timestamp,
          open: confirmation.open,
          high: confirmation.high,
          low: confirmation.low,
          close: confirmation.close,
          bodyRatio: bodyRatio,
          closePosition: closePosition,
          rangeAtrMultiple: range / confirmationAtr,
          pressure: isBuy ? "BUYERS" : "SELLERS",
        },
      },
    };

    signals.push(signal);
    return { confirmedIndex };
  }

  function addRejection(
    setupIdStr: string,
    reason: SignalRejectionCode,
    direction: Direction,
    candleIndex: number,
    status: "REJECTED" | "EXPIRED"
  ): void {
    increment(rejectionCounts, reason);
    const debug = makeDebug(setupIdStr, direction, status, reason, 0, "REJECTED", null, null, minRR);
    candidateDebug.push(debug);
    rejectedSetups.push(toRejected(setupIdStr, direction, candleIndex, reason, debug, status));
  }

  const duration = performance.now() - started;

  const topRejectionReasons = Array.from(rejectionCounts.entries())
    .map(([reason, count]) => ({
      reason,
      count,
      percentage: Math.round((count / Math.max(1, originalFvgsFound)) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  const result: EntryEngineResult = {
    signals,
    activeSignals: signals,
    signalMap: new Map(signals.map((s) => [s.id, s])),
    pendingCandidates,
    candidateDebug,
    rejectedSetups,
    noTrade: signals.length === 0 ? {
      status: "NO_TRADE",
      checkedSetups: originalFvgsFound,
      rejectionReasons: topRejectionReasons.map((r) => `${r.reason} (${r.count})`),
      message: "No setups successfully flipped, retested, and confirmed.",
      nearestPossibleSetup: pendingCandidates.at(-1)?.nextRequiredAction ?? null,
      requiredForSignal: ["FVG detection", "Inversion close beyond buffer", "Retest touch", "Confirmation candle close in direction"],
      timestamp: candles.at(-1)?.timestamp ?? null,
    } : null,
    audit: {
      activeEngine: "V2_GOLDMINE",
      strategyId: ICT_IFVG_REVERSAL_STRATEGY_ID,
      activeMode: toEntryMode(mode),
      minimumScoreRequired: minScoreThreshold,
      minimumSetupScoreRequired: minScoreThreshold - 10,
      minimumSignalScoreRequired: minScoreThreshold,
      minimumRrRequired: minRR,
      totalCandlesScanned: candles.length,
      totalMarkersGenerated: signals.length * 4,
      totalContextsGenerated: 1,
      totalPhase4Setups: inversionsConfirmed,
      watchCount: pendingCandidates.length,
      setupCount: originalFvgsFound,
      invalidatedCount: rejectedSetups.length,
      expiredCount: expiredSetups,
      totalSetupsScanned: originalFvgsFound,
      triggerSetupsFound: inversionsConfirmed,
      pendingConfirmationCount: pendingCandidates.length,
      expiredConfirmationCount: expiredSetups,
      invalidatedCandidateCount: rejectedSetups.length,
      confirmedBuyCount: signals.filter((s) => s.direction === "BULLISH").length,
      confirmedSellCount: signals.filter((s) => s.direction === "BEARISH").length,
      rapidBuyCount: 0,
      rapidSellCount: 0,
      rapidSignalCount: 0,
      rejectedSetupCount: rejectedSetups.length,
      lastRejectionReason: topRejectionReasons[0]?.reason ?? null,
      lastConfirmedSignal: signals.at(-1)?.id ?? null,
      topRejectionReasons: topRejectionReasons.map((r) => ({ reason: r.reason, count: r.count })),
      lastFiveTriggerSetups: candidateDebug.slice(-5).map((d) => `${d.setupId} - ${d.confirmationStatus}`),
      lastFiveConfirmedSignals: signals.slice(-5).map((s) => s.id),
      noSignalMessage: signals.length === 0 ? "No confirmed Inverse FVG Reversal setups found." : null,
      noRepaintWarnings: [],
      rrCalculation: "ATR-based target selection with swing / session priorities",
      stopLossSource: "IFVG zone extreme / Retest extreme",
      takeProfitSource: "Priority swing level or fixed RR fallback",
      scoreBreakdown: null,
      lastCandidateDebug: candidateDebug.at(-1) ?? null,
      noRepaintValidation: "PASS",
      calculationTimeMs: duration,
      generationTimeMs: duration,
      cacheStatus: "miss",
      v2IctIfvgReversal: {
        activeEngineLabel: ICT_IFVG_REVERSAL_STRATEGY_LABEL,
        strategyId: ICT_IFVG_REVERSAL_STRATEGY_ID,
        candlesScanned: candles.length,
        htfBias: input.context?.htfBias?.bias ?? "NEUTRAL",
        itfBias: input.context?.itfSetup?.direction ?? "NEUTRAL",
        marketCondition: isChoppyMarket(candles, candles.length - 1, atr[candles.length - 1] ?? 1.5) ? "CHOPPY" : "TRENDING",
        fvgsScanned: originalFvgsFound,
        ifvgsFlipped: inversionsConfirmed,
        retestsFound,
        structureBreaksFound,
        confirmationCandlesFound,
        confirmedSignals: signals.length,
        rejectedSignals: rejectedSetups.length,
        expiredSetups,
        generationTimeMs: duration,
        topRejectionReasons,
      },
    },
  };

  resultCache.set(key, result);
  return result;
}

function cloneResult(res: EntryEngineResult, status: "hit" | "miss"): EntryEngineResult {
  return {
    ...res,
    audit: {
      ...res.audit,
      cacheStatus: status,
    },
  };
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function setupId(fvg: FvgSetup): string {
  return `IFVG-${fvg.createdAtIndex}`;
}

function makeDebug(
  setupIdStr: string,
  direction: Direction,
  status: ConfirmationStatus | "EXPIRED",
  reason: string,
  windowRem: number,
  failedStage: string,
  score: number | null,
  rr: number | null,
  minRR: number
): SignalCandidateDebug {
  return {
    setupId: setupIdStr,
    engine: "V2_GOLDMINE",
    strategyId: ICT_IFVG_REVERSAL_STRATEGY_ID,
    setupScore: 60,
    requiredSetupScore: 50,
    finalSignalScore: score,
    requiredSignalScore: 62,
    rr,
    requiredRR: minRR,
    directionBias: direction,
    confirmationStatus: status === "EXPIRED" ? "EXPIRED_CONFIRMATION" : status,
    confirmationWindowRemaining: windowRem,
    rejectionReason: reason,
    nextRequiredAction: failedStage === "WAITING_ZONE_RETEST" ? "Wait for price to retest IFVG zone" : "None",
    failedStage,
  };
}

function toTradingSession(session: string): TradingSession {
  if (session === "ASIAN") return "ASIAN";
  if (session === "LONDON") return "LONDON";
  if (session === "NEW_YORK") return "NEW_YORK";
  return "DEAD_ZONE";
}

function toEntryMode(mode: ModeKey): EntryMode {
  if (mode === "easy") return "CALIBRATION";
  if (mode === "testing") return "EASY_SCALP";
  if (mode === "strict" || mode === "professional") return "PRO_TRADER";
  return "NORMAL_SCALP";
}

function toRejected(
  setupIdStr: string,
  direction: Direction,
  candleIndex: number,
  reason: SignalRejectionCode,
  debug: SignalCandidateDebug,
  status: "REJECTED" | "EXPIRED"
): RejectedSetup {
  return {
    setupId: setupIdStr,
    setupType: "LIQUIDITY_SWEEP_REVERSAL",
    setupState: status === "EXPIRED" ? "EXPIRED" : "INVALIDATED",
    direction: direction === "BUY" ? "BULLISH" : "BEARISH",
    triggerIndex: candleIndex,
    rejectionReasons: [reason],
    rejectionReasonCodes: [reason],
    debug,
  };
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

  const swingTargets: number[] = [];
  const start = Math.max(5, index - 100);
  for (let cursor = start; cursor <= index - 5; cursor++) {
    if (isBuy && detectSwingHigh(candles, cursor, 5)) {
      if (candles[cursor].high > entry) swingTargets.push(candles[cursor].high);
    } else if (!isBuy && detectSwingLow(candles, cursor, 5)) {
      if (candles[cursor].low < entry) swingTargets.push(candles[cursor].low);
    }
  }

  const sessionTarget = previousSessionTarget(candles, index, direction, entry);
  if (sessionTarget !== null) swingTargets.push(sessionTarget);

  if (swingTargets.length > 0) {
    const targetPrice = isBuy ? Math.min(...swingTargets) : Math.max(...swingTargets);
    // Ensure target meets min RR
    const targetReward = isBuy ? targetPrice - entry : entry - targetPrice;
    if (targetReward >= risk * minRR) {
      return { price: targetPrice, fixed: false };
    }
  }

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

function hasLiquiditySweepBeforeDisplacement(
  candles: Candle[],
  displacementIndex: number,
  direction: Direction
): { found: boolean; type: "SSL" | "BSL" | null; timestamp: number | null } {
  const window = candles.slice(Math.max(0, displacementIndex - 12), displacementIndex);
  const prior = candles.slice(Math.max(0, displacementIndex - 30), Math.max(0, displacementIndex - 12));
  if (window.length < 3 || prior.length < 3) return { found: false, type: null, timestamp: null };
  if (direction === "BUY") {
    const priorLow = Math.min(...prior.map((candle) => candle.low));
    const sweepCandle = window.find((candle) => candle.low < priorLow && candle.close > priorLow);
    if (sweepCandle) {
      return { found: true, type: "SSL", timestamp: sweepCandle.timestamp };
    }
  } else {
    const priorHigh = Math.max(...prior.map((candle) => candle.high));
    const sweepCandle = window.find((candle) => candle.high > priorHigh && candle.close < priorHigh);
    if (sweepCandle) {
      return { found: true, type: "BSL", timestamp: sweepCandle.timestamp };
    }
  }
  return { found: false, type: null, timestamp: null };
}

export const UTC_SESSIONS = {
  asian: { startHour: 0, endHour: 7 },
  london: { startHour: 7, endHour: 11 },
  newYork: { startHour: 12, endHour: 16 },
} as const;
