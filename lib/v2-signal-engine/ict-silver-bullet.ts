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
  ICT_SILVER_BULLET_CONFIG as CONFIG,
  ICT_SILVER_BULLET_STRATEGY_ID,
  ICT_SILVER_BULLET_STRATEGY_LABEL,
} from "./config";
import {
  calculateATR,
  detectEqualHighs,
  detectEqualLows,
  detectFVG,
  detectMSS,
  detectSwingHigh,
  detectSwingLow,
  getKillzone,
  zonedDateParts,
} from "./indicators";
import type { V2GoldmineInput } from "./types";

type Direction = "BUY" | "SELL";
type LiquiditySource = "SWING" | "EQUAL_HIGH_LOW" | "PREVIOUS_SESSION" | "ROUND_NUMBER";
type Stage =
  | "KILLZONE_ACTIVE"
  | "LIQUIDITY_LEVEL_FOUND"
  | "LIQUIDITY_SWEEP_DETECTED"
  | "RECLAIM_CONFIRMED"
  | "DISPLACEMENT_CONFIRMED"
  | "MSS_CONFIRMED"
  | "FVG_CREATED"
  | "WAITING_FVG_RETEST"
  | "FVG_RETESTED"
  | "WAITING_CONFIRMATION"
  | "CONFIRMED_SIGNAL"
  | "REJECTED"
  | "EXPIRED";

type LiquidityLevel = {
  type: "SSL" | "BSL";
  source: LiquiditySource;
  level: number;
  detectedAt: number;
  detectedAtIndex: number;
  quality: number;
};

type SweepSetup = {
  id: string;
  direction: Direction;
  killzoneName: string;
  liquidity: LiquidityLevel;
  sweepIndex: number;
  sweepPrice: number;
  sweepDistanceAtr: number;
  sweepExtreme: number;
  atr: number;
};

type Displacement = {
  index: number;
  bodyRatio: number;
  closePosition: number;
  rangeAtrMultiple: number;
};

type StructureShift = {
  type: "MSS" | "CHOCH";
  brokenLevel: number;
  confirmedAt: number;
};

type FvgSetup = {
  index: number;
  type: "BULLISH_FVG" | "BEARISH_FVG";
  bottom: number;
  top: number;
  midpoint: number;
  sizeAtr: number;
};

type FvgRetest = {
  index: number;
  depthPercent: number;
  midpointTouched: boolean;
};

type ScoreParts = {
  killzoneQuality: number;
  liquidityQuality: number;
  sweepQuality: number;
  reclaimQuality: number;
  displacementQuality: number;
  mssQuality: number;
  fvgQuality: number;
  confirmationQuality: number;
  rrQuality: number;
};

const resultCache = new Map<string, EntryEngineResult>();
const ROUND_NUMBER_STEP = 5;
const CHOP_LOOKBACK = 12;

export function clearIctSilverBulletCache(): void {
  resultCache.clear();
}

