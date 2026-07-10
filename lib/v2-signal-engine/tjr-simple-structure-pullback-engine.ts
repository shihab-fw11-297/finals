import type { Candle, Timeframe } from "../candles/types";
import type {
  EntryEngineResult,
  RejectedSetup,
  SignalCandidateDebug,
  SignalRejectionCode,
  SignalScoreBreakdown,
  TjrSimpleStructurePullbackSnapshot,
  TradeSignal,
} from "../entry-engine/types";
import type { MarketContextResult, TradingSession } from "../market-context/types";
import {
  ACTIVE_SIGNAL_ENGINE,
  TJR_SIMPLE_STRUCTURE_PULLBACK_CONFIG as CONFIG,
  TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID,
  TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_LABEL,
} from "./config";
import { calculateATR, calculateEMA, calculateSlope, clockWindowAt, detectFVG, zonedDateParts } from "./indicators";
import type { V2GoldmineInput } from "./types";

type Direction = "BUY" | "SELL";
type ModeKey = keyof typeof CONFIG.minRRByMode;
type ModelUsed = "TREND_CONTINUATION" | "CHOCH_REVERSAL";
type StructureType = "HH_HL" | "LH_LL" | "RANGE" | "TRANSITION";
type BreakType = "CLOSE_BOS" | "WICK_CHOCH";
type ZoneType = NonNullable<TjrSimpleStructurePullbackSnapshot["selectedZoneType"]>;
type Stage = TjrSimpleStructurePullbackSnapshot["stage"];
type Bias = "BULLISH" | "BEARISH" | "NEUTRAL" | "RANGING" | "UNKNOWN";
type ItfBias = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "NONE" | "UNKNOWN";

type Thresholds = {
  retestWindow: number;
  confirmationBodyRatio: number;
  minRR: number;
  minSignalScore: number;
  slAtrBuffer: number;
  maxSlAtr: number;
  strictCloseBreak: boolean;
};

type BiasContext = {
  htf: { bias: Bias; strength: number };
  itf: { bias: ItfBias; strength: number };
};

type MarketStructure = {
  found: boolean;
  type: StructureType | null;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  strength: number;
  choppy: boolean;
  flips: number;
};

type StructureBreak = {
  modelUsed: ModelUsed;
  type: BreakType;
  brokenLevel: number;
  confirmedAtIndex: number;
  timestamp: number;
  quality: number;
};

type PullbackZone = {
  type: ZoneType;
  low: number;
  high: number;
  midpoint: number;
  createdAtIndex: number;
  createdAt: number;
  quality: number;
  touchesBeforeRetest: number;
};

type Retest = {
  candleIndex: number;
  timestamp: number;
  retestPrice: number;
  depthPercent: number;
  touchCount: number;
};

type Confirmation = {
  candleIndex: number;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bodyRatio: number;
  closePosition: number;
  rejectionWickRatio: number;
};

type RiskLevels =
  | {
      valid: true;
      entry: number;
      stopLoss: number;
      takeProfit: number;
      risk: number;
      reward: number;
      rr: number;
      maxSlAtr: number;
      targetSource: string;
      fixedTarget: boolean;
    }
  | { valid: false; code: SignalRejectionCode; maxSlAtr?: number };

type Evaluation =
  | { status: "CONFIRMED"; signal: TradeSignal; debug: SignalCandidateDebug; snapshot: TjrSimpleStructurePullbackSnapshot; confirmationIndex: number }
  | { status: "PENDING"; debug: SignalCandidateDebug; snapshot: TjrSimpleStructurePullbackSnapshot }
  | {
      status: "REJECTED";
      setupId: string;
      direction: Direction;
      code: SignalRejectionCode;
      triggerIndex: number | null;
      stage: Stage;
      state: RejectedSetup["setupState"];
      score: number | null;
      rr: number | null;
      debug: SignalCandidateDebug;
      snapshot: TjrSimpleStructurePullbackSnapshot;
    };

const resultCache = new Map<string, EntryEngineResult>();

export function clearTjrSimpleStructurePullbackCache(): void {
  resultCache.clear();
}

export function generateTjrSimpleStructurePullbackSignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const candles = input.candles.filter((candle) => candle.isClosed);
  const mode = resolveMode(input);
  const thresholds = thresholdsForMode(mode);
  const key = [
    TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID,
    mode,
    input.symbol,
    input.timeframe,
    candles.length,
    candles.at(-1)?.timestamp ?? 0,
    input.settings?.maxRiskAmount ?? 100,
    cacheFingerprintForCandles(candles),
    cacheFingerprintForContext(input.context),
  ].join(":");
  const cached = resultCache.get(key);
  if (cached) return cloneResult(cached, "hit");

  const atr = calculateATR(candles, CONFIG.atrPeriod);
  const ema20 = calculateEMA(candles, CONFIG.emaFastPeriod);
  const ema50 = calculateEMA(candles, CONFIG.emaMidPeriod);
  const ema200 = calculateEMA(candles, CONFIG.emaSlowPeriod);
  const ema50Slope = calculateSlope(ema50, 5);
  const biasContext = resolveBiasContext(input.context, candles);
  const marketRegime = resolveMarketRegime(input.context, candles, atr);

  const signals: TradeSignal[] = [];
  const pendingCandidates: SignalCandidateDebug[] = [];
  const candidateDebug: SignalCandidateDebug[] = [];
  const rejectedSetups: RejectedSetup[] = [];
  const rejectionCounts = new Map<string, number>();
  const sessionSignalCounts = new Map<string, number>();
  const daySignalCounts = new Map<string, number>();
  const seenSignals = new Set<string>();

  let continuationModelsFound = 0;
  let reversalModelsFound = 0;
  let marketStructuresFound = 0;
  let bosFound = 0;
  let chochFound = 0;
  let pullbackZonesFound = 0;
  let retestsFound = 0;
  let confirmationCandlesFound = 0;
  let expiredSetups = 0;

  if (candles.length < CONFIG.atrPeriod + CONFIG.structureLookback + 6) {
    increment(rejectionCounts, "INSUFFICIENT_CANDLES");
    const debug = makeDebug("tjr:none", "BUY", "REJECTED", "INSUFFICIENT_CANDLES", "MARKET_STRUCTURE", 0, thresholds);
    candidateDebug.push(debug);
    rejectedSetups.push(toRejected(debug.setupId, "BUY", null, "INSUFFICIENT_CANDLES", debug, "INVALIDATED", "TREND_CONTINUATION"));
  } else {
    const firstIndex = Math.max(CONFIG.atrPeriod + CONFIG.structureLookback, CONFIG.emaMidPeriod + 5);
    for (let index = firstIndex; index < candles.length; index++) {
      const currentAtr = atr[index];
      if (!currentAtr || currentAtr <= 0) continue;
      let confirmedAtThisIndex = false;
      for (const direction of ["BUY", "SELL"] as const) {
        const structure = detectMarketStructure(candles, index, ema20, ema50, atr);
        if (structure.found) marketStructuresFound++;
        const structureBreak = detectBOSOrCHOCH(candles, index, direction, structure, thresholds);
        if (!structureBreak) continue;
        if (structureBreak.modelUsed === "TREND_CONTINUATION") {
          continuationModelsFound++;
          bosFound++;
        } else {
          reversalModelsFound++;
          chochFound++;
        }
        const evaluation = evaluateSetup({
          input,
          candles,
          atr,
          ema20,
          ema50,
          ema200,
          ema50Slope,
          mode,
          thresholds,
          biasContext,
          marketRegime,
          direction,
          structure,
          structureBreak,
        });
        collectEvidence(evaluation.snapshot);
        if (handleEvaluation(evaluation)) {
          index = Math.max(index, evaluation.confirmationIndex);
          confirmedAtThisIndex = true;
          break;
        }
      }
      if (confirmedAtThisIndex) continue;
    }
  }

  if (signals.length === 0 && rejectedSetups.length === 0 && pendingCandidates.length === 0) {
    increment(rejectionCounts, "NO_BOS_OR_CHOCH");
    const debug = makeDebug("tjr:none", "BUY", "REJECTED", "NO_BOS_OR_CHOCH", "BOS_CHOCH_CONFIRMED", 0, thresholds);
    candidateDebug.push(debug);
    rejectedSetups.push(toRejected(debug.setupId, "BUY", candles.length ? candles.length - 1 : null, "NO_BOS_OR_CHOCH", debug, "INVALIDATED", "TREND_CONTINUATION"));
  }

  function handleEvaluation(evaluation: Evaluation): evaluation is Extract<Evaluation, { status: "CONFIRMED" }> {
    candidateDebug.push(evaluation.debug);
    if (evaluation.status === "PENDING") {
      pendingCandidates.push(evaluation.debug);
      return false;
    }
    if (evaluation.status === "REJECTED") {
      increment(rejectionCounts, evaluation.code);
      if (evaluation.state === "EXPIRED") expiredSetups++;
      rejectedSetups.push(toRejected(evaluation.setupId, evaluation.direction, evaluation.triggerIndex, evaluation.code, evaluation.debug, evaluation.state, evaluation.snapshot.modelUsed));
      return false;
    }
    const signal = evaluation.signal;
    const sessionKey = `${dateKey(signal.timestamp)}:${signal.session}`;
    if ((sessionSignalCounts.get(sessionKey) ?? 0) >= CONFIG.maxSignalsPerSession) {
      increment(rejectionCounts, "MAX_SESSION_SIGNALS_REACHED");
      return false;
    }
    const day = dateKey(signal.timestamp);
    if ((daySignalCounts.get(day) ?? 0) >= CONFIG.maxSignalsPerDay) {
      increment(rejectionCounts, "MAX_DAILY_SIGNALS_REACHED");
      return false;
    }
    if (!seenSignals.has(signal.id)) {
      signals.push(signal);
      seenSignals.add(signal.id);
      sessionSignalCounts.set(sessionKey, (sessionSignalCounts.get(sessionKey) ?? 0) + 1);
      daySignalCounts.set(day, (daySignalCounts.get(day) ?? 0) + 1);
    }
    return true;
  }

  function collectEvidence(snapshot: TjrSimpleStructurePullbackSnapshot): void {
    if (snapshot.pullbackZoneFound) pullbackZonesFound++;
    if (snapshot.retestFound) retestsFound++;
    if (snapshot.confirmationFound) confirmationCandlesFound++;
  }

  const generationTimeMs = round(performance.now() - started, 2);
  const topRejectionReasons = rejectionRows(rejectionCounts);
  const audit = makeAudit({
    mode,
    minScore: thresholds.minSignalScore,
    minRR: thresholds.minRR,
    candles: candles.length,
    timeframe: input.timeframe,
    signals,
    rejectedSetups,
    pendingCandidates,
    candidateDebug,
    generationTimeMs,
    topRejectionReasons,
    biasContext,
    marketRegime,
    continuationModelsFound,
    reversalModelsFound,
    marketStructuresFound,
    bosFound,
    chochFound,
    pullbackZonesFound,
    retestsFound,
    confirmationCandlesFound,
    expiredSetups,
  });

  const result: EntryEngineResult = {
    signals: signals.sort((a, b) => a.confirmedAtIndex - b.confirmedAtIndex),
    activeSignals: signals,
    signalMap: new Map(signals.map((signal) => [signal.id, signal])),
    pendingCandidates,
    candidateDebug,
    rejectedSetups,
    noTrade: signals.length ? null : {
      status: "NO_TRADE",
      checkedSetups: continuationModelsFound + reversalModelsFound,
      rejectionReasons: topRejectionReasons.map((row) => row.reason),
      message: pendingCandidates.length ? "TJR structure pullback setup is waiting for retest or confirmation." : "No confirmed TJR structure pullback signal found.",
      nearestPossibleSetup: pendingCandidates.at(-1)?.setupId ?? rejectedSetups.at(-1)?.setupId ?? null,
      requiredForSignal: ["Clear market structure", "Closed BOS/CHOCH", "Simple pullback zone", "Zone retest", "Closed confirmation candle", `${thresholds.minRR.toFixed(1)}R minimum`],
      timestamp: candles.at(-1)?.timestamp ?? null,
    },
    audit,
  };

  if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value ?? "");
  resultCache.set(key, result);
  return result;
}

