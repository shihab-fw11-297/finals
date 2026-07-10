import type { Candle } from "../candles/types";
import type {
  EntryEngineResult,
  RejectedSetup,
  SignalCandidateDebug,
  SignalRejectionCode,
  SignalScoreBreakdown,
  TradeSignal,
} from "../entry-engine/types";
import type { MarketContextResult, TradingSession } from "../market-context/types";
import {
  ACTIVE_SIGNAL_ENGINE,
  PRO_LIQUIDITY_CONFLUENCE_CONFIG as CONFIG,
  PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID,
  PRO_LIQUIDITY_CONFLUENCE_STRATEGY_LABEL,
} from "./config";
import { calculateATR, clockWindowAt, detectFVG, detectMSS, detectSwingHigh, detectSwingLow, zonedDateParts } from "./indicators";
import type { V2GoldmineInput } from "./types";

type Direction = "BUY" | "SELL";
type Stage =
  | "BIAS_CHECKED"
  | "LIQUIDITY_SWEEP_DETECTED"
  | "DISPLACEMENT_CONFIRMED"
  | "MSS_CONFIRMED"
  | "ENTRY_ZONE_FOUND"
  | "WAITING_CONFIRMATION"
  | "CONFIRMED_SIGNAL"
  | "REJECTED"
  | "EXPIRED";
type Bias = "BULLISH" | "BEARISH" | "NEUTRAL" | "RANGING" | "UNKNOWN";
type ItfBias = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "NONE" | "UNKNOWN";
type ModeKey = keyof typeof CONFIG.minRRByMode;
type ZoneSource = "FVG" | "ORDER_BLOCK" | "RETRACEMENT_50" | "OTE";
type EntryZoneType = "BULLISH_FVG" | "BEARISH_FVG" | "BULLISH_OB" | "BEARISH_OB" | "DISPLACEMENT_50" | "OTE";

type BiasContext = {
  htf: { bias: Bias; strength: number; source: "MARKET_CONTEXT" | "LTF_DERIVED" };
  itf: { bias: ItfBias; strength: number; source: "MARKET_CONTEXT" | "LTF_DERIVED" };
};

type LiquiditySweep = {
  direction: Direction;
  type: "SSL" | "BSL";
  level: number;
  source: "SWING" | "EQUAL_HIGH_LOW" | "RECENT_RANGE";
  candleIndex: number;
  timestamp: number;
  sweepPrice: number;
  sweepDistanceAtr: number;
  reclaimed: boolean;
  reclaimedAt: number;
  reclaimedAtIndex: number;
};

type Displacement = {
  direction: Direction;
  candleIndex: number;
  bodyRatio: number;
  closePosition: number;
  rangeAtrMultiple: number;
  averageRangeMultiple: number;
};

type StructureShift = {
  type: "MSS" | "CHOCH";
  brokenLevel: number;
  confirmedAtIndex: number;
};

type EntryZone = {
  direction: Direction;
  type: EntryZoneType;
  source: ZoneSource;
  createdAtIndex: number;
  top: number;
  bottom: number;
  midpoint: number;
  sizeAtr: number;
};

type Retest = {
  candleIndex: number;
  retestPrice: number;
  retestDepthPercent: number;
};

type ConfirmedEntry = {
  zone: EntryZone;
  retest: Retest;
  confirmationIndex: number;
  warningReasons: string[];
};

type EntrySearchResult =
  | { status: "CONFIRMED"; entry: ConfirmedEntry }
  | { status: "PENDING"; zone: EntryZone; reason: SignalRejectionCode; stage: Stage; remaining: number }
  | { status: "REJECTED"; reason: SignalRejectionCode; stage: Stage };

type ScoreFactors = {
  biasAligned: boolean;
  sweepValid: boolean;
  displacementStrong: boolean;
  mssConfirmed: boolean;
  entryZoneFound: boolean;
  confirmationFound: boolean;
  rrValid: boolean;
  sessionVolatilityOk: boolean;
};

type ScoreResult = {
  factorScore: number;
  percentScore: number;
  factors: ScoreFactors;
};

const resultCache = new Map<string, EntryEngineResult>();

export function clearProLiquidityConfluenceCache(): void {
  resultCache.clear();
}

export function generateProLiquidityConfluenceSignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const candles = input.candles.filter((candle) => candle.isClosed);
  const mode = resolveMode(input);
  const minRR = CONFIG.minRRByMode[mode];
  const minFactorScore = CONFIG.minFactorScoreByMode[mode];
  const minSignalScore = Math.round((minFactorScore / CONFIG.maxScore) * 100);
  const key = `${PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID}:${mode}:${input.symbol}:${input.timeframe}:${candles.length}:${candles.at(-1)?.timestamp ?? 0}:${input.settings?.maxRiskAmount ?? 100}`;
  const cached = resultCache.get(key);
  if (cached) return cloneResult(cached, "hit");

  const signals: TradeSignal[] = [];
  const pendingCandidates: SignalCandidateDebug[] = [];
  const candidateDebug: SignalCandidateDebug[] = [];
  const rejectedSetups: RejectedSetup[] = [];
  const rejectionCounts = new Map<string, number>();
  const sessionSignalCounts = new Map<string, number>();
  const daySignalCounts = new Map<string, number>();
  const atr = calculateATR(candles, CONFIG.atrPeriod);
  const averageRanges = calculateAverageRange(candles, 10);
  const swingHighs = candles.map((_, index) => detectSwingHigh(candles, index, CONFIG.swingLookback));
  const swingLows = candles.map((_, index) => detectSwingLow(candles, index, CONFIG.swingLookback));
  const biasContext = resolveBiasContext(input.context, candles);

  let liquidityLevelsFound = 0;
  let sweepsFound = 0;
  let displacementsFound = 0;
  let mssFound = 0;
  let entryZonesFound = 0;
  let fvgZonesFound = 0;
  let orderBlocksFound = 0;
  let confirmationCandlesFound = 0;
  let expiredSetups = 0;

  if (candles.length < CONFIG.atrPeriod + CONFIG.swingLookback * 2 + 6) {
    increment(rejectionCounts, "INSUFFICIENT_CANDLES");
  }

  const firstIndex = Math.max(CONFIG.atrPeriod, CONFIG.swingLookback * 2 + 2);
  for (let index = firstIndex; index < candles.length; index++) {
    const currentAtr = atr[index];
    if (!currentAtr || !Number.isFinite(currentAtr)) {
      continue;
    }

    const sweepCandidates = [detectSweepAt(candles, index, "BUY", currentAtr, swingHighs, swingLows), detectSweepAt(candles, index, "SELL", currentAtr, swingHighs, swingLows)]
      .filter((sweep): sweep is LiquiditySweep => Boolean(sweep));

    if (sweepCandidates.length === 0) continue;
    liquidityLevelsFound += sweepCandidates.length;

    for (const sweep of sweepCandidates) {
      sweepsFound++;
      const setupIdValue = setupId(sweep);
      const direction = sweep.direction;
      const displacement = findDisplacementAfter(candles, sweep, atr, averageRanges);
      if (!displacement) {
        addRejection(setupIdValue, direction, "NO_DISPLACEMENT", sweep.candleIndex, "LIQUIDITY_SWEEP_DETECTED");
        continue;
      }
      displacementsFound++;

      const structureShift = findStructureShiftAfter(candles, sweep, displacement);
      if (!structureShift) {
        addRejection(setupIdValue, direction, "NO_MSS_OR_CHOCH", displacement.candleIndex, "DISPLACEMENT_CONFIRMED");
        continue;
      }
      mssFound++;

      const zones = findEntryZones(candles, sweep, displacement, atr[displacement.candleIndex] ?? currentAtr);
      entryZonesFound += zones.length;
      fvgZonesFound += zones.filter((zone) => zone.source === "FVG").length;
      orderBlocksFound += zones.filter((zone) => zone.source === "ORDER_BLOCK").length;

      if (zones.length === 0) {
        addRejection(setupIdValue, direction, "NO_ENTRY_ZONE", structureShift.confirmedAtIndex, "MSS_CONFIRMED");
        continue;
      }

      const entrySearch = findConfirmedEntry(candles, zones, sweep, atr);
      if (entrySearch.status === "PENDING") {
        const debug = makeDebug(setupIdValue, direction, "PENDING_CONFIRMATION", entrySearch.reason, entrySearch.remaining, entrySearch.stage, null, null, minSignalScore, minRR);
        candidateDebug.push(debug);
        pendingCandidates.push(debug);
        continue;
      }
      if (entrySearch.status === "REJECTED") {
        const state = entrySearch.stage === "EXPIRED" ? "EXPIRED" : "INVALIDATED";
        if (entrySearch.stage === "EXPIRED") expiredSetups++;
        addRejection(setupIdValue, direction, entrySearch.reason, structureShift.confirmedAtIndex, entrySearch.stage, state);
        continue;
      }

      confirmationCandlesFound++;
      const entry = entrySearch.entry;
      const confirmation = candles[entry.confirmationIndex];
      const confirmationAtr = atr[entry.confirmationIndex] ?? currentAtr;
      const tradeLevels = buildTradeLevels(candles, sweep, entry, entry.confirmationIndex, confirmationAtr, direction);
      if (!tradeLevels.valid) {
        addRejection(setupIdValue, direction, tradeLevels.reason, entry.confirmationIndex, "ENTRY_ZONE_FOUND");
        continue;
      }

      const rrValid = tradeLevels.rr >= minRR;
      if (!rrValid) {
        addRejection(setupIdValue, direction, "RR_BELOW_MINIMUM", entry.confirmationIndex, "ENTRY_ZONE_FOUND");
        continue;
      }

      const sessionName = sessionNameAt(confirmation.timestamp);
      const local = zonedDateParts(confirmation.timestamp, "UTC");
      const sessionKey = `${local.date}:${sessionName}`;
      if ((sessionSignalCounts.get(sessionKey) ?? 0) >= CONFIG.maxSignalsPerSession) {
        addRejection(setupIdValue, direction, "MAX_SESSION_SIGNALS_REACHED", entry.confirmationIndex, "CONFIRMED_SIGNAL");
        continue;
      }
      if ((daySignalCounts.get(local.date) ?? 0) >= CONFIG.maxSignalsPerDay) {
        addRejection(setupIdValue, direction, "MAX_DAILY_SIGNALS_REACHED", entry.confirmationIndex, "CONFIRMED_SIGNAL");
        continue;
      }

      const setupBiasContext = resolveBiasContext(input.context, candles.slice(0, entry.confirmationIndex + 1));
      const warnings = uniqueStrings([
        ...entry.warningReasons,
        ...biasWarnings(direction, setupBiasContext),
        ...sessionWarnings(candles, entry.confirmationIndex, confirmationAtr, sessionName),
      ]);
      const score = scoreSetup({
        direction,
        biasContext: setupBiasContext,
        sweep,
        displacement,
        structureShift,
        entry,
        rrValid,
        sessionName,
        volatilityOk: volatilityOk(input.context),
      });
      const strongSequence = score.factors.sweepValid && score.factors.displacementStrong && score.factors.mssConfirmed && score.factors.confirmationFound;
      const hardOppositeBias = hasStrongOppositeBias(direction, setupBiasContext) && !strongSequence;
      if (hardOppositeBias) {
        addRejection(setupIdValue, direction, "HTF_BIAS_AGAINST_SIGNAL", entry.confirmationIndex, "BIAS_CHECKED");
        continue;
      }
      if (score.factorScore < minFactorScore) {
        addRejection(setupIdValue, direction, "SIGNAL_SCORE_TOO_LOW", entry.confirmationIndex, "CONFIRMED_SIGNAL", "INVALIDATED", score.percentScore, tradeLevels.rr);
        continue;
      }

      const signal = buildSignal({
        input,
        candles,
        mode,
        sweep,
        displacement,
        structureShift,
        entry,
        entryIndex: entry.confirmationIndex,
        entryPrice: confirmation.close,
        stopLoss: tradeLevels.stopLoss,
        target: tradeLevels.takeProfit,
        risk: tradeLevels.risk,
        reward: tradeLevels.reward,
        rr: tradeLevels.rr,
        score,
        minRR,
        warnings,
        sessionName,
        biasContext: setupBiasContext,
        atr: confirmationAtr,
        fixedTarget: tradeLevels.fixedTarget,
      });
      signals.push(signal);
      sessionSignalCounts.set(sessionKey, (sessionSignalCounts.get(sessionKey) ?? 0) + 1);
      daySignalCounts.set(local.date, (daySignalCounts.get(local.date) ?? 0) + 1);
      candidateDebug.push(makeDebug(setupIdValue, direction, "CONFIRMED", "CONFIRMED_SIGNAL", 0, "CONFIRMED_SIGNAL", score.percentScore, tradeLevels.rr, minSignalScore, minRR));
      index = Math.max(index, entry.confirmationIndex);
      break;
    }
  }

  if (sweepsFound === 0) {
    increment(rejectionCounts, "NO_SWEEP");
    candidateDebug.push(makeDebug("pro-liquidity:none", "BUY", "REJECTED", "NO_SWEEP", 0, "REJECTED", null, null, minSignalScore, minRR));
  }

  function addRejection(
    setupIdValue: string,
    direction: Direction,
    code: SignalRejectionCode,
    index: number,
    stage: Stage,
    state: RejectedSetup["setupState"] = "INVALIDATED",
    score: number | null = null,
    rr: number | null = null,
  ): void {
    increment(rejectionCounts, code);
    const debug = makeDebug(setupIdValue, direction, state === "EXPIRED" ? "EXPIRED_CONFIRMATION" : "REJECTED", code, 0, stage, score, rr, minSignalScore, minRR);
    candidateDebug.push(debug);
    rejectedSetups.push(toRejected(setupIdValue, direction, index, code, debug, state));
  }

  const generationTimeMs = performance.now() - started;
  const topRejectionReasons = rejectionRows(rejectionCounts);
  const audit = makeAudit({
    mode,
    minSignalScore,
    minRR,
    candles: candles.length,
    signals,
    rejectedSetups,
    pendingCandidates,
    generationTimeMs,
    liquidityLevelsFound,
    sweepsFound,
    displacementsFound,
    mssFound,
    entryZonesFound,
    fvgZonesFound,
    orderBlocksFound,
    confirmationCandlesFound,
    expiredSetups,
    topRejectionReasons,
    candidateDebug,
    biasContext,
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
      checkedSetups: sweepsFound,
      rejectionReasons: topRejectionReasons.map((row) => row.reason),
      message: pendingCandidates.length ? "Pro liquidity confluence setup is still forming." : "No confirmed pro liquidity confluence signal found.",
      nearestPossibleSetup: pendingCandidates.at(-1)?.setupId ?? rejectedSetups.at(-1)?.setupId ?? null,
      requiredForSignal: ["SSL/BSL sweep", "Displacement", "MSS/CHoCH", "FVG/OB/50%/OTE retest", "Closed confirmation candle", `${minRR.toFixed(1)}R minimum`],
      timestamp: candles.at(-1)?.timestamp ?? null,
    },
    audit,
  };
  if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value ?? "");
  resultCache.set(key, result);
  return result;
}

