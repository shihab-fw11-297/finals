import type { Candle, Timeframe } from "../candles/types";
import type { SignalRejectionCode, V2AsianRangeType, V2AsianRangeWarningCode } from "../entry-engine/types";
import type { MarketContextResult, TradingSession } from "../market-context/types";
import type { MarketStructureResult } from "../market-structure/types";

export type GoldmineDirection = "BUY" | "SELL";
export type GoldmineSweepType = "ASIAN_LOW_SWEEP" | "ASIAN_HIGH_SWEEP";
export type GoldmineDisplacementType = "MSS" | "DISPLACEMENT";

export type GoldmineSignalStage =
  | "CANDIDATE"
  | "SWEEP_DETECTED"
  | "REJECTION_CONFIRMED"
  | "WAITING_CONFIRMATION"
  | "CONFIRMED_SIGNAL"
  | "REJECTED"
  | "EXPIRED";

export type GoldmineAsianRange = {
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
  startIndex: number;
  endIndex: number;
  atrReference: number;
  valid: boolean;
  invalidCode?: SignalRejectionCode;
  invalidReason?: string;
};

export type GoldmineSweep = {
  type: GoldmineSweepType;
  direction: GoldmineDirection;
  candleIndex: number;
  timestamp: number;
  price: number;
  extremePrice: number;
  rejectionStrength: number;
  wickRatio: number;
  closedBackInsideRange: boolean;
  session: TradingSession;
};

export type GoldmineDisplacement = {
  type: GoldmineDisplacementType;
  candleIndex: number;
  timestamp: number;
  quality: number;
  reason: string;
  markerId: string | null;
};

export type GoldmineConfirmation = {
  candleIndex: number;
  timestamp: number;
  quality: number;
  reason: string;
  candleClose: number;
};

export type GoldmineScoreBreakdown = {
  asianRangeQuality: number;
  sweepQuality: number;
  rejectionCandleQuality: number;
  displacementMssQuality: number;
  confirmationCandleQuality: number;
  rrTargetQuality: number;
  sessionQuality: number;
  volatilityQuality: number;
};

export type V2GoldmineSettings = {
  maxRiskAmount: number;
  atrPeriod: number;
  stopAtrBufferMultiplier: number;
  currentMode?: string;
  mode?: string;
  sessionHours?: {
    asianStart: number;
    asianEnd: number;
    londonStart: number;
    londonEnd: number;
    newYorkStart: number;
    newYorkEnd: number;
  };
};

/** V2 Goldmine input — no mode. Uses GOLDMINE_CONFIG directly. */
export type V2GoldmineInput = {
  candles: Candle[];
  symbol: string;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  structure: MarketStructureResult;
  context: MarketContextResult;
  settings?: Partial<V2GoldmineSettings>;
};

export type V2GoldmineRejectedCandidate = {
  id: string;
  code: SignalRejectionCode;
  reason: string;
  date: string | null;
  direction: GoldmineDirection | "NONE";
  sweepType: GoldmineSweepType | "NONE";
  candleIndex: number | null;
  timestamp: number | null;
  stage: GoldmineSignalStage;
  nextRequiredAction: string;
  failedStage?: string;
};

export type AsianBreakoutSignalStage =
  | "CANDIDATE"
  | "BREAKOUT_DETECTED"
  | "WAITING_RETEST"
  | "RETEST_CONFIRMED"
  | "WAITING_CONFIRMATION"
  | "CONFIRMED_SIGNAL"
  | "REJECTED"
  | "EXPIRED";

export type V2AsianBreakoutRejectedCandidate = {
  id: string;
  code: SignalRejectionCode;
  reason: string;
  date: string | null;
  direction: GoldmineDirection | "NONE";
  candleIndex: number | null;
  timestamp: number | null;
  stage: AsianBreakoutSignalStage;
  nextRequiredAction?: string;
  failedStage?: string;
};

export type V2GoldmineAudit = {
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
  candidates: number;
  asianHighSweeps: number;
  asianLowSweeps: number;
  rejectedSweeps: number;
  rejectionConfirmed: number;
  waitingConfirmations: number;
  confirmationFound: number;
  confirmationExpired: number;
  confirmedBuyCount: number;
  confirmedSellCount: number;
  rejectedCount: number;
  topRejectionReasons: Array<{ reason: SignalRejectionCode; count: number }>;
  generationTimeMs: number;
};

export type IctSilverBulletStage =
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

export type VwapEmaStage =
  | "REGIME_CONFIRMED"
  | "WAITING_PULLBACK"
  | "PULLBACK_DETECTED"
  | "WAITING_CONFIRMATION"
  | "CONFIRMED_SIGNAL"
  | "REJECTED"
  | "EXPIRED";

export type LiquiditySweepReversalProStage =
  | "LIQUIDITY_LEVEL_FOUND"
  | "SWEEP_DETECTED"
  | "RECLAIM_CONFIRMED"
  | "WAITING_CONFIRMATION"
  | "CONFIRMED_SIGNAL"
  | "REJECTED"
  | "EXPIRED";
