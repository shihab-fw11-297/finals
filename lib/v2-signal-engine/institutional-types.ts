import type { TradeSignal } from "../entry-engine/types";

export type TradingAppMode = "RESEARCH" | "PRODUCTION";
export type InstitutionalMode = "normal" | "strict";
export type InstitutionalAction = "MASTER_BUY" | "MASTER_SELL" | "NO_TRADE";

export type InstitutionalReasonCode =
  | "STRATEGY_NOT_PRODUCTION_ENABLED"
  | "HTF_BIAS_NOT_ALIGNED"
  | "HTF_LIQUIDITY_TARGET_TOO_CLOSE"
  | "SIGNAL_INTO_MAJOR_HTF_LEVEL"
  | "INVALID_SESSION"
  | "DEAD_ZONE_REJECTED"
  | "CONTINUATION_OUTSIDE_KILLZONE"
  | "CONTINUATION_REJECTED_OUTSIDE_KILLZONE"
  | "ASIAN_REQUIRES_HIGHER_CONFLUENCE"
  | "ASIAN_CONTINUATION_REJECTED"
  | "SESSION_ALLOWED"
  | "RESEARCH_MODE_SESSION_WARNING_ONLY"
  | "NO_VALID_LIQUIDITY_SWEEP"
  | "SWEEP_TOO_SHALLOW"
  | "SWEEP_TOO_DEEP"
  | "NO_RECLAIM_AFTER_SWEEP"
  | "LIQUIDITY_LEVEL_WEAK"
  | "DISPLACEMENT_TOO_WEAK"
  | "NO_CLOSE_BASED_MSS_OR_BOS"
  | "ONLY_WICK_CHOCH"
  | "CONFIRMATION_CANDLE_TOO_LARGE"
  | "NO_VALID_ENTRY_ZONE"
  | "ZONE_TOO_LARGE"
  | "ZONE_TOO_SMALL"
  | "ZONE_ALREADY_MITIGATED"
  | "ZONE_STALE"
  | "RETEST_TOO_LATE"
  | "ZONE_INVALIDATED"
  | "RR_BELOW_2_5"
  | "NO_STRUCTURAL_TP_TARGET"
  | "TP_INTO_HTF_OBSTACLE"
  | "STOP_TOO_WIDE"
  | "STOP_INSIDE_NOISE"
  | "STOP_NOT_STRUCTURAL"
  | "STRUCTURAL_STOP_FOUND"
  | "STOP_BEHIND_SWEEP"
  | "STOP_BEHIND_OB"
  | "STOP_BEHIND_FVG"
  | "STOP_BEHIND_SWING"
  | "HTF_BSL_TARGET_SELECTED"
  | "HTF_SSL_TARGET_SELECTED"
  | "PREVIOUS_DAY_TARGET_SELECTED"
  | "SESSION_TARGET_SELECTED"
  | "FIXED_R_FALLBACK_SELECTED"
  | "NO_VALID_2_5R_TARGET"
  | "HTF_OBSTACLE_BEFORE_TP"
  | "TARGET_TOO_STALE"
  | "BUY_INTO_HTF_BSL"
  | "SELL_INTO_HTF_SSL"
  | "HTF_OBSTACLE_TOO_CLOSE"
  | "HTF_DRAW_ON_LIQUIDITY_OPPOSES_SIGNAL"
  | "HTF_CONTEXT_ALIGNED"
  | "FACTOR_THRESHOLD_NOT_MET"
  | "BUY_SELL_CONFLICT_UNRESOLVED"
  | "DAILY_RISK_LIMIT_REACHED"
  | "WEEKLY_RISK_LIMIT_REACHED"
  | "CONSECUTIVE_LOSS_LIMIT_REACHED"
  | "MAX_DAILY_SIGNALS_REACHED"
  | "MAX_SESSION_SIGNALS_REACHED"
  | "SPREAD_TOO_HIGH"
  | "LOT_SIZE_ESTIMATE_ONLY";

export type InstitutionalFactorName =
  | "HTF Bias Alignment"
  | "Killzone / Session Timing"
  | "Liquidity Sweep Quality"
  | "Displacement / MSS Strength"
  | "Entry Zone Quality"
  | "Risk:Reward and Structural Trade Quality";

export type InstitutionalRiskState = {
  dailyLossR?: number;
  dailyLossPercent?: number;
  weeklyLossR?: number;
  weeklyLossPercent?: number;
  consecutiveLosses?: number;
  productionSignalsToday?: number;
  productionSignalsThisSession?: number;
  spreadPoints?: number;
  maxSpreadPoints?: number;
  brokerContractSize?: number;
  brokerTickValue?: number;
  commissionPerLot?: number;
  accountCurrencyConversion?: number;
  aggressiveRiskEnabled?: boolean;
};

export type InstitutionalScore = {
  factorScore: number;
  rrScore: number;
  htfContextScore: number;
  sessionScore: number;
  structuralStopScore: number;
  targetQualityScore: number;
  total: number;
};

export type InstitutionalNoRepaintProof = {
  status: "PASS";
  selectedAtIndex: number;
  maxEvidenceIndex: number;
  rawSignalId: string;
  entryFrozen: number;
  stopLossFrozen: number;
  takeProfitFrozen: number;
  rrFrozen: number;
  factorScoreFrozen: number;
  passed: true;
};

export type InstitutionalMasterSignal = TradeSignal & {
  institutionalSignalId: string;
  action: "MASTER_BUY" | "MASTER_SELL";
  selectedStrategy: string;
  structuralStopLoss: number;
  structuralTakeProfit: number;
  stopSource: string;
  targetSource: string;
  factorScore: number;
  maxFactors: 6;
  sessionThreshold: string;
  passedFactors: InstitutionalFactorName[];
  failedFactors: InstitutionalFactorName[];
  killzoneStatus: string;
  htfLiquidityContext: string;
  riskStatus: string;
  institutionalScore: InstitutionalScore;
  institutionalNoRepaintProof: InstitutionalNoRepaintProof;
  productionWarnings: string[];
};

