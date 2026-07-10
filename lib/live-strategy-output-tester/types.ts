import type { Candle, NormalizationResult, Timeframe } from "@/lib/candles/types";
import type {
  EntryEngineResult,
  RejectedSetup,
  SignalCandidateDebug,
  TradeSignal,
} from "@/lib/entry-engine/types";
import type { MarketContextResult } from "@/lib/market-context/types";
import type {
  FvgZone,
  LiquidityZone,
  MarketMarker,
  MarketStructureResult,
} from "@/lib/market-structure/types";
import type { SessionVwapPoint } from "@/lib/v2-signal-engine/indicators";
import type { GoldmineAsianRange } from "@/lib/v2-signal-engine/types";
import type { MasterSignalSelectionResult } from "@/lib/v2-signal-engine/master-signal-selector";

export const V2_STRATEGIES = [
  "VWAP_EMA_REGIME_PULLBACK",
  "EMA_TREND_PULLBACK",
  "LIQUIDITY_SWEEP_REVERSAL_PRO",
  "ORDER_BLOCK_RETEST_CONFIRMATION",
  "ICT_SILVER_BULLET",
  "FVG_CONTINUATION_ENTRY",
  "PRO_LIQUIDITY_CONFLUENCE_ENGINE",
  "STOCK_GURU_SWEEP_FVG_OB_ENGINE",
  "TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE",
  "ICT_OTE_CONTINUATION_ENGINE",
  "ICT_IFVG_REVERSAL_ENGINE",
  "GOLDMINE_ASIAN_SWEEP_REVERSAL",
  "ASIAN_RANGE_BREAKOUT_RETEST",
] as const;


export const LIVE_TEST_TIMEFRAMES = ["1m", "5m", "15m"] as const;

export const LIVE_TEST_CANDLE_LIMITS: Record<LiveStrategyTimeframe, number> = {
  "1m": 1000,
  "5m": 1000,
  "15m": 800,
};

export const LIVE_TEST_POLLING_MS: Record<LiveStrategyTimeframe, number> = {
  "1m": 15_000,
  "5m": 30_000,
  "15m": 60_000,
};

export const V2_STRATEGY_LABELS: Record<V2StrategyId, string> = {
  VWAP_EMA_REGIME_PULLBACK: "VWAP EMA Regime Pullback",
  EMA_TREND_PULLBACK: "EMA Trend Pullback",
  LIQUIDITY_SWEEP_REVERSAL_PRO: "Liquidity Sweep Reversal Pro",
  ORDER_BLOCK_RETEST_CONFIRMATION: "Order Block Retest Confirmation",
  ICT_SILVER_BULLET: "ICT Silver Bullet",
  FVG_CONTINUATION_ENTRY: "FVG Continuation Entry",
  PRO_LIQUIDITY_CONFLUENCE_ENGINE: "Pro Liquidity Confluence Engine",
  STOCK_GURU_SWEEP_FVG_OB_ENGINE: "Stock Guru Sweep FVG OB Engine",
  TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE: "TJR Simple Structure Pullback Engine",
  ICT_OTE_CONTINUATION_ENGINE: "ICT OTE Continuation Engine",
  ICT_IFVG_REVERSAL_ENGINE: "ICT IFVG Reversal Engine",
  GOLDMINE_ASIAN_SWEEP_REVERSAL: "Goldmine Asian Sweep Reversal",
  ASIAN_RANGE_BREAKOUT_RETEST: "Asian Range Breakout Retest",
};


export type V2StrategyId = (typeof V2_STRATEGIES)[number];
export type LiveStrategyTimeframe = Extract<Timeframe, "1m" | "5m" | "15m">;
export type LiveStrategySelection = "ALL" | V2StrategyId;
export type LiveStrategyTestAction = "TEST_ALL" | "TEST_ONE" | "REFRESH";

export type LiveStrategyStatus =
  | "WORKING"
  | "WORKING_NO_SIGNAL"
  | "PENDING_SETUP_FOUND"
  | "CONFIRMED_SIGNAL_FOUND"
  | "REJECTED_ONLY"
  | "BROKEN"
  | "ERROR";

export type LiveStrategyError = {
  message: string;
  stack?: string;
  source: string;
};

export type LiveStrategyRejectionReason = {
  reason: string;
  count: number;
};

export type MacdPoint = {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
};

export type SharedOrderBlockContext = {
  direction: "BULLISH" | "BEARISH";
  createdAt: number;
  confirmedAtIndex: number;
  sourceMarkerId: string;
};

