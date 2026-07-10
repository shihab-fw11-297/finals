import type { Candle, Timeframe } from "../candles/types";
import type { CandleReadingResult } from "../candle-reading/types";
import type { MarketContextResult, TradingSession } from "../market-context/types";
import type { MarketStructureResult } from "../market-structure/types";
import type { MarketSetup, SetupScannerResult, SetupType } from "../setup-scanner/types";
import type { MasterSignalSelectionResult } from "../v2-signal-engine/master-signal-selector";
import type { OptionalMasterSelectionResult } from "../v2-signal-engine/optional-master-signal-selector";
import type { InstitutionalMasterSelectionResult } from "../v2-signal-engine/institutional-master-selector";
import type { SignalFollowThroughEvaluation } from "../v2-signal-engine/signal-follow-through-engine";
import type { IntermarketConfirmationResult } from "../market-data/types";

export type EntryMode = "CALIBRATION" | "EASY_SCALP" | "NORMAL_SCALP" | "PRO_TRADER" | "V2_DEFAULT";
export type SignalType = "CONFIRMED_BUY" | "CONFIRMED_SELL" | "RAPID_BUY" | "RAPID_SELL";
export type SignalStatus = "CONFIRMED" | "ACTIVE" | "INVALIDATED" | "TP_HIT" | "SL_HIT" | "EXPIRED";
export type SignalRejectionCode =
  | "DATA_NOT_ENOUGH"
  | "CONFIRMATION_PENDING"
  | "CONFIRMATION_WINDOW_EXPIRED"
  | "INVALIDATED_BEFORE_CONFIRMATION"
  | "HTF_CANDLES_MISSING"
  | "ITF_CANDLES_MISSING"
  | "HTF_BIAS_MISSING"
  | "HTF_OPPOSITE"
  | "CONTEXT_WAIT"
  | "MARKET_CHOPPY"
  | "NO_LIQUIDITY"
  | "NO_DISPLACEMENT"
  | "NO_MSS"
  | "NO_MSS_OR_BOS"
  | "NO_RETRACEMENT"
  | "SETUP_NOT_TRIGGER"
  | "SCORE_TOO_LOW"
  | "RR_TOO_LOW"
  | "STOP_LOSS_INVALID"
  | "TAKE_PROFIT_NOT_FOUND"
  | "CONFIRMATION_CANDLE_MISSING"
  | "PRICE_TOO_EXTENDED"
  | "REVERSAL_RISK_HIGH"
  | "SESSION_LOW_QUALITY"
  | "VOLATILITY_BAD"
  | "NO_ASIAN_RANGE"
  | "INVALID_ASIAN_RANGE"
  | "NO_USABLE_RANGE"
  | "RANGE_HIGH_LOW_INVALID"
  | "RANGE_CANDLES_TOO_FEW"
  | "NO_SWEEP"
  | "WEAK_SWEEP_REJECTION"
  | "NO_DISPLACEMENT_OR_MSS"
  | "NO_CONFIRMATION"
  | "TP_NOT_FOUND"
  | "OUTSIDE_TRADING_SESSION"
  | "OUTSIDE_SESSION"
  | "NO_BREAKOUT"
  | "WEAK_BREAKOUT_CLOSE"
  | "WEAK_BREAKOUT_MOMENTUM"
  | "RETEST_NOT_FOUND"
  | "RETEST_FAILED"
  | "CONFIRMATION_EXPIRED"
  | "DUPLICATE_SIGNAL"
  | "KILLZONE_EXPIRED"
  | "FVG_NOT_FOUND"
  | "FVG_RETEST_EXPIRED"
  | "FVG_CONFIRMATION_EXPIRED"
  | "INVALID_STOP_LOSS"
  | "INVALID_TAKE_PROFIT"
  | "RR_BELOW_MINIMUM"
  | "SIGNAL_SCORE_TOO_LOW"
  | "OUTSIDE_ALLOWED_SESSION"
  | "INSUFFICIENT_CANDLES_FOR_200_EMA"
  | "NEUTRAL_REGIME"
  | "PRICE_TOO_EXTENDED_FROM_VWAP"
  | "PRICE_TOO_CLOSE_TO_VWAP"
  | "NO_VALID_PULLBACK"
  | "PULLBACK_EXPIRED"
  | "WEAK_CONFIRMATION_CANDLE"
  | "MAX_SESSION_SIGNALS_REACHED"
  | "MAX_DAILY_SIGNALS_REACHED"
  | "NO_MARKET_CONTEXT"
  | "HTF_STRONGLY_OPPOSITE"
  | "NO_LIQUIDITY_LEVEL"
  | "SWEEP_TOO_SHALLOW"
  | "SWEEP_TOO_DEEP"
  | "NO_RECLAIM"
  | "RECLAIM_TOO_LATE"
  | "DISPLACEMENT_TOO_WEAK"
  | "ONLY_WICK_CHOCH"
  | "FVG_ALREADY_MITIGATED"
  | "OB_TOO_SMALL"
  | "OB_TOO_LARGE"
  | "OB_ALREADY_MITIGATED"
  | "NO_ZONE_RETEST"
  | "RETEST_TOO_LATE"
  | "ZONE_INVALIDATED"
  | "TOO_MANY_ZONE_TOUCHES"
  | "NO_CONFIRMATION_CANDLE"
  | "CONFIRMATION_TOO_WEAK"
  | "CONFIRMATION_NOT_BEYOND_MIDPOINT"
  | "STOP_TOO_WIDE"
  | "MARKET_TOO_CHOPPY"
  | "INSUFFICIENT_CANDLES_FOR_EMA"
  | "NO_CLEAR_TREND"
  | "EMA_TANGLED_CHOPPY"
  | "PRICE_TOO_EXTENDED_FROM_EMA"
  | "PULLBACK_BROKE_TREND"
  | "INSUFFICIENT_CANDLES"
  | "NO_STRUCTURE_BREAK"
  | "NO_ENTRY_ZONE"
  | "HTF_BIAS_AGAINST_SIGNAL"
  | "NO_VALID_ORDER_BLOCK"
  | "ORDER_BLOCK_TOO_SMALL"
  | "ORDER_BLOCK_TOO_LARGE"
  | "ORDER_BLOCK_EXPIRED"
  | "ORDER_BLOCK_INVALIDATED"
  | "NO_RETEST"
  | "RETEST_EXPIRED"
  | "NO_LIQUIDITY_LEVEL_FOUND"
  | "SWEEP_TOO_SMALL"
  | "SWEEP_TOO_LARGE"
  | "NO_RECLAIM_CLOSE"
  | "OUTSIDE_KILLZONE"
  | "NO_MSS_OR_CHOCH"
  | "NO_FVG_CREATED"
  | "NO_VALID_FVG"
  | "FVG_TOO_SMALL"
  | "FVG_TOO_LARGE"
  | "FVG_ALREADY_FILLED"
  | "FVG_INVALIDATED"
  | "STOP_LOSS_TOO_WIDE"
  | "NO_CONTINUATION_BIAS"
  | "NO_MARKET_STRUCTURE"
  | "MARKET_STRUCTURE_CHOPPY"
  | "NO_BOS_OR_CHOCH"
  | "ONLY_WEAK_WICK_CHOCH"
  | "NO_PULLBACK_ZONE"
  | "ZONE_TOO_WEAK"
  | "ZONE_TOO_FAR_FROM_PRICE"
  | "ZONE_ALREADY_MITIGATED"
  | "LOW_VOLATILITY"
  | "TOO_MUCH_CHOP"
  | "NO_CLEAN_IMPULSE"
  | "IMPULSE_TOO_WEAK"
  | "NO_OTE_RETRACEMENT"
  | "OTE_NO_REJECTION"
  | "OTE_INVALIDATED"
  | "MARKET_LOW_QUALITY"
  | "MAX_KILLZONE_SIGNALS_REACHED";

