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
import type { FvgZone, LiquidityZone } from "../market-structure/types";
import {
  ACTIVE_SIGNAL_ENGINE,
  ICT_OTE_CONTINUATION_CONFIG as CONFIG,
  ICT_OTE_CONTINUATION_STRATEGY_ID,
  ICT_OTE_CONTINUATION_STRATEGY_LABEL,
} from "./config";
import { calculateATR, calculateEMA, calculateSessionVWAP, detectFVG, zonedDateParts } from "./indicators";
import type { V2GoldmineInput } from "./types";

type Direction = "BUY" | "SELL";
type ModeKey = "easy" | "testing" | "normal" | "strict" | "professional";
type Bias = "BULLISH" | "BEARISH" | "NEUTRAL" | "RANGING" | "UNKNOWN";
type Stage = "IMPULSE_DETECTED" | "BOS_CONFIRMED" | "WAITING_OTE" | "OTE_TOUCHED" | "CONFIRMED_SIGNAL" | "REJECTED" | "EXPIRED";

type BiasContext = {
  htf: { bias: Bias; strength: number };
  itf: { bias: Bias; strength: number };
};

export type IctOteZone = {
  id: string;
  direction: "bullish" | "bearish";
  impulseHigh: number;
  impulseLow: number;
  oteLow: number;
  oteHigh: number;
  level62: number;
  level705: number;
  level79: number;
  touchedAt: number | null;
  confirmedAt: number | null;
  status: "waiting" | "touched" | "confirmed" | "invalidated";
  confluence: string[];
};

type ImpulseLeg = {
  direction: Direction;
  startIndex: number;
  endIndex: number;
  high: number;
  low: number;
  rangeAtrMultiple: number;
  displacementBodyRatio: number;
  closePosition: number;
  averageRangeMultiple: number;
};

type StructureBreak = {
  type: "BOS" | "MSS" | "CHOCH";
  brokenLevel: number;
  confirmedAtIndex: number;
  strong: boolean;
};

type Sweep = {
  found: boolean;
  type: "SSL" | "BSL" | null;
  level: number | null;
  candleIndex: number | null;
  timestamp: number | null;
};

type OteTouch = { candleIndex: number; price: number; depthPercent: number };
type Confirmation = { candleIndex: number; bodyRatio: number; closePosition: number; rejectionWickRatio: number };
type Confluence = { labels: string[]; orderBlockBoundary: number | null };
type ScoreFactors = {
  biasAligned: boolean;
  cleanImpulse: boolean;
  sweepOrStrongBos: boolean;
  displacementStrong: boolean;
  oteTouched: boolean;
  zoneConfluence: boolean;
  confirmationRejected: boolean;
  riskValid: boolean;
};

const resultCache = new Map<string, EntryEngineResult>();

export function clearIctOteContinuationCache(): void {
  resultCache.clear();
}

export function calculateOTEZone(impulseHigh: number, impulseLow: number, direction: Direction, id = "ote"): IctOteZone | null {
  const range = impulseHigh - impulseLow;
  if (!(range > 0)) return null;
  const level62 = direction === "BUY" ? impulseHigh - range * CONFIG.oteLevel62 : impulseLow + range * CONFIG.oteLevel62;
  const level705 = direction === "BUY" ? impulseHigh - range * CONFIG.oteLevel705 : impulseLow + range * CONFIG.oteLevel705;
  const level79 = direction === "BUY" ? impulseHigh - range * CONFIG.oteLevel79 : impulseLow + range * CONFIG.oteLevel79;
  return {
    id,
    direction: direction === "BUY" ? "bullish" : "bearish",
    impulseHigh,
    impulseLow,
    oteLow: Math.min(level62, level79),
    oteHigh: Math.max(level62, level79),
    level62,
    level705,
    level79,
    touchedAt: null,
    confirmedAt: null,
    status: "waiting",
    confluence: [],
  };
}