export type LiveStrategySharedContext = {
  candles: Candle[];
  atr: Array<number | null>;
  ema20: Array<number | null>;
  ema50: Array<number | null>;
  ema200: Array<number | null>;
  rsi: Array<number | null>;
  macd: MacdPoint[];
  vwap: SessionVwapPoint[];
  swingHighs: MarketMarker[];
  swingLows: MarketMarker[];
  liquidityLevels: LiquidityZone[];
  sessionInfo: MarketContextResult["session"];
  asianRange: GoldmineAsianRange[];
  fvgList: FvgZone[];
  orderBlocks: SharedOrderBlockContext[];
  structure: MarketStructureResult;
  context: MarketContextResult;
};

export type SerializableEntryEngineResult = Omit<EntryEngineResult, "signalMap"> & {
  signalMapKeys: string[];
};

export type V2StrategyAdapterOutput = {
  strategyId: V2StrategyId;
  candlesScanned: number;
  pendingSetups: SignalCandidateDebug[];
  confirmedSignals: TradeSignal[];
  rejectedSetups: RejectedSetup[];
  expiredSetups: RejectedSetup[];
  rejectionReasons: LiveStrategyRejectionReason[];
  warnings: string[];
  debug: {
    scanResult: SerializableEntryEngineResult | null;
    candidateDebug: SignalCandidateDebug[];
    audit: EntryEngineResult["audit"] | null;
    sharedContext: {
      atrPoints: number;
      ema20Points: number;
      ema50Points: number;
      ema200Points: number;
      swingHighs: number;
      swingLows: number;
      liquidityLevels: number;
      fvgList: number;
      orderBlocks: number;
      asianRanges: number;
      session: MarketContextResult["session"]["session"];
    };
  };
  error: LiveStrategyError | null;
};

export type LiveStrategyDetails = {
  strategyId: V2StrategyId;
  candleCount: number;
  closedCandleCount: number;
  latestCandle: Candle | null;
  scanResult: SerializableEntryEngineResult | null;
  pendingSetups: SignalCandidateDebug[];
  confirmedSignals: TradeSignal[];
  rejectedSetups: RejectedSetup[];
  rejectionReasons: LiveStrategyRejectionReason[];
  warnings: string[];
  error: LiveStrategyError | null;
};

export type LiveStrategyTestResult = {
  strategyId: V2StrategyId;
  status: LiveStrategyStatus;
  candlesReceived: number;
  closedCandlesUsed: number;
  lastClosedCandleTime: number | null;
  outputExists: boolean;
  pendingCount: number;
  confirmedCount: number;
  rejectedCount: number;
  expiredCount: number;
  latestPendingSetup: SignalCandidateDebug | null;
  latestConfirmedSignal: TradeSignal | null;
  latestRejectedSetup: RejectedSetup | null;
  rejectionReasons: LiveStrategyRejectionReason[];
  warnings: string[];
  error: LiveStrategyError | null;
  fixed: boolean;
  notes: string[];
  details: LiveStrategyDetails;
};

export type LiveStrategySummary = {
  totalStrategies: number;
  working: number;
  workingNoSignal: number;
  pendingFound: number;
  confirmedFound: number;
  rejectedOnly: number;
  broken: number;
  errors: number;
  fixed: number;
  stillFailing: number;
};

export type LiveStrategyOutputTesterRequest = {
  symbol?: string;
  timeframe?: LiveStrategyTimeframe;
  selectedStrategy?: LiveStrategySelection;
  action?: LiveStrategyTestAction;
  previousLastClosedCandleTime?: number | null;
};

export type LiveStrategyFetchMeta = {
  provider: string;
  requestStartDate: string;
  requestEndDate: string;
  targetCandles: number;
  rawCandlesReceived: number;
  candlesReceived: number;
  closedCandles: number;
  lastClosedCandleTime: number | null;
  fetchDurationMs: number;
  normalization: NormalizationResult;
};

export type LiveStrategyOutputTesterResponse = {
  request: {
    symbol: string;
    timeframe: LiveStrategyTimeframe;
    selectedStrategy: LiveStrategySelection;
    action: LiveStrategyTestAction;
  };
  fetchedAt: string;
  fetch: LiveStrategyFetchMeta;
  results: LiveStrategyTestResult[];
  summary: LiveStrategySummary;
  logs: string[];
  skippedReason: string | null;
  error: LiveStrategyError | null;
  masterSelection?: MasterSignalSelectionResult;
};
