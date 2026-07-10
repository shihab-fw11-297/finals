import { memo } from "react";

import type { EntryEngineResult, EntryMode, TradeSignal } from "@/lib/entry-engine/types";
import {
  ACTIVE_SIGNAL_ENGINE_LABEL,
  GOLDMINE_CONFIG,
  GOLDMINE_STRATEGY_ID,
  BREAKOUT_STRATEGY_ID,
  ASIAN_BREAKOUT_CONFIG,
  ICT_SILVER_BULLET_CONFIG,
  ICT_SILVER_BULLET_STRATEGY_ID,
  VWAP_EMA_REGIME_PULLBACK_CONFIG,
  VWAP_EMA_STRATEGY_ID,
  EMA_TREND_PULLBACK_CONFIG,
  EMA_TREND_PULLBACK_STRATEGY_ID,
  LIQUIDITY_SWEEP_REVERSAL_PRO_CONFIG,
  LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID,
  ORDER_BLOCK_RETEST_CONFIG,
  ORDER_BLOCK_RETEST_STRATEGY_ID,
  FVG_CONTINUATION_ENTRY_CONFIG,
  FVG_CONTINUATION_ENTRY_STRATEGY_ID,
  PRO_LIQUIDITY_CONFLUENCE_CONFIG,
  PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID,
  STOCK_GURU_SWEEP_FVG_OB_CONFIG,
  STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
  TJR_SIMPLE_STRUCTURE_PULLBACK_CONFIG,
  TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID,
  ICT_OTE_CONTINUATION_CONFIG,
  ICT_OTE_CONTINUATION_STRATEGY_ID,
  ICT_IFVG_REVERSAL_CONFIG,
  ICT_IFVG_REVERSAL_STRATEGY_ID,
} from "@/lib/v2-signal-engine";


type SignalDebugPanelProps = {
  result: EntryEngineResult;
  selectedSignal: TradeSignal | null;
  cacheStatusLabel: string;
  generationTimeLabel: string;
};

function SignalDebugPanelComponent({ result, selectedSignal, cacheStatusLabel, generationTimeLabel }: SignalDebugPanelProps) {
  const signal = selectedSignal ?? result.signals.at(-1) ?? null;
  const audit = result.audit;
  const activeStrat = audit.strategyId ?? "ALL_V2";

  return (
    <section className="border border-[#2a2e39] bg-[#131722] text-slate-300">
      <div className="flex items-center justify-between border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase text-slate-100">Signal Debug</h2>
          <p className="mt-1 text-xs text-slate-400">Active Signal Engine: {ACTIVE_SIGNAL_ENGINE_LABEL}</p>
        </div>
        <span className="border border-[#2a2e39] px-2 py-1 text-xs font-semibold text-slate-200">
          Default Rules
        </span>
      </div>

      <div className="grid grid-cols-2 gap-px bg-[#2a2e39] text-xs">
        <Metric label="Candles scanned" value={audit.totalCandlesScanned} />
        <Metric label="Markers generated" value={audit.totalMarkersGenerated} />
        <Metric label="Contexts generated" value={audit.totalContextsGenerated} />
        <Metric label="Phase 4 setups" value={audit.totalPhase4Setups} />
        <Metric label="WATCH" value={audit.watchCount} />
        <Metric label="SETUP" value={audit.setupCount} />
        <Metric label="Setups scanned" value={audit.totalSetupsScanned} />
        <Metric label="Triggers found" value={audit.triggerSetupsFound} />
        <Metric label="INVALIDATED" value={audit.invalidatedCount} />
        <Metric label="EXPIRED" value={audit.expiredCount} />
        <Metric label="Confirmed BUY" value={audit.confirmedBuyCount} />
        <Metric label="Confirmed SELL" value={audit.confirmedSellCount} />
        <Metric label="Rapid BUY" value={audit.rapidBuyCount} />
        <Metric label="Rapid SELL" value={audit.rapidSellCount} />
        <Metric label="Rapid signals" value={audit.rapidSignalCount} />
        <Metric label="Rejected" value={audit.rejectedSetupCount} />
        <Metric label="Pending confirm" value={audit.pendingConfirmationCount} />
        <Metric label="Expired confirm" value={audit.expiredConfirmationCount} />
        <Metric label="Invalidated candidates" value={audit.invalidatedCandidateCount} />
        <Metric label="Min setup score" value={audit.minimumSetupScoreRequired} />
        <Metric label="Min signal score" value={audit.minimumSignalScoreRequired} />
        <Metric label="Min RR" value={`${audit.minimumRrRequired.toFixed(1)}R`} />
        <Metric label="Generation ms" value={generationTimeLabel} />
        <Metric label="No repaint" value={audit.noRepaintValidation} />
        <Metric label="Cache" value={cacheStatusLabel} />
      </div>

      {result.optionalMasterSelection ? <OptionalMasterSelectorDetail selection={result.optionalMasterSelection} /> : null}

      {audit.v2Goldmine ? <V2GoldmineDetail audit={audit.v2Goldmine} /> : null}
      {audit.v2Breakout ? <V2BreakoutDetail audit={audit.v2Breakout} /> : null}
      {audit.v2SilverBullet ? <V2SilverBulletDetail audit={audit.v2SilverBullet} /> : null}
      {audit.v2VwapEma ? <V2VwapEmaDetail audit={audit.v2VwapEma} /> : null}
      {audit.v2EmaTrendPullback ? <V2EmaTrendPullbackDetail audit={audit.v2EmaTrendPullback} /> : null}
      {audit.v2LiquiditySweepReversalPro ? <V2LiquiditySweepReversalProDetail audit={audit.v2LiquiditySweepReversalPro} /> : null}
      {audit.v2OrderBlockRetest ? <V2OrderBlockRetestDetail audit={audit.v2OrderBlockRetest} /> : null}
      {audit.v2FvgContinuation ? <V2FvgContinuationDetail audit={audit.v2FvgContinuation} /> : null}
      {audit.v2ProLiquidityConfluence ? <V2ProLiquidityConfluenceDetail audit={audit.v2ProLiquidityConfluence} /> : null}
      {audit.v2StockGuruSweepFvgOb ? <V2StockGuruSweepFvgObDetail audit={audit.v2StockGuruSweepFvgOb} /> : null}
      {audit.v2TjrSimpleStructurePullback ? <V2TjrSimpleStructurePullbackDetail audit={audit.v2TjrSimpleStructurePullback} /> : null}
      {audit.v2IctOteContinuation ? <V2IctOteContinuationDetail audit={audit.v2IctOteContinuation} /> : null}
      {audit.v2IctIfvgReversal ? <V2IctIfvgReversalDetail audit={audit.v2IctIfvgReversal} /> : null}

      {(activeStrat === GOLDMINE_STRATEGY_ID || activeStrat === "ALL_V2") && <GoldmineConfigDetail />}

      {(activeStrat === BREAKOUT_STRATEGY_ID || activeStrat === "ALL_V2") && <BreakoutConfigDetail />}
      {(activeStrat === ICT_SILVER_BULLET_STRATEGY_ID || activeStrat === "ALL_V2") && <SilverBulletConfigDetail />}
      {(activeStrat === VWAP_EMA_STRATEGY_ID || activeStrat === "ALL_V2") && <VwapEmaConfigDetail />}
      {(activeStrat === EMA_TREND_PULLBACK_STRATEGY_ID || activeStrat === "ALL_V2") && <EmaTrendPullbackConfigDetail />}
      {(activeStrat === LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID || activeStrat === "ALL_V2") && <LiquiditySweepReversalProConfigDetail />}
      {(activeStrat === ORDER_BLOCK_RETEST_STRATEGY_ID || activeStrat === "ALL_V2") && <OrderBlockRetestConfigDetail />}
      {(activeStrat === FVG_CONTINUATION_ENTRY_STRATEGY_ID || activeStrat === "ALL_V2") && <FvgContinuationConfigDetail />}
      {(activeStrat === PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID || activeStrat === "ALL_V2") && <ProLiquidityConfluenceConfigDetail />}
      {(activeStrat === STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID || activeStrat === "ALL_V2") && <StockGuruSweepFvgObConfigDetail />}
      {(activeStrat === TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID || activeStrat === "ALL_V2") && <TjrSimpleStructurePullbackConfigDetail />}
      {(activeStrat === ICT_OTE_CONTINUATION_STRATEGY_ID || activeStrat === "ALL_V2") && <IctOteContinuationConfigDetail />}
      {(activeStrat === ICT_IFVG_REVERSAL_STRATEGY_ID || activeStrat === "ALL_V2") && <IctIfvgReversalConfigDetail />}


      {signal ? <SignalDetail signal={signal} /> : <NoTradeDetail result={result} />}

      <div className="border-t border-[#2a2e39] px-4 py-3 text-xs text-slate-300">
        {audit.noSignalMessage ? <p className="mb-2 font-semibold text-amber-300">{audit.noSignalMessage}</p> : null}
        <p><strong className="text-slate-100">Last rejection:</strong> {audit.lastRejectionReason ?? "None"}</p>
        <p className="mt-1"><strong className="text-slate-100">RR:</strong> {audit.rrCalculation ?? "Not available"}</p>
        <p className="mt-1"><strong className="text-slate-100">SL source:</strong> {audit.stopLossSource ?? "Not available"}</p>
        <p className="mt-1"><strong className="text-slate-100">TP source:</strong> {audit.takeProfitSource ?? "Not available"}</p>
        <DebugList title="Top rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count})`)} />
        <DebugList title="Last trigger setups" values={audit.lastFiveTriggerSetups} />
        <DebugList title="Last confirmed signals" values={audit.lastFiveConfirmedSignals} />
        <CandidateDebugList values={result.candidateDebug.slice(-8)} />
        <DebugList title="No-repaint warnings" values={audit.noRepaintWarnings} />
      </div>
    </section>
  );
}