export function generateIctSilverBulletSignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const candles = input.candles.filter((candle) => candle.isClosed);
  const key = `${ICT_SILVER_BULLET_STRATEGY_ID}:${input.symbol}:${input.timeframe}:${candles.length}:${candles.at(-1)?.timestamp ?? 0}:${input.settings?.maxRiskAmount ?? 100}`;
  const cached = resultCache.get(key);
  if (cached) return cloneResult(cached, "hit");

  const atr = calculateATR(candles, CONFIG.atrPeriod);
  const signals: TradeSignal[] = [];
  const pendingCandidates: SignalCandidateDebug[] = [];
  const candidateDebug: SignalCandidateDebug[] = [];
  const rejectedSetups: RejectedSetup[] = [];
  const rejectionCounts = new Map<string, number>();
  const killzoneSignalCounts = new Map<string, number>();
  const daySignalCounts = new Map<string, number>();
  let killzoneCandles = 0;
  let liquidityLevelsFound = 0;
  let sweepsDetected = 0;
  let reclaimsConfirmed = 0;
  let displacementsFound = 0;
  let mssConfirmed = 0;
  let fvgsCreated = 0;
  let fvgRetestsFound = 0;
  let confirmationCandlesFound = 0;
  let expiredSetups = 0;

  if (candles.length < CONFIG.atrPeriod + CONFIG.swingLookback * 2 + 2) {
    increment(rejectionCounts, "INSUFFICIENT_CANDLES");
  }

  const firstIndex = Math.max(CONFIG.atrPeriod, CONFIG.swingLookback * 2 + 2);
  for (let index = firstIndex; index < candles.length; index++) {
    const candle = candles[index];
    const killzoneName = killzoneAt(candle.timestamp);
    if (!killzoneName) {
      increment(rejectionCounts, "OUTSIDE_KILLZONE");
      continue;
    }
    killzoneCandles++;
    const currentAtr = atr[index];
    if (!currentAtr || !Number.isFinite(currentAtr)) {
      increment(rejectionCounts, "INSUFFICIENT_CANDLES");
      continue;
    }

    const levels = findLiquidityLevels(candles, index, currentAtr);
    liquidityLevelsFound += levels.length;
    if (!levels.length) {
      increment(rejectionCounts, "NO_LIQUIDITY_LEVEL_FOUND");
      continue;
    }

    const setup = bestSweepSetup(candles, index, killzoneName, levels, currentAtr);
    if (!setup) continue;
    sweepsDetected++;

    const evaluated = evaluateSetup(setup);
    if (evaluated !== null) index = Math.max(index, evaluated);
  }

  function evaluateSetup(setup: SweepSetup): number | null {
    if (setup.sweepDistanceAtr < CONFIG.minSweepBufferAtr) {
      addRejection(setup, "SWEEP_TOO_SMALL", setup.sweepIndex, "REJECTED");
      return null;
    }
    if (setup.sweepDistanceAtr > CONFIG.maxSweepDistanceAtr) {
      addRejection(setup, "SWEEP_TOO_LARGE", setup.sweepIndex, "REJECTED");
      return null;
    }

    const reclaimIndex = findReclaimIndex(candles, setup);
    if (reclaimIndex < 0) {
      if (CONFIG.allowNextCandleReclaim && setup.sweepIndex + 1 >= candles.length) {
        addPending(setup, "LIQUIDITY_SWEEP_DETECTED", "NO_RECLAIM_CLOSE", 1);
      } else {
        addRejection(setup, "NO_RECLAIM_CLOSE", setup.sweepIndex, "REJECTED");
      }
      return null;
    }
    reclaimsConfirmed++;

    const displacement = findDisplacement(setup, reclaimIndex);
    if (!displacement) return null;
    displacementsFound++;

    const structureShift = findStructureShift(displacement.index, setup.direction);
    if (!structureShift) {
      addRejection(setup, "NO_MSS_OR_CHOCH", displacement.index, "REJECTED");
      return null;
    }
    mssConfirmed++;

    const fvg = findFvgAfterSweep(setup, displacement.index);
    if (!fvg) return null;
    fvgsCreated++;

    const retest = findFvgRetest(setup, fvg);
    if (!retest) return null;
    fvgRetestsFound++;

    const confirmationIndex = findConfirmation(setup, retest.index);
    if (confirmationIndex < 0) return null;
    confirmationCandlesFound++;

    const confirmation = candles[confirmationIndex];
    const confirmAtr = atr[confirmationIndex] ?? setup.atr;
    const stopLoss = setup.direction === "BUY"
      ? setup.sweepExtreme - confirmAtr * CONFIG.slAtrBuffer
      : setup.sweepExtreme + confirmAtr * CONFIG.slAtrBuffer;
    const risk = setup.direction === "BUY" ? confirmation.close - stopLoss : stopLoss - confirmation.close;
    if (!(risk > 0) || risk > confirmAtr * CONFIG.maxSlAtrMultiple) {
      addRejection(setup, "INVALID_STOP_LOSS", confirmationIndex, "REJECTED");
      return null;
    }

    const target = findTarget(candles, confirmationIndex, setup.direction, confirmation.close, risk, confirmAtr);
    const reward = setup.direction === "BUY" ? target.price - confirmation.close : confirmation.close - target.price;
    if (!Number.isFinite(target.price) || !(reward > 0)) {
      addRejection(setup, "INVALID_TAKE_PROFIT", confirmationIndex, "REJECTED");
      return null;
    }
    const rr = reward / risk;
    if (!Number.isFinite(rr) || rr < CONFIG.minRR) {
      addRejection(setup, "RR_BELOW_MINIMUM", confirmationIndex, "REJECTED");
      return null;
    }

    const local = zonedDateParts(confirmation.timestamp, CONFIG.timezone);
    const sessionKey = `${local.date}:${setup.killzoneName}`;
    if ((killzoneSignalCounts.get(sessionKey) ?? 0) >= CONFIG.maxSignalsPerKillzone) {
      addRejection(setup, "MAX_KILLZONE_SIGNALS_REACHED", confirmationIndex, "REJECTED");
      return null;
    }
    if ((daySignalCounts.get(local.date) ?? 0) >= CONFIG.maxSignalsPerDay) {
      addRejection(setup, "MAX_DAILY_SIGNALS_REACHED", confirmationIndex, "REJECTED");
      return null;
    }

    const warnings = buildWarnings(input, setup, fvg, retest, target.fixed, confirmationIndex);
    const scoreParts = scoreSetup(candles, setup, reclaimIndex, displacement, structureShift, fvg, retest, confirmationIndex, rr);
    const score = Math.min(100, Object.values(scoreParts).reduce((sum, value) => sum + value, 0));
    if (score < CONFIG.minSignalScore) {
      addRejection(setup, "SIGNAL_SCORE_TOO_LOW", confirmationIndex, "REJECTED");
      return null;
    }

    const signal = buildSignal({
      input,
      candles,
      setup,
      reclaimIndex,
      displacement,
      structureShift,
      fvg,
      retest,
      confirmationIndex,
      entry: confirmation.close,
      stopLoss,
      target: target.price,
      fixedTarget: target.fixed,
      risk,
      reward,
      rr,
      score,
      scoreParts,
      atr: confirmAtr,
      warnings,
    });
    signals.push(signal);
    killzoneSignalCounts.set(sessionKey, (killzoneSignalCounts.get(sessionKey) ?? 0) + 1);
    daySignalCounts.set(local.date, (daySignalCounts.get(local.date) ?? 0) + 1);
    candidateDebug.push(debugRow(setup.id, setup.direction, setup.killzoneName, "CONFIRMED", "CONFIRMED_SIGNAL", 0, "CONFIRMED_SIGNAL", score, rr));
    return confirmationIndex;
  }

  function findDisplacement(setup: SweepSetup, reclaimIndex: number): Displacement | null {
    const maxIndex = Math.min(candles.length - 1, setup.sweepIndex + CONFIG.maxCandlesToCreateFvgAfterSweep);
    for (let check = reclaimIndex + 1; check <= maxIndex; check++) {
      if (!sameKillzone(candles[check], setup.killzoneName)) break;
      const checkAtr = atr[check] ?? setup.atr;
      const displacement = displacementCandle(candles[check], checkAtr, setup.direction);
      if (displacement) return { index: check, ...displacement };
    }
    if (candles.length - 1 < maxIndex) {
      addPending(setup, "RECLAIM_CONFIRMED", "NO_DISPLACEMENT", Math.max(0, maxIndex - (candles.length - 1)));
    } else {
      addRejection(setup, "NO_DISPLACEMENT", reclaimIndex, "REJECTED");
    }
    return null;
  }

  function findStructureShift(displacementIndex: number, direction: Direction): StructureShift | null {
    const shift = detectMSS(candles, displacementIndex, direction, CONFIG.swingLookback);
    if (!shift) return null;
    if (CONFIG.requireMSS && shift.type !== "MSS" && !CONFIG.allowChoChInsteadOfMss) return null;
    return { type: shift.type, brokenLevel: shift.brokenLevel, confirmedAt: candles[displacementIndex].timestamp };
  }

  function findFvgAfterSweep(setup: SweepSetup, displacementIndex: number): FvgSetup | null {
    const maxIndex = Math.min(candles.length - 1, setup.sweepIndex + CONFIG.maxCandlesToCreateFvgAfterSweep);
    let sawSmallFvg = false;
    for (let check = displacementIndex; check <= maxIndex; check++) {
      if (!sameKillzone(candles[check], setup.killzoneName)) break;
      const fvg = detectFVG(candles, check);
      if (!fvg) continue;
      if ((setup.direction === "BUY" && fvg.type !== "BULLISH_FVG") || (setup.direction === "SELL" && fvg.type !== "BEARISH_FVG")) continue;
      const sizeAtr = fvg.size / (atr[check] ?? setup.atr);
      if (sizeAtr < CONFIG.fvgMinSizeAtr) {
        sawSmallFvg = true;
        continue;
      }
      return { index: check, type: fvg.type, bottom: fvg.bottom, top: fvg.top, midpoint: fvg.midpoint, sizeAtr };
    }
    if (candles.length - 1 < maxIndex) {
      addPending(setup, "DISPLACEMENT_CONFIRMED", "NO_FVG_CREATED", Math.max(0, maxIndex - (candles.length - 1)));
    } else {
      addRejection(setup, sawSmallFvg ? "FVG_TOO_SMALL" : "NO_FVG_CREATED", displacementIndex, "REJECTED");
    }
    return null;
  }

  function findFvgRetest(setup: SweepSetup, fvg: FvgSetup): FvgRetest | null {
    const deadline = fvg.index + CONFIG.maxCandlesToReturnToFvg;
    const maxIndex = Math.min(candles.length - 1, deadline);
    let killzoneEnded = false;
    for (let check = fvg.index + 1; check <= maxIndex; check++) {
      if (!sameKillzone(candles[check], setup.killzoneName)) {
        killzoneEnded = true;
        break;
      }
      if (!fvgTapped(candles[check], fvg)) continue;
      return { index: check, depthPercent: fvgRetestDepth(candles[check], fvg, setup.direction), midpointTouched: fvgMidpointTouched(candles[check], fvg, setup.direction) };
    }
    if (killzoneEnded || candles.length - 1 >= deadline) {
      expiredSetups++;
      addRejection(setup, "FVG_RETEST_EXPIRED", fvg.index, "EXPIRED");
    } else {
      addPending(setup, "WAITING_FVG_RETEST", "FVG_RETEST_EXPIRED", Math.max(0, deadline - (candles.length - 1)));
    }
    return null;
  }

  function findConfirmation(setup: SweepSetup, retestIndex: number): number {
    const deadline = retestIndex + CONFIG.maxCandlesToConfirmAfterFvgTap;
    const maxIndex = Math.min(candles.length - 1, deadline);
    let weak = false;
    let killzoneEnded = false;
    for (let check = retestIndex + 1; check <= maxIndex; check++) {
      if (!sameKillzone(candles[check], setup.killzoneName)) {
        killzoneEnded = true;
        break;
      }
      if (confirmationCandle(candles[check], atr[check] ?? setup.atr, setup.direction)) return check;
      if (directionalCandle(candles[check], setup.direction)) weak = true;
    }
    if (killzoneEnded || candles.length - 1 >= deadline) {
      expiredSetups++;
      addRejection(setup, weak ? "WEAK_CONFIRMATION_CANDLE" : "CONFIRMATION_EXPIRED", retestIndex, "EXPIRED");
    } else {
      addPending(setup, "WAITING_CONFIRMATION", "WEAK_CONFIRMATION_CANDLE", Math.max(0, deadline - (candles.length - 1)));
    }
    return -1;
  }

  function addPending(setup: SweepSetup, stage: Stage, code: SignalRejectionCode, remaining: number): void {
    const row = debugRow(setup.id, setup.direction, setup.killzoneName, "PENDING_CONFIRMATION", code, remaining, stage);
    pendingCandidates.push(row);
    candidateDebug.push(row);
  }

  function addRejection(setup: SweepSetup, code: SignalRejectionCode, index: number, stage: Stage): void {
    increment(rejectionCounts, code);
    const expired = stage === "EXPIRED";
    const row = debugRow(setup.id, setup.direction, setup.killzoneName, expired ? "EXPIRED_CONFIRMATION" : "REJECTED", code, 0, stage);
    candidateDebug.push(row);
    rejectedSetups.push({
      setupId: setup.id,
      setupType: "LIQUIDITY_SWEEP_REVERSAL",
      setupState: expired ? "EXPIRED" : "INVALIDATED",
      direction: setup.direction === "BUY" ? "BULLISH" : "BEARISH",
      triggerIndex: index,
      rejectionReasons: [code],
      rejectionReasonCodes: [code],
      debug: row,
    });
  }

  const generationTimeMs = performance.now() - started;
  const top = rejectionRows(rejectionCounts);
  const audit = buildAudit({
    candles: candles.length,
    signals,
    pendingCandidates,
    rejectedSetups,
    candidateDebug,
    generationTimeMs,
    killzoneCandles,
    liquidityLevelsFound,
    sweepsDetected,
    reclaimsConfirmed,
    displacementsFound,
    mssConfirmed,
    fvgsCreated,
    fvgRetestsFound,
    confirmationCandlesFound,
    expiredSetups,
    top,
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
      rejectionReasons: top.map((row) => row.reason),
      message: pendingCandidates.length ? "Silver Bullet setup is still forming." : "No confirmed ICT Silver Bullet signal.",
      nearestPossibleSetup: pendingCandidates.at(-1)?.setupId ?? null,
      requiredForSignal: ["Killzone sweep", "Reclaim", "Displacement with MSS/CHoCH", "FVG retest", "Closed confirmation"],
      timestamp: candles.at(-1)?.timestamp ?? null,
    },
    audit,
  };
  if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value ?? "");
  resultCache.set(key, result);
  return result;
}