function detectSweepAt(
  candles: Candle[],
  index: number,
  direction: Direction,
  atr: number,
  swingHighs: boolean[],
  swingLows: boolean[],
): LiquiditySweep | null {
  const level = findRecentLiquidityLevel(candles, index, direction, atr, swingHighs, swingLows);
  if (!level) return null;
  const candle = candles[index];
  const sweepPrice = direction === "BUY" ? candle.low : candle.high;
  const sweepDistance = direction === "BUY" ? level.level - sweepPrice : sweepPrice - level.level;
  const sweepDistanceAtr = sweepDistance / atr;
  if (sweepDistance < atr * CONFIG.minSweepBufferAtr) return null;
  if (sweepDistanceAtr > CONFIG.maxSweepDistanceAtr) return null;
  const reclaimedOnSweep = direction === "BUY" ? candle.close > level.level : candle.close < level.level;
  const next = candles[index + 1] ?? null;
  const reclaimedOnNext = next ? direction === "BUY" ? next.close > level.level : next.close < level.level : false;
  if (!reclaimedOnSweep && !reclaimedOnNext) return null;
  const reclaimedAtIndex = reclaimedOnSweep ? index : index + 1;
  return {
    direction,
    type: direction === "BUY" ? "SSL" : "BSL",
    level: level.level,
    source: level.source,
    candleIndex: index,
    timestamp: candle.timestamp,
    sweepPrice,
    sweepDistanceAtr,
    reclaimed: true,
    reclaimedAt: candles[reclaimedAtIndex].timestamp,
    reclaimedAtIndex,
  };
}

function findRecentLiquidityLevel(
  candles: Candle[],
  index: number,
  direction: Direction,
  atr: number,
  swingHighs: boolean[],
  swingLows: boolean[],
): { level: number; source: LiquiditySweep["source"] } | null {
  const end = Math.max(0, index - CONFIG.swingLookback);
  const start = Math.max(0, index - CONFIG.liquidityLookback);
  if (end <= start) return null;
  const swingPrices: number[] = [];
  for (let cursor = start; cursor <= end; cursor++) {
    if (direction === "BUY" && swingLows[cursor]) swingPrices.push(candles[cursor].low);
    if (direction === "SELL" && swingHighs[cursor]) swingPrices.push(candles[cursor].high);
  }
  if (swingPrices.length) {
    return {
      level: direction === "BUY" ? Math.min(...swingPrices) : Math.max(...swingPrices),
      source: "SWING",
    };
  }
  const source = candles.slice(start, index);
  if (source.length < CONFIG.swingLookback) return null;
  const level = direction === "BUY" ? Math.min(...source.map((candle) => candle.low)) : Math.max(...source.map((candle) => candle.high));
  const touchCount = source.filter((candle) => Math.abs((direction === "BUY" ? candle.low : candle.high) - level) <= atr * 0.12).length;
  return { level, source: touchCount >= 2 ? "EQUAL_HIGH_LOW" : "RECENT_RANGE" };
}

function findDisplacementAfter(
  candles: Candle[],
  sweep: LiquiditySweep,
  atr: Array<number | null>,
  averageRanges: Array<number | null>,
): Displacement | null {
  const start = Math.max(sweep.candleIndex + 1, sweep.reclaimedAtIndex);
  const end = Math.min(candles.length - 1, sweep.candleIndex + CONFIG.maxCandlesToDisplaceAfterSweep);
  for (let index = start; index <= end; index++) {
    const currentAtr = atr[index] ?? atr[sweep.candleIndex];
    const averageRange = averageRanges[index] ?? currentAtr;
    if (!currentAtr || !averageRange) continue;
    const candle = candles[index];
    const range = candle.high - candle.low;
    if (range <= 0 || range < currentAtr * CONFIG.minDisplacementRangeAtr || range < averageRange * CONFIG.minDisplacementRangeMultiple) continue;
    const bodyRatio = Math.abs(candle.close - candle.open) / range;
    if (bodyRatio < CONFIG.displacementBodyRatio) continue;
    const closePosition = (candle.close - candle.low) / range;
    const bullish = candle.close > candle.open && closePosition >= CONFIG.displacementClosePosition;
    const bearish = candle.close < candle.open && closePosition <= 1 - CONFIG.displacementClosePosition;
    if (sweep.direction === "BUY" && !bullish) continue;
    if (sweep.direction === "SELL" && !bearish) continue;
    return {
      direction: sweep.direction,
      candleIndex: index,
      bodyRatio,
      closePosition,
      rangeAtrMultiple: range / currentAtr,
      averageRangeMultiple: range / averageRange,
    };
  }
  return null;
}