export const SignalDebugPanel = memo(SignalDebugPanelComponent);

function OptionalMasterSelectorDetail({ selection }: { selection: NonNullable<EntryEngineResult["optionalMasterSelection"]> }) {
  const debug = selection.debug;
  return (
    <div className="border-b border-[#2a2e39] bg-[#171b26] px-4 py-3 text-xs text-slate-300">
      <p className="font-semibold text-amber-300">OPTIONAL_MASTER_SIGNAL_SELECTOR DEBUG</p>
      {!selection.enabled ? <p className="mt-2 text-slate-400">Master Selector disabled. Raw signals are displayed.</p> : null}
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
        <span>Raw: {debug.rawSignalCount ?? selection.rawSignals.length}</span>
        <span>Groups: {debug.groupCount ?? selection.groupedSignals.length}</span>
        <span>Final: {debug.finalSignalCount ?? selection.finalSignals.length}</span>
        <span>Suppressed: {debug.suppressedCount ?? selection.suppressedSignals.length}</span>
        <span>Conflicts: {debug.conflictCount ?? selection.conflictSignals.length}</span>
      </div>
      <DebugList title="Selected optional master signals" values={(debug.selectedSignals ?? []).map((item) => `${item.strategy} | ${item.score.toFixed(1)} | ${item.reason}`)} />
      <DebugList title="Suppressed duplicate audit" values={selection.suppressedSignals.map((item) => `${item.signalId} | ${item.strategy} | ${item.reason}`)} />
      <DebugList title="Conflict decisions" values={selection.conflictSignals.map((item) => `${item.decision}: ${item.reason}`)} />
      <DebugList title="Master no-trade reasons" values={debug.noTradeReasons ?? []} />
      <DebugList title="Master warnings" values={debug.warnings ?? []} />
    </div>
  );
}

function GoldmineConfigDetail() {
  const config = GOLDMINE_CONFIG;

  return (
    <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300">
      <p className="font-semibold text-slate-100">V2 Goldmine Default Rules Settings</p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <span>Min signal: {config.minSignalScore}</span>
        <span>Min RR: {config.minRR.toFixed(1)}</span>
        <span>Confirm window: {config.confirmationWindow}c</span>
        <span>Fixed TP fallback: Allowed</span>
      </div>
    </div>
  );
}

function BreakoutConfigDetail() {
  const config = ASIAN_BREAKOUT_CONFIG;

  return (
    <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300">
      <p className="font-semibold text-slate-100">V2 Breakout Default Rules Settings</p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <span>Min signal: {config.minSignalScore}</span>
        <span>Min RR: {config.minRR.toFixed(1)}</span>
        <span>Retest window: {config.retestWindowCandles}c</span>
        <span>Confirm window: {config.confirmationWindow}c</span>
        <span>Body ratio min: {config.breakoutBodyMinRatio.toFixed(2)}</span>
        <span>Retest tol ATR: {config.retestToleranceAtr.toFixed(2)}</span>
      </div>
    </div>
  );
}

function SilverBulletConfigDetail() {
  const config = ICT_SILVER_BULLET_CONFIG;
  return <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-slate-100">ICT Silver Bullet Rules</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><span>Min signal: {config.minSignalScore}</span><span>Min RR: {config.minRR.toFixed(1)}</span><span>FVG return: {config.maxCandlesToReturnToFvg}c</span><span>Timezone: {config.timezone}</span></div></div>;
}

function VwapEmaConfigDetail() {
  const config = VWAP_EMA_REGIME_PULLBACK_CONFIG;
  return <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-slate-100">VWAP EMA Regime Pullback Rules</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><span>Min signal: {config.minSignalScore}</span><span>Min RR: {config.minRR.toFixed(1)}</span><span>EMA: 20 / 50 / 200</span><span>Timezone: {config.sessionTimezone}</span></div></div>;
}

function EmaTrendPullbackConfigDetail() {
  const config = EMA_TREND_PULLBACK_CONFIG;
  return <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-slate-100">EMA Trend Pullback Rules</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><span>Min signal: {config.minSignalScore}</span><span>Min RR: {config.minRR.toFixed(1)}</span><span>EMA: 20 / 50 / 200</span><span>Default TF: {config.defaultTimeframe}</span><span>Max pullback: {config.maxPullbackCandles}c</span><span>Session required: {config.requireSession ? "Yes" : "No"}</span></div></div>;
}

function LiquiditySweepReversalProConfigDetail() {
  const config = LIQUIDITY_SWEEP_REVERSAL_PRO_CONFIG;
  return <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-slate-100">Liquidity Sweep Reversal Pro Rules</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><span>Min signal: {config.minSignalScore}</span><span>Min RR: {config.minRR.toFixed(1)}</span><span>Confirm window: {config.confirmationWindow}c</span><span>Lookback: {config.liquidityLookback}c</span><span>Sweep max ATR: {config.maxSweepDistanceAtr.toFixed(1)}</span><span>Session hard gate: {config.requireSession ? "Yes" : "No"}</span></div></div>;
}

function OrderBlockRetestConfigDetail() {
  const config = ORDER_BLOCK_RETEST_CONFIG;
  return <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-slate-100">Order Block Retest Rules</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><span>Min signal: {config.minSignalScore}</span><span>Min RR: {config.minRR.toFixed(1)}</span><span>Swing lookback: {config.swingLookback}c</span><span>Max retest: {config.maxRetestCandles}c</span><span>OB max age: {config.orderBlockMaxAgeCandles}c</span><span>Structure break: {config.requireStructureBreak ? "Required" : "Optional"}</span></div></div>;
}

