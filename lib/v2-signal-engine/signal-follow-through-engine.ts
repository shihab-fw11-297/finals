import type { Candle, Timeframe } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { MarketContextResult, TradingSession } from "../market-context/types";

export const SIGNAL_FOLLOW_THROUGH_ENGINE = "SIGNAL_FOLLOW_THROUGH_ENGINE" as const;

export type FollowThroughDirection = "BUY" | "SELL";
export type FollowThroughGrade = "A+" | "A" | "B" | "C" | "AVOID";
export type ExpectedMoveSide = "UP" | "DOWN" | "LOW_CONFIDENCE";
export type FollowThroughReasonCode =
  | "HTF_BIAS_SUPPORTS_SIGNAL"
  | "HTF_BIAS_AGAINST_SIGNAL"
  | "HTF_LIQUIDITY_DRAW_SUPPORTS_SIGNAL"
  | "SIGNAL_INTO_HTF_OBSTACLE"
  | "CLEAN_LIQUIDITY_RUNWAY"
  | "TARGET_TOO_CLOSE"
  | "OBSTACLE_BEFORE_TARGET"
  | "PRICE_ALREADY_AT_LIQUIDITY"
  | "STRONG_DISPLACEMENT"
  | "WEAK_DISPLACEMENT"
  | "NEWS_LIKE_CANDLE"
  | "MOMENTUM_EXHAUSTED"
  | "STRUCTURE_ALIGNED"
  | "STRUCTURE_NOT_ALIGNED"
  | "CLOSE_BASED_BOS"
  | "CHOPPY_STRUCTURE"
  | "ENTRY_NEAR_ORIGIN"
  | "ENTRY_TOO_EXTENDED"
  | "STOP_LOGICAL"
  | "STOP_TOO_WIDE"
  | "SESSION_SUPPORTS_SIGNAL"
  | "DEAD_ZONE_SIGNAL"
  | "LOW_VOLATILITY"
  | "SPREAD_TOO_HIGH"
  | "SIMILAR_SETUP_EDGE_POSITIVE"
  | "SIMILAR_SETUP_EDGE_NEGATIVE"
  | "EDGE_DECAY_DETECTED"
  | "HISTORICAL_SAMPLE_MISSING";

export type FollowThroughLevel = {
  price: number;
  type: string;
  source: "MARKET_CONTEXT" | "SESSION" | "HTF_CANDLES" | "ITF_CANDLES" | "LTF_CANDLES" | "SIGNAL_ZONE" | "SIGNAL_TP";
  distanceR: number;
  strength: number;
};

export type LiquidityRunway = {
  status: "CLEAN" | "LIMITED" | "BLOCKED" | "NO_TARGET";
  cleanRoomR: number;
  targetType: string | null;
  obstacleType: string | null;
  hasObstacleBeforeTarget: boolean;
  hasObstacleBeforeOneR: boolean;
  description: string;
};

export type FollowThroughChartOverlay = {
  markerLabel: string;
  markerColor: string;
  runwayArrow: {
    fromPrice: number;
    toPrice: number;
    direction: "UP" | "DOWN";
    style: "BOLD" | "NORMAL" | "MEDIUM" | "WEAK_DASHED" | "AVOID";
    label: string;
  };
  targetLabel: string;
  obstacleLabel: string | null;
  invalidationLabel: string;
  tooltip: {
    strategy: string;
    direction: FollowThroughDirection;
    followThroughScore: number;
    grade: FollowThroughGrade;
    estimatedProbability: number;
    entry: number;
    stopLoss: number;
    target: FollowThroughLevel | null;
    nearestObstacle: FollowThroughLevel | null;
    liquidityRunway: LiquidityRunway;
    passedFactors: FollowThroughReasonCode[];
    failedFactors: FollowThroughReasonCode[];
    warnings: string[];
    topReason: string;
    avoidReason: string | null;
  };
};

export type SignalFollowThroughDebug = {
  module: typeof SIGNAL_FOLLOW_THROUGH_ENGINE;
  signalId: string;
  strategy: string;
  direction: FollowThroughDirection;
  timeframe: Timeframe;
  atr: number;
  htfBiasScore: number;
  liquidityRunwayScore: number;
  displacementScore: number;
  structureScore: number;
  entryQualityScore: number;
  sessionVolatilityScore: number;
  historicalEdgeScore: number;
  followThroughScore: number;
  followThroughGrade: FollowThroughGrade;
  estimatedProbability: number;
  nearestTarget: number | null;
  nearestTargetType: string | null;
  nearestObstacle: number | null;
  nearestObstacleType: string | null;
  targetDistanceR: number | null;
  obstacleDistanceR: number | null;
  passedFactors: FollowThroughReasonCode[];
  failedFactors: FollowThroughReasonCode[];
  hardBlockers: string[];
  warnings: string[];
  noRepaintProof: FollowThroughNoRepaintProof;
};

export type FollowThroughNoRepaintProof = {
  followThroughCalculatedAtIndex: number;
  candlesKnownAtCalculation: number;
  scoreFrozen: boolean;
  gradeFrozen: boolean;
  targetFrozen: boolean;
  obstacleFrozen: boolean;
  probabilityFrozen: boolean;
};

export type SignalFollowThroughEvaluation = {
  signalId: string;
  strategy: string;
  direction: FollowThroughDirection;
  followThroughScore: number;
  followThroughGrade: FollowThroughGrade;
  moveProbability: number;
  expectedMoveSide: ExpectedMoveSide;
  liquidityRunway: LiquidityRunway;
  nearestTarget: FollowThroughLevel | null;
  nearestObstacle: FollowThroughLevel | null;
  targetDistanceR: number | null;
  obstacleDistanceR: number | null;
  invalidationLevel: number;
  continuationStrength: number;
  rejectionStrength: number;
  warnings: string[];
  reasons: FollowThroughReasonCode[];
  failedFactors: FollowThroughReasonCode[];
  hardBlockers: string[];
  chartOverlay: FollowThroughChartOverlay;
  debug: SignalFollowThroughDebug;
  noRepaintProof: FollowThroughNoRepaintProof;
};

export type HistoricalSignalStatsInput = {
  sampleSize?: number;
  winRate?: number;
  expectancyR?: number;
  averageMfeR?: number;
  averageMaeR?: number;
  barsTo1R?: number;
  recentWinRate?: number;
  previousWinRate?: number;
  records?: HistoricalSignalStatsInput[];
};

