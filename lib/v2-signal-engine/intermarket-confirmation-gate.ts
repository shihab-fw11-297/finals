import type { Candle, Timeframe } from "@/lib/candles/types";
import type { TradeSignal } from "@/lib/entry-engine/types";
import type {
  FredMacroSeries,
  GoldMacroBias,
  IntermarketConfirmationResult,
  IntermarketGateMode,
  IntermarketMomentum,
  IntermarketProviderConfirmation,
  IntermarketSnapshot,
  IntermarketStructure,
  IntermarketTrend,
  NormalizedMarketCandle,
} from "@/lib/market-data/types";

export type IntermarketEvaluationInput = {
  signal: TradeSignal;
  xauusdCandles: Candle[];
  dxyCandles: NormalizedMarketCandle[];
  tnxCandles: NormalizedMarketCandle[];
  fredMacro: IntermarketSnapshot["fred"] | null;
  timeframe: Timeframe | string;
  mode: IntermarketGateMode;
};

export type MarketDisplacement = "BULLISH_DISPLACEMENT" | "BEARISH_DISPLACEMENT" | "NONE";

const MODULE_NAME = "INTERMARKET_MACRO_CONFIRMATION_GATE" as const;
const MIN_INTRADAY_CANDLES = 8;

export function evaluateIntermarketConfirmation({
  signal,
  xauusdCandles,
  dxyCandles,
  tnxCandles,
  fredMacro,
  mode,
}: IntermarketEvaluationInput): IntermarketConfirmationResult {
  const direction = signalDirection(signal);
  const signalTime = signal.timestamp;
  const warnings: string[] = [];

  if (mode === "OFF") {
    return unknownResult({
      signal,
      direction,
      mode,
      signalTime,
      warnings: ["INTERMARKET_GATE_OFF"],
      fredDailyBias: fredMacro?.dailyBias ?? "NEUTRAL",
    });
  }

  const dxyClosed = selectClosedBeforeSignal(dxyCandles, signalTime);
  const tnxClosed = selectClosedBeforeSignal(tnxCandles, signalTime);
  const dxyConfirmation = evaluateDxy(direction, dxyClosed);
  const tnxConfirmation = evaluateTnx(direction, tnxClosed);
  const fredConfirmation = evaluateFred(direction, fredMacro);

  if (dxyClosed.length < MIN_INTRADAY_CANDLES) warnings.push("YAHOO_DXY_DATA_UNAVAILABLE");
  if (tnxClosed.length < MIN_INTRADAY_CANDLES) warnings.push("YAHOO_TNX_DATA_UNAVAILABLE");
  if (!fredMacro?.dgs10 && !fredMacro?.dfii10) warnings.push("FRED_DATA_UNAVAILABLE");
  if (xauusdCandles.length === 0) warnings.push("XAUUSD_CONTEXT_MISSING");

  const dxyScore = dxyConfirmation.score;
  const tnxScore = tnxConfirmation.score;
  const fredScore = fredConfirmation.score;
  const macroScore = clamp(50 + dxyScore + tnxScore + fredScore, 0, 100);
  const insufficientIntraday =
    dxyConfirmation.status === "UNKNOWN" ||
    tnxConfirmation.status === "UNKNOWN";
  const macroGrade = insufficientIntraday ? "UNKNOWN" : gradeFromScore(macroScore);
  const goldBias = deriveGoldBias(dxyClosed, tnxClosed);
  const bothStrongConflict =
    dxyConfirmation.status === "STRONGLY_CONFLICTS" &&
    tnxConfirmation.status === "STRONGLY_CONFLICTS";
  const shouldBlock = mode === "BLOCK_STRONG_CONFLICT_ONLY" && bothStrongConflict;

  if (macroGrade === "CONFLICT" && mode !== "SCORE_ONLY") {
    warnings.push("INTERMARKET_MACRO_CONFLICT");
  }

  return {
    signalId: signal.id,
    direction,
    macroScore,
    macroGrade,
    goldBias,
    dxyConfirmation,
    tnxConfirmation,
    fredConfirmation,
    shouldBlock,
    blockReason: shouldBlock ? "DXY_AND_TNX_STRONG_MACRO_CONFLICT" : null,
    warnings: [...new Set([...warnings, ...dxyConfirmation.reasons.filter(isWarningReason), ...tnxConfirmation.reasons.filter(isWarningReason)])],
    debug: {
      module: MODULE_NAME,
      mode,
      dxyScore,
      tnxScore,
      fredScore,
      dxyCandlesUsed: dxyClosed.length,
      tnxCandlesUsed: tnxClosed.length,
      xauusdSignalTime: signalTime,
      fredDailyBias: fredMacro?.dailyBias ?? "NEUTRAL",
    },
  };
}

