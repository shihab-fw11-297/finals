export {
  ACTIVE_SIGNAL_ENGINE,
  ACTIVE_SIGNAL_ENGINE_LABEL,
  GOLDMINE_CONFIG,
  GOLDMINE_STRATEGY_ID,
  GOLDMINE_STRATEGY_LABEL,
  BREAKOUT_STRATEGY_ID,
  BREAKOUT_STRATEGY_LABEL,
  ASIAN_RANGE_CONFIG,
  ASIAN_BREAKOUT_CONFIG,
  ICT_SILVER_BULLET_CONFIG,
  ICT_SILVER_BULLET_STRATEGY_ID,
  ICT_SILVER_BULLET_STRATEGY_LABEL,
  VWAP_EMA_REGIME_PULLBACK_CONFIG,
  VWAP_EMA_STRATEGY_ID,
  VWAP_EMA_STRATEGY_LABEL,
  EMA_TREND_PULLBACK_CONFIG,
  EMA_TREND_PULLBACK_STRATEGY_ID,
  EMA_TREND_PULLBACK_STRATEGY_LABEL,
  LIQUIDITY_SWEEP_REVERSAL_PRO_CONFIG,
  LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID,
  LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_LABEL,
  ORDER_BLOCK_RETEST_CONFIG,
  ORDER_BLOCK_RETEST_STRATEGY_ID,
  ORDER_BLOCK_RETEST_STRATEGY_LABEL,
  FVG_CONTINUATION_ENTRY_CONFIG,
  FVG_CONTINUATION_ENTRY_STRATEGY_ID,
  FVG_CONTINUATION_ENTRY_STRATEGY_LABEL,
  PRO_LIQUIDITY_CONFLUENCE_CONFIG,
  PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID,
  PRO_LIQUIDITY_CONFLUENCE_STRATEGY_LABEL,
  ICT_OTE_CONTINUATION_CONFIG,
  ICT_OTE_CONTINUATION_STRATEGY_ID,
  ICT_OTE_CONTINUATION_STRATEGY_LABEL,
  ICT_IFVG_REVERSAL_CONFIG,
  ICT_IFVG_REVERSAL_STRATEGY_ID,
  ICT_IFVG_REVERSAL_STRATEGY_LABEL,
  STOCK_GURU_SWEEP_FVG_OB_CONFIG,
  STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
  STOCK_GURU_SWEEP_FVG_OB_STRATEGY_LABEL,
  TJR_SIMPLE_STRUCTURE_PULLBACK_CONFIG,
  TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID,
  TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_LABEL,
} from "./config";
export type { GoldmineConfig, AsianBreakoutConfig, AsianRangeConfig, IctSilverBulletConfig, VwapEmaRegimePullbackConfig, EmaTrendPullbackConfig, LiquiditySweepReversalProConfig, OrderBlockRetestConfig, FvgContinuationEntryConfig, ProLiquidityConfluenceConfig, StockGuruSweepFvgObConfig, TjrSimpleStructurePullbackConfig, IctOteContinuationConfig, IctIfvgReversalConfig } from "./config";
export { calculateATR, calculateEMA, calculateSessionVWAP, calculateSlope, detectEqualHighs, detectEqualLows, detectFVG, detectMSS, detectSwingHigh, detectSwingLow, getKillzone } from "./indicators";