export type EvaluateSignalFollowThroughInput = {
  signal: TradeSignal;
  candles: Candle[];
  ltfCandles?: Candle[];
  itfCandles?: Candle[];
  htfCandles?: Candle[];
  timeframe: Timeframe;
  atr: number | Array<number | null>;
  session?: TradingSession;
  marketContext?: MarketContextResult | null;
  historicalSignalStats?: HistoricalSignalStatsInput | HistoricalSignalStatsInput[] | null;
  spread?: number | null;
  options?: {
    minHistoricalSampleSize?: number;
    maxSpreadToRiskRatio?: number;
    maxSpreadAtrRatio?: number;
  };
};

export type PostTradeFollowThroughAnalytics = {
  signalId: string;
  result: "WIN" | "LOSS" | "BREAKEVEN" | "OPEN" | "EXPIRED";
  mfeR: number;
  maeR: number;
  barsTo1R: number | null;
  barsToTP: number | null;
  barsToSL: number | null;
  followedExpectedDirection: boolean;
  followThroughScoreWasAccurate: boolean | null;
};

type FactorResult = {
  score: number;
  reasons: FollowThroughReasonCode[];
  failedFactors: FollowThroughReasonCode[];
  warnings: string[];
  hardBlockers: string[];
  continuationStrength?: number;
  rejectionStrength?: number;
};

type ScoredLevel = Omit<FollowThroughLevel, "distanceR"> & { distanceR?: number };

const FACTOR_WEIGHTS = {
  htfBias: 15,
  liquidityRunway: 20,
  displacement: 15,
  structure: 15,
  entryQuality: 10,
  sessionVolatility: 10,
  historicalEdge: 15,
} as const;

export function evaluateSignalFollowThrough(input: EvaluateSignalFollowThroughInput): SignalFollowThroughEvaluation {
  const direction = signalDirection(input.signal);
  const atr = atrAt(input.atr, input.signal.confirmedAtIndex);
  const knownCandles = candlesKnownAtSignal(input.candles, input.signal);
  const ltfKnown = candlesKnownByTime(input.ltfCandles ?? input.candles, input.signal.timestamp);
  const itfKnown = candlesKnownByTime(input.itfCandles ?? input.marketContext?.itfCandles ?? [], input.signal.timestamp);
  const htfKnown = candlesKnownByTime(input.htfCandles ?? input.marketContext?.htfCandles ?? [], input.signal.timestamp);
  const risk = Math.max(Math.abs(input.signal.entryPrice - input.signal.stopLoss), atr * 0.1, 0.00001);
  const target = nearestTarget(direction, input.signal.entryPrice, risk, input.signal, input.marketContext, ltfKnown, itfKnown, htfKnown);
  const obstacle = nearestObstacle(direction, input.signal.entryPrice, risk, input.signal, input.marketContext, ltfKnown, itfKnown, htfKnown);

  const htfBias = scoreHtfBias(direction, input.signal, input.marketContext, target, obstacle);
  const liquidityRunway = scoreLiquidityRunway(direction, input.signal, risk, target, obstacle);
  const displacement = scoreDisplacement(direction, input.signal, knownCandles, atr);
  const structure = scoreStructure(direction, input.signal, knownCandles);
  const entryQuality = scoreEntryQuality(input.signal, atr, risk);
  const sessionVolatility = scoreSessionVolatility(input.signal, input.session ?? input.signal.session, input.marketContext, atr, risk, input.spread, input.options);
  const historicalEdge = scoreHistoricalEdge(input.signal, direction, input.historicalSignalStats, input.options);

  const warnings = unique([
    ...htfBias.warnings,
    ...liquidityRunway.warnings,
    ...displacement.warnings,
    ...structure.warnings,
    ...entryQuality.warnings,
    ...sessionVolatility.warnings,
    ...historicalEdge.warnings,
  ]);
  const reasons = unique([
    ...htfBias.reasons,
    ...liquidityRunway.reasons,
    ...displacement.reasons,
    ...structure.reasons,
    ...entryQuality.reasons,
    ...sessionVolatility.reasons,
    ...historicalEdge.reasons,
  ]);
  const failedFactors = unique([
    ...htfBias.failedFactors,
    ...liquidityRunway.failedFactors,
    ...displacement.failedFactors,
    ...structure.failedFactors,
    ...entryQuality.failedFactors,
    ...sessionVolatility.failedFactors,
    ...historicalEdge.failedFactors,
  ]);
  const hardBlockers = unique([
    ...htfBias.hardBlockers,
    ...liquidityRunway.hardBlockers,
    ...displacement.hardBlockers,
    ...structure.hardBlockers,
    ...entryQuality.hardBlockers,
    ...sessionVolatility.hardBlockers,
    ...historicalEdge.hardBlockers,
  ]);

  const rawScore = round(
    htfBias.score +
      liquidityRunway.score +
      displacement.score +
      structure.score +
      entryQuality.score +
      sessionVolatility.score +
      historicalEdge.score,
    0,
  );
  const hasHardBlocker = hardBlockers.length > 0;
  const followThroughScore = clamp(hasHardBlocker ? Math.min(rawScore, 57) : rawScore, 0, 100);
  const followThroughGrade = gradeForScore(followThroughScore, hasHardBlocker, liquidityRunway, displacement, structure);
  const moveProbability = probabilityForGrade(followThroughGrade, followThroughScore);
  const expectedMoveSide = followThroughGrade === "AVOID" ? "LOW_CONFIDENCE" : direction === "BUY" ? "UP" : "DOWN";
  const noRepaintProof: FollowThroughNoRepaintProof = {
    followThroughCalculatedAtIndex: input.signal.confirmedAtIndex,
    candlesKnownAtCalculation: knownCandles.length,
    scoreFrozen: true,
    gradeFrozen: true,
    targetFrozen: true,
    obstacleFrozen: true,
    probabilityFrozen: true,
  };
  const continuationStrength = clamp(round((displacement.continuationStrength ?? 0) * 0.45 + (structure.continuationStrength ?? 0) * 0.35 + (liquidityRunway.score / FACTOR_WEIGHTS.liquidityRunway) * 20, 0), 0, 100);
  const rejectionStrength = clamp(round((displacement.rejectionStrength ?? 0) * 0.45 + (structure.rejectionStrength ?? 0) * 0.35 + (hasHardBlocker ? 25 : 0), 0), 0, 100);
  const runway = buildLiquidityRunway(input.signal, target, obstacle);
  const chartOverlay = buildChartOverlay(input.signal, direction, followThroughScore, followThroughGrade, moveProbability, runway, target, obstacle, reasons, failedFactors, warnings, hardBlockers);
  const debug: SignalFollowThroughDebug = {
    module: SIGNAL_FOLLOW_THROUGH_ENGINE,
    signalId: input.signal.id,
    strategy: input.signal.strategyId ?? input.signal.strategyModel,
    direction,
    timeframe: input.timeframe,
    atr,
    htfBiasScore: htfBias.score,
    liquidityRunwayScore: liquidityRunway.score,
    displacementScore: displacement.score,
    structureScore: structure.score,
    entryQualityScore: entryQuality.score,
    sessionVolatilityScore: sessionVolatility.score,
    historicalEdgeScore: historicalEdge.score,
    followThroughScore,
    followThroughGrade,
    estimatedProbability: moveProbability,
    nearestTarget: target?.price ?? null,
    nearestTargetType: target?.type ?? null,
    nearestObstacle: obstacle?.price ?? null,
    nearestObstacleType: obstacle?.type ?? null,
    targetDistanceR: target?.distanceR ?? null,
    obstacleDistanceR: obstacle?.distanceR ?? null,
    passedFactors: reasons,
    failedFactors,
    hardBlockers,
    warnings,
    noRepaintProof,
  };

  return {
    signalId: input.signal.id,
    strategy: input.signal.strategyId ?? input.signal.strategyModel,
    direction,
    followThroughScore,
    followThroughGrade,
    moveProbability,
    expectedMoveSide,
    liquidityRunway: runway,
    nearestTarget: target,
    nearestObstacle: obstacle,
    targetDistanceR: target?.distanceR ?? null,
    obstacleDistanceR: obstacle?.distanceR ?? null,
    invalidationLevel: input.signal.invalidationLevel,
    continuationStrength,
    rejectionStrength,
    warnings,
    reasons,
    failedFactors,
    hardBlockers,
    chartOverlay,
    debug,
    noRepaintProof,
  };
}