export function buildIntermarketState(candles: NormalizedMarketCandle[]): {
  trend: IntermarketTrend;
  momentum: IntermarketMomentum;
  structure: IntermarketStructure;
  latestClose: number | null;
  changePercent: number | null;
} {
  const closed = candles.filter((candle) => candle.isClosed);
  const latest = closed.at(-1) ?? candles.at(-1) ?? null;
  const first = closed[0] ?? candles[0] ?? null;

  return {
    trend: detectTrend(closed),
    momentum: detectMomentum(closed),
    structure: detectSimpleBOS(closed),
    latestClose: latest?.close ?? null,
    changePercent: latest && first && first.close > 0
      ? round(((latest.close - first.close) / first.close) * 100, 4)
      : null,
  };
}

export function deriveFredDailyBias(
  dgs10: FredMacroSeries | null,
  dfii10: FredMacroSeries | null,
): GoldMacroBias {
  const nominal = dgs10?.bias ?? "UNKNOWN";
  const real = dfii10?.bias ?? "UNKNOWN";

  if (nominal === "FALLING" && real === "FALLING") return "BULLISH_GOLD";
  if (nominal === "RISING" && real === "RISING") return "BEARISH_GOLD";
  if (real === "FALLING" && nominal !== "RISING") return "BULLISH_GOLD";
  if (real === "RISING" && nominal !== "FALLING") return "BEARISH_GOLD";
  return "NEUTRAL";
}

export function detectTrend(candles: NormalizedMarketCandle[]): IntermarketTrend {
  const closed = candles.filter((candle) => candle.isClosed);
  if (closed.length < 5) return "NEUTRAL";

  const ema20 = calculateEma(closed, 20).at(-1);
  const ema50 = calculateEma(closed, 50).at(-1);
  const latest = closed.at(-1);
  const earlier = closed.at(-Math.min(10, closed.length));

  if (!latest || !earlier || ema20 === undefined || ema50 === undefined) return "NEUTRAL";

  const slope = latest.close - earlier.close;
  const threshold = Math.max(latest.close * 0.00015, 0.0001);

  if (latest.close > ema20 && ema20 >= ema50 && slope > threshold) return "BULLISH";
  if (latest.close < ema20 && ema20 <= ema50 && slope < -threshold) return "BEARISH";
  if (slope > threshold * 2) return "BULLISH";
  if (slope < -threshold * 2) return "BEARISH";
  return "NEUTRAL";
}

export function detectMomentum(candles: NormalizedMarketCandle[]): IntermarketMomentum {
  const closed = candles.filter((candle) => candle.isClosed);
  if (closed.length < 6) return "FLAT";

  const latest = closed.at(-1);
  const recentBase = closed.at(-4);
  const priorBase = closed.at(-7) ?? closed[0];

  if (!latest || !recentBase || !priorBase) return "FLAT";

  const recentSlope = latest.close - recentBase.close;
  const priorSlope = recentBase.close - priorBase.close;
  const threshold = Math.max(latest.close * 0.00012, 0.0001);

  if (recentSlope > threshold && recentSlope >= Math.abs(priorSlope) * 0.65) return "ACCELERATING_UP";
  if (recentSlope < -threshold && Math.abs(recentSlope) >= Math.abs(priorSlope) * 0.65) return "ACCELERATING_DOWN";
  return "FLAT";
}

export function detectSimpleBOS(candles: NormalizedMarketCandle[]): IntermarketStructure {
  const closed = candles.filter((candle) => candle.isClosed);
  if (closed.length < 8) return "UNKNOWN";

  const latest = closed.at(-1);
  const lookback = closed.slice(Math.max(0, closed.length - 13), -1);
  if (!latest || lookback.length < 4) return "UNKNOWN";

  const recentHigh = Math.max(...lookback.map((candle) => candle.high));
  const recentLow = Math.min(...lookback.map((candle) => candle.low));

  if (latest.close > recentHigh) return "BULLISH_BOS";
  if (latest.close < recentLow) return "BEARISH_BOS";
  return "RANGE";
}

export function detectDisplacement(
  candles: NormalizedMarketCandle[],
  atr = calculateAverageRange(candles, 14),
): MarketDisplacement {
  const latest = candles.filter((candle) => candle.isClosed).at(-1);
  if (!latest || !Number.isFinite(atr) || atr <= 0) return "NONE";

  const range = latest.high - latest.low;
  const body = Math.abs(latest.close - latest.open);
  const bodyRatio = range > 0 ? body / range : 0;
  const strongBody = bodyRatio >= 0.55 && body >= atr * 0.45;

  if (!strongBody) return "NONE";
  if (latest.close > latest.open) return "BULLISH_DISPLACEMENT";
  if (latest.close < latest.open) return "BEARISH_DISPLACEMENT";
  return "NONE";
}