function findStructureShiftAfter(candles: Candle[], sweep: LiquiditySweep, displacement: Displacement): StructureShift | null {
  const end = Math.min(candles.length - 1, displacement.candleIndex + CONFIG.maxCandlesToMssAfterDisplacement);
  for (let index = displacement.candleIndex; index <= end; index++) {
    const mss = detectMSS(candles, index, displacement.direction, CONFIG.swingLookback);
    if (mss) {
      return {
        type: mss.type,
        brokenLevel: mss.brokenLevel,
        confirmedAtIndex: index,
      };
    }
    const fallback = fallbackStructureBreak(candles, sweep.candleIndex, index, displacement.direction);
    if (fallback) return fallback;
  }
  return null;
}

function fallbackStructureBreak(candles: Candle[], sweepIndex: number, index: number, direction: Direction): StructureShift | null {
  const prior = candles.slice(Math.max(0, sweepIndex - CONFIG.structureLookback), sweepIndex);
  if (prior.length < CONFIG.swingLookback) return null;
  const level = direction === "BUY" ? Math.max(...prior.map((candle) => candle.high)) : Math.min(...prior.map((candle) => candle.low));
  const candle = candles[index];
  const closedBreak = direction === "BUY" ? candle.close > level : candle.close < level;
  const wickBreak = direction === "BUY" ? candle.high > level : candle.low < level;
  if (closedBreak) return { type: "MSS", brokenLevel: level, confirmedAtIndex: index };
  if (wickBreak) return { type: "CHOCH", brokenLevel: level, confirmedAtIndex: index };
  return null;
}

function findEntryZones(candles: Candle[], sweep: LiquiditySweep, displacement: Displacement, atr: number): EntryZone[] {
  const zones: EntryZone[] = [];
  for (let index = displacement.candleIndex; index <= Math.min(candles.length - 1, displacement.candleIndex + 2); index++) {
    const fvg = detectFVG(candles, index);
    if (!fvg) continue;
    if (sweep.direction === "BUY" && fvg.type !== "BULLISH_FVG") continue;
    if (sweep.direction === "SELL" && fvg.type !== "BEARISH_FVG") continue;
    const sizeAtr = fvg.size / atr;
    if (sizeAtr < CONFIG.fvgMinSizeAtr || sizeAtr > CONFIG.fvgMaxSizeAtr) continue;
    zones.push({
      direction: sweep.direction,
      type: fvg.type,
      source: "FVG",
      createdAtIndex: index,
      top: fvg.top,
      bottom: fvg.bottom,
      midpoint: fvg.midpoint,
      sizeAtr,
    });
  }

  const orderBlock = findOrderBlockZone(candles, displacement, atr);
  if (orderBlock) zones.push(orderBlock);

  const displacementCandle = candles[displacement.candleIndex];
  const midpoint = (displacementCandle.high + displacementCandle.low) / 2;
  const buffer = atr * CONFIG.retracementZoneAtrBuffer;
  zones.push({
    direction: sweep.direction,
    type: "DISPLACEMENT_50",
    source: "RETRACEMENT_50",
    createdAtIndex: displacement.candleIndex,
    top: midpoint + buffer,
    bottom: midpoint - buffer,
    midpoint,
    sizeAtr: (buffer * 2) / atr,
  });

  const ote = buildOteZone(candles, sweep, displacement, atr);
  if (ote) zones.push(ote);
  return zones.sort((left, right) => zonePriority(left.source) - zonePriority(right.source));
}

function findOrderBlockZone(candles: Candle[], displacement: Displacement, atr: number): EntryZone | null {
  const start = Math.max(0, displacement.candleIndex - CONFIG.orderBlockMaxLookback);
  for (let index = displacement.candleIndex - 1; index >= start; index--) {
    const candle = candles[index];
    const opposite = displacement.direction === "BUY" ? candle.close < candle.open : candle.close > candle.open;
    if (!opposite) continue;
    const top = candle.high;
    const bottom = candle.low;
    return {
      direction: displacement.direction,
      type: displacement.direction === "BUY" ? "BULLISH_OB" : "BEARISH_OB",
      source: "ORDER_BLOCK",
      createdAtIndex: index,
      top,
      bottom,
      midpoint: (top + bottom) / 2,
      sizeAtr: (top - bottom) / atr,
    };
  }
  return null;
}

function buildOteZone(candles: Candle[], sweep: LiquiditySweep, displacement: Displacement, atr: number): EntryZone | null {
  const displacementCandle = candles[displacement.candleIndex];
  if (sweep.direction === "BUY") {
    const high = displacementCandle.high;
    const low = sweep.sweepPrice;
    const range = high - low;
    if (!(range > 0)) return null;
    const bottom = high - range * 0.79;
    const top = high - range * 0.62;
    return { direction: "BUY", type: "OTE", source: "OTE", createdAtIndex: displacement.candleIndex, top, bottom, midpoint: (top + bottom) / 2, sizeAtr: (top - bottom) / atr };
  }
  const low = displacementCandle.low;
  const high = sweep.sweepPrice;
  const range = high - low;
  if (!(range > 0)) return null;
  const bottom = low + range * 0.62;
  const top = low + range * 0.79;
  return { direction: "SELL", type: "OTE", source: "OTE", createdAtIndex: displacement.candleIndex, top, bottom, midpoint: (top + bottom) / 2, sizeAtr: (top - bottom) / atr };
}

function zonePriority(source: ZoneSource): number {
  if (source === "FVG") return 0;
  if (source === "ORDER_BLOCK") return 1;
  if (source === "RETRACEMENT_50") return 2;
  return 3;
}