function evaluateSetup(args: {
  input: V2GoldmineInput;
  candles: Candle[];
  atr: Array<number | null>;
  ema20: Array<number | null>;
  ema50: Array<number | null>;
  ema200: Array<number | null>;
  ema50Slope: Array<number | null>;
  mode: ModeKey;
  thresholds: Thresholds;
  biasContext: BiasContext;
  marketRegime: string;
  direction: Direction;
  structure: MarketStructure;
  structureBreak: StructureBreak;
}): Evaluation {
  const setupAtr = args.atr[args.structureBreak.confirmedAtIndex] ?? 0;
  const setupId = `tjr:${args.structureBreak.modelUsed}:${args.direction}:${args.structureBreak.confirmedAtIndex}:${round(args.structureBreak.brokenLevel, 3)}`;
  const snapshot = makeBaseSnapshot({
    candles: args.candles,
    timeframe: args.input.timeframe,
    direction: args.direction,
    mode: args.mode,
    thresholds: args.thresholds,
    biasContext: args.biasContext,
    marketRegime: args.marketRegime,
    modelUsed: args.structureBreak.modelUsed,
    atr: setupAtr,
    signalTime: args.candles[args.structureBreak.confirmedAtIndex]?.timestamp ?? 0,
  });
  snapshot.marketStructureFound = args.structure.found;
  snapshot.structureType = args.structure.type;
  snapshot.bosFound = args.structureBreak.modelUsed === "TREND_CONTINUATION";
  snapshot.chochFound = args.structureBreak.modelUsed === "CHOCH_REVERSAL";
  snapshot.bosType = args.structureBreak.type;
  snapshot.brokenLevel = args.structureBreak.brokenLevel;
  snapshot.structureIndex = args.structureBreak.confirmedAtIndex;
  snapshot.structureTime = args.structureBreak.timestamp;

  const contextGate = validateContext(args.direction, args.structureBreak.modelUsed, args.biasContext, args.marketRegime, args.mode, args.structure);
  if (!contextGate.valid) return rejected(setupId, args.direction, contextGate.code, args.structureBreak.confirmedAtIndex, "MARKET_STRUCTURE", snapshot, args.thresholds);
  if (!args.structure.found) return rejected(setupId, args.direction, "NO_MARKET_STRUCTURE", args.structureBreak.confirmedAtIndex, "MARKET_STRUCTURE", snapshot, args.thresholds);
  if (args.thresholds.strictCloseBreak && args.structureBreak.type !== "CLOSE_BOS") {
    return rejected(setupId, args.direction, "ONLY_WEAK_WICK_CHOCH", args.structureBreak.confirmedAtIndex, "BOS_CHOCH_CONFIRMED", snapshot, args.thresholds);
  }
  if ((args.mode === "strict" || args.mode === "professional") && (args.structure.choppy || args.marketRegime === "CHOPPY")) {
    return rejected(setupId, args.direction, "TOO_MUCH_CHOP", args.structureBreak.confirmedAtIndex, "MARKET_STRUCTURE", snapshot, args.thresholds);
  }
  if (setupAtr < CONFIG.lowVolatilityAtr) return rejected(setupId, args.direction, "LOW_VOLATILITY", args.structureBreak.confirmedAtIndex, "MARKET_STRUCTURE", snapshot, args.thresholds);

  const zone = selectBestSimplePullbackZone({
    candles: args.candles,
    structureBreak: args.structureBreak,
    direction: args.direction,
    atr: setupAtr,
    ema20: args.ema20,
    ema50: args.ema50,
    ema50Slope: args.ema50Slope,
  });
  if (!zone) return rejected(setupId, args.direction, "NO_PULLBACK_ZONE", args.structureBreak.confirmedAtIndex, "PULLBACK_ZONE_SELECTED", snapshot, args.thresholds);
  if (zone.quality < 10) return rejected(setupId, args.direction, "ZONE_TOO_WEAK", zone.createdAtIndex, "PULLBACK_ZONE_SELECTED", snapshot, args.thresholds);
  snapshot.pullbackZoneFound = true;
  snapshot.selectedZoneType = zone.type;
  snapshot.selectedZoneLow = zone.low;
  snapshot.selectedZoneHigh = zone.high;
  snapshot.selectedZoneMidpoint = zone.midpoint;
  snapshot.zoneQuality = zone.quality;
  snapshot.zoneCreatedAt = zone.createdAt;
  snapshot.zoneCreatedAtIndex = zone.createdAtIndex;

  const retestResult = detectZoneRetest(args.candles, zone, args.direction, args.atr, args.thresholds);
  if (retestResult.status === "PENDING") return pending(setupId, args.direction, retestResult.code, retestResult.stage, retestResult.remaining, snapshot, args.thresholds);
  if (retestResult.status === "REJECTED") return rejected(setupId, args.direction, retestResult.code, retestResult.triggerIndex, retestResult.stage, snapshot, args.thresholds, retestResult.state);
  const retest = retestResult.retest;
  snapshot.retestFound = true;
  snapshot.retestIndex = retest.candleIndex;
  snapshot.retestAt = retest.timestamp;
  snapshot.retestDepthPercent = retest.depthPercent;

  const confirmationResult = detectSimpleConfirmationCandle(args.candles, zone, retest, args.direction, args.atr, args.thresholds);
  if (confirmationResult.status === "PENDING") return pending(setupId, args.direction, confirmationResult.code, confirmationResult.stage, confirmationResult.remaining, snapshot, args.thresholds);
  if (confirmationResult.status === "REJECTED") return rejected(setupId, args.direction, confirmationResult.code, confirmationResult.triggerIndex, confirmationResult.stage, snapshot, args.thresholds, confirmationResult.state);
  const confirmation = confirmationResult.confirmation;
  snapshot.confirmationFound = true;
  snapshot.confirmationIndex = confirmation.candleIndex;
  snapshot.confirmationAt = confirmation.timestamp;
  snapshot.confirmationBodyRatio = confirmation.bodyRatio;
  snapshot.confirmationClosePosition = confirmation.closePosition;
  snapshot.confirmationRejectionWickRatio = confirmation.rejectionWickRatio;

  const risk = validateSimpleRisk({
    candles: args.candles,
    direction: args.direction,
    structureBreak: args.structureBreak,
    zone,
    retest,
    confirmation,
    atr: args.atr[confirmation.candleIndex] ?? setupAtr,
    thresholds: args.thresholds,
    mode: args.mode,
  });
  if (!risk.valid) {
    snapshot.rejectionReasons = [risk.code];
    return rejected(setupId, args.direction, risk.code, confirmation.candleIndex, "CONFIRMED_SIGNAL", snapshot, args.thresholds, "INVALIDATED", null, null);
  }

  const sessionName = sessionNameAt(confirmation.timestamp);
  const score = calculateTJRSimpleScore({
    direction: args.direction,
    mode: args.mode,
    biasContext: args.biasContext,
    structure: args.structure,
    structureBreak: args.structureBreak,
    zone,
    retest,
    confirmation,
    rr: risk.rr,
    maxSlAtr: risk.maxSlAtr,
    sessionName,
    marketRegime: args.marketRegime,
    emaAligned: emaTrendAligned(args.ema20, args.ema50, args.ema200, confirmation.candleIndex, args.direction),
    contextWarnings: contextGate.warnings,
  });
  snapshot.entry = round(risk.entry);
  snapshot.stopLoss = round(risk.stopLoss);
  snapshot.takeProfit = round(risk.takeProfit);
  snapshot.rr = round(risk.rr, 3);
  snapshot.score = score.total;
  snapshot.confidence = confidenceFor(score.total);
  snapshot.bonuses = score.bonuses;
  snapshot.penalties = score.penalties;
  snapshot.warnings = score.warnings;

  if (score.total < args.thresholds.minSignalScore) {
    return rejected(setupId, args.direction, "SIGNAL_SCORE_TOO_LOW", confirmation.candleIndex, "CONFIRMED_SIGNAL", snapshot, args.thresholds, "INVALIDATED", score.total, risk.rr);
  }

  const signal = buildSignal({
    input: args.input,
    candles: args.candles,
    mode: args.mode,
    thresholds: args.thresholds,
    direction: args.direction,
    setupId,
    structure: args.structure,
    structureBreak: args.structureBreak,
    zone,
    retest,
    confirmation,
    risk,
    score,
    sessionName,
    snapshot,
  });
  snapshot.noRepaintProof = signal.noRepaintProof.message;
  const debug = makeDebug(setupId, args.direction, "CONFIRMED", "CONFIRMED_SIGNAL", "CONFIRMED_SIGNAL", 0, args.thresholds, score.total, risk.rr);
  return { status: "CONFIRMED", signal, debug, snapshot, confirmationIndex: confirmation.candleIndex };
}

