import type { Candle, Timeframe } from "../candles/types";
import type {
  EntryEngineResult,
  RejectedSetup,
  SignalCandidateDebug,
  SignalRejectionCode,
  SignalScoreBreakdown,
  StockGuruSweepFvgObSnapshot,
  TradeSignal,
} from "../entry-engine/types";
import type { MarketContextResult, TradingSession } from "../market-context/types";
import {
  ACTIVE_SIGNAL_ENGINE,
  STOCK_GURU_SWEEP_FVG_OB_CONFIG as CONFIG,
  STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
  STOCK_GURU_SWEEP_FVG_OB_STRATEGY_LABEL,
} from "./config";
import { calculateATR, calculateEMA, clockWindowAt, detectFVG, zonedDateParts } from "./indicators";
import type { V2GoldmineInput } from "./types";

type Direction = "BUY" | "SELL";
type ModeKey = keyof typeof CONFIG.minRRByMode;
type ModelUsed = "REVERSAL" | "CONTINUATION";
type Bias = "BULLISH" | "BEARISH" | "NEUTRAL" | "RANGING" | "UNKNOWN";
type ItfBias = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "NONE" | "UNKNOWN";
type Stage = StockGuruSweepFvgObSnapshot["stage"];
type ZoneType = NonNullable<StockGuruSweepFvgObSnapshot["selectedZone"]["type"]>;
type StructureType = "CLOSE_BOS" | "WICK_CHOCH";

type Thresholds = {
  minSweepAtr: number;
  maxSweepAtr: number;
  minDisplacementAtr: number;
  fvgMinSizeAtr: number;
  retestWindow: number;
  confirmationBodyRatio: number;
  minRR: number;
  minSignalScore: number;
  slAtrBuffer: number;
  maxSlAtr: number;
  strictBosClose: boolean;
};

type BiasContext = {
  htf: { bias: Bias; strength: number; source: "MARKET_CONTEXT" | "LTF_DERIVED" };
  itf: { bias: ItfBias; strength: number; source: "MARKET_CONTEXT" | "LTF_DERIVED" };
};

type LiquidityLevel = {
  type: "SSL" | "BSL";
  level: number;
  source: "SWING" | "EQUAL_HIGH_LOW" | "PREVIOUS_SESSION" | "ROUND_NUMBER" | "RECENT_RANGE";
  candleIndex: number;
  timestamp: number;
  touches: number;
};

type LiquiditySweep = {
  direction: Direction;
  level: LiquidityLevel;
  candleIndex: number;
  timestamp: number;
  sweepPrice: number;
  sweepDistanceAtr: number;
  reclaimedAtIndex: number;
  reclaimedAt: number;
  reclaimQuality: number;
  reclaimClose: number;
};

type Displacement = {
  direction: Direction;
  candleIndex: number;
  timestamp: number;
  bodyRatio: number;
  closePosition: number;
  rangeAtrMultiple: number;
  averageRangeMultiple: number;
  originLow: number;
  originHigh: number;
  strength: number;
};

type StructureBreak = {
  type: StructureType;
  brokenLevel: number;
  confirmedAtIndex: number;
  timestamp: number;
};

type FvgZone = {
  type: "BULLISH_FVG" | "BEARISH_FVG";
  createdAtIndex: number;
  timestamp: number;
  low: number;
  high: number;
  midpoint: number;
  sizeAtr: number;
  quality: number;
  deeplyMitigated: boolean;
};

type OrderBlockZone = {
  type: "BULLISH_OB" | "BEARISH_OB";
  candleIndex: number;
  createdAt: number;
  low: number;
  high: number;
  midpoint: number;
  sizeAtr: number;
  quality: number;
  isFullWickZone: boolean;
  deeplyMitigated: boolean;
};

type EntryZone = {
  type: ZoneType;
  source: "FVG_OB_OVERLAP" | "FVG" | "OB";
  createdAtIndex: number;
  low: number;
  high: number;
  midpoint: number;
  sizeAtr: number;
  fvg: FvgZone | null;
  ob: OrderBlockZone | null;
  overlap: boolean;
};

type Retest = {
  candleIndex: number;
  timestamp: number;
  retestPrice: number;
  retestDepthPercent: number;
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
  pressure: "BUYERS" | "SELLERS";
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
      targetSource: string;
      fixedTarget: boolean;
      stopSource: string;
      maxSlAtr: number;
    }
  | { valid: false; code: SignalRejectionCode; maxSlAtr?: number };

type ScoreResult = {
  total: number;
  breakdown: SignalScoreBreakdown;
  bonuses: string[];
  penalties: string[];
};

type Evaluation =
  | {
      status: "CONFIRMED";
      signal: TradeSignal;
      debug: SignalCandidateDebug;
      snapshot: StockGuruSweepFvgObSnapshot;
      confirmationIndex: number;
    }
  | {
      status: "PENDING";
      debug: SignalCandidateDebug;
      snapshot: StockGuruSweepFvgObSnapshot;
    }
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
      snapshot: StockGuruSweepFvgObSnapshot;
    };

const resultCache = new Map<string, EntryEngineResult>();

export function clearStockGuruSweepFvgObCache(): void {
  resultCache.clear();
}

export function generateStockGuruSweepFvgObSignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const candles = input.candles.filter((candle) => candle.isClosed);
  const mode = resolveMode(input);
  const thresholds = thresholdsForMode(mode);
  const key = [
    STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
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
  const averageRanges = calculateAverageRange(candles, CONFIG.averageRangePeriod);
  const ema20 = calculateEMA(candles, 20);
  const ema50 = calculateEMA(candles, 50);
  const ema200 = calculateEMA(candles, 200);
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

  let reversalModelsFound = 0;
  let continuationModelsFound = 0;
  let liquidityLevelsFound = 0;
  let sweepsFound = 0;
  let reclaimsFound = 0;
  let displacementsFound = 0;
  let bosFound = 0;
  let fvgZonesFound = 0;
  let orderBlocksFound = 0;
  let overlapZonesFound = 0;
  let entryZonesFound = 0;
  let retestsFound = 0;
  let confirmationCandlesFound = 0;
  let expiredSetups = 0;

  if (candles.length < CONFIG.atrPeriod + CONFIG.structureLookback + 8) {
    increment(rejectionCounts, "INSUFFICIENT_CANDLES");
    const debug = makeCandidateDebug({
      setupId: "stock-guru:none",
      direction: "BUY",
      status: "REJECTED",
      code: "INSUFFICIENT_CANDLES",
      stage: "MARKET_CONTEXT",
      score: null,
      rr: null,
      requiredScore: thresholds.minSignalScore,
      requiredRR: thresholds.minRR,
      remaining: 0,
    });
    candidateDebug.push(debug);
  }

  const firstIndex = Math.max(CONFIG.atrPeriod + CONFIG.averageRangePeriod, CONFIG.structureLookback + 4);
  for (let index = firstIndex; index < candles.length; index++) {
    const currentAtr = atr[index];
    if (!currentAtr || !Number.isFinite(currentAtr)) continue;

    let confirmedAtThisIndex = false;
    for (const direction of ["BUY", "SELL"] as const) {
      const level = detectLiquidityLevels(candles, index, direction, currentAtr);
      if (level) liquidityLevelsFound++;
      const sweep = level ? detectLiquiditySweep(candles, index, direction, currentAtr, thresholds, level) : null;
      if (!sweep) continue;
      sweepsFound++;
      reclaimsFound++;
      reversalModelsFound++;

      const evaluation = evaluateSetup({
        input,
        candles,
        atr,
        averageRanges,
        ema20,
        ema50,
        ema200,
        mode,
        thresholds,
        biasContext,
        marketRegime,
        modelUsed: "REVERSAL",
        direction,
        sweep,
        displacementAtIndex: null,
      });
      collectEvidence(evaluation.snapshot);
      if (handleEvaluation(evaluation)) {
        index = Math.max(index, evaluation.confirmationIndex);
        confirmedAtThisIndex = true;
        break;
      }
    }
    if (confirmedAtThisIndex) continue;

    for (const direction of ["BUY", "SELL"] as const) {
      const displacement = detectDisplacement(candles, index, direction, atr, averageRanges, thresholds, true);
      if (!displacement) continue;
      continuationModelsFound++;
      const evaluation = evaluateSetup({
        input,
        candles,
        atr,
        averageRanges,
        ema20,
        ema50,
        ema200,
        mode,
        thresholds,
        biasContext,
        marketRegime,
        modelUsed: "CONTINUATION",
        direction,
        sweep: null,
        displacementAtIndex: displacement,
      });
      collectEvidence(evaluation.snapshot);
      if (handleEvaluation(evaluation)) {
        index = Math.max(index, evaluation.confirmationIndex);
        break;
      }
    }
  }

  if (signals.length === 0 && rejectedSetups.length === 0 && pendingCandidates.length === 0) {
    increment(rejectionCounts, "NO_SWEEP");
    const snapshot = makeBaseSnapshot({
      candles,
      timeframe: input.timeframe,
      direction: "BUY",
      mode,
      thresholds,
      biasContext,
      marketRegime,
      modelUsed: "REVERSAL",
      atr: 0,
      signalTime: candles.at(-1)?.timestamp ?? 0,
    });
    snapshot.rejectionReasons = ["NO_SWEEP"];
    const debug = makeCandidateDebug({
      setupId: "stock-guru:none",
      direction: "BUY",
      status: "REJECTED",
      code: "NO_SWEEP",
      stage: "LIQUIDITY_SWEEP_DETECTED",
      score: null,
      rr: null,
      requiredScore: thresholds.minSignalScore,
      requiredRR: thresholds.minRR,
      remaining: 0,
    });
    candidateDebug.push(debug);
    rejectedSetups.push(toRejected(debug.setupId, "BUY", candles.length ? candles.length - 1 : null, "NO_SWEEP", debug, "INVALIDATED"));
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
      rejectedSetups.push(toRejected(evaluation.setupId, evaluation.direction, evaluation.triggerIndex, evaluation.code, evaluation.debug, evaluation.state));
      return false;
    }

    const signal = evaluation.signal;
    const sessionKey = `${dateKey(signal.timestamp)}:${signal.session}`;
    if ((sessionSignalCounts.get(sessionKey) ?? 0) >= CONFIG.maxSignalsPerSession) {
      increment(rejectionCounts, "MAX_SESSION_SIGNALS_REACHED");
      const debug = makeCandidateDebug({
        setupId: signal.sourceSetupId,
        direction: signal.v2Direction ?? "BUY",
        status: "REJECTED",
        code: "MAX_SESSION_SIGNALS_REACHED",
        stage: "CONFIRMED_SIGNAL",
        score: signal.score,
        rr: signal.rr,
        requiredScore: thresholds.minSignalScore,
        requiredRR: thresholds.minRR,
        remaining: 0,
      });
      candidateDebug.push(debug);
      rejectedSetups.push(toRejected(signal.sourceSetupId, signal.v2Direction ?? "BUY", signal.confirmedAtIndex, "MAX_SESSION_SIGNALS_REACHED", debug, "INVALIDATED"));
      return false;
    }
    const day = dateKey(signal.timestamp);
    if ((daySignalCounts.get(day) ?? 0) >= CONFIG.maxSignalsPerDay) {
      increment(rejectionCounts, "MAX_DAILY_SIGNALS_REACHED");
      const debug = makeCandidateDebug({
        setupId: signal.sourceSetupId,
        direction: signal.v2Direction ?? "BUY",
        status: "REJECTED",
        code: "MAX_DAILY_SIGNALS_REACHED",
        stage: "CONFIRMED_SIGNAL",
        score: signal.score,
        rr: signal.rr,
        requiredScore: thresholds.minSignalScore,
        requiredRR: thresholds.minRR,
        remaining: 0,
      });
      candidateDebug.push(debug);
      rejectedSetups.push(toRejected(signal.sourceSetupId, signal.v2Direction ?? "BUY", signal.confirmedAtIndex, "MAX_DAILY_SIGNALS_REACHED", debug, "INVALIDATED"));
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

  function collectEvidence(snapshot: StockGuruSweepFvgObSnapshot): void {
    if (snapshot.displacement.found) displacementsFound++;
    if (snapshot.structure.found) bosFound++;
    if (snapshot.fvg.found) fvgZonesFound++;
    if (snapshot.orderBlock.found) orderBlocksFound++;
    if (snapshot.selectedZone.type === "FVG_OB_OVERLAP") overlapZonesFound++;
    if (snapshot.selectedZone.type) entryZonesFound++;
    if (snapshot.selectedZone.retestedAtIndex !== null) retestsFound++;
    if (snapshot.confirmation.found) confirmationCandlesFound++;
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
    reversalModelsFound,
    continuationModelsFound,
    liquidityLevelsFound,
    sweepsFound,
    reclaimsFound,
    displacementsFound,
    bosFound,
    fvgZonesFound,
    orderBlocksFound,
    overlapZonesFound,
    entryZonesFound,
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
      checkedSetups: reversalModelsFound + continuationModelsFound,
      rejectionReasons: topRejectionReasons.map((row) => row.reason),
      message: pendingCandidates.length ? "Stock Guru setup is waiting for a closed retest or confirmation candle." : "No confirmed Stock Guru sweep/FVG/OB signal found.",
      nearestPossibleSetup: pendingCandidates.at(-1)?.setupId ?? rejectedSetups.at(-1)?.setupId ?? null,
      requiredForSignal: [
        "Liquidity sweep and reclaim or strong continuation bias",
        "Displacement with BOS/MSS",
        "Valid FVG or order block zone",
        "Zone retest",
        "Closed confirmation candle",
        `${thresholds.minRR.toFixed(1)}R minimum`,
      ],
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
  averageRanges: Array<number | null>;
  ema20: Array<number | null>;
  ema50: Array<number | null>;
  ema200: Array<number | null>;
  mode: ModeKey;
  thresholds: Thresholds;
  biasContext: BiasContext;
  marketRegime: string;
  modelUsed: ModelUsed;
  direction: Direction;
  sweep: LiquiditySweep | null;
  displacementAtIndex: Displacement | null;
}): Evaluation {
  const setupAnchorIndex = args.sweep?.candleIndex ?? args.displacementAtIndex?.candleIndex ?? args.candles.length - 1;
  const setupAtr = args.atr[setupAnchorIndex] ?? 0;
  const setupId = setupIdFor(args.direction, args.modelUsed, setupAnchorIndex, args.sweep?.level.level ?? args.displacementAtIndex?.originLow ?? 0);
  const snapshot = makeBaseSnapshot({
    candles: args.candles,
    timeframe: args.input.timeframe,
    direction: args.direction,
    mode: args.mode,
    thresholds: args.thresholds,
    biasContext: args.biasContext,
    marketRegime: args.marketRegime,
    modelUsed: args.modelUsed,
    atr: setupAtr,
    signalTime: args.candles[setupAnchorIndex]?.timestamp ?? 0,
  });

  if (args.sweep) {
    snapshot.liquidity = {
      levelFound: true,
      type: args.sweep.level.type,
      level: args.sweep.level.level,
      source: args.sweep.level.source,
      sweepFound: true,
      sweepIndex: args.sweep.candleIndex,
      sweepAt: args.sweep.timestamp,
      sweepPrice: args.sweep.sweepPrice,
      reclaimFound: true,
      reclaimIndex: args.sweep.reclaimedAtIndex,
      reclaimAt: args.sweep.reclaimedAt,
      reclaimQuality: args.sweep.reclaimQuality,
    };
  }

  const continuation = args.modelUsed === "CONTINUATION";
  const contextGate = validateContext(args.direction, args.modelUsed, args.biasContext, args.marketRegime, args.mode);
  if (!contextGate.valid) {
    snapshot.rejectionReasons = [contextGate.code];
    return rejected(setupId, args.direction, contextGate.code, setupAnchorIndex, "MARKET_CONTEXT", snapshot, args.thresholds);
  }
  if (continuation && !contextGate.biasAligned) {
    snapshot.rejectionReasons = ["NO_CONTINUATION_BIAS"];
    return rejected(setupId, args.direction, "NO_CONTINUATION_BIAS", setupAnchorIndex, "MARKET_CONTEXT", snapshot, args.thresholds);
  }
  if ((args.mode === "strict" || args.mode === "professional") && args.marketRegime === "CHOPPY") {
    snapshot.rejectionReasons = ["MARKET_TOO_CHOPPY"];
    return rejected(setupId, args.direction, "MARKET_TOO_CHOPPY", setupAnchorIndex, "MARKET_CONTEXT", snapshot, args.thresholds);
  }

  const displacement = args.displacementAtIndex ?? findDisplacementAfter(args.candles, args.sweep, args.direction, args.atr, args.averageRanges, args.thresholds);
  if (!displacement) {
    snapshot.rejectionReasons = ["NO_DISPLACEMENT"];
    return rejected(setupId, args.direction, "NO_DISPLACEMENT", setupAnchorIndex, "RECLAIM_CONFIRMED", snapshot, args.thresholds);
  }
  snapshot.displacement = {
    found: true,
    candleIndex: displacement.candleIndex,
    candleTime: displacement.timestamp,
    strength: displacement.strength,
    bodyRatio: displacement.bodyRatio,
    closePosition: displacement.closePosition,
    rangeAtrMultiple: displacement.rangeAtrMultiple,
    averageRangeMultiple: displacement.averageRangeMultiple,
  };

  const structure = detectBOSOrMSS(args.candles, displacement.candleIndex, args.direction, args.thresholds);
  if (!structure) {
    snapshot.rejectionReasons = ["NO_MSS_OR_BOS"];
    return rejected(setupId, args.direction, "NO_MSS_OR_BOS", displacement.candleIndex, "DISPLACEMENT_CONFIRMED", snapshot, args.thresholds);
  }
  if (args.thresholds.strictBosClose && structure.type !== "CLOSE_BOS") {
    snapshot.rejectionReasons = ["ONLY_WICK_CHOCH"];
    return rejected(setupId, args.direction, "ONLY_WICK_CHOCH", structure.confirmedAtIndex, "MSS_BOS_CONFIRMED", snapshot, args.thresholds);
  }
  snapshot.structure = {
    found: true,
    bosType: structure.type,
    brokenLevel: structure.brokenLevel,
    confirmedAtIndex: structure.confirmedAtIndex,
    confirmedAt: structure.timestamp,
  };

  const fvg = detectFVGNearDisplacement(args.candles, displacement, args.direction, args.atr, args.thresholds);
  if (fvg) {
    snapshot.fvg = {
      found: true,
      type: fvg.type,
      createdAt: fvg.timestamp,
      createdAtIndex: fvg.createdAtIndex,
      low: fvg.low,
      high: fvg.high,
      midpoint: fvg.midpoint,
      sizeAtr: fvg.sizeAtr,
      quality: fvg.quality,
    };
  }
  const ob = findOrderBlockBeforeDisplacement(args.candles, displacement, structure, args.direction, args.atr);
  if (ob) {
    snapshot.orderBlock = {
      found: true,
      type: ob.type,
      createdAt: ob.createdAt,
      createdAtIndex: ob.candleIndex,
      low: ob.low,
      high: ob.high,
      midpoint: ob.midpoint,
      sizeAtr: ob.sizeAtr,
      quality: ob.quality,
    };
  }

  if (!fvg && !ob) {
    snapshot.rejectionReasons = ["NO_ENTRY_ZONE"];
    return rejected(setupId, args.direction, "NO_ENTRY_ZONE", structure.confirmedAtIndex, "MSS_BOS_CONFIRMED", snapshot, args.thresholds);
  }
  const zone = selectBestEntryZone(fvg, ob, displacement, args.direction, setupAtr || 1);
  if (!zone) {
    snapshot.rejectionReasons = ["NO_ENTRY_ZONE"];
    return rejected(setupId, args.direction, "NO_ENTRY_ZONE", structure.confirmedAtIndex, "ENTRY_ZONE_SELECTED", snapshot, args.thresholds);
  }
  snapshot.selectedZone = {
    type: zone.type,
    low: zone.low,
    high: zone.high,
    midpoint: zone.midpoint,
    createdAt: args.candles[zone.createdAtIndex]?.timestamp ?? null,
    createdAtIndex: zone.createdAtIndex,
    retestedAt: null,
    retestedAtIndex: null,
    retestDepthPercent: 0,
  };

  const retestResult = detectZoneRetest(args.candles, zone, args.direction, args.atr, args.thresholds, args.sweep);
  if (retestResult.status === "PENDING") {
    snapshot.rejectionReasons = [retestResult.code];
    return pending(setupId, args.direction, retestResult.code, retestResult.stage, retestResult.remaining, snapshot, args.thresholds);
  }
  if (retestResult.status === "REJECTED") {
    snapshot.rejectionReasons = [retestResult.code];
    return rejected(setupId, args.direction, retestResult.code, retestResult.triggerIndex, retestResult.stage, snapshot, args.thresholds, retestResult.state);
  }
  const retest = retestResult.retest;
  snapshot.selectedZone.retestedAt = retest.timestamp;
  snapshot.selectedZone.retestedAtIndex = retest.candleIndex;
  snapshot.selectedZone.retestDepthPercent = retest.retestDepthPercent;

  const confirmationResult = detectConfirmationCandle(args.candles, zone, retest, args.direction, args.atr, args.thresholds, args.sweep);
  if (confirmationResult.status === "PENDING") {
    snapshot.rejectionReasons = [confirmationResult.code];
    return pending(setupId, args.direction, confirmationResult.code, confirmationResult.stage, confirmationResult.remaining, snapshot, args.thresholds);
  }
  if (confirmationResult.status === "REJECTED") {
    snapshot.rejectionReasons = [confirmationResult.code];
    return rejected(setupId, args.direction, confirmationResult.code, confirmationResult.triggerIndex, confirmationResult.stage, snapshot, args.thresholds, confirmationResult.state);
  }
  const confirmation = confirmationResult.confirmation;
  snapshot.confirmation = {
    found: true,
    candleTime: confirmation.timestamp,
    candleIndex: confirmation.candleIndex,
    open: confirmation.open,
    high: confirmation.high,
    low: confirmation.low,
    close: confirmation.close,
    bodyRatio: confirmation.bodyRatio,
    closePosition: confirmation.closePosition,
    rejectionWickRatio: confirmation.rejectionWickRatio,
    pressure: confirmation.pressure,
  };

  const tradeLevels = validateRisk({
    candles: args.candles,
    direction: args.direction,
    sweep: args.sweep,
    displacement,
    fvg,
    ob,
    zone,
    retest,
    confirmation,
    atr: args.atr[confirmation.candleIndex] ?? setupAtr,
    thresholds: args.thresholds,
  });
  if (!tradeLevels.valid) {
    snapshot.rejectionReasons = [tradeLevels.code];
    snapshot.risk.maxSlAtr = tradeLevels.maxSlAtr ?? 0;
    return rejected(setupId, args.direction, tradeLevels.code, confirmation.candleIndex, "CONFIRMED_SIGNAL", snapshot, args.thresholds);
  }

  const setupBiasContext = resolveBiasContext(args.input.context, args.candles.slice(0, confirmation.candleIndex + 1));
  const sessionName = sessionNameAt(confirmation.timestamp);
  const warnings = uniqueStrings([
    ...contextGate.warnings,
    ...sessionWarnings(sessionName),
    ...(fvg?.deeplyMitigated ? ["FVG_ALREADY_DEEPLY_MITIGATED"] : []),
    ...(ob?.deeplyMitigated ? ["OB_ALREADY_DEEPLY_MITIGATED"] : []),
    ...(tradeLevels.maxSlAtr > 3 ? ["STOP_LOSS_WIDER_THAN_3_ATR"] : []),
  ]);
  const score = calculateStockGuruScore({
    direction: args.direction,
    mode: args.mode,
    biasContext: setupBiasContext,
    modelUsed: args.modelUsed,
    sweep: args.sweep,
    displacement,
    structure,
    fvg,
    ob,
    zone,
    retest,
    confirmation,
    rr: tradeLevels.rr,
    sessionName,
    marketRegime: args.marketRegime,
    emaAligned: emaTrendAligned(args.ema20, args.ema50, args.ema200, confirmation.candleIndex, args.direction),
  });
  snapshot.score = {
    total: score.total,
    confidence: confidenceFor(score.total),
    bonuses: score.bonuses,
    penalties: score.penalties,
  };
  snapshot.risk = {
    entry: tradeLevels.entry,
    stopLoss: tradeLevels.stopLoss,
    takeProfit: tradeLevels.takeProfit,
    rr: tradeLevels.rr,
    maxSlAtr: tradeLevels.maxSlAtr,
  };

  if (score.total < args.thresholds.minSignalScore) {
    snapshot.rejectionReasons = ["SIGNAL_SCORE_TOO_LOW"];
    return rejected(setupId, args.direction, "SIGNAL_SCORE_TOO_LOW", confirmation.candleIndex, "CONFIRMED_SIGNAL", snapshot, args.thresholds, "INVALIDATED", score.total, tradeLevels.rr);
  }

  const signal = buildSignal({
    input: args.input,
    candles: args.candles,
    mode: args.mode,
    thresholds: args.thresholds,
    biasContext: setupBiasContext,
    marketRegime: args.marketRegime,
    modelUsed: args.modelUsed,
    direction: args.direction,
    setupId,
    sweep: args.sweep,
    displacement,
    structure,
    fvg,
    ob,
    zone,
    retest,
    confirmation,
    risk: tradeLevels,
    score,
    warnings,
    sessionName,
    snapshot,
  });
  snapshot.noRepaintProof = signal.noRepaintProof.message;
  const debug = makeCandidateDebug({
    setupId,
    direction: args.direction,
    status: "CONFIRMED",
    code: "CONFIRMED_SIGNAL",
    stage: "CONFIRMED_SIGNAL",
    score: score.total,
    rr: tradeLevels.rr,
    requiredScore: args.thresholds.minSignalScore,
    requiredRR: args.thresholds.minRR,
    remaining: 0,
  });
  return { status: "CONFIRMED", signal, debug, snapshot, confirmationIndex: confirmation.candleIndex };
}

function detectLiquidityLevels(candles: Candle[], index: number, direction: Direction, atr: number): LiquidityLevel | null {
  const start = Math.max(0, index - CONFIG.liquidityLookback);
  const source = candles.slice(start, index);
  if (source.length < CONFIG.swingLookback * 2) return null;
  const side = direction === "BUY" ? "LOW" : "HIGH";
  const swingLevels: LiquidityLevel[] = [];
  for (let cursor = start + CONFIG.swingLookback; cursor < index; cursor++) {
    if (isCausalSwing(candles, cursor, CONFIG.swingLookback, side)) {
      swingLevels.push({
        type: direction === "BUY" ? "SSL" : "BSL",
        level: side === "LOW" ? candles[cursor].low : candles[cursor].high,
        source: "SWING",
        candleIndex: cursor,
        timestamp: candles[cursor].timestamp,
        touches: 1,
      });
    }
  }
  if (swingLevels.length) {
    return direction === "BUY"
      ? swingLevels.reduce((best, item) => item.level < best.level ? item : best)
      : swingLevels.reduce((best, item) => item.level > best.level ? item : best);
  }

  const level = direction === "BUY" ? Math.min(...source.map((candle) => candle.low)) : Math.max(...source.map((candle) => candle.high));
  const touches = source.filter((candle) => Math.abs((direction === "BUY" ? candle.low : candle.high) - level) <= atr * CONFIG.equalHighLowToleranceAtr).length;
  const roundStep = 5;
  const nearestRound = Math.round(level / roundStep) * roundStep;
  const roundClose = Math.abs(nearestRound - level) <= atr * 0.10;
  return {
    type: direction === "BUY" ? "SSL" : "BSL",
    level: roundClose ? nearestRound : level,
    source: touches >= 2 ? "EQUAL_HIGH_LOW" : roundClose ? "ROUND_NUMBER" : "RECENT_RANGE",
    candleIndex: start + source.findIndex((candle) => direction === "BUY" ? candle.low === level : candle.high === level),
    timestamp: source.find((candle) => direction === "BUY" ? candle.low === level : candle.high === level)?.timestamp ?? candles[index - 1].timestamp,
    touches,
  };
}

function detectLiquiditySweep(
  candles: Candle[],
  index: number,
  direction: Direction,
  atr: number,
  thresholds: Thresholds,
  level: LiquidityLevel,
): LiquiditySweep | null {
  const candle = candles[index];
  const sweepPrice = direction === "BUY" ? candle.low : candle.high;
  const sweepDistance = direction === "BUY" ? level.level - sweepPrice : sweepPrice - level.level;
  const sweepDistanceAtr = sweepDistance / atr;
  if (sweepDistanceAtr < thresholds.minSweepAtr || sweepDistanceAtr > thresholds.maxSweepAtr) return null;

  const maxReclaimIndex = Math.min(candles.length - 1, index + CONFIG.maxCandlesToReclaim);
  for (let cursor = index; cursor <= maxReclaimIndex; cursor++) {
    const reclaimCandle = candles[cursor];
    const reclaimed = direction === "BUY" ? reclaimCandle.close > level.level : reclaimCandle.close < level.level;
    if (!reclaimed) continue;
    const range = reclaimCandle.high - reclaimCandle.low;
    const bodyRatio = range > 0 ? Math.abs(reclaimCandle.close - reclaimCandle.open) / range : 0;
    if (bodyRatio < 0.18) continue;
    return {
      direction,
      level,
      candleIndex: index,
      timestamp: candle.timestamp,
      sweepPrice,
      sweepDistanceAtr,
      reclaimedAtIndex: cursor,
      reclaimedAt: reclaimCandle.timestamp,
      reclaimQuality: cursor === index ? 1 : cursor === index + 1 ? 0.85 : 0.7,
      reclaimClose: reclaimCandle.close,
    };
  }
  return null;
}

function findDisplacementAfter(
  candles: Candle[],
  sweep: LiquiditySweep | null,
  direction: Direction,
  atr: Array<number | null>,
  averageRanges: Array<number | null>,
  thresholds: Thresholds,
): Displacement | null {
  const start = sweep ? sweep.reclaimedAtIndex : Math.max(CONFIG.structureLookback, 0);
  const end = sweep ? Math.min(candles.length - 1, sweep.reclaimedAtIndex + CONFIG.maxCandlesToDisplaceAfterReclaim) : candles.length - 1;
  for (let index = start; index <= end; index++) {
    const displacement = detectDisplacement(candles, index, direction, atr, averageRanges, thresholds, false);
    if (displacement) return displacement;
  }
  return null;
}

function detectDisplacement(
  candles: Candle[],
  index: number,
  direction: Direction,
  atr: Array<number | null>,
  averageRanges: Array<number | null>,
  thresholds: Thresholds,
  continuation: boolean,
): Displacement | null {
  const currentAtr = atr[index];
  const averageRange = averageRanges[index] ?? currentAtr;
  if (!currentAtr || !averageRange) return null;
  const candle = candles[index];
  const range = candle.high - candle.low;
  if (range <= 0) return null;
  const minRange = continuation ? thresholds.minDisplacementAtr + 0.08 : thresholds.minDisplacementAtr;
  if (range < currentAtr * minRange || range < averageRange * CONFIG.minAverageRangeMultiple) return null;
  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  if (bodyRatio < CONFIG.displacementBodyRatio) return null;
  const closePosition = (candle.close - candle.low) / range;
  const bullish = candle.close > candle.open && closePosition >= CONFIG.displacementClosePosition;
  const bearish = candle.close < candle.open && closePosition <= 1 - CONFIG.displacementClosePosition;
  if (direction === "BUY" && !bullish) return null;
  if (direction === "SELL" && !bearish) return null;
  return {
    direction,
    candleIndex: index,
    timestamp: candle.timestamp,
    bodyRatio,
    closePosition,
    rangeAtrMultiple: range / currentAtr,
    averageRangeMultiple: range / averageRange,
    originLow: candle.low,
    originHigh: candle.high,
    strength: Math.round(Math.min(100, (range / currentAtr) * 35 + bodyRatio * 35 + Math.abs(closePosition - 0.5) * 60)),
  };
}

function detectBOSOrMSS(candles: Candle[], displacementIndex: number, direction: Direction, thresholds: Thresholds): StructureBreak | null {
  const start = Math.max(0, displacementIndex - CONFIG.structureLookback);
  const prior = candles.slice(start, displacementIndex);
  if (prior.length < CONFIG.swingLookback) return null;
  const level = direction === "BUY" ? Math.max(...prior.map((candle) => candle.high)) : Math.min(...prior.map((candle) => candle.low));
  const maxIndex = Math.min(candles.length - 1, displacementIndex + CONFIG.maxCandlesToBosAfterDisplacement);
  for (let index = displacementIndex; index <= maxIndex; index++) {
    const candle = candles[index];
    const closedBreak = direction === "BUY" ? candle.close > level : candle.close < level;
    if (closedBreak) return { type: "CLOSE_BOS", brokenLevel: level, confirmedAtIndex: index, timestamp: candle.timestamp };
    const wickBreak = direction === "BUY" ? candle.high > level : candle.low < level;
    if (wickBreak && !thresholds.strictBosClose) return { type: "WICK_CHOCH", brokenLevel: level, confirmedAtIndex: index, timestamp: candle.timestamp };
  }
  return null;
}

function detectFVGNearDisplacement(
  candles: Candle[],
  displacement: Displacement,
  direction: Direction,
  atr: Array<number | null>,
  thresholds: Thresholds,
): FvgZone | null {
  const end = Math.min(candles.length - 1, displacement.candleIndex + CONFIG.maxCandlesToCreateFvgAfterDisplacement);
  for (let index = displacement.candleIndex; index <= end; index++) {
    const fvg = detectFVG(candles, index);
    if (!fvg) continue;
    if (direction === "BUY" && fvg.type !== "BULLISH_FVG") continue;
    if (direction === "SELL" && fvg.type !== "BEARISH_FVG") continue;
    const referenceAtr = atr[index] ?? atr[displacement.candleIndex];
    if (!referenceAtr) continue;
    const sizeAtr = fvg.size / referenceAtr;
    if (sizeAtr < thresholds.fvgMinSizeAtr || sizeAtr > CONFIG.fvgMaxSizeAtr) continue;
    const deeplyMitigated = false;
    const quality = calculateFVGQuality(sizeAtr, displacement, deeplyMitigated);
    return {
      type: fvg.type,
      createdAtIndex: index,
      timestamp: candles[index].timestamp,
      low: fvg.bottom,
      high: fvg.top,
      midpoint: fvg.midpoint,
      sizeAtr,
      quality,
      deeplyMitigated,
    };
  }
  return null;
}

function findOrderBlockBeforeDisplacement(
  candles: Candle[],
  displacement: Displacement,
  structure: StructureBreak,
  direction: Direction,
  atr: Array<number | null>,
): OrderBlockZone | null {
  const referenceAtr = atr[displacement.candleIndex];
  if (!referenceAtr) return null;
  const start = Math.max(0, displacement.candleIndex - CONFIG.orderBlockMaxLookback);
  for (let index = displacement.candleIndex - 1; index >= start; index--) {
    const candle = candles[index];
    const opposite = direction === "BUY" ? candle.close < candle.open : candle.close > candle.open;
    if (!opposite) continue;
    const bodyLow = Math.min(candle.open, candle.close);
    const bodyHigh = Math.max(candle.open, candle.close);
    let low = direction === "BUY" ? candle.low : bodyLow;
    let high = direction === "BUY" ? bodyHigh : candle.high;
    let sizeAtr = (high - low) / referenceAtr;
    let isFullWickZone = false;
    if (sizeAtr < CONFIG.orderBlockMinSizeAtr) {
      low = candle.low;
      high = candle.high;
      sizeAtr = (high - low) / referenceAtr;
      isFullWickZone = true;
    }
    if (sizeAtr < CONFIG.orderBlockMinSizeAtr || sizeAtr > CONFIG.orderBlockMaxSizeAtr) return null;
    const movedAway = direction === "BUY"
      ? candles[structure.confirmedAtIndex].close > high + referenceAtr * 0.2
      : candles[structure.confirmedAtIndex].close < low - referenceAtr * 0.2;
    if (!movedAway) continue;
    const priorMitigation = candles.slice(index + 1, displacement.candleIndex).some((item) => direction === "BUY" ? item.low <= low : item.high >= high);
    return {
      type: direction === "BUY" ? "BULLISH_OB" : "BEARISH_OB",
      candleIndex: index,
      createdAt: candle.timestamp,
      low,
      high,
      midpoint: (low + high) / 2,
      sizeAtr,
      quality: calculateOBQuality(sizeAtr, displacement, isFullWickZone, priorMitigation),
      isFullWickZone,
      deeplyMitigated: priorMitigation,
    };
  }
  return null;
}

function selectBestEntryZone(fvg: FvgZone | null, ob: OrderBlockZone | null, displacement: Displacement, direction: Direction, atr: number): EntryZone | null {
  if (fvg && ob) {
    const low = Math.max(fvg.low, ob.low);
    const high = Math.min(fvg.high, ob.high);
    if (high > low) {
      return {
        type: "FVG_OB_OVERLAP",
        source: "FVG_OB_OVERLAP",
        createdAtIndex: Math.max(fvg.createdAtIndex, ob.candleIndex),
        low,
        high,
        midpoint: (low + high) / 2,
        sizeAtr: (high - low) / atr,
        fvg,
        ob,
        overlap: true,
      };
    }
  }
  if (fvg) {
    return {
      type: "FVG",
      source: "FVG",
      createdAtIndex: fvg.createdAtIndex,
      low: fvg.low,
      high: fvg.high,
      midpoint: fvg.midpoint,
      sizeAtr: fvg.sizeAtr,
      fvg,
      ob: null,
      overlap: false,
    };
  }
  if (ob) {
    return {
      type: "OB",
      source: "OB",
      createdAtIndex: ob.candleIndex,
      low: ob.low,
      high: ob.high,
      midpoint: ob.midpoint,
      sizeAtr: ob.sizeAtr,
      fvg: null,
      ob,
      overlap: false,
    };
  }
  const midpoint = (displacement.originLow + displacement.originHigh) / 2;
  const buffer = atr * CONFIG.retestToleranceAtr;
  return direction === "BUY" || direction === "SELL" ? {
    type: "DISPLACEMENT_50",
    source: "FVG",
    createdAtIndex: displacement.candleIndex,
    low: midpoint - buffer,
    high: midpoint + buffer,
    midpoint,
    sizeAtr: (buffer * 2) / atr,
    fvg: null,
    ob: null,
    overlap: false,
  } : null;
}

function detectZoneRetest(
  candles: Candle[],
  zone: EntryZone,
  direction: Direction,
  atr: Array<number | null>,
  thresholds: Thresholds,
  sweep: LiquiditySweep | null,
): { status: "CONFIRMED"; retest: Retest } | { status: "PENDING"; code: SignalRejectionCode; stage: Stage; remaining: number } | { status: "REJECTED"; code: SignalRejectionCode; stage: Stage; triggerIndex: number; state: RejectedSetup["setupState"] } {
  const maxRetestIndex = zone.createdAtIndex + thresholds.retestWindow;
  const availableRetestIndex = Math.min(candles.length - 1, maxRetestIndex);
  let touches = 0;
  for (let index = zone.createdAtIndex + 1; index <= availableRetestIndex; index++) {
    const currentAtr = atr[index] ?? atr[zone.createdAtIndex];
    if (!currentAtr) continue;
    const candle = candles[index];
    if (zoneInvalidated(candle, zone, direction, currentAtr, sweep)) {
      return { status: "REJECTED", code: "ZONE_INVALIDATED", stage: "ENTRY_ZONE_SELECTED", triggerIndex: index, state: "INVALIDATED" };
    }
    if (touchesZone(candle, zone, currentAtr)) {
      touches++;
      if (touches > 3) {
        return { status: "REJECTED", code: "TOO_MANY_ZONE_TOUCHES", stage: "ZONE_RETESTED", triggerIndex: index, state: "INVALIDATED" };
      }
      return { status: "CONFIRMED", retest: makeRetest(candle, zone, direction, index, touches) };
    }
  }
  if (candles.length - 1 < maxRetestIndex) {
    return { status: "PENDING", code: "NO_ZONE_RETEST", stage: "ENTRY_ZONE_SELECTED", remaining: maxRetestIndex - (candles.length - 1) };
  }
  return { status: "REJECTED", code: "RETEST_TOO_LATE", stage: "EXPIRED", triggerIndex: availableRetestIndex, state: "EXPIRED" };
}

function detectConfirmationCandle(
  candles: Candle[],
  zone: EntryZone,
  retest: Retest,
  direction: Direction,
  atr: Array<number | null>,
  thresholds: Thresholds,
  sweep: LiquiditySweep | null,
): { status: "CONFIRMED"; confirmation: Confirmation } | { status: "PENDING"; code: SignalRejectionCode; stage: Stage; remaining: number } | { status: "REJECTED"; code: SignalRejectionCode; stage: Stage; triggerIndex: number; state: RejectedSetup["setupState"] } {
  const maxConfirmationIndex = retest.candleIndex + CONFIG.maxConfirmationCandlesAfterRetest;
  const availableConfirmationIndex = Math.min(candles.length - 1, maxConfirmationIndex);
  for (let index = retest.candleIndex; index <= availableConfirmationIndex; index++) {
    const currentAtr = atr[index] ?? atr[zone.createdAtIndex];
    if (!currentAtr) continue;
    const candle = candles[index];
    if (index > retest.candleIndex && zoneInvalidated(candle, zone, direction, currentAtr, sweep)) {
      return { status: "REJECTED", code: "ZONE_INVALIDATED", stage: "WAITING_CONFIRMATION", triggerIndex: index, state: "INVALIDATED" };
    }
    const confirmation = buildConfirmation(candle, zone, direction, currentAtr, thresholds, index);
    if (confirmation) return { status: "CONFIRMED", confirmation };
  }
  if (candles.length - 1 < maxConfirmationIndex) {
    return { status: "PENDING", code: "NO_CONFIRMATION_CANDLE", stage: "WAITING_CONFIRMATION", remaining: maxConfirmationIndex - (candles.length - 1) };
  }
  return { status: "REJECTED", code: "CONFIRMATION_TOO_WEAK", stage: "WAITING_CONFIRMATION", triggerIndex: availableConfirmationIndex, state: "INVALIDATED" };
}

function buildConfirmation(candle: Candle, zone: EntryZone, direction: Direction, atr: number, thresholds: Thresholds, candleIndex: number): Confirmation | null {
  const range = candle.high - candle.low;
  if (range <= 0 || range < atr * 0.20) return null;
  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  if (bodyRatio < thresholds.confirmationBodyRatio) return null;
  const closePosition = (candle.close - candle.low) / range;
  if (direction === "BUY") {
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    if (!(candle.close > candle.open) || closePosition < 0.60 || candle.close <= zone.midpoint || candle.close < zone.low) return null;
    if (lowerWick / range < 0.08) return null;
    return {
      candleIndex,
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      bodyRatio,
      closePosition,
      rejectionWickRatio: lowerWick / range,
      pressure: "BUYERS",
    };
  }
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  if (!(candle.close < candle.open) || closePosition > 0.40 || candle.close >= zone.midpoint || candle.close > zone.high) return null;
  if (upperWick / range < 0.08) return null;
  return {
    candleIndex,
    timestamp: candle.timestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    bodyRatio,
    closePosition,
    rejectionWickRatio: upperWick / range,
    pressure: "SELLERS",
  };
}

function validateRisk(input: {
  candles: Candle[];
  direction: Direction;
  sweep: LiquiditySweep | null;
  displacement: Displacement;
  fvg: FvgZone | null;
  ob: OrderBlockZone | null;
  zone: EntryZone;
  retest: Retest;
  confirmation: Confirmation;
  atr: number;
  thresholds: Thresholds;
}): RiskLevels {
  const retestSlice = input.candles.slice(input.retest.candleIndex, input.confirmation.candleIndex + 1);
  const retestExtreme = input.direction === "BUY" ? Math.min(...retestSlice.map((candle) => candle.low)) : Math.max(...retestSlice.map((candle) => candle.high));
  const entry = input.confirmation.close;
  const candidates = input.direction === "BUY"
    ? [
        input.sweep?.sweepPrice,
        input.fvg?.low,
        input.ob?.low,
        input.zone.low,
        retestExtreme,
        input.displacement.originLow,
      ].filter(isNumber)
    : [
        input.sweep?.sweepPrice,
        input.fvg?.high,
        input.ob?.high,
        input.zone.high,
        retestExtreme,
        input.displacement.originHigh,
      ].filter(isNumber);
  const buffer = input.atr * input.thresholds.slAtrBuffer;
  const stopLoss = input.direction === "BUY" ? Math.min(...candidates) - buffer : Math.max(...candidates) + buffer;
  const risk = input.direction === "BUY" ? entry - stopLoss : stopLoss - entry;
  if (!Number.isFinite(risk) || !(risk > 0)) return { valid: false, code: "INVALID_STOP_LOSS", maxSlAtr: 0 };
  const maxSlAtr = risk / input.atr;
  if (maxSlAtr > input.thresholds.maxSlAtr) return { valid: false, code: "STOP_TOO_WIDE", maxSlAtr };
  const target = findNearestLiquidityTarget(input.candles, input.direction, entry, risk, input.confirmation.candleIndex, input.thresholds.minRR);
  if (!target) return { valid: false, code: "RR_TOO_LOW", maxSlAtr };
  const reward = input.direction === "BUY" ? target.price - entry : entry - target.price;
  const rr = reward / risk;
  if (rr < input.thresholds.minRR) return { valid: false, code: "RR_TOO_LOW", maxSlAtr };
  return {
    valid: true,
    entry,
    stopLoss,
    takeProfit: target.price,
    risk,
    reward,
    rr,
    targetSource: target.source,
    fixedTarget: target.fixed,
    stopSource: input.zone.type === "FVG_OB_OVERLAP" ? "SWEEP_FVG_OB_RETEST_ATR_BUFFER" : input.zone.type === "FVG" ? "SWEEP_FVG_RETEST_ATR_BUFFER" : "SWEEP_OB_RETEST_ATR_BUFFER",
    maxSlAtr,
  };
}

function findNearestLiquidityTarget(candles: Candle[], direction: Direction, entry: number, risk: number, confirmationIndex: number, minRR: number): { price: number; source: string; fixed: boolean } | null {
  const candidates: Array<{ price: number; source: string }> = [];
  const start = Math.max(0, confirmationIndex - 100);
  for (let index = start + CONFIG.swingLookback; index < confirmationIndex; index++) {
    if (direction === "BUY" && isCausalSwing(candles, index, CONFIG.swingLookback, "HIGH") && candles[index].high > entry) {
      candidates.push({ price: candles[index].high, source: "PREVIOUS_SWING_HIGH_OR_BSL" });
    }
    if (direction === "SELL" && isCausalSwing(candles, index, CONFIG.swingLookback, "LOW") && candles[index].low < entry) {
      candidates.push({ price: candles[index].low, source: "PREVIOUS_SWING_LOW_OR_SSL" });
    }
  }
  const recent = candles.slice(Math.max(0, confirmationIndex - 48), confirmationIndex);
  if (recent.length) {
    const sessionLevel = direction === "BUY" ? Math.max(...recent.map((candle) => candle.high)) : Math.min(...recent.map((candle) => candle.low));
    if (direction === "BUY" ? sessionLevel > entry : sessionLevel < entry) {
      candidates.push({ price: sessionLevel, source: "RECENT_SESSION_LIQUIDITY" });
    }
  }
  const valid = candidates
    .map((candidate) => ({ ...candidate, rr: (direction === "BUY" ? candidate.price - entry : entry - candidate.price) / risk }))
    .filter((candidate) => candidate.rr >= minRR)
    .sort((left, right) => direction === "BUY" ? left.price - right.price : right.price - left.price);
  if (valid.length) return { price: valid[0].price, source: valid[0].source, fixed: false };
  if (candidates.length) return null;
  return { price: direction === "BUY" ? entry + risk * CONFIG.preferredRR : entry - risk * CONFIG.preferredRR, source: "FIXED_2R_FALLBACK", fixed: true };
}

function calculateStockGuruScore(input: {
  direction: Direction;
  mode: ModeKey;
  biasContext: BiasContext;
  modelUsed: ModelUsed;
  sweep: LiquiditySweep | null;
  displacement: Displacement;
  structure: StructureBreak;
  fvg: FvgZone | null;
  ob: OrderBlockZone | null;
  zone: EntryZone;
  retest: Retest;
  confirmation: Confirmation;
  rr: number;
  sessionName: string;
  marketRegime: string;
  emaAligned: boolean;
}): ScoreResult {
  const bonuses: string[] = [];
  const penalties: string[] = [];
  const biasAligned = biasSupportsDirection(input.direction, input.biasContext);
  const htfNeutral = input.biasContext.htf.bias === "NEUTRAL" || input.biasContext.htf.bias === "RANGING";
  let context = biasAligned ? 10 : htfNeutral && (input.mode === "easy" || input.mode === "testing") ? 7 : 5;
  if (input.emaAligned) context = Math.min(10, context + 2);
  const sweepScore = input.sweep ? 12 + input.sweep.reclaimQuality * 3 : input.modelUsed === "CONTINUATION" ? 5 : 0;
  const displacement = clamp(Math.round(8 + input.displacement.bodyRatio * 5 + Math.min(2, input.displacement.rangeAtrMultiple)), 0, 15);
  const structure = input.structure.type === "CLOSE_BOS" ? 15 : 10;
  const fvg = input.fvg ? clamp(Math.round(input.fvg.quality), 0, 15) : input.ob ? 5 : 0;
  const ob = input.ob ? clamp(Math.round(input.ob.quality), 0, 15) : input.fvg ? 5 : 0;
  const retest = clamp(10 - Math.max(0, input.retest.candleIndex - input.zone.createdAtIndex - 4), 4, 10);
  const confirmation = clamp(Math.round(6 + input.confirmation.bodyRatio * 4 + input.confirmation.rejectionWickRatio * 3), 0, 10);
  const rrQuality = input.rr >= 2 ? 10 : input.rr >= 1.5 ? 8 : 6;

  let total = context + sweepScore + displacement + structure + fvg + ob + retest + confirmation + rrQuality;
  if (input.zone.overlap) {
    total += 8;
    bonuses.push("FVG_OB_OVERLAP");
  }
  if (input.sweep) {
    total += 5;
    bonuses.push("SWEEP_BEFORE_DISPLACEMENT");
  }
  if (input.structure.type === "CLOSE_BOS") {
    total += 5;
    bonuses.push("BOS_BY_CLOSE");
  }
  if (input.sessionName === "LONDON" || input.sessionName === "NEW_YORK" || input.sessionName === "OVERLAP") {
    total += 5;
    bonuses.push("ACTIVE_SESSION");
  }
  if (biasAligned && input.biasContext.htf.strength >= 65) {
    total += 5;
    bonuses.push("HTF_BIAS_SUPPORTS_DIRECTION");
  }
  if (htfNeutral) {
    total -= 3;
    penalties.push("HTF_NEUTRAL");
  }
  if (input.sessionName === "DEAD_ZONE") {
    total -= 5;
    penalties.push("OFF_SESSION");
  }
  if (input.structure.type === "WICK_CHOCH") {
    total -= 5;
    penalties.push("WICK_ONLY_CHOCH");
  }
  if (input.marketRegime === "CHOPPY") {
    total -= 10;
    penalties.push("CHOPPY_MARKET");
  }
  if (input.fvg?.deeplyMitigated) {
    total -= 10;
    penalties.push("FVG_ALREADY_DEEPLY_MITIGATED");
  }
  if (input.ob?.deeplyMitigated) {
    total -= 10;
    penalties.push("OB_ALREADY_DEEPLY_MITIGATED");
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
    breakdown: {
      phase4Setup: clamp(Math.round(sweepScore + displacement + structure), 0, 45),
      contextAlignment: context,
      confirmationCandle: confirmation,
      stopLossQuality: input.zone.overlap ? 10 : 7,
      targetQuality: rrQuality,
      sessionQuality: input.sessionName === "DEAD_ZONE" ? 0 : 10,
      volatilityQuality: input.marketRegime === "CHOPPY" ? 0 : 8,
      antiReversal: biasAligned ? 10 : 5,
    },
  };
}

function buildSignal(args: {
  input: V2GoldmineInput;
  candles: Candle[];
  mode: ModeKey;
  thresholds: Thresholds;
  biasContext: BiasContext;
  marketRegime: string;
  modelUsed: ModelUsed;
  direction: Direction;
  setupId: string;
  sweep: LiquiditySweep | null;
  displacement: Displacement;
  structure: StructureBreak;
  fvg: FvgZone | null;
  ob: OrderBlockZone | null;
  zone: EntryZone;
  retest: Retest;
  confirmation: Confirmation;
  risk: Extract<RiskLevels, { valid: true }>;
  score: ScoreResult;
  warnings: string[];
  sessionName: string;
  snapshot: StockGuruSweepFvgObSnapshot;
}): TradeSignal {
  const directionLabel = args.direction === "BUY" ? "BULLISH" : "BEARISH";
  const type = args.direction === "BUY" ? "CONFIRMED_BUY" : "CONFIRMED_SELL";
  const confidence = confidenceFor(args.score.total);
  const proof = buildNoRepaintProof(args);
  const snapshot: StockGuruSweepFvgObSnapshot = {
    ...args.snapshot,
    signalTime: args.confirmation.timestamp,
    stage: "CONFIRMED_SIGNAL",
    checkedCandles: args.confirmation.candleIndex + 1,
    htfBias: args.biasContext.htf.bias,
    itfBias: args.biasContext.itf.bias,
    marketRegime: args.marketRegime,
    risk: {
      entry: round(args.risk.entry),
      stopLoss: round(args.risk.stopLoss),
      takeProfit: round(args.risk.takeProfit),
      rr: round(args.risk.rr, 3),
      maxSlAtr: round(args.risk.maxSlAtr, 3),
    },
    score: {
      total: args.score.total,
      confidence,
      bonuses: args.score.bonuses,
      penalties: args.score.penalties,
    },
    warnings: args.warnings,
    rejectionReasons: [],
    noRepaintProof: proof.message,
  };
  const reasons = args.direction === "BUY"
    ? [
        args.sweep ? "SSL sweep and reclaim detected." : "Bullish continuation bias replaced the reversal sweep requirement.",
        "Bullish displacement formed after liquidity evidence.",
        `${args.structure.type} confirmed above internal structure.`,
        `${args.zone.type} zone selected from FVG/order block evidence.`,
        "Price retested the selected zone and a bullish confirmation candle closed.",
        "RR passed the minimum threshold.",
      ]
    : [
        args.sweep ? "BSL sweep and reclaim detected." : "Bearish continuation bias replaced the reversal sweep requirement.",
        "Bearish displacement formed after liquidity evidence.",
        `${args.structure.type} confirmed below internal structure.`,
        `${args.zone.type} zone selected from FVG/order block evidence.`,
        "Price retested the selected zone and a bearish confirmation candle closed.",
        "RR passed the minimum threshold.",
      ];
  return {
    id: `${STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID}:${args.input.symbol}:${args.confirmation.timestamp}:${args.direction}:${args.modelUsed}`,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
    v2Direction: args.direction,
    type,
    direction: directionLabel,
    status: "CONFIRMED",
    sourceSetupId: args.setupId,
    setupType: args.modelUsed === "REVERSAL" ? "LIQUIDITY_SWEEP_REVERSAL" : "TREND_CONTINUATION",
    strategyModel: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_LABEL,
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
    warnings: args.warnings,
    rejectionReasons: [],
    relatedMarkers: [
      args.sweep ? `${args.sweep.level.type}:${args.sweep.candleIndex}` : `CONTINUATION:${args.displacement.candleIndex}`,
      `RECLAIM:${args.sweep?.reclaimedAtIndex ?? args.displacement.candleIndex}`,
      `DISPLACEMENT:${args.displacement.candleIndex}`,
      `${args.structure.type}:${args.structure.confirmedAtIndex}`,
      args.fvg ? `FVG:${args.fvg.createdAtIndex}` : "",
      args.ob ? `OB:${args.ob.candleIndex}` : "",
      `${args.zone.type}:${args.zone.createdAtIndex}`,
      `RETEST:${args.retest.candleIndex}`,
      `CONFIRMATION:${args.confirmation.candleIndex}`,
    ].filter(Boolean),
    noRepaintProof: proof,
    stopLossDetail: {
      price: round(args.risk.stopLoss),
      source: args.risk.stopSource,
      buffer: round((args.thresholds.slAtrBuffer * (args.snapshot.atr || 0))),
      riskPoints: round(args.risk.risk),
      reason: "Stop is beyond the sweep/FVG/OB/retest/displacement extreme with the mode ATR buffer.",
    },
    takeProfitDetail: {
      tp1: round(args.risk.takeProfit),
      tp2: null,
      tp3: null,
      source: args.risk.targetSource,
      rewardPoints: round(args.risk.reward),
      reason: args.risk.fixedTarget ? "No causal liquidity target met the filter, so the fixed 2R fallback was frozen at confirmation." : "Nearest causal opposite liquidity target met the minimum RR before confirmation.",
    },
    scoreBreakdown: args.score.breakdown,
    stockGuruSweepFvgOb: snapshot,
    immutable: true,
  };
}

function buildNoRepaintProof(args: {
  candles: Candle[];
  setupId: string;
  sweep: LiquiditySweep | null;
  displacement: Displacement;
  structure: StructureBreak;
  fvg: FvgZone | null;
  ob: OrderBlockZone | null;
  zone: EntryZone;
  retest: Retest;
  confirmation: Confirmation;
}) {
  const usedMarkerIndexes = [
    args.sweep?.candleIndex,
    args.sweep?.reclaimedAtIndex,
    args.displacement.candleIndex,
    args.structure.confirmedAtIndex,
    args.fvg?.createdAtIndex,
    args.ob?.candleIndex,
    args.zone.createdAtIndex,
    args.retest.candleIndex,
    args.confirmation.candleIndex,
  ].filter((value): value is number => typeof value === "number");
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
    message: passed
      ? "Stock Guru signal uses only closed candles through confirmation; entry, SL, TP, RR, score, confidence, and timestamp are immutable."
      : "Stock Guru signal attempted to use evidence beyond the confirmation candle.",
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
}): StockGuruSweepFvgObSnapshot {
  return {
    stage: "MARKET_CONTEXT",
    strategyName: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
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
    liquidity: {
      levelFound: false,
      type: null,
      level: null,
      source: null,
      sweepFound: false,
      sweepIndex: null,
      sweepAt: null,
      sweepPrice: null,
      reclaimFound: false,
      reclaimIndex: null,
      reclaimAt: null,
      reclaimQuality: 0,
    },
    displacement: {
      found: false,
      candleIndex: null,
      candleTime: null,
      strength: 0,
      bodyRatio: 0,
      closePosition: 0,
      rangeAtrMultiple: 0,
      averageRangeMultiple: 0,
    },
    structure: {
      found: false,
      bosType: null,
      brokenLevel: null,
      confirmedAtIndex: null,
      confirmedAt: null,
    },
    fvg: {
      found: false,
      type: null,
      createdAt: null,
      createdAtIndex: null,
      low: null,
      high: null,
      midpoint: null,
      sizeAtr: 0,
      quality: 0,
    },
    orderBlock: {
      found: false,
      type: null,
      createdAt: null,
      createdAtIndex: null,
      low: null,
      high: null,
      midpoint: null,
      sizeAtr: 0,
      quality: 0,
    },
    selectedZone: {
      type: null,
      low: null,
      high: null,
      midpoint: null,
      createdAt: null,
      createdAtIndex: null,
      retestedAt: null,
      retestedAtIndex: null,
      retestDepthPercent: 0,
    },
    confirmation: {
      found: false,
      candleTime: null,
      candleIndex: null,
      open: null,
      high: null,
      low: null,
      close: null,
      bodyRatio: 0,
      closePosition: 0,
      rejectionWickRatio: 0,
      pressure: null,
    },
    risk: {
      entry: 0,
      stopLoss: 0,
      takeProfit: 0,
      rr: 0,
      maxSlAtr: 0,
    },
    score: {
      total: 0,
      confidence: "LOW_CONFIRMED",
      bonuses: [],
      penalties: [],
    },
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
  reversalModelsFound: number;
  continuationModelsFound: number;
  liquidityLevelsFound: number;
  sweepsFound: number;
  reclaimsFound: number;
  displacementsFound: number;
  bosFound: number;
  fvgZonesFound: number;
  orderBlocksFound: number;
  overlapZonesFound: number;
  entryZonesFound: number;
  retestsFound: number;
  confirmationCandlesFound: number;
  expiredSetups: number;
}): EntryEngineResult["audit"] {
  return {
    activeEngine: ACTIVE_SIGNAL_ENGINE,
    strategyId: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
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
    setupCount: args.entryZonesFound,
    invalidatedCount: args.rejectedSetups.length,
    expiredCount: args.expiredSetups,
    totalSetupsScanned: args.reversalModelsFound + args.continuationModelsFound,
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
    noSignalMessage: args.signals.length ? null : "No confirmed Stock Guru Sweep FVG OB signal.",
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
    v2StockGuruSweepFvgOb: {
      activeEngineLabel: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_LABEL,
      strategyId: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
      candlesScanned: args.candles,
      timeframe: args.timeframe,
      mode: args.mode,
      htfBias: `${args.biasContext.htf.bias}:${args.biasContext.htf.strength}`,
      itfBias: `${args.biasContext.itf.bias}:${args.biasContext.itf.strength}`,
      marketRegime: args.marketRegime,
      reversalModelsFound: args.reversalModelsFound,
      continuationModelsFound: args.continuationModelsFound,
      liquidityLevelsFound: args.liquidityLevelsFound,
      sweepsFound: args.sweepsFound,
      reclaimsFound: args.reclaimsFound,
      displacementsFound: args.displacementsFound,
      bosFound: args.bosFound,
      fvgZonesFound: args.fvgZonesFound,
      orderBlocksFound: args.orderBlocksFound,
      overlapZonesFound: args.overlapZonesFound,
      entryZonesFound: args.entryZonesFound,
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

function validateContext(direction: Direction, modelUsed: ModelUsed, context: BiasContext, marketRegime: string, mode: ModeKey): { valid: true; biasAligned: boolean; warnings: string[] } | { valid: false; code: SignalRejectionCode } {
  const biasAligned = biasSupportsDirection(direction, context);
  const warnings: string[] = [];
  if (context.htf.bias === "UNKNOWN" && context.itf.bias === "UNKNOWN") return { valid: false, code: "NO_MARKET_CONTEXT" };
  if (context.htf.bias === "NEUTRAL" || context.htf.bias === "RANGING") warnings.push("HTF_NEUTRAL_ALLOWED");
  if (!biasAligned) warnings.push("HTF_ITF_BIAS_NOT_ALIGNED");
  if (hasStrongOppositeBias(direction, context) && modelUsed === "CONTINUATION") return { valid: false, code: "HTF_STRONGLY_OPPOSITE" };
  if (mode !== "easy" && mode !== "testing" && marketRegime === "CHOPPY") warnings.push("MARKET_CHOPPY_SCORE_PENALTY");
  return { valid: true, biasAligned, warnings };
}

function resolveBiasContext(context: MarketContextResult, candles: Candle[]): BiasContext {
  const derived = deriveLtfBias(candles);
  const maybeContext = context as Partial<MarketContextResult>;
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
  const source = candles.slice(-40);
  if (source.length < 10) return "UNKNOWN";
  const first = source[0];
  const last = source.at(-1)!;
  const averageRange = source.reduce((sum, candle) => sum + candle.high - candle.low, 0) / source.length;
  const net = last.close - first.close;
  if (Math.abs(net) < averageRange * 0.8) return "NEUTRAL";
  return net > 0 ? "BULLISH" : "BEARISH";
}

function resolveMarketRegime(context: MarketContextResult, candles: Candle[], atr: Array<number | null>): string {
  const maybeContext = context as Partial<MarketContextResult>;
  if (maybeContext.regime?.regime) return maybeContext.regime.regime;
  const index = candles.length - 1;
  const currentAtr = atr[index] ?? 0;
  if (!currentAtr || index < 20) return "UNKNOWN";
  return isChoppyMarket(candles, index, currentAtr) ? "CHOPPY" : deriveLtfBias(candles) === "NEUTRAL" ? "RANGING" : "TRENDING";
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

function touchesZone(candle: Candle, zone: EntryZone, atr: number): boolean {
  const tolerance = atr * CONFIG.retestToleranceAtr;
  return candle.low <= zone.high + tolerance && candle.high >= zone.low - tolerance;
}

function zoneInvalidated(candle: Candle, zone: EntryZone, direction: Direction, atr: number, sweep: LiquiditySweep | null): boolean {
  const buffer = atr * CONFIG.zoneInvalidationAtr;
  if (direction === "BUY") {
    return candle.close < zone.low - buffer || (sweep ? candle.close < sweep.sweepPrice - buffer : false);
  }
  return candle.close > zone.high + buffer || (sweep ? candle.close > sweep.sweepPrice + buffer : false);
}

function makeRetest(candle: Candle, zone: EntryZone, direction: Direction, candleIndex: number, touchCount: number): Retest {
  const retestPrice = direction === "BUY"
    ? Math.max(zone.low, Math.min(candle.low, zone.high))
    : Math.max(zone.low, Math.min(candle.high, zone.high));
  const size = Math.max(zone.high - zone.low, Number.EPSILON);
  const depth = direction === "BUY"
    ? ((zone.high - retestPrice) / size) * 100
    : ((retestPrice - zone.low) / size) * 100;
  return {
    candleIndex,
    timestamp: candle.timestamp,
    retestPrice,
    retestDepthPercent: round(clamp(depth, 0, 100), 1),
    touchCount,
  };
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

function calculateFVGQuality(sizeAtr: number, displacement: Displacement, deeplyMitigated: boolean): number {
  let score = 8 + Math.min(4, sizeAtr * 18) + Math.min(3, displacement.rangeAtrMultiple);
  if (deeplyMitigated) score -= 5;
  return clamp(Math.round(score), 0, 15);
}

function calculateOBQuality(sizeAtr: number, displacement: Displacement, fullWick: boolean, deeplyMitigated: boolean): number {
  let score = 8 + Math.min(4, displacement.bodyRatio * 5) + (sizeAtr <= 1.2 ? 3 : 1);
  if (fullWick) score -= 1;
  if (deeplyMitigated) score -= 5;
  return clamp(Math.round(score), 0, 15);
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

function isChoppyMarket(candles: Candle[], index: number, atr: number): boolean {
  if (index < 20) return false;
  let flips = 0;
  for (let cursor = index - 18; cursor <= index; cursor++) {
    const current = candles[cursor].close - candles[cursor].open;
    const previous = candles[cursor - 1].close - candles[cursor - 1].open;
    if (current !== 0 && previous !== 0 && Math.sign(current) !== Math.sign(previous)) flips++;
  }
  const source = candles.slice(index - 19, index + 1);
  const range = Math.max(...source.map((candle) => candle.high)) - Math.min(...source.map((candle) => candle.low));
  return flips >= 9 || range <= atr * 2.0;
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

function sessionWarnings(sessionName: string): string[] {
  if (sessionName === "DEAD_ZONE") return ["OUTSIDE_ACTIVE_SESSION"];
  if (sessionName === "ASIAN") return ["ASIAN_SESSION_SCORE_ONLY"];
  return [];
}

function toTradingSession(session: string): TradingSession {
  if (session === "ASIAN") return "ASIAN";
  if (session === "LONDON") return "LONDON";
  if (session === "NEW_YORK") return "NEW_YORK";
  if (session === "OVERLAP") return "LONDON_NEW_YORK_OVERLAP";
  return "DEAD_ZONE";
}

function rejected(
  setupId: string,
  direction: Direction,
  code: SignalRejectionCode,
  triggerIndex: number | null,
  stage: Stage,
  snapshot: StockGuruSweepFvgObSnapshot,
  thresholds: Thresholds,
  state: RejectedSetup["setupState"] = "INVALIDATED",
  score: number | null = null,
  rr: number | null = null,
): Extract<Evaluation, { status: "REJECTED" }> {
  snapshot.stage = stage;
  snapshot.rejectionReasons = uniqueStrings([...snapshot.rejectionReasons, code]);
  const debug = makeCandidateDebug({ setupId, direction, status: state === "EXPIRED" ? "EXPIRED_CONFIRMATION" : "REJECTED", code, stage, score, rr, requiredScore: thresholds.minSignalScore, requiredRR: thresholds.minRR, remaining: 0 });
  return { status: "REJECTED", setupId, direction, code, triggerIndex, stage, state, score, rr, debug, snapshot };
}

function pending(
  setupId: string,
  direction: Direction,
  code: SignalRejectionCode,
  stage: Stage,
  remaining: number,
  snapshot: StockGuruSweepFvgObSnapshot,
  thresholds: Thresholds,
): Extract<Evaluation, { status: "PENDING" }> {
  snapshot.stage = stage;
  snapshot.rejectionReasons = uniqueStrings([...snapshot.rejectionReasons, code]);
  const debug = makeCandidateDebug({ setupId, direction, status: "PENDING_CONFIRMATION", code, stage, score: null, rr: null, requiredScore: thresholds.minSignalScore, requiredRR: thresholds.minRR, remaining });
  return { status: "PENDING", debug, snapshot };
}

function makeCandidateDebug(input: {
  setupId: string;
  direction: Direction;
  status: SignalCandidateDebug["confirmationStatus"];
  code: string;
  stage: Stage;
  score: number | null;
  rr: number | null;
  requiredScore: number;
  requiredRR: number;
  remaining: number;
}): SignalCandidateDebug {
  return {
    setupId: input.setupId,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
    setupScore: input.score ?? 0,
    requiredSetupScore: input.requiredScore,
    finalSignalScore: input.score,
    requiredSignalScore: input.requiredScore,
    signalScore: input.score,
    rr: input.rr,
    requiredRR: input.requiredRR,
    directionBias: input.direction === "BUY" ? "BULLISH" : "BEARISH",
    confirmationStatus: input.status,
    confirmationWindowRemaining: input.remaining,
    rejectionReason: input.code,
    nextRequiredAction: nextActionFor(input.stage),
    failedStage: input.stage,
  };
}

function nextActionFor(stage: Stage): string {
  if (stage === "MARKET_CONTEXT") return "Wait for HTF/ITF context that does not strongly oppose the setup.";
  if (stage === "LIQUIDITY_SWEEP_DETECTED") return "Wait for the swept level to reclaim on a closed candle.";
  if (stage === "RECLAIM_CONFIRMED") return "Wait for directional displacement after reclaim.";
  if (stage === "DISPLACEMENT_CONFIRMED") return "Wait for MSS/BOS after displacement.";
  if (stage === "MSS_BOS_CONFIRMED" || stage === "ENTRY_ZONE_SELECTED") return "Wait for valid FVG/OB zone selection and retest.";
  if (stage === "ZONE_RETESTED" || stage === "CONFIRMED_SIGNAL") return "Use immutable confirmed BUY/SELL levels only.";
  if (stage === "EXPIRED") return "Retest or confirmation window expired; wait for a fresh setup.";
  return "Wait for the complete sweep/reclaim/displacement/BOS/FVG/OB/retest/confirmation flow.";
}

function toRejected(setupId: string, direction: Direction, index: number | null, code: SignalRejectionCode, debug: SignalCandidateDebug, state: RejectedSetup["setupState"]): RejectedSetup {
  return {
    setupId,
    setupType: direction === "BUY" || direction === "SELL" ? "LIQUIDITY_SWEEP_REVERSAL" : "TREND_CONTINUATION",
    setupState: state,
    direction: direction === "BUY" ? "BULLISH" : "BEARISH",
    triggerIndex: index,
    rejectionReasons: [code],
    rejectionReasonCodes: [code],
    debug,
  };
}

function thresholdsForMode(mode: ModeKey): Thresholds {
  return {
    minSweepAtr: CONFIG.minSweepAtrByMode[mode],
    maxSweepAtr: CONFIG.maxSweepAtrByMode[mode],
    minDisplacementAtr: CONFIG.minDisplacementAtrByMode[mode],
    fvgMinSizeAtr: CONFIG.fvgMinSizeAtrByMode[mode],
    retestWindow: CONFIG.retestWindowByMode[mode],
    confirmationBodyRatio: CONFIG.confirmationBodyRatioByMode[mode],
    minRR: CONFIG.minRRByMode[mode],
    minSignalScore: CONFIG.minSignalScoreByMode[mode],
    slAtrBuffer: CONFIG.slAtrBufferByMode[mode],
    maxSlAtr: CONFIG.maxSlAtrByMode[mode],
    strictBosClose: mode === "strict" || mode === "professional",
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

const FNV_OFFSET_BASIS = 0x811c9dc5;

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

function setupIdFor(direction: Direction, modelUsed: ModelUsed, index: number, level: number): string {
  return `stock-guru:${modelUsed}:${direction}:${index}:${round(level, 3)}`;
}

function confidenceFor(score: number): TradeSignal["confidence"] {
  return score >= 90 ? "PREMIUM" : score >= 80 ? "STRONG" : score >= 65 ? "MODERATE" : "LOW_CONFIRMED";
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

function cloneResult(result: EntryEngineResult, cacheStatus: "hit" | "miss"): EntryEngineResult {
  return { ...result, signalMap: new Map(result.signalMap), audit: { ...result.audit, cacheStatus } };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
