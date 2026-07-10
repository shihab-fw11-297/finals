import type { Candle } from "../candles/types";
import type { TradeSignal } from "../entry-engine/types";
import type { InstitutionalMode, InstitutionalReasonCode } from "./institutional-types";

export type StructuralStopSource = "SWEEP" | "ORDER_BLOCK" | "FVG" | "RETEST" | "SWING" | "NONE";

export type StructuralStopResult = {
  stopLoss: number;
  stopSource: StructuralStopSource;
  structuralInvalidationPrice: number;
  atrDistance: number;
  valid: boolean;
  reasons: InstitutionalReasonCode[];
  warnings: InstitutionalReasonCode[];
};

type StopCandidate = { price: number; source: Exclude<StructuralStopSource, "NONE"> };

export function calculateStructuralStop(input: {
  signal: TradeSignal;
  setupEvidence?: unknown;
  direction: "BUY" | "SELL";
  atr: number;
  candles: Candle[];
  strategyId: string;
  mode?: InstitutionalMode;
}): StructuralStopResult {
  const { signal, direction } = input;
  const atr = Math.max(input.atr, Number.EPSILON);
  const candidates = getStopCandidates(signal, direction, input.candles);
  const candidate = candidates.find((item) =>
    direction === "BUY" ? item.price < signal.entryPrice : item.price > signal.entryPrice,
  );
  const buffer = atr * (input.mode === "strict" ? 0.2 : 0.15);
  const structuralPrice = candidate?.price ?? signal.stopLoss;
  const stopLoss = candidate
    ? structuralPrice + (direction === "BUY" ? -buffer : buffer)
    : signal.stopLoss;
  const atrDistance = Math.abs(signal.entryPrice - stopLoss) / atr;
  const maxAtr = input.mode === "strict" ? 2.5 : 3;
  const reasons: InstitutionalReasonCode[] = [];
  const warnings: InstitutionalReasonCode[] = [];

  if (!candidate) reasons.push("STOP_NOT_STRUCTURAL");
  if (candidate) {
    reasons.push("STRUCTURAL_STOP_FOUND", sourceReason(candidate.source));
  }
  if (atrDistance > maxAtr || atrDistance > 4) reasons.push("STOP_TOO_WIDE");
  if (atrDistance < 0.15) reasons.push("STOP_INSIDE_NOISE");

  return {
    stopLoss,
    stopSource: candidate?.source ?? "NONE",
    structuralInvalidationPrice: structuralPrice,
    atrDistance,
    valid: Boolean(candidate) && atrDistance >= 0.15 && atrDistance <= maxAtr && atrDistance <= 4,
    reasons,
    warnings,
  };
}

function getStopCandidates(signal: TradeSignal, direction: "BUY" | "SELL", candles: Candle[]): StopCandidate[] {
  const candidates: StopCandidate[] = [];
  const stock = signal.stockGuruSweepFvgOb;
  const silver = signal.silverBullet;
  const liquidity = signal.liquiditySweepReversal;
  const orderBlock = signal.orderBlockRetest;
  const fvg = signal.fvgContinuation;

  push(candidates, stock?.liquidity.sweepPrice, "SWEEP");
  push(candidates, silver?.sweep.extreme, "SWEEP");
  push(candidates, signal.sweep?.extremePrice, "SWEEP");
  if (liquidity) {
    const sweepCandle = candles[liquidity.sweep.candleIndex];
    push(candidates, direction === "BUY" ? sweepCandle?.low : sweepCandle?.high, "SWEEP");
  }
  push(candidates, direction === "BUY" ? stock?.orderBlock.low : stock?.orderBlock.high, "ORDER_BLOCK");
  push(candidates, direction === "BUY" ? orderBlock?.orderBlock.bottom : orderBlock?.orderBlock.top, "ORDER_BLOCK");
  push(candidates, direction === "BUY" ? stock?.fvg.low : stock?.fvg.high, "FVG");
  push(candidates, direction === "BUY" ? silver?.fvg.bottom : silver?.fvg.top, "FVG");
  push(candidates, direction === "BUY" ? fvg?.fvg.bottom : fvg?.fvg.top, "FVG");

  const retestIndex = signal.retest?.candleIndex
    ?? orderBlock?.retest.candleIndex
    ?? fvg?.retest.candleIndex;
  if (typeof retestIndex === "number") {
    const retest = candles[retestIndex];
    push(candidates, direction === "BUY" ? retest?.low : retest?.high, "RETEST");
  }

  const startIndex = Math.max(0, signal.confirmedAtIndex - 12);
  const recent = candles.slice(startIndex, signal.confirmedAtIndex + 1);
  for (let index = 2; index < recent.length - 2; index += 1) {
    if (
      direction === "BUY"
      && recent[index].low < Math.min(recent[index - 1].low, recent[index - 2].low, recent[index + 1].low, recent[index + 2].low)
    ) {
      push(candidates, recent[index].low, "SWING");
    }
    if (
      direction === "SELL"
      && recent[index].high > Math.max(recent[index - 1].high, recent[index - 2].high, recent[index + 1].high, recent[index + 2].high)
    ) {
      push(candidates, recent[index].high, "SWING");
    }
  }
  return candidates;
}

function push(items: StopCandidate[], price: number | null | undefined, source: StopCandidate["source"]): void {
  if (typeof price === "number" && Number.isFinite(price)) items.push({ price, source });
}

function sourceReason(source: StopCandidate["source"]): InstitutionalReasonCode {
  if (source === "SWEEP") return "STOP_BEHIND_SWEEP";
  if (source === "ORDER_BLOCK") return "STOP_BEHIND_OB";
  if (source === "FVG") return "STOP_BEHIND_FVG";
  return "STOP_BEHIND_SWING";
}
