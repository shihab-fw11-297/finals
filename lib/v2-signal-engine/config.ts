export const ACTIVE_SIGNAL_ENGINE = "V2_GOLDMINE" as const;
export const ACTIVE_SIGNAL_ENGINE_LABEL = "V2 Goldmine Strategy Engine";
export const GOLDMINE_STRATEGY_ID = "GOLDMINE_ASIAN_SWEEP_REVERSAL" as const;
export const GOLDMINE_STRATEGY_LABEL = "Goldmine Asian Sweep Reversal";
export const BREAKOUT_STRATEGY_ID = "ASIAN_RANGE_BREAKOUT_RETEST" as const;
export const BREAKOUT_STRATEGY_LABEL = "Asian Range Breakout Retest";
export const ICT_SILVER_BULLET_STRATEGY_ID = "ICT_SILVER_BULLET" as const;
export const ICT_SILVER_BULLET_STRATEGY_LABEL = "ICT Silver Bullet";
export const VWAP_EMA_STRATEGY_ID = "VWAP_EMA_REGIME_PULLBACK" as const;
export const VWAP_EMA_STRATEGY_LABEL = "VWAP EMA Regime Pullback";
export const EMA_TREND_PULLBACK_STRATEGY_ID = "EMA_TREND_PULLBACK" as const;
export const EMA_TREND_PULLBACK_STRATEGY_LABEL = "EMA Trend Pullback";
export const LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID = "LIQUIDITY_SWEEP_REVERSAL_PRO" as const;
export const LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_LABEL = "Liquidity Sweep Reversal Pro";
export const ORDER_BLOCK_RETEST_STRATEGY_ID = "ORDER_BLOCK_RETEST_CONFIRMATION" as const;
export const ORDER_BLOCK_RETEST_STRATEGY_LABEL = "Order Block Retest Confirmation";
export const FVG_CONTINUATION_ENTRY_STRATEGY_ID = "FVG_CONTINUATION_ENTRY" as const;
export const FVG_CONTINUATION_ENTRY_STRATEGY_LABEL = "FVG Continuation Entry";
export const PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID = "PRO_LIQUIDITY_CONFLUENCE_ENGINE" as const;
export const PRO_LIQUIDITY_CONFLUENCE_STRATEGY_LABEL = "Pro Liquidity Confluence Engine";
export const ICT_OTE_CONTINUATION_STRATEGY_ID = "ICT_OTE_CONTINUATION_ENGINE" as const;
export const ICT_OTE_CONTINUATION_STRATEGY_LABEL = "ICT OTE Continuation Engine";
export const ICT_IFVG_REVERSAL_STRATEGY_ID = "ICT_IFVG_REVERSAL_ENGINE" as const;
export const ICT_IFVG_REVERSAL_STRATEGY_LABEL = "ICT IFVG Reversal Engine";
export const STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID = "STOCK_GURU_SWEEP_FVG_OB_ENGINE" as const;
export const STOCK_GURU_SWEEP_FVG_OB_STRATEGY_LABEL = "Stock Guru Sweep FVG OB Engine";
export const TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID = "TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE" as const;
export const TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_LABEL = "TJR Simple Structure Pullback Engine";


export const ICT_SILVER_BULLET_CONFIG = {
  strategyId: ICT_SILVER_BULLET_STRATEGY_ID,
  enabled: true,
  defaultTimeframe: "1m",
  allowedTimeframes: ["1m", "5m"],
  timezone: "America/New_York",
  killzones: [
    { name: "LONDON_SB", start: "03:00", end: "04:00" },
    { name: "NY_AM_SB", start: "10:00", end: "11:00" },
    { name: "NY_PM_SB", start: "14:00", end: "15:00" },
  ],
  atrPeriod: 14,
  liquidityLookback: 30,
  swingLookback: 5,
  equalHighLowToleranceAtr: 0.12,
  lookbackCandlesForLiquidity: 30,
  minSweepBufferAtr: 0.05,
  maxSweepDistanceAtr: 1.25,
  requireReclaimClose: true,
  allowNextCandleReclaim: true,
  displacementBodyRatio: 0.55,
  displacementClosePosition: 0.65,
  minDisplacementRangeAtr: 0.35,
  minDisplacementAtr: 0.35,
  requireMSS: true,
  allowChoChInsteadOfMss: true,
  fvgMinSizeAtr: 0.08,
  maxCandlesToCreateFvgAfterSweep: 5,
  maxCandlesToReturnToFvg: 10,
  maxCandlesToConfirmAfterFvgTap: 4,
  fvgEntryZone: "MIDPOINT_OR_BETTER",
  confirmationBodyRatio: 0.40,
  confirmationClosePosition: 0.60,
  minConfirmationRangeAtr: 0.20,
  minRR: 1.5,
  preferredRR: 2.0,
  minSignalScore: 65,
  slAtrBuffer: 0.20,
  maxSlAtrMultiple: 2.8,
  maxSignalsPerKillzone: 1,
  maxSignalsPerDay: 3,
} as const;