function FvgContinuationConfigDetail() {
  const config = FVG_CONTINUATION_ENTRY_CONFIG;
  return <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-slate-100">FVG Continuation Entry Rules</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><span>Min signal: {config.minSignalScore}</span><span>Min RR: {config.minRR.toFixed(1)}</span><span>FVG return: {config.maxCandlesToReturnToFvg}c</span><span>Session hard gate: {config.requireSession ? "Yes" : "No"}</span></div></div>;
}

function ProLiquidityConfluenceConfigDetail() {
  const config = PRO_LIQUIDITY_CONFLUENCE_CONFIG;
  return <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-slate-100">Pro Liquidity Confluence Rules</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><span>Min score: {config.minFactorScoreByMode.normal}/{config.maxScore}</span><span>Min RR: {config.minRRByMode.normal.toFixed(1)}R</span><span>Sweep lookback: {config.liquidityLookback}c</span><span>Zone return: {config.maxCandlesToReturnToZone}c</span><span>Confirm window: {config.confirmationWindow}c</span><span>Session hard gate: No</span></div></div>;
}

function StockGuruSweepFvgObConfigDetail() {
  const config = STOCK_GURU_SWEEP_FVG_OB_CONFIG;
  return <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-slate-100">Stock Guru Sweep FVG OB Rules</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><span>Min score: {config.minSignalScoreByMode.normal}</span><span>Min RR: {config.minRRByMode.normal.toFixed(1)}R</span><span>Sweep lookback: {config.liquidityLookback}c</span><span>Retest: {config.retestWindowByMode.normal}c</span><span>FVG: {config.fvgMinSizeAtrByMode.normal.toFixed(2)}-{config.fvgMaxSizeAtr.toFixed(1)} ATR</span><span>OB: {config.orderBlockMinSizeAtr.toFixed(2)}-{config.orderBlockMaxSizeAtr.toFixed(1)} ATR</span></div></div>;
}

function TjrSimpleStructurePullbackConfigDetail() {
  const config = TJR_SIMPLE_STRUCTURE_PULLBACK_CONFIG;
  return <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-slate-100">TJR Simple Structure Pullback Rules</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><span>Min score: {config.minSignalScoreByMode.normal}</span><span>Min RR: {config.minRRByMode.normal.toFixed(1)}R</span><span>Structure: {config.structureLookback}c</span><span>Retest: {config.retestWindowByMode.normal}c</span><span>FVG: {config.fvgMinSizeAtr.toFixed(2)}-{config.fvgMaxSizeAtr.toFixed(1)} ATR</span><span>OB: {config.orderBlockMinSizeAtr.toFixed(2)}-{config.orderBlockMaxSizeAtr.toFixed(1)} ATR</span></div></div>;
}

function IctOteContinuationConfigDetail() {
  const config = ICT_OTE_CONTINUATION_CONFIG;
  return <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-slate-100">ICT OTE Continuation Rules</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><span>Min score: {config.minFactorScoreByMode.normal}/{config.maxScore}</span><span>Min RR: {config.minRRByMode.normal.toFixed(1)}R</span><span>OTE: 0.62 - 0.79</span><span>Ideal: 0.705</span><span>OTE return: {config.maxCandlesToTouchOte}c</span><span>Confirm window: {config.confirmationWindow}c</span></div></div>;
}

function IctIfvgReversalConfigDetail() {
  const config = ICT_IFVG_REVERSAL_CONFIG;
  return <div className="border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-slate-100">ICT IFVG Reversal Rules</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><span>Min score: {config.minSignalScore}</span><span>Min RR: {config.minRR.toFixed(1)}R</span><span>IFVG return: {config.maxCandlesToReturnToZone}c</span><span>Confirm window: {config.confirmationWindow}c</span><span>ATR buffer: {config.atrInversionBufferMultiplier}x ATR</span></div></div>;
}


function V2GoldmineDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2Goldmine"]> }) {
  return (
    <div className="border-b border-[#2a2e39] bg-emerald-950/25 px-4 py-3 text-xs text-slate-300">
      <p className="font-semibold text-emerald-100">{audit.activeEngineLabel}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Value label="Days detected" value={String(audit.daysDetected)} />
        <Value label="Valid Asian ranges" value={String(audit.validAsianRanges)} />
        <Value label="Invalid ranges" value={String(audit.invalidAsianRanges)} />
        <Value label="Complete ranges" value={String(audit.completeAsianRanges)} />
        <Value label="Partial ranges" value={String(audit.partialAsianRanges)} />
        <Value label="Fallback ranges" value={String(audit.fallbackRanges)} />
        <Value label="Large range warnings" value={String(audit.largeRangeWarnings)} />
        <Value label="No usable range rejects" value={String(audit.noUsableRangeRejections)} />
        <Value label="Partial signals" value={String(audit.confirmedSignalsUsingPartialRange)} />
        <Value label="Large range signals" value={String(audit.confirmedSignalsUsingLargeRange)} />
        <Value label="Asian high sweeps" value={String(audit.asianHighSweeps)} />
        <Value label="Asian low sweeps" value={String(audit.asianLowSweeps)} />
        <Value label="Rejected sweeps" value={String(audit.rejectedSweeps)} />
        <Value label="Confirm found" value={String(audit.confirmationFound)} />
        <Value label="Confirm expired" value={String(audit.confirmationExpired)} />
        <Value label="Confirmed BUY" value={String(audit.confirmedBuyCount)} />
        <Value label="Confirmed SELL" value={String(audit.confirmedSellCount)} />
        <Value label="Rejected" value={String(audit.rejectedCount)} />
        <Value label="Generation ms" value={audit.generationTimeMs.toFixed(2)} />
      </div>
      <DebugList title="V2 Sweep top rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count})`)} />
    </div>
  );
}

function V2BreakoutDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2Breakout"]> }) {
  return (
    <div className="border-b border-[#2a2e39] bg-orange-950/25 px-4 py-3 text-xs text-slate-300">
      <p className="font-semibold text-orange-100">{audit.activeEngineLabel}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Value label="Days detected" value={String(audit.daysDetected)} />
        <Value label="Valid Asian ranges" value={String(audit.validAsianRanges)} />
        <Value label="Invalid ranges" value={String(audit.invalidAsianRanges)} />
        <Value label="Complete ranges" value={String(audit.completeAsianRanges)} />
        <Value label="Partial ranges" value={String(audit.partialAsianRanges)} />
        <Value label="Fallback ranges" value={String(audit.fallbackRanges)} />
        <Value label="Large range warnings" value={String(audit.largeRangeWarnings)} />
        <Value label="No usable range rejects" value={String(audit.noUsableRangeRejections)} />
        <Value label="Partial signals" value={String(audit.confirmedSignalsUsingPartialRange)} />
        <Value label="Large range signals" value={String(audit.confirmedSignalsUsingLargeRange)} />
        <Value label="Bullish breakouts" value={String(audit.bullishBreakouts)} />
        <Value label="Bearish breakouts" value={String(audit.bearishBreakouts)} />
        <Value label="Retests found" value={String(audit.retestsFound)} />
        <Value label="Retests failed" value={String(audit.retestsFailed)} />
        <Value label="Confirm found" value={String(audit.confirmationsFound)} />
        <Value label="Confirm expired" value={String(audit.confirmationsExpired)} />
        <Value label="Confirmed BUY" value={String(audit.confirmedBuyCount)} />
        <Value label="Confirmed SELL" value={String(audit.confirmedSellCount)} />
        <Value label="Rejected" value={String(audit.rejectedCount)} />
        <Value label="Generation ms" value={audit.generationTimeMs.toFixed(2)} />
      </div>
      <DebugList title="V2 Breakout top rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count})`)} />
    </div>
  );
}