function findLiquidityLevels(candles: Candle[], index: number, atr: number): LiquidityLevel[] {
  const start = Math.max(0, index - CONFIG.liquidityLookback);
  const levels: LiquidityLevel[] = [];
  for (let cursor = Math.max(CONFIG.swingLookback, start); cursor <= index - CONFIG.swingLookback - 1; cursor++) {
    if (detectSwingLow(candles, cursor, CONFIG.swingLookback)) {
      levels.push({ type: "SSL", source: "SWING", level: candles[cursor].low, detectedAt: candles[cursor].timestamp, detectedAtIndex: cursor, quality: 12 });
    }
    if (detectSwingHigh(candles, cursor, CONFIG.swingLookback)) {
      levels.push({ type: "BSL", source: "SWING", level: candles[cursor].high, detectedAt: candles[cursor].timestamp, detectedAtIndex: cursor, quality: 12 });
    }
  }
  const recent = candles.slice(start, index);
  const tolerance = atr * CONFIG.equalHighLowToleranceAtr;
  for (const equalLow of detectEqualLows(recent, recent.length, tolerance)) {
    levels.push({ type: "SSL", source: "EQUAL_HIGH_LOW", level: equalLow.level, detectedAt: candles[start + equalLow.lastIndex].timestamp, detectedAtIndex: start + equalLow.lastIndex, quality: 15 });
  }
  for (const equalHigh of detectEqualHighs(recent, recent.length, tolerance)) {
    levels.push({ type: "BSL", source: "EQUAL_HIGH_LOW", level: equalHigh.level, detectedAt: candles[start + equalHigh.lastIndex].timestamp, detectedAtIndex: start + equalHigh.lastIndex, quality: 15 });
  }
  levels.push(...previousSessionLevels(candles, index));
  levels.push(...roundNumberLevels(candles[index - 1] ?? candles[index], index));
  return dedupeLevels(levels, atr);
}

