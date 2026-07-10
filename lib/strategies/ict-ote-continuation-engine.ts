import type { Candle, Timeframe } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { MarketContextResult } from "../market-context/types";
import type { FvgZone, LiquidityZone, MarketStructureResult } from "../market-structure/types";
import {
  ICT_OTE_CONTINUATION_STRATEGY_ID,
  generateIctOteContinuationSignals,
} from "../v2-signal-engine";
import type { V2GoldmineInput } from "../v2-signal-engine/types";

export type IctOteContinuationStandaloneInput = {
  ltfCandles: Candle[];
  itfCandles?: Candle[];
  htfCandles?: Candle[];
  currentMode?: string;
  session?: string;
  existingMarkers?: unknown[];
  marketContext?: MarketContextResult;
  timeframe?: Extract<Timeframe, "1m" | "5m" | "15m" | "30m">;
};

export type IctOteContinuationStandaloneResult = {
  signal: "BUY" | "SELL" | null;
  strategy: typeof ICT_OTE_CONTINUATION_STRATEGY_ID;
  confidence: number;
  score: number;
  maxScore: 8;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  rr: number | null;
  reason: string[];
  rejectionReasons: string[];
  warnings: string[];
  markers: Array<{ id: string; type: string; timestamp: number; price: number; reason: string }>;
  debug: Record<string, unknown>;
};

export function generateICTOTEContinuationSignal(input: IctOteContinuationStandaloneInput): IctOteContinuationStandaloneResult {
  const ltfCandles = input.ltfCandles.filter((candle) => candle.isClosed);
  const first = ltfCandles[0];
  const last = ltfCandles.at(-1);
  const htfBias = deriveBias(input.htfCandles ?? []);
  const itfBias = deriveBias(input.itfCandles ?? []);
  const context = input.marketContext ?? ({
    htfBias: { bias: htfBias, strength: htfBias === "NEUTRAL" ? 35 : 65 },
    itfSetup: { direction: itfBias, strength: itfBias === "NEUTRAL" ? 35 : 60 },
  } as MarketContextResult);
  const fvgZones = (input.existingMarkers ?? []).filter(isFvgZone);
  const liquidityZones = (input.existingMarkers ?? []).filter(isLiquidityZone);
  const structure = {
    markers: [],
    fvgZones,
    liquidityZones,
  } as unknown as MarketStructureResult;
  const engineInput: V2GoldmineInput = {
    candles: ltfCandles,
    symbol: "XAUUSD",
    timeframe: input.timeframe ?? "5m",
    startDate: first?.time ?? new Date(0).toISOString(),
    endDate: last?.time ?? first?.time ?? new Date(0).toISOString(),
    structure,
    context,
    settings: { maxRiskAmount: 100, currentMode: input.currentMode },
  };
  const result = generateIctOteContinuationSignals(engineInput);
  const signal = result.signals.at(-1) ?? null;
  const snapshot = signal?.ictOteContinuation;
  return {
    signal: signal ? signal.v2Direction ?? (signal.direction === "BULLISH" ? "BUY" : "SELL") : null,
    strategy: ICT_OTE_CONTINUATION_STRATEGY_ID,
    confidence: snapshot?.confluence.confidence ?? signal?.score ?? 0,
    score: snapshot?.confluence.score ?? 0,
    maxScore: 8,
    entry: signal?.entryPrice ?? null,
    stopLoss: signal?.stopLoss ?? null,
    takeProfit: signal?.takeProfit ?? null,
    rr: signal?.rr ?? null,
    reason: signal?.reasons ?? [],
    rejectionReasons: signal ? [] : result.noTrade?.rejectionReasons ?? [],
    warnings: signal?.warnings ?? [],
    markers: signal ? markersFromSignal(signal) : [],
    debug: {
      strategyName: ICT_OTE_CONTINUATION_STRATEGY_ID,
      checkedCandles: result.audit.v2IctOteContinuation?.candlesScanned ?? ltfCandles.length,
      htfBias: snapshot?.htfBias ?? result.audit.v2IctOteContinuation?.htfBias ?? htfBias,
      itfBias: snapshot?.itfBias ?? result.audit.v2IctOteContinuation?.itfBias ?? itfBias,
      marketCondition: snapshot?.marketCondition ?? result.audit.v2IctOteContinuation?.marketCondition ?? null,
      impulseDetected: Boolean(snapshot?.impulse),
      impulseHigh: snapshot?.impulse.high ?? null,
      impulseLow: snapshot?.impulse.low ?? null,
      oteZone: snapshot ? { low: snapshot.ote.low, high: snapshot.ote.high } : null,
      level62: snapshot?.ote.level62 ?? null,
      level705: snapshot?.ote.level705 ?? null,
      level79: snapshot?.ote.level79 ?? null,
      oteTouched: Boolean(snapshot?.ote.touchedAt),
      confluenceFound: Boolean(snapshot?.ote.confluence.length),
      confirmationFound: Boolean(snapshot?.confirmation),
      entry: signal?.entryPrice ?? null,
      stopLoss: signal?.stopLoss ?? null,
      takeProfit: signal?.takeProfit ?? null,
      rr: signal?.rr ?? null,
      score: snapshot?.confluence.score ?? null,
      confidence: snapshot?.confluence.confidence ?? null,
      rejectionReasons: result.noTrade?.rejectionReasons ?? [],
      warnings: signal?.warnings ?? [],
      session: input.session ?? snapshot?.sessionName ?? null,
    },
  };
}