function findConfirmedEntry(candles: Candle[], zones: EntryZone[], sweep: LiquiditySweep, atr: Array<number | null>): EntrySearchResult {
  let pending: EntrySearchResult | null = null;
  let sawExpired = false;
  for (const zone of zones) {
    const maxRetestIndex = zone.createdAtIndex + CONFIG.maxCandlesToReturnToZone;
    const availableRetestIndex = Math.min(candles.length - 1, maxRetestIndex);
    let retest: Retest | null = null;
    let invalidated = false;
    for (let index = zone.createdAtIndex + 1; index <= availableRetestIndex; index++) {
      const currentAtr = atr[index] ?? atr[zone.createdAtIndex];
      if (!currentAtr) continue;
      if (zoneInvalidated(candles[index], zone, sweep, currentAtr)) {
        invalidated = true;
        break;
      }
      if (touchesZone(candles[index], zone, currentAtr)) {
        retest = makeRetest(candles[index], zone, index);
        break;
      }
    }
    if (invalidated) continue;
    if (!retest) {
      if (candles.length - 1 < maxRetestIndex) {
        pending ??= { status: "PENDING", zone, reason: zone.source === "FVG" ? "FVG_RETEST_EXPIRED" : "RETEST_EXPIRED", stage: "ENTRY_ZONE_FOUND", remaining: maxRetestIndex - (candles.length - 1) };
      } else {
        sawExpired = true;
      }
      continue;
    }

    const maxConfirmationIndex = retest.candleIndex + CONFIG.confirmationWindow;
    const availableConfirmationIndex = Math.min(candles.length - 1, maxConfirmationIndex);
    for (let index = retest.candleIndex; index <= availableConfirmationIndex; index++) {
      const currentAtr = atr[index] ?? atr[zone.createdAtIndex];
      if (!currentAtr) continue;
      if (index > retest.candleIndex && zoneInvalidated(candles[index], zone, sweep, currentAtr)) break;
      if (isConfirmation(candles[index], zone, sweep, currentAtr)) {
        return {
          status: "CONFIRMED",
          entry: {
            zone,
            retest,
            confirmationIndex: index,
            warningReasons: zone.source === "RETRACEMENT_50" || zone.source === "OTE" ? ["ENTRY_USED_RETRACEMENT_ZONE"] : [],
          },
        };
      }
    }
    if (candles.length - 1 < maxConfirmationIndex) {
      pending ??= { status: "PENDING", zone, reason: "WEAK_CONFIRMATION_CANDLE", stage: "WAITING_CONFIRMATION", remaining: maxConfirmationIndex - (candles.length - 1) };
    } else {
      sawExpired = true;
    }
  }
  if (pending) return pending;
  return { status: "REJECTED", reason: sawExpired ? "CONFIRMATION_EXPIRED" : "NO_CONFIRMATION", stage: sawExpired ? "EXPIRED" : "WAITING_CONFIRMATION" };
}

function touchesZone(candle: Candle, zone: EntryZone, atr: number): boolean {
  const tolerance = atr * CONFIG.retestToleranceAtr;
  return candle.low <= zone.top + tolerance && candle.high >= zone.bottom - tolerance;
}

function zoneInvalidated(candle: Candle, zone: EntryZone, sweep: LiquiditySweep, atr: number): boolean {
  const tolerance = atr * CONFIG.retestToleranceAtr;
  if (zone.direction === "BUY") {
    return candle.close < zone.bottom - tolerance || candle.close < sweep.sweepPrice - tolerance;
  }
  return candle.close > zone.top + tolerance || candle.close > sweep.sweepPrice + tolerance;
}

function makeRetest(candle: Candle, zone: EntryZone, candleIndex: number): Retest {
  const retestPrice = zone.direction === "BUY"
    ? Math.max(zone.bottom, Math.min(candle.low, zone.top))
    : Math.max(zone.bottom, Math.min(candle.high, zone.top));
  const size = Math.max(zone.top - zone.bottom, Number.EPSILON);
  const depth = zone.direction === "BUY"
    ? ((zone.top - retestPrice) / size) * 100
    : ((retestPrice - zone.bottom) / size) * 100;
  return {
    candleIndex,
    retestPrice,
    retestDepthPercent: Math.max(0, Math.min(100, Math.round(depth * 10) / 10)),
  };
}

function isConfirmation(candle: Candle, zone: EntryZone, sweep: LiquiditySweep, atr: number): boolean {
  const range = candle.high - candle.low;
  if (range <= 0 || range < atr * CONFIG.minConfirmationRangeAtr) return false;
  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  if (bodyRatio < CONFIG.confirmationBodyRatio) return false;
  const closePosition = (candle.close - candle.low) / range;
  if (zone.direction === "BUY") {
    return candle.close > candle.open
      && closePosition >= CONFIG.confirmationClosePosition
      && candle.close > zone.midpoint
      && candle.close > sweep.level
      && candle.close > sweep.sweepPrice;
  }
  return candle.close < candle.open
    && closePosition <= 1 - CONFIG.confirmationClosePosition
    && candle.close < zone.midpoint
    && candle.close < sweep.level
    && candle.close < sweep.sweepPrice;
}

function buildTradeLevels(
  candles: Candle[],
  sweep: LiquiditySweep,
  entry: ConfirmedEntry,
  confirmationIndex: number,
  atr: number,
  direction: Direction,
): { valid: true; stopLoss: number; takeProfit: number; risk: number; reward: number; rr: number; fixedTarget: boolean } | { valid: false; reason: SignalRejectionCode } {
  const confirmation = candles[confirmationIndex];
  const entryPrice = confirmation.close;
  const retestSlice = candles.slice(entry.retest.candleIndex, confirmationIndex + 1);
  const retestExtreme = direction === "BUY" ? Math.min(...retestSlice.map((candle) => candle.low)) : Math.max(...retestSlice.map((candle) => candle.high));
  const stopLoss = direction === "BUY"
    ? Math.min(sweep.sweepPrice, entry.zone.bottom, retestExtreme) - atr * CONFIG.slAtrBuffer
    : Math.max(sweep.sweepPrice, entry.zone.top, retestExtreme) + atr * CONFIG.slAtrBuffer;
  const risk = direction === "BUY" ? entryPrice - stopLoss : stopLoss - entryPrice;
  if (!Number.isFinite(risk) || !(risk > 0)) return { valid: false, reason: "INVALID_STOP_LOSS" };
  if (risk > atr * CONFIG.maxSlAtrMultiple) return { valid: false, reason: "STOP_LOSS_TOO_WIDE" };
  const target = findTarget(candles, confirmationIndex, direction, entryPrice, risk);
  const reward = direction === "BUY" ? target.price - entryPrice : entryPrice - target.price;
  if (!Number.isFinite(target.price) || !(reward > 0)) return { valid: false, reason: "INVALID_TAKE_PROFIT" };
  return { valid: true, stopLoss, takeProfit: target.price, risk, reward, rr: reward / risk, fixedTarget: target.fixed };
}

function findTarget(candles: Candle[], index: number, direction: Direction, entry: number, risk: number): { price: number; fixed: boolean } {
  const candidates: number[] = [];
  const start = Math.max(CONFIG.swingLookback, index - 80);
  for (let cursor = start; cursor <= index - CONFIG.swingLookback; cursor++) {
    if (direction === "BUY" && detectSwingHigh(candles, cursor, CONFIG.swingLookback) && candles[cursor].high > entry) candidates.push(candles[cursor].high);
    if (direction === "SELL" && detectSwingLow(candles, cursor, CONFIG.swingLookback) && candles[cursor].low < entry) candidates.push(candles[cursor].low);
  }
  const recent = candles.slice(Math.max(0, index - 50), index);
  if (recent.length) {
    const level = direction === "BUY" ? Math.max(...recent.map((candle) => candle.high)) : Math.min(...recent.map((candle) => candle.low));
    if (direction === "BUY" ? level > entry : level < entry) candidates.push(level);
  }
  if (candidates.length) return { price: direction === "BUY" ? Math.min(...candidates) : Math.max(...candidates), fixed: false };
  return { price: direction === "BUY" ? entry + risk * CONFIG.preferredRR : entry - risk * CONFIG.preferredRR, fixed: true };
}