function previousSessionLevels(candles: Candle[], index: number): LiquidityLevel[] {
  const currentKillzone = killzoneAt(candles[index].timestamp);
  const prior = candles.slice(0, index).filter((candle) => {
    const killzone = killzoneAt(candle.timestamp);
    return killzone !== null && killzone !== currentKillzone;
  });
  const window = prior.slice(-CONFIG.liquidityLookback);
  if (window.length < 3) return [];
  const high = window.reduce((best, candle) => candle.high > best.high ? candle : best, window[0]);
  const low = window.reduce((best, candle) => candle.low < best.low ? candle : best, window[0]);
  return [
    { type: "BSL", source: "PREVIOUS_SESSION", level: high.high, detectedAt: high.timestamp, detectedAtIndex: candles.indexOf(high), quality: 15 },
    { type: "SSL", source: "PREVIOUS_SESSION", level: low.low, detectedAt: low.timestamp, detectedAtIndex: candles.indexOf(low), quality: 15 },
  ];
}

function roundNumberLevels(reference: Candle, index: number): LiquidityLevel[] {
  const below = Math.floor(reference.close / ROUND_NUMBER_STEP) * ROUND_NUMBER_STEP;
  const above = Math.ceil(reference.close / ROUND_NUMBER_STEP) * ROUND_NUMBER_STEP;
  const levels: LiquidityLevel[] = [];
  if (below > 0) levels.push({ type: "SSL", source: "ROUND_NUMBER", level: below, detectedAt: reference.timestamp, detectedAtIndex: Math.max(0, index - 1), quality: 10 });
  if (above > 0 && above !== below) levels.push({ type: "BSL", source: "ROUND_NUMBER", level: above, detectedAt: reference.timestamp, detectedAtIndex: Math.max(0, index - 1), quality: 10 });
  return levels;
}