export const VWAP_EMA_REGIME_PULLBACK_CONFIG = {
  strategyId: VWAP_EMA_STRATEGY_ID,
  enabled: true,
  timeframe: "5m",
  emaFastPeriod: 20,
  emaMidPeriod: 50,
  emaRegimePeriod: 200,
  atrPeriod: 14,
  useSessionVWAP: true,
  sessionTimezone: "America/New_York",
  vwapSessionStart: "00:00",
  allowedSessions: [
    { name: "LONDON", start: "03:00", end: "06:00" },
    { name: "NY_AM", start: "08:30", end: "11:30" },
    { name: "OVERLAP", start: "08:00", end: "11:00" },
  ],
  maxDistanceFromVwapAtr: 2.5,
  minDistanceFromVwapAtr: 0.1,
  pullbackZoneAtrBuffer: 0.25,
  maxPullbackCandles: 8,
  confirmationBodyRatio: 0.45,
  confirmationClosePosition: 0.60,
  minConfirmationAtr: 0.25,
  minRR: 1.5,
  minSignalScore: 60,
  slAtrBuffer: 0.20,
  maxSlAtrMultiple: 2.5,
  maxSignalsPerSession: 2,
  maxSignalsPerDay: 5,
} as const;

export const EMA_TREND_PULLBACK_CONFIG = {
  strategyId: EMA_TREND_PULLBACK_STRATEGY_ID,
  enabled: true,
  defaultTimeframe: "5m",
  emaFastPeriod: 20,
  emaMidPeriod: 50,
  emaSlowPeriod: 200,
  atrPeriod: 14,
  allowedSessions: [
    { name: "LONDON", start: "03:00", end: "06:00", timezone: "America/New_York" },
    { name: "NY_AM", start: "08:30", end: "11:30", timezone: "America/New_York" },
    { name: "OVERLAP", start: "08:00", end: "11:00", timezone: "America/New_York" },
  ],
  requireSession: true,
  pullbackZoneAtrBuffer: 0.30,
  maxPullbackCandles: 8,
  minTrendStrengthAtr: 0.20,
  maxEmaDistanceAtr: 3.0,
  confirmationBodyRatio: 0.45,
  confirmationClosePosition: 0.60,
  minConfirmationRangeAtr: 0.25,
  minRR: 1.5,
  minSignalScore: 58,
  slAtrBuffer: 0.20,
  maxSlAtrMultiple: 2.5,
  maxSignalsPerSession: 2,
  maxSignalsPerDay: 5,
} as const;

export const LIQUIDITY_SWEEP_REVERSAL_PRO_CONFIG = {
  strategyId: LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID,
  enabled: true,
  defaultTimeframe: "5m",
  atrPeriod: 14,
  swingLookback: 5,
  liquidityLookback: 40,
  equalHighLowToleranceAtr: 0.12,
  minSweepBufferAtr: 0.05,
  maxSweepDistanceAtr: 1.2,
  requireCloseBackInside: true,
  allowNextCandleReclaim: true,
  confirmationWindow: 4,
  confirmationBodyRatio: 0.45,
  confirmationClosePosition: 0.60,
  minConfirmationRangeAtr: 0.25,
  requireMSS: false,
  allowMssBonus: true,
  allowFvgBonus: true,
  minRR: 1.5,
  minSignalScore: 60,
  slAtrBuffer: 0.20,
  maxSlAtrMultiple: 2.8,
  allowedSessions: [
    { name: "LONDON", start: "03:00", end: "06:00", timezone: "America/New_York" },
    { name: "NY_AM", start: "08:30", end: "11:30", timezone: "America/New_York" },
    { name: "OVERLAP", start: "08:00", end: "11:00", timezone: "America/New_York" },
  ],
  requireSession: false,
  sessionWarningOnly: true,
  maxSignalsPerDay: 6,
} as const;