function detectMarketStructure(
  candles: Candle[],
  index: number,
  ema20: Array<number | null>,
  ema50: Array<number | null>,
  atr: Array<number | null>,
): MarketStructure {
  const start = Math.max(0, index - CONFIG.structureLookback);
  const source = candles.slice(start, index);
  if (source.length < CONFIG.structureLookback / 2) return { found: false, type: null, direction: "NEUTRAL", strength: 0, choppy: false, flips: 0 };
  const midpoint = Math.floor(source.length / 2);
  const first = source.slice(0, midpoint);
  const second = source.slice(midpoint);
  const firstHigh = Math.max(...first.map((candle) => candle.high));
  const firstLow = Math.min(...first.map((candle) => candle.low));
  const secondHigh = Math.max(...second.map((candle) => candle.high));
  const secondLow = Math.min(...second.map((candle) => candle.low));
  const net = source.at(-1)!.close - source[0].close;
  const currentAtr = atr[index] ?? 1;
  const flips = countDirectionalFlips(candles, index, 18);
  const emaBull = (ema20[index] ?? 0) > (ema50[index] ?? Number.POSITIVE_INFINITY);
  const emaBear = (ema20[index] ?? 0) < (ema50[index] ?? Number.NEGATIVE_INFINITY);
  const bullish = (secondHigh >= firstHigh && secondLow >= firstLow && net > currentAtr * 0.3) || (emaBull && net > 0);
  const bearish = (secondHigh <= firstHigh && secondLow <= firstLow && net < -currentAtr * 0.3) || (emaBear && net < 0);
  const choppy = flips >= CONFIG.choppyFlipThreshold || Math.abs(net) < currentAtr * 0.4;
  if (bullish) return { found: true, type: "HH_HL", direction: "BULLISH", strength: clamp(Math.round(Math.abs(net / currentAtr) * 18 + 45), 0, 100), choppy, flips };
  if (bearish) return { found: true, type: "LH_LL", direction: "BEARISH", strength: clamp(Math.round(Math.abs(net / currentAtr) * 18 + 45), 0, 100), choppy, flips };
  return { found: !choppy, type: choppy ? "RANGE" : "TRANSITION", direction: "NEUTRAL", strength: 35, choppy, flips };
}

function detectBOSOrCHOCH(candles: Candle[], index: number, direction: Direction, structure: MarketStructure, thresholds: Thresholds): StructureBreak | null {
  const start = Math.max(0, index - CONFIG.structureLookback);
  const prior = candles.slice(start, index);
  if (prior.length < CONFIG.swingLookback) return null;
  const level = direction === "BUY" ? Math.max(...prior.map((candle) => candle.high)) : Math.min(...prior.map((candle) => candle.low));
  const candle = candles[index];
  const range = candle.high - candle.low;
  if (range <= 0) return null;
  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  const directionalClose = direction === "BUY" ? candle.close > candle.open : candle.close < candle.open;
  if (!directionalClose || bodyRatio < 0.35) return null;
  const closedBreak = direction === "BUY" ? candle.close > level : candle.close < level;
  const wickBreak = direction === "BUY" ? candle.high > level : candle.low < level;
  if (!closedBreak && !(wickBreak && !thresholds.strictCloseBreak)) return null;
  const desired = direction === "BUY" ? "BULLISH" : "BEARISH";
  const modelUsed: ModelUsed = structure.direction === desired ? "TREND_CONTINUATION" : "CHOCH_REVERSAL";
  if (modelUsed === "CHOCH_REVERSAL" && !hasReversalEvidence(candles, index, direction, level)) return null;
  return {
    modelUsed,
    type: closedBreak ? "CLOSE_BOS" : "WICK_CHOCH",
    brokenLevel: level,
    confirmedAtIndex: index,
    timestamp: candle.timestamp,
    quality: closedBreak ? 15 : 9,
  };
}

function hasReversalEvidence(candles: Candle[], index: number, direction: Direction, breakLevel: number): boolean {
  const recent = candles.slice(Math.max(0, index - 8), index + 1);
  const candle = candles[index];
  const body = Math.abs(candle.close - candle.open);
  const range = Math.max(candle.high - candle.low, Number.EPSILON);
  const strongClose = body / range >= 0.45;
  if (direction === "BUY") {
    const failedLow = recent.at(-2) ? recent.at(-2)!.low <= Math.min(...recent.slice(0, -1).map((item) => item.low)) && candle.close > breakLevel : false;
    return failedLow || strongClose;
  }
  const failedHigh = recent.at(-2) ? recent.at(-2)!.high >= Math.max(...recent.slice(0, -1).map((item) => item.high)) && candle.close < breakLevel : false;
  return failedHigh || strongClose;
}

