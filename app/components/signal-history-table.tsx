"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { Timeframe } from "@/lib/candles/types";
import type { TradeSignal } from "@/lib/entry-engine/types";
import { BREAKOUT_STRATEGY_ID, EMA_TREND_PULLBACK_STRATEGY_ID, FVG_CONTINUATION_ENTRY_STRATEGY_ID, GOLDMINE_STRATEGY_ID, ICT_OTE_CONTINUATION_STRATEGY_ID, ICT_SILVER_BULLET_STRATEGY_ID, LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID, ORDER_BLOCK_RETEST_STRATEGY_ID, PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID, STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID, TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID, VWAP_EMA_STRATEGY_ID, ICT_IFVG_REVERSAL_STRATEGY_ID, type InstitutionalMasterSignal, type MasterFinalSignal } from "@/lib/v2-signal-engine";


type SignalDirectionFilter = "ALL" | "BUY" | "SELL" | "RAPID";
type SignalSortMode = "NEWEST" | "OLDEST" | "HIGHEST_SCORE" | "HIGHEST_RR";

type SignalHistoryTableProps = {
  signals: TradeSignal[];
  symbol: string;
  timeframe: Timeframe;
  selectedSignalId: string | null;
  onSignalSelect: (signal: TradeSignal) => void;
};

const TABLE_HEADERS = ["Date/time", "Symbol", "Timeframe", "Engine", "Strategy", "Signal type", "Direction", "Liquidity / OB", "Liquidity source", "Entry", "SL", "TP1", "TP2", "TP3", "RR", "Score", "Macro", "Macro score", "FT grade", "FT prob", "FT target", "FT obstacle", "FVG size", "Retest depth", "Confidence", "Session / Killzone", "Regime", "Setup type", "Status", "Reason", "Rejection reason", "Warnings"];
const ROW_HEIGHT = 36;
const VISIBLE_ROW_COUNT = 14;
const OVERSCAN_ROWS = 6;

