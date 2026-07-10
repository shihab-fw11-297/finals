import type { Candle, Timeframe } from "../candles/types";
import type { EntryMode, RejectedSetup, TradeSignal, V2AsianRangeType } from "../entry-engine/types";
import type { IntermarketMacroGrade } from "../market-data/types";
import type { MarketRegime, TradingSession } from "../market-context/types";
import type { SetupType } from "../setup-scanner/types";

export type BacktestSignalMode = EntryMode;
export type SameCandlePolicy = "CONSERVATIVE_SL_FIRST" | "OPTIMISTIC_TP_FIRST" | "MARK_UNKNOWN";
export type BacktestTradeResult =
  | "WIN"
  | "LOSS"
  | "BREAKEVEN"
  | "PARTIAL_WIN"
  | "PARTIAL_LOSS"
  | "TIME_EXIT"
  | "EXPIRED"
  | "UNKNOWN_INTRACANDLE";

export type BacktestSettings = {
  signalMode: BacktestSignalMode;
  accountBalance: number;
  riskPerTradePercent: number;
  maxTradesPerDay: number;
  maxDailyLossPercent: number;
  spreadPoints: number;
  slippagePoints: number;
  commissionPerLot: number;
  sameCandlePolicy: SameCandlePolicy;
  enableBreakeven: boolean;
  enablePartials: boolean;
  enableTrailing: boolean;
  sessionFilter: TradingSession | "ALL";
  setupTypeFilter: SetupType | "ALL";
  maxHoldingCandles: number;
  strategyFilter?: string;
};

export type CalibrationSettings = {
  minSignalScore: number;
  minRR: number;
  maxSetupCandles: number;
  retracementMin: number;
  retracementMax: number;
  displacementAtrMultiplier: number;
  maxStopAtrMultiplier: number;
  sessionRequired: boolean;
  allowNeutralHTF: boolean;
  reversalRiskMax: "LOW" | "MEDIUM" | "HIGH";
};

export type BacktestInput = {
  candles: Candle[];
  signals: TradeSignal[];
  rejectedSetups: RejectedSetup[];
  symbol: string;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  settings?: Partial<BacktestSettings>;
  marketRegime?: MarketRegime["regime"];
};

export type NoFutureValidation = {
  signalId: string;
  strategyId?: string;
  confirmedAtIndex: number;
  maxDataIndexUsedForSignal: number;
  passedNoFutureCheck: boolean;
};

export type BacktestTrade = {
  tradeId: string;
  signalId: string;
  direction: TradeSignal["direction"];
  setupType: SetupType;
  session: TradingSession;
  mode: BacktestSignalMode;
  symbol: string;
  timeframe: Timeframe;
  entryTime: number;
  exitTime: number | null;
  entryIndex: number;
  exitIndex: number | null;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number | null;
  takeProfit3: number | null;
  rr: number;
  result: BacktestTradeResult;
  finalR: number;
  pnl: number;
  mfe: number;
  mae: number;
  candlesHeld: number;
  exitReason: string;
  reason: string;
  score: number;
  confidence: TradeSignal["confidence"];
  warnings: string[];
  noFutureValidation: NoFutureValidation;
  strategyId?: string;
  killzoneName?: string;
  retestDelay?: number;
  asianRangeType?: V2AsianRangeType;
  largeAsianRange?: boolean;
  macroGrade?: IntermarketMacroGrade;
  macroScore?: number;
  macroGoldBias?: string;
  macroBlockReason?: string | null;
  macroWarnings?: string[];
};

export type PerformanceMetrics = {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  lossRate: number;
  averageWinR: number;
  averageLossR: number;
  averageR: number;
  expectancy: number;
  profitFactor: number;
  totalR: number;
  netPnl: number;
  maxDrawdown: number;
  maxDrawdownR: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  averageRr: number;
  averageMfe: number;
  averageMae: number;
  averageCandlesHeld: number;
  bestTrade: number;
  worstTrade: number;
  bestTradeR: number;
  worstTradeR: number;
  largestMissedMfe: number;
  averageSlippageCommissionImpact: number;
  breakoutWinRate?: number;
  averageRetestDelay?: number;
  bestSession?: string;
  breakoutDirectionPerformance?: Array<{ direction: "BUY" | "SELL"; totalTrades: number; winRate: number; totalR: number }>;
  completeRangeSignals: number;
  partialRangeSignals: number;
  fallbackRangeSignals: number;
  largeRangeSignals: number;
  winRateByRangeType: Array<{ rangeType: V2AsianRangeType; totalTrades: number; winRate: number }>;
};

export type BreakdownRow = {
  key: string;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  totalR: number;
  netPnl: number;
};

export type RejectionAnalytics = {
  totalSetupsScanned: number;
  watchCount: number;
  setupCount: number;
  triggerCount: number;
  confirmedSignalCount: number;
  rejectedSignalCount: number;
  topRejectionReasons: Array<{ reason: string; count: number }>;
  rejectionHistogram: Array<{ reason: string; count: number }>;
  rejectedButLaterWouldHaveWonCount: number;
  rejectedAndCorrectlyAvoidedLossCount: number;
  notes: string[];
};