export function generateIctOteContinuationSignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const candles = input.candles.filter((candle) => candle.isClosed);
  const mode = resolveMode(input);
  const minRR = CONFIG.minRRByMode[mode];
  const minFactorScore = CONFIG.minFactorScoreByMode[mode];
  const minSignalScore = Math.round((minFactorScore / CONFIG.maxScore) * 100);
  const key = `${ICT_OTE_CONTINUATION_STRATEGY_ID}:${mode}:${input.symbol}:${input.timeframe}:${candles.length}:${candles.at(-1)?.timestamp ?? 0}:${input.settings?.maxRiskAmount ?? 100}`;
  const cached = resultCache.get(key);
  if (cached) return cloneResult(cached, "hit");

  const atr = calculateATR(candles, CONFIG.atrPeriod);
  const averageRange = calculateAverageRange(candles, CONFIG.averageRangePeriod);
  const ema20 = calculateEMA(candles, 20);
  const ema50 = calculateEMA(candles, 50);
  const vwap = calculateSessionVWAP(candles, "00:00", "UTC");
  const signals: TradeSignal[] = [];
  const pendingCandidates: SignalCandidateDebug[] = [];
  const candidateDebug: SignalCandidateDebug[] = [];
  const rejectedSetups: RejectedSetup[] = [];
  const rejectionCounts = new Map<string, number>();
  const sessionSignalCounts = new Map<string, number>();
  const daySignalCounts = new Map<string, number>();
  let impulsesFound = 0;
  let structureBreaksFound = 0;
  let sweepsFound = 0;
  let oteZonesCreated = 0;
  let oteTouchesFound = 0;
  let confluenceZonesFound = 0;
  let confirmationCandlesFound = 0;
  let expiredSetups = 0;

  const firstIndex = Math.max(CONFIG.atrPeriod, CONFIG.structureLookback + 2, CONFIG.averageRangePeriod);
  if (candles.length <= firstIndex) increment(rejectionCounts, "INSUFFICIENT_CANDLES");

  for (let index = firstIndex; index < candles.length; index++) {
    let acceptedAt = -1;
    for (const direction of ["BUY", "SELL"] as const) {
      const impulse = detectImpulseLeg(candles, index, direction, atr, averageRange);
      if (!impulse) continue;
      impulsesFound++;
      const setupIdValue = setupId(impulse, candles);
      const structureBreak = detectStructureBreak(candles, impulse, atr[index] ?? 0);
      if (!structureBreak) {
        addRejection(setupIdValue, direction, "NO_STRUCTURE_BREAK", index, "IMPULSE_DETECTED");
        continue;
      }
      structureBreaksFound++;
      const sweep = detectPreImpulseSweep(candles, impulse);
      if (sweep.found) sweepsFound++;
      if ((mode === "strict" || mode === "professional") && !sweep.found && !structureBreak.strong) {
        addRejection(setupIdValue, direction, "NO_LIQUIDITY", index, "BOS_CONFIRMED");
        continue;
      }

      const zone = calculateOTEZone(impulse.high, impulse.low, direction, setupIdValue);
      if (!zone) {
        addRejection(setupIdValue, direction, "NO_CLEAN_IMPULSE", index, "IMPULSE_DETECTED");
        continue;
      }
      oteZonesCreated++;
      const confluence = detectOTEConfluence(candles, impulse, zone, input.structure.fvgZones ?? [], input.structure.liquidityZones ?? [], ema20, ema50, vwap);
      zone.confluence = confluence.labels;
      if (confluence.labels.length) confluenceZonesFound++;

      const search = detectOTETouchAndConfirmation(candles, impulse, zone, atr);
      if (search.status === "PENDING") {
        const debug = makeDebug(setupIdValue, direction, "PENDING_CONFIRMATION", search.reason, search.remaining, search.stage, null, null, minSignalScore, minRR);
        candidateDebug.push(debug);
        pendingCandidates.push(debug);
        continue;
      }
      if (search.status === "REJECTED") {
        if (search.expired) expiredSetups++;
        addRejection(setupIdValue, direction, search.reason, index, search.expired ? "EXPIRED" : search.stage, search.expired ? "EXPIRED" : "INVALIDATED");
        continue;
      }

      const { touch, confirmation } = search;
      oteTouchesFound++;
      confirmationCandlesFound++;
      zone.touchedAt = candles[touch.candleIndex].timestamp;
      zone.confirmedAt = candles[confirmation.candleIndex].timestamp;
      zone.status = "confirmed";
      const confirmationCandle = candles[confirmation.candleIndex];
      const currentAtr = atr[confirmation.candleIndex] ?? atr[index] ?? 0;
      const bias = resolveBiasContext(input, candles.slice(0, confirmation.candleIndex + 1));
      const biasAligned = biasSupportsDirection(direction, bias);
      if (hasStrongOppositeBias(direction, bias) && mode !== "easy" && mode !== "testing") {
        addRejection(setupIdValue, direction, "HTF_BIAS_AGAINST_SIGNAL", confirmation.candleIndex, "OTE_TOUCHED");
        continue;
      }

      const entry = confirmationCandle.close;
      const stopLoss = direction === "BUY"
        ? Math.min(impulse.low, zone.oteLow, confluence.orderBlockBoundary ?? Number.POSITIVE_INFINITY) - currentAtr * CONFIG.slAtrBuffer
        : Math.max(impulse.high, zone.oteHigh, confluence.orderBlockBoundary ?? Number.NEGATIVE_INFINITY) + currentAtr * CONFIG.slAtrBuffer;
      const risk = direction === "BUY" ? entry - stopLoss : stopLoss - entry;
      if (!(risk > 0)) {
        addRejection(setupIdValue, direction, "INVALID_STOP_LOSS", confirmation.candleIndex, "OTE_TOUCHED");
        continue;
      }
      if (risk > currentAtr * CONFIG.maxSlAtrMultiple) {
        addRejection(setupIdValue, direction, "STOP_LOSS_TOO_WIDE", confirmation.candleIndex, "OTE_TOUCHED");
        continue;
      }
      const target = findNextLiquidityTarget(candles, input.structure.liquidityZones ?? [], confirmation.candleIndex, direction, entry, risk, impulse);
      if (!target) {
        addRejection(setupIdValue, direction, "INVALID_TAKE_PROFIT", confirmation.candleIndex, "OTE_TOUCHED");
        continue;
      }
      const reward = direction === "BUY" ? target.price - entry : entry - target.price;
      const rr = reward / risk;
      if (!Number.isFinite(rr) || rr < minRR) {
        addRejection(setupIdValue, direction, "RR_BELOW_MINIMUM", confirmation.candleIndex, "OTE_TOUCHED", "INVALIDATED", null, rr);
        continue;
      }

      const sessionName = sessionNameAt(confirmationCandle.timestamp);
      const local = zonedDateParts(confirmationCandle.timestamp, "UTC");
      const sessionKey = `${local.date}:${sessionName}`;
      if ((sessionSignalCounts.get(sessionKey) ?? 0) >= CONFIG.maxSignalsPerSession) {
        addRejection(setupIdValue, direction, "MAX_SESSION_SIGNALS_REACHED", confirmation.candleIndex, "CONFIRMED_SIGNAL");
        continue;
      }
      if ((daySignalCounts.get(local.date) ?? 0) >= CONFIG.maxSignalsPerDay) {
        addRejection(setupIdValue, direction, "MAX_DAILY_SIGNALS_REACHED", confirmation.candleIndex, "CONFIRMED_SIGNAL");
        continue;
      }

      const marketCondition = classifyMarketCondition(candles, confirmation.candleIndex, currentAtr);
      const warnings = unique([
        ...biasWarnings(direction, bias, mode),
        ...(sweep.found ? [] : ["NO_PRE_IMPULSE_LIQUIDITY_SWEEP"]),
        ...(confluence.labels.length ? [] : ["OTE_WITHOUT_FVG_OB_DEMAND_SUPPLY_CONFLUENCE"]),
        ...(sessionName === "ASIAN" ? ["ASIAN_SESSION_SCORE_ONLY"] : sessionName === "OFF_SESSION" ? ["OUTSIDE_ACTIVE_SESSION"] : []),
        ...(marketCondition === "CHOPPY" ? ["MARKET_CHOPPY_OR_OVERLAPPING"] : []),
      ]);
      const factors: ScoreFactors = {
        biasAligned,
        cleanImpulse: impulse.rangeAtrMultiple >= CONFIG.minImpulseRangeAtr,
        sweepOrStrongBos: sweep.found || structureBreak.strong,
        displacementStrong: impulse.displacementBodyRatio >= CONFIG.displacementBodyRatio && impulse.averageRangeMultiple >= CONFIG.minAverageRangeMultiple,
        oteTouched: true,
        zoneConfluence: confluence.labels.length > 0,
        confirmationRejected: true,
        riskValid: rr >= minRR && risk <= currentAtr * CONFIG.maxSlAtrMultiple,
      };
      const factorScore = Object.values(factors).filter(Boolean).length;
      const percentScore = Math.round((factorScore / CONFIG.maxScore) * 100);
      if (factorScore < minFactorScore) {
        addRejection(setupIdValue, direction, "SIGNAL_SCORE_TOO_LOW", confirmation.candleIndex, "CONFIRMED_SIGNAL", "INVALIDATED", percentScore, rr);
        continue;
      }

      const signal = buildSignal({
        input, candles, mode, impulse, structureBreak, sweep, zone, touch, confirmation, confluence, bias,
        marketCondition, sessionName, entry, stopLoss, target: target.price, fixedTarget: target.fixed,
        risk, reward, rr, factors, factorScore, percentScore, warnings, atr: currentAtr,
      });
      signals.push(signal);
      sessionSignalCounts.set(sessionKey, (sessionSignalCounts.get(sessionKey) ?? 0) + 1);
      daySignalCounts.set(local.date, (daySignalCounts.get(local.date) ?? 0) + 1);
      candidateDebug.push(makeDebug(setupIdValue, direction, "CONFIRMED", "CONFIRMED_SIGNAL", 0, "CONFIRMED_SIGNAL", percentScore, rr, minSignalScore, minRR));
      acceptedAt = confirmation.candleIndex;
      break;
    }
    if (acceptedAt >= 0) index = Math.max(index, acceptedAt);
  }

  if (impulsesFound === 0) {
    increment(rejectionCounts, "NO_CLEAN_IMPULSE");
    candidateDebug.push(makeDebug("ict-ote:none", "BUY", "REJECTED", "NO_CLEAN_IMPULSE", 0, "REJECTED", null, null, minSignalScore, minRR));
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
    rejectedSetups.push({
      setupId: setupIdValue,
      setupType: "TREND_CONTINUATION",
      setupState: state,
      direction: direction === "BUY" ? "BULLISH" : "BEARISH",
      triggerIndex: index,
      rejectionReasons: [rejectionMessage(code)],
      rejectionReasonCodes: [code],
      debug,
    });
  }

  const generationTimeMs = performance.now() - started;
  const topRejectionReasons = rejectionRows(rejectionCounts);
  const finalBias = resolveBiasContext(input, candles);
  const finalAtr = atr.at(-1) ?? 0;
  const marketCondition = classifyMarketCondition(candles, candles.length - 1, finalAtr ?? 0);
  const audit: EntryEngineResult["audit"] = {
    activeEngine: ACTIVE_SIGNAL_ENGINE,
    strategyId: ICT_OTE_CONTINUATION_STRATEGY_ID,
    activeMode: "V2_DEFAULT",
    minimumScoreRequired: minSignalScore,
    minimumSetupScoreRequired: minSignalScore,
    minimumSignalScoreRequired: minSignalScore,
    minimumRrRequired: minRR,
    totalCandlesScanned: candles.length,
    totalMarkersGenerated: 0,
    totalContextsGenerated: 0,
    totalPhase4Setups: 0,
    watchCount: pendingCandidates.length,
    setupCount: oteZonesCreated,
    invalidatedCount: rejectedSetups.length,
    expiredCount: expiredSetups,
    totalSetupsScanned: impulsesFound,
    triggerSetupsFound: confirmationCandlesFound,
    pendingConfirmationCount: pendingCandidates.length,
    expiredConfirmationCount: expiredSetups,
    invalidatedCandidateCount: rejectedSetups.length,
    confirmedBuyCount: signals.filter((signal) => signal.type === "CONFIRMED_BUY").length,
    confirmedSellCount: signals.filter((signal) => signal.type === "CONFIRMED_SELL").length,
    rapidBuyCount: 0,
    rapidSellCount: 0,
    rapidSignalCount: 0,
    rejectedSetupCount: rejectedSetups.length,
    lastRejectionReason: rejectedSetups.at(-1)?.rejectionReasons[0] ?? null,
    lastConfirmedSignal: signals.at(-1)?.id ?? null,
    topRejectionReasons: topRejectionReasons.map(({ reason, count }) => ({ reason, count })),
    lastFiveTriggerSetups: candidateDebug.slice(-5).map((item) => item.setupId),
    lastFiveConfirmedSignals: signals.slice(-5).map((signal) => signal.id),
    noSignalMessage: signals.length ? null : "No confirmed ICT OTE continuation signal.",
    noRepaintWarnings: [],
    rrCalculation: signals.at(-1) ? `${signals.at(-1)!.rr.toFixed(2)}R` : null,
    stopLossSource: signals.at(-1)?.stopLossDetail.source ?? null,
    takeProfitSource: signals.at(-1)?.takeProfitDetail.source ?? null,
    scoreBreakdown: signals.at(-1)?.scoreBreakdown ?? null,
    lastCandidateDebug: candidateDebug.at(-1) ?? null,
    noRepaintValidation: "PASS",
    calculationTimeMs: generationTimeMs,
    generationTimeMs,
    cacheStatus: "miss",
    v2IctOteContinuation: {
      activeEngineLabel: ICT_OTE_CONTINUATION_STRATEGY_LABEL,
      strategyId: ICT_OTE_CONTINUATION_STRATEGY_ID,
      candlesScanned: candles.length,
      htfBias: `${finalBias.htf.bias}:${finalBias.htf.strength}`,
      itfBias: `${finalBias.itf.bias}:${finalBias.itf.strength}`,
      marketCondition,
      impulsesFound,
      structureBreaksFound,
      sweepsFound,
      oteZonesCreated,
      oteTouchesFound,
      confluenceZonesFound,
      confirmationCandlesFound,
      confirmedSignals: signals.length,
      rejectedSignals: rejectedSetups.length,
      expiredSetups,
      generationTimeMs,
      topRejectionReasons,
    },
  };
  const result: EntryEngineResult = {
    signals,
    activeSignals: signals,
    signalMap: new Map(signals.map((signal) => [signal.id, signal])),
    pendingCandidates,
    candidateDebug,
    rejectedSetups,
    noTrade: signals.length ? null : {
      status: "NO_TRADE",
      checkedSetups: impulsesFound,
      rejectionReasons: topRejectionReasons.map((row) => rejectionMessage(row.reason as SignalRejectionCode)),
      message: pendingCandidates.length ? "ICT OTE continuation setup is still forming." : "No confirmed ICT OTE continuation signal found.",
      nearestPossibleSetup: pendingCandidates.at(-1)?.setupId ?? rejectedSetups.at(-1)?.setupId ?? null,
      requiredForSignal: ["HTF/ITF continuation bias", "Clean impulse and BOS/MSS", "0.62-0.79 OTE retracement", "OTE rejection candle", `${minRR.toFixed(1)}R and ${minFactorScore}/8 score`],
      timestamp: candles.at(-1)?.timestamp ?? null,
    },
    audit,
  };
  if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value ?? "");
  resultCache.set(key, result);
  return result;
}