export function calculateEma(candles: NormalizedMarketCandle[], period: number): number[] {
  if (candles.length === 0) return [];
  const multiplier = 2 / (period + 1);
  const ema: number[] = [candles[0].close];

  for (let index = 1; index < candles.length; index += 1) {
    ema.push((candles[index].close - ema[index - 1]) * multiplier + ema[index - 1]);
  }

  return ema;
}

function evaluateDxy(direction: "BUY" | "SELL", candles: NormalizedMarketCandle[]): IntermarketProviderConfirmation {
  return evaluateInverseMarket({
    provider: "DXY",
    direction,
    candles,
    scores: { strongSupport: 25, support: 15, conflict: -20, strongConflict: -35 },
    reasonCodes: {
      supportsBuy: "DXY_SUPPORTS_GOLD_BUY",
      supportsSell: "DXY_SUPPORTS_GOLD_SELL",
      neutral: "DXY_NEUTRAL",
      conflictsBuy: "DXY_CONFLICTS_WITH_BUY",
      conflictsSell: "DXY_CONFLICTS_WITH_SELL",
      strongConflict: "DXY_STRONG_CONFLICT",
    },
  });
}

function evaluateTnx(direction: "BUY" | "SELL", candles: NormalizedMarketCandle[]): IntermarketProviderConfirmation {
  return evaluateInverseMarket({
    provider: "TNX",
    direction,
    candles,
    scores: { strongSupport: 20, support: 12, conflict: -15, strongConflict: -30 },
    reasonCodes: {
      supportsBuy: "TNX_SUPPORTS_GOLD_BUY",
      supportsSell: "TNX_SUPPORTS_GOLD_SELL",
      neutral: "TNX_NEUTRAL",
      conflictsBuy: "TNX_CONFLICTS_WITH_BUY",
      conflictsSell: "TNX_CONFLICTS_WITH_SELL",
      strongConflict: "TNX_STRONG_CONFLICT",
    },
  });
}

