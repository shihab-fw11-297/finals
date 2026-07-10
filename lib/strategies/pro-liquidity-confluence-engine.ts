import type { Candle } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { MarketContextResult } from "../market-context/types";
import type { MarketStructureResult } from "../market-structure/types";
import {
  PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID,
  generateProLiquidityConfluenceSignals,
} from "../v2-signal-engine";
import type { V2GoldmineInput } from "../v2-signal-engine/types";

export type ProLiquidityConfluenceStandaloneInput = {
  ltfCandles: Candle[];
  itfCandles?: Candle[];
  htfCandles?: Candle[];
  currentMode?: string;
  session?: string;
  existingMarkers?: unknown[];
  marketContext?: MarketContextResult;
};

export type ProLiquidityConfluenceStandaloneResult = {
  signal: "BUY" | "SELL" | null;
  strategy: typeof PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID;
  confidence: number;
  score: number;
  maxScore: 8;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  rr: number | null;
  reason: string[];
  rejectionReasons: string[];
  markers: Array<{ id: string; type: string; timestamp: number; price: number; reason: string }>;
  debug: Record<string, unknown>;
};

export function generateProLiquidityConfluenceSignal(
  input: ProLiquidityConfluenceStandaloneInput,
): ProLiquidityConfluenceStandaloneResult {
  const ltfCandles = input.ltfCandles.filter((candle) => candle.isClosed);
  const first = ltfCandles[0];
  const last = ltfCandles.at(-1);
  const engineInput: V2GoldmineInput = {
    candles: ltfCandles,
    symbol: "XAUUSD",
    timeframe: "5m",
    startDate: first?.time ?? new Date(0).toISOString(),
    endDate: last?.time ?? first?.time ?? new Date(0).toISOString(),
    structure: {} as MarketStructureResult,
    context: input.marketContext ?? ({} as MarketContextResult),
    settings: {
      maxRiskAmount: 100,
      currentMode: input.currentMode,
    } as V2GoldmineInput["settings"] & { currentMode?: string },
  };
  const result = generateProLiquidityConfluenceSignals(engineInput);
  const signal = result.signals.at(-1) ?? null;

  return {
    signal: signal ? signal.v2Direction ?? (signal.direction === "BULLISH" ? "BUY" : "SELL") : null,
    strategy: PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID,
    confidence: signal?.proLiquidityConfluence?.confluence.confidence ?? signal?.score ?? 0,
    score: signal?.proLiquidityConfluence?.confluence.score ?? 0,
    maxScore: 8,
    entry: signal?.entryPrice ?? null,
    stopLoss: signal?.stopLoss ?? null,
    takeProfit: signal?.takeProfit ?? null,
    rr: signal?.rr ?? null,
    reason: signal?.reasons ?? [],
    rejectionReasons: signal ? [] : result.noTrade?.rejectionReasons ?? result.audit.topRejectionReasons.map((row) => String(row.reason)),
    markers: signal ? markersFromSignal(signal) : [],
    debug: {
      strategyName: "PRO_LIQUIDITY_CONFLUENCE_ENGINE",
      checkedCandles: result.audit.v2ProLiquidityConfluence?.candlesScanned ?? ltfCandles.length,
      itfCandles: input.itfCandles?.length ?? 0,
      htfCandles: input.htfCandles?.length ?? 0,
      session: input.session ?? signal?.proLiquidityConfluence?.sessionName ?? null,
      htfBias: signal?.proLiquidityConfluence?.htfBias.bias ?? result.audit.v2ProLiquidityConfluence?.htfBias ?? null,
      itfBias: signal?.proLiquidityConfluence?.itfBias.bias ?? result.audit.v2ProLiquidityConfluence?.itfBias ?? null,
      liquiditySweepFound: Boolean(signal?.proLiquidityConfluence?.liquiditySweep),
      sweepType: signal?.proLiquidityConfluence?.liquiditySweep.type ?? null,
      displacementFound: Boolean(signal?.proLiquidityConfluence?.displacement),
      mssFound: Boolean(signal?.proLiquidityConfluence?.structureShift),
      entryZoneType: signal?.proLiquidityConfluence?.entryZone.type ?? null,
      confirmationFound: Boolean(signal?.proLiquidityConfluence?.confirmation),
      rr: signal?.rr ?? null,
      score: signal?.proLiquidityConfluence?.confluence.score ?? null,
      rejectionReasons: result.noTrade?.rejectionReasons ?? [],
      warnings: signal?.warnings ?? [],
    },
  };
}

function markersFromSignal(signal: TradeSignal): ProLiquidityConfluenceStandaloneResult["markers"] {
  const snapshot = signal.proLiquidityConfluence;
  if (!snapshot) return [];
  return [
    {
      id: `${signal.id}:sweep`,
      type: `${snapshot.liquiditySweep.type}_SWEEP`,
      timestamp: snapshot.liquiditySweep.timestamp,
      price: snapshot.liquiditySweep.sweepPrice,
      reason: `${snapshot.liquiditySweep.type} sweep for ${signal.strategyModel}`,
    },
    {
      id: `${signal.id}:pressure`,
      type: signal.direction === "BULLISH" ? "BUYERS" : "SELLERS",
      timestamp: snapshot.displacement.timestamp,
      price: signal.direction === "BULLISH" ? signal.entryPrice : signal.entryPrice,
      reason: "Pressure marker from displacement, not an entry by itself.",
    },
    {
      id: `${signal.id}:mss`,
      type: snapshot.structureShift.type,
      timestamp: snapshot.structureShift.confirmedAt,
      price: snapshot.structureShift.brokenLevel,
      reason: "Closed-candle structure shift after sweep.",
    },
    {
      id: `${signal.id}:entry-zone`,
      type: snapshot.entryZone.type,
      timestamp: snapshot.entryZone.createdAt,
      price: snapshot.entryZone.midpoint,
      reason: `${snapshot.entryZone.source} entry zone.`,
    },
    {
      id: `${signal.id}:confirmation`,
      type: signal.type,
      timestamp: signal.timestamp,
      price: signal.entryPrice,
      reason: `${signal.type} ${snapshot.confluence.score}/${snapshot.confluence.maxScore}`,
    },
  ];
}