export function detectImpulseLeg(
  candles: Candle[],
  endIndex: number,
  direction: Direction,
  atr: Array<number | null>,
  averageRange: Array<number | null>,
): ImpulseLeg | null {
  const candle = candles[endIndex];
  const currentAtr = atr[endIndex];
  const currentAverage = averageRange[endIndex];
  if (!candle || !currentAtr || !currentAverage) return null;
  const candleRange = candle.high - candle.low;
  if (candleRange < currentAtr * CONFIG.minDisplacementRangeAtr || candleRange < currentAverage * CONFIG.minAverageRangeMultiple) return null;
  const bodyRatio = Math.abs(candle.close - candle.open) / Math.max(candleRange, Number.EPSILON);
  const closePosition = (candle.close - candle.low) / Math.max(candleRange, Number.EPSILON);
  if (bodyRatio < CONFIG.displacementBodyRatio) return null;
  if (direction === "BUY" && !(candle.close > candle.open && closePosition >= CONFIG.displacementClosePosition)) return null;
  if (direction === "SELL" && !(candle.close < candle.open && closePosition <= 1 - CONFIG.displacementClosePosition)) return null;
  const start = Math.max(0, endIndex - CONFIG.impulseOriginLookback);
  const originWindow = candles.slice(start, endIndex);
  if (!originWindow.length) return null;
  const relativeOrigin = direction === "BUY"
    ? originWindow.reduce((best, item, index) => item.low < originWindow[best].low ? index : best, 0)
    : originWindow.reduce((best, item, index) => item.high > originWindow[best].high ? index : best, 0);
  const startIndex = start + relativeOrigin;
  const high = direction === "BUY" ? candle.high : Math.max(...candles.slice(startIndex, endIndex + 1).map((item) => item.high));
  const low = direction === "SELL" ? candle.low : Math.min(...candles.slice(startIndex, endIndex + 1).map((item) => item.low));
  if ((high - low) / currentAtr < CONFIG.minImpulseRangeAtr) return null;
  return {
    direction,
    startIndex,
    endIndex,
    high,
    low,
    rangeAtrMultiple: (high - low) / currentAtr,
    displacementBodyRatio: bodyRatio,
    closePosition,
    averageRangeMultiple: candleRange / currentAverage,
  };
}