function SignalHistoryTableComponent({
  signals,
  symbol,
  timeframe,
  selectedSignalId,
  onSignalSelect,
}: SignalHistoryTableProps) {
  const [directionFilter, setDirectionFilter] = useState<SignalDirectionFilter>("ALL");
  const [strategyFilter, setStrategyFilter] = useState("ALL_V2");
  const [sessionFilter, setSessionFilter] = useState("ALL");
  const [setupFilter, setSetupFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("");
  const [minimumScore, setMinimumScore] = useState("");
  const [minimumRr, setMinimumRr] = useState("");
  const [sortMode, setSortMode] = useState<SignalSortMode>("NEWEST");
  const [scrollTop, setScrollTop] = useState(0);
  const debouncedDateFilter = useDebouncedValue(dateFilter, 160);
  const debouncedMinimumScore = useDebouncedValue(minimumScore, 160);
  const debouncedMinimumRr = useDebouncedValue(minimumRr, 160);

  const strategies = [PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID, STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID, TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID, ICT_OTE_CONTINUATION_STRATEGY_ID, ICT_IFVG_REVERSAL_STRATEGY_ID, FVG_CONTINUATION_ENTRY_STRATEGY_ID, ICT_SILVER_BULLET_STRATEGY_ID, ORDER_BLOCK_RETEST_STRATEGY_ID, LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID, VWAP_EMA_STRATEGY_ID, EMA_TREND_PULLBACK_STRATEGY_ID, GOLDMINE_STRATEGY_ID, BREAKOUT_STRATEGY_ID];

  const sessions = useMemo(() => unique(signals.map((signal) => signal.session)), [signals]);
  const setupTypes = useMemo(() => unique(signals.map((signal) => signal.setupType)), [signals]);

  const filteredSignals = useMemo(() => {
    const minScore = Number(debouncedMinimumScore);
    const minRr = Number(debouncedMinimumRr);
    return signals
      .filter((signal) => {
        if (directionFilter === "BUY" && !signal.type.endsWith("BUY")) return false;
        if (directionFilter === "SELL" && !signal.type.endsWith("SELL")) return false;
        if (directionFilter === "RAPID" && !signal.type.startsWith("RAPID")) return false;
        if (strategyFilter !== "ALL_V2" && (signal.strategyId || "LEGACY") !== strategyFilter) return false;
        if (sessionFilter !== "ALL" && signal.session !== sessionFilter) return false;
        if (setupFilter !== "ALL" && signal.setupType !== setupFilter) return false;
        if (debouncedDateFilter && !new Date(signal.timestamp).toISOString().startsWith(debouncedDateFilter)) return false;
        if (Number.isFinite(minScore) && debouncedMinimumScore !== "" && signal.score < minScore) return false;
        if (Number.isFinite(minRr) && debouncedMinimumRr !== "" && signal.rr < minRr) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortMode === "OLDEST") return a.timestamp - b.timestamp;
        if (sortMode === "HIGHEST_SCORE") return b.score - a.score || b.timestamp - a.timestamp;
        if (sortMode === "HIGHEST_RR") return b.rr - a.rr || b.timestamp - a.timestamp;
        return b.timestamp - a.timestamp;
      });
  }, [debouncedDateFilter, debouncedMinimumRr, debouncedMinimumScore, directionFilter, strategyFilter, sessionFilter, setupFilter, signals, sortMode]);

  const visibleWindow = useMemo(() => {
    const maxStartIndex = Math.max(0, filteredSignals.length - VISIBLE_ROW_COUNT);
    const startIndex = Math.min(
      maxStartIndex,
      Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS),
    );
    const endIndex = Math.min(filteredSignals.length, startIndex + VISIBLE_ROW_COUNT + OVERSCAN_ROWS * 2);

    return {
      topSpacerHeight: startIndex * ROW_HEIGHT,
      bottomSpacerHeight: Math.max(0, (filteredSignals.length - endIndex) * ROW_HEIGHT),
      signals: filteredSignals.slice(startIndex, endIndex),
    };
  }, [filteredSignals, scrollTop]);

  return (
    <section className="border border-[#2a2e39] bg-[#131722] text-slate-300">
      <div className="flex flex-col gap-2 border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase text-slate-100">Signal History</h2>
          <p className="mt-1 text-xs text-slate-400">
            {filteredSignals.length} shown / {signals.length} generated
          </p>
        </div>
        <div className="text-xs text-slate-400">
          {symbol} | {timeframe}
        </div>
      </div>

      <div className="grid gap-3 border-b border-[#2a2e39] px-4 py-3 text-xs sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <SelectFilter label="Side" value={directionFilter} onChange={(value) => setDirectionFilter(value as SignalDirectionFilter)} options={["ALL", "BUY", "SELL", "RAPID"]} />
        <SelectFilter label="Strategy" value={strategyFilter} onChange={setStrategyFilter} options={["ALL_V2", ...strategies]} />
        <SelectFilter label="Session" value={sessionFilter} onChange={setSessionFilter} options={["ALL", ...sessions]} />
        <SelectFilter label="Setup" value={setupFilter} onChange={setSetupFilter} options={["ALL", ...setupTypes]} />
        <label className="flex flex-col gap-1 text-slate-400">
          Date
          <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="h-9 border border-[#2a2e39] bg-[#0f1117] px-2 text-xs text-slate-200 outline-none focus:border-cyan-500" />
        </label>
        <label className="flex flex-col gap-1 text-slate-400">
          Min score
          <input type="number" min="0" max="100" value={minimumScore} onChange={(event) => setMinimumScore(event.target.value)} className="h-9 border border-[#2a2e39] bg-[#0f1117] px-2 text-xs text-slate-200 outline-none focus:border-cyan-500" />
        </label>
        <label className="flex flex-col gap-1 text-slate-400">
          Min RR
          <input type="number" min="0" step="0.1" value={minimumRr} onChange={(event) => setMinimumRr(event.target.value)} className="h-9 border border-[#2a2e39] bg-[#0f1117] px-2 text-xs text-slate-200 outline-none focus:border-cyan-500" />
        </label>
        <SelectFilter label="Sort" value={sortMode} onChange={(value) => setSortMode(value as SignalSortMode)} options={["NEWEST", "OLDEST", "HIGHEST_SCORE", "HIGHEST_RR"]} />
      </div>

      <div
        className="max-h-[430px] overflow-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <table className="min-w-[1500px] w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-[#1e222d] text-slate-300">
            <tr>
              {TABLE_HEADERS.map((header) => (
                <th key={header} className="border-b border-[#2a2e39] px-3 py-2 font-semibold">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2e39]">
            {visibleWindow.topSpacerHeight > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={TABLE_HEADERS.length} style={{ height: visibleWindow.topSpacerHeight, padding: 0 }} />
              </tr>
            ) : null}
            {visibleWindow.signals.map((signal) => (
              <tr
                key={signal.id}
                onClick={() => onSignalSelect(signal)}
                style={{ height: ROW_HEIGHT }}
                className={`cursor-pointer transition hover:bg-[#2a2e39] ${selectedSignalId === signal.id ? "bg-cyan-950/50" : ""}`}
              >
                <Cell>{formatTime(signal.timestamp)}</Cell>
                <Cell>{symbol}</Cell>
                <Cell>{timeframe}</Cell>
                <Cell>{formatLabel(isInstitutionalSignal(signal) ? "INSTITUTIONAL_MASTER_GATEKEEPER" : isOptionalMasterSignal(signal) ? "OPTIONAL_MASTER_SIGNAL_SELECTOR" : isMasterSignal(signal) ? "MASTER_SIGNAL_SELECTOR" : signal.engine ?? "LEGACY_PHASE5")}</Cell>
                <Cell>{formatLabel(isInstitutionalSignal(signal) || isMasterSignal(signal) ? signal.selectedStrategy : signal.strategyId ?? signal.strategyModel)}</Cell>
                <Cell strong>{formatLabel(isInstitutionalSignal(signal) ? signal.action : isOptionalMasterSignal(signal) ? signal.masterAction : isMasterSignal(signal) ? `MASTER_${signal.action}` : signal.type)}</Cell>
                <Cell>{formatLabel(signal.direction)}</Cell>
                 <Cell>{formatLabel(signal.tjrSimpleStructurePullback?.structureType ?? signal.stockGuruSweepFvgOb?.liquidity.type ?? signal.ictOteContinuation?.liquiditySweep.type ?? signal.ictIfvgReversal?.liquiditySweep.type ?? signal.proLiquidityConfluence?.liquiditySweep.type ?? signal.silverBullet?.liquidity.type ?? signal.liquiditySweepReversal?.liquidity.type ?? signal.orderBlockRetest?.orderBlock.type ?? "-")}</Cell>
                <Cell>{formatLabel(signal.tjrSimpleStructurePullback?.selectedZoneType ?? signal.stockGuruSweepFvgOb?.selectedZone.type ?? (signal.ictOteContinuation?.ote.confluence.join("+") || undefined) ?? signal.proLiquidityConfluence?.liquiditySweep.source ?? signal.silverBullet?.liquidity.source ?? signal.liquiditySweepReversal?.liquidity.source ?? "-")}</Cell>
                <Cell>{formatPrice(signal.entryPrice)}</Cell>
                <Cell>{formatPrice(signal.stopLoss)}</Cell>
                <Cell>{formatPrice(signal.takeProfit)}</Cell>
                <Cell>{formatOptionalPrice(signal.takeProfit2)}</Cell>
                <Cell>{formatOptionalPrice(signal.takeProfit3)}</Cell>
                <Cell strong>{signal.rr.toFixed(2)}R</Cell>
                <Cell>{isInstitutionalSignal(signal) ? `${signal.factorScore}/6` : isMasterSignal(signal) ? signal.masterScore.toFixed(1) : signal.score}</Cell>
                <Cell strong>{signal.intermarket?.macroGrade ?? "-"}</Cell>
                <Cell>{signal.intermarket ? `${signal.intermarket.macroScore}/100` : "-"}</Cell>
                <Cell strong>{signal.followThrough?.followThroughGrade ?? "-"}</Cell>
                <Cell>{signal.followThrough ? `${signal.followThrough.moveProbability}%` : "-"}</Cell>
                <Cell>{signal.followThrough?.nearestTarget ? `${formatLabel(signal.followThrough.nearestTarget.type)} ${signal.followThrough.nearestTarget.distanceR.toFixed(1)}R` : "-"}</Cell>
                <Cell>{signal.followThrough?.nearestObstacle ? `${formatLabel(signal.followThrough.nearestObstacle.type)} ${signal.followThrough.nearestObstacle.distanceR.toFixed(1)}R` : "-"}</Cell>
                <Cell>{formatOptionalNumber(signal.stockGuruSweepFvgOb?.fvg.sizeAtr ?? signal.proLiquidityConfluence?.entryZone.sizeAtr ?? signal.ictIfvgReversal?.ifvgZone.sizeAtr ?? signal.fvgContinuation?.fvg.sizeAtr ?? signal.silverBullet?.fvg.sizeAtr ?? null, "x")}</Cell>
                <Cell>{formatOptionalNumber(signal.tjrSimpleStructurePullback?.retestDepthPercent ?? signal.stockGuruSweepFvgOb?.selectedZone.retestDepthPercent ?? signal.proLiquidityConfluence?.entryZone.retestDepthPercent ?? signal.ictIfvgReversal?.retest.depthPercent ?? signal.fvgContinuation?.fvg.retestDepthPercent ?? signal.silverBullet?.fvg.retestDepthPercent ?? signal.orderBlockRetest?.retest.retestDepthPercent ?? null, "%")}</Cell>
                <Cell>{formatLabel(isInstitutionalSignal(signal) ? signal.riskStatus : isMasterSignal(signal) ? signal.masterConfidence : signal.confidence)}</Cell>
                <Cell>{formatLabel(signal.tjrSimpleStructurePullback?.modelUsed ?? signal.stockGuruSweepFvgOb?.modelUsed ?? signal.ictOteContinuation?.sessionName ?? signal.ictIfvgReversal?.sessionName ?? signal.proLiquidityConfluence?.sessionName ?? signal.fvgContinuation?.sessionName ?? signal.silverBullet?.killzoneName ?? signal.vwapEma?.sessionName ?? signal.emaTrendPullback?.sessionName ?? signal.liquiditySweepReversal?.confluence.sessionName ?? signal.session)}</Cell>
                <Cell>{formatLabel(signal.tjrSimpleStructurePullback?.marketRegime ?? signal.stockGuruSweepFvgOb?.marketRegime ?? signal.ictOteContinuation?.marketCondition ?? signal.ictIfvgReversal?.marketCondition ?? signal.proLiquidityConfluence?.entryZone.type ?? signal.fvgContinuation?.fvg.type ?? signal.vwapEma?.regime.direction ?? signal.emaTrendPullback?.trend.direction ?? signal.liquiditySweepReversal?.liquidity.type ?? signal.orderBlockRetest?.orderBlock.type ?? "-")}</Cell>

                <Cell>{formatLabel(signal.setupType)}</Cell>
                <Cell>{signal.status}</Cell>
                <Cell>{isInstitutionalSignal(signal) ? `${signal.factorScore}/6; ${signal.stopSource}; ${signal.targetSource}` : isMasterSignal(signal) ? signal.selectionReason : signal.reasons[0] ?? "-"}</Cell>
                <Cell>{signal.rejectionReasons.join("; ") || "-"}</Cell>
                <Cell>{signal.warnings.join("; ") || "-"}</Cell>
              </tr>
            ))}
            {visibleWindow.bottomSpacerHeight > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={TABLE_HEADERS.length} style={{ height: visibleWindow.bottomSpacerHeight, padding: 0 }} />
              </tr>
            ) : null}
          </tbody>
        </table>
        {filteredSignals.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            No historical signals match the current filters.
          </div>
        ) : null}
      </div>
    </section>
  );
}

