import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchYahooChart, parseYahooChartPayload } from "./yahoo-finance-provider";

describe("Yahoo Finance intraday provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses a valid DXY chart response into normalized candles", () => {
    const result = parseYahooChartPayload(makePayload(), {
      symbol: "DX-Y.NYB",
      interval: "5m",
      now: Date.UTC(2026, 6, 1, 8, 20),
    });

    expect(result.candles).toHaveLength(2);
    expect(result.candles[0]).toMatchObject({
      source: "YAHOO",
      symbol: "DX-Y.NYB",
      interval: "5m",
      timestamp: Date.UTC(2026, 6, 1, 8, 0),
      isClosed: true,
      close: 105,
    });
  });

  it("uses an encoded path for the ^TNX symbol", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => makePayload(),
    } as Response);

    await fetchYahooChart({ symbol: "^TNX", interval: "5m", range: "1d" });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/%5ETNX?");
  });

  it("skips null OHLC candles", () => {
    const result = parseYahooChartPayload({
      chart: {
        result: [{
          timestamp: [Date.UTC(2026, 6, 1, 8, 0) / 1000, Date.UTC(2026, 6, 1, 8, 5) / 1000],
          indicators: {
            quote: [{
              open: [100, null],
              high: [106, 107],
              low: [99, 101],
              close: [105, 0],
              volume: [1, 1],
            }],
          },
        }],
      },
    }, {
      symbol: "DX-Y.NYB",
      interval: "5m",
      now: Date.UTC(2026, 6, 1, 8, 20),
    });

    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].close).toBe(105);
  });
});

function makePayload() {
  return {
    chart: {
      result: [{
        timestamp: [Date.UTC(2026, 6, 1, 8, 0) / 1000, Date.UTC(2026, 6, 1, 8, 5) / 1000],
        indicators: {
          quote: [{
            open: [100, 105],
            high: [106, 108],
            low: [99, 104],
            close: [105, 107],
            volume: [1000, 1200],
          }],
        },
      }],
    },
  };
}