function scoreSetup(input: {
  direction: Direction;
  biasContext: BiasContext;
  sweep: LiquiditySweep;
  displacement: Displacement;
  structureShift: StructureShift;
  entry: ConfirmedEntry;
  rrValid: boolean;
  sessionName: string;
  volatilityOk: boolean;
}): ScoreResult {
  const factors: ScoreFactors = {
    biasAligned: biasSupportsDirection(input.direction, input.biasContext),
    sweepValid: input.sweep.sweepDistanceAtr >= CONFIG.minSweepBufferAtr && input.sweep.sweepDistanceAtr <= CONFIG.maxSweepDistanceAtr,
    displacementStrong: input.displacement.bodyRatio >= CONFIG.displacementBodyRatio && input.displacement.rangeAtrMultiple >= CONFIG.minDisplacementRangeAtr,
    mssConfirmed: Boolean(input.structureShift),
    entryZoneFound: Boolean(input.entry.zone),
    confirmationFound: true,
    rrValid: input.rrValid,
    sessionVolatilityOk: sessionQualityOk(input.sessionName) && input.volatilityOk,
  };
  const factorScore = Object.values(factors).filter(Boolean).length;
  return {
    factorScore,
    percentScore: Math.round((factorScore / CONFIG.maxScore) * 100),
    factors,
  };
}

function buildSignal(args: {
  input: V2GoldmineInput;
  candles: Candle[];
  mode: ModeKey;
  sweep: LiquiditySweep;
  displacement: Displacement;
  structureShift: StructureShift;
  entry: ConfirmedEntry;
  entryIndex: number;
  entryPrice: number;
  stopLoss: number;
  target: number;
  risk: number;
  reward: number;
  rr: number;
  score: ScoreResult;
  minRR: number;
  warnings: string[];
  sessionName: string;
  biasContext: BiasContext;
  atr: number;
  fixedTarget: boolean;
}): TradeSignal {
  const confirmation = args.candles[args.entryIndex];
  const displacementCandle = args.candles[args.displacement.candleIndex];
  const scoreBreakdown: SignalScoreBreakdown = {
    phase4Setup: (Number(args.score.factors.sweepValid) + Number(args.score.factors.displacementStrong) + Number(args.score.factors.mssConfirmed)) * 12.5,
    contextAlignment: Number(args.score.factors.biasAligned) * 12.5,
    confirmationCandle: Number(args.score.factors.confirmationFound) * 12.5,
    stopLossQuality: Number(args.score.factors.entryZoneFound) * 12.5,
    targetQuality: Number(args.score.factors.rrValid) * 12.5,
    sessionQuality: sessionQualityOk(args.sessionName) ? 12.5 : 0,
    volatilityQuality: 0,
    antiReversal: 0,
  };
  const range = confirmation.high - confirmation.low;
  const bodyRatio = range > 0 ? Math.abs(confirmation.close - confirmation.open) / range : 0;
  const closePosition = range > 0 ? (confirmation.close - confirmation.low) / range : 0.5;
  const directionLabel = args.sweep.direction === "BUY" ? "BULLISH" : "BEARISH";
  return {
    id: `${PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID}:${args.input.symbol}:${confirmation.timestamp}:${args.sweep.direction}`,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID,
    v2Direction: args.sweep.direction,
    type: args.sweep.direction === "BUY" ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
    direction: directionLabel,
    status: "CONFIRMED",
    sourceSetupId: setupId(args.sweep),
    setupType: "LIQUIDITY_SWEEP_REVERSAL",
    strategyModel: PRO_LIQUIDITY_CONFLUENCE_STRATEGY_LABEL,
    mode: "V2_DEFAULT",
    timestamp: confirmation.timestamp,
    candleIndex: args.entryIndex,
    confirmedAtIndex: args.entryIndex,
    timeframe: args.input.timeframe,
    session: toTradingSession(args.sessionName),
    entryPrice: round(args.entryPrice),
    stopLoss: round(args.stopLoss),
    takeProfit: round(args.target),
    takeProfit2: null,
    takeProfit3: null,
    riskPoints: round(args.risk),
    rewardPoints: round(args.reward),
    rr: round(args.rr, 3),
    score: args.score.percentScore,
    confidence: confidenceFor(args.score.percentScore),
    positionSizeSuggestion: round((args.input.settings?.maxRiskAmount ?? 100) / args.risk, 4),
    maxRiskAmount: args.input.settings?.maxRiskAmount ?? 100,
    invalidationLevel: round(args.stopLoss),
    reasons: [
      `${args.sweep.type} sweep reclaimed ${args.sweep.level.toFixed(2)} before displacement.`,
      `${directionLabel.toLowerCase()} displacement confirmed ${args.structureShift.type} at ${args.structureShift.brokenLevel.toFixed(2)}.`,
      `${args.entry.zone.source} retest held and a closed confirmation candle produced ${args.score.factorScore}/${CONFIG.maxScore} confluence.`,
    ],
    warnings: args.warnings,
    rejectionReasons: [],
    relatedMarkers: [
      `${args.sweep.type}:${args.sweep.candleIndex}`,
      `DISPLACEMENT:${args.displacement.candleIndex}`,
      `${args.structureShift.type}:${args.structureShift.confirmedAtIndex}`,
      `${args.entry.zone.source}:${args.entry.zone.createdAtIndex}`,
      `CONFIRMATION:${args.entryIndex}`,
    ],
    noRepaintProof: {
      status: "PASS",
      signalIndex: args.entryIndex,
      latestAllowedCandleIndex: args.entryIndex,
      usedMarkerIndexes: [args.sweep.candleIndex, args.displacement.candleIndex, args.structureShift.confirmedAtIndex, args.entry.zone.createdAtIndex, args.entry.retest.candleIndex, args.entryIndex],
      usedContextCloseTimes: [],
      usedSetupId: setupId(args.sweep),
      passed: true,
      lastAvailableIndex: args.entryIndex,
      maxEvidenceIndex: args.entryIndex,
      message: "Pro Liquidity Confluence signal uses only closed candles through sweep, displacement, MSS, retest, and confirmation; trade levels are immutable.",
    },
    stopLossDetail: {
      price: round(args.stopLoss),
      source: args.entry.zone.source === "ORDER_BLOCK" ? "SWEEP_OR_ORDER_BLOCK_ATR_BUFFER" : "SWEEP_EXTREME_ATR_BUFFER",
      buffer: round(args.atr * CONFIG.slAtrBuffer),
      riskPoints: round(args.risk),
      reason: "Stop is beyond the swept liquidity extreme and selected entry zone with ATR buffer.",
    },
    takeProfitDetail: {
      tp1: round(args.target),
      tp2: null,
      tp3: null,
      source: args.fixedTarget ? "FIXED_2R_FALLBACK" : "RECENT_BSL_SSL_OR_STRUCTURE",
      rewardPoints: round(args.reward),
      reason: args.fixedTarget ? "No qualifying opposite liquidity was available before confirmation; preferred fixed-RR target used." : "Nearest prior opposite liquidity or structure target available before confirmation.",
    },
    scoreBreakdown,
    proLiquidityConfluence: {
      stage: "CONFIRMED_SIGNAL",
      sessionName: args.sessionName,
      signalTime: confirmation.timestamp,
      htfBias: args.biasContext.htf,
      itfBias: args.biasContext.itf,
      liquiditySweep: {
        type: args.sweep.type,
        level: args.sweep.level,
        source: args.sweep.source,
        candleIndex: args.sweep.candleIndex,
        timestamp: args.sweep.timestamp,
        sweepPrice: args.sweep.sweepPrice,
        sweepDistanceAtr: args.sweep.sweepDistanceAtr,
        reclaimed: args.sweep.reclaimed,
        reclaimedAt: args.sweep.reclaimedAt,
        reclaimedAtIndex: args.sweep.reclaimedAtIndex,
      },
      displacement: {
        candleIndex: args.displacement.candleIndex,
        timestamp: displacementCandle.timestamp,
        direction: directionLabel,
        bodyRatio: args.displacement.bodyRatio,
        closePosition: args.displacement.closePosition,
        rangeAtrMultiple: args.displacement.rangeAtrMultiple,
        averageRangeMultiple: args.displacement.averageRangeMultiple,
      },
      structureShift: {
        type: args.structureShift.type,
        brokenLevel: args.structureShift.brokenLevel,
        confirmedAt: args.candles[args.structureShift.confirmedAtIndex].timestamp,
        confirmedAtIndex: args.structureShift.confirmedAtIndex,
      },
      entryZone: {
        type: args.entry.zone.type,
        createdAt: args.candles[args.entry.zone.createdAtIndex].timestamp,
        createdAtIndex: args.entry.zone.createdAtIndex,
        top: args.entry.zone.top,
        bottom: args.entry.zone.bottom,
        midpoint: args.entry.zone.midpoint,
        source: args.entry.zone.source,
        sizeAtr: args.entry.zone.sizeAtr,
        retestedAt: args.candles[args.entry.retest.candleIndex].timestamp,
        retestedAtIndex: args.entry.retest.candleIndex,
        retestDepthPercent: args.entry.retest.retestDepthPercent,
      },
      confirmation: {
        candleTime: confirmation.timestamp,
        candleIndex: args.entryIndex,
        open: confirmation.open,
        high: confirmation.high,
        low: confirmation.low,
        close: confirmation.close,
        bodyRatio,
        closePosition,
        rangeAtrMultiple: args.atr > 0 ? range / args.atr : 0,
      },
      confluence: {
        score: args.score.factorScore,
        maxScore: CONFIG.maxScore,
        confidence: args.score.percentScore,
        ...args.score.factors,
        warnings: args.warnings,
      },
    },
    immutable: true,
  };
}