export function attachSignalFollowThrough(input: Omit<EvaluateSignalFollowThroughInput, "signal"> & { signals: TradeSignal[] }): TradeSignal[] {
  return input.signals.map((signal) => ({
    ...signal,
    followThrough: evaluateSignalFollowThrough({ ...input, signal }),
  }));
}

export function trackSignalPostTradeFollowThrough(signal: TradeSignal, candles: Candle[], options?: { maxBars?: number }): PostTradeFollowThroughAnalytics {
  const direction = signalDirection(signal);
  const risk = Math.max(Math.abs(signal.entryPrice - signal.stopLoss), 0.00001);
  const maxBars = options?.maxBars ?? 120;
  const future = candles.filter((_, index) => index > signal.confirmedAtIndex).slice(0, maxBars);
  let mfeR = 0;
  let maeR = 0;
  let barsTo1R: number | null = null;
  let barsToTP: number | null = null;
  let barsToSL: number | null = null;

  for (let index = 0; index < future.length; index += 1) {
    const candle = future[index];
    const favorable = direction === "BUY" ? candle.high - signal.entryPrice : signal.entryPrice - candle.low;
    const adverse = direction === "BUY" ? signal.entryPrice - candle.low : candle.high - signal.entryPrice;
    mfeR = Math.max(mfeR, favorable / risk);
    maeR = Math.max(maeR, adverse / risk);
    if (barsTo1R === null && favorable >= risk) barsTo1R = index + 1;
    if (barsToTP === null && (direction === "BUY" ? candle.high >= signal.takeProfit : candle.low <= signal.takeProfit)) barsToTP = index + 1;
    if (barsToSL === null && (direction === "BUY" ? candle.low <= signal.stopLoss : candle.high >= signal.stopLoss)) barsToSL = index + 1;
    if (barsToTP !== null || barsToSL !== null) break;
  }

  const result = barsToTP !== null && (barsToSL === null || barsToTP <= barsToSL)
    ? "WIN"
    : barsToSL !== null
      ? "LOSS"
      : future.length >= maxBars
        ? "EXPIRED"
        : "OPEN";
  const followedExpectedDirection = mfeR >= Math.max(0.5, maeR);
  const grade = signal.followThrough?.followThroughGrade ?? null;
  const expectedStrong = grade === "A+" || grade === "A";
  const expectedWeak = grade === "C" || grade === "AVOID";
  const followThroughScoreWasAccurate = grade === null
    ? null
    : expectedStrong
      ? followedExpectedDirection && mfeR >= 1
      : expectedWeak
        ? !followedExpectedDirection || mfeR < 1
        : followedExpectedDirection;

  return {
    signalId: signal.id,
    result,
    mfeR: round(mfeR, 2),
    maeR: round(maeR, 2),
    barsTo1R,
    barsToTP,
    barsToSL,
    followedExpectedDirection,
    followThroughScoreWasAccurate,
  };
}

function scoreHtfBias(direction: FollowThroughDirection, signal: TradeSignal, context: MarketContextResult | null | undefined, target: FollowThroughLevel | null, obstacle: FollowThroughLevel | null): FactorResult {
  const desired = direction === "BUY" ? "BULLISH" : "BEARISH";
  const opposite = direction === "BUY" ? "BEARISH" : "BULLISH";
  const reasons: FollowThroughReasonCode[] = [];
  const failedFactors: FollowThroughReasonCode[] = [];
  const hardBlockers: string[] = [];
  let score = 7;

  const htfBias = context?.htfBias?.bias;
  const itfBias = context?.itfSetup?.direction;
  if (htfBias === desired && itfBias === desired) {
    score = 15;
    reasons.push("HTF_BIAS_SUPPORTS_SIGNAL");
  } else if (htfBias === desired || itfBias === desired) {
    score = 12;
    reasons.push("HTF_BIAS_SUPPORTS_SIGNAL");
  } else if (htfBias === opposite || itfBias === opposite) {
    score = 4;
    failedFactors.push("HTF_BIAS_AGAINST_SIGNAL");
  }

  if (target && target.distanceR >= 1.5) {
    score = Math.min(15, score + 2);
    reasons.push("HTF_LIQUIDITY_DRAW_SUPPORTS_SIGNAL");
  }
  if (obstacle && obstacle.source !== "SIGNAL_TP" && obstacle.distanceR <= 0.8 && /HTF|SUPPLY|DEMAND|FVG|OB/i.test(obstacle.type)) {
    score = Math.min(score, 3);
    failedFactors.push("SIGNAL_INTO_HTF_OBSTACLE");
    hardBlockers.push(direction === "BUY" ? "BUY directly into HTF supply/obstacle." : "SELL directly into HTF demand/obstacle.");
  }
  if ((signal.reasons.join(" ") + " " + signal.strategyModel).toUpperCase().includes("SWEEP")) {
    score = Math.min(15, score + 1);
  }
  return { score: clamp(score, 0, 15), reasons, failedFactors, warnings: [], hardBlockers };
}