export const ORDER_BLOCK_RETEST_CONFIG = {
  strategyId: ORDER_BLOCK_RETEST_STRATEGY_ID,
  enabled: true,
  defaultTimeframe: "5m",
  atrPeriod: 14,
  swingLookback: 5,
  displacementBodyRatio: 0.55,
  minDisplacementAtr: 0.40,
  orderBlockMaxAgeCandles: 80,
  orderBlockMinSizeAtr: 0.10,
  orderBlockMaxSizeAtr: 1.50,
  retestToleranceAtr: 0.15,
  maxRetestCandles: 40,
  confirmationBodyRatio: 0.45,
  confirmationClosePosition: 0.60,
  minConfirmationRangeAtr: 0.25,
  minRR: 1.5,
  minSignalScore: 62,
  slAtrBuffer: 0.20,
  maxSlAtrMultiple: 2.8,
  requireStructureBreak: true,
  allowFvgBonus: true,
  allowLiquiditySweepBonus: true,
  maxSignalsPerSession: 2,
  maxSignalsPerDay: 5,
} as const;

export const FVG_CONTINUATION_ENTRY_CONFIG = {
  strategyId: FVG_CONTINUATION_ENTRY_STRATEGY_ID,
  enabled: true,
  defaultTimeframe: "5m",
  allowedTimeframes: ["1m", "5m", "15m", "30m"],
  atrPeriod: 14,
  swingLookback: 5,
  structureLookback: 20,
  displacementBodyRatio: 0.55,
  displacementClosePosition: 0.65,
  minDisplacementRangeAtr: 0.40,
  requireStructureBreak: true,
  allowChoChInsteadOfBOS: true,
  fvgMinSizeAtr: 0.08,
  fvgMaxSizeAtr: 2.0,
  maxFvgAgeCandles: 40,
  fvgEntryZone: "MIDPOINT_OR_BETTER",
  retestToleranceAtr: 0.10,
  maxCandlesToReturnToFvg: 12,
  confirmationBodyRatio: 0.42,
  confirmationClosePosition: 0.60,
  minConfirmationRangeAtr: 0.25,
  confirmationWindow: 4,
  minRR: 1.5,
  preferredRR: 2.0,
  minSignalScore: 62,
  slAtrBuffer: 0.20,
  maxSlAtrMultiple: 2.8,
  allowedSessions: [
    { name: "LONDON", start: "03:00", end: "06:00", timezone: "America/New_York" },
    { name: "NY_AM", start: "08:30", end: "11:30", timezone: "America/New_York" },
    { name: "OVERLAP", start: "08:00", end: "11:00", timezone: "America/New_York" },
  ],
  requireSession: false,
  sessionWarningOnly: true,
  allowLiquiditySweepBonus: true,
  allowOrderBlockBonus: true,
  allowEmaTrendBonus: true,
  maxSignalsPerSession: 2,
  maxSignalsPerDay: 5,
} as const;

export const PRO_LIQUIDITY_CONFLUENCE_CONFIG = {
  strategyId: PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID,
  enabled: true,
  defaultTimeframe: "5m",
  allowedTimeframes: ["1m", "5m", "15m", "30m"],
  atrPeriod: 14,
  liquidityLookback: 40,
  swingLookback: 5,
  structureLookback: 24,
  displacementBodyRatio: 0.55,
  displacementClosePosition: 0.65,
  minDisplacementRangeAtr: 0.35,
  minDisplacementRangeMultiple: 1.05,
  minSweepBufferAtr: 0.04,
  maxSweepDistanceAtr: 2.0,
  maxCandlesToDisplaceAfterSweep: 5,
  maxCandlesToMssAfterDisplacement: 5,
  fvgMinSizeAtr: 0.06,
  fvgMaxSizeAtr: 2.25,
  orderBlockMaxLookback: 8,
  retracementZoneAtrBuffer: 0.12,
  retestToleranceAtr: 0.12,
  maxCandlesToReturnToZone: 12,
  confirmationWindow: 4,
  confirmationBodyRatio: 0.40,
  confirmationClosePosition: 0.60,
  minConfirmationRangeAtr: 0.20,
  minRRByMode: {
    easy: 1.2,
    testing: 1.2,
    normal: 1.5,
    strict: 2.0,
    professional: 2.0,
  },
  minFactorScoreByMode: {
    easy: 5,
    testing: 5,
    normal: 6,
    strict: 7,
    professional: 7,
  },
  preferredRR: 2.0,
  maxScore: 8,
  slAtrBuffer: 0.20,
  maxSlAtrMultiple: 4.5,
  strongOppositeBiasThreshold: 80,
  allowNeutralBiasWithStrongSequence: true,
  allowedSessions: [
    { name: "LONDON", start: "07:00", end: "11:00", timezone: "UTC" },
    { name: "NEW_YORK", start: "12:00", end: "16:00", timezone: "UTC" },
    { name: "OVERLAP", start: "12:00", end: "16:00", timezone: "UTC" },
  ],
  sessionWarningOnly: true,
  maxSignalsPerSession: 3,
  maxSignalsPerDay: 6,
} as const;