export type SignalScoreBreakdown = {
  phase4Setup: number;
  contextAlignment: number;
  confirmationCandle: number;
  stopLossQuality: number;
  targetQuality: number;
  sessionQuality: number;
  volatilityQuality: number;
  antiReversal: number;
};

export type V2GoldmineScoreBreakdown = {
  asianRangeQuality: number;
  sweepQuality: number;
  rejectionCandleQuality: number;
  displacementMssQuality: number;
  confirmationCandleQuality: number;
  rrTargetQuality: number;
  sessionQuality: number;
  volatilityQuality: number;
};

export type StopLossResult = {
  price: number;
  source: string;
  buffer: number;
  riskPoints: number;
  reason: string;
};

export type TakeProfitResult = {
  tp1: number;
  tp2: number | null;
  tp3: number | null;
  source: string;
  rewardPoints: number;
  reason: string;
};

export type NoRepaintProof = {
  status: "PASS" | "WARNING";
  signalIndex: number;
  latestAllowedCandleIndex: number;
  usedMarkerIndexes: number[];
  usedContextCloseTimes: number[];
  usedSetupId: string;
  passed: boolean;
  lastAvailableIndex: number;
  maxEvidenceIndex: number;
  message: string;
};

export type ConfirmationStatus =
  | "CONFIRMED"
  | "PENDING_CONFIRMATION"
  | "EXPIRED_CONFIRMATION"
  | "INVALIDATED"
  | "REJECTED";

export type V2AsianRangeType = "COMPLETE" | "PARTIAL" | "FALLBACK";
export type V2AsianRangeWarningCode =
  | "WARNING_LARGE_ASIAN_RANGE"
  | "WARNING_PARTIAL_ASIAN_RANGE"
  | "WARNING_FALLBACK_RANGE_USED";

export type SignalCandidateDebug = {
  setupId: string;
  engine?: "LEGACY_PHASE5" | "V2_GOLDMINE";
  strategyId?: string;
  setupScore: number;
  requiredSetupScore: number;
  finalSignalScore: number | null;
  requiredSignalScore: number;
  signalScore?: number | null;
  rr?: number | null;
  requiredRR?: number;
  htfBias?: string;
  directionBias?: string;
  asianRangeDate?: string;
  sweepType?: string;
  session?: string;
  confirmationStatus: ConfirmationStatus;
  confirmationWindowRemaining: number;
  rejectionReason: string;
  nextRequiredAction: string;
  failedStage?: string;
};

export type V2AsianRangeSnapshot = {
  date: string;
  rangeType: V2AsianRangeType;
  sessionStart: number;
  sessionEnd: number;
  high: number;
  low: number;
  midpoint: number;
  rangeSize: number;
  highTime: number;
  lowTime: number;
  candlesCount: number;
  expectedCandles: number;
  coverageRatio: number;
  isComplete: boolean;
  isPartial: boolean;
  isFallback: boolean;
  warnings: V2AsianRangeWarningCode[];
  valid: boolean;
  invalidCode?: SignalRejectionCode;
  invalidReason?: string;
};