function scoreLiquidityRunway(direction: FollowThroughDirection, signal: TradeSignal, risk: number, target: FollowThroughLevel | null, obstacle: FollowThroughLevel | null): FactorResult {
  const reasons: FollowThroughReasonCode[] = [];
  const failedFactors: FollowThroughReasonCode[] = [];
  const warnings: string[] = [];
  const hardBlockers: string[] = [];
  if (!target) {
    failedFactors.push("TARGET_TOO_CLOSE");
    hardBlockers.push("No clean liquidity target found in signal direction.");
    return { score: 0, reasons, failedFactors, warnings, hardBlockers };
  }
  let score = 6;
  if (target.distanceR >= 2) score = 20;
  else if (target.distanceR >= 1.5) score = 17;
  else if (target.distanceR >= 1) score = 12;
  else {
    score = 5;
    failedFactors.push("TARGET_TOO_CLOSE");
    warnings.push("TARGET_TOO_CLOSE");
  }
  if (target.distanceR < 0.25) {
    score = 0;
    failedFactors.push("PRICE_ALREADY_AT_LIQUIDITY");
    hardBlockers.push("Price is already at the nearest liquidity target.");
  } else {
    reasons.push("CLEAN_LIQUIDITY_RUNWAY");
  }
  if (obstacle) {
    const obstacleBeforeTarget = obstacle.distanceR < target.distanceR;
    if (obstacle.distanceR < 0.8) {
      score = Math.min(score, 4);
      failedFactors.push("OBSTACLE_BEFORE_TARGET");
      hardBlockers.push("Obstacle before 0.8R.");
    } else if (obstacleBeforeTarget && obstacle.distanceR < 1) {
      score = Math.min(score, 8);
      failedFactors.push("OBSTACLE_BEFORE_TARGET");
      warnings.push("OBSTACLE_BEFORE_TARGET");
    } else if (obstacleBeforeTarget) {
      score = Math.min(score, 14);
      failedFactors.push("OBSTACLE_BEFORE_TARGET");
    }
  }
  if (signal.takeProfit) {
    const tpDistanceR = Math.abs(signal.takeProfit - signal.entryPrice) / risk;
    if (tpDistanceR < 1) {
      score = Math.min(score, 7);
      failedFactors.push("TARGET_TOO_CLOSE");
    }
  }
  return { score: clamp(score, 0, 20), reasons, failedFactors, warnings, hardBlockers };
}

function scoreDisplacement(direction: FollowThroughDirection, signal: TradeSignal, candles: Candle[], atr: number): FactorResult {
  const candle = candles[signal.confirmedAtIndex] ?? candles.at(-1);
  if (!candle) {
    return { score: 5, reasons: [], failedFactors: ["WEAK_DISPLACEMENT"], warnings: ["CONFIRMATION_CANDLE_MISSING"], hardBlockers: [], continuationStrength: 25, rejectionStrength: 50 };
  }
  const range = Math.max(candle.high - candle.low, 0.00001);
  const body = Math.abs(candle.close - candle.open);
  const bodyRatio = body / range;
  const closePosition = direction === "BUY" ? (candle.close - candle.low) / range : (candle.high - candle.close) / range;
  const rangeAtr = range / Math.max(atr, 0.00001);
  const avgRange = average(candles.slice(Math.max(0, signal.confirmedAtIndex - 20), signal.confirmedAtIndex).map((item) => item.high - item.low)) || range;
  const avgMultiple = range / Math.max(avgRange, 0.00001);
  const directionalClose = direction === "BUY" ? candle.close > candle.open : candle.close < candle.open;
  const reasons: FollowThroughReasonCode[] = [];
  const failedFactors: FollowThroughReasonCode[] = [];
  const warnings: string[] = [];
  const hardBlockers: string[] = [];
  let score = 5;
  if (directionalClose && rangeAtr >= 0.5 && bodyRatio >= 0.55 && closePosition >= 0.65 && avgMultiple >= 1.1) {
    score = 15;
    reasons.push("STRONG_DISPLACEMENT");
  } else if (directionalClose && rangeAtr >= 0.35 && bodyRatio >= 0.45 && closePosition >= 0.55) {
    score = 11;
    reasons.push("STRONG_DISPLACEMENT");
  } else {
    failedFactors.push("WEAK_DISPLACEMENT");
    score = 4;
  }
  if (range > avgRange * 2.5 && rangeAtr > 1.5) {
    score = Math.min(score, 5);
    failedFactors.push("NEWS_LIKE_CANDLE");
    warnings.push("NEWS_LIKE_CANDLE");
    hardBlockers.push("Confirmation candle is news-like and extended.");
  }
  if (bodyRatio < 0.25) {
    score = Math.min(score, 4);
    failedFactors.push("WEAK_DISPLACEMENT");
  }
  const displacementIndex = displacementIndexFromSignal(signal);
  if (displacementIndex !== null && signal.confirmedAtIndex - displacementIndex > 10) {
    score = Math.min(score, 7);
    failedFactors.push("MOMENTUM_EXHAUSTED");
  }
  return {
    score: clamp(score, 0, 15),
    reasons,
    failedFactors,
    warnings,
    hardBlockers,
    continuationStrength: clamp((rangeAtr * 25) + (bodyRatio * 35) + (closePosition * 30) + (avgMultiple * 10), 0, 100),
    rejectionStrength: clamp((1 - bodyRatio) * 45 + (1 - closePosition) * 35 + (rangeAtr > 2 ? 20 : 0), 0, 100),
  };
}

function scoreStructure(direction: FollowThroughDirection, signal: TradeSignal, candles: Candle[]): FactorResult {
  const reasons: FollowThroughReasonCode[] = [];
  const failedFactors: FollowThroughReasonCode[] = [];
  const warnings: string[] = [];
  const hardBlockers: string[] = [];
  const snapshotStructure = structureFromSignal(signal);
  const swings = detectSwings(candles.slice(0, signal.confirmedAtIndex + 1));
  const lows = swings.filter((item) => item.type === "LOW").slice(-2);
  const highs = swings.filter((item) => item.type === "HIGH").slice(-2);
  const alignedBySwings = direction === "BUY"
    ? lows.length >= 2 && lows[1].price > lows[0].price
    : highs.length >= 2 && highs[1].price < highs[0].price;
  const alignedBySnapshot = snapshotStructure.aligned;
  const hasSweep = /SWEEP|RECLAIM|CHOCH|MSS|BOS/i.test([signal.strategyModel, ...signal.reasons].join(" "));
  const choppy = isChoppy(candles.slice(Math.max(0, signal.confirmedAtIndex - 24), signal.confirmedAtIndex + 1));
  let score = 7;
  if (alignedBySwings || alignedBySnapshot) {
    score = snapshotStructure.closeBased ? 15 : 13;
    reasons.push("STRUCTURE_ALIGNED");
    if (snapshotStructure.closeBased) reasons.push("CLOSE_BASED_BOS");
  } else if (hasSweep) {
    score = 10;
    reasons.push("STRUCTURE_ALIGNED");
  } else {
    score = 4;
    failedFactors.push("STRUCTURE_NOT_ALIGNED");
    hardBlockers.push("Structure is directly against signal without sweep/reversal evidence.");
  }
  if (choppy) {
    score = Math.min(score, 7);
    failedFactors.push("CHOPPY_STRUCTURE");
    warnings.push("CHOPPY_STRUCTURE");
  }
  return {
    score: clamp(score, 0, 15),
    reasons,
    failedFactors,
    warnings,
    hardBlockers,
    continuationStrength: score * (100 / 15),
    rejectionStrength: choppy ? 60 : score < 8 ? 55 : 15,
  };
}