export const STOCK_GURU_SWEEP_FVG_OB_CONFIG = {
  strategyId: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
  enabled: true,
  defaultTimeframe: "5m",
  allowedTimeframes: ["1m", "5m", "15m", "30m"],
  atrPeriod: 14,
  liquidityLookback: 50,
  structureLookback: 24,
  swingLookback: 5,
  averageRangePeriod: 10,
  orderBlockMaxLookback: 10,
  maxCandlesToReclaim: 2,
  maxCandlesToDisplaceAfterReclaim: 5,
  maxCandlesToBosAfterDisplacement: 5,
  maxCandlesToCreateFvgAfterDisplacement: 3,
  maxConfirmationCandlesAfterRetest: 4,
  equalHighLowToleranceAtr: 0.12,
  displacementBodyRatio: 0.55,
  displacementClosePosition: 0.65,
  minAverageRangeMultiple: 1.05,
  fvgMaxSizeAtr: 1.5,
  orderBlockMinSizeAtr: 0.08,
  orderBlockMaxSizeAtr: 1.8,
  zoneInvalidationAtr: 0.10,
  retestToleranceAtr: 0.10,
  preferredRR: 2.0,
  strongOppositeBiasThreshold: 80,
  minSweepAtrByMode: {
    easy: 0.03,
    testing: 0.03,
    normal: 0.04,
    strict: 0.04,
    professional: 0.04,
  },
  maxSweepAtrByMode: {
    easy: 2.0,
    testing: 2.0,
    normal: 1.5,
    strict: 1.5,
    professional: 1.5,
  },
  minDisplacementAtrByMode: {
    easy: 0.35,
    testing: 0.35,
    normal: 0.40,
    strict: 0.50,
    professional: 0.50,
  },
  fvgMinSizeAtrByMode: {
    easy: 0.06,
    testing: 0.06,
    normal: 0.08,
    strict: 0.08,
    professional: 0.08,
  },
  retestWindowByMode: {
    easy: 16,
    testing: 16,
    normal: 12,
    strict: 8,
    professional: 8,
  },
  confirmationBodyRatioByMode: {
    easy: 0.40,
    testing: 0.40,
    normal: 0.45,
    strict: 0.45,
    professional: 0.45,
  },
  minRRByMode: {
    easy: 1.2,
    testing: 1.2,
    normal: 1.5,
    strict: 2.0,
    professional: 2.0,
  },
  minSignalScoreByMode: {
    easy: 58,
    testing: 58,
    normal: 65,
    strict: 75,
    professional: 75,
  },
  slAtrBufferByMode: {
    easy: 0.15,
    testing: 0.15,
    normal: 0.20,
    strict: 0.25,
    professional: 0.25,
  },
  maxSlAtrByMode: {
    easy: 3.5,
    testing: 3.5,
    normal: 3.0,
    strict: 2.5,
    professional: 2.5,
  },
  allowedSessions: [
    { name: "LONDON", start: "07:00", end: "11:00", timezone: "UTC" },
    { name: "NEW_YORK", start: "12:00", end: "16:00", timezone: "UTC" },
    { name: "OVERLAP", start: "12:00", end: "16:00", timezone: "UTC" },
  ],
  maxSignalsPerSession: 3,
  maxSignalsPerDay: 6,
} as const;