function dedupeLevels(levels: LiquidityLevel[], atr: number): LiquidityLevel[] {
  const tolerance = atr * CONFIG.equalHighLowToleranceAtr;
  const sorted = [...levels].sort((a, b) => b.quality - a.quality || b.detectedAt - a.detectedAt);
  const output: LiquidityLevel[] = [];
  for (const level of sorted) {
    if (output.some((item) => item.type === level.type && Math.abs(item.level - level.level) <= tolerance)) continue;
    output.push(level);
  }
  return output;
}

function bestSweepSetup(candles: Candle[], index: number, killzoneName: string, levels: LiquidityLevel[], atr: number): SweepSetup | null {
  const candle = candles[index];
  const setups = levels.flatMap((liquidity): SweepSetup[] => {
    const distance = liquidity.type === "SSL" ? liquidity.level - candle.low : candle.high - liquidity.level;
    if (!(distance > 0)) return [];
    const direction: Direction = liquidity.type === "SSL" ? "BUY" : "SELL";
    return [{
      id: `silver-bullet:${candles[index].timestamp}:${direction}:${round(liquidity.level, 2)}`,
      direction,
      killzoneName,
      liquidity,
      sweepIndex: index,
      sweepPrice: liquidity.type === "SSL" ? candle.low : candle.high,
      sweepDistanceAtr: distance / atr,
      sweepExtreme: liquidity.type === "SSL" ? candle.low : candle.high,
      atr,
    }];
  });
  if (!setups.length) return null;
  return setups.sort((a, b) => {
    const aTradable = a.sweepDistanceAtr >= CONFIG.minSweepBufferAtr && a.sweepDistanceAtr <= CONFIG.maxSweepDistanceAtr ? 1 : 0;
    const bTradable = b.sweepDistanceAtr >= CONFIG.minSweepBufferAtr && b.sweepDistanceAtr <= CONFIG.maxSweepDistanceAtr ? 1 : 0;
    return bTradable - aTradable || b.liquidity.quality - a.liquidity.quality || a.sweepDistanceAtr - b.sweepDistanceAtr;
  })[0];
}

function findReclaimIndex(candles: Candle[], setup: SweepSetup): number {
  if (closesBackThrough(candles[setup.sweepIndex], setup)) return setup.sweepIndex;
  if (!CONFIG.allowNextCandleReclaim) return -1;
  const next = setup.sweepIndex + 1;
  return next < candles.length && closesBackThrough(candles[next], setup) ? next : -1;
}

function closesBackThrough(candle: Candle, setup: SweepSetup): boolean {
  return setup.direction === "BUY" ? candle.close > setup.liquidity.level : candle.close < setup.liquidity.level;
}

function displacementCandle(candle: Candle, atr: number, direction: Direction): Omit<Displacement, "index"> | null {
  const range = candle.high - candle.low;
  if (range <= 0 || range < atr * CONFIG.minDisplacementRangeAtr) return null;
  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  const closePosition = (candle.close - candle.low) / range;
  if (bodyRatio < CONFIG.displacementBodyRatio) return null;
  if (direction === "BUY" && candle.close > candle.open && closePosition >= CONFIG.displacementClosePosition) {
    return { bodyRatio, closePosition, rangeAtrMultiple: range / atr };
  }
  if (direction === "SELL" && candle.close < candle.open && closePosition <= 1 - CONFIG.displacementClosePosition) {
    return { bodyRatio, closePosition, rangeAtrMultiple: range / atr };
  }
  return null;
}

function fvgTapped(candle: Candle, fvg: FvgSetup): boolean {
  return candle.low <= fvg.top && candle.high >= fvg.bottom;
}

function fvgMidpointTouched(candle: Candle, fvg: FvgSetup, direction: Direction): boolean {
  return direction === "BUY" ? candle.low <= fvg.midpoint : candle.high >= fvg.midpoint;
}

