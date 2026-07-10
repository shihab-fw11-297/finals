import type { TradeSignal } from "../entry-engine/types";
import type { MarketContextResult, TradingSession } from "../market-context/types";
import type { InstitutionalReasonCode, TradingAppMode } from "./institutional-types";

export type InstitutionalStrategyType = "CONTINUATION" | "LIQUIDITY_REVERSAL" | "ASIAN_SPECIFIC";

export type KillzoneGatekeeperResult = {
  passed: boolean;
  sessionType: TradingSession;
  allowedStrategyType: InstitutionalStrategyType;
  reasons: InstitutionalReasonCode[];
  warnings: InstitutionalReasonCode[];
};

const CONTINUATION = new Set([
  "FVG_CONTINUATION_ENTRY",
  "ORDER_BLOCK_RETEST_CONFIRMATION",
  "ICT_OTE_CONTINUATION_ENGINE",
  "ICT_OTE_RETRACEMENT_ENGINE",
  "EMA_TREND_PULLBACK",
  "VWAP_EMA_REGIME_PULLBACK",
]);
const ASIAN_SPECIFIC = new Set([
  "GOLDMINE_ASIAN_SWEEP_REVERSAL",
  "ASIAN_RANGE_BREAKOUT_RETEST",
]);

export function getInstitutionalStrategyType(signal: TradeSignal, strategyId: string): InstitutionalStrategyType {
  if (ASIAN_SPECIFIC.has(strategyId)) return "ASIAN_SPECIFIC";
  if (
    CONTINUATION.has(strategyId)
    || (strategyId === "TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE"
      && signal.tjrSimpleStructurePullback?.modelUsed === "TREND_CONTINUATION")
    || (strategyId === "STOCK_GURU_SWEEP_FVG_OB_ENGINE"
      && signal.stockGuruSweepFvgOb?.modelUsed === "CONTINUATION")
  ) {
    return "CONTINUATION";
  }
  return "LIQUIDITY_REVERSAL";
}

export function applyKillzoneGatekeeper(input: {
  signal: TradeSignal;
  strategyId: string;
  session: TradingSession;
  confirmationTime: number;
  appMode: TradingAppMode;
  marketContext?: MarketContextResult;
}): KillzoneGatekeeperResult {
  const strategyType = getInstitutionalStrategyType(input.signal, input.strategyId);
  const production = input.appMode === "PRODUCTION";
  const reasons: InstitutionalReasonCode[] = [];
  const warnings: InstitutionalReasonCode[] = [];

  if (input.session === "DEAD_ZONE") {
    if (production) reasons.push("DEAD_ZONE_REJECTED");
    else warnings.push("RESEARCH_MODE_SESSION_WARNING_ONLY");
  } else if (strategyType === "CONTINUATION" && input.session === "ASIAN") {
    if (production) reasons.push("ASIAN_CONTINUATION_REJECTED", "CONTINUATION_REJECTED_OUTSIDE_KILLZONE");
    else warnings.push("RESEARCH_MODE_SESSION_WARNING_ONLY");
  } else if (
    strategyType === "CONTINUATION"
    && input.session !== "LONDON"
    && input.session !== "NEW_YORK"
    && input.session !== "LONDON_NEW_YORK_OVERLAP"
  ) {
    if (production) reasons.push("CONTINUATION_REJECTED_OUTSIDE_KILLZONE");
    else warnings.push("RESEARCH_MODE_SESSION_WARNING_ONLY");
  } else if (input.session === "ASIAN" && strategyType === "LIQUIDITY_REVERSAL") {
    warnings.push("ASIAN_REQUIRES_HIGHER_CONFLUENCE");
  } else {
    reasons.push("SESSION_ALLOWED");
  }

  return {
    passed: !production || !reasons.some((reason) => reason !== "SESSION_ALLOWED"),
    sessionType: input.session,
    allowedStrategyType: strategyType,
    reasons,
    warnings,
  };
}