function scoreEntryQuality(signal: TradeSignal, atr: number, risk: number): FactorResult {
  const reasons: FollowThroughReasonCode[] = [];
  const failedFactors: FollowThroughReasonCode[] = [];
  const warnings: string[] = [];
  const hardBlockers: string[] = [];
  let score = 5;
  const zone = entryZoneFromSignal(signal);
  const stopAtr = risk / Math.max(atr, 0.00001);
  if (zone && signal.entryPrice >= zone.low - atr * 0.15 && signal.entryPrice <= zone.high + atr * 0.15) {
    score += 4;
    reasons.push("ENTRY_NEAR_ORIGIN");
  } else if (zone) {
    const distance = signal.entryPrice < zone.low ? zone.low - signal.entryPrice : signal.entryPrice - zone.high;
    if (distance > atr) {
      failedFactors.push("ENTRY_TOO_EXTENDED");
      score -= 2;
    }
  } else if (stopAtr <= 2) {
    score += 2;
    reasons.push("ENTRY_NEAR_ORIGIN");
  }
  if (stopAtr <= 2.5) {
    score += 3;
    reasons.push("STOP_LOGICAL");
  } else {
    score -= 3;
    failedFactors.push("STOP_TOO_WIDE");
    warnings.push("STOP_TOO_WIDE");
  }
  return { score: clamp(score, 0, 10), reasons, failedFactors, warnings, hardBlockers };
}

function scoreSessionVolatility(signal: TradeSignal, session: TradingSession, context: MarketContextResult | null | undefined, atr: number, risk: number, spread: number | null | undefined, options: EvaluateSignalFollowThroughInput["options"]): FactorResult {
  const reasons: FollowThroughReasonCode[] = [];
  const failedFactors: FollowThroughReasonCode[] = [];
  const warnings: string[] = [];
  const hardBlockers: string[] = [];
  let score = 5;
  const strategy = `${signal.strategyId ?? ""} ${signal.strategyModel}`.toUpperCase();
  if (session === "LONDON" || session === "NEW_YORK" || session === "LONDON_NEW_YORK_OVERLAP" || (session === "ASIAN" && strategy.includes("ASIAN"))) {
    score += 3;
    reasons.push("SESSION_SUPPORTS_SIGNAL");
  } else if (session === "DEAD_ZONE") {
    score -= 4;
    failedFactors.push("DEAD_ZONE_SIGNAL");
    warnings.push("DEAD_ZONE_SIGNAL");
  }
  const volatility = context?.volatility?.state;
  if (volatility === "LOW_VOLATILITY") {
    score -= 2;
    failedFactors.push("LOW_VOLATILITY");
    warnings.push("LOW_VOLATILITY");
  } else if (volatility === "NORMAL_VOLATILITY" || volatility === "HIGH_VOLATILITY") {
    score += 2;
  }
  if (typeof spread === "number" && Number.isFinite(spread) && spread > 0) {
    const spreadRiskRatio = spread / risk;
    const spreadAtrRatio = spread / Math.max(atr, 0.00001);
    if (spreadRiskRatio > (options?.maxSpreadToRiskRatio ?? 0.15) || spreadAtrRatio > (options?.maxSpreadAtrRatio ?? 0.1)) {
      score = Math.min(score, 3);
      failedFactors.push("SPREAD_TOO_HIGH");
      warnings.push("SPREAD_TOO_HIGH");
      hardBlockers.push("Spread is too high for the signal risk.");
    }
  }
  return { score: clamp(score, 0, 10), reasons, failedFactors, warnings, hardBlockers };
}

function scoreHistoricalEdge(signal: TradeSignal, direction: FollowThroughDirection, stats: HistoricalSignalStatsInput | HistoricalSignalStatsInput[] | null | undefined, options: EvaluateSignalFollowThroughInput["options"]): FactorResult {
  const reasons: FollowThroughReasonCode[] = [];
  const failedFactors: FollowThroughReasonCode[] = [];
  const warnings: string[] = [];
  const hardBlockers: string[] = [];
  const sample = normalizeHistoricalStats(signal, direction, stats);
  const minSample = options?.minHistoricalSampleSize ?? 20;
  if (!sample || (sample.sampleSize ?? 0) < minSample) {
    warnings.push("HISTORICAL_SAMPLE_MISSING");
    reasons.push("HISTORICAL_SAMPLE_MISSING");
    return { score: 10, reasons, failedFactors, warnings, hardBlockers };
  }
  const winRate = sample.winRate ?? 0.5;
  const expectancy = sample.expectancyR ?? 0;
  const reaches1R = sample.averageMfeR ?? 0;
  let score = 8;
  if (winRate >= 0.56 && expectancy > 0.15 && reaches1R >= 1) {
    score = 15;
    reasons.push("SIMILAR_SETUP_EDGE_POSITIVE");
  } else if (winRate >= 0.5 && expectancy > 0) {
    score = 11;
    reasons.push("SIMILAR_SETUP_EDGE_POSITIVE");
  } else {
    score = 4;
    failedFactors.push("SIMILAR_SETUP_EDGE_NEGATIVE");
  }
  if (typeof sample.recentWinRate === "number" && typeof sample.previousWinRate === "number" && sample.recentWinRate + 0.12 < sample.previousWinRate) {
    score = Math.min(score, 6);
    failedFactors.push("EDGE_DECAY_DETECTED");
    warnings.push("EDGE_DECAY_DETECTED");
  }
  return { score: clamp(score, 0, 15), reasons, failedFactors, warnings, hardBlockers };
}