function fvgRetestDepth(candle: Candle, fvg: FvgSetup, direction: Direction): number {
  const size = Math.max(fvg.top - fvg.bottom, Number.EPSILON);
  if (direction === "BUY") {
    const touched = Math.max(fvg.bottom, Math.min(candle.low, fvg.top));
    return Math.round(((fvg.top - touched) / size) * 1000) / 10;
  }
  const touched = Math.max(fvg.bottom, Math.min(candle.high, fvg.top));
  return Math.round(((touched - fvg.bottom) / size) * 1000) / 10;
}

function confirmationCandle(candle: Candle, atr: number, direction: Direction): boolean {
  const range = candle.high - candle.low;
  if (range <= 0 || range < atr * CONFIG.minConfirmationRangeAtr) return false;
  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  const closePosition = (candle.close - candle.low) / range;
  return bodyRatio >= CONFIG.confirmationBodyRatio && (direction === "BUY"
    ? candle.close > candle.open && closePosition >= CONFIG.confirmationClosePosition
    : candle.close < candle.open && closePosition <= 1 - CONFIG.confirmationClosePosition);
}

function directionalCandle(candle: Candle, direction: Direction): boolean {
  return direction === "BUY" ? candle.close > candle.open : candle.close < candle.open;
}

function findTarget(candles: Candle[], index: number, direction: Direction, entry: number, risk: number, atr: number): { price: number; fixed: boolean } {
  const levels = findLiquidityLevels(candles, index, atr);
  const liquidityTargets = levels
    .filter((level) => direction === "BUY" ? level.type === "BSL" && level.level > entry : level.type === "SSL" && level.level < entry)
    .map((level) => level.level);
  if (liquidityTargets.length) return { price: direction === "BUY" ? Math.min(...liquidityTargets) : Math.max(...liquidityTargets), fixed: false };
  const minimum = risk * CONFIG.minRR;
  const swingTargets: number[] = [];
  for (let cursor = Math.max(CONFIG.swingLookback, index - CONFIG.liquidityLookback); cursor <= index - CONFIG.swingLookback; cursor++) {
    if (direction === "BUY" && detectSwingHigh(candles, cursor, CONFIG.swingLookback) && candles[cursor].high - entry >= minimum) swingTargets.push(candles[cursor].high);
    if (direction === "SELL" && detectSwingLow(candles, cursor, CONFIG.swingLookback) && entry - candles[cursor].low >= minimum) swingTargets.push(candles[cursor].low);
  }
  if (swingTargets.length) return { price: direction === "BUY" ? Math.min(...swingTargets) : Math.max(...swingTargets), fixed: false };
  const preferred = risk * CONFIG.preferredRR;
  return { price: direction === "BUY" ? entry + preferred : entry - preferred, fixed: true };
}

function scoreSetup(candles: Candle[], setup: SweepSetup, reclaimIndex: number, displacement: Displacement, structureShift: StructureShift, fvg: FvgSetup, retest: FvgRetest, confirmationIndex: number, rr: number): ScoreParts {
  const confirmation = candles[confirmationIndex];
  const range = confirmation.high - confirmation.low;
  const bodyRatio = range > 0 ? Math.abs(confirmation.close - confirmation.open) / range : 0;
  const closePosition = range > 0 ? (confirmation.close - confirmation.low) / range : 0.5;
  const directionalClose = setup.direction === "BUY" ? closePosition : 1 - closePosition;
  return {
    killzoneQuality: setup.killzoneName === "NY_AM_SB" ? 10 : 8,
    liquidityQuality: setup.liquidity.quality,
    sweepQuality: Math.max(9, 15 - Math.round(Math.abs(setup.sweepDistanceAtr - 0.4) * 3)),
    reclaimQuality: reclaimIndex === setup.sweepIndex ? 10 : 8,
    displacementQuality: Math.min(20, Math.round(10 + displacement.bodyRatio * 5 + Math.min(5, displacement.rangeAtrMultiple * 2))),
    mssQuality: structureShift.type === "MSS" ? 10 : 8,
    fvgQuality: Math.min(10, Math.round(5 + Math.min(3, fvg.sizeAtr * 10) + (retest.midpointTouched ? 2 : 0))),
    confirmationQuality: Math.min(10, Math.round(4 + bodyRatio * 3 + directionalClose * 3)),
    rrQuality: rr >= CONFIG.preferredRR ? 10 : 8,
  };
}

function buildWarnings(input: V2GoldmineInput, setup: SweepSetup, fvg: FvgSetup, retest: FvgRetest, fixedTarget: boolean, confirmationIndex: number): string[] {
  const warnings = new Set<string>();
  if (!hasPreviousSessionLiquidity(setup)) warnings.add("NO_PREVIOUS_SESSION_LIQUIDITY");
  if (!retest.midpointTouched) warnings.add("FVG_RETEST_NOT_AT_MIDPOINT");
  if (fixedTarget) warnings.add("TARGET_USING_FIXED_RR");
  if (setup.atr < 0.05) warnings.add("ATR_LOW");
  if (recentChoppy(input.candles.filter((candle) => candle.isClosed), confirmationIndex)) warnings.add("CHOPPY_PRICE_ACTION");
  const htfBias = input.context.htfBias?.bias ?? "UNKNOWN";
  if (htfBias === "NEUTRAL" || htfBias === "RANGING" || htfBias === "UNKNOWN") warnings.add("HTF_CONTEXT_NEUTRAL");
  if ((setup.direction === "BUY" && htfBias === "BEARISH") || (setup.direction === "SELL" && htfBias === "BULLISH")) warnings.add("HTF_CONTEXT_AGAINST_SIGNAL");
  return [...warnings];
}

