import { fetchFredSeries } from "@/lib/market-data/providers/fred-provider";
import { fetchYahooChart } from "@/lib/market-data/providers/yahoo-finance-provider";
import type {
  FredMacroSeries,
  IntermarketGateMode,
  IntermarketSnapshot,
  NormalizedMarketCandle,
} from "@/lib/market-data/types";
import {
  buildIntermarketState,
  deriveFredDailyBias,
} from "@/lib/v2-signal-engine/intermarket-confirmation-gate";

export const dynamic = "force-dynamic";

type CacheEntry<T> = {
  value: T;
  createdAt: number;
};

type YahooCachedValue = {
  candles: NormalizedMarketCandle[];
  warnings: string[];
};

type FredCachedValue = {
  series: FredMacroSeries | null;
  warnings: string[];
};

const INTRADAY_CACHE_SECONDS = 60;
const FRED_CACHE_SECONDS = 3_600;
const yahooCache = new Map<string, CacheEntry<YahooCachedValue>>();
const fredCache = new Map<string, CacheEntry<FredCachedValue>>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const interval = url.searchParams.get("interval") ?? process.env.YAHOO_INTRADAY_INTERVAL ?? "5m";
  const range = url.searchParams.get("range") ?? process.env.YAHOO_INTRADAY_RANGE ?? "1d";
  const dxySymbol = process.env.YAHOO_DXY_SYMBOL ?? "DX-Y.NYB";
  const tnxSymbol = process.env.YAHOO_TNX_SYMBOL ?? "^TNX";
  const dgs10SeriesId = process.env.FRED_DGS10_SERIES_ID ?? "DGS10";
  const dfii10SeriesId = process.env.FRED_DFII10_SERIES_ID ?? "DFII10";
  const mode = parseGateMode(process.env.INTERMARKET_GATE_MODE);

  const [dxy, tnx, dgs10, dfii10] = await Promise.all([
    readYahooCache(`yahoo:${dxySymbol}:${interval}:${range}`, () =>
      fetchYahooChart({ symbol: dxySymbol, interval, range }),
    ),
    readYahooCache(`yahoo:${tnxSymbol}:${interval}:${range}`, () =>
      fetchYahooChart({ symbol: tnxSymbol, interval, range }),
    ),
    readFredCache(`fred:${dgs10SeriesId}`, () =>
      fetchFredSeries({ seriesId: dgs10SeriesId, apiKey: process.env.FRED_API_KEY }),
    ),
    readFredCache(`fred:${dfii10SeriesId}`, () =>
      fetchFredSeries({ seriesId: dfii10SeriesId, apiKey: process.env.FRED_API_KEY }),
    ),
  ]);

  const dxyState = buildIntermarketState(dxy.candles);
  const tnxState = buildIntermarketState(tnx.candles);
  const warnings = [...new Set([...dxy.warnings, ...tnx.warnings, ...dgs10.warnings, ...dfii10.warnings])];

  const snapshot: IntermarketSnapshot = {
    dxy: {
      symbol: "DX-Y.NYB",
      candles: dxy.candles,
      ...dxyState,
    },
    tnx: {
      symbol: "^TNX",
      candles: tnx.candles,
      ...tnxState,
    },
    fred: {
      dgs10: dgs10.series,
      dfii10: dfii10.series,
      dailyBias: deriveFredDailyBias(dgs10.series, dfii10.series),
    },
    updatedAt: new Date().toISOString(),
    warnings,
  };

  return Response.json({
    success: true,
    data: snapshot,
    mode,
    cache: {
      intradayCacheSeconds: INTRADAY_CACHE_SECONDS,
      fredCacheSeconds: FRED_CACHE_SECONDS,
    },
  });
}

async function readYahooCache(
  key: string,
  load: () => Promise<{ candles: NormalizedMarketCandle[]; warnings: string[] }>,
): Promise<YahooCachedValue> {
  const cached = yahooCache.get(key);
  if (cached && Date.now() - cached.createdAt < INTRADAY_CACHE_SECONDS * 1000) {
    return cached.value;
  }

  const result = await load();
  const value = {
    candles: result.candles,
    warnings: result.warnings,
  };
  yahooCache.set(key, { value, createdAt: Date.now() });
  return value;
}

async function readFredCache(
  key: string,
  load: () => Promise<FredCachedValue>,
): Promise<FredCachedValue> {
  const cached = fredCache.get(key);
  if (cached && Date.now() - cached.createdAt < FRED_CACHE_SECONDS * 1000) {
    return cached.value;
  }

  const value = await load();
  fredCache.set(key, { value, createdAt: Date.now() });
  return value;
}

function parseGateMode(value: string | undefined): IntermarketGateMode {
  if (
    value === "OFF" ||
    value === "SCORE_ONLY" ||
    value === "WARN_ONLY" ||
    value === "BLOCK_STRONG_CONFLICT_ONLY"
  ) {
    return value;
  }

  return "SCORE_ONLY";
}