function markersFromSignal(signal: TradeSignal): IctOteContinuationStandaloneResult["markers"] {
  const snapshot = signal.ictOteContinuation;
  if (!snapshot) return [];
  const bullish = signal.direction === "BULLISH";
  return [
    { id: `${signal.id}:impulse`, type: bullish ? "BULLISH_IMPULSE" : "BEARISH_IMPULSE", timestamp: snapshot.impulse.endTime, price: bullish ? snapshot.impulse.high : snapshot.impulse.low, reason: "Closed displacement impulse leg." },
    { id: `${signal.id}:structure`, type: snapshot.structureBreak.type, timestamp: snapshot.structureBreak.confirmedAt, price: snapshot.structureBreak.brokenLevel, reason: "Structure break after impulse start." },
    { id: `${signal.id}:ote-62`, type: "OTE_62", timestamp: snapshot.impulse.endTime, price: snapshot.ote.level62, reason: "OTE 0.62 boundary." },
    { id: `${signal.id}:ote-705`, type: "OTE_705", timestamp: snapshot.impulse.endTime, price: snapshot.ote.level705, reason: "Ideal OTE 0.705 level." },
    { id: `${signal.id}:ote-79`, type: "OTE_79", timestamp: snapshot.impulse.endTime, price: snapshot.ote.level79, reason: "OTE 0.79 boundary." },
    { id: `${signal.id}:touch`, type: "OTE_TOUCH", timestamp: snapshot.ote.touchedAt, price: snapshot.ote.level705, reason: "Price entered the OTE zone." },
    { id: `${signal.id}:pressure`, type: snapshot.confirmation.pressure, timestamp: snapshot.confirmation.candleTime, price: signal.entryPrice, reason: "Pressure marker from the rejection candle, not an entry by itself." },
    { id: `${signal.id}:confirmation`, type: signal.type, timestamp: signal.timestamp, price: signal.entryPrice, reason: `${signal.type} ${snapshot.confluence.score}/${snapshot.confluence.maxScore}` },
  ];
}

function deriveBias(candles: Candle[]): "BULLISH" | "BEARISH" | "NEUTRAL" {
  const closed = candles.filter((candle) => candle.isClosed).slice(-30);
  if (closed.length < 6) return "NEUTRAL";
  const averageRange = closed.reduce((sum, candle) => sum + candle.high - candle.low, 0) / closed.length;
  const net = closed.at(-1)!.close - closed[0].close;
  return Math.abs(net) < averageRange ? "NEUTRAL" : net > 0 ? "BULLISH" : "BEARISH";
}

function isFvgZone(value: unknown): value is FvgZone {
  return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type === "FVG" && typeof (value as { minPrice?: unknown }).minPrice === "number");
}

function isLiquidityZone(value: unknown): value is LiquidityZone {
  return Boolean(value && typeof value === "object" && ((value as { type?: unknown }).type === "SSL" || (value as { type?: unknown }).type === "BSL") && typeof (value as { price?: unknown }).price === "number");
}