function detectStructureBreak(candles: Candle[], impulse: ImpulseLeg, atr: number): StructureBreak | null {
  const start = Math.max(0, impulse.startIndex - CONFIG.structureLookback);
  const prior = candles.slice(start, impulse.startIndex);
  const fallback = candles.slice(Math.max(0, impulse.endIndex - CONFIG.structureLookback), impulse.endIndex);
  const source = prior.length >= CONFIG.swingLookback ? prior : fallback;
  if (!source.length) return null;
  const level = impulse.direction === "BUY" ? Math.max(...source.map((candle) => candle.high)) : Math.min(...source.map((candle) => candle.low));
  const end = candles[impulse.endIndex];
  const closedBreak = impulse.direction === "BUY" ? end.close > level : end.close < level;
  const wickBreak = impulse.direction === "BUY" ? end.high > level : end.low < level;
  if (!closedBreak && !wickBreak) return null;
  const breakDistance = impulse.direction === "BUY" ? end.close - level : level - end.close;
  return {
    type: closedBreak ? "BOS" : "CHOCH",
    brokenLevel: level,
    confirmedAtIndex: impulse.endIndex,
    strong: closedBreak && (breakDistance >= atr * CONFIG.strongBosBufferAtr || impulse.rangeAtrMultiple >= 1.8),
  };
}

function detectPreImpulseSweep(candles: Candle[], impulse: ImpulseLeg): Sweep {
  const scanStart = Math.max(1, impulse.startIndex - 5);
  for (let index = scanStart; index <= impulse.endIndex; index++) {
    const prior = candles.slice(Math.max(0, index - 16), Math.max(0, index - 3));
    if (prior.length < 3) continue;
    const candle = candles[index];
    if (impulse.direction === "BUY") {
      const level = Math.min(...prior.map((item) => item.low));
      if (candle.low < level && candle.close > level) return { found: true, type: "SSL", level, candleIndex: index, timestamp: candle.timestamp };
    } else {
      const level = Math.max(...prior.map((item) => item.high));
      if (candle.high > level && candle.close < level) return { found: true, type: "BSL", level, candleIndex: index, timestamp: candle.timestamp };
    }
  }
  return { found: false, type: null, level: null, candleIndex: null, timestamp: null };
}