export const TJR_SIMPLE_STRUCTURE_PULLBACK_CONFIG = {
  strategyId: TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID,
  enabled: true,
  defaultTimeframe: "5m",
  allowedTimeframes: ["1m", "5m", "15m", "30m"],
  atrPeriod: 14,
  emaFastPeriod: 20,
  emaMidPeriod: 50,
  emaSlowPeriod: 200,
  swingLookback: 4,
  structureLookback: 24,
  zoneLookback: 10,
  fvgMinSizeAtr: 0.06,
  fvgMaxSizeAtr: 1.5,
  orderBlockMinSizeAtr: 0.08,
  orderBlockMaxSizeAtr: 1.8,
  retestToleranceAtr: 0.10,
  zoneInvalidationAtr: 0.10,
  maxZoneDistanceAtr: 3.0,
  maxTouches: 3,
  minConfirmationRangeAtr: 0.20,
  preferredRR: 1.5,
  strictPreferredRR: 2.0,
  strongOppositeBiasThreshold: 80,
  lowVolatilityAtr: 0.03,
  choppyFlipThreshold: 10,
  retestWindowByMode: {
    easy: 20,
    testing: 20,
    normal: 14,
    strict: 10,
    professional: 10,
  },
  confirmationBodyRatioByMode: {
    easy: 0.35,
    testing: 0.35,
    normal: 0.40,
    strict: 0.45,
    professional: 0.45,
  },
  minRRByMode: {
    easy: 1.2,
    testing: 1.2,
    normal: 1.5,
    strict: 2.0,
    professional: 2.0,
  },
  minSignalScoreByMode: {
    easy: 55,
    testing: 55,
    normal: 60,
    strict: 70,
    professional: 70,
  },
  slAtrBufferByMode: {
    easy: 0.15,
    testing: 0.15,
    normal: 0.20,
    strict: 0.25,
    professional: 0.25,
  },
  maxSlAtrByMode: {
    easy: 3.5,
    testing: 3.5,
    normal: 3.0,
    strict: 2.5,
    professional: 2.5,
  },
  allowedSessions: [
    { name: "LONDON", start: "07:00", end: "11:00", timezone: "UTC" },
    { name: "NEW_YORK", start: "12:00", end: "16:00", timezone: "UTC" },
    { name: "OVERLAP", start: "12:00", end: "16:00", timezone: "UTC" },
  ],
  maxSignalsPerSession: 3,
  maxSignalsPerDay: 6,
} as const;

export const ICT_OTE_CONTINUATION_CONFIG = {
  strategyId: ICT_OTE_CONTINUATION_STRATEGY_ID,
  enabled: true,
  defaultTimeframe: "5m",
  allowedTimeframes: ["1m", "5m", "15m", "30m"],
  atrPeriod: 14,
  averageRangePeriod: 10,
  swingLookback: 3,
  structureLookback: 24,
  impulseOriginLookback: 12,
  maxImpulseAgeCandles: 36,
  minImpulseRangeAtr: 1.20,
  minDisplacementRangeAtr: 0.55,
  minAverageRangeMultiple: 1.10,
  displacementBodyRatio: 0.55,
  displacementClosePosition: 0.65,
  strongBosBufferAtr: 0.10,
  oteLevel62: 0.62,
  oteLevel705: 0.705,
  oteLevel79: 0.79,
  retestToleranceAtr: 0.08,
  deepRetracementBufferAtr: 0.15,
  maxCandlesToTouchOte: 20,
  confirmationWindow: 4,
  confirmationBodyRatio: 0.35,
  confirmationClosePosition: 0.55,
  minConfirmationRangeAtr: 0.20,
  minRejectionWickRatio: 0.12,
  slAtrBuffer: 0.20,
  maxSlAtrMultiple: 4.0,
  preferredRR: 2.0,
  minRRByMode: {
    easy: 1.2,
    testing: 1.2,
    normal: 1.5,
    strict: 2.0,
    professional: 2.0,
  },
  minFactorScoreByMode: {
    easy: 5,
    testing: 5,
    normal: 6,
    strict: 7,
    professional: 7,
  },
  maxScore: 8,
  strongOppositeBiasThreshold: 80,
  maxSignalsPerSession: 3,
  maxSignalsPerDay: 6,
} as const;

export type IctSilverBulletConfig = typeof ICT_SILVER_BULLET_CONFIG;
export type VwapEmaRegimePullbackConfig = typeof VWAP_EMA_REGIME_PULLBACK_CONFIG;
export type EmaTrendPullbackConfig = typeof EMA_TREND_PULLBACK_CONFIG;
export type LiquiditySweepReversalProConfig = typeof LIQUIDITY_SWEEP_REVERSAL_PRO_CONFIG;
export type OrderBlockRetestConfig = typeof ORDER_BLOCK_RETEST_CONFIG;
export type FvgContinuationEntryConfig = typeof FVG_CONTINUATION_ENTRY_CONFIG;
export type ProLiquidityConfluenceConfig = typeof PRO_LIQUIDITY_CONFLUENCE_CONFIG;
export type StockGuruSweepFvgObConfig = typeof STOCK_GURU_SWEEP_FVG_OB_CONFIG;
export type TjrSimpleStructurePullbackConfig = typeof TJR_SIMPLE_STRUCTURE_PULLBACK_CONFIG;
export type IctOteContinuationConfig = typeof ICT_OTE_CONTINUATION_CONFIG;

