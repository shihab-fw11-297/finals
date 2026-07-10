import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCandles } from "./candle-provider";

const ORIGINAL_ENV = { ...process.env };

describe("server candle provider", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, CANDLE_API_PROVIDER: "finage", FINAGE_API_KEY: "test-key" };
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("calls Finage crypto aggregates for BTCUSD", async () => {
    await fetchCandles({
      symbol: "BTCUSD",
      timeframe: "1m",
      startDate: "2020-02-05T00:00",
      endDate: "2020-02-07T00:00",
    });

    const calledUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(calledUrl).toContain("https://api.finage.co.uk/agg/crypto/BTCUSD/1/minute/2020-02-05/2020-02-07");
    expect(calledUrl).toContain("apikey=test-key");
    expect(calledUrl).toContain("limit=30000");
  });

  it("keeps XAUUSD on Finage forex aggregates", async () => {
    await fetchCandles({
      symbol: "XAUUSD",
      timeframe: "1h",
      startDate: "2020-02-05T00:00",
      endDate: "2020-02-07T00:00",
    });

    const calledUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(calledUrl).toContain("https://api.finage.co.uk/agg/forex/XAUUSD/1/hour/2020-02-05/2020-02-07");
  });

  it("formats 30m requests as 30 minute Finage aggregates", async () => {
    await fetchCandles({
      symbol: "BTCUSD",
      timeframe: "30m",
      startDate: "2020-02-05T00:00",
      endDate: "2020-02-07T00:00",
    });

    const calledUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(calledUrl).toContain("https://api.finage.co.uk/agg/crypto/BTCUSD/30/minute/2020-02-05/2020-02-07");
  });
});
