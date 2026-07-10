export type NormalizedMarketCandle = {
  timestamp: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  source: "YAHOO" | "FRED" | "FINAGE" | "CACHE";
  symbol: string;
  interval: string;
  isClosed: boolean;
};

export type FredMacroBias = "RISING" | "FALLING" | "FLAT" | "UNKNOWN";

export type FredMacroSeries = {
  seriesId: string;
  latestValue: number | null;
  previousValue: number | null;
  oneDayChange: number | null;
  threeDaySlope: number | null;
  fiveDaySlope: number | null;
  twentyDayAverage: number | null;
  bias: FredMacroBias;
  latestDate?: string | null;
  previousDate?: string | null;
};

export type IntermarketTrend = "BULLISH" | "BEARISH" | "NEUTRAL";
export type IntermarketMomentum = "ACCELERATING_UP" | "ACCELERATING_DOWN" | "FLAT";
export type IntermarketStructure = "BULLISH_BOS" | "BEARISH_BOS" | "RANGE" | "UNKNOWN";
export type GoldMacroBias = "BULLISH_GOLD" | "BEARISH_GOLD" | "NEUTRAL";

export type IntermarketSnapshot = {
  dxy: {
    symbol: "DX-Y.NYB";
    candles: NormalizedMarketCandle[];
    trend: IntermarketTrend;
    momentum: IntermarketMomentum;
    structure: IntermarketStructure;
    latestClose: number | null;
    changePercent: number | null;
  };
  tnx: {
    symbol: "^TNX";
    candles: NormalizedMarketCandle[];
    trend: IntermarketTrend;
    momentum: IntermarketMomentum;
    structure: IntermarketStructure;
    latestClose: number | null;
    changePercent: number | null;
  };
  fred: {
    dgs10: FredMacroSeries | null;
    dfii10: FredMacroSeries | null;
    dailyBias: GoldMacroBias;
  };
  updatedAt: string;
  warnings: string[];
};

export type IntermarketGateMode =
  | "OFF"
  | "SCORE_ONLY"
  | "WARN_ONLY"
  | "BLOCK_STRONG_CONFLICT_ONLY";

export type IntermarketMacroGrade = "A" | "B" | "C" | "CONFLICT" | "UNKNOWN";

export type IntermarketReasonCode =
  | "DXY_SUPPORTS_GOLD_BUY"
  | "DXY_SUPPORTS_GOLD_SELL"
  | "DXY_NEUTRAL"
  | "DXY_CONFLICTS_WITH_BUY"
  | "DXY_CONFLICTS_WITH_SELL"
  | "DXY_STRONG_CONFLICT"
  | "TNX_SUPPORTS_GOLD_BUY"
  | "TNX_SUPPORTS_GOLD_SELL"
  | "TNX_NEUTRAL"
  | "TNX_CONFLICTS_WITH_BUY"
  | "TNX_CONFLICTS_WITH_SELL"
  | "TNX_STRONG_CONFLICT"
  | "FRED_DAILY_SUPPORTS_BUY"
  | "FRED_DAILY_SUPPORTS_SELL"
  | "FRED_DAILY_NEUTRAL"
  | "FRED_DAILY_CONFLICT"
  | "REAL_YIELD_STRONG_CONFLICT"
  | "INTERMARKET_DATA_UNKNOWN";

export type IntermarketConfirmationStatus =
  | "STRONGLY_SUPPORTS"
  | "SUPPORTS"
  | "NEUTRAL"
  | "CONFLICTS"
  | "STRONGLY_CONFLICTS"
  | "UNKNOWN";

export type IntermarketProviderConfirmation = {
  provider: "DXY" | "TNX" | "FRED";
  status: IntermarketConfirmationStatus;
  score: number;
  reasonCode: IntermarketReasonCode;
  reasons: string[];
  trend?: IntermarketTrend;
  momentum?: IntermarketMomentum;
  structure?: IntermarketStructure;
  latestClose?: number | null;
  changePercent?: number | null;
};

export type IntermarketConfirmationResult = {
  signalId: string;
  direction: "BUY" | "SELL";
  macroScore: number;
  macroGrade: IntermarketMacroGrade;
  goldBias: GoldMacroBias;
  dxyConfirmation: IntermarketProviderConfirmation;
  tnxConfirmation: IntermarketProviderConfirmation;
  fredConfirmation: IntermarketProviderConfirmation;
  shouldBlock: boolean;
  blockReason: "DXY_AND_TNX_STRONG_MACRO_CONFLICT" | null;
  warnings: string[];
  debug: {
    module: "INTERMARKET_MACRO_CONFIRMATION_GATE";
    mode: IntermarketGateMode;
    dxyScore: number;
    tnxScore: number;
    fredScore: number;
    dxyCandlesUsed: number;
    tnxCandlesUsed: number;
    xauusdSignalTime: number;
    fredDailyBias: GoldMacroBias;
  };
};