function hasPreviousSessionLiquidity(setup: SweepSetup): boolean {
  return setup.liquidity.source === "PREVIOUS_SESSION";
}

function recentChoppy(candles: Candle[], index: number): boolean {
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
  candles: Candle[];
  setup: SweepSetup;
  reclaimIndex: number;
  displacement: Displacement;
  structureShift: StructureShift;
  fvg: FvgSetup;
  retest: FvgRetest;
  confirmationIndex: number;
  entry: number;
  stopLoss: number;
  target: number;
  fixedTarget: boolean;
  risk: number;
  reward: number;
  rr: number;
  score: number;
  scoreParts: ScoreParts;
  atr: number;
  warnings: string[];
}): TradeSignal {
  const confirmation = args.candles[args.confirmationIndex];
  const displacementCandleValue = args.candles[args.displacement.index];
  const confirmationRange = confirmation.high - confirmation.low;
  const confirmationBodyRatio = confirmationRange > 0 ? Math.abs(confirmation.close - confirmation.open) / confirmationRange : 0;
  const confirmationClosePosition = confirmationRange > 0 ? (confirmation.close - confirmation.low) / confirmationRange : 0.5;
  const scoreBreakdown: SignalScoreBreakdown = {
    phase4Setup: args.scoreParts.killzoneQuality + args.scoreParts.liquidityQuality,
    contextAlignment: args.scoreParts.sweepQuality + args.scoreParts.reclaimQuality,
    confirmationCandle: args.scoreParts.confirmationQuality,
    stopLossQuality: args.scoreParts.displacementQuality,
    targetQuality: args.scoreParts.fvgQuality + args.scoreParts.rrQuality,
    sessionQuality: 0,
    volatilityQuality: args.scoreParts.mssQuality,
    antiReversal: 0,
  };
  return {
    id: `${ICT_SILVER_BULLET_STRATEGY_ID}:${args.input.symbol}:${confirmation.timestamp}:${args.setup.direction}`,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: ICT_SILVER_BULLET_STRATEGY_ID,
    v2Direction: args.setup.direction,
    type: args.setup.direction === "BUY" ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
    direction: args.setup.direction === "BUY" ? "BULLISH" : "BEARISH",
    status: "CONFIRMED",
    sourceSetupId: args.setup.id,
    setupType: "LIQUIDITY_SWEEP_REVERSAL",
    strategyModel: ICT_SILVER_BULLET_STRATEGY_LABEL,
    mode: "V2_DEFAULT",
    timestamp: confirmation.timestamp,
    candleIndex: args.confirmationIndex,
    confirmedAtIndex: args.confirmationIndex,
    timeframe: args.input.timeframe,
    session: sessionFor(args.setup.killzoneName),
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
      `${args.setup.killzoneName} swept ${args.setup.liquidity.type} ${args.setup.liquidity.source.toLowerCase().replaceAll("_", " ")} liquidity.`,
      `${args.structureShift.type} confirmed after displacement.`,
      "Price retested the FVG and a closed candle confirmed entry.",
    ],
    warnings: args.warnings,
    rejectionReasons: [],
    relatedMarkers: [],
    noRepaintProof: {
      status: "PASS",
      signalIndex: args.confirmationIndex,
      latestAllowedCandleIndex: args.confirmationIndex,
      usedMarkerIndexes: [args.setup.sweepIndex, args.reclaimIndex, args.displacement.index, args.fvg.index, args.retest.index, args.confirmationIndex],
      usedContextCloseTimes: [],
      usedSetupId: args.setup.id,
      passed: true,
      lastAvailableIndex: args.confirmationIndex,
      maxEvidenceIndex: args.confirmationIndex,
      message: "ICT Silver Bullet uses only closed candles through FVG retest and confirmation; entry, SL, TP, RR, and score are immutable.",
    },
    stopLossDetail: {
      price: round(args.stopLoss),
      source: "SWEEP_EXTREME_ATR_BUFFER",
      buffer: round(args.atr * CONFIG.slAtrBuffer),
      riskPoints: round(args.risk),
      reason: "Stop is beyond the swept liquidity extreme.",
    },
    takeProfitDetail: {
      tp1: round(args.target),
      tp2: null,
      tp3: null,
      source: args.fixedTarget ? "FIXED_PREFERRED_RR_FALLBACK" : "OPPOSING_LIQUIDITY",
      rewardPoints: round(args.reward),
      reason: args.fixedTarget ? "Fixed preferred-RR fallback target." : "Nearest qualifying opposing liquidity target.",
    },
    scoreBreakdown,
    silverBullet: {
      stage: "CONFIRMED_SIGNAL",
      killzoneName: args.setup.killzoneName,
      signalTime: confirmation.timestamp,
      liquidity: {
        type: args.setup.liquidity.type,
        source: args.setup.liquidity.source,
        level: args.setup.liquidity.level,
        detectedAt: args.setup.liquidity.detectedAt,
      },
      sweep: {
        candleIndex: args.setup.sweepIndex,
        timestamp: args.candles[args.setup.sweepIndex].timestamp,
        level: args.setup.liquidity.level,
        extreme: args.setup.sweepExtreme,
        type: args.setup.liquidity.type,
        sweepPrice: args.setup.sweepPrice,
        sweepDistanceAtr: args.setup.sweepDistanceAtr,
        reclaimed: true,
        reclaimedAt: args.candles[args.reclaimIndex].timestamp,
        reclaimedAtIndex: args.reclaimIndex,
      },
      displacement: {
        candleIndex: args.displacement.index,
        timestamp: displacementCandleValue.timestamp,
        direction: args.setup.direction === "BUY" ? "BULLISH" : "BEARISH",
        bodyRatio: args.displacement.bodyRatio,
        closePosition: args.displacement.closePosition,
        rangeAtrMultiple: args.displacement.rangeAtrMultiple,
      },
      structureShift: args.structureShift,
      fvg: {
        type: args.fvg.type,
        createdAtIndex: args.fvg.index,
        timestamp: args.candles[args.fvg.index].timestamp,
        low: args.fvg.bottom,
        high: args.fvg.top,
        bottom: args.fvg.bottom,
        top: args.fvg.top,
        midpoint: args.fvg.midpoint,
        sizeAtr: args.fvg.sizeAtr,
        retestedAtIndex: args.retest.index,
        retestedAt: args.candles[args.retest.index].timestamp,
        retestDepthPercent: args.retest.depthPercent,
      },
      confirmation: {
        candleTime: confirmation.timestamp,
        open: confirmation.open,
        high: confirmation.high,
        low: confirmation.low,
        close: confirmation.close,
        bodyRatio: confirmationBodyRatio,
        closePosition: confirmationClosePosition,
        rangeAtrMultiple: confirmationRange / args.atr,
      },
    },
    immutable: true,
  };
}

