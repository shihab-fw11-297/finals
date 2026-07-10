import type { FredMacroSeries } from "@/lib/market-data/types";

export type FredSeriesRequest = {
  seriesId: string;
  apiKey?: string;
  limit?: number;
  timeoutMs?: number;
};

export type FredSeriesResult = {
  series: FredMacroSeries | null;
  warnings: string[];
};

type FredObservation = {
  date?: string;
  value?: string;
};

type FredPayload = {
  observations?: FredObservation[];
};

type ParsedObservation = {
  date: string;
  value: number;
};

const DEFAULT_LIMIT = 60;
const DEFAULT_TIMEOUT_MS = 8_000;

export async function fetchFredSeries({
  seriesId,
  apiKey,
  limit = DEFAULT_LIMIT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: FredSeriesRequest): Promise<FredSeriesResult> {
  if (!apiKey || apiKey === "your_fred_key_here") {
    return {
      series: null,
      warnings: ["FRED_API_KEY_MISSING"],
    };
  }

  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));

  try {
    const payload = await fetchJsonWithTimeout(url.toString(), timeoutMs);
    return parseFredSeriesPayload(payload, seriesId);
  } catch {
    return {
      series: null,
      warnings: [`FRED_${seriesId}_FETCH_FAILED`],
    };
  }
}

export function parseFredSeriesPayload(payload: unknown, seriesId: string): FredSeriesResult {
  const observations = ((payload as FredPayload).observations ?? [])
    .map(parseObservation)
    .filter((observation): observation is ParsedObservation => observation !== null)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (observations.length === 0) {
    return {
      series: makeSeries(seriesId, []),
      warnings: [`FRED_${seriesId}_EMPTY_DATA`],
    };
  }

  return {
    series: makeSeries(seriesId, observations),
    warnings: [],
  };
}

function makeSeries(seriesId: string, observations: ParsedObservation[]): FredMacroSeries {
  const latest = observations.at(-1) ?? null;
  const previous = observations.at(-2) ?? null;
  const oneDayChange = latest && previous ? round(latest.value - previous.value) : null;
  const threeDaySlope = slopeFromLookback(observations, 3);
  const fiveDaySlope = slopeFromLookback(observations, 5);
  const twentyDayAverage = observations.length >= 20
    ? round(observations.slice(-20).reduce((sum, observation) => sum + observation.value, 0) / 20)
    : null;

  return {
    seriesId,
    latestValue: latest?.value ?? null,
    previousValue: previous?.value ?? null,
    oneDayChange,
    threeDaySlope,
    fiveDaySlope,
    twentyDayAverage,
    bias: macroBias(latest?.value ?? null, previous?.value ?? null, threeDaySlope),
    latestDate: latest?.date ?? null,
    previousDate: previous?.date ?? null,
  };
}

function parseObservation(observation: FredObservation): ParsedObservation | null {
  if (!observation.date || observation.value === undefined || observation.value === ".") {
    return null;
  }

  const value = Number(observation.value);

  if (!Number.isFinite(value)) {
    return null;
  }

  return {
    date: observation.date,
    value,
  };
}

function slopeFromLookback(observations: ParsedObservation[], lookback: number): number | null {
  if (observations.length <= lookback) return null;
  const latest = observations.at(-1);
  const prior = observations.at(-(lookback + 1));
  if (!latest || !prior) return null;
  return round(latest.value - prior.value);
}

function macroBias(
  latest: number | null,
  previous: number | null,
  threeDaySlope: number | null,
): FredMacroSeries["bias"] {
  if (latest === null || previous === null || threeDaySlope === null) return "UNKNOWN";
  if (latest > previous && threeDaySlope > 0) return "RISING";
  if (latest < previous && threeDaySlope < 0) return "FALLING";
  return "FLAT";
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
      throw new Error(`FRED returned HTTP ${response.status}.`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
