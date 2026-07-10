import type { InstitutionalReasonCode, InstitutionalRiskState } from "./institutional-types";

export type RiskManagementResult = {
  passed: boolean;
  riskPercent: number;
  riskMultiplier: number;
  estimatedRiskPoints: number;
  lotSize: number | null;
  reasons: InstitutionalReasonCode[];
  warnings: InstitutionalReasonCode[];
  status: string;
};

export function evaluateProductionRisk(input: {
  riskState?: InstitutionalRiskState;
  entry: number;
  stopLoss: number;
  maxSignalsPerDay?: number;
}): RiskManagementResult {
  const state = input.riskState ?? {};
  const reasons: InstitutionalReasonCode[] = [];
  const warnings: InstitutionalReasonCode[] = [];
  const consecutiveLosses = state.consecutiveLosses ?? 0;
  const riskMultiplier = consecutiveLosses >= 2 ? 0.5 : 1;
  const riskPercent = (state.aggressiveRiskEnabled ? 2 : 1) * riskMultiplier;

  if ((state.dailyLossR ?? 0) >= 3 || (state.dailyLossPercent ?? 0) >= 6) reasons.push("DAILY_RISK_LIMIT_REACHED");
  if ((state.weeklyLossR ?? 0) >= 6 || (state.weeklyLossPercent ?? 0) >= 12) reasons.push("WEEKLY_RISK_LIMIT_REACHED");
  if (consecutiveLosses >= 3) reasons.push("CONSECUTIVE_LOSS_LIMIT_REACHED");
  if ((state.productionSignalsToday ?? 0) >= (input.maxSignalsPerDay ?? 3)) reasons.push("MAX_DAILY_SIGNALS_REACHED");
  if ((state.productionSignalsThisSession ?? 0) >= 1) reasons.push("MAX_SESSION_SIGNALS_REACHED");
  if (
    typeof state.spreadPoints === "number"
    && typeof state.maxSpreadPoints === "number"
    && state.spreadPoints > state.maxSpreadPoints
  ) {
    reasons.push("SPREAD_TOO_HIGH");
  }

  const brokerReady = [
    state.brokerContractSize,
    state.brokerTickValue,
    state.commissionPerLot,
    state.accountCurrencyConversion,
  ].every((value) => typeof value === "number" && Number.isFinite(value));
  if (!brokerReady) warnings.push("LOT_SIZE_ESTIMATE_ONLY");

  return {
    passed: reasons.length === 0,
    riskPercent,
    riskMultiplier,
    estimatedRiskPoints: Math.abs(input.entry - input.stopLoss),
    lotSize: null,
    reasons,
    warnings,
    status: reasons.length ? reasons.join(", ") : `PASS_${riskPercent.toFixed(1)}_PERCENT_RISK`,
  };
}

