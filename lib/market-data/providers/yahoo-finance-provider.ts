import type { NormalizedMarketCandle } from "@/lib/market-data/types";

export type YahooChartRequest = {
  symbol: string;
  interval: string;
  range: string;
  timeoutMs?: number;
};

export type YahooChartResult = {
  candles: NormalizedMarketCandle[];
  source: "YAHOO";
  symbol: string;
  interval: string;
  warnings: string[];
};

type YahooQuote = {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
};

type YahooChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: YahooQuote[];
      };
    }> | null;
    error?: unknown;
  };
};

const DEFAULT_TIMEOUT_MS = 8_000;

export async function fetchYahooChart({
  symbol,
  interval,
  range,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: YahooChartRequest): Promise<YahooChartResult> {
  const warnings: string[] = [];

  try {
    return await fetchYahooChartOnce({ symbol, interval, range, timeoutMs });
  } catch {
    await wait(500);
  }

  try {
    return await fetchYahooChartOnce({ symbol, interval, range, timeoutMs });
  } catch {
    warnings.push(`YAHOO_${warningSymbol(symbol)}_FETCH_FAILED`);
    return {
      candles: [],
      source: "YAHOO",
      symbol,
      interval,
      warnings,
    };
  }
}

export function parseYahooChartPayload(
  payload: unknown,
  {
    symbol,
    interval,
    now = Date.now(),
  }: {
    symbol: string;
    interval: string;
    now?: number;
  },
): YahooChartResult {
  const warnings: string[] = [];
  const typed = payload as YahooChartPayload;
  const result = typed.chart?.result?.[0] ?? null;
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0] ?? null;

  if (!result || !quote || timestamps.length === 0) {
    warnings.push(`YAHOO_${warningSymbol(symbol)}_EMPTY_DATA`);
    return {
      candles: [],
      source: "YAHOO",
      symbol,
      interval,
      warnings,
    };
  }

  const intervalMs = intervalToMs(interval);
  const candles: NormalizedMarketCandle[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestampSeconds = timestamps[index];
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];

    if (
      typeof timestampSeconds !== "number" ||
      !isValidPrice(open) ||
      !isValidPrice(high) ||
      !isValidPrice(low) ||
      !isValidPrice(close) ||
      close <= 0
    ) {
      continue;
    }

    const timestamp = timestampSeconds * 1000;
    candles.push({
      timestamp,
      time: new Date(timestamp).toISOString(),
      open,
      high,
      low,
      close,
      volume: quote.volume?.[index] ?? null,
      source: "YAHOO",
      symbol,
      interval,
      isClosed: timestamp + intervalMs <= now,
    });
  }

  if (candles.length === 0) {
    warnings.push(`YAHOO_${warningSymbol(symbol)}_NO_VALID_CANDLES`);
  }

  return {
    candles,
    source: "YAHOO",
    symbol,
    interval,
    warnings,
  };
}

function fetchYahooChartOnce(request: Required<YahooChartRequest>): Promise<YahooChartResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(request.symbol)}?interval=${encodeURIComponent(request.interval)}&range=${encodeURIComponent(request.range)}`;

  return fetchJsonWithTimeout(url, request.timeoutMs).then((payload) =>
    parseYahooChartPayload(payload, {
      symbol: request.symbol,
      interval: request.interval,
    }),
  );
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance returned HTTP ${response.status}.`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function isValidPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function intervalToMs(interval: string): number {
  const value = Number.parseInt(interval, 10);
  if (!Number.isFinite(value) || value <= 0) return 5 * 60_000;
  if (interval.endsWith("m")) return value * 60_000;
  if (interval.endsWith("h")) return value * 60 * 60_000;
  if (interval.endsWith("d")) return value * 24 * 60 * 60_000;
  return value * 60_000;
}

function warningSymbol(symbol: string): string {
  if (symbol === "^TNX") return "TNX";
  if (symbol === "DX-Y.NYB") return "DXY";
  return symbol.replace(/[^A-Z0-9]/gi, "_").toUpperCase();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