function selectBestSimplePullbackZone(input: {
  candles: Candle[];
  structureBreak: StructureBreak;
  direction: Direction;
  atr: number;
  ema20: Array<number | null>;
  ema50: Array<number | null>;
  ema50Slope: Array<number | null>;
}): PullbackZone | null {
  const zones: PullbackZone[] = [];
  const start = Math.max(2, input.structureBreak.confirmedAtIndex - 2);
  const end = Math.min(input.candles.length - 1, input.structureBreak.confirmedAtIndex + 3);
  for (let index = start; index <= end; index++) {
    const fvg = detectFVG(input.candles, index);
    if (!fvg) continue;
    if (input.direction === "BUY" && fvg.type !== "BULLISH_FVG") continue;
    if (input.direction === "SELL" && fvg.type !== "BEARISH_FVG") continue;
    const sizeAtr = fvg.size / input.atr;
    if (sizeAtr < CONFIG.fvgMinSizeAtr || sizeAtr > CONFIG.fvgMaxSizeAtr) continue;
    zones.push(makeZone("FVG", fvg.bottom, fvg.top, index, input.candles[index].timestamp, 16 + Math.min(4, sizeAtr * 5)));
  }
  const ob = findOrderBlock(input.candles, input.structureBreak.confirmedAtIndex, input.direction, input.atr);
  if (ob) zones.push(ob);
  const overlap = overlapZone(zones.find((zone) => zone.type === "FVG"), zones.find((zone) => zone.type === "OB"));
  if (overlap) zones.push(overlap);
  const srBuffer = input.atr * 0.12;
  zones.push(makeZone("SR_FLIP", input.structureBreak.brokenLevel - srBuffer, input.structureBreak.brokenLevel + srBuffer, input.structureBreak.confirmedAtIndex, input.structureBreak.timestamp, 16));
  const ema20 = input.ema20[input.structureBreak.confirmedAtIndex];
  const ema50 = input.ema50[input.structureBreak.confirmedAtIndex];
  const slope = input.ema50Slope[input.structureBreak.confirmedAtIndex] ?? 0;
  if (ema20 && ema50) {
    const aligned = input.direction === "BUY" ? ema20 > ema50 && slope >= -input.atr * 0.02 : ema20 < ema50 && slope <= input.atr * 0.02;
    if (aligned) zones.push(makeZone("EMA_ZONE", Math.min(ema20, ema50) - input.atr * 0.08, Math.max(ema20, ema50) + input.atr * 0.08, input.structureBreak.confirmedAtIndex, input.structureBreak.timestamp, 15));
  }
  const breakCandle = input.candles[input.structureBreak.confirmedAtIndex];
  const retracementMid = (breakCandle.high + breakCandle.low) / 2;
  zones.push(makeZone("DISPLACEMENT_50", retracementMid - input.atr * 0.10, retracementMid + input.atr * 0.10, input.structureBreak.confirmedAtIndex, input.structureBreak.timestamp, 12));
  const current = input.candles[input.structureBreak.confirmedAtIndex].close;
  const directional = zones
    .map((zone) => ({ ...zone, touchesBeforeRetest: countTouches(input.candles, zone, Math.max(0, zone.createdAtIndex - 20), zone.createdAtIndex, input.atr) }))
    .filter((zone) => Math.abs(current - zone.midpoint) / input.atr <= CONFIG.maxZoneDistanceAtr)
    .filter((zone) => zone.touchesBeforeRetest <= CONFIG.maxTouches)
    .sort((left, right) => zoneRank(right.type) - zoneRank(left.type) || right.quality - left.quality);
  return directional[0] ?? null;
}

function findOrderBlock(candles: Candle[], breakIndex: number, direction: Direction, atr: number): PullbackZone | null {
  const start = Math.max(0, breakIndex - CONFIG.zoneLookback);
  for (let index = breakIndex - 1; index >= start; index--) {
    const candle = candles[index];
    const opposite = direction === "BUY" ? candle.close < candle.open : candle.close > candle.open;
    if (!opposite) continue;
    const low = direction === "BUY" ? candle.low : Math.min(candle.open, candle.close);
    const high = direction === "BUY" ? Math.max(candle.open, candle.close) : candle.high;
    const sizeAtr = (high - low) / atr;
    if (sizeAtr < CONFIG.orderBlockMinSizeAtr || sizeAtr > CONFIG.orderBlockMaxSizeAtr) continue;
    return makeZone("OB", low, high, index, candle.timestamp, 15 + Math.min(4, sizeAtr * 3));
  }
  return null;
}

function overlapZone(fvg: PullbackZone | undefined, ob: PullbackZone | undefined): PullbackZone | null {
  if (!fvg || !ob) return null;
  const low = Math.max(fvg.low, ob.low);
  const high = Math.min(fvg.high, ob.high);
  if (high <= low) return null;
  return makeZone("FVG_OB_OVERLAP", low, high, Math.max(fvg.createdAtIndex, ob.createdAtIndex), Math.max(fvg.createdAt, ob.createdAt), 20);
}

function detectZoneRetest(
  candles: Candle[],
  zone: PullbackZone,
  direction: Direction,
  atr: Array<number | null>,
  thresholds: Thresholds,
): { status: "CONFIRMED"; retest: Retest } | { status: "PENDING"; code: SignalRejectionCode; stage: Stage; remaining: number } | { status: "REJECTED"; code: SignalRejectionCode; stage: Stage; triggerIndex: number; state: RejectedSetup["setupState"] } {
  const maxRetestIndex = zone.createdAtIndex + thresholds.retestWindow;
  const availableRetestIndex = Math.min(candles.length - 1, maxRetestIndex);
  let touches = 0;
  for (let index = zone.createdAtIndex + 1; index <= availableRetestIndex; index++) {
    const currentAtr = atr[index] ?? atr[zone.createdAtIndex];
    if (!currentAtr) continue;
    const candle = candles[index];
    if (zoneInvalidated(candle, zone, direction, currentAtr)) return { status: "REJECTED", code: "ZONE_INVALIDATED", stage: "PULLBACK_ZONE_SELECTED", triggerIndex: index, state: "INVALIDATED" };
    if (!touchesZone(candle, zone, currentAtr)) continue;
    touches++;
    if (touches > CONFIG.maxTouches) return { status: "REJECTED", code: "TOO_MANY_ZONE_TOUCHES", stage: "ZONE_RETESTED", triggerIndex: index, state: "INVALIDATED" };
    return { status: "CONFIRMED", retest: makeRetest(candle, zone, direction, index, touches) };
  }
  if (candles.length - 1 < maxRetestIndex) return { status: "PENDING", code: "NO_ZONE_RETEST", stage: "PULLBACK_ZONE_SELECTED", remaining: maxRetestIndex - (candles.length - 1) };
  return { status: "REJECTED", code: "RETEST_TOO_LATE", stage: "EXPIRED", triggerIndex: availableRetestIndex, state: "EXPIRED" };
}

function detectSimpleConfirmationCandle(
  candles: Candle[],
  zone: PullbackZone,
  retest: Retest,
  direction: Direction,
  atr: Array<number | null>,
  thresholds: Thresholds,
): { status: "CONFIRMED"; confirmation: Confirmation } | { status: "PENDING"; code: SignalRejectionCode; stage: Stage; remaining: number } | { status: "REJECTED"; code: SignalRejectionCode; stage: Stage; triggerIndex: number; state: RejectedSetup["setupState"] } {
  const maxConfirmationIndex = retest.candleIndex + 4;
  const availableConfirmationIndex = Math.min(candles.length - 1, maxConfirmationIndex);
  for (let index = retest.candleIndex; index <= availableConfirmationIndex; index++) {
    const currentAtr = atr[index] ?? atr[zone.createdAtIndex];
    if (!currentAtr) continue;
    const candle = candles[index];
    if (index > retest.candleIndex && zoneInvalidated(candle, zone, direction, currentAtr)) return { status: "REJECTED", code: "ZONE_INVALIDATED", stage: "WAITING_CONFIRMATION", triggerIndex: index, state: "INVALIDATED" };
    const confirmation = buildConfirmation(candles, index, zone, direction, currentAtr, thresholds);
    if (confirmation) return { status: "CONFIRMED", confirmation };
  }
  if (candles.length - 1 < maxConfirmationIndex) return { status: "PENDING", code: "NO_CONFIRMATION_CANDLE", stage: "WAITING_CONFIRMATION", remaining: maxConfirmationIndex - (candles.length - 1) };
  return { status: "REJECTED", code: "CONFIRMATION_TOO_WEAK", stage: "WAITING_CONFIRMATION", triggerIndex: availableConfirmationIndex, state: "INVALIDATED" };
}