function evaluateInverseMarket({
  provider,
  direction,
  candles,
  scores,
  reasonCodes,
}: {
  provider: "DXY" | "TNX";
  direction: "BUY" | "SELL";
  candles: NormalizedMarketCandle[];
  scores: { strongSupport: number; support: number; conflict: number; strongConflict: number };
  reasonCodes: {
    supportsBuy: IntermarketProviderConfirmation["reasonCode"];
    supportsSell: IntermarketProviderConfirmation["reasonCode"];
    neutral: IntermarketProviderConfirmation["reasonCode"];
    conflictsBuy: IntermarketProviderConfirmation["reasonCode"];
    conflictsSell: IntermarketProviderConfirmation["reasonCode"];
    strongConflict: IntermarketProviderConfirmation["reasonCode"];
  };
}): IntermarketProviderConfirmation {
  if (candles.length < MIN_INTRADAY_CANDLES) {
    return {
      provider,
      status: "UNKNOWN",
      score: 0,
      reasonCode: "INTERMARKET_DATA_UNKNOWN",
      reasons: [`${provider}_DATA_MISSING`],
      trend: "NEUTRAL",
      momentum: "FLAT",
      structure: "UNKNOWN",
      latestClose: null,
      changePercent: null,
    };
  }

  const trend = detectTrend(candles);
  const momentum = detectMomentum(candles);
  const structure = detectSimpleBOS(candles);
  const displacement = detectDisplacement(candles);
  const ema20 = calculateEma(candles, 20).at(-1);
  const ema50 = calculateEma(candles, 50).at(-1);
  const latest = candles.at(-1);
  const first = candles[0];
  const aboveEmaStack = latest && ema20 !== undefined && ema50 !== undefined && latest.close > ema20 && latest.close > ema50;
  const belowEmaStack = latest && ema20 !== undefined && ema50 !== undefined && latest.close < ema20 && latest.close < ema50;
  const wantsMacroDown = direction === "BUY";
  const supportSignals = [
    wantsMacroDown ? trend === "BEARISH" : trend === "BULLISH",
    wantsMacroDown ? structure === "BEARISH_BOS" : structure === "BULLISH_BOS",
    wantsMacroDown ? belowEmaStack : aboveEmaStack,
    wantsMacroDown ? momentum === "ACCELERATING_DOWN" : momentum === "ACCELERATING_UP",
    wantsMacroDown ? displacement === "BEARISH_DISPLACEMENT" : displacement === "BULLISH_DISPLACEMENT",
  ].filter(Boolean).length;
  const conflictSignals = [
    wantsMacroDown ? trend === "BULLISH" : trend === "BEARISH",
    wantsMacroDown ? structure === "BULLISH_BOS" : structure === "BEARISH_BOS",
    wantsMacroDown ? aboveEmaStack : belowEmaStack,
    wantsMacroDown ? momentum === "ACCELERATING_UP" : momentum === "ACCELERATING_DOWN",
    wantsMacroDown ? displacement === "BULLISH_DISPLACEMENT" : displacement === "BEARISH_DISPLACEMENT",
  ].filter(Boolean).length;
  const strongConflict = conflictSignals >= 4 || (conflictSignals >= 3 && supportSignals === 0);
  const strongSupport = supportSignals >= 4 || (supportSignals >= 3 && conflictSignals === 0);
  const latestClose = latest?.close ?? null;
  const changePercent = latest && first && first.close > 0
    ? round(((latest.close - first.close) / first.close) * 100, 4)
    : null;

  if (strongConflict) {
    return {
      provider,
      status: "STRONGLY_CONFLICTS",
      score: scores.strongConflict,
      reasonCode: reasonCodes.strongConflict,
      reasons: [`${provider}_STRONG_CONFLICT`, `${provider}_${trend}`, `${provider}_${momentum}`, `${provider}_${structure}`],
      trend,
      momentum,
      structure,
      latestClose,
      changePercent,
    };
  }

  if (conflictSignals >= 2) {
    return {
      provider,
      status: "CONFLICTS",
      score: scores.conflict,
      reasonCode: direction === "BUY" ? reasonCodes.conflictsBuy : reasonCodes.conflictsSell,
      reasons: [`${provider}_CONFLICTS_WITH_${direction}`, `${provider}_${trend}`, `${provider}_${momentum}`],
      trend,
      momentum,
      structure,
      latestClose,
      changePercent,
    };
  }

  if (strongSupport) {
    return {
      provider,
      status: "STRONGLY_SUPPORTS",
      score: scores.strongSupport,
      reasonCode: direction === "BUY" ? reasonCodes.supportsBuy : reasonCodes.supportsSell,
      reasons: [`${provider}_STRONGLY_SUPPORTS_${direction}`, `${provider}_${trend}`, `${provider}_${momentum}`, `${provider}_${structure}`],
      trend,
      momentum,
      structure,
      latestClose,
      changePercent,
    };
  }

  if (supportSignals >= 2) {
    return {
      provider,
      status: "SUPPORTS",
      score: scores.support,
      reasonCode: direction === "BUY" ? reasonCodes.supportsBuy : reasonCodes.supportsSell,
      reasons: [`${provider}_SUPPORTS_${direction}`, `${provider}_${trend}`, `${provider}_${momentum}`],
      trend,
      momentum,
      structure,
      latestClose,
      changePercent,
    };
  }

  return {
    provider,
    status: "NEUTRAL",
    score: 0,
    reasonCode: reasonCodes.neutral,
    reasons: [`${provider}_NEUTRAL`],
    trend,
    momentum,
    structure,
    latestClose,
    changePercent,
  };
}

function evaluateFred(
  direction: "BUY" | "SELL",
  fredMacro: IntermarketSnapshot["fred"] | null,
): IntermarketProviderConfirmation {
  const dgs10 = fredMacro?.dgs10 ?? null;
  const dfii10 = fredMacro?.dfii10 ?? null;

  if (!dgs10 && !dfii10) {
    return {
      provider: "FRED",
      status: "UNKNOWN",
      score: 0,
      reasonCode: "INTERMARKET_DATA_UNKNOWN",
      reasons: ["FRED_DATA_MISSING"],
    };
  }

  const dailyBias = fredMacro?.dailyBias ?? deriveFredDailyBias(dgs10, dfii10);
  const supports =
    (direction === "BUY" && dailyBias === "BULLISH_GOLD") ||
    (direction === "SELL" && dailyBias === "BEARISH_GOLD");
  const conflicts =
    (direction === "BUY" && dailyBias === "BEARISH_GOLD") ||
    (direction === "SELL" && dailyBias === "BULLISH_GOLD");
  const realYieldStrongConflict = isRealYieldStrongConflict(direction, dfii10);

  if (realYieldStrongConflict) {
    return {
      provider: "FRED",
      status: "STRONGLY_CONFLICTS",
      score: -25,
      reasonCode: "REAL_YIELD_STRONG_CONFLICT",
      reasons: ["REAL_YIELD_STRONG_CONFLICT"],
    };
  }

  if (conflicts) {
    return {
      provider: "FRED",
      status: "CONFLICTS",
      score: -15,
      reasonCode: "FRED_DAILY_CONFLICT",
      reasons: ["FRED_DAILY_CONFLICT"],
    };
  }

  if (supports) {
    return {
      provider: "FRED",
      status: "SUPPORTS",
      score: 15,
      reasonCode: direction === "BUY" ? "FRED_DAILY_SUPPORTS_BUY" : "FRED_DAILY_SUPPORTS_SELL",
      reasons: [`FRED_DAILY_SUPPORTS_${direction}`],
    };
  }

  return {
    provider: "FRED",
    status: "NEUTRAL",
    score: 5,
    reasonCode: "FRED_DAILY_NEUTRAL",
    reasons: ["FRED_DAILY_NEUTRAL"],
  };
}