function detectOTEConfluence(
  candles: Candle[],
  impulse: ImpulseLeg,
  zone: IctOteZone,
  existingFvgs: FvgZone[],
  liquidityZones: LiquidityZone[],
  ema20: Array<number | null>,
  ema50: Array<number | null>,
  vwap: ReturnType<typeof calculateSessionVWAP>,
): Confluence {
  const labels = new Set<string>();
  let orderBlockBoundary: number | null = null;
  for (let index = Math.max(2, impulse.startIndex); index <= impulse.endIndex; index++) {
    const fvg = detectFVG(candles, index);
    if (!fvg) continue;
    const directional = impulse.direction === "BUY" ? fvg.type === "BULLISH_FVG" : fvg.type === "BEARISH_FVG";
    if (directional && overlaps(zone.oteLow, zone.oteHigh, fvg.bottom, fvg.top)) labels.add("FVG");
  }
  if (existingFvgs.some((fvg) => fvg.confirmedAtIndex <= impulse.endIndex && fvg.direction === (impulse.direction === "BUY" ? "BULLISH" : "BEARISH") && overlaps(zone.oteLow, zone.oteHigh, fvg.minPrice, fvg.maxPrice))) labels.add("FVG");
  for (let index = impulse.endIndex - 1; index >= Math.max(0, impulse.startIndex - 3); index--) {
    const candle = candles[index];
    const opposite = impulse.direction === "BUY" ? candle.close < candle.open : candle.close > candle.open;
    if (!opposite || !overlaps(zone.oteLow, zone.oteHigh, candle.low, candle.high)) continue;
    labels.add("ORDER_BLOCK");
    orderBlockBoundary = impulse.direction === "BUY" ? candle.low : candle.high;
    break;
  }
  if (liquidityZones.some((liquidity) => liquidity.confirmedAtIndex <= impulse.endIndex && liquidity.type === (impulse.direction === "BUY" ? "SSL" : "BSL") && liquidity.price >= zone.oteLow && liquidity.price <= zone.oteHigh)) labels.add(impulse.direction === "BUY" ? "DEMAND" : "SUPPLY");
  const supports = [ema20[impulse.endIndex], ema50[impulse.endIndex], vwap[impulse.endIndex]?.value];
  if (supports.some((value) => value !== null && value !== undefined && value >= zone.oteLow && value <= zone.oteHigh)) labels.add("EMA_VWAP");
  return { labels: [...labels], orderBlockBoundary };
}

function detectOTETouchAndConfirmation(
  candles: Candle[],
  impulse: ImpulseLeg,
  zone: IctOteZone,
  atr: Array<number | null>,
):
  | { status: "CONFIRMED"; touch: OteTouch; confirmation: Confirmation }
  | { status: "PENDING"; reason: SignalRejectionCode; remaining: number; stage: Stage }
  | { status: "REJECTED"; reason: SignalRejectionCode; stage: Stage; expired: boolean } {
  const deadline = impulse.endIndex + CONFIG.maxCandlesToTouchOte;
  const maxIndex = Math.min(candles.length - 1, deadline);
  let touch: OteTouch | null = null;
  for (let index = impulse.endIndex + 1; index <= maxIndex; index++) {
    const currentAtr = atr[index] ?? atr[impulse.endIndex] ?? 0;
    if (oteInvalidated(candles[index], zone, impulse, currentAtr)) return { status: "REJECTED", reason: "OTE_INVALIDATED", stage: "WAITING_OTE", expired: false };
    if (touchesOte(candles[index], zone, currentAtr)) {
      const price = impulse.direction === "BUY" ? Math.max(zone.oteLow, Math.min(candles[index].low, zone.oteHigh)) : Math.max(zone.oteLow, Math.min(candles[index].high, zone.oteHigh));
      const depth = impulse.direction === "BUY" ? (zone.oteHigh - price) / Math.max(zone.oteHigh - zone.oteLow, Number.EPSILON) : (price - zone.oteLow) / Math.max(zone.oteHigh - zone.oteLow, Number.EPSILON);
      touch = { candleIndex: index, price, depthPercent: Math.round(depth * 1000) / 10 };
      break;
    }
  }
  if (!touch) {
    if (candles.length - 1 < deadline) return { status: "PENDING", reason: "NO_OTE_RETRACEMENT", remaining: deadline - (candles.length - 1), stage: "WAITING_OTE" };
    return { status: "REJECTED", reason: "NO_OTE_RETRACEMENT", stage: "EXPIRED", expired: true };
  }
  const confirmationDeadline = touch.candleIndex + CONFIG.confirmationWindow;
  const confirmationMax = Math.min(candles.length - 1, confirmationDeadline);
  for (let index = touch.candleIndex; index <= confirmationMax; index++) {
    const currentAtr = atr[index] ?? atr[impulse.endIndex] ?? 0;
    if (oteInvalidated(candles[index], zone, impulse, currentAtr)) return { status: "REJECTED", reason: "OTE_INVALIDATED", stage: "OTE_TOUCHED", expired: false };
    const confirmation = detectOTERejection(candles, index, zone, impulse.direction, currentAtr);
    if (confirmation) return { status: "CONFIRMED", touch, confirmation };
  }
  if (candles.length - 1 < confirmationDeadline) return { status: "PENDING", reason: "OTE_NO_REJECTION", remaining: confirmationDeadline - (candles.length - 1), stage: "OTE_TOUCHED" };
  return { status: "REJECTED", reason: "OTE_NO_REJECTION", stage: "EXPIRED", expired: true };
}

export function detectOTETouch(candle: Candle, zone: IctOteZone, atr: number): boolean {
  return touchesOte(candle, zone, atr);
}

function touchesOte(candle: Candle, zone: IctOteZone, atr: number): boolean {
  const tolerance = atr * CONFIG.retestToleranceAtr;
  return candle.low <= zone.oteHigh + tolerance && candle.high >= zone.oteLow - tolerance;
}

function oteInvalidated(candle: Candle, zone: IctOteZone, impulse: ImpulseLeg, atr: number): boolean {
  const buffer = atr * CONFIG.deepRetracementBufferAtr;
  return impulse.direction === "BUY"
    ? candle.close < zone.level79 - buffer || candle.close < impulse.low
    : candle.close > zone.level79 + buffer || candle.close > impulse.high;
}