function nearestTarget(direction: FollowThroughDirection, entry: number, risk: number, signal: TradeSignal, context: MarketContextResult | null | undefined, ltf: Candle[], itf: Candle[], htf: Candle[]): FollowThroughLevel | null {
  const candidates: ScoredLevel[] = [];
  const add = (price: number | null | undefined, type: string, source: FollowThroughLevel["source"], strength = 1) => {
    if (typeof price !== "number" || !Number.isFinite(price)) return;
    if (direction === "BUY" && price <= entry) return;
    if (direction === "SELL" && price >= entry) return;
    candidates.push({ price, type, source, strength });
  };
  if (direction === "BUY") {
    add(context?.nearestLevels?.nearestBSL?.price, "BSL", "MARKET_CONTEXT", context?.nearestLevels?.nearestBSL?.strength ?? 2);
    add(context?.nearestLevels?.nearestResistance?.price, context?.nearestLevels?.nearestResistance?.type ?? "RESISTANCE", "MARKET_CONTEXT", context?.nearestLevels?.nearestResistance?.strength ?? 1);
    add(context?.session?.currentSessionHigh, "SESSION_HIGH", "SESSION", 1.5);
    add(context?.session?.previousSessionHigh, "PREVIOUS_SESSION_HIGH", "SESSION", 1.5);
    add(signal.takeProfit, "SIGNAL_TP1", "SIGNAL_TP", 1);
    addRecentExtremeCandidates(candidates, direction, entry, htf, "HTF_CANDLES", "HTF_SWING_HIGH", 2.5);
    addRecentExtremeCandidates(candidates, direction, entry, itf, "ITF_CANDLES", "ITF_SWING_HIGH", 2);
    addRecentExtremeCandidates(candidates, direction, entry, ltf, "LTF_CANDLES", "LTF_SWING_HIGH", 1);
  } else {
    add(context?.nearestLevels?.nearestSSL?.price, "SSL", "MARKET_CONTEXT", context?.nearestLevels?.nearestSSL?.strength ?? 2);
    add(context?.nearestLevels?.nearestSupport?.price, context?.nearestLevels?.nearestSupport?.type ?? "SUPPORT", "MARKET_CONTEXT", context?.nearestLevels?.nearestSupport?.strength ?? 1);
    add(context?.session?.currentSessionLow, "SESSION_LOW", "SESSION", 1.5);
    add(context?.session?.previousSessionLow, "PREVIOUS_SESSION_LOW", "SESSION", 1.5);
    add(signal.takeProfit, "SIGNAL_TP1", "SIGNAL_TP", 1);
    addRecentExtremeCandidates(candidates, direction, entry, htf, "HTF_CANDLES", "HTF_SWING_LOW", 2.5);
    addRecentExtremeCandidates(candidates, direction, entry, itf, "ITF_CANDLES", "ITF_SWING_LOW", 2);
    addRecentExtremeCandidates(candidates, direction, entry, ltf, "LTF_CANDLES", "LTF_SWING_LOW", 1);
  }
  const liquidityCandidates = candidates.filter((candidate) => candidate.source !== "SIGNAL_TP");
  return nearestLevel(liquidityCandidates.length ? liquidityCandidates : candidates, entry, risk, direction);
}

function nearestObstacle(direction: FollowThroughDirection, entry: number, risk: number, signal: TradeSignal, context: MarketContextResult | null | undefined, ltf: Candle[], itf: Candle[], htf: Candle[]): FollowThroughLevel | null {
  const candidates: ScoredLevel[] = [];
  const add = (price: number | null | undefined, type: string, source: FollowThroughLevel["source"], strength = 1) => {
    if (typeof price !== "number" || !Number.isFinite(price)) return;
    if (direction === "BUY" && price <= entry) return;
    if (direction === "SELL" && price >= entry) return;
    candidates.push({ price, type, source, strength });
  };
  for (const level of context?.levels ?? []) {
    const reason = level.reason.toUpperCase();
    const isSupply = direction === "BUY" && (reason.includes("SUPPLY") || reason.includes("OBSTACLE") || level.type === "FVG" || level.type === "MAJOR_SWING_HIGH");
    const isDemand = direction === "SELL" && (reason.includes("DEMAND") || reason.includes("OBSTACLE") || level.type === "FVG" || level.type === "MAJOR_SWING_LOW");
    if (isSupply || isDemand) add(level.price, `${level.timeframe}_${level.type}`, "MARKET_CONTEXT", level.strength);
  }
  const zone = opposingZoneFromSignal(signal, direction);
  if (zone) add(direction === "BUY" ? zone.low : zone.high, zone.type, "SIGNAL_ZONE", 2);
  addRecentFvgObstacle(candidates, direction, entry, htf, "HTF_CANDLES", 2);
  addRecentFvgObstacle(candidates, direction, entry, itf, "ITF_CANDLES", 1.5);
  addRecentFvgObstacle(candidates, direction, entry, ltf, "LTF_CANDLES", 1);
  return nearestLevel(candidates, entry, risk, direction);
}

function buildLiquidityRunway(signal: TradeSignal, target: FollowThroughLevel | null, obstacle: FollowThroughLevel | null): LiquidityRunway {
  if (!target) {
    return {
      status: "NO_TARGET",
      cleanRoomR: 0,
      targetType: null,
      obstacleType: obstacle?.type ?? null,
      hasObstacleBeforeTarget: Boolean(obstacle),
      hasObstacleBeforeOneR: Boolean(obstacle && obstacle.distanceR < 1),
      description: "No clean liquidity target found.",
    };
  }
  const obstacleBeforeTarget = Boolean(obstacle && obstacle.distanceR < target.distanceR);
  const cleanRoomR = obstacleBeforeTarget && obstacle ? obstacle.distanceR : target.distanceR;
  const status = cleanRoomR >= 1.5 && !obstacleBeforeTarget ? "CLEAN" : cleanRoomR >= 1 ? "LIMITED" : "BLOCKED";
  return {
    status,
    cleanRoomR: round(cleanRoomR, 2),
    targetType: target.type,
    obstacleType: obstacle?.type ?? null,
    hasObstacleBeforeTarget: obstacleBeforeTarget,
    hasObstacleBeforeOneR: Boolean(obstacle && obstacle.distanceR < 1),
    description: `${status} runway to ${target.type} (${target.distanceR.toFixed(2)}R).`,
  };
}