function deriveGoldBias(
  dxyCandles: NormalizedMarketCandle[],
  tnxCandles: NormalizedMarketCandle[],
): GoldMacroBias {
  const dxyTrend = detectTrend(dxyCandles);
  const tnxTrend = detectTrend(tnxCandles);
  const tnxMomentum = detectMomentum(tnxCandles);

  if (dxyTrend === "BEARISH" && (tnxTrend === "BEARISH" || tnxMomentum === "ACCELERATING_DOWN")) {
    return "BULLISH_GOLD";
  }

  if (dxyTrend === "BULLISH" && (tnxTrend === "BULLISH" || tnxMomentum === "ACCELERATING_UP")) {
    return "BEARISH_GOLD";
  }

  return "NEUTRAL";
}

function selectClosedBeforeSignal(
  candles: NormalizedMarketCandle[],
  signalTime: number,
): NormalizedMarketCandle[] {
  return candles
    .filter((candle) => candle.isClosed && candle.timestamp <= signalTime)
    .sort((left, right) => left.timestamp - right.timestamp);
}

function gradeFromScore(score: number): IntermarketConfirmationResult["macroGrade"] {
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  if (score >= 45) return "C";
  return "CONFLICT";
}

function signalDirection(signal: TradeSignal): "BUY" | "SELL" {
  return signal.v2Direction ?? (signal.direction === "BULLISH" ? "BUY" : "SELL");
}

function calculateAverageRange(candles: NormalizedMarketCandle[], period: number): number {
  const closed = candles.filter((candle) => candle.isClosed);
  const sample = closed.slice(-period);
  if (sample.length === 0) return 0;
  return sample.reduce((sum, candle) => sum + Math.max(0, candle.high - candle.low), 0) / sample.length;
}

function isRealYieldStrongConflict(direction: "BUY" | "SELL", dfii10: FredMacroSeries | null): boolean {
  if (!dfii10 || dfii10.threeDaySlope === null) return false;
  const risingRealYield = dfii10.bias === "RISING" && dfii10.threeDaySlope > 0;
  const fallingRealYield = dfii10.bias === "FALLING" && dfii10.threeDaySlope < 0;
  const strongMove = Math.abs(dfii10.threeDaySlope) >= 0.03;
  return strongMove && ((direction === "BUY" && risingRealYield) || (direction === "SELL" && fallingRealYield));
}

function isWarningReason(reason: string): boolean {
  return reason.endsWith("_DATA_MISSING");
}

function unknownResult({
  signal,
  direction,
  mode,
  signalTime,
  warnings,
  fredDailyBias,
}: {
  signal: TradeSignal;
  direction: "BUY" | "SELL";
  mode: IntermarketGateMode;
  signalTime: number;
  warnings: string[];
  fredDailyBias: GoldMacroBias;
}): IntermarketConfirmationResult {
  const confirmation: IntermarketProviderConfirmation = {
    provider: "DXY",
    status: "UNKNOWN",
    score: 0,
    reasonCode: "INTERMARKET_DATA_UNKNOWN",
    reasons: warnings,
  };

  return {
    signalId: signal.id,
    direction,
    macroScore: 50,
    macroGrade: "UNKNOWN",
    goldBias: "NEUTRAL",
    dxyConfirmation: confirmation,
    tnxConfirmation: { ...confirmation, provider: "TNX" },
    fredConfirmation: { ...confirmation, provider: "FRED" },
    shouldBlock: false,
    blockReason: null,
    warnings,
    debug: {
      module: MODULE_NAME,
      mode,
      dxyScore: 0,
      tnxScore: 0,
      fredScore: 0,
      dxyCandlesUsed: 0,
      tnxCandlesUsed: 0,
      xauusdSignalTime: signalTime,
      fredDailyBias,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