export function detectOTERejection(candles: Candle[], index: number, zone: IctOteZone, direction: Direction, atr: number): Confirmation | null {
  const candle = candles[index];
  if (!candle) return null;
  const range = candle.high - candle.low;
  if (range <= 0 || range < atr * CONFIG.minConfirmationRangeAtr) return null;
  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  const closePosition = (candle.close - candle.low) / range;
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const rejectionWickRatio = (direction === "BUY" ? lowerWick : upperWick) / range;
  const previous = candles[index - 1];
  const closesBeyondReference = direction === "BUY"
    ? candle.close > zone.level705 || Boolean(previous && candle.close > previous.high)
    : candle.close < zone.level705 || Boolean(previous && candle.close < previous.low);
  const directional = direction === "BUY"
    ? candle.close > candle.open && closePosition >= CONFIG.confirmationClosePosition
    : candle.close < candle.open && closePosition <= 1 - CONFIG.confirmationClosePosition;
  if (!directional || bodyRatio < CONFIG.confirmationBodyRatio || rejectionWickRatio < CONFIG.minRejectionWickRatio || !closesBeyondReference) return null;
  return { candleIndex: index, bodyRatio, closePosition, rejectionWickRatio };
}

export function findNextLiquidityTarget(
  candles: Candle[],
  liquidityZones: LiquidityZone[],
  index: number,
  direction: Direction,
  entry: number,
  risk: number,
  impulse: ImpulseLeg,
): { price: number; fixed: boolean } | null {
  const liquidity = liquidityZones
    .filter((zone) => zone.confirmedAtIndex <= index && (zone.sweptAtIndex === undefined || zone.sweptAtIndex > index))
    .filter((zone) => direction === "BUY" ? zone.type === "BSL" && zone.price > entry : zone.type === "SSL" && zone.price < entry)
    .map((zone) => zone.price);
  const historical = candles.slice(Math.max(0, index - 80), index).flatMap((candle) => direction === "BUY" && candle.high > entry ? [candle.high] : direction === "SELL" && candle.low < entry ? [candle.low] : []);
  const candidates = [...liquidity, ...historical].sort((left, right) => Math.abs(left - entry) - Math.abs(right - entry));
  if (candidates.length) return { price: candidates[0], fixed: false };
  const extension = direction === "BUY"
    ? impulse.high + (impulse.high - impulse.low) * 0.272
    : impulse.low - (impulse.high - impulse.low) * 0.272;
  if (direction === "BUY" ? extension > entry : extension < entry) return { price: extension, fixed: false };
  if (!(risk > 0)) return null;
  return { price: direction === "BUY" ? entry + risk * CONFIG.preferredRR : entry - risk * CONFIG.preferredRR, fixed: true };
}

export function validateOTERisk(entry: number, stopLoss: number, takeProfit: number, direction: Direction, mode: ModeKey, atr: number): { valid: boolean; rr: number; reason: SignalRejectionCode | null } {
  const risk = direction === "BUY" ? entry - stopLoss : stopLoss - entry;
  const reward = direction === "BUY" ? takeProfit - entry : entry - takeProfit;
  if (!(risk > 0) || !(reward > 0)) return { valid: false, rr: 0, reason: "INVALID_STOP_LOSS" };
  if (risk > atr * CONFIG.maxSlAtrMultiple) return { valid: false, rr: reward / risk, reason: "STOP_LOSS_TOO_WIDE" };
  const rr = reward / risk;
  return rr >= CONFIG.minRRByMode[mode] ? { valid: true, rr, reason: null } : { valid: false, rr, reason: "RR_BELOW_MINIMUM" };
}