export const ASIAN_RANGE_CONFIG = {
  strictCompleteRangeRequired: false,
  allowPartialAsianRange: true,
  allowLargeAsianRange: true,
  largeRangeIsWarningOnly: true,
  incompleteRangeIsWarningOnly: true,
  minCoverageRatio: 0.35,
  fallbackLookbackHours: 6,
} as const;

export type AsianRangeConfig = typeof ASIAN_RANGE_CONFIG;

/**
 * Single unified config for the Asian Range Breakout Retest strategy.
 */
export const ASIAN_BREAKOUT_CONFIG = {
  minSignalScore: 60,
  minRR: 1.5,
  confirmationWindow: 6,

  requireAsianRange: true,
  requireBreakoutClose: true,
  requireRetest: true,
  requireMomentumBreakout: true,

  breakoutBodyMinRatio: 0.45,
  breakoutCloseBufferAtr: 0.05,
  retestToleranceAtr: 0.15,
  retestWindowCandles: 8,

  atrBufferMultiplier: 0.10,
  maxSignalsPerDay: 2,

  tradeLondon: true,
  tradeNewYork: true,
  allowOutsideSessionSignals: false,

  allowFixedRRFallback: true,
} as const;

export type AsianBreakoutConfig = typeof ASIAN_BREAKOUT_CONFIG;

/**
 * Single unified config for the Goldmine Asian Sweep Reversal strategy.
 * No modes — one practical rule set for all signal generation.
 */
export const GOLDMINE_CONFIG = {
  minSignalScore: 55,
  minRR: 1.5,
  confirmationWindow: 6,
  requireAsianRange: true,
  requireSweep: true,
  requireRejection: true,

  // MSS is preferred but not always required
  requireMSS: false,
  allowDisplacementInsteadOfMSS: true,

  // TP logic
  allowAsianMidpointAsTP1: true,
  allowAsianHighLowAsTP2: true,
  allowLiquidityTargetAsTP3: true,
  allowFixedRRFallback: true,

  // session
  tradeLondon: true,
  tradeNewYork: true,
  allowOutsideSessionSignals: false,

  // risk
  atrBufferMultiplier: 0.10,
  maxConfirmationCandles: 6,
  maxSignalsPerDay: 3,
} as const;

export type GoldmineConfig = typeof GOLDMINE_CONFIG;

export const ICT_IFVG_REVERSAL_CONFIG = {
  strategyId: ICT_IFVG_REVERSAL_STRATEGY_ID,
  enabled: true,
  defaultTimeframe: "5m",
  allowedTimeframes: ["1m", "5m", "15m", "30m"],
  atrPeriod: 14,
  swingLookback: 5,
  structureLookback: 20,
  displacementBodyRatio: 0.55,
  displacementClosePosition: 0.65,
  minDisplacementRangeAtr: 0.40,
  requireStructureBreak: false,
  allowChoChInsteadOfBOS: true,
  fvgMinSizeAtr: 0.08,
  fvgMaxSizeAtr: 2.0,
  maxFvgAgeCandles: 40,
  retestToleranceAtr: 0.10,
  atrInversionBufferMultiplier: 0.04,
  maxCandlesToReturnToZone: 15,
  confirmationBodyRatio: 0.42,
  confirmationClosePosition: 0.60,
  minConfirmationRangeAtr: 0.25,
  confirmationWindow: 4,
  minRR: 1.5,
  preferredRR: 2.0,
  minSignalScore: 62,
  slAtrBuffer: 0.20,
  maxSlAtrMultiple: 2.8,
  requireSession: false,
  sessionWarningOnly: true,
  maxSignalsPerDay: 5,
} as const;

export type IctIfvgReversalConfig = typeof ICT_IFVG_REVERSAL_CONFIG;

export const UTC_SESSIONS = {
  asian: { startHour: 0, endHour: 7 },
  london: { startHour: 7, endHour: 11 },
  newYork: { startHour: 12, endHour: 16 },
} as const;
