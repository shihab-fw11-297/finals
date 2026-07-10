import type { Candle } from "@/lib/candles/types";
import { getTimeframeMs, normalizeCandles } from "@/lib/candles/utils";
import { fetchCandles } from "@/lib/server/candle-provider";

import {
  LIVE_TEST_CANDLE_LIMITS,
  type LiveStrategyFetchMeta,
  type LiveStrategyTimeframe,
} from "./types";

const MIN_LOOKBACK_DAYS: Record<LiveStrategyTimeframe, number> = {
  "1m": 3,
  "5m": 10,
  "15m": 21,
};

const LOOKBACK_MULTIPLIER: Record<LiveStrategyTimeframe, number> = {
  "1m": 3.5,
  "5m": 2.5,
  "15m": 2.2,
};

export async function fetchLiveStrategyCandles(input: {
  symbol: string;
  timeframe: LiveStrategyTimeframe;
  now?: number;
}): Promise<{ candles: Candle[]; meta: LiveStrategyFetchMeta }> {
  const now = input.now ?? Date.now();
  const targetCandles = LIVE_TEST_CANDLE_LIMITS[input.timeframe];
  const requestStartDate = new Date(
    now - getLookbackMs(input.timeframe, targetCandles),
  ).toISOString();
  const requestEndDate = new Date(now).toISOString();
  const startedAt = performance.now();
  const providerResult = await fetchCandles({
    symbol: input.symbol,
    timeframe: input.timeframe,
    startDate: requestStartDate,
    endDate: requestEndDate,
  });
  const fetchDurationMs = Math.round(performance.now() - startedAt);
  const normalization = normalizeCandles(providerResult.rawCandles, {
    timeframe: input.timeframe,
    now,
  });
  const closedCandles = normalization.candles.filter((candle) => candle.isClosed);
  const candles = closedCandles.slice(-targetCandles);
  const lastClosedCandle = candles.at(-1) ?? null;

  return {
    candles,
    meta: {
      provider: providerResult.provider,
      requestStartDate,
      requestEndDate,
      targetCandles,
      rawCandlesReceived: providerResult.rawCandles.length,
      candlesReceived: normalization.candles.length,
      closedCandles: candles.length,
      lastClosedCandleTime: lastClosedCandle?.timestamp ?? null,
      fetchDurationMs,
      normalization,
    },
  };
}

function getLookbackMs(
  timeframe: LiveStrategyTimeframe,
  targetCandles: number,
): number {
  const candleLookback = getTimeframeMs(timeframe) * targetCandles * LOOKBACK_MULTIPLIER[timeframe];
  const minimumLookback = MIN_LOOKBACK_DAYS[timeframe] * 24 * 60 * 60 * 1000;

  return Math.max(candleLookback, minimumLookback);
}