function buildSignal(args: {
  input: V2GoldmineInput; candles: Candle[]; mode: ModeKey; impulse: ImpulseLeg; structureBreak: StructureBreak; sweep: Sweep;
  zone: IctOteZone; touch: OteTouch; confirmation: Confirmation; confluence: Confluence; bias: BiasContext; marketCondition: string;
  sessionName: string; entry: number; stopLoss: number; target: number; fixedTarget: boolean; risk: number; reward: number; rr: number;
  factors: ScoreFactors; factorScore: number; percentScore: number; warnings: string[]; atr: number;
}): TradeSignal {
  const confirmationCandle = args.candles[args.confirmation.candleIndex];
  const scoreBreakdown: SignalScoreBreakdown = {
    phase4Setup: (Number(args.factors.cleanImpulse) + Number(args.factors.sweepOrStrongBos) + Number(args.factors.displacementStrong)) * 12.5,
    contextAlignment: Number(args.factors.biasAligned) * 12.5,
    confirmationCandle: Number(args.factors.confirmationRejected) * 12.5,
    stopLossQuality: Number(args.factors.oteTouched) * 12.5,
    targetQuality: Number(args.factors.riskValid) * 12.5,
    sessionQuality: Number(args.factors.zoneConfluence) * 12.5,
    volatilityQuality: 0,
    antiReversal: 0,
  };
  return {
    id: `${ICT_OTE_CONTINUATION_STRATEGY_ID}:${args.input.symbol}:${confirmationCandle.timestamp}:${args.impulse.direction}`,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: ICT_OTE_CONTINUATION_STRATEGY_ID,
    v2Direction: args.impulse.direction,
    type: args.impulse.direction === "BUY" ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
    direction: args.impulse.direction === "BUY" ? "BULLISH" : "BEARISH",
    status: "CONFIRMED",
    sourceSetupId: args.zone.id,
    setupType: "TREND_CONTINUATION",
    strategyModel: ICT_OTE_CONTINUATION_STRATEGY_LABEL,
    mode: "V2_DEFAULT",
    timestamp: confirmationCandle.timestamp,
    candleIndex: args.confirmation.candleIndex,
    confirmedAtIndex: args.confirmation.candleIndex,
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
    score: args.percentScore,
    confidence: confidenceFor(args.percentScore),
    positionSizeSuggestion: round((args.input.settings?.maxRiskAmount ?? 100) / args.risk, 4),
    maxRiskAmount: args.input.settings?.maxRiskAmount ?? 100,
    invalidationLevel: round(args.stopLoss),
    reasons: [
      `${args.impulse.direction} continuation impulse broke structure at ${args.structureBreak.brokenLevel.toFixed(2)}.`,
      `Price retraced into the 0.62-0.79 OTE zone and rejected near ${args.zone.level705.toFixed(2)}.`,
      `${args.factorScore}/${CONFIG.maxScore} OTE factors confirmed with ${args.rr.toFixed(2)}R.`,
    ],
    warnings: args.warnings,
    rejectionReasons: [],
    relatedMarkers: [`IMPULSE:${args.impulse.endIndex}`, `${args.structureBreak.type}:${args.structureBreak.confirmedAtIndex}`, `OTE:${args.touch.candleIndex}`, `CONFIRMATION:${args.confirmation.candleIndex}`],
    noRepaintProof: {
      status: "PASS",
      signalIndex: args.confirmation.candleIndex,
      latestAllowedCandleIndex: args.confirmation.candleIndex,
      usedMarkerIndexes: uniqueNumbers([args.impulse.startIndex, args.impulse.endIndex, args.structureBreak.confirmedAtIndex, ...(args.sweep.candleIndex === null ? [] : [args.sweep.candleIndex]), args.touch.candleIndex, args.confirmation.candleIndex]),
      usedContextCloseTimes: [],
      usedSetupId: args.zone.id,
      passed: true,
      lastAvailableIndex: args.confirmation.candleIndex,
      maxEvidenceIndex: args.confirmation.candleIndex,
      message: "ICT OTE continuation uses only closed candles through impulse, structure break, OTE touch, and rejection confirmation; trade levels are immutable.",
    },
    stopLossDetail: { price: round(args.stopLoss), source: "OTE_IMPULSE_EXTREME_ATR_BUFFER", buffer: round(args.atr * CONFIG.slAtrBuffer), riskPoints: round(args.risk), reason: "Stop is beyond the OTE zone, impulse invalidation, and overlapping order block when present." },
    takeProfitDetail: { tp1: round(args.target), tp2: null, tp3: null, source: args.fixedTarget ? "FIXED_2R_FALLBACK" : "NEXT_LIQUIDITY_OR_IMPULSE_EXTENSION", rewardPoints: round(args.reward), reason: args.fixedTarget ? "No causal liquidity target was available; fixed 2R was used." : "Target uses causal BSL/SSL, prior structure, or impulse extension." },
    scoreBreakdown,
    ictOteContinuation: {
      stage: "CONFIRMED_SIGNAL",
      sessionName: args.sessionName,
      signalTime: confirmationCandle.timestamp,
      htfBias: `${args.bias.htf.bias}:${args.bias.htf.strength}`,
      itfBias: `${args.bias.itf.bias}:${args.bias.itf.strength}`,
      marketCondition: args.marketCondition,
      impulse: {
        direction: args.impulse.direction === "BUY" ? "BULLISH" : "BEARISH",
        startIndex: args.impulse.startIndex,
        endIndex: args.impulse.endIndex,
        startTime: args.candles[args.impulse.startIndex].timestamp,
        endTime: args.candles[args.impulse.endIndex].timestamp,
        high: args.impulse.high,
        low: args.impulse.low,
        rangeAtrMultiple: args.impulse.rangeAtrMultiple,
        displacementBodyRatio: args.impulse.displacementBodyRatio,
        averageRangeMultiple: args.impulse.averageRangeMultiple,
      },
      structureBreak: { ...args.structureBreak, confirmedAt: args.candles[args.structureBreak.confirmedAtIndex].timestamp },
      liquiditySweep: args.sweep,
      ote: {
        id: args.zone.id,
        direction: args.zone.direction,
        low: args.zone.oteLow,
        high: args.zone.oteHigh,
        level62: args.zone.level62,
        level705: args.zone.level705,
        level79: args.zone.level79,
        touchedAt: args.candles[args.touch.candleIndex].timestamp,
        touchedAtIndex: args.touch.candleIndex,
        confirmedAt: confirmationCandle.timestamp,
        confirmedAtIndex: args.confirmation.candleIndex,
        status: "confirmed",
        confluence: args.confluence.labels,
      },
      confirmation: {
        candleTime: confirmationCandle.timestamp,
        candleIndex: args.confirmation.candleIndex,
        open: confirmationCandle.open,
        high: confirmationCandle.high,
        low: confirmationCandle.low,
        close: confirmationCandle.close,
        bodyRatio: args.confirmation.bodyRatio,
        closePosition: args.confirmation.closePosition,
        rejectionWickRatio: args.confirmation.rejectionWickRatio,
        pressure: args.impulse.direction === "BUY" ? "BUYERS" : "SELLERS",
      },
      confluence: { score: args.factorScore, maxScore: 8, confidence: args.percentScore, ...args.factors, warnings: args.warnings },
    },
    immutable: true,
  };
}

function resolveBiasContext(input: V2GoldmineInput, candles: Candle[]): BiasContext {
  const derived = deriveBias(candles);
  const htf = normalizeBias(input.context?.htfBias?.bias) ?? derived;
  const itf = normalizeBias(input.context?.itfSetup?.direction) ?? derived;
  return {
    htf: { bias: htf, strength: Number.isFinite(input.context?.htfBias?.strength) ? input.context.htfBias.strength : derived === "NEUTRAL" ? 35 : 58 },
    itf: { bias: itf, strength: Number.isFinite(input.context?.itfSetup?.strength) ? input.context.itfSetup.strength : derived === "NEUTRAL" ? 35 : 55 },
  };
}

function normalizeBias(value: unknown): Bias | null {
  if (value === "BULLISH" || value === "BEARISH" || value === "NEUTRAL" || value === "RANGING" || value === "UNKNOWN") return value;
  return null;
}

function deriveBias(candles: Candle[]): Bias {
  const source = candles.slice(-30);
  if (source.length < 6) return "UNKNOWN";
  const average = source.reduce((sum, candle) => sum + candle.high - candle.low, 0) / source.length;
  const net = source.at(-1)!.close - source[0].close;
  if (Math.abs(net) < average) return "NEUTRAL";
  return net > 0 ? "BULLISH" : "BEARISH";
}