export type CalibrationResult = {
  settingName: "current settings" | "relaxed settings" | "strict settings" | "custom settings";
  settings: CalibrationSettings;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  totalR: number;
  notes: string[];
};

export type RobustnessResult = {
  worstCaseDrawdown: number;
  averageOutcome: number;
  probabilityOfLosingStreak: number;
  riskOfRuinWarning: string | null;
  removeTopWinnersTotalR: number;
  increasedSpreadTotalR: number;
  reducedWinRateTotalR: number;
};

export type PropFirmSettings = {
  startingBalance: number;
  profitTargetPercent: number;
  maxDailyLossPercent: number;
  maxTotalDrawdownPercent: number;
  maxTradesPerDay: number;
  minTradingDays: number;
  consistencyRulePercent: number;
};

export type PropFirmResult = {
  passed: boolean;
  failReason: string | null;
  dailyDrawdownHit: boolean;
  totalDrawdownHit: boolean;
  profitTargetHit: boolean;
  tradingDaysCount: number;
  bestDayProfitConcentration: number;
};

export type BacktestAudit = {
  cacheStatus: "hit" | "miss";
  calculationTimeMs: number;
  signalCountInput: number;
  signalCountTested: number;
  noFutureFailures: number;
  progressPercent: number;
  cacheKey: string;
};

export type BacktestResult = {
  trades: BacktestTrade[];
  tradeMap: Map<string, BacktestTrade>;
  equityCurve: Array<{ timestamp: number; balance: number; drawdown: number }>;
  metrics: PerformanceMetrics;
  breakdowns: {
    bySession: BreakdownRow[];
    byKillzone: BreakdownRow[];
    bySetupType: BreakdownRow[];
    byDirection: BreakdownRow[];
    byMarketRegime: BreakdownRow[];
    byScoreBucket: BreakdownRow[];
    byRrBucket: BreakdownRow[];
    byHour: BreakdownRow[];
  };
  rejectionAnalytics: RejectionAnalytics;
  calibration: CalibrationResult[];
  robustness: RobustnessResult;
  propFirm: PropFirmResult;
  exports: {
    tradeJournalCsv: string;
    rejectedSetupsCsv: string;
    jsonReport: string;
    summaryText: string;
  };
  audit: BacktestAudit;
};

export type IntermarketMacroBacktestMode = "RAW_STRATEGY" | "MACRO_SCORE_ONLY" | "MACRO_BLOCKING";

export type IntermarketMacroBacktestGradeRow = BreakdownRow & {
  grade: IntermarketMacroGrade | "MISSING";
  blockedTrades: number;
};

export type IntermarketMacroBacktestComparison = {
  raw: BacktestResult;
  scoreOnly: BacktestResult;
  blocking: BacktestResult;
  rawTotalSignals: number;
  scoreOnlySignals: number;
  blockingSignals: number;
  signalsWithMacroA: number;
  signalsWithMacroB: number;
  macroConflictSignals: number;
  tradesBlocked: number;
  rawDrawdown: number;
  blockingDrawdown: number;
  drawdownChange: number;
  rawExpectancy: number;
  scoreOnlyExpectancy: number;
  blockingExpectancy: number;
  expectancyChange: number;
  winRateByMacroGrade: IntermarketMacroBacktestGradeRow[];
  expectancyByMacroGrade: IntermarketMacroBacktestGradeRow[];
  blockedTradeOutcomes: IntermarketMacroBacktestGradeRow[];
  notes: string[];
};

export type MasterBacktestComparison = {
  raw: BacktestResult;
  master: BacktestResult;
  rawTotalTrades: number;
  masterSelectedTrades: number;
  suppressedDuplicates: number;
  rawWinRate: number;
  masterWinRate: number;
  rawProfitFactor: number;
  masterProfitFactor: number;
  rawDrawdown: number;
  masterDrawdown: number;
  expectancyChange: number;
};

export type OptionalMasterBacktestComparison = {
  raw: BacktestResult;
  master: BacktestResult;
  rawTotalTrades: number;
  masterSelectedTrades: number;
  suppressedDuplicates: number;
  conflictCount: number;
  rawWinRate: number;
  masterWinRate: number;
  rawProfitFactor: number;
  masterProfitFactor: number;
  rawExpectancy: number;
  masterExpectancy: number;
  rawDrawdown: number;
  masterDrawdown: number;
  expectancyChange: number;
};

export type InstitutionalBacktestComparison = {
  research: BacktestResult;
  production: BacktestResult;
  researchRawTrades: number;
  productionMasterTrades: number;
  productionRejectedSignals: number;
  researchWinRate: number;
  productionWinRate: number;
  researchProfitFactor: number;
  productionProfitFactor: number;
  researchDrawdown: number;
  productionDrawdown: number;
  expectancyChange: number;
};
