import type { Candle } from "../candles/types";
import type { InstitutionalReasonCode } from "./institutional-types";

export type StructuralTargetSource =
  | "HTF_BSL"
  | "HTF_SSL"
  | "HTF_SWING"
  | "PREVIOUS_DAY"
  | "SESSION"
  | "FIXED_R_FALLBACK"
  | "NONE";

export type StructuralTakeProfitResult = {
  takeProfit: number;
  targetSource: StructuralTargetSource;
  rr: number;
  targetQuality: number;
  htfConflict: boolean;
  reasons: InstitutionalReasonCode[];
  warnings: InstitutionalReasonCode[];
};

type TargetCandidate = { price: number; source: Exclude<StructuralTargetSource, "FIXED_R_FALLBACK" | "NONE">; quality: number };

export function findStructuralTakeProfit(input: {
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  ltfCandles: Candle[];
  itfCandles: Candle[];
  htfCandles: Candle[];
  atr: number;
  minRR: number;
}): StructuralTakeProfitResult {
  const risk = Math.abs(input.entry - input.stopLoss);
  const candidates = [
    ...swingTargets(input.htfCandles, input.direction, "HTF_SWING", 100),
    ...previousDayTargets(input.htfCandles.length ? input.htfCandles : input.itfCandles, input.direction),
    ...swingTargets(input.itfCandles, input.direction, input.direction === "BUY" ? "HTF_BSL" : "HTF_SSL", 85),
    ...sessionTargets(input.ltfCandles, input.direction),
  ]
    .filter((candidate) => input.direction === "BUY" ? candidate.price > input.entry : candidate.price < input.entry)
    .sort((left, right) => Math.abs(left.price - input.entry) - Math.abs(right.price - input.entry));
  const valid = candidates.find((candidate) => calculateRR(input.entry, input.stopLoss, candidate.price) >= input.minRR);
  const nearest = candidates[0];
  const requiredDistance = risk * input.minRR;
  const fallback = input.entry + (input.direction === "BUY" ? requiredDistance : -requiredDistance);
  const openSpace = !nearest || Math.abs(nearest.price - input.entry) >= requiredDistance * 0.9;
  const selected = valid ?? (openSpace ? { price: fallback, source: "FIXED_R_FALLBACK" as const, quality: 55 } : null);
  const rr = selected ? calculateRR(input.entry, input.stopLoss, selected.price) : 0;
  const htfConflict = Boolean(
    nearest
    && nearest.quality >= 85
    && Math.abs(nearest.price - input.entry) < requiredDistance,
  );
  const reasons: InstitutionalReasonCode[] = [];
  const warnings: InstitutionalReasonCode[] = [];

  if (!selected) reasons.push("NO_VALID_2_5R_TARGET");
  if (htfConflict && !valid) reasons.push("HTF_OBSTACLE_BEFORE_TP");
  if (selected) reasons.push(targetReason(selected.source, input.direction));

  return {
    takeProfit: selected?.price ?? input.entry,
    targetSource: selected?.source ?? "NONE",
    rr,
    targetQuality: selected?.quality ?? 0,
    htfConflict,
    reasons,
    warnings,
  };
}

function swingTargets(
  candles: Candle[],
  direction: "BUY" | "SELL",
  source: "HTF_SWING" | "HTF_BSL" | "HTF_SSL",
  quality: number,
): TargetCandidate[] {
  const output: TargetCandidate[] = [];
  for (let index = 2; index < candles.length - 2; index += 1) {
    const candle = candles[index];
    const window = candles.slice(index - 2, index + 3);
    if (direction === "BUY" && candle.high === Math.max(...window.map((item) => item.high))) {
      output.push({ price: candle.high, source, quality });
    }
    if (direction === "SELL" && candle.low === Math.min(...window.map((item) => item.low))) {
      output.push({ price: candle.low, source, quality });
    }
  }
  return output;
}

function previousDayTargets(candles: Candle[], direction: "BUY" | "SELL"): TargetCandidate[] {
  if (!candles.length) return [];
  const latestDay = new Date(candles.at(-1)!.timestamp).toISOString().slice(0, 10);
  const previous = candles.filter((candle) => new Date(candle.timestamp).toISOString().slice(0, 10) < latestDay);
  if (!previous.length) return [];
  return [{
    price: direction === "BUY" ? Math.max(...previous.map((candle) => candle.high)) : Math.min(...previous.map((candle) => candle.low)),
    source: "PREVIOUS_DAY",
    quality: 90,
  }];
}

function sessionTargets(candles: Candle[], direction: "BUY" | "SELL"): TargetCandidate[] {
  const recent = candles.slice(-96);
  if (!recent.length) return [];
  return [{
    price: direction === "BUY" ? Math.max(...recent.map((candle) => candle.high)) : Math.min(...recent.map((candle) => candle.low)),
    source: "SESSION",
    quality: 65,
  }];
}

function calculateRR(entry: number, stop: number, target: number): number {
  const risk = Math.abs(entry - stop);
  return risk > 0 ? Math.abs(target - entry) / risk : 0;
}

function targetReason(source: StructuralTargetSource, direction: "BUY" | "SELL"): InstitutionalReasonCode {
  if (source === "HTF_BSL" || (source === "HTF_SWING" && direction === "BUY")) return "HTF_BSL_TARGET_SELECTED";
  if (source === "HTF_SWING" && direction === "SELL") return "HTF_SSL_TARGET_SELECTED";
  if (source === "HTF_SSL") return "HTF_SSL_TARGET_SELECTED";
  if (source === "PREVIOUS_DAY") return "PREVIOUS_DAY_TARGET_SELECTED";
  if (source === "SESSION") return "SESSION_TARGET_SELECTED";
  return "FIXED_R_FALLBACK_SELECTED";
}