function buildChartOverlay(signal: TradeSignal, direction: FollowThroughDirection, score: number, grade: FollowThroughGrade, probability: number, runway: LiquidityRunway, target: FollowThroughLevel | null, obstacle: FollowThroughLevel | null, reasons: FollowThroughReasonCode[], failedFactors: FollowThroughReasonCode[], warnings: string[], hardBlockers: string[]): FollowThroughChartOverlay {
  const markerLabel = `${direction} ${grade} ${probability}%`;
  const markerColor = gradeColor(grade, direction);
  const targetLabel = target ? `Target: ${target.type} ${target.price.toFixed(2)} (${target.distanceR.toFixed(1)}R)` : "Target: none";
  const obstacleLabel = obstacle ? `Obstacle: ${obstacle.type} ${obstacle.price.toFixed(2)} (${obstacle.distanceR.toFixed(1)}R)` : null;
  const topReason = reasons[0] ?? failedFactors[0] ?? "HISTORICAL_SAMPLE_MISSING";
  return {
    markerLabel,
    markerColor,
    runwayArrow: {
      fromPrice: signal.entryPrice,
      toPrice: target?.price ?? signal.takeProfit,
      direction: direction === "BUY" ? "UP" : "DOWN",
      style: grade === "A+" ? "BOLD" : grade === "A" ? "NORMAL" : grade === "B" ? "MEDIUM" : grade === "C" ? "WEAK_DASHED" : "AVOID",
      label: `${direction === "BUY" ? "UP" : "DOWN"} runway ${target?.distanceR.toFixed(1) ?? "0.0"}R`,
    },
    targetLabel,
    obstacleLabel,
    invalidationLabel: `Invalidation: ${signal.invalidationLevel.toFixed(2)}`,
    tooltip: {
      strategy: signal.strategyId ?? signal.strategyModel,
      direction,
      followThroughScore: score,
      grade,
      estimatedProbability: probability,
      entry: signal.entryPrice,
      stopLoss: signal.stopLoss,
      target,
      nearestObstacle: obstacle,
      liquidityRunway: runway,
      passedFactors: reasons,
      failedFactors,
      warnings,
      topReason,
      avoidReason: hardBlockers[0] ?? null,
    },
  };
}

function gradeForScore(score: number, hasHardBlocker: boolean, liquidity: FactorResult, displacement: FactorResult, structure: FactorResult): FollowThroughGrade {
  if (hasHardBlocker || score < 58) return "AVOID";
  const strongDisplacement = displacement.reasons.includes("STRONG_DISPLACEMENT");
  const structureAligned = structure.reasons.includes("STRUCTURE_ALIGNED");
  const cleanRunway = liquidity.reasons.includes("CLEAN_LIQUIDITY_RUNWAY") && !liquidity.failedFactors.includes("OBSTACLE_BEFORE_TARGET");
  if (score >= 88 && cleanRunway && strongDisplacement && structureAligned) return "A+";
  if (score >= 78) return "A";
  if (score >= 68) return "B";
  return "C";
}

function probabilityForGrade(grade: FollowThroughGrade, score: number): number {
  if (grade === "A+") return clamp(80 + Math.round((score - 88) * 0.8), 80, 90);
  if (grade === "A") return clamp(70 + Math.round((score - 78) * 0.9), 70, 79);
  if (grade === "B") return clamp(60 + Math.round((score - 68) * 1.1), 60, 69);
  if (grade === "C") return clamp(50 + Math.round((score - 58) * 1.1), 50, 59);
  return clamp(35 + Math.round(score * 0.22), 35, 49);
}

function gradeColor(grade: FollowThroughGrade, direction: FollowThroughDirection): string {
  if (grade === "AVOID") return "#94a3b8";
  if (grade === "C") return "#f59e0b";
  if (direction === "BUY") return grade === "A+" ? "#22c55e" : grade === "A" ? "#34d399" : "#14b8a6";
  return grade === "A+" ? "#f43f5e" : grade === "A" ? "#fb7185" : "#f97316";
}

function addRecentExtremeCandidates(candidates: ScoredLevel[], direction: FollowThroughDirection, entry: number, candles: Candle[], source: FollowThroughLevel["source"], type: string, strength: number): void {
  const window = candles.slice(-80);
  if (window.length < 5) return;
  const prices = direction === "BUY" ? window.map((candle) => candle.high).filter((price) => price > entry) : window.map((candle) => candle.low).filter((price) => price < entry);
  if (!prices.length) return;
  const price = direction === "BUY" ? Math.min(...prices) : Math.max(...prices);
  candidates.push({ price, type, source, strength });
}

function addRecentFvgObstacle(candidates: ScoredLevel[], direction: FollowThroughDirection, entry: number, candles: Candle[], source: FollowThroughLevel["source"], strength: number): void {
  const window = candles.slice(-80);
  for (let index = 2; index < window.length; index += 1) {
    const left = window[index - 2];
    const right = window[index];
    if (direction === "BUY" && left.low > right.high && right.high > entry) {
      candidates.push({ price: right.high, type: `${source}_SUPPLY_FVG`, source, strength });
    }
    if (direction === "SELL" && left.high < right.low && right.low < entry) {
      candidates.push({ price: right.low, type: `${source}_DEMAND_FVG`, source, strength });
    }
  }
}

function nearestLevel(candidates: ScoredLevel[], entry: number, risk: number, direction: FollowThroughDirection): FollowThroughLevel | null {
  const normalized = candidates
    .map((level) => ({ ...level, distanceR: Math.abs(level.price - entry) / risk }))
    .filter((level) => Number.isFinite(level.distanceR) && level.distanceR >= 0);
  normalized.sort((left, right) => Math.abs(left.price - entry) - Math.abs(right.price - entry) || right.strength - left.strength);
  const picked = normalized.find((level) => direction === "BUY" ? level.price > entry : level.price < entry);
  return picked ? { ...picked, distanceR: round(picked.distanceR, 2) } : null;
}

function candlesKnownAtSignal(candles: Candle[], signal: TradeSignal): Candle[] {
  return candles.filter((candle, index) => candle.isClosed && index <= signal.confirmedAtIndex && candle.timestamp <= signal.timestamp);
}

function candlesKnownByTime(candles: Candle[], timestamp: number): Candle[] {
  return candles.filter((candle) => candle.isClosed && candle.timestamp <= timestamp);
}

function signalDirection(signal: TradeSignal): FollowThroughDirection {
  return signal.v2Direction ?? (signal.direction === "BULLISH" || signal.type.endsWith("BUY") ? "BUY" : "SELL");
}

