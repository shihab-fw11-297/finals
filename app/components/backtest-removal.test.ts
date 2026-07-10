import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

describe("backtest dashboard removal", () => {
  it("removes the dashboard component file", () => {
    expect(existsSync(join(projectRoot, "app/components/backtest-dashboard.tsx"))).toBe(false);
  });

  it("keeps app components free of backtest dashboard imports and chart trade overlays", () => {
    const appFiles = [
      "app/components/market-chart-app.tsx",
      "app/components/candlestick-chart.tsx",
      "app/page.tsx",
    ];
    const forbidden = [
      "BacktestDashboard",
      "backtest-dashboard",
      "backtestTrades",
      "selectedBacktestTradeId",
      "runBacktest(",
    ];

    for (const file of appFiles) {
      const source = readFileSync(join(projectRoot, file), "utf8");
      for (const token of forbidden) {
        expect(source.includes(token), `${file} contains ${token}`).toBe(false);
      }
    }
  });
});