function buildConfirmation(candles: Candle[], index: number, zone: PullbackZone, direction: Direction, atr: number, thresholds: Thresholds): Confirmation | null {
  const candle = candles[index];
  const previous = candles[index - 1];
  const range = candle.high - candle.low;
  if (range <= 0 || range < atr * CONFIG.minConfirmationRangeAtr) return null;
  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  if (bodyRatio < thresholds.confirmationBodyRatio) return null;
  const closePosition = (candle.close - candle.low) / range;
  if (direction === "BUY") {
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const beyondMidpoint = candle.close > zone.midpoint || (previous ? candle.close > previous.high : false);
    if (!(candle.close > candle.open) || closePosition < 0.60 || candle.close < zone.low || !beyondMidpoint) return null;
    return { candleIndex: index, timestamp: candle.timestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close, bodyRatio, closePosition, rejectionWickRatio: lowerWick / range };
  }
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const beyondMidpoint = candle.close < zone.midpoint || (previous ? candle.close < previous.low : false);
  if (!(candle.close < candle.open) || closePosition > 0.40 || candle.close > zone.high || !beyondMidpoint) return null;
  return { candleIndex: index, timestamp: candle.timestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close, bodyRatio, closePosition, rejectionWickRatio: upperWick / range };
}

function validateSimpleRisk(input: {
  candles: Candle[];
  direction: Direction;
  structureBreak: StructureBreak;
  zone: PullbackZone;
  retest: Retest;
  confirmation: Confirmation;
  atr: number;
  thresholds: Thresholds;
  mode: ModeKey;
}): RiskLevels {
  const retestSlice = input.candles.slice(input.retest.candleIndex, input.confirmation.candleIndex + 1);
  const lookbackSlice = input.candles.slice(input.structureBreak.confirmedAtIndex, input.confirmation.candleIndex + 1);
  const entry = input.confirmation.close;
  const recentExtreme = input.direction === "BUY" ? Math.min(...lookbackSlice.map((candle) => candle.low)) : Math.max(...lookbackSlice.map((candle) => candle.high));
  const retestExtreme = input.direction === "BUY" ? Math.min(...retestSlice.map((candle) => candle.low)) : Math.max(...retestSlice.map((candle) => candle.high));
  const structural = input.direction === "BUY" ? Math.min(input.zone.low, retestExtreme, recentExtreme) : Math.max(input.zone.high, retestExtreme, recentExtreme);
  const buffer = input.atr * input.thresholds.slAtrBuffer;
  const stopLoss = input.direction === "BUY" ? structural - buffer : structural + buffer;
  const risk = input.direction === "BUY" ? entry - stopLoss : stopLoss - entry;
  if (!Number.isFinite(risk) || risk <= 0) return { valid: false, code: "INVALID_STOP_LOSS", maxSlAtr: 0 };
  const maxSlAtr = risk / input.atr;
  if (maxSlAtr > input.thresholds.maxSlAtr) return { valid: false, code: "STOP_TOO_WIDE", maxSlAtr };
  const target = findNearestLiquidityTarget(input.candles, input.direction, entry, risk, input.confirmation.candleIndex, input.thresholds.minRR, input.mode);
  const reward = input.direction === "BUY" ? target.price - entry : entry - target.price;
  const rr = reward / risk;
  if (!Number.isFinite(rr) || rr + 1e-9 < input.thresholds.minRR) return { valid: false, code: "RR_TOO_LOW", maxSlAtr };
  return { valid: true, entry, stopLoss, takeProfit: target.price, risk, reward, rr, maxSlAtr, targetSource: target.source, fixedTarget: target.fixed };
}

function findNearestLiquidityTarget(candles: Candle[], direction: Direction, entry: number, risk: number, confirmationIndex: number, minRR: number, mode: ModeKey): { price: number; source: string; fixed: boolean } {
  const candidates: Array<{ price: number; source: string }> = [];
  for (let index = Math.max(CONFIG.swingLookback, confirmationIndex - 80); index < confirmationIndex; index++) {
    if (direction === "BUY" && isCausalSwing(candles, index, CONFIG.swingLookback, "HIGH") && candles[index].high > entry) candidates.push({ price: candles[index].high, source: "PREVIOUS_SWING_HIGH_OR_BSL" });
    if (direction === "SELL" && isCausalSwing(candles, index, CONFIG.swingLookback, "LOW") && candles[index].low < entry) candidates.push({ price: candles[index].low, source: "PREVIOUS_SWING_LOW_OR_SSL" });
  }
  const valid = candidates
    .map((candidate) => ({ ...candidate, rr: (direction === "BUY" ? candidate.price - entry : entry - candidate.price) / risk }))
    .filter((candidate) => candidate.rr >= minRR)
    .sort((left, right) => direction === "BUY" ? left.price - right.price : right.price - left.price);
  if (valid.length) return { price: valid[0].price, source: valid[0].source, fixed: false };
  if (candidates.length) {
    const nearest = candidates.sort((left, right) => direction === "BUY" ? left.price - right.price : right.price - left.price)[0];
    return { price: nearest.price, source: nearest.source, fixed: false };
  }
  const multiple = mode === "strict" || mode === "professional" ? CONFIG.strictPreferredRR : CONFIG.preferredRR;
  return { price: direction === "BUY" ? entry + risk * Math.max(minRR, multiple) : entry - risk * Math.max(minRR, multiple), source: "FIXED_RR_FALLBACK", fixed: true };
}

function calculateTJRSimpleScore(input: {
  direction: Direction;
  mode: ModeKey;
  biasContext: BiasContext;
  structure: MarketStructure;
  structureBreak: StructureBreak;
  zone: PullbackZone;
  retest: Retest;
  confirmation: Confirmation;
  rr: number;
  maxSlAtr: number;
  sessionName: string;
  marketRegime: string;
  emaAligned: boolean;
  contextWarnings: string[];
}): { total: number; breakdown: SignalScoreBreakdown; bonuses: string[]; penalties: string[]; warnings: string[] } {
  const bonuses: string[] = [];
  const penalties: string[] = [];
  const warnings = [...input.contextWarnings];
  const biasAligned = biasSupportsDirection(input.direction, input.biasContext);
  const htfNeutral = input.biasContext.htf.bias === "NEUTRAL" || input.biasContext.htf.bias === "RANGING";
  const context = biasAligned ? 10 : htfNeutral ? 7 : 5;
  const structureClarity = input.structure.type === "HH_HL" || input.structure.type === "LH_LL" ? 15 : input.structure.type === "TRANSITION" ? 10 : 6;
  const breakQuality = input.structureBreak.type === "CLOSE_BOS" ? 15 : 9;
  const zoneQuality = clamp(input.zone.quality, 0, 20);
  const retestQuality = clamp(15 - Math.max(0, input.retest.candleIndex - input.zone.createdAtIndex - 5), 7, 15);
  const directionalClose = input.direction === "BUY" ? input.confirmation.closePosition : 1 - input.confirmation.closePosition;
  const confirmationQuality = clamp(Math.round(6 + input.confirmation.bodyRatio * 5 + directionalClose * 4 + input.confirmation.rejectionWickRatio * 2), 0, 15);
  const rrQuality = input.rr >= 2 ? 10 : input.rr >= 1.5 ? 8 : 6;
  let total = context + structureClarity + breakQuality + zoneQuality + retestQuality + confirmationQuality + rrQuality;
  if (input.zone.type === "FVG_OB_OVERLAP") {
    total += 5;
    bonuses.push("FVG_OB_OVERLAP");
  }
  if (input.emaAligned) {
    total += 5;
    bonuses.push("EMA_TREND_ALIGNMENT");
  }
  if (input.sessionName === "LONDON" || input.sessionName === "NEW_YORK" || input.sessionName === "OVERLAP") {
    total += 5;
    bonuses.push("ACTIVE_SESSION");
  }
  if (biasAligned && input.biasContext.htf.strength >= 65) {
    total += 5;
    bonuses.push("HTF_SUPPORTS_DIRECTION");
  }
  if (input.zone.type === "SR_FLIP") {
    total += 5;
    bonuses.push("CLEAN_SR_FLIP");
  }
  if (htfNeutral) {
    total -= 3;
    penalties.push("HTF_NEUTRAL");
  }
  if (input.sessionName === "DEAD_ZONE") {
    total -= 5;
    penalties.push("OFF_SESSION");
    warnings.push("OUTSIDE_ACTIVE_SESSION");
  }
  if (input.structureBreak.type === "WICK_CHOCH") {
    total -= 5;
    penalties.push("WICK_ONLY_CHOCH");
  }
  if (input.structure.choppy || input.marketRegime === "CHOPPY") {
    total -= 10;
    penalties.push("CHOPPY_MARKET");
    warnings.push("CHOPPY_MARKET_SCORE_PENALTY");
  }
  if (input.maxSlAtr > 3) {
    total -= 10;
    penalties.push("STOP_LOSS_WIDER_THAN_3_ATR");
    warnings.push("STOP_LOSS_WIDER_THAN_3_ATR");
  }
  if (input.retest.candleIndex - input.zone.createdAtIndex > 10) {
    total -= 8;
    penalties.push("RETEST_TOO_LATE");
  }
  const capped = clamp(Math.round(total), 0, 100);
  return {
    total: capped,
    bonuses,
    penalties,
    warnings: uniqueStrings(warnings),
    breakdown: {
      phase4Setup: clamp(Math.round(structureClarity + breakQuality), 0, 45),
      contextAlignment: context,
      confirmationCandle: confirmationQuality,
      stopLossQuality: input.maxSlAtr <= 2 ? 10 : input.maxSlAtr <= 3 ? 7 : 4,
      targetQuality: rrQuality,
      sessionQuality: input.sessionName === "DEAD_ZONE" ? 0 : 10,
      volatilityQuality: input.structure.choppy ? 4 : 8,
      antiReversal: biasAligned ? 10 : 5,
    },
  };
}