function V2SilverBulletDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2SilverBullet"]> }) {
  return <div className="border-b border-[#2a2e39] bg-cyan-950/25 px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-cyan-100">{audit.activeEngineLabel}</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><Value label="Candles scanned" value={String(audit.candlesScanned)} /><Value label="Killzone candles" value={String(audit.killzoneCandles)} /><Value label="Liquidity levels" value={String(audit.liquidityLevelsFound)} /><Value label="Sweeps detected" value={String(audit.sweepsDetected)} /><Value label="Reclaims" value={String(audit.reclaimsConfirmed)} /><Value label="Displacements" value={String(audit.displacementsFound)} /><Value label="MSS / CHoCH" value={String(audit.mssConfirmed)} /><Value label="FVGs created" value={String(audit.fvgsCreated)} /><Value label="FVG retests" value={String(audit.fvgRetestsFound)} /><Value label="Confirm candles" value={String(audit.confirmationCandlesFound)} /><Value label="Confirmed" value={String(audit.confirmedSignals)} /><Value label="Rejected / expired" value={`${audit.rejectedSignals} / ${audit.expiredSetups}`} /></div><DebugList title="Silver Bullet rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count}, ${item.percentage}%)`)} /></div>;
}

function V2VwapEmaDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2VwapEma"]> }) {
  return <div className="border-b border-[#2a2e39] bg-violet-950/25 px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-violet-100">{audit.activeEngineLabel}</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><Value label="Candles scanned" value={String(audit.candlesScanned)} /><Value label="Session candles" value={String(audit.sessionCandles)} /><Value label="Bullish regime" value={String(audit.bullishRegimeCandles)} /><Value label="Bearish regime" value={String(audit.bearishRegimeCandles)} /><Value label="Neutral regime" value={String(audit.neutralRegimeCandles)} /><Value label="Pullbacks found" value={String(audit.pullbacksFound)} /><Value label="Valid pullbacks" value={String(audit.validPullbacks)} /><Value label="Confirm candles" value={String(audit.confirmationCandlesFound)} /><Value label="Confirmed" value={String(audit.confirmedSignals)} /><Value label="Rejected / expired" value={`${audit.rejectedSignals} / ${audit.expiredSetups}`} /></div><DebugList title="VWAP/EMA rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count}, ${item.percentage}%)`)} /></div>;
}

function V2EmaTrendPullbackDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2EmaTrendPullback"]> }) {
  return <div className="border-b border-[#2a2e39] bg-teal-950/25 px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-teal-100">{audit.activeEngineLabel}</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><Value label="Candles scanned" value={String(audit.candlesScanned)} /><Value label="Session candles" value={String(audit.sessionCandles)} /><Value label="Bullish trend" value={String(audit.bullishTrendCandles)} /><Value label="Bearish trend" value={String(audit.bearishTrendCandles)} /><Value label="Neutral trend" value={String(audit.neutralTrendCandles)} /><Value label="Pullbacks found" value={String(audit.pullbacksFound)} /><Value label="Valid pullbacks" value={String(audit.validPullbacks)} /><Value label="Confirm candles" value={String(audit.confirmationCandlesFound)} /><Value label="Confirmed" value={String(audit.confirmedSignals)} /><Value label="Rejected / expired" value={`${audit.rejectedSignals} / ${audit.expiredSetups}`} /></div><DebugList title="EMA trend rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count}, ${item.percentage}%)`)} /></div>;
}

function V2LiquiditySweepReversalProDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2LiquiditySweepReversalPro"]> }) {
  return <div className="border-b border-[#2a2e39] bg-rose-950/25 px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-rose-100">{audit.activeEngineLabel}</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><Value label="Candles scanned" value={String(audit.candlesScanned)} /><Value label="Liquidity levels" value={String(audit.liquidityLevelsFound)} /><Value label="Sweeps detected" value={String(audit.sweepsDetected)} /><Value label="Reclaims" value={String(audit.reclaimsConfirmed)} /><Value label="Confirm candles" value={String(audit.confirmationCandlesFound)} /><Value label="Confirmed" value={String(audit.confirmedSignals)} /><Value label="Rejected" value={String(audit.rejectedSignals)} /><Value label="Expired" value={String(audit.expiredSetups)} /></div><DebugList title="Liquidity sweep rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count}, ${item.percentage}%)`)} /></div>;
}

function V2OrderBlockRetestDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2OrderBlockRetest"]> }) {
  return <div className="border-b border-[#2a2e39] bg-amber-950/25 px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-amber-100">{audit.activeEngineLabel}</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><Value label="Candles scanned" value={String(audit.candlesScanned)} /><Value label="Structure breaks" value={String(audit.structureBreaksFound)} /><Value label="OBs created" value={String(audit.orderBlocksCreated)} /><Value label="Valid OBs" value={String(audit.validOrderBlocks)} /><Value label="Retests found" value={String(audit.retestsFound)} /><Value label="Confirm candles" value={String(audit.confirmationCandlesFound)} /><Value label="Confirmed" value={String(audit.confirmedSignals)} /><Value label="Rejected / expired" value={`${audit.rejectedSignals} / ${audit.expiredSetups}`} /></div><DebugList title="Order block rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count}, ${item.percentage}%)`)} /></div>;
}

function V2FvgContinuationDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2FvgContinuation"]> }) {
  return <div className="border-b border-[#2a2e39] bg-sky-950/25 px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-sky-100">{audit.activeEngineLabel}</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><Value label="Candles scanned" value={String(audit.candlesScanned)} /><Value label="Displacements" value={String(audit.displacementsFound)} /><Value label="Structure breaks" value={String(audit.structureBreaksConfirmed)} /><Value label="FVGs created" value={String(audit.fvgsCreated)} /><Value label="Valid FVGs" value={String(audit.validFvgs)} /><Value label="FVG retests" value={String(audit.fvgRetestsFound)} /><Value label="Confirm candles" value={String(audit.confirmationCandlesFound)} /><Value label="Confirmed" value={String(audit.confirmedSignals)} /><Value label="Rejected / expired" value={`${audit.rejectedSignals} / ${audit.expiredSetups}`} /></div><DebugList title="FVG continuation rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count}, ${item.percentage}%)`)} /></div>;
}

function V2ProLiquidityConfluenceDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2ProLiquidityConfluence"]> }) {
  return <div className="border-b border-[#2a2e39] bg-emerald-950/25 px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-emerald-100">{audit.activeEngineLabel}</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><Value label="Candles scanned" value={String(audit.candlesScanned)} /><Value label="HTF bias" value={audit.htfBias} /><Value label="ITF bias" value={audit.itfBias} /><Value label="Sweeps" value={String(audit.sweepsFound)} /><Value label="Displacements" value={String(audit.displacementsFound)} /><Value label="MSS / CHoCH" value={String(audit.mssFound)} /><Value label="Entry zones" value={String(audit.entryZonesFound)} /><Value label="FVG / OB" value={`${audit.fvgZonesFound} / ${audit.orderBlocksFound}`} /><Value label="Confirm candles" value={String(audit.confirmationCandlesFound)} /><Value label="Confirmed" value={String(audit.confirmedSignals)} /><Value label="Rejected / expired" value={`${audit.rejectedSignals} / ${audit.expiredSetups}`} /></div><DebugList title="Pro liquidity rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count}, ${item.percentage}%)`)} /></div>;
}

function V2StockGuruSweepFvgObDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2StockGuruSweepFvgOb"]> }) {
  return <div className="border-b border-[#2a2e39] bg-yellow-950/25 px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-yellow-100">{audit.activeEngineLabel}</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><Value label="Candles scanned" value={String(audit.candlesScanned)} /><Value label="HTF / ITF" value={`${audit.htfBias} / ${audit.itfBias}`} /><Value label="Market" value={audit.marketRegime} /><Value label="Models R / C" value={`${audit.reversalModelsFound} / ${audit.continuationModelsFound}`} /><Value label="Sweeps / reclaims" value={`${audit.sweepsFound} / ${audit.reclaimsFound}`} /><Value label="Displacements" value={String(audit.displacementsFound)} /><Value label="BOS / MSS" value={String(audit.bosFound)} /><Value label="FVG / OB" value={`${audit.fvgZonesFound} / ${audit.orderBlocksFound}`} /><Value label="Overlap zones" value={String(audit.overlapZonesFound)} /><Value label="Retests" value={String(audit.retestsFound)} /><Value label="Confirm candles" value={String(audit.confirmationCandlesFound)} /><Value label="Confirmed" value={String(audit.confirmedSignals)} /><Value label="Rejected / expired" value={`${audit.rejectedSignals} / ${audit.expiredSetups}`} /></div><DebugList title="Stock Guru rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count}, ${item.percentage}%)`)} /></div>;
}

function V2TjrSimpleStructurePullbackDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2TjrSimpleStructurePullback"]> }) {
  return <div className="border-b border-[#2a2e39] bg-cyan-950/25 px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-cyan-100">{audit.activeEngineLabel}</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><Value label="Candles scanned" value={String(audit.candlesScanned)} /><Value label="HTF / ITF" value={`${audit.htfBias} / ${audit.itfBias}`} /><Value label="Market" value={audit.marketRegime} /><Value label="Models C / R" value={`${audit.continuationModelsFound} / ${audit.reversalModelsFound}`} /><Value label="Structure" value={String(audit.marketStructuresFound)} /><Value label="BOS / CHOCH" value={`${audit.bosFound} / ${audit.chochFound}`} /><Value label="Zones / retests" value={`${audit.pullbackZonesFound} / ${audit.retestsFound}`} /><Value label="Confirm candles" value={String(audit.confirmationCandlesFound)} /><Value label="Confirmed" value={String(audit.confirmedSignals)} /><Value label="Rejected / expired" value={`${audit.rejectedSignals} / ${audit.expiredSetups}`} /></div><DebugList title="TJR rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count}, ${item.percentage}%)`)} /></div>;
}

function V2IctOteContinuationDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2IctOteContinuation"]> }) {
  return <div className="border-b border-[#2a2e39] bg-cyan-950/25 px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-cyan-100">{audit.activeEngineLabel}</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><Value label="Candles scanned" value={String(audit.candlesScanned)} /><Value label="HTF / ITF" value={`${audit.htfBias} / ${audit.itfBias}`} /><Value label="Market condition" value={audit.marketCondition} /><Value label="Impulses" value={String(audit.impulsesFound)} /><Value label="Structure breaks" value={String(audit.structureBreaksFound)} /><Value label="Sweeps" value={String(audit.sweepsFound)} /><Value label="OTE zones / touches" value={`${audit.oteZonesCreated} / ${audit.oteTouchesFound}`} /><Value label="Confluence zones" value={String(audit.confluenceZonesFound)} /><Value label="Confirm candles" value={String(audit.confirmationCandlesFound)} /><Value label="Confirmed" value={String(audit.confirmedSignals)} /><Value label="Rejected / expired" value={`${audit.rejectedSignals} / ${audit.expiredSetups}`} /></div><DebugList title="ICT OTE rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count}, ${item.percentage}%)`)} /></div>;
}

function V2IctIfvgReversalDetail({ audit }: { audit: NonNullable<EntryEngineResult["audit"]["v2IctIfvgReversal"]> }) {
  return <div className="border-b border-[#2a2e39] bg-purple-950/25 px-4 py-3 text-xs text-slate-300"><p className="font-semibold text-purple-100">{audit.activeEngineLabel}</p><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><Value label="Candles scanned" value={String(audit.candlesScanned)} /><Value label="HTF / ITF" value={`${audit.htfBias} / ${audit.itfBias}`} /><Value label="Market condition" value={audit.marketCondition} /><Value label="FVGs scanned" value={String(audit.fvgsScanned)} /><Value label="IFVGs flipped" value={String(audit.ifvgsFlipped)} /><Value label="Retests found" value={String(audit.retestsFound)} /><Value label="Confirm candles" value={String(audit.confirmationCandlesFound)} /><Value label="Confirmed" value={String(audit.confirmedSignals)} /><Value label="Rejected / expired" value={`${audit.rejectedSignals} / ${audit.expiredSetups}`} /></div><DebugList title="ICT IFVG rejection reasons" values={audit.topRejectionReasons.map((item) => `${item.reason} (${item.count}, ${item.percentage}%)`)} /></div>;
}


