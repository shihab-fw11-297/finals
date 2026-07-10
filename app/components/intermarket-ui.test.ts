import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("intermarket macro UI wiring", () => {
  it("shows the macro panel and chart overlay toggle on the chart page", () => {
    const source = readFileSync("app/components/market-chart-app.tsx", "utf8");

    expect(source).toContain("IntermarketMacroPanel");
    expect(source).toContain("Show Intermarket Overlay");
    expect(source).toContain("/api/market/intermarket?interval=5m&range=1d");
  });

  it("shows macro grade in signal history and chart tooltip", () => {
    const tableSource = readFileSync("app/components/signal-history-table.tsx", "utf8");
    const chartSource = readFileSync("app/components/candlestick-chart.tsx", "utf8");

    expect(tableSource).toContain("\"Macro\"");
    expect(tableSource).toContain("signal.intermarket?.macroGrade");
    expect(chartSource).toContain("buildIntermarketTooltipHtml");
    expect(chartSource).toContain("Macro Confirmation");
  });

  it("offers compact XAUUSD and BTCUSD symbol choices", () => {
    const source = readFileSync("app/components/market-chart-app.tsx", "utf8");

    expect(source).toContain("const SYMBOL_OPTIONS = [\"XAUUSD\", \"BTCUSD\"]");
    expect(source).toContain("md:grid-cols-[110px_120px_190px_190px_150px_auto_auto]");
  });

  it("offers 30m in the timeframe controls", () => {
    const appSource = readFileSync("app/components/market-chart-app.tsx", "utf8");
    const chartSource = readFileSync("app/components/candlestick-chart.tsx", "utf8");

    expect(appSource).toContain("const TIMEFRAMES: Timeframe[] = [\"1m\", \"5m\", \"15m\", \"30m\", \"1h\"]");
    expect(chartSource).toContain("['1m', '5m', '15m', '30m', '1h']");
  });
});