function debugRow(
  id: string,
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
    setupId: id,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: ICT_SILVER_BULLET_STRATEGY_ID,
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
    nextRequiredAction: status === "PENDING_CONFIRMATION" ? "Wait for the next closed Silver Bullet stage candle." : status === "CONFIRMED" ? "Use immutable trade levels." : "Wait for a new killzone setup.",
    failedStage: stage,
  };
}

function buildAudit(args: {
  candles: number;
  signals: TradeSignal[];
  pendingCandidates: SignalCandidateDebug[];
  rejectedSetups: RejectedSetup[];
  candidateDebug: SignalCandidateDebug[];
  generationTimeMs: number;
  killzoneCandles: number;
  liquidityLevelsFound: number;
  sweepsDetected: number;
  reclaimsConfirmed: number;
  displacementsFound: number;
  mssConfirmed: number;
  fvgsCreated: number;
  fvgRetestsFound: number;
  confirmationCandlesFound: number;
  expiredSetups: number;
  top: Array<{ reason: string; count: number; percentage: number }>;
}): EntryEngineResult["audit"] {
  return {
    activeEngine: ACTIVE_SIGNAL_ENGINE,
    strategyId: ICT_SILVER_BULLET_STRATEGY_ID,
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
    topRejectionReasons: args.top.map(({ reason, count }) => ({ reason, count })),
    lastFiveTriggerSetups: args.candidateDebug.slice(-5).map((row) => row.setupId),
    lastFiveConfirmedSignals: args.signals.slice(-5).map((signal) => signal.id),
    noSignalMessage: args.signals.length ? null : "No confirmed ICT Silver Bullet signal.",
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
    v2SilverBullet: {
      activeEngineLabel: ICT_SILVER_BULLET_STRATEGY_LABEL,
      strategyId: ICT_SILVER_BULLET_STRATEGY_ID,
      candlesScanned: args.candles,
      killzoneCandles: args.killzoneCandles,
      liquidityLevelsFound: args.liquidityLevelsFound,
      sweepsDetected: args.sweepsDetected,
      reclaimsConfirmed: args.reclaimsConfirmed,
      displacementsFound: args.displacementsFound,
      mssConfirmed: args.mssConfirmed,
      fvgsCreated: args.fvgsCreated,
      fvgRetestsFound: args.fvgRetestsFound,
      confirmationCandlesFound: args.confirmationCandlesFound,
      sweeps: args.sweepsDetected,
      validRejections: args.reclaimsConfirmed,
      displacements: args.displacementsFound,
      fvgs: args.fvgsCreated,
      retests: args.fvgRetestsFound,
      confirmedSignals: args.signals.length,
      rejectedSignals: args.rejectedSetups.length,
      expiredSetups: args.expiredSetups,
      generationTimeMs: args.generationTimeMs,
      topRejectionReasons: args.top,
    },
  };
}

function sameKillzone(candle: Candle, name: string): boolean {
  return killzoneAt(candle.timestamp) === name;
}

function killzoneAt(timestamp: number): string | null {
  return getKillzone(timestamp, CONFIG.timezone, CONFIG.killzones);
}

function sessionFor(name: string): TradingSession {
  return name === "LONDON_SB" ? "LONDON" : "NEW_YORK";
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