function atrAt(atr: number | Array<number | null>, index: number): number {
  const value = Array.isArray(atr)
    ? atr[index] ?? [...atr.slice(0, index + 1)].reverse().find((item): item is number => typeof item === "number" && item > 0)
    : atr;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function detectSwings(candles: Candle[]): Array<{ type: "HIGH" | "LOW"; price: number; index: number }> {
  const swings: Array<{ type: "HIGH" | "LOW"; price: number; index: number }> = [];
  for (let index = 2; index < candles.length - 2; index += 1) {
    const candle = candles[index];
    const left = candles.slice(index - 2, index);
    const right = candles.slice(index + 1, index + 3);
    if ([...left, ...right].every((item) => candle.high > item.high)) swings.push({ type: "HIGH", price: candle.high, index });
    if ([...left, ...right].every((item) => candle.low < item.low)) swings.push({ type: "LOW", price: candle.low, index });
  }
  return swings;
}

function isChoppy(candles: Candle[]): boolean {
  if (candles.length < 12) return false;
  let directionChanges = 0;
  let previous = candleDirection(candles[0]);
  for (const candle of candles.slice(1)) {
    const current = candleDirection(candle);
    if (current !== "NEUTRAL" && previous !== "NEUTRAL" && current !== previous) directionChanges += 1;
    if (current !== "NEUTRAL") previous = current;
  }
  return directionChanges / candles.length > 0.48;
}

function candleDirection(candle: Candle): "UP" | "DOWN" | "NEUTRAL" {
  if (candle.close > candle.open) return "UP";
  if (candle.close < candle.open) return "DOWN";
  return "NEUTRAL";
}

function structureFromSignal(signal: TradeSignal): { aligned: boolean; closeBased: boolean } {
  const direction = signalDirection(signal);
  const text = [
    signal.proLiquidityConfluence?.structureShift.type,
    signal.stockGuruSweepFvgOb?.structure.bosType,
    signal.tjrSimpleStructurePullback?.bosType,
    signal.ictOteContinuation?.structureBreak.type,
    signal.ictIfvgReversal?.structureBreak.type,
    signal.fvgContinuation?.structureBreak.type,
    signal.silverBullet?.structureShift.type,
    ...signal.reasons,
  ].filter(Boolean).join(" ").toUpperCase();
  const aligned = text.includes("BOS") || text.includes("CHOCH") || text.includes("MSS");
  const closeBased = text.includes("CLOSE") || text.includes("BOS");
  if (!aligned) return { aligned: false, closeBased: false };
  const oppositeText = direction === "BUY" ? "BEARISH" : "BULLISH";
  return { aligned: !text.includes(oppositeText), closeBased };
}

function displacementIndexFromSignal(signal: TradeSignal): number | null {
  return firstNumber([
    signal.proLiquidityConfluence?.displacement.candleIndex,
    signal.stockGuruSweepFvgOb?.displacement.candleIndex,
    signal.orderBlockRetest?.displacement.candleIndex,
    signal.fvgContinuation?.displacement.candleIndex,
    signal.silverBullet?.displacement.candleIndex,
    signal.ictOteContinuation?.impulse.endIndex,
  ]);
}

function entryZoneFromSignal(signal: TradeSignal): { low: number; high: number } | null {
  const stockGuruZone = signal.stockGuruSweepFvgOb?.selectedZone;
  const tjrZone = signal.tjrSimpleStructurePullback;
  const zone = firstZone([
    signal.proLiquidityConfluence?.entryZone ? { low: signal.proLiquidityConfluence.entryZone.bottom, high: signal.proLiquidityConfluence.entryZone.top } : null,
    stockGuruZone && stockGuruZone.low !== null && stockGuruZone.high !== null ? { low: stockGuruZone.low, high: stockGuruZone.high } : null,
    tjrZone && tjrZone.selectedZoneLow !== null && tjrZone.selectedZoneHigh !== null ? { low: tjrZone.selectedZoneLow, high: tjrZone.selectedZoneHigh } : null,
    signal.ictOteContinuation?.ote ? { low: signal.ictOteContinuation.ote.low, high: signal.ictOteContinuation.ote.high } : null,
    signal.ictIfvgReversal?.ifvgZone ? { low: signal.ictIfvgReversal.ifvgZone.bottom, high: signal.ictIfvgReversal.ifvgZone.top } : null,
    signal.fvgContinuation?.fvg ? { low: signal.fvgContinuation.fvg.bottom, high: signal.fvgContinuation.fvg.top } : null,
    signal.silverBullet?.fvg ? { low: signal.silverBullet.fvg.bottom, high: signal.silverBullet.fvg.top } : null,
    signal.orderBlockRetest?.orderBlock ? { low: signal.orderBlockRetest.orderBlock.bottom, high: signal.orderBlockRetest.orderBlock.top } : null,
  ]);
  return zone ? { low: Math.min(zone.low, zone.high), high: Math.max(zone.low, zone.high) } : null;
}

function opposingZoneFromSignal(signal: TradeSignal, direction: FollowThroughDirection): { low: number; high: number; type: string } | null {
  const zones = [
    signal.stockGuruSweepFvgOb?.orderBlock.found && signal.stockGuruSweepFvgOb.orderBlock.low !== null && signal.stockGuruSweepFvgOb.orderBlock.high !== null
      ? { low: signal.stockGuruSweepFvgOb.orderBlock.low, high: signal.stockGuruSweepFvgOb.orderBlock.high, type: signal.stockGuruSweepFvgOb.orderBlock.type ?? "ORDER_BLOCK" }
      : null,
    signal.orderBlockRetest?.orderBlock
      ? { low: signal.orderBlockRetest.orderBlock.bottom, high: signal.orderBlockRetest.orderBlock.top, type: signal.orderBlockRetest.orderBlock.type }
      : null,
  ].filter((zone): zone is { low: number; high: number; type: string } => Boolean(zone));
  return zones.find((zone) => direction === "BUY" ? /BEARISH|SUPPLY/i.test(zone.type) : /BULLISH|DEMAND/i.test(zone.type)) ?? null;
}

function normalizeHistoricalStats(signal: TradeSignal, direction: FollowThroughDirection, stats: HistoricalSignalStatsInput | HistoricalSignalStatsInput[] | null | undefined): HistoricalSignalStatsInput | null {
  if (!stats) return null;
  if (!Array.isArray(stats)) return stats;
  return stats.find((item) => {
    const record = item as HistoricalSignalStatsInput & Record<string, unknown>;
    return (!record.strategy || record.strategy === signal.strategyId || record.strategy === signal.strategyModel)
      && (!record.direction || record.direction === direction)
      && (!record.timeframe || record.timeframe === signal.timeframe)
      && (!record.session || record.session === signal.session);
  }) ?? stats[0] ?? null;
}

function firstZone(items: Array<{ low: number; high: number } | null | undefined>): { low: number; high: number } | null {
  return items.find((item): item is { low: number; high: number } => Boolean(item && Number.isFinite(item.low) && Number.isFinite(item.high))) ?? null;
}

function firstNumber(items: Array<number | null | undefined>): number | null {
  return items.find((item): item is number => typeof item === "number" && Number.isFinite(item)) ?? null;
}

function average(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