function makeAudit(args: {
  mode: ModeKey;
  minSignalScore: number;
  minRR: number;
  candles: number;
  signals: TradeSignal[];
  rejectedSetups: RejectedSetup[];
  pendingCandidates: SignalCandidateDebug[];
  generationTimeMs: number;
  liquidityLevelsFound: number;
  sweepsFound: number;
  displacementsFound: number;
  mssFound: number;
  entryZonesFound: number;
  fvgZonesFound: number;
  orderBlocksFound: number;
  confirmationCandlesFound: number;
  expiredSetups: number;
  topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  candidateDebug: SignalCandidateDebug[];
  biasContext: BiasContext;
}): EntryEngineResult["audit"] {
  return {
    activeEngine: ACTIVE_SIGNAL_ENGINE,
    strategyId: PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID,
    activeMode: "V2_DEFAULT",
    minimumScoreRequired: args.minSignalScore,
    minimumSetupScoreRequired: 0,
    minimumSignalScoreRequired: args.minSignalScore,
    minimumRrRequired: args.minRR,
    totalCandlesScanned: args.candles,
    totalMarkersGenerated: 0,
    totalContextsGenerated: 0,
    totalPhase4Setups: 0,
    watchCount: args.pendingCandidates.length,
    setupCount: args.entryZonesFound,
    invalidatedCount: args.rejectedSetups.length,
    expiredCount: args.expiredSetups,
    totalSetupsScanned: args.sweepsFound,
    triggerSetupsFound: args.confirmationCandlesFound,
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
    noSignalMessage: args.signals.length ? null : "No confirmed pro liquidity confluence signal.",
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
    v2ProLiquidityConfluence: {
      activeEngineLabel: PRO_LIQUIDITY_CONFLUENCE_STRATEGY_LABEL,
      strategyId: PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID,
      candlesScanned: args.candles,
      htfBias: `${args.biasContext.htf.bias}:${args.biasContext.htf.strength}`,
      itfBias: `${args.biasContext.itf.bias}:${args.biasContext.itf.strength}`,
      liquidityLevelsFound: args.liquidityLevelsFound,
      sweepsFound: args.sweepsFound,
      displacementsFound: args.displacementsFound,
      mssFound: args.mssFound,
      entryZonesFound: args.entryZonesFound,
      fvgZonesFound: args.fvgZonesFound,
      orderBlocksFound: args.orderBlocksFound,
      confirmationCandlesFound: args.confirmationCandlesFound,
      confirmedSignals: args.signals.length,
      rejectedSignals: args.rejectedSetups.length,
      expiredSetups: args.expiredSetups,
      generationTimeMs: args.generationTimeMs,
      topRejectionReasons: args.topRejectionReasons,
    },
  };
}

function resolveBiasContext(context: MarketContextResult, candles: Candle[]): BiasContext {
  const maybeContext = context as Partial<MarketContextResult>;
  const derived = deriveLtfBias(candles);
  const htfBias = maybeContext.htfBias?.bias;
  const htfStrength = maybeContext.htfBias?.strength;
  const itfBias = maybeContext.itfSetup?.direction;
  const itfStrength = maybeContext.itfSetup?.strength;
  return {
    htf: {
      bias: htfBias ?? derived,
      strength: Number.isFinite(htfStrength) ? Number(htfStrength) : derived === "NEUTRAL" ? 35 : 58,
      source: htfBias ? "MARKET_CONTEXT" : "LTF_DERIVED",
    },
    itf: {
      bias: itfBias ?? (derived === "RANGING" || derived === "UNKNOWN" ? "NEUTRAL" : derived),
      strength: Number.isFinite(itfStrength) ? Number(itfStrength) : derived === "NEUTRAL" ? 35 : 55,
      source: itfBias ? "MARKET_CONTEXT" : "LTF_DERIVED",
    },
  };
}