function buildSignal(args: {
  input: V2GoldmineInput;
  candles: Candle[];
  mode: ModeKey;
  thresholds: Thresholds;
  direction: Direction;
  setupId: string;
  structure: MarketStructure;
  structureBreak: StructureBreak;
  zone: PullbackZone;
  retest: Retest;
  confirmation: Confirmation;
  risk: Extract<RiskLevels, { valid: true }>;
  score: ReturnType<typeof calculateTJRSimpleScore>;
  sessionName: string;
  snapshot: TjrSimpleStructurePullbackSnapshot;
}): TradeSignal {
  const confidence = confidenceFor(args.score.total);
  const proof = buildNoRepaintProof(args);
  const snapshot: TjrSimpleStructurePullbackSnapshot = {
    ...args.snapshot,
    stage: "CONFIRMED_SIGNAL",
    signalTime: args.confirmation.timestamp,
    entry: round(args.risk.entry),
    stopLoss: round(args.risk.stopLoss),
    takeProfit: round(args.risk.takeProfit),
    rr: round(args.risk.rr, 3),
    score: args.score.total,
    confidence,
    bonuses: args.score.bonuses,
    penalties: args.score.penalties,
    warnings: args.score.warnings,
    rejectionReasons: [],
    noRepaintProof: proof.message,
  };
  const bullish = args.direction === "BUY";
  const reasons = bullish
    ? ["Bullish structure detected.", "Bullish BOS/CHOCH confirmed.", "Price pulled back into the selected demand/FVG/OB/EMA zone.", "Bullish confirmation candle closed.", "RR passed minimum threshold."]
    : ["Bearish structure detected.", "Bearish BOS/CHOCH confirmed.", "Price pulled back into the selected supply/FVG/OB/EMA zone.", "Bearish confirmation candle closed.", "RR passed minimum threshold."];
  return {
    id: `${TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID}:${args.input.symbol}:${args.confirmation.timestamp}:${args.direction}:${args.structureBreak.modelUsed}`,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID,
    v2Direction: args.direction,
    type: bullish ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
    direction: bullish ? "BULLISH" : "BEARISH",
    status: "CONFIRMED",
    sourceSetupId: args.setupId,
    setupType: args.structureBreak.modelUsed === "TREND_CONTINUATION" ? "TREND_CONTINUATION" : "LIQUIDITY_SWEEP_REVERSAL",
    strategyModel: TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_LABEL,
    mode: "V2_DEFAULT",
    timestamp: args.confirmation.timestamp,
    candleIndex: args.confirmation.candleIndex,
    confirmedAtIndex: args.confirmation.candleIndex,
    timeframe: args.input.timeframe,
    session: toTradingSession(args.sessionName),
    entryPrice: round(args.risk.entry),
    stopLoss: round(args.risk.stopLoss),
    takeProfit: round(args.risk.takeProfit),
    takeProfit2: null,
    takeProfit3: null,
    riskPoints: round(args.risk.risk),
    rewardPoints: round(args.risk.reward),
    rr: round(args.risk.rr, 3),
    score: args.score.total,
    confidence,
    positionSizeSuggestion: round((args.input.settings?.maxRiskAmount ?? 100) / args.risk.risk, 4),
    maxRiskAmount: args.input.settings?.maxRiskAmount ?? 100,
    invalidationLevel: round(args.risk.stopLoss),
    reasons,
    warnings: args.score.warnings,
    rejectionReasons: [],
    relatedMarkers: [`STRUCTURE:${args.structureBreak.confirmedAtIndex}`, `ZONE:${args.zone.createdAtIndex}`, `RETEST:${args.retest.candleIndex}`, `CONFIRMATION:${args.confirmation.candleIndex}`],
    noRepaintProof: proof,
    stopLossDetail: {
      price: round(args.risk.stopLoss),
      source: "ZONE_RETEST_SWING_ATR_BUFFER",
      buffer: round(args.thresholds.slAtrBuffer * (args.snapshot.atr || 0)),
      riskPoints: round(args.risk.risk),
      reason: "Stop is beyond the selected zone, retest extreme, and recent swing with the mode ATR buffer.",
    },
    takeProfitDetail: {
      tp1: round(args.risk.takeProfit),
      tp2: null,
      tp3: null,
      source: args.risk.targetSource,
      rewardPoints: round(args.risk.reward),
      reason: args.risk.fixedTarget ? "No causal liquidity target met the filter, so fixed RR fallback was frozen at confirmation." : "Nearest causal liquidity target met minimum RR before confirmation.",
    },
    scoreBreakdown: args.score.breakdown,
    tjrSimpleStructurePullback: snapshot,
    immutable: true,
  };
}

function makeBaseSnapshot(args: {
  candles: Candle[];
  timeframe: Timeframe;
  direction: Direction;
  mode: ModeKey;
  thresholds: Thresholds;
  biasContext: BiasContext;
  marketRegime: string;
  modelUsed: ModelUsed;
  atr: number;
  signalTime: number;
}): TjrSimpleStructurePullbackSnapshot {
  return {
    stage: "MARKET_STRUCTURE",
    strategyName: TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID,
    checkedCandles: args.candles.length,
    timeframe: args.timeframe,
    direction: args.direction,
    mode: args.mode,
    atr: round(args.atr, 5),
    htfBias: args.biasContext.htf.bias,
    itfBias: args.biasContext.itf.bias,
    marketRegime: args.marketRegime,
    modelUsed: args.modelUsed,
    signalTime: args.signalTime,
    marketStructureFound: false,
    structureType: null,
    bosFound: false,
    chochFound: false,
    bosType: null,
    brokenLevel: null,
    structureIndex: null,
    structureTime: null,
    pullbackZoneFound: false,
    selectedZoneType: null,
    selectedZoneLow: null,
    selectedZoneHigh: null,
    selectedZoneMidpoint: null,
    zoneQuality: 0,
    zoneCreatedAt: null,
    zoneCreatedAtIndex: null,
    retestFound: false,
    retestIndex: null,
    retestAt: null,
    retestDepthPercent: 0,
    confirmationFound: false,
    confirmationIndex: null,
    confirmationAt: null,
    confirmationBodyRatio: 0,
    confirmationClosePosition: 0,
    confirmationRejectionWickRatio: 0,
    entry: 0,
    stopLoss: 0,
    takeProfit: 0,
    rr: 0,
    score: 0,
    confidence: "LOW_CONFIRMED",
    bonuses: [],
    penalties: [],
    rejectionReasons: [],
    warnings: [],
    noRepaintProof: "",
  };
}

