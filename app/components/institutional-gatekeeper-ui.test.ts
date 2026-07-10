import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "app/components/market-chart-app.tsx"), "utf8");

describe("institutional gatekeeper UI", () => {
  it("provides explicit Research and Production modes", () => {
    expect(source).toContain('"RESEARCH", "PRODUCTION"');
    expect(source).toContain("Production Institutional");
  });

  it("renders exact NO_TRADE reason codes from the gatekeeper", () => {
    expect(source).toContain("selection.debug.noTradeReasons");
    expect(source).toContain("{reason}");
  });

  it("hides raw Production markers unless the audit toggle is enabled", () => {
    expect(source).toContain("showProductionRawMarkers ? [...rawStrategySignals, ...finalSignals] : finalSignals");
    expect(source).toContain("Show raw research markers");
  });

  it("shows all six factor labels and structural execution sources", () => {
    expect(source).toContain("Risk:Reward and Structural Trade Quality");
    expect(source).toContain("signal.stopSource");
    expect(source).toContain("signal.targetSource");
  });
});