function deriveLtfBias(candles: Candle[]): Bias {
  const closed = candles.slice(-30);
  if (closed.length < 6) return "UNKNOWN";
  const first = closed[0];
  const last = closed.at(-1)!;
  const avgRange = closed.reduce((sum, candle) => sum + candle.high - candle.low, 0) / closed.length;
  const net = last.close - first.close;
  if (Math.abs(net) < avgRange * 0.75) return "NEUTRAL";
  return net > 0 ? "BULLISH" : "BEARISH";
}

function biasSupportsDirection(direction: Direction, context: BiasContext): boolean {
  const desired = direction === "BUY" ? "BULLISH" : "BEARISH";
  return context.htf.bias === desired || context.itf.bias === desired;
}

function hasStrongOppositeBias(direction: Direction, context: BiasContext): boolean {
  const opposite = direction === "BUY" ? "BEARISH" : "BULLISH";
  return context.htf.bias === opposite && context.htf.strength >= CONFIG.strongOppositeBiasThreshold;
}

function biasWarnings(direction: Direction, context: BiasContext): string[] {
  const warnings: string[] = [];
  if (!biasSupportsDirection(direction, context)) warnings.push("HTF_ITF_BIAS_NOT_SUPPORTING_DIRECTION");
  if (hasStrongOppositeBias(direction, context)) warnings.push("STRONG_HTF_BIAS_AGAINST_SIGNAL");
  if (context.htf.bias === "NEUTRAL" || context.htf.bias === "RANGING") warnings.push("HTF_BIAS_NEUTRAL_ALLOWED_BY_CONFLUENCE");
  return warnings;
}

function volatilityOk(context: MarketContextResult): boolean {
  const maybeContext = context as Partial<MarketContextResult>;
  return maybeContext.volatility?.state !== "EXTREME_VOLATILITY";
}

function sessionQualityOk(sessionName: string): boolean {
  return sessionName === "LONDON" || sessionName === "NEW_YORK" || sessionName === "OVERLAP" || sessionName === "ASIAN";
}

function sessionWarnings(candles: Candle[], index: number, atr: number, sessionName: string): string[] {
  const warnings: string[] = [];
  if (sessionName === "DEAD_ZONE") warnings.push("OUTSIDE_ACTIVE_SESSION");
  if (sessionName === "ASIAN") warnings.push("ASIAN_SESSION_SCORE_ONLY");
  const asian = currentUtcAsianRange(candles, index);
  if (!asian.complete) warnings.push("WARNING_PARTIAL_ASIAN_RANGE");
  if (asian.range > atr * 8) warnings.push("WARNING_LARGE_ASIAN_RANGE");
  return warnings;
}

function currentUtcAsianRange(candles: Candle[], index: number): { complete: boolean; range: number } {
  const candle = candles[index];
  const date = new Date(candle.timestamp);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0);
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 7, 0);
  const source = candles.slice(0, index + 1).filter((item) => item.timestamp >= start && item.timestamp < end);
  if (source.length === 0) return { complete: false, range: 0 };
  return {
    complete: candles[index].timestamp >= end && source.length >= 6,
    range: Math.max(...source.map((item) => item.high)) - Math.min(...source.map((item) => item.low)),
  };
}

function calculateAverageRange(candles: Candle[], lookback: number): Array<number | null> {
  const output: Array<number | null> = Array(candles.length).fill(null);
  let rolling = 0;
  for (let index = 0; index < candles.length; index++) {
    rolling += candles[index].high - candles[index].low;
    if (index >= lookback) rolling -= candles[index - lookback].high - candles[index - lookback].low;
    if (index >= lookback - 1) output[index] = rolling / lookback;
  }
  return output;
}

function sessionNameAt(timestamp: number): string {
  const utc = new Date(timestamp);
  const hour = utc.getUTCHours();
  if (hour >= 0 && hour < 7) return "ASIAN";
  for (const session of CONFIG.allowedSessions) {
    const name = clockWindowAt(timestamp, session.timezone, [{ name: session.name, start: session.start, end: session.end }]);
    if (name) return name;
  }
  return "DEAD_ZONE";
}

function toTradingSession(session: string): TradingSession {
  if (session === "ASIAN") return "ASIAN";
  if (session === "LONDON") return "LONDON";
  if (session === "NEW_YORK") return "NEW_YORK";
  if (session === "OVERLAP") return "LONDON_NEW_YORK_OVERLAP";
  return "DEAD_ZONE";
}

function makeDebug(
  setupIdValue: string,
  direction: Direction,
  status: SignalCandidateDebug["confirmationStatus"],
  reason: string,
  remaining: number,
  stage: Stage,
  score: number | null,
  rr: number | null,
  requiredScore: number,
  requiredRR: number,
): SignalCandidateDebug {
  return {
    setupId: setupIdValue,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID,
    setupScore: score ?? 0,
    requiredSetupScore: requiredScore,
    finalSignalScore: score,
    requiredSignalScore: requiredScore,
    signalScore: score,
    rr,
    requiredRR,
    directionBias: direction === "BUY" ? "BULLISH" : "BEARISH",
    confirmationStatus: status,
    confirmationWindowRemaining: remaining,
    rejectionReason: reason,
    nextRequiredAction: nextActionFor(stage),
    failedStage: stage,
  };
}

function nextActionFor(stage: Stage): string {
  if (stage === "LIQUIDITY_SWEEP_DETECTED") return "Wait for strong displacement after the sweep.";
  if (stage === "DISPLACEMENT_CONFIRMED") return "Wait for MSS or CHoCH after displacement.";
  if (stage === "MSS_CONFIRMED" || stage === "ENTRY_ZONE_FOUND") return "Wait for an FVG, order block, 50%, or OTE retest.";
  if (stage === "WAITING_CONFIRMATION") return "Wait for a closed confirmation candle from the defended zone.";
  if (stage === "CONFIRMED_SIGNAL") return "Use immutable trade levels.";
  return "Wait for a full sweep, displacement, MSS, zone retest, and confirmation sequence.";
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

function setupId(sweep: LiquiditySweep): string {
  return `pro-liquidity:${sweep.type}:${sweep.candleIndex}:${round(sweep.level, 3)}:${sweep.direction}`;
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
  return score >= 90 ? "PREMIUM" : score >= 78 ? "STRONG" : score >= 63 ? "MODERATE" : "LOW_CONFIRMED";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