function biasSupportsDirection(direction: Direction, bias: BiasContext): boolean {
  const desired = direction === "BUY" ? "BULLISH" : "BEARISH";
  return bias.htf.bias === desired || bias.itf.bias === desired;
}

function hasStrongOppositeBias(direction: Direction, bias: BiasContext): boolean {
  const opposite = direction === "BUY" ? "BEARISH" : "BULLISH";
  return bias.htf.bias === opposite && bias.htf.strength >= CONFIG.strongOppositeBiasThreshold;
}

function biasWarnings(direction: Direction, bias: BiasContext, mode: ModeKey): string[] {
  const warnings: string[] = [];
  if (!biasSupportsDirection(direction, bias)) warnings.push("NO_CLEAR_HTF_ITF_CONTINUATION_BIAS");
  if (bias.htf.bias === "NEUTRAL" || bias.htf.bias === "RANGING") warnings.push(mode === "easy" || mode === "testing" ? "HTF_NEUTRAL_SCORE_REDUCTION" : "HTF_NEUTRAL");
  return warnings;
}

function classifyMarketCondition(candles: Candle[], index: number, atr: number): string {
  const source = candles.slice(Math.max(0, index - 20), index + 1);
  if (source.length < 6 || !(atr > 0)) return "UNKNOWN";
  const net = Math.abs(source.at(-1)!.close - source[0].close);
  const overlapping = source.slice(1).filter((candle, offset) => candle.high >= source[offset].low && candle.low <= source[offset].high).length;
  if (net >= atr * 2) return "TRENDING";
  if (overlapping / Math.max(1, source.length - 1) >= 0.75) return "CHOPPY";
  return "TRANSITIONAL";
}

function sessionNameAt(timestamp: number): string {
  const hour = new Date(timestamp).getUTCHours();
  if (hour < 7) return "ASIAN";
  if (hour < 11) return "LONDON";
  if (hour >= 12 && hour < 16) return "NEW_YORK";
  return "OFF_SESSION";
}

function toTradingSession(session: string): TradingSession {
  if (session === "ASIAN") return "ASIAN";
  if (session === "LONDON") return "LONDON";
  if (session === "NEW_YORK") return "NEW_YORK";
  return "DEAD_ZONE";
}

function resolveMode(input: V2GoldmineInput): ModeKey {
  const raw = (input.settings?.currentMode ?? input.settings?.mode ?? "normal").toLowerCase();
  if (raw.includes("easy") || raw.includes("calibration")) return "easy";
  if (raw.includes("test")) return "testing";
  if (raw.includes("strict")) return "strict";
  if (raw.includes("pro")) return "professional";
  return "normal";
}

function makeDebug(setupIdValue: string, direction: Direction, status: SignalCandidateDebug["confirmationStatus"], reason: string, remaining: number, stage: Stage, score: number | null, rr: number | null, requiredScore: number, requiredRR: number): SignalCandidateDebug {
  return {
    setupId: setupIdValue,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: ICT_OTE_CONTINUATION_STRATEGY_ID,
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
    rejectionReason: rejectionMessage(reason as SignalRejectionCode),
    nextRequiredAction: nextAction(stage),
    failedStage: stage,
  };
}

function nextAction(stage: Stage): string {
  if (stage === "IMPULSE_DETECTED") return "Wait for BOS or MSS after the impulse begins.";
  if (stage === "BOS_CONFIRMED" || stage === "WAITING_OTE") return "Wait for price to retrace into the 0.62-0.79 OTE zone.";
  if (stage === "OTE_TOUCHED") return "Wait for a closed rejection candle from OTE.";
  if (stage === "CONFIRMED_SIGNAL") return "Use immutable entry, stop, and target levels.";
  return "Wait for a new continuation impulse and OTE retracement.";
}

function rejectionMessage(code: SignalRejectionCode): string {
  const messages: Partial<Record<SignalRejectionCode, string>> = {
    NO_CONTINUATION_BIAS: "No clear HTF/ITF continuation bias",
    NO_CLEAN_IMPULSE: "No clean impulse leg found",
    IMPULSE_TOO_WEAK: "Impulse leg too weak",
    NO_STRUCTURE_BREAK: "No BOS/MSS after impulse",
    NO_OTE_RETRACEMENT: "Price has not retraced into OTE zone",
    OTE_NO_REJECTION: "OTE touched but no rejection candle",
    OTE_INVALIDATED: "OTE invalidated by deep retracement",
    INVALID_TAKE_PROFIT: "No valid TP liquidity target",
    RR_BELOW_MINIMUM: "RR below required threshold",
    STOP_LOSS_TOO_WIDE: "Stop loss too wide",
    MARKET_LOW_QUALITY: "Market is choppy or low quality for OTE continuation",
  };
  return messages[code] ?? code;
}

function setupId(impulse: ImpulseLeg, candles: Candle[]): string {
  return `ict-ote:${impulse.direction}:${candles[impulse.startIndex].timestamp}:${candles[impulse.endIndex].timestamp}`;
}

function overlaps(aLow: number, aHigh: number, bLow: number, bHigh: number): boolean {
  return aLow <= bHigh && aHigh >= bLow;
}

function calculateAverageRange(candles: Candle[], lookback: number): Array<number | null> {
  const result: Array<number | null> = Array(candles.length).fill(null);
  let sum = 0;
  for (let index = 0; index < candles.length; index++) {
    sum += candles[index].high - candles[index].low;
    if (index >= lookback) sum -= candles[index - lookback].high - candles[index - lookback].low;
    if (index >= lookback - 1) result[index] = sum / lookback;
  }
  return result;
}

function rejectionRows(counts: Map<string, number>) {
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return [...counts.entries()].map(([reason, count]) => ({ reason, count, percentage: total ? Math.round(count / total * 1000) / 10 : 0 })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function cloneResult(result: EntryEngineResult, cacheStatus: "hit" | "miss"): EntryEngineResult {
  return { ...result, signalMap: new Map(result.signalMap), audit: { ...result.audit, cacheStatus } };
}

function confidenceFor(score: number): TradeSignal["confidence"] {
  return score >= 100 ? "PREMIUM" : score >= 88 ? "STRONG" : score >= 75 ? "MODERATE" : "LOW_CONFIRMED";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