export const SignalHistoryTable = memo(SignalHistoryTableComponent);

function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-slate-400">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 border border-[#2a2e39] bg-[#0f1117] px-2 text-xs text-slate-200 outline-none focus:border-cyan-500">
        {options.map((option) => <option key={option} value={option}>{formatLabel(option)}</option>)}
      </select>
    </label>
  );
}

function Cell({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return <td className={`whitespace-nowrap px-3 py-2 align-top text-slate-300 ${strong ? "font-semibold text-slate-100" : ""}`}>{children}</td>;
}

function isMasterSignal(signal: TradeSignal): signal is MasterFinalSignal {
  return signal.masterDisplayStatus === "MASTER" && "masterSignalId" in signal;
}

function isOptionalMasterSignal(signal: TradeSignal): signal is MasterFinalSignal & { masterAction: string } {
  return isMasterSignal(signal) && "optionalMasterSignalId" in signal;
}

function isInstitutionalSignal(signal: TradeSignal): signal is InstitutionalMasterSignal {
  return "institutionalSignalId" in signal;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 16);
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

function formatOptionalPrice(value: number | null): string {
  return value === null ? "-" : formatPrice(value);
}

function formatOptionalNumber(value: number | null, suffix: string): string {
  return value === null ? "-" : `${value.toFixed(2)}${suffix}`;
}