function makeAudit(args: {
  mode: ModeKey;
  minScore: number;
  minRR: number;
  candles: number;
  timeframe: Timeframe;
  signals: TradeSignal[];
  rejectedSetups: RejectedSetup[];
  pendingCandidates: SignalCandidateDebug[];
  candidateDebug: SignalCandidateDebug[];
  generationTimeMs: number;
  topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  biasContext: BiasContext;
  marketRegime: string;
  continuationModelsFound: number;
  reversalModelsFound: number;
  marketStructuresFound: number;
  bosFound: number;
  chochFound: number;
  pullbackZonesFound: number;
  retestsFound: number;
  confirmationCandlesFound: number;
  expiredSetups: number;
}): EntryEngineResult["audit"] {
  return {
    activeEngine: ACTIVE_SIGNAL_ENGINE,
    strategyId: TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID,
    activeMode: "V2_DEFAULT",
    minimumScoreRequired: args.minScore,
    minimumSetupScoreRequired: 0,
    minimumSignalScoreRequired: args.minScore,
    minimumRrRequired: args.minRR,
    totalCandlesScanned: args.candles,
    totalMarkersGenerated: 0,
    totalContextsGenerated: 0,
    totalPhase4Setups: 0,
    watchCount: args.pendingCandidates.length,
    setupCount: args.pullbackZonesFound,
    invalidatedCount: args.rejectedSetups.length,
    expiredCount: args.expiredSetups,
    totalSetupsScanned: args.continuationModelsFound + args.reversalModelsFound,
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
    noSignalMessage: args.signals.length ? null : "No confirmed TJR Simple Structure Pullback signal.",
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
    v2TjrSimpleStructurePullback: {
      activeEngineLabel: TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_LABEL,
      strategyId: TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID,
      candlesScanned: args.candles,
      timeframe: args.timeframe,
      mode: args.mode,
      htfBias: `${args.biasContext.htf.bias}:${args.biasContext.htf.strength}`,
      itfBias: `${args.biasContext.itf.bias}:${args.biasContext.itf.strength}`,
      marketRegime: args.marketRegime,
      continuationModelsFound: args.continuationModelsFound,
      reversalModelsFound: args.reversalModelsFound,
      marketStructuresFound: args.marketStructuresFound,
      bosFound: args.bosFound,
      chochFound: args.chochFound,
      pullbackZonesFound: args.pullbackZonesFound,
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

function validateContext(direction: Direction, modelUsed: ModelUsed, context: BiasContext, marketRegime: string, mode: ModeKey, structure: MarketStructure): { valid: true; warnings: string[] } | { valid: false; code: SignalRejectionCode } {
  const warnings: string[] = [];
  if (context.htf.bias === "UNKNOWN" && context.itf.bias === "UNKNOWN") return { valid: false, code: "NO_MARKET_CONTEXT" };
  if (hasStrongOppositeBias(direction, context) && modelUsed !== "CHOCH_REVERSAL") return { valid: false, code: "HTF_STRONGLY_OPPOSITE" };
  if ((context.htf.bias === "NEUTRAL" || context.htf.bias === "RANGING") && mode !== "strict" && mode !== "professional") warnings.push("HTF_NEUTRAL_ALLOWED");
  if ((marketRegime === "CHOPPY" || structure.choppy) && mode !== "easy" && mode !== "testing") warnings.push("MARKET_CHOPPY_SCORE_PENALTY");
  return { valid: true, warnings };
}

function buildNoRepaintProof(args: { setupId: string; structureBreak: StructureBreak; zone: PullbackZone; retest: Retest; confirmation: Confirmation }) {
  const usedMarkerIndexes = [args.structureBreak.confirmedAtIndex, args.zone.createdAtIndex, args.retest.candleIndex, args.confirmation.candleIndex];
  const maxEvidenceIndex = Math.max(...usedMarkerIndexes);
  const passed = maxEvidenceIndex <= args.confirmation.candleIndex;
  return {
    status: passed ? "PASS" as const : "WARNING" as const,
    signalIndex: args.confirmation.candleIndex,
    latestAllowedCandleIndex: args.confirmation.candleIndex,
    usedMarkerIndexes,
    usedContextCloseTimes: [],
    usedSetupId: args.setupId,
    passed,
    lastAvailableIndex: args.confirmation.candleIndex,
    maxEvidenceIndex,
    message: passed ? "TJR structure pullback signal uses only closed candles through confirmation; entry, SL, TP, RR, score, confidence, and timestamp are immutable." : "TJR structure pullback signal attempted to use evidence beyond confirmation.",
  };
}

function pending(setupId: string, direction: Direction, code: SignalRejectionCode, stage: Stage, remaining: number, snapshot: TjrSimpleStructurePullbackSnapshot, thresholds: Thresholds): Extract<Evaluation, { status: "PENDING" }> {
  snapshot.stage = stage;
  snapshot.rejectionReasons = uniqueStrings([...snapshot.rejectionReasons, code]);
  const debug = makeDebug(setupId, direction, "PENDING_CONFIRMATION", code, stage, remaining, thresholds);
  return { status: "PENDING", debug, snapshot };
}

function rejected(setupId: string, direction: Direction, code: SignalRejectionCode, triggerIndex: number | null, stage: Stage, snapshot: TjrSimpleStructurePullbackSnapshot, thresholds: Thresholds, state: RejectedSetup["setupState"] = "INVALIDATED", score: number | null = null, rr: number | null = null): Extract<Evaluation, { status: "REJECTED" }> {
  snapshot.stage = stage;
  snapshot.rejectionReasons = uniqueStrings([...snapshot.rejectionReasons, code]);
  const debug = makeDebug(setupId, direction, state === "EXPIRED" ? "EXPIRED_CONFIRMATION" : "REJECTED", code, stage, 0, thresholds, score, rr);
  return { status: "REJECTED", setupId, direction, code, triggerIndex, stage, state, score, rr, debug, snapshot };
}

function makeDebug(setupId: string, direction: Direction, status: SignalCandidateDebug["confirmationStatus"], code: string, stage: Stage, remaining: number, thresholds: Thresholds, score: number | null = null, rr: number | null = null): SignalCandidateDebug {
  return {
    setupId,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID,
    setupScore: score ?? 0,
    requiredSetupScore: thresholds.minSignalScore,
    finalSignalScore: score,
    requiredSignalScore: thresholds.minSignalScore,
    signalScore: score,
    rr,
    requiredRR: thresholds.minRR,
    directionBias: direction === "BUY" ? "BULLISH" : "BEARISH",
    confirmationStatus: status,
    confirmationWindowRemaining: remaining,
    rejectionReason: code,
    nextRequiredAction: nextActionFor(stage),
    failedStage: stage,
  };
}

function nextActionFor(stage: Stage): string {
  if (stage === "MARKET_STRUCTURE") return "Wait for clear HH/HL or LH/LL structure that is not strongly opposed by HTF context.";
  if (stage === "BOS_CHOCH_CONFIRMED") return "Wait for a close-based BOS/CHOCH and a clean pullback zone.";
  if (stage === "PULLBACK_ZONE_SELECTED") return "Wait for price to retest the selected simple pullback zone.";
  if (stage === "ZONE_RETESTED" || stage === "WAITING_CONFIRMATION") return "Wait for a closed directional confirmation candle beyond the zone midpoint.";
  if (stage === "CONFIRMED_SIGNAL") return "Use immutable confirmed BUY/SELL levels only.";
  if (stage === "EXPIRED") return "Retest or confirmation window expired; wait for a fresh structure break.";
  return "Wait for the complete structure, pullback, confirmation, and RR flow.";
}

function toRejected(setupId: string, direction: Direction, index: number | null, code: SignalRejectionCode, debug: SignalCandidateDebug, state: RejectedSetup["setupState"], modelUsed: ModelUsed): RejectedSetup {
  return {
    setupId,
    setupType: modelUsed === "TREND_CONTINUATION" ? "TREND_CONTINUATION" : "LIQUIDITY_SWEEP_REVERSAL",
    setupState: state,
    direction: direction === "BUY" ? "BULLISH" : "BEARISH",
    triggerIndex: index,
    rejectionReasons: [code],
    rejectionReasonCodes: [code],
    debug,
  };
}

function makeZone(type: ZoneType, low: number, high: number, createdAtIndex: number, createdAt: number, quality: number): PullbackZone {
  return { type, low, high, midpoint: (low + high) / 2, createdAtIndex, createdAt, quality, touchesBeforeRetest: 0 };
}

function zoneRank(type: ZoneType): number {
  if (type === "FVG_OB_OVERLAP") return 7;
  if (type === "SR_FLIP") return 6;
  if (type === "EMA_ZONE") return 5;
  if (type === "FVG") return 4;
  if (type === "OB") return 3;
  if (type === "DISPLACEMENT_50") return 2;
  return 1;
}

function touchesZone(candle: Candle, zone: PullbackZone, atr: number): boolean {
  const tolerance = atr * CONFIG.retestToleranceAtr;
  return candle.low <= zone.high + tolerance && candle.high >= zone.low - tolerance;
}

function zoneInvalidated(candle: Candle, zone: PullbackZone, direction: Direction, atr: number): boolean {
  const buffer = atr * CONFIG.zoneInvalidationAtr;
  return direction === "BUY" ? candle.close < zone.low - buffer : candle.close > zone.high + buffer;
}

function makeRetest(candle: Candle, zone: PullbackZone, direction: Direction, candleIndex: number, touchCount: number): Retest {
  const retestPrice = direction === "BUY" ? Math.max(zone.low, Math.min(candle.low, zone.high)) : Math.max(zone.low, Math.min(candle.high, zone.high));
  const size = Math.max(zone.high - zone.low, Number.EPSILON);
  const depth = direction === "BUY" ? ((zone.high - retestPrice) / size) * 100 : ((retestPrice - zone.low) / size) * 100;
  return { candleIndex, timestamp: candle.timestamp, retestPrice, depthPercent: round(clamp(depth, 0, 100), 1), touchCount };
}

function countTouches(candles: Candle[], zone: PullbackZone, start: number, end: number, atr: number): number {
  let touches = 0;
  for (let index = start; index < end; index++) {
    if (touchesZone(candles[index], zone, atr)) touches++;
  }
  return touches;
}

function isCausalSwing(candles: Candle[], index: number, lookback: number, side: "HIGH" | "LOW"): boolean {
  if (index < lookback) return false;
  const value = side === "HIGH" ? candles[index].high : candles[index].low;
  for (let cursor = index - lookback; cursor < index; cursor++) {
    if (side === "HIGH" && candles[cursor].high >= value) return false;
    if (side === "LOW" && candles[cursor].low <= value) return false;
  }
  return true;
}

function countDirectionalFlips(candles: Candle[], index: number, lookback: number): number {
  let flips = 0;
  for (let cursor = Math.max(1, index - lookback); cursor <= index; cursor++) {
    const current = Math.sign(candles[cursor].close - candles[cursor].open);
    const previous = Math.sign(candles[cursor - 1].close - candles[cursor - 1].open);
    if (current !== 0 && previous !== 0 && current !== previous) flips++;
  }
  return flips;
}

function resolveBiasContext(context: MarketContextResult, candles: Candle[]): BiasContext {
  const derived = deriveLtfBias(candles);
  const maybeContext = context as Partial<MarketContextResult>;
  return {
    htf: {
      bias: maybeContext.htfBias?.bias ?? derived,
      strength: Number.isFinite(maybeContext.htfBias?.strength) ? Number(maybeContext.htfBias?.strength) : derived === "NEUTRAL" ? 35 : 58,
    },
    itf: {
      bias: maybeContext.itfSetup?.direction ?? (derived === "RANGING" || derived === "UNKNOWN" ? "NEUTRAL" : derived),
      strength: Number.isFinite(maybeContext.itfSetup?.strength) ? Number(maybeContext.itfSetup?.strength) : derived === "NEUTRAL" ? 35 : 55,
    },
  };
}

function resolveMarketRegime(context: MarketContextResult, candles: Candle[], atr: Array<number | null>): string {
  const maybeContext = context as Partial<MarketContextResult>;
  if (maybeContext.regime?.regime) return maybeContext.regime.regime;
  const index = candles.length - 1;
  const currentAtr = atr[index] ?? 0;
  if (!currentAtr || index < 20) return "UNKNOWN";
  return countDirectionalFlips(candles, index, 20) >= CONFIG.choppyFlipThreshold ? "CHOPPY" : deriveLtfBias(candles) === "NEUTRAL" ? "RANGING" : "TRENDING";
}

function deriveLtfBias(candles: Candle[]): Bias {
  const source = candles.slice(-40);
  if (source.length < 10) return "UNKNOWN";
  const averageRange = source.reduce((sum, candle) => sum + candle.high - candle.low, 0) / source.length;
  const net = source.at(-1)!.close - source[0].close;
  if (Math.abs(net) < averageRange * 0.8) return "NEUTRAL";
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

function emaTrendAligned(ema20: Array<number | null>, ema50: Array<number | null>, ema200: Array<number | null>, index: number, direction: Direction): boolean {
  const fast = ema20[index];
  const mid = ema50[index];
  const slow = ema200[index];
  if (fast === null || mid === null || slow === null) return false;
  return direction === "BUY" ? fast > mid && mid > slow : fast < mid && mid < slow;
}

function sessionNameAt(timestamp: number): string {
  const hour = new Date(timestamp).getUTCHours();
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

function thresholdsForMode(mode: ModeKey): Thresholds {
  return {
    retestWindow: CONFIG.retestWindowByMode[mode],
    confirmationBodyRatio: CONFIG.confirmationBodyRatioByMode[mode],
    minRR: CONFIG.minRRByMode[mode],
    minSignalScore: CONFIG.minSignalScoreByMode[mode],
    slAtrBuffer: CONFIG.slAtrBufferByMode[mode],
    maxSlAtr: CONFIG.maxSlAtrByMode[mode],
    strictCloseBreak: mode === "strict" || mode === "professional",
  };
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

function confidenceFor(score: number): TradeSignal["confidence"] {
  return score >= 90 ? "PREMIUM" : score >= 82 ? "STRONG" : score >= 60 ? "MODERATE" : "LOW_CONFIRMED";
}

const FNV_OFFSET_BASIS = 0x811c9dc5;

function cacheFingerprintForCandles(candles: Candle[]): string {
  let hash = FNV_OFFSET_BASIS;
  for (const candle of candles) {
    hash = hashCacheNumber(hash, candle.timestamp);
    hash = hashCacheNumber(hash, candle.open, 100000);
    hash = hashCacheNumber(hash, candle.high, 100000);
    hash = hashCacheNumber(hash, candle.low, 100000);
    hash = hashCacheNumber(hash, candle.close, 100000);
    hash = hashCacheNumber(hash, candle.volume ?? 0, 100);
  }
  return hash.toString(36);
}

function cacheFingerprintForContext(context: MarketContextResult): string {
  const maybeContext = context as Partial<MarketContextResult>;
  let hash = FNV_OFFSET_BASIS;
  hash = hashCacheText(hash, maybeContext.htfBias?.bias ?? "UNKNOWN");
  hash = hashCacheNumber(hash, maybeContext.htfBias?.strength ?? 0, 100);
  hash = hashCacheText(hash, maybeContext.itfSetup?.direction ?? "UNKNOWN");
  hash = hashCacheNumber(hash, maybeContext.itfSetup?.strength ?? 0, 100);
  hash = hashCacheText(hash, maybeContext.regime?.regime ?? "UNKNOWN");
  return hash.toString(36);
}

function hashCacheNumber(hash: number, value: number, scale = 1): number {
  const normalized = Number.isFinite(value) ? Math.round(value * scale) : 0;
  return hashCacheText(hash, String(normalized));
}

function hashCacheText(hash: number, value: string): number {
  let next = hash >>> 0;
  for (let index = 0; index < value.length; index++) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 0x01000193) >>> 0;
  }
  next ^= 124;
  return Math.imul(next, 0x01000193) >>> 0;
}

function cloneResult(result: EntryEngineResult, cacheStatus: "hit" | "miss"): EntryEngineResult {
  return { ...result, signalMap: new Map(result.signalMap), audit: { ...result.audit, cacheStatus } };
}

function rejectionRows(counts: Map<string, number>) {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count, percentage: total ? round((count / total) * 100, 1) : 0 }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

function increment(counts: Map<string, number>, code: string): void {
  counts.set(code, (counts.get(code) ?? 0) + 1);
}

function dateKey(timestamp: number): string {
  return zonedDateParts(timestamp, "UTC").date;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