export type V2SweepSnapshot = {
  type: "ASIAN_LOW_SWEEP" | "ASIAN_HIGH_SWEEP";
  candleIndex: number;
  timestamp: number;
  price: number;
  extremePrice: number;
  rejectionStrength: number;
  session: TradingSession;
};

export type V2ConfirmationSnapshot = {
  candleIndex: number;
  timestamp: number;
  quality: number;
  reason: string;
  displacementType: "MSS" | "DISPLACEMENT";
  displacementIndex: number;
};

export type V2SilverBulletSnapshot = {
  stage:
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
  killzoneName: string;
  signalTime: number;
  liquidity: {
    type: "SSL" | "BSL";
    source: "SWING" | "EQUAL_HIGH_LOW" | "PREVIOUS_SESSION" | "ROUND_NUMBER";
    level: number;
    detectedAt: number;
  };
  sweep: {
    candleIndex: number;
    timestamp: number;
    level: number;
    extreme: number;
    type: "SSL" | "BSL";
    sweepPrice: number;
    sweepDistanceAtr: number;
    reclaimed: boolean;
    reclaimedAt: number;
    reclaimedAtIndex: number;
  };
  displacement: {
    candleIndex: number;
    timestamp: number;
    direction: "BULLISH" | "BEARISH";
    bodyRatio: number;
    closePosition: number;
    rangeAtrMultiple: number;
  };
  structureShift: {
    type: "MSS" | "CHOCH";
    brokenLevel: number;
    confirmedAt: number;
  };
  fvg: {
    type: "BULLISH_FVG" | "BEARISH_FVG";
    createdAtIndex: number;
    timestamp: number;
    low: number;
    high: number;
    bottom: number;
    top: number;
    midpoint: number;
    sizeAtr: number;
    retestedAtIndex: number;
    retestedAt: number;
    retestDepthPercent: number;
  };
  confirmation: {
    candleTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    bodyRatio: number;
    closePosition: number;
    rangeAtrMultiple: number;
  };
};

export type VwapEmaSnapshot = {
  stage: string;
  sessionName: string;
  indicators: { ema20: number; ema50: number; ema200: number; atr: number; sessionVwap: number };
  regime: {
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
    priceVsVwap: number;
    priceVsEma200: number;
    emaStack: string;
    ema50Slope: number;
  };
  pullback: {
    pullbackStartedAt: number;
    pullbackConfirmedAt: number;
    candleIndex: number;
    touchedEma: "EMA20" | "EMA50" | "EMA_ZONE";
    pullbackLow: number;
    pullbackHigh: number;
  };
  confirmation: {
    candleTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    bodyRatio: number;
    closePosition: number;
    rangeAtrMultiple: number;
  };
};

export type EmaTrendPullbackSnapshot = {
  stage:
    | "TREND_CONFIRMED"
    | "WAITING_PULLBACK"
    | "PULLBACK_DETECTED"
    | "WAITING_CONFIRMATION"
    | "CONFIRMED_SIGNAL"
    | "REJECTED"
    | "EXPIRED";
  sessionName: string;
  signalTime: number;
  indicators: { ema20: number; ema50: number; ema200: number; atr: number };
  trend: {
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
    emaStack: string;
    ema50Slope: number;
    priceDistanceFromEmaAtr: number;
  };
  pullback: {
    pullbackStartedAt: number;
    pullbackConfirmedAt: number;
    candleIndex: number;
    touchedEma: "EMA20" | "EMA50" | "EMA_ZONE";
    pullbackLow: number;
    pullbackHigh: number;
  };
  confirmation: {
    candleTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    bodyRatio: number;
    closePosition: number;
    rangeAtrMultiple: number;
  };
};

export type OrderBlockRetestSnapshot = {
  stage:
    | "STRUCTURE_BREAK_DETECTED"
    | "ORDER_BLOCK_CREATED"
    | "WAITING_RETEST"
    | "ORDER_BLOCK_RETESTED"
    | "WAITING_CONFIRMATION"
    | "CONFIRMED_SIGNAL"
    | "REJECTED"
    | "EXPIRED";
  signalTime: number;
  orderBlock: {
    type: "BULLISH_OB" | "BEARISH_OB";
    createdAt: number;
    candleIndex: number;
    top: number;
    bottom: number;
    midpoint: number;
    sizeAtr: number;
    ageCandles: number;
  };
  displacement: {
    candleTime: number;
    candleIndex: number;
    bodyRatio: number;
    rangeAtrMultiple: number;
    brokeStructureLevel: number;
  };
  retest: {
    retestedAt: number;
    candleIndex: number;
    retestPrice: number;
    retestDepthPercent: number;
  };
  confirmation: {
    candleTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    bodyRatio: number;
    closePosition: number;
    rangeAtrMultiple: number;
  };
  confluence: {
    hasFvg: boolean;
    hasLiquiditySweep: boolean;
  };
};

export type LiquiditySweepReversalSnapshot = {
  stage:
    | "LIQUIDITY_LEVEL_FOUND"
    | "SWEEP_DETECTED"
    | "RECLAIM_CONFIRMED"
    | "WAITING_CONFIRMATION"
    | "CONFIRMED_SIGNAL"
    | "REJECTED"
    | "EXPIRED";
  signalTime: number;
  liquidity: {
    type: "SSL" | "BSL";
    source: "SWING" | "EQUAL_HIGH_LOW" | "PREVIOUS_DAY" | "SESSION" | "ROUND_NUMBER";
    level: number;
    detectedAt: number;
  };
  sweep: {
    candleTime: number;
    candleIndex: number;
    sweepPrice: number;
    sweepDistanceAtr: number;
    reclaimed: boolean;
    reclaimedAt: number;
    reclaimedAtIndex: number;
  };
  confirmation: {
    candleTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    bodyRatio: number;
    closePosition: number;
    rangeAtrMultiple: number;
  };
  confluence: {
    hasMss: boolean;
    hasFvg: boolean;
    sessionName: string | null;
    htfContext: string;
  };
};

