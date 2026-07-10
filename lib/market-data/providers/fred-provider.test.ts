import { describe, expect, it } from "vitest";

import { fetchFredSeries, parseFredSeriesPayload } from "./fred-provider";

describe("FRED daily provider", () => {
  it("ignores dot values and calculates changes and slopes", () => {
    const result = parseFredSeriesPayload({
      observations: [
        { date: "2026-07-06", value: "4.20" },
        { date: "2026-07-05", value: "." },
        { date: "2026-07-04", value: "4.10" },
        { date: "2026-07-03", value: "4.05" },
        { date: "2026-07-02", value: "4.00" },
        { date: "2026-07-01", value: "3.95" },
      ],
    }, "DGS10");

    expect(result.series).toMatchObject({
      seriesId: "DGS10",
      latestValue: 4.2,
      previousValue: 4.1,
      oneDayChange: 0.1,
      threeDaySlope: 0.2,
      fiveDaySlope: null,
      bias: "RISING",
      latestDate: "2026-07-06",
    });
  });

  it("returns a missing-key warning without throwing", async () => {
    await expect(fetchFredSeries({ seriesId: "DFII10", apiKey: "your_fred_key_here" })).resolves.toEqual({
      series: null,
      warnings: ["FRED_API_KEY_MISSING"],
    });
  });
});