function SignalDetail({ signal }: { signal: TradeSignal }) {
  return (
    <div className="px-4 py-4 text-xs text-slate-300">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-2 py-1 font-bold text-white ${signal.direction === "BULLISH" ? "bg-emerald-700" : "bg-red-700"}`}>
          {formatLabel(signal.type)}
        </span>
        <span className="font-semibold">{signal.status}</span>
        <span>{signal.score}/100</span>
        <span>{formatLabel(signal.confidence)}</span>
      </div>
      <p className="mt-3 font-semibold text-slate-100">{signal.strategyModel}</p>
      <p className="mt-1 text-slate-400">Engine: {signal.engine ?? "LEGACY_PHASE5"} | Strategy: {signal.strategyId ?? signal.strategyModel}</p>
      <p className="mt-1 text-slate-400">Source: {signal.sourceSetupId}</p>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <Value label="Entry" value={formatPrice(signal.entryPrice)} />
        <Value label="RR" value={`${signal.rr.toFixed(2)}R`} />
        <Value label="Stop loss" value={formatPrice(signal.stopLoss)} />
        <Value label="TP1" value={formatPrice(signal.takeProfit)} />
        <Value label="TP2" value={formatOptionalPrice(signal.takeProfit2)} />
        <Value label="TP3" value={formatOptionalPrice(signal.takeProfit3)} />
        <Value label="Invalidation" value={formatPrice(signal.invalidationLevel)} />
        <Value label="Risk units" value={signal.positionSizeSuggestion.toFixed(4)} />
      </div>
      <p className="mt-3"><strong className="text-slate-100">Reasons:</strong> {signal.reasons.join(" ")}</p>
      <p className="mt-2"><strong className="text-slate-100">Warnings:</strong> {signal.warnings.join(" ") || "None"}</p>
      <p className="mt-2"><strong className="text-slate-100">Evidence:</strong> {signal.relatedMarkers.join(", ") || "Setup evidence"}</p>
      <p className="mt-2"><strong className="text-slate-100">No repaint:</strong> {signal.noRepaintProof.message}</p>
      {signal.intermarket ? (
        <div className="mt-3 border-t border-[#2a2e39] pt-3">
          <p className="font-semibold text-slate-100">Macro Confirmation</p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <Value label="Grade" value={`${signal.intermarket.macroGrade} (${signal.intermarket.macroScore}/100)`} />
            <Value label="Gold bias" value={signal.intermarket.goldBias} />
            <Value label="DXY" value={`${signal.intermarket.dxyConfirmation.status} | ${signal.intermarket.dxyConfirmation.reasonCode}`} />
            <Value label="TNX" value={`${signal.intermarket.tnxConfirmation.status} | ${signal.intermarket.tnxConfirmation.reasonCode}`} />
            <Value label="FRED daily" value={`${signal.intermarket.fredConfirmation.status} | ${signal.intermarket.fredConfirmation.reasonCode}`} />
            <Value label="Action" value={signal.intermarket.shouldBlock ? `Blocked: ${signal.intermarket.blockReason}` : signal.intermarket.macroGrade === "CONFLICT" ? "Avoid / score warning" : "Allowed"} />
          </div>
          <p className="mt-2 text-slate-400"><strong className="text-slate-100">Macro warnings:</strong> {signal.intermarket.warnings.join(", ") || "None"}</p>
        </div>
      ) : null}
      {signal.followThrough ? (
        <div className="mt-3 border-t border-[#2a2e39] pt-3">
          <p className="font-semibold text-slate-100">Signal Follow-Through</p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <Value label="Grade" value={`${signal.followThrough.followThroughGrade} (${signal.followThrough.followThroughScore}/100)`} />
            <Value label="Estimated probability" value={`${signal.followThrough.moveProbability}%`} />
            <Value label="Expected move" value={signal.followThrough.expectedMoveSide} />
            <Value label="Runway" value={`${signal.followThrough.liquidityRunway.status} ${signal.followThrough.liquidityRunway.cleanRoomR.toFixed(1)}R`} />
            <Value label="Target" value={signal.followThrough.nearestTarget ? `${formatLabel(signal.followThrough.nearestTarget.type)} ${formatPrice(signal.followThrough.nearestTarget.price)} (${signal.followThrough.nearestTarget.distanceR.toFixed(1)}R)` : "None"} />
            <Value label="Obstacle" value={signal.followThrough.nearestObstacle ? `${formatLabel(signal.followThrough.nearestObstacle.type)} ${formatPrice(signal.followThrough.nearestObstacle.price)} (${signal.followThrough.nearestObstacle.distanceR.toFixed(1)}R)` : "None before target"} />
            <Value label="Structure / continuation" value={`${signal.followThrough.continuationStrength}/100`} />
            <Value label="Invalidation" value={formatPrice(signal.followThrough.invalidationLevel)} />
          </div>
          <p className="mt-2 text-slate-400"><strong className="text-slate-100">Passed:</strong> {signal.followThrough.reasons.map(formatLabel).join(", ") || "None"}</p>
          <p className="mt-1 text-slate-400"><strong className="text-slate-100">Failed:</strong> {signal.followThrough.failedFactors.map(formatLabel).join(", ") || "None"}</p>
          {signal.followThrough.hardBlockers.length ? <p className="mt-1 text-rose-300"><strong>Avoid:</strong> {signal.followThrough.hardBlockers.join(" ")}</p> : null}
        </div>
      ) : null}
      {signal.asianRange ? (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2a2e39] pt-3">
          <Value label="Asian range type" value={signal.asianRange.rangeType} />
          <Value label="Coverage" value={`${Math.round(signal.asianRange.coverageRatio * 100)}% (${signal.asianRange.candlesCount}/${signal.asianRange.expectedCandles})`} />
          <Value label="Asian high" value={formatPrice(signal.asianRange.high)} />
          <Value label="Asian low" value={formatPrice(signal.asianRange.low)} />
          <Value label="Asian midpoint" value={formatPrice(signal.asianRange.midpoint)} />
          <Value label="Asian range size" value={formatPrice(signal.asianRange.rangeSize)} />
          <Value label="Range warnings" value={signal.asianRange.warnings.map(formatLabel).join(", ") || "None"} />
          {signal.sweep ? (
            <>
              <Value label="Sweep" value={signal.sweep.type ?? "-"} />
              <Value label="Sweep extreme" value={formatPrice(signal.sweep.extremePrice)} />
            </>
          ) : null}
          {signal.breakout ? (
            <>
              <Value label="Breakout direction" value={signal.breakout.direction} />
              <Value label="Breakout close" value={formatPrice(signal.breakout.close)} />
            </>
          ) : null}
          {signal.retest ? (
            <>
              <Value label="Retest delay" value={`${signal.retest.retestDelay} candles`} />
              <Value label="Retest extreme" value={formatPrice(signal.retest.extremePrice)} />
            </>
          ) : null}
          <Value label="Confirmation index" value={String(signal.confirmation?.candleIndex ?? "-")} />
        </div>
      ) : null}
      {signal.silverBullet ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2a2e39] pt-3"><Value label="Killzone" value={signal.silverBullet.killzoneName} /><Value label="Stage" value={signal.silverBullet.stage} /><Value label="Liquidity" value={`${signal.silverBullet.liquidity.type} ${signal.silverBullet.liquidity.source}`} /><Value label="Sweep ATR" value={`${signal.silverBullet.sweep.sweepDistanceAtr.toFixed(2)}x`} /><Value label="Structure" value={`${signal.silverBullet.structureShift.type} ${formatPrice(signal.silverBullet.structureShift.brokenLevel)}`} /><Value label="FVG" value={`${formatPrice(signal.silverBullet.fvg.bottom)} - ${formatPrice(signal.silverBullet.fvg.top)}`} /><Value label="FVG midpoint" value={formatPrice(signal.silverBullet.fvg.midpoint)} /><Value label="Retest depth" value={`${signal.silverBullet.fvg.retestDepthPercent.toFixed(1)}%`} /></div> : null}
      {signal.vwapEma ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2a2e39] pt-3"><Value label="Session" value={signal.vwapEma.sessionName} /><Value label="Regime" value={signal.vwapEma.regime.direction} /><Value label="VWAP" value={formatPrice(signal.vwapEma.indicators.sessionVwap)} /><Value label="EMA 20 / 50 / 200" value={`${formatPrice(signal.vwapEma.indicators.ema20)} / ${formatPrice(signal.vwapEma.indicators.ema50)} / ${formatPrice(signal.vwapEma.indicators.ema200)}`} /><Value label="Pullback touch" value={signal.vwapEma.pullback.touchedEma} /></div> : null}
      {signal.emaTrendPullback ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2a2e39] pt-3"><Value label="Session" value={signal.emaTrendPullback.sessionName} /><Value label="Trend" value={signal.emaTrendPullback.trend.direction} /><Value label="Stage" value={signal.emaTrendPullback.stage} /><Value label="EMA 20 / 50 / 200" value={`${formatPrice(signal.emaTrendPullback.indicators.ema20)} / ${formatPrice(signal.emaTrendPullback.indicators.ema50)} / ${formatPrice(signal.emaTrendPullback.indicators.ema200)}`} /><Value label="ATR" value={formatPrice(signal.emaTrendPullback.indicators.atr)} /><Value label="Pullback touch" value={signal.emaTrendPullback.pullback.touchedEma} /></div> : null}
      {signal.liquiditySweepReversal ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2a2e39] pt-3"><Value label="Liquidity" value={`${signal.liquiditySweepReversal.liquidity.type} ${signal.liquiditySweepReversal.liquidity.source}`} /><Value label="Level" value={formatPrice(signal.liquiditySweepReversal.liquidity.level)} /><Value label="Sweep price" value={formatPrice(signal.liquiditySweepReversal.sweep.sweepPrice)} /><Value label="Sweep ATR" value={`${signal.liquiditySweepReversal.sweep.sweepDistanceAtr.toFixed(2)}x`} /><Value label="Reclaimed" value={formatTime(signal.liquiditySweepReversal.sweep.reclaimedAt)} /><Value label="Session" value={signal.liquiditySweepReversal.confluence.sessionName ?? "Outside active session"} /><Value label="MSS / FVG" value={`${signal.liquiditySweepReversal.confluence.hasMss ? "Yes" : "No"} / ${signal.liquiditySweepReversal.confluence.hasFvg ? "Yes" : "No"}`} /><Value label="HTF context" value={signal.liquiditySweepReversal.confluence.htfContext} /></div> : null}
      {signal.orderBlockRetest ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2a2e39] pt-3"><Value label="Stage" value={signal.orderBlockRetest.stage} /><Value label="OB type" value={signal.orderBlockRetest.orderBlock.type} /><Value label="OB zone" value={`${formatPrice(signal.orderBlockRetest.orderBlock.bottom)} - ${formatPrice(signal.orderBlockRetest.orderBlock.top)}`} /><Value label="OB age" value={`${signal.orderBlockRetest.orderBlock.ageCandles} candles`} /><Value label="Structure break" value={formatPrice(signal.orderBlockRetest.displacement.brokeStructureLevel)} /><Value label="Retest depth" value={`${signal.orderBlockRetest.retest.retestDepthPercent.toFixed(1)}%`} /><Value label="FVG confluence" value={signal.orderBlockRetest.confluence.hasFvg ? "Yes" : "No"} /><Value label="Sweep confluence" value={signal.orderBlockRetest.confluence.hasLiquiditySweep ? "Yes" : "No"} /></div> : null}
      {signal.fvgContinuation ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2a2e39] pt-3"><Value label="Stage" value={signal.fvgContinuation.stage} /><Value label="Session" value={signal.fvgContinuation.sessionName} /><Value label="Displacement" value={`${signal.fvgContinuation.displacement.direction} ${signal.fvgContinuation.displacement.rangeAtrMultiple.toFixed(2)}x`} /><Value label="Structure" value={`${signal.fvgContinuation.structureBreak.type} ${formatPrice(signal.fvgContinuation.structureBreak.brokenLevel)}`} /><Value label="FVG" value={`${formatPrice(signal.fvgContinuation.fvg.bottom)} - ${formatPrice(signal.fvgContinuation.fvg.top)}`} /><Value label="FVG size" value={`${signal.fvgContinuation.fvg.sizeAtr.toFixed(2)}x ATR`} /><Value label="Retest" value={`${signal.fvgContinuation.retest.touchedZone} ${signal.fvgContinuation.fvg.retestDepthPercent.toFixed(1)}%`} /><Value label="Confluence" value={`Sweep ${signal.fvgContinuation.confluence.hasLiquiditySweep ? "Y" : "N"} / OB ${signal.fvgContinuation.confluence.hasOrderBlock ? "Y" : "N"} / EMA ${signal.fvgContinuation.confluence.emaTrendAligned ? "Y" : "N"}`} /></div> : null}
      {signal.proLiquidityConfluence ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2a2e39] pt-3"><Value label="Stage" value={signal.proLiquidityConfluence.stage} /><Value label="Session" value={signal.proLiquidityConfluence.sessionName} /><Value label="HTF / ITF" value={`${signal.proLiquidityConfluence.htfBias.bias} / ${signal.proLiquidityConfluence.itfBias.bias}`} /><Value label="Sweep" value={`${signal.proLiquidityConfluence.liquiditySweep.type} ${formatPrice(signal.proLiquidityConfluence.liquiditySweep.level)}`} /><Value label="Displacement" value={`${signal.proLiquidityConfluence.displacement.direction} ${signal.proLiquidityConfluence.displacement.rangeAtrMultiple.toFixed(2)}x`} /><Value label="Structure" value={`${signal.proLiquidityConfluence.structureShift.type} ${formatPrice(signal.proLiquidityConfluence.structureShift.brokenLevel)}`} /><Value label="Entry zone" value={`${signal.proLiquidityConfluence.entryZone.type} ${formatPrice(signal.proLiquidityConfluence.entryZone.bottom)} - ${formatPrice(signal.proLiquidityConfluence.entryZone.top)}`} /><Value label="Score" value={`${signal.proLiquidityConfluence.confluence.score}/${signal.proLiquidityConfluence.confluence.maxScore}`} /></div> : null}
      {signal.stockGuruSweepFvgOb ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2a2e39] pt-3"><Value label="Stage" value={signal.stockGuruSweepFvgOb.stage} /><Value label="Model" value={signal.stockGuruSweepFvgOb.modelUsed} /><Value label="HTF / ITF" value={`${signal.stockGuruSweepFvgOb.htfBias} / ${signal.stockGuruSweepFvgOb.itfBias}`} /><Value label="Market" value={signal.stockGuruSweepFvgOb.marketRegime} /><Value label="Liquidity" value={`${signal.stockGuruSweepFvgOb.liquidity.type ?? "-"} ${formatOptionalPrice(signal.stockGuruSweepFvgOb.liquidity.level)}`} /><Value label="Displacement" value={`${signal.stockGuruSweepFvgOb.displacement.rangeAtrMultiple.toFixed(2)}x ATR`} /><Value label="Structure" value={`${signal.stockGuruSweepFvgOb.structure.bosType ?? "-"} ${formatOptionalPrice(signal.stockGuruSweepFvgOb.structure.brokenLevel)}`} /><Value label="FVG" value={signal.stockGuruSweepFvgOb.fvg.found ? `${formatOptionalPrice(signal.stockGuruSweepFvgOb.fvg.low)} - ${formatOptionalPrice(signal.stockGuruSweepFvgOb.fvg.high)} (${signal.stockGuruSweepFvgOb.fvg.quality}/15)` : "None"} /><Value label="OB" value={signal.stockGuruSweepFvgOb.orderBlock.found ? `${formatOptionalPrice(signal.stockGuruSweepFvgOb.orderBlock.low)} - ${formatOptionalPrice(signal.stockGuruSweepFvgOb.orderBlock.high)} (${signal.stockGuruSweepFvgOb.orderBlock.quality}/15)` : "None"} /><Value label="Entry zone" value={`${signal.stockGuruSweepFvgOb.selectedZone.type ?? "-"} ${formatOptionalPrice(signal.stockGuruSweepFvgOb.selectedZone.low)} - ${formatOptionalPrice(signal.stockGuruSweepFvgOb.selectedZone.high)}`} /><Value label="Retest depth" value={`${signal.stockGuruSweepFvgOb.selectedZone.retestDepthPercent.toFixed(1)}%`} /><Value label="Bonuses" value={signal.stockGuruSweepFvgOb.score.bonuses.join(", ") || "None"} /></div> : null}
      {signal.tjrSimpleStructurePullback ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2a2e39] pt-3"><Value label="Stage" value={signal.tjrSimpleStructurePullback.stage} /><Value label="Model" value={signal.tjrSimpleStructurePullback.modelUsed} /><Value label="HTF / ITF" value={`${signal.tjrSimpleStructurePullback.htfBias} / ${signal.tjrSimpleStructurePullback.itfBias}`} /><Value label="Market" value={signal.tjrSimpleStructurePullback.marketRegime} /><Value label="Structure" value={`${signal.tjrSimpleStructurePullback.structureType ?? "-"} ${signal.tjrSimpleStructurePullback.bosType ?? "-"}`} /><Value label="Broken level" value={formatOptionalPrice(signal.tjrSimpleStructurePullback.brokenLevel)} /><Value label="Zone" value={`${signal.tjrSimpleStructurePullback.selectedZoneType ?? "-"} ${formatOptionalPrice(signal.tjrSimpleStructurePullback.selectedZoneLow)} - ${formatOptionalPrice(signal.tjrSimpleStructurePullback.selectedZoneHigh)}`} /><Value label="Zone quality" value={String(signal.tjrSimpleStructurePullback.zoneQuality)} /><Value label="Retest depth" value={`${signal.tjrSimpleStructurePullback.retestDepthPercent.toFixed(1)}%`} /><Value label="Confirmation" value={signal.tjrSimpleStructurePullback.confirmationIndex === null ? "-" : String(signal.tjrSimpleStructurePullback.confirmationIndex)} /><Value label="Bonuses" value={signal.tjrSimpleStructurePullback.bonuses.join(", ") || "None"} /><Value label="Penalties" value={signal.tjrSimpleStructurePullback.penalties.join(", ") || "None"} /></div> : null}
      {signal.ictOteContinuation ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2a2e39] pt-3"><Value label="Stage" value={signal.ictOteContinuation.stage} /><Value label="Session" value={signal.ictOteContinuation.sessionName} /><Value label="HTF / ITF" value={`${signal.ictOteContinuation.htfBias} / ${signal.ictOteContinuation.itfBias}`} /><Value label="Market" value={signal.ictOteContinuation.marketCondition} /><Value label="Impulse" value={`${signal.ictOteContinuation.impulse.direction} ${signal.ictOteContinuation.impulse.rangeAtrMultiple.toFixed(2)}x ATR`} /><Value label="Structure" value={`${signal.ictOteContinuation.structureBreak.type} ${formatPrice(signal.ictOteContinuation.structureBreak.brokenLevel)}`} /><Value label="OTE zone" value={`${formatPrice(signal.ictOteContinuation.ote.low)} - ${formatPrice(signal.ictOteContinuation.ote.high)}`} /><Value label="OTE 0.705" value={formatPrice(signal.ictOteContinuation.ote.level705)} /><Value label="Confluence" value={signal.ictOteContinuation.ote.confluence.join(", ") || "None"} /><Value label="Score" value={`${signal.ictOteContinuation.confluence.score}/${signal.ictOteContinuation.confluence.maxScore}`} /></div> : null}
      {signal.ictIfvgReversal ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2a2e39] pt-3"><Value label="Stage" value={signal.ictIfvgReversal.stage} /><Value label="Session" value={signal.ictIfvgReversal.sessionName} /><Value label="HTF / ITF" value={`${signal.ictIfvgReversal.htfBias} / ${signal.ictIfvgReversal.itfBias}`} /><Value label="Market" value={signal.ictIfvgReversal.marketCondition} /><Value label="Displacement" value={`${signal.ictIfvgReversal.displacement.direction} ${signal.ictIfvgReversal.displacement.rangeAtrMultiple.toFixed(2)}x ATR`} /><Value label="Structure" value={`${signal.ictIfvgReversal.structureBreak.type} ${formatPrice(signal.ictIfvgReversal.structureBreak.brokenLevel)}`} /><Value label="IFVG zone" value={`${formatPrice(signal.ictIfvgReversal.ifvgZone.bottom)} - ${formatPrice(signal.ictIfvgReversal.ifvgZone.top)}`} /><Value label="Original FVG" value={`${formatPrice(signal.ictIfvgReversal.originalFvg.bottom)} - ${formatPrice(signal.ictIfvgReversal.originalFvg.top)}`} /><Value label="Retest" value={`${signal.ictIfvgReversal.retest.touchedZone ? "Yes" : "No"} (${signal.ictIfvgReversal.retest.depthPercent.toFixed(1)}%)`} /><Value label="Confluence" value={`Sweep ${signal.ictIfvgReversal.confluence.hasLiquiditySweep ? "Y" : "N"} / MSS ${signal.ictIfvgReversal.confluence.hasMarketStructureShift ? "Y" : "N"} / EMA ${signal.ictIfvgReversal.confluence.emaTrendAligned ? "Y" : "N"}`} /><Value label="Score" value={String(signal.score)} /></div> : null}

      <ScoreBreakdown breakdown={signal.scoreBreakdown} />
      {signal.v2ScoreBreakdown ? <V2ScoreBreakdown breakdown={signal.v2ScoreBreakdown} /> : null}
    </div>
  );
}

function NoTradeDetail({ result }: { result: EntryEngineResult }) {
  const noTrade = result.noTrade;
  if (!noTrade) return null;
  return (
    <div className="px-4 py-4 text-xs text-slate-300">
      <p className="font-bold text-slate-100">NO TRADE</p>
      <p className="mt-2 font-medium text-amber-300">{noTrade.message}</p>
      <p className="mt-2">{noTrade.nearestPossibleSetup ?? "No nearby setup"}</p>
      <ul className="mt-3 space-y-1 border-l-2 border-amber-400 pl-3">
        {noTrade.rejectionReasons.slice(0, 6).map((reason, index) => <li key={index}>{reason}</li>)}
      </ul>
      <p className="mt-3 font-semibold text-slate-100">Required for signal</p>
      <ul className="mt-1 space-y-1 text-slate-400">
        {noTrade.requiredForSignal.map((requirement) => <li key={requirement}>{requirement}</li>)}
      </ul>
    </div>
  );
}

function ScoreBreakdown({ breakdown }: { breakdown: TradeSignal["scoreBreakdown"] }) {
  return (
    <div className="mt-3 border-t border-[#2a2e39] pt-3">
      <p className="font-semibold text-slate-100">Score breakdown</p>
      <div className="mt-2 grid grid-cols-2 gap-1 text-slate-400">
        {Object.entries(breakdown).map(([key, value]) => (
          <span key={key}>{formatLabel(key)}: {value}</span>
        ))}
      </div>
    </div>
  );
}

function V2ScoreBreakdown({ breakdown }: { breakdown: NonNullable<TradeSignal["v2ScoreBreakdown"]> }) {
  return (
    <div className="mt-3 border-t border-[#2a2e39] pt-3">
      <p className="font-semibold text-slate-100">V2 strategy score breakdown</p>
      <div className="mt-2 grid grid-cols-2 gap-1 text-slate-400">
        {Object.entries(breakdown).map(([key, value]) => (
          <span key={key}>{formatLabel(key)}: {value}</span>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="bg-[#1e222d] px-3 py-2"><span className="block text-slate-400">{label}</span><strong className="mt-1 block text-slate-100">{value}</strong></div>;
}

function DebugList({ title, values }: { title: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="mt-3 border-t border-[#2a2e39] pt-2">
      <p className="font-semibold text-slate-100">{title}</p>
      <ul className="mt-1 space-y-1">
        {values.slice(0, 10).map((value) => <li key={value}>{value}</li>)}
      </ul>
    </div>
  );
}

function CandidateDebugList({ values }: { values: EntryEngineResult["candidateDebug"] }) {
  if (values.length === 0) return null;
  return (
    <div className="mt-3 border-t border-[#2a2e39] pt-2">
      <p className="font-semibold text-slate-100">Rejected / Pending Candidate Debug</p>
      <div className="mt-2 max-h-56 overflow-auto">
        <table className="min-w-190 w-full text-left text-xs">
          <thead className="bg-[#1e222d] text-slate-300">
            <tr>{["Setup ID", "Strategy", "Final score", "Req signal", "RR", "Asian date", "Status", "Failed stage", "Reason", "Next action"].map((item) => <th key={item} className="px-2 py-1 font-semibold">{item}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[#2a2e39]">
            {values.map((item) => (
              <tr key={`${item.setupId}-${item.confirmationStatus}-${item.rejectionReason}`}>
                <td className="px-2 py-1">{item.setupId}</td>
                <td className="px-2 py-1">{item.strategyId ?? item.engine ?? "LEGACY"}</td>
                <td className="px-2 py-1">{item.finalSignalScore ?? "-"}</td>
                <td className="px-2 py-1">{item.requiredSignalScore}</td>
                <td className="px-2 py-1">{item.rr?.toFixed(2) ?? "-"}</td>
                <td className="px-2 py-1">{item.asianRangeDate ?? "-"}</td>
                <td className="px-2 py-1 font-semibold">{formatLabel(item.confirmationStatus)}</td>
                <td className="px-2 py-1 font-semibold text-red-300">{item.failedStage ?? "-"}</td>
                <td className="px-2 py-1">{item.rejectionReason}</td>
                <td className="px-2 py-1">{item.nextRequiredAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return <span><span className="text-slate-400">{label}</span><strong className="block text-slate-100">{value}</strong></span>;
}

function formatLabel(value: EntryMode | string): string {
  return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 16);
}

function formatOptionalPrice(value: number | null): string {
  return value === null ? "-" : formatPrice(value);
}