export type FvgContinuationSnapshot = {
  stage:
    | "DISPLACEMENT_DETECTED"
    | "STRUCTURE_BREAK_CONFIRMED"
    | "FVG_CREATED"
    | "WAITING_FVG_RETEST"
    | "FVG_RETESTED"
    | "WAITING_CONFIRMATION"
    | "CONFIRMED_SIGNAL"
    | "REJECTED"
    | "EXPIRED";
  sessionName: string;
  signalTime: number;
  displacement: {
    candleTime: number;
    candleIndex: number;
    direction: "BULLISH" | "BEARISH";
    open: number;
    high: number;
    low: number;
    close: number;
    bodyRatio: number;
    closePosition: number;
    rangeAtrMultiple: number;
  };
  structureBreak: {
    type: "BOS" | "CHOCH";
    brokenLevel: number;
    confirmedAt: number;
  };
  fvg: {
    type: "BULLISH_FVG" | "BEARISH_FVG";
    createdAt: number;
    createdAtIndex: number;
    top: number;
    bottom: number;
    midpoint: number;
    size: number;
    sizeAtr: number;
    retestedAt: number;
    retestedAtIndex: number;
    retestDepthPercent: number;
    invalidated: boolean;
  };
  retest: {
    candleTime: number;
    candleIndex: number;
    retestPrice: number;
    touchedZone: "TOP" | "MIDPOINT" | "BOTTOM";
    held: boolean;
  };
  confirmation: {
    candleTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    bodyRatio: number;
    closePosition: number;
    rangeAtrMultiple: number;
  };
  confluence: {
    hasLiquiditySweep: boolean;
    hasOrderBlock: boolean;
    emaTrendAligned: boolean;
  };
};