export {
  calculateAsianRanges,
  clearV2GoldmineCache,
  detectGoldmineSweep,
  generateV2GoldmineSignals,
  isGoldmineConfirmation,
} from "./goldmine-asian-sweep";
export {
  clearV2AsianBreakoutCache,
  generateV2AsianBreakoutSignals,
} from "./asian-breakout-retest";
export {
  clearV2Cache,
  generateV2Signals,
} from "./coordinator";
export {
  SIGNAL_FOLLOW_THROUGH_ENGINE,
  attachSignalFollowThrough,
  evaluateSignalFollowThrough,
  trackSignalPostTradeFollowThrough,
} from "./signal-follow-through-engine";
export {
  buildIntermarketState,
  calculateEma as calculateIntermarketEma,
  deriveFredDailyBias,
  detectDisplacement,
  detectMomentum as detectIntermarketMomentum,
  detectSimpleBOS,
  detectTrend as detectIntermarketTrend,
  evaluateIntermarketConfirmation,
} from "./intermarket-confirmation-gate";
export type {
  ExpectedMoveSide,
  FollowThroughChartOverlay,
  FollowThroughDirection,
  FollowThroughGrade,
  FollowThroughLevel,
  FollowThroughNoRepaintProof,
  FollowThroughReasonCode,
  HistoricalSignalStatsInput,
  LiquidityRunway,
  PostTradeFollowThroughAnalytics,
  SignalFollowThroughDebug,
  SignalFollowThroughEvaluation,
} from "./signal-follow-through-engine";
export { clearIctSilverBulletCache, generateIctSilverBulletSignals } from "./ict-silver-bullet";
export { clearVwapEmaRegimePullbackCache, generateVwapEmaRegimePullbackSignals } from "./vwap-ema-regime-pullback";
export { clearEmaTrendPullbackCache, generateEmaTrendPullbackSignals } from "./ema-trend-pullback";
export { clearLiquiditySweepReversalProCache, generateLiquiditySweepReversalProSignals } from "./liquidity-sweep-reversal-pro";
export { clearOrderBlockRetestCache, generateOrderBlockRetestSignals } from "./order-block-retest";
export { clearFvgContinuationEntryCache, generateFvgContinuationEntrySignals } from "./fvg-continuation-entry";
export { clearProLiquidityConfluenceCache, generateProLiquidityConfluenceSignals } from "./pro-liquidity-confluence-engine";
export { clearStockGuruSweepFvgObCache, generateStockGuruSweepFvgObSignals } from "./stock-guru-sweep-fvg-ob-engine";
export { clearTjrSimpleStructurePullbackCache, generateTjrSimpleStructurePullbackSignals } from "./tjr-simple-structure-pullback-engine";
export { calculateOTEZone, clearIctOteContinuationCache, detectImpulseLeg, detectOTERejection, detectOTETouch, findNextLiquidityTarget, generateIctOteContinuationSignals, validateOTERisk } from "./ict-ote-continuation-engine";
export type { IctOteZone } from "./ict-ote-continuation-engine";
export { clearIctIfvgReversalCache, generateIctIfvgReversalSignals } from "./ict-ifvg-reversal";
export {
  MASTER_SIGNAL_SELECTOR_ID,
  applyCooldownAndTradeLimits,
  buildMasterDebug,
  buildMasterNoRepaintProof,
  calculateConfirmationQuality,
  calculateConfluenceScore,
  calculateMasterScore,
  calculateRRQuality,
  calculateStopQuality,
  detectOppositeSignalConflicts,
  getMasterDisplaySignals,
  getPriceGroupingThreshold,
  getStrategyPriority,
  getTimeGroupingWindow,
  groupSimilarSignals,
  normalizeStrategyScore,
  resolveConflictGroup,
  selectBestSignalFromGroup,
  selectMasterSignals,
  suppressDuplicateSignals,
} from "./master-signal-selector";
export type {
  MasterConflictSignal,
  MasterDisplayMode,
  MasterFinalSignal,
  MasterMode,
  MasterNoRepaintProof,
  MasterSelectorDebug,
  MasterSelectorOptions,
  MasterSignalGroup,
  MasterSignalSelectionResult,
  MasterSuppressedSignal,
  SelectMasterSignalsInput,
} from "./master-signal-selector";
export {
  OPTIONAL_MASTER_SIGNAL_SELECTOR_ID,
  getOptionalMasterDisplaySignals,
  selectOptionalMasterSignals,
} from "./optional-master-signal-selector";
export type {
  ConflictSignal,
  MasterSelectedSignal,
  MasterSelectorDebug as OptionalMasterSelectorDebug,
  OptionalMasterNoRepaintProof,
  OptionalMasterSelectionResult,
  OptionalMasterSelectorOptions,
  SelectOptionalMasterSignalsInput,
  SignalDisplayMode,
  SignalGroup,
  SuppressedSignal,
} from "./optional-master-signal-selector";
export {
  INSTITUTIONAL_MASTER_GATEKEEPER_ID,
  PRODUCTION_STRATEGY_IDS,
  selectInstitutionalMasterSignal,
} from "./institutional-master-selector";
export type {
  InstitutionalCandidateDebug,
  InstitutionalConflictSignal,
  InstitutionalMasterSelectionResult,
  InstitutionalRejectedSignal,
  InstitutionalSuppressedSignal,
  SelectInstitutionalMasterSignalInput,
} from "./institutional-master-selector";
export {
  evaluateInstitutionalConfluence,
} from "./institutional-confluence-model";
export type { InstitutionalConfluenceResult } from "./institutional-confluence-model";
export {
  applyKillzoneGatekeeper,
  getInstitutionalStrategyType,
} from "./killzone-gatekeeper";
export type { KillzoneGatekeeperResult } from "./killzone-gatekeeper";
export { calculateStructuralStop } from "./structural-stop-engine";
export type { StructuralStopResult, StructuralStopSource } from "./structural-stop-engine";
export { findStructuralTakeProfit } from "./htf-liquidity-target-engine";
export type { StructuralTakeProfitResult, StructuralTargetSource } from "./htf-liquidity-target-engine";
export { deriveCandleBias, evaluateHTFLiquidityContext } from "./htf-liquidity-context";
export type { HTFLiquidityContextResult } from "./htf-liquidity-context";
export { evaluateProductionRisk } from "./risk-management-layer";
export type { RiskManagementResult } from "./risk-management-layer";
export type {
  InstitutionalAction,
  InstitutionalFactorName,
  InstitutionalMasterSignal,
  InstitutionalMode,
  InstitutionalNoRepaintProof,
  InstitutionalReasonCode,
  InstitutionalRiskState,
  InstitutionalScore,
  TradingAppMode,
} from "./institutional-types";

export type {
  GoldmineAsianRange,
  GoldmineConfirmation,
  GoldmineDirection,
  GoldmineDisplacement,
  GoldmineScoreBreakdown,
  GoldmineSignalStage,
  GoldmineSweep,
  V2GoldmineAudit,
  V2GoldmineInput,
  V2GoldmineSettings,
} from "./types";
