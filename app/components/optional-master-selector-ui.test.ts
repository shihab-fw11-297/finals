import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "app/components/market-chart-app.tsx"), "utf8");

describe("optional master selector UI", () => {
  it("defaults the optional master selector off with raw signal display mode", () => {
    expect(source).toContain("useState(false)");
    expect(source).toContain('useState<SignalDisplayMode>("RAW_SIGNALS")');
  });

  it("renders the Enable Master Selector control and disabled raw-message", () => {
    expect(source).toContain("Enable Master Selector");
    expect(source).toContain("Master Selector is disabled. Displaying raw strategy signals.");
  });

  it("supports all requested optional display modes and controls", () => {
    expect(source).toContain('"RAW_SIGNALS", "MASTER_SELECTED", "BOTH"');
    expect(source).toContain("Optional Cooldown");
    expect(source).toContain("Show suppressed signals");
    expect(source).toContain("Show conflict warnings");
  });
});