export type ProLiquidityConfluenceSnapshot = {
  stage:
    | "BIAS_CHECKED"
    | "LIQUIDITY_SWEEP_DETECTED"
    | "DISPLACEMENT_CONFIRMED"
    | "MSS_CONFIRMED"
    | "ENTRY_ZONE_FOUND"
    | "WAITING_CONFIRMATION"
    | "CONFIRMED_SIGNAL"
    | "REJECTED"
    | "EXPIRED";
  sessionName: string;
  signalTime: number;
  htfBias: {
    bias: "BULLISH" | "BEARISH" | "NEUTRAL" | "RANGING" | "UNKNOWN";
    strength: number;
    source: "MARKET_CONTEXT" | "LTF_DERIVED";
  };
  itfBias: {
    bias: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "NONE" | "UNKNOWN";
    strength: number;
    source: "MARKET_CONTEXT" | "LTF_DERIVED";
  };
  liquiditySweep: {
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
  displacement: {
    candleIndex: number;
    timestamp: number;
    direction: "BULLISH" | "BEARISH";
    bodyRatio: number;
    closePosition: number;
    rangeAtrMultiple: number;
    averageRangeMultiple: number;
  };
  structureShift: {
    type: "MSS" | "CHOCH";
    brokenLevel: number;
    confirmedAt: number;
    confirmedAtIndex: number;
  };
  entryZone: {
    type: "BULLISH_FVG" | "BEARISH_FVG" | "BULLISH_OB" | "BEARISH_OB" | "DISPLACEMENT_50" | "OTE";
    createdAt: number;
    createdAtIndex: number;
    top: number;
    bottom: number;
    midpoint: number;
    source: "FVG" | "ORDER_BLOCK" | "RETRACEMENT_50" | "OTE";
    sizeAtr: number;
    retestedAt: number;
    retestedAtIndex: number;
    retestDepthPercent: number;
  };
  confirmation: {
    candleTime: number;
    candleIndex: number;
    open: number;
    high: number;
    low: number;
    close: number;
    bodyRatio: number;
    closePosition: number;
    rangeAtrMultiple: number;
  };
  confluence: {
    score: number;
    maxScore: 8;
    confidence: number;
    biasAligned: boolean;
    sweepValid: boolean;
    displacementStrong: boolean;
    mssConfirmed: boolean;
    entryZoneFound: boolean;
    confirmationFound: boolean;
    rrValid: boolean;
    sessionVolatilityOk: boolean;
    warnings: string[];
  };
};

export type StockGuruSweepFvgObSnapshot = {
  stage:
    | "MARKET_CONTEXT"
    | "LIQUIDITY_SWEEP_DETECTED"
    | "RECLAIM_CONFIRMED"
    | "DISPLACEMENT_CONFIRMED"
    | "MSS_BOS_CONFIRMED"
    | "ENTRY_ZONE_SELECTED"
    | "ZONE_RETESTED"
    | "WAITING_CONFIRMATION"
    | "CONFIRMED_SIGNAL"
    | "REJECTED"
    | "EXPIRED";
  strategyName: "STOCK_GURU_SWEEP_FVG_OB_ENGINE";
  checkedCandles: number;
  timeframe: Timeframe;
  direction: "BUY" | "SELL";
  mode: string;
  atr: number;
  htfBias: string;
  itfBias: string;
  marketRegime: string;
  modelUsed: "REVERSAL" | "CONTINUATION";
  signalTime: number;
  liquidity: {
    levelFound: boolean;
    type: "SSL" | "BSL" | null;
    level: number | null;
    source: string | null;
    sweepFound: boolean;
    sweepIndex: number | null;
    sweepAt: number | null;
    sweepPrice: number | null;
    reclaimFound: boolean;
    reclaimIndex: number | null;
    reclaimAt: number | null;
    reclaimQuality: number;
  };
  displacement: {
    found: boolean;
    candleIndex: number | null;
    candleTime: number | null;
    strength: number;
    bodyRatio: number;
    closePosition: number;
    rangeAtrMultiple: number;
    averageRangeMultiple: number;
  };
  structure: {
    found: boolean;
    bosType: "CLOSE_BOS" | "WICK_CHOCH" | null;
    brokenLevel: number | null;
    confirmedAtIndex: number | null;
    confirmedAt: number | null;
  };
  fvg: {
    found: boolean;
    type: "BULLISH_FVG" | "BEARISH_FVG" | null;
    createdAt: number | null;
    createdAtIndex: number | null;
    low: number | null;
    high: number | null;
    midpoint: number | null;
    sizeAtr: number;
    quality: number;
  };
  orderBlock: {
    found: boolean;
    type: "BULLISH_OB" | "BEARISH_OB" | null;
    createdAt: number | null;
    createdAtIndex: number | null;
    low: number | null;
    high: number | null;
    midpoint: number | null;
    sizeAtr: number;
    quality: number;
  };
  selectedZone: {
    type: "FVG_OB_OVERLAP" | "FVG" | "OB" | "DISPLACEMENT_50" | "OTE" | null;
    low: number | null;
    high: number | null;
    midpoint: number | null;
    createdAt: number | null;
    createdAtIndex: number | null;
    retestedAt: number | null;
    retestedAtIndex: number | null;
    retestDepthPercent: number;
  };
  confirmation: {
    found: boolean;
    candleTime: number | null;
    candleIndex: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    bodyRatio: number;
    closePosition: number;
    rejectionWickRatio: number;
    pressure: "BUYERS" | "SELLERS" | null;
  };
  risk: {
    entry: number;
    stopLoss: number;
    takeProfit: number;
    rr: number;
    maxSlAtr: number;
  };
  score: {
    total: number;
    confidence: TradeSignal["confidence"];
    bonuses: string[];
    penalties: string[];
  };
  rejectionReasons: string[];
  warnings: string[];
  noRepaintProof: string;
};

export type TjrSimpleStructurePullbackSnapshot = {
  stage:
    | "MARKET_STRUCTURE"
    | "BOS_CHOCH_CONFIRMED"
    | "PULLBACK_ZONE_SELECTED"
    | "ZONE_RETESTED"
    | "WAITING_CONFIRMATION"
    | "CONFIRMED_SIGNAL"
    | "REJECTED"
    | "EXPIRED";
  strategyName: "TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE";
  checkedCandles: number;
  timeframe: Timeframe;
  direction: "BUY" | "SELL";
  mode: string;
  atr: number;
  htfBias: string;
  itfBias: string;
  marketRegime: string;
  modelUsed: "TREND_CONTINUATION" | "CHOCH_REVERSAL";
  signalTime: number;
  marketStructureFound: boolean;
  structureType: "HH_HL" | "LH_LL" | "RANGE" | "TRANSITION" | null;
  bosFound: boolean;
  chochFound: boolean;
  bosType: "CLOSE_BOS" | "WICK_CHOCH" | null;
  brokenLevel: number | null;
  structureIndex: number | null;
  structureTime: number | null;
  pullbackZoneFound: boolean;
  selectedZoneType: "DEMAND" | "SUPPLY" | "FVG" | "OB" | "EMA_ZONE" | "SR_FLIP" | "DISPLACEMENT_50" | "FVG_OB_OVERLAP" | null;
  selectedZoneLow: number | null;
  selectedZoneHigh: number | null;
  selectedZoneMidpoint: number | null;
  zoneQuality: number;
  zoneCreatedAt: number | null;
  zoneCreatedAtIndex: number | null;
  retestFound: boolean;
  retestIndex: number | null;
  retestAt: number | null;
  retestDepthPercent: number;
  confirmationFound: boolean;
  confirmationIndex: number | null;
  confirmationAt: number | null;
  confirmationBodyRatio: number;
  confirmationClosePosition: number;
  confirmationRejectionWickRatio: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rr: number;
  score: number;
  confidence: TradeSignal["confidence"];
  bonuses: string[];
  penalties: string[];
  rejectionReasons: string[];
  warnings: string[];
  noRepaintProof: string;
};

export type IctOteContinuationSnapshot = {
  stage: "IMPULSE_DETECTED" | "BOS_CONFIRMED" | "WAITING_OTE" | "OTE_TOUCHED" | "CONFIRMED_SIGNAL" | "REJECTED" | "EXPIRED";
  sessionName: string;
  signalTime: number;
  htfBias: string;
  itfBias: string;
  marketCondition: string;
  impulse: {
    direction: "BULLISH" | "BEARISH";
    startIndex: number;
    endIndex: number;
    startTime: number;
    endTime: number;
    high: number;
    low: number;
    rangeAtrMultiple: number;
    displacementBodyRatio: number;
    averageRangeMultiple: number;
  };
  structureBreak: {
    type: "BOS" | "MSS" | "CHOCH";
    brokenLevel: number;
    confirmedAt: number;
    confirmedAtIndex: number;
    strong: boolean;
  };
  liquiditySweep: {
    found: boolean;
    type: "SSL" | "BSL" | null;
    level: number | null;
    candleIndex: number | null;
    timestamp: number | null;
  };
  ote: {
    id: string;
    direction: "bullish" | "bearish";
    low: number;
    high: number;
    level62: number;
    level705: number;
    level79: number;
    touchedAt: number;
    touchedAtIndex: number;
    confirmedAt: number;
    confirmedAtIndex: number;
    status: "confirmed";
    confluence: string[];
  };
  confirmation: {
    candleTime: number;
    candleIndex: number;
    open: number;
    high: number;
    low: number;
    close: number;
    bodyRatio: number;
    closePosition: number;
    rejectionWickRatio: number;
    pressure: "BUYERS" | "SELLERS";
  };
  confluence: {
    score: number;
    maxScore: 8;
    confidence: number;
    biasAligned: boolean;
    cleanImpulse: boolean;
    sweepOrStrongBos: boolean;
    displacementStrong: boolean;
    oteTouched: boolean;
    zoneConfluence: boolean;
    confirmationRejected: boolean;
    riskValid: boolean;
    warnings: string[];
  };
};

export type V2IctIfvgReversalSnapshot = {
  stage:
    | "FVG_DETECTED"
    | "INVERSION_CONFIRMED"
    | "WAITING_ZONE_RETEST"
    | "ZONE_RETESTED"
    | "WAITING_CONFIRMATION"
    | "CONFIRMED_SIGNAL"
    | "REJECTED"
    | "EXPIRED";
  sessionName: string;
  signalTime: number;
  htfBias: string;
  itfBias: string;
  marketCondition: string;
  displacement: {
    direction: "BULLISH" | "BEARISH";
    rangeAtrMultiple: number;
    candleTime: number;
  };
  structureBreak: {
    type: "BOS" | "CHOCH";
    brokenLevel: number;
    confirmedAt: number;
  };
  ifvgZone: {
    type: "BULLISH_IFVG" | "BEARISH_IFVG";
    createdAt: number;
    createdAtIndex: number;
    top: number;
    bottom: number;
    midpoint: number;
    sizeAtr?: number;
  };
  liquiditySweep: {
    found: boolean;
    type: "SSL" | "BSL" | null;
    timestamp: number | null;
  };
  originalFvg: {
    type: "BULLISH_FVG" | "BEARISH_FVG";
    createdAt: number;
    createdAtIndex: number;
    top: number;
    bottom: number;
    midpoint: number;
  };
  retest: {
    touchedZone: boolean;
    depthPercent: number;
    candleTime: number;
  };
  confluence: {
    hasLiquiditySweep: boolean;
    hasMarketStructureShift: boolean;
    emaTrendAligned: boolean;
  };
  confirmation: {
    candleTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    bodyRatio: number;
    closePosition: number;
    rangeAtrMultiple: number;
    pressure?: "BUYERS" | "SELLERS";
  };
};

export type TradeSignal = {
  id: string;
  engine?: "LEGACY_PHASE5" | "V2_GOLDMINE";
  strategyId?: string;
  v2Direction?: "BUY" | "SELL";
  type: SignalType;
  direction: "BULLISH" | "BEARISH";
  status: SignalStatus;
  sourceSetupId: string;
  setupType: SetupType;
  strategyModel: string;
  mode: EntryMode;
  timestamp: number;
  candleIndex: number;
  confirmedAtIndex: number;
  timeframe: Timeframe;
  session: TradingSession;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number | null;
  takeProfit3: number | null;
  riskPoints: number;
  rewardPoints: number;
  rr: number;
  score: number;
  confidence: "LOW_CONFIRMED" | "MODERATE" | "STRONG" | "PREMIUM";
  positionSizeSuggestion: number;
  maxRiskAmount: number;
  invalidationLevel: number;
  reasons: string[];
  warnings: string[];
  rejectionReasons: string[];
  relatedMarkers: string[];
  noRepaintProof: NoRepaintProof;
  stopLossDetail: StopLossResult;
  takeProfitDetail: TakeProfitResult;
  scoreBreakdown: SignalScoreBreakdown;
  v2ScoreBreakdown?: V2GoldmineScoreBreakdown;
  asianRange?: V2AsianRangeSnapshot;
  sweep?: V2SweepSnapshot;
  breakout?: V2BreakoutSnapshot;
  retest?: V2RetestSnapshot;
  confirmation?: V2ConfirmationSnapshot;
  silverBullet?: V2SilverBulletSnapshot;
  vwapEma?: VwapEmaSnapshot;
  emaTrendPullback?: EmaTrendPullbackSnapshot;
  orderBlockRetest?: OrderBlockRetestSnapshot;
  liquiditySweepReversal?: LiquiditySweepReversalSnapshot;
  fvgContinuation?: FvgContinuationSnapshot;
  proLiquidityConfluence?: ProLiquidityConfluenceSnapshot;
  stockGuruSweepFvgOb?: StockGuruSweepFvgObSnapshot;
  tjrSimpleStructurePullback?: TjrSimpleStructurePullbackSnapshot;
  ictOteContinuation?: IctOteContinuationSnapshot;
  ictIfvgReversal?: V2IctIfvgReversalSnapshot;
  followThrough?: SignalFollowThroughEvaluation;
  intermarket?: IntermarketConfirmationResult;
  immutable?: boolean;
  masterDisplayStatus?: "MASTER" | "SUPPRESSED";
  masterDisplayReason?: string;
  masterParentId?: string | null;
};


export type V2BreakoutSnapshot = {
  candleIndex: number;
  timestamp: number;
  level: number;
  direction: "BULLISH" | "BEARISH";
  close: number;
  atr: number;
  momentumRatio: number;
};

export type V2RetestSnapshot = {
  candleIndex: number;
  timestamp: number;
  extremePrice: number;
  retestDelay: number;
};

export type NoTradeResult = {
  status: "NO_TRADE";
  checkedSetups: number;
  rejectionReasons: string[];
  message: string;
  nearestPossibleSetup: string | null;
  requiredForSignal: string[];
  timestamp: number | null;
};

export type EntryEngineSettings = {
  maxRiskAmount: number;
  atrBufferMultiplier: number;
  confirmationWindowCandles: number;
  maxConfirmationBars: number;
  maxSignalAgeBars: number;
};

export type EntryEngineInput = {
  candles: Candle[];
  symbol: string;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  mode: EntryMode;
  setupScanner: SetupScannerResult;
  context: MarketContextResult;
  structure: MarketStructureResult;
  candleReading: CandleReadingResult | null;
  settings?: Partial<EntryEngineSettings>;
};

export type RejectedSetup = {
  setupId: string;
  setupType: SetupType;
  setupState: MarketSetup["state"];
  direction: MarketSetup["direction"];
  triggerIndex: number | null;
  rejectionReasons: string[];
  rejectionReasonCodes: SignalRejectionCode[];
  debug?: SignalCandidateDebug;
};

export type SignalEngineAudit = {
  activeEngine?: "LEGACY_PHASE5" | "V2_GOLDMINE";
  strategyId?: string;
  activeMode: EntryMode;
  minimumScoreRequired: number;
  minimumSetupScoreRequired: number;
  minimumSignalScoreRequired: number;
  minimumRrRequired: number;
  totalCandlesScanned: number;
  totalMarkersGenerated: number;
  totalContextsGenerated: number;
  totalPhase4Setups: number;
  watchCount: number;
  setupCount: number;
  invalidatedCount: number;
  expiredCount: number;
  totalSetupsScanned: number;
  triggerSetupsFound: number;
  pendingConfirmationCount: number;
  expiredConfirmationCount: number;
  invalidatedCandidateCount: number;
  confirmedBuyCount: number;
  confirmedSellCount: number;
  rapidBuyCount: number;
  rapidSellCount: number;
  rapidSignalCount: number;
  rejectedSetupCount: number;
  lastRejectionReason: string | null;
  lastConfirmedSignal: string | null;
  topRejectionReasons: Array<{ reason: string; count: number }>;
  lastFiveTriggerSetups: string[];
  lastFiveConfirmedSignals: string[];
  noSignalMessage: string | null;
  noRepaintWarnings: string[];
  rrCalculation: string | null;
  stopLossSource: string | null;
  takeProfitSource: string | null;
  scoreBreakdown: SignalScoreBreakdown | null;
  lastCandidateDebug: SignalCandidateDebug | null;
  noRepaintValidation: "PASS" | "WARNING";
  calculationTimeMs: number;
  generationTimeMs: number;
  cacheStatus: "hit" | "miss";
  v2Goldmine?: {
    activeEngineLabel: string;
    strategyId: string;
    totalCandlesScanned: number;
    daysDetected: number;
    validAsianRanges: number;
    invalidAsianRanges: number;
    completeAsianRanges: number;
    partialAsianRanges: number;
    fallbackRanges: number;
    largeRangeWarnings: number;
    noUsableRangeRejections: number;
    confirmedSignalsUsingPartialRange: number;
    confirmedSignalsUsingLargeRange: number;
    asianHighSweeps: number;
    asianLowSweeps: number;
    rejectedSweeps: number;
    confirmationFound: number;
    confirmationExpired: number;
    confirmedBuyCount: number;
    confirmedSellCount: number;
    rejectedCount: number;
    topRejectionReasons: Array<{ reason: SignalRejectionCode; count: number }>;
    generationTimeMs: number;
  };
  v2Breakout?: {
    activeEngineLabel: string;
    strategyId: string;
    totalCandlesScanned: number;
    daysDetected: number;
    validAsianRanges: number;
    invalidAsianRanges: number;
    completeAsianRanges: number;
    partialAsianRanges: number;
    fallbackRanges: number;
    largeRangeWarnings: number;
    noUsableRangeRejections: number;
    confirmedSignalsUsingPartialRange: number;
    confirmedSignalsUsingLargeRange: number;
    bullishBreakouts: number;
    bearishBreakouts: number;
    retestsFound: number;
    retestsFailed: number;
    confirmationsFound: number;
    confirmationsExpired: number;
    confirmedBuyCount: number;
    confirmedSellCount: number;
    rejectedCount: number;
    topRejectionReasons: Array<{ reason: SignalRejectionCode; count: number }>;
    generationTimeMs: number;
  };
  v2SilverBullet?: {
    activeEngineLabel: string;
    strategyId: string;
    candlesScanned: number;
    killzoneCandles: number;
    liquidityLevelsFound: number;
    sweepsDetected: number;
    reclaimsConfirmed: number;
    displacementsFound: number;
    mssConfirmed: number;
    fvgsCreated: number;
    fvgRetestsFound: number;
    confirmationCandlesFound: number;
    sweeps: number;
    validRejections: number;
    displacements: number;
    fvgs: number;
    retests: number;
    confirmedSignals: number;
    rejectedSignals: number;
    expiredSetups: number;
    generationTimeMs: number;
    topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  };
  v2VwapEma?: {
    activeEngineLabel: string;
    strategyId: string;
    candlesScanned: number;
    sessionCandles: number;
    bullishRegimeCandles: number;
    bearishRegimeCandles: number;
    neutralRegimeCandles: number;
    pullbacksFound: number;
    validPullbacks: number;
    confirmationCandlesFound: number;
    confirmedSignals: number;
    rejectedSignals: number;
    expiredSetups: number;
    generationTimeMs: number;
    topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  };
  v2EmaTrendPullback?: {
    activeEngineLabel: string;
    strategyId: string;
    candlesScanned: number;
    sessionCandles: number;
    bullishTrendCandles: number;
    bearishTrendCandles: number;
    neutralTrendCandles: number;
    pullbacksFound: number;
    validPullbacks: number;
    confirmationCandlesFound: number;
    confirmedSignals: number;
    rejectedSignals: number;
    expiredSetups: number;
    generationTimeMs: number;
    topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  };
  v2OrderBlockRetest?: {
    activeEngineLabel: string;
    strategyId: string;
    candlesScanned: number;
    structureBreaksFound: number;
    orderBlocksCreated: number;
    validOrderBlocks: number;
    retestsFound: number;
    confirmationCandlesFound: number;
    confirmedSignals: number;
    rejectedSignals: number;
    expiredSetups: number;
    generationTimeMs: number;
    topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  };
  v2FvgContinuation?: {
    activeEngineLabel: string;
    strategyId: string;
    candlesScanned: number;
    displacementsFound: number;
    structureBreaksConfirmed: number;
    fvgsCreated: number;
    validFvgs: number;
    fvgRetestsFound: number;
    confirmationCandlesFound: number;
    confirmedSignals: number;
    rejectedSignals: number;
    expiredSetups: number;
    generationTimeMs: number;
    topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  };
  v2ProLiquidityConfluence?: {
    activeEngineLabel: string;
    strategyId: string;
    candlesScanned: number;
    htfBias: string;
    itfBias: string;
    liquidityLevelsFound: number;
    sweepsFound: number;
    displacementsFound: number;
    mssFound: number;
    entryZonesFound: number;
    fvgZonesFound: number;
    orderBlocksFound: number;
    confirmationCandlesFound: number;
    confirmedSignals: number;
    rejectedSignals: number;
    expiredSetups: number;
    generationTimeMs: number;
    topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  };
  v2StockGuruSweepFvgOb?: {
    activeEngineLabel: string;
    strategyId: string;
    candlesScanned: number;
    timeframe: string;
    mode: string;
    htfBias: string;
    itfBias: string;
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
    confirmedSignals: number;
    rejectedSignals: number;
    expiredSetups: number;
    generationTimeMs: number;
    topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  };
  v2TjrSimpleStructurePullback?: {
    activeEngineLabel: string;
    strategyId: string;
    candlesScanned: number;
    timeframe: string;
    mode: string;
    htfBias: string;
    itfBias: string;
    marketRegime: string;
    continuationModelsFound: number;
    reversalModelsFound: number;
    marketStructuresFound: number;
    bosFound: number;
    chochFound: number;
    pullbackZonesFound: number;
    retestsFound: number;
    confirmationCandlesFound: number;
    confirmedSignals: number;
    rejectedSignals: number;
    expiredSetups: number;
    generationTimeMs: number;
    topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  };
  v2IctOteContinuation?: {
    activeEngineLabel: string;
    strategyId: string;
    candlesScanned: number;
    htfBias: string;
    itfBias: string;
    marketCondition: string;
    impulsesFound: number;
    structureBreaksFound: number;
    sweepsFound: number;
    oteZonesCreated: number;
    oteTouchesFound: number;
    confluenceZonesFound: number;
    confirmationCandlesFound: number;
    confirmedSignals: number;
    rejectedSignals: number;
    expiredSetups: number;
    generationTimeMs: number;
    topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  };
  v2LiquiditySweepReversalPro?: {
    activeEngineLabel: string;
    strategyId: string;
    candlesScanned: number;
    liquidityLevelsFound: number;
    sweepsDetected: number;
    reclaimsConfirmed: number;
    confirmationCandlesFound: number;
    confirmedSignals: number;
    rejectedSignals: number;
    expiredSetups: number;
    generationTimeMs: number;
    topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  };
  v2IctIfvgReversal?: {
    activeEngineLabel: string;
    strategyId: string;
    candlesScanned: number;
    htfBias: string;
    itfBias: string;
    marketCondition: string;
    fvgsScanned: number;
    ifvgsFlipped: number;
    retestsFound: number;
    structureBreaksFound: number;
    confirmationCandlesFound: number;
    confirmedSignals: number;
    rejectedSignals: number;
    expiredSetups: number;
    generationTimeMs: number;
    topRejectionReasons: Array<{ reason: string; count: number; percentage: number }>;
  };
};


export type EntryEngineResult = {
  signals: TradeSignal[];
  activeSignals: TradeSignal[];
  signalMap: Map<string, TradeSignal>;
  pendingCandidates: SignalCandidateDebug[];
  candidateDebug: SignalCandidateDebug[];
  rejectedSetups: RejectedSetup[];
  noTrade: NoTradeResult | null;
  audit: SignalEngineAudit;
  v2AsianRanges?: V2AsianRangeSnapshot[];
  masterSelection?: MasterSignalSelectionResult;
  optionalMasterSelection?: OptionalMasterSelectionResult;
  institutionalSelection?: InstitutionalMasterSelectionResult;
};

export type SignalEvaluation = {
  setup: MarketSetup;
  signal: TradeSignal | null;
  rejectionReasons: string[];
  confirmationStatus: ConfirmationStatus;
  debug: SignalCandidateDebug;
};
