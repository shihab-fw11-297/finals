import type { Candle } from "../candles/types";
import type { InstitutionalReasonCode } from "./institutional-types";

export type HTFLiquidityContextResult = {
  aligned: boolean;
  suppressed: boolean;
  nearestHTFTarget: number | null;
  nearestHTFObstacle: number | null;
  distanceToTargetAtr: number | null;
  distanceToObstacleAtr: number | null;
  reasons: InstitutionalReasonCode[];
  warnings: InstitutionalReasonCode[];
};

export function evaluateHTFLiquidityContext(input: {
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  itfCandles: Candle[];
  htfCandles: Candle[];
  atr: number;
}): HTFLiquidityContextResult {
  const candles = input.htfCandles.length ? input.htfCandles : input.itfCandles;
  const levels = findMajorLevels(candles);
  const directional = levels
    .filter((price) => input.direction === "BUY" ? price > input.entry : price < input.entry)
    .sort((left, right) => Math.abs(left - input.entry) - Math.abs(right - input.entry));
  const opposing = levels
    .filter((price) => input.direction === "BUY" ? price < input.entry : price > input.entry)
    .sort((left, right) => Math.abs(left - input.entry) - Math.abs(right - input.entry));
  const target = directional[0] ?? null;
  const obstacle = directional.find((price) =>
    input.direction === "BUY"
      ? price < input.takeProfit - Math.max(input.atr, Number.EPSILON) * 0.05
      : price > input.takeProfit + Math.max(input.atr, Number.EPSILON) * 0.05,
  ) ?? null;
  const atr = Math.max(input.atr, Number.EPSILON);
  const distanceToTargetAtr = target === null ? null : Math.abs(target - input.entry) / atr;
  const distanceToObstacleAtr = obstacle === null ? null : Math.abs(obstacle - input.entry) / atr;
  const requiredRoom = Math.abs(input.entry - input.stopLoss) * 2.5;
  const suppressed = Boolean(obstacle && Math.abs(obstacle - input.entry) < requiredRoom);
  const bias = candleBias(candles);
  const opposesDraw = (input.direction === "SELL" && bias === "BULLISH")
    || (input.direction === "BUY" && bias === "BEARISH");
  const reasons: InstitutionalReasonCode[] = [];
  const warnings: InstitutionalReasonCode[] = [];

  if (suppressed) {
    reasons.push(input.direction === "BUY" ? "BUY_INTO_HTF_BSL" : "SELL_INTO_HTF_SSL", "HTF_OBSTACLE_TOO_CLOSE");
  }
  if (opposesDraw) reasons.push("HTF_DRAW_ON_LIQUIDITY_OPPOSES_SIGNAL");
  if (!suppressed && !opposesDraw) reasons.push("HTF_CONTEXT_ALIGNED");

  return {
    aligned: !suppressed && !opposesDraw,
    suppressed: suppressed || opposesDraw,
    nearestHTFTarget: target,
    nearestHTFObstacle: obstacle ?? opposing[0] ?? null,
    distanceToTargetAtr,
    distanceToObstacleAtr,
    reasons,
    warnings,
  };
}

export function deriveCandleBias(candles: Candle[]): "BULLISH" | "BEARISH" | "NEUTRAL" {
  return candleBias(candles);
}

function findMajorLevels(candles: Candle[]): number[] {
  const output: number[] = [];
  for (let index = 2; index < candles.length - 2; index += 1) {
    const window = candles.slice(index - 2, index + 3);
    const candle = candles[index];
    if (candle.high === Math.max(...window.map((item) => item.high))) output.push(candle.high);
    if (candle.low === Math.min(...window.map((item) => item.low))) output.push(candle.low);
  }
  return output;
}

function candleBias(candles: Candle[]): "BULLISH" | "BEARISH" | "NEUTRAL" {
  const recent = candles.slice(-8);
  if (recent.length < 3) return "NEUTRAL";
  const delta = recent.at(-1)!.close - recent[0].close;
  const range = Math.max(...recent.map((candle) => candle.high)) - Math.min(...recent.map((candle) => candle.low));
  if (range <= 0 || Math.abs(delta) / range < 0.2) return "NEUTRAL";
  return delta > 0 ? "BULLISH" : "BEARISH";
}
