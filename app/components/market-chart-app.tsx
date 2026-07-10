"use client";

import dynamic from "next/dynamic";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { getStrategyResultCacheStats } from "@/lib/cache/strategy-result-cache";
import { fetchCandles } from "@/lib/candles/api-client";
import type {
  Candle,
  CandleFetchRequest,
  Timeframe,
} from "@/lib/candles/types";
import type { IntermarketGateMode, IntermarketSnapshot } from "@/lib/market-data/types";
import {
  filterCandlesByDateRange,
  getTimeframeMs,
  normalizeCandles,
  validateCandleRequest,
} from "@/lib/candles/utils";
import { getIndicatorEngineCacheSize } from "@/lib/indicators/indicator-engine";
import {
  getLastClosedCandleTime,
  mergeCandlesByTimestamp,
  shouldRunStrategyScan,
} from "@/lib/market-data/normalize-candles";
import {
  calculateMarketStructure,
  getDefaultMarketStructureSettings,
  getReplayVisibleMarkers,
  getReplayVisibleZones,
} from "@/lib/market-structure/engine";
import type {
  MarkerSensitivity,
  MarkerVisibility,
  MarketMarker,
  MarketStructureSettings,
  ReplayState,
} from "@/lib/market-structure/types";
import { calculateMarketContext } from "@/lib/market-context/engine";
import type { ContextOverlayVisibility } from "@/lib/market-context/types";
import {
  GOLDMINE_CONFIG,
  GOLDMINE_STRATEGY_ID,
  GOLDMINE_STRATEGY_LABEL,
  BREAKOUT_STRATEGY_ID,
  BREAKOUT_STRATEGY_LABEL,
  ASIAN_BREAKOUT_CONFIG,
  ICT_SILVER_BULLET_CONFIG,
  ICT_SILVER_BULLET_STRATEGY_ID,
  ICT_SILVER_BULLET_STRATEGY_LABEL,
  VWAP_EMA_REGIME_PULLBACK_CONFIG,
  VWAP_EMA_STRATEGY_ID,
  VWAP_EMA_STRATEGY_LABEL,
  EMA_TREND_PULLBACK_CONFIG,
  EMA_TREND_PULLBACK_STRATEGY_ID,
  EMA_TREND_PULLBACK_STRATEGY_LABEL,
  LIQUIDITY_SWEEP_REVERSAL_PRO_CONFIG,
  LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID,
  LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_LABEL,
  ORDER_BLOCK_RETEST_CONFIG,
  ORDER_BLOCK_RETEST_STRATEGY_ID,
  ORDER_BLOCK_RETEST_STRATEGY_LABEL,
  FVG_CONTINUATION_ENTRY_CONFIG,
  FVG_CONTINUATION_ENTRY_STRATEGY_ID,
  FVG_CONTINUATION_ENTRY_STRATEGY_LABEL,
  PRO_LIQUIDITY_CONFLUENCE_CONFIG,
  PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID,
  PRO_LIQUIDITY_CONFLUENCE_STRATEGY_LABEL,
  STOCK_GURU_SWEEP_FVG_OB_CONFIG,
  STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
  STOCK_GURU_SWEEP_FVG_OB_STRATEGY_LABEL,
  TJR_SIMPLE_STRUCTURE_PULLBACK_CONFIG,
  TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID,
  TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_LABEL,
  ICT_OTE_CONTINUATION_CONFIG,
  ICT_OTE_CONTINUATION_STRATEGY_ID,
  ICT_OTE_CONTINUATION_STRATEGY_LABEL,
  ICT_IFVG_REVERSAL_CONFIG,
  ICT_IFVG_REVERSAL_STRATEGY_ID,
  ICT_IFVG_REVERSAL_STRATEGY_LABEL,
  getOptionalMasterDisplaySignals,
  type InstitutionalMasterSelectionResult,
  type OptionalMasterSelectionResult,
  type SignalDisplayMode,
  type TradingAppMode,
} from "@/lib/v2-signal-engine";

import {
  EMPTY_PERFORMANCE_SNAPSHOT,
  getPerformanceWarnings,
  type PerformanceSnapshot,
} from "@/lib/performance/performance-monitor";
import { CUSTOM_MULTI_STRATEGY_ID, runSelectedStrategies, runSelectedStrategy } from "@/lib/strategy-runner/run-selected-strategy";

const CandlestickChart = dynamic(
  () => import("@/app/components/candlestick-chart").then((module) => module.CandlestickChart),
  { loading: () => <ChartLoadingShell /> },
);
const SignalDebugPanel = dynamic(
  () => import("./signal-debug-panel").then((module) => module.SignalDebugPanel),
  { loading: () => <PanelLoading title="Loading signal debug" /> },
);
const SignalHistoryTable = dynamic(
  () => import("./signal-history-table").then((module) => module.SignalHistoryTable),
  { loading: () => <PanelLoading title="Loading signal history" /> },
);

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1h"];
const SYMBOL_OPTIONS = ["XAUUSD", "BTCUSD"] as const;
const SENSITIVITIES: MarkerSensitivity[] = ["low", "normal", "high"];
const REPLAY_SPEEDS: ReplayState["speed"][] = [1, 2, 5, 10];

const BASKET_STRATEGIES = [
  { id: PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID, label: PRO_LIQUIDITY_CONFLUENCE_STRATEGY_LABEL },
  { id: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID, label: STOCK_GURU_SWEEP_FVG_OB_STRATEGY_LABEL },
  { id: TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID, label: TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_LABEL },
  { id: ICT_OTE_CONTINUATION_STRATEGY_ID, label: ICT_OTE_CONTINUATION_STRATEGY_LABEL },
  { id: ICT_IFVG_REVERSAL_STRATEGY_ID, label: ICT_IFVG_REVERSAL_STRATEGY_LABEL },
  { id: FVG_CONTINUATION_ENTRY_STRATEGY_ID, label: FVG_CONTINUATION_ENTRY_STRATEGY_LABEL },

  { id: ICT_SILVER_BULLET_STRATEGY_ID, label: ICT_SILVER_BULLET_STRATEGY_LABEL },
  { id: ORDER_BLOCK_RETEST_STRATEGY_ID, label: ORDER_BLOCK_RETEST_STRATEGY_LABEL },
  { id: LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID, label: LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_LABEL },
  { id: VWAP_EMA_STRATEGY_ID, label: VWAP_EMA_STRATEGY_LABEL },
  { id: EMA_TREND_PULLBACK_STRATEGY_ID, label: EMA_TREND_PULLBACK_STRATEGY_LABEL },
  {
    id: GOLDMINE_STRATEGY_ID,
    label: GOLDMINE_STRATEGY_LABEL,
  },
  {
    id: BREAKOUT_STRATEGY_ID,
    label: BREAKOUT_STRATEGY_LABEL,
  },
] as const;
type BasketStrategyId = (typeof BASKET_STRATEGIES)[number]["id"];

const STRATEGIES = [
  {
    id: "ALL_V2",
    label: "All V2 Strategies",
  },
  {
    id: CUSTOM_MULTI_STRATEGY_ID,
    label: "Custom Multi Strategy",
  },
  ...BASKET_STRATEGIES,
] as const;
type StrategyId = (typeof STRATEGIES)[number]["id"];
const DEFAULT_BASKET_STRATEGY_IDS: BasketStrategyId[] = [
  STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID,
  PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID,
  FVG_CONTINUATION_ENTRY_STRATEGY_ID,
];
const MIN_BASKET_STRATEGIES = 1;
const DISPLAY_TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "Europe/London",
  "America/New_York",
  "Asia/Tokyo",
];
const DEFAULT_VISIBILITY: MarkerVisibility = {
  swings: false,
  liquidity: false,
  sweeps: false,
  momentum: false,
  pressure: false,
  structure: false,
  fvg: false,
};
const DEFAULT_CONTEXT_OVERLAYS: ContextOverlayVisibility = {
  dealingRange: false,
  premiumDiscount: false,
  nearestLevels: false,
  sessionLevels: false,
  contextLabels: false,
};
const DEFAULT_CANDLE_REQUEST: CandleFetchRequest = {
  symbol: "XAUUSD",
  timeframe: "5m",
  startDate: "2026-05-20T00:00",
  endDate: "2026-05-29T00:00",
};
type DebugWindow = Window & { DEBUG_GOLDMINE?: boolean };
type FetchStats = {
  lastFetchDurationMs: number;
  duplicateCandlesDetected: number;
};

type IntermarketApiResponse = {
  success: boolean;
  data?: IntermarketSnapshot;
  mode?: IntermarketGateMode;
  cache?: {
    intradayCacheSeconds: number;
    fredCacheSeconds: number;
  };
};

const EMPTY_FETCH_STATS: FetchStats = {
  lastFetchDurationMs: 0,
  duplicateCandlesDetected: 0,
};

function strategyConfigValue(strategyId: StrategyId, field: "rr" | "score" | "window"): string {
  if (strategyId === "ALL_V2") return field === "rr" ? "1.5R" : field === "score" ? "55 / 58 / 60 / 62 / 6-8" : "Strategy specific";
  if (strategyId === CUSTOM_MULTI_STRATEGY_ID) return field === "rr" ? "Per strategy" : field === "score" ? "Per strategy + master" : "Strategy specific";
  if (strategyId === PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID) return field === "rr" ? `${PRO_LIQUIDITY_CONFLUENCE_CONFIG.minRRByMode.normal.toFixed(1)}R` : field === "score" ? `${PRO_LIQUIDITY_CONFLUENCE_CONFIG.minFactorScoreByMode.normal}/${PRO_LIQUIDITY_CONFLUENCE_CONFIG.maxScore}` : `${PRO_LIQUIDITY_CONFLUENCE_CONFIG.maxCandlesToReturnToZone} candles`;
  if (strategyId === STOCK_GURU_SWEEP_FVG_OB_STRATEGY_ID) return field === "rr" ? `${STOCK_GURU_SWEEP_FVG_OB_CONFIG.minRRByMode.normal.toFixed(1)}R` : field === "score" ? String(STOCK_GURU_SWEEP_FVG_OB_CONFIG.minSignalScoreByMode.normal) : `${STOCK_GURU_SWEEP_FVG_OB_CONFIG.retestWindowByMode.normal} candles`;
  if (strategyId === TJR_SIMPLE_STRUCTURE_PULLBACK_STRATEGY_ID) return field === "rr" ? `${TJR_SIMPLE_STRUCTURE_PULLBACK_CONFIG.minRRByMode.normal.toFixed(1)}R` : field === "score" ? String(TJR_SIMPLE_STRUCTURE_PULLBACK_CONFIG.minSignalScoreByMode.normal) : `${TJR_SIMPLE_STRUCTURE_PULLBACK_CONFIG.retestWindowByMode.normal} candles`;
  if (strategyId === ICT_OTE_CONTINUATION_STRATEGY_ID) return field === "rr" ? `${ICT_OTE_CONTINUATION_CONFIG.minRRByMode.normal.toFixed(1)}R` : field === "score" ? `${ICT_OTE_CONTINUATION_CONFIG.minFactorScoreByMode.normal}/${ICT_OTE_CONTINUATION_CONFIG.maxScore}` : `${ICT_OTE_CONTINUATION_CONFIG.maxCandlesToTouchOte} candles`;
  if (strategyId === VWAP_EMA_STRATEGY_ID) return field === "rr" ? `${VWAP_EMA_REGIME_PULLBACK_CONFIG.minRR.toFixed(1)}R` : field === "score" ? String(VWAP_EMA_REGIME_PULLBACK_CONFIG.minSignalScore) : `${VWAP_EMA_REGIME_PULLBACK_CONFIG.maxPullbackCandles} candles`;
  if (strategyId === EMA_TREND_PULLBACK_STRATEGY_ID) return field === "rr" ? `${EMA_TREND_PULLBACK_CONFIG.minRR.toFixed(1)}R` : field === "score" ? String(EMA_TREND_PULLBACK_CONFIG.minSignalScore) : `${EMA_TREND_PULLBACK_CONFIG.maxPullbackCandles} candles`;
  if (strategyId === LIQUIDITY_SWEEP_REVERSAL_PRO_STRATEGY_ID) return field === "rr" ? `${LIQUIDITY_SWEEP_REVERSAL_PRO_CONFIG.minRR.toFixed(1)}R` : field === "score" ? String(LIQUIDITY_SWEEP_REVERSAL_PRO_CONFIG.minSignalScore) : `${LIQUIDITY_SWEEP_REVERSAL_PRO_CONFIG.confirmationWindow} candles`;
  if (strategyId === ORDER_BLOCK_RETEST_STRATEGY_ID) return field === "rr" ? `${ORDER_BLOCK_RETEST_CONFIG.minRR.toFixed(1)}R` : field === "score" ? String(ORDER_BLOCK_RETEST_CONFIG.minSignalScore) : `${ORDER_BLOCK_RETEST_CONFIG.maxRetestCandles} candles`;
  if (strategyId === FVG_CONTINUATION_ENTRY_STRATEGY_ID) return field === "rr" ? `${FVG_CONTINUATION_ENTRY_CONFIG.minRR.toFixed(1)}R` : field === "score" ? String(FVG_CONTINUATION_ENTRY_CONFIG.minSignalScore) : `${FVG_CONTINUATION_ENTRY_CONFIG.maxCandlesToReturnToFvg} candles`;
  if (strategyId === ICT_IFVG_REVERSAL_STRATEGY_ID) return field === "rr" ? `${ICT_IFVG_REVERSAL_CONFIG.minRR.toFixed(1)}R` : field === "score" ? String(ICT_IFVG_REVERSAL_CONFIG.minSignalScore) : `${ICT_IFVG_REVERSAL_CONFIG.maxCandlesToReturnToZone} candles`;
  if (strategyId === BREAKOUT_STRATEGY_ID) return field === "rr" ? `${ASIAN_BREAKOUT_CONFIG.minRR.toFixed(1)}R` : field === "score" ? String(ASIAN_BREAKOUT_CONFIG.minSignalScore) : `${ASIAN_BREAKOUT_CONFIG.confirmationWindow} candles`;

  if (strategyId === ICT_SILVER_BULLET_STRATEGY_ID) return field === "rr" ? `${ICT_SILVER_BULLET_CONFIG.minRR.toFixed(1)}R` : field === "score" ? String(ICT_SILVER_BULLET_CONFIG.minSignalScore) : `${ICT_SILVER_BULLET_CONFIG.maxCandlesToConfirmAfterFvgTap} candles`;
  return field === "rr" ? `${GOLDMINE_CONFIG.minRR.toFixed(1)}R` : field === "score" ? String(GOLDMINE_CONFIG.minSignalScore) : `${GOLDMINE_CONFIG.confirmationWindow} candles`;
}

export function MarketChartApp() {
  const [form, setForm] = useState<CandleFetchRequest>(DEFAULT_CANDLE_REQUEST);
  const [activeRequest, setActiveRequest] = useState<CandleFetchRequest>(
    DEFAULT_CANDLE_REQUEST,
  );
  const [normalizedCandles, setNormalizedCandles] = useState<Candle[]>([]);
  const normalizedCandlesRef = useRef<Candle[]>([]);
  const [visibleRange, setVisibleRange] = useState("No visible range");
  const [markerSettings, setMarkerSettings] = useState<MarketStructureSettings>(
    getDefaultMarketStructureSettings,
  );
  const [markerVisibility, setMarkerVisibility] =
    useState<MarkerVisibility>(DEFAULT_VISIBILITY);
  const [showTooltips, setShowTooltips] = useState(false);
  const hydrationTimezone = useSyncExternalStore(
    subscribeToHydration,
    getInitialTimezone,
    () => "UTC",
  );
  const [selectedDisplayTimezone, setSelectedDisplayTimezone] = useState<string | null>(null);
  const displayTimezone = selectedDisplayTimezone ?? hydrationTimezone;
  const [contextOverlays, setContextOverlays] = useState<ContextOverlayVisibility>(DEFAULT_CONTEXT_OVERLAYS);
  const [strategyEnabled, setStrategyEnabled] = useState(false);
  const [appMode, setAppMode] = useState<TradingAppMode>("RESEARCH");
  const [strategyId, setStrategyId] = useState<StrategyId>(PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID);
  const [basketStrategyIds, setBasketStrategyIds] = useState<BasketStrategyId[]>(DEFAULT_BASKET_STRATEGY_IDS);

  const [maxRiskAmount, setMaxRiskAmount] = useState(100);
  const [showStrategySignals, setShowStrategySignals] = useState(false);
  const [masterSelectorEnabled, setMasterSelectorEnabled] = useState(false);
  const [masterSelectorDisplayMode, setMasterSelectorDisplayMode] = useState<SignalDisplayMode>("RAW_SIGNALS");
  const [masterSelectorCooldownEnabled, setMasterSelectorCooldownEnabled] = useState(false);
  const [showSuppressedMasterSignals, setShowSuppressedMasterSignals] = useState(true);
  const [showMasterConflictWarnings, setShowMasterConflictWarnings] = useState(true);
  const [showProductionRawMarkers, setShowProductionRawMarkers] = useState(false);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [fetchStats, setFetchStats] = useState<FetchStats>(EMPTY_FETCH_STATS);
  const [performanceSnapshot, setPerformanceSnapshot] = useState<PerformanceSnapshot>(EMPTY_PERFORMANCE_SNAPSHOT);
  const intermarketEnabled = process.env.NEXT_PUBLIC_ENABLE_INTERMARKET_GATE !== "false";
  const [intermarketSnapshot, setIntermarketSnapshot] = useState<IntermarketSnapshot | null>(null);
  const [intermarketGateMode, setIntermarketGateMode] = useState<IntermarketGateMode>("SCORE_ONLY");
  const [intermarketError, setIntermarketError] = useState<string | null>(null);
  const [showIntermarketOverlay, setShowIntermarketOverlay] = useState(false);
  const intermarketLoading = intermarketEnabled && strategyEnabled && !intermarketSnapshot && !intermarketError;
  const previousLastClosedCandleTimeRef = useRef<number | null>(null);

  // Session hours configurations
  const [asianStart, setAsianStart] = useState(0);
  const [asianEnd, setAsianEnd] = useState(7);
  const [londonStart, setLondonStart] = useState(7);
  const [londonEnd, setLondonEnd] = useState(11);
  const [newYorkStart, setNewYorkStart] = useState(12);
  const [newYorkEnd, setNewYorkEnd] = useState(16);
  const [debugGoldmine, setDebugGoldmine] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as DebugWindow).DEBUG_GOLDMINE = debugGoldmine;
    }
  }, [debugGoldmine]);

  useEffect(() => {
    normalizedCandlesRef.current = normalizedCandles;
  }, [normalizedCandles]);
  const [replay, setReplay] = useState<ReplayState>({
    enabled: false,
    playing: false,
    speed: 1,
    index: 0,
  });
  const [liveMode, setLiveMode] = useState(false);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const chartCandles = useMemo(
    () =>
      filterCandlesByDateRange(
        normalizedCandles,
        activeRequest.startDate,
        activeRequest.endDate,
      ),
    [activeRequest.endDate, activeRequest.startDate, normalizedCandles],
  );
  const marketStructure = useMemo(
    () =>
      calculateMarketStructure({
        candles: chartCandles,
        symbol: activeRequest.symbol,
        timeframe: activeRequest.timeframe,
        startDate: activeRequest.startDate,
        endDate: activeRequest.endDate,
        settings: markerSettings,
      }),
    [
      activeRequest.endDate,
      activeRequest.startDate,
      activeRequest.symbol,
      activeRequest.timeframe,
      chartCandles,
      markerSettings,
    ],
  );
  const replayIndex = replay.enabled
    ? Math.min(replay.index, Math.max(0, chartCandles.length - 1))
    : Math.max(0, chartCandles.length - 1);
  const displayCandles = useMemo(
    () =>
      replay.enabled ? chartCandles.slice(0, replayIndex + 1) : chartCandles,
    [chartCandles, replay.enabled, replayIndex],
  );
  const displayMarkers = useMemo(() => {
    const replayFiltered = replay.enabled
      ? getReplayVisibleMarkers(marketStructure.markers, replayIndex)
      : marketStructure.markers;

    return replayFiltered.filter((marker) =>
      isMarkerVisible(marker, markerVisibility),
    );
  }, [marketStructure.markers, markerVisibility, replay.enabled, replayIndex]);
  const displayLiquidityZones = useMemo(() => {
    if (!markerVisibility.liquidity) {
      return [];
    }

    return replay.enabled
      ? getReplayVisibleZones(marketStructure.liquidityZones, replayIndex)
      : marketStructure.liquidityZones;
  }, [
    marketStructure.liquidityZones,
    markerVisibility.liquidity,
    replay.enabled,
    replayIndex,
  ]);
  const currentReplayCandle = replay.enabled ? chartCandles[replayIndex] : null;
  const marketContext = useMemo(
    () => calculateMarketContext({
      candles: displayCandles,
      symbol: activeRequest.symbol,
      timeframe: activeRequest.timeframe,
      startDate: activeRequest.startDate,
      endDate: activeRequest.endDate,
      marketStructureSettings: markerSettings,
      displayTimezone,
    }),
    [activeRequest.endDate, activeRequest.startDate, activeRequest.symbol, activeRequest.timeframe, displayCandles, markerSettings, displayTimezone],
  );
  const lastClosedCandleTime = useMemo(
    () => getLastClosedCandleTime(displayCandles),
    [displayCandles],
  );

  useEffect(() => {
    if (!intermarketEnabled || !strategyEnabled) {
      return;
    }

    const controller = new AbortController();

    fetch("/api/market/intermarket?interval=5m&range=1d", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Intermarket route returned HTTP ${response.status}.`);
        }

        return (await response.json()) as IntermarketApiResponse;
      })
      .then((payload) => {
        if (!payload.success || !payload.data) {
          throw new Error("Intermarket data unavailable.");
        }

        setIntermarketSnapshot(payload.data);
        setIntermarketGateMode(payload.mode ?? "SCORE_ONLY");
        setIntermarketError(null);
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return;
        setIntermarketError(fetchError instanceof Error ? fetchError.message : "Intermarket data unavailable.");
        setIntermarketSnapshot(null);
      });

    return () => controller.abort();
  }, [intermarketEnabled, lastClosedCandleTime, strategyEnabled]);

  const strategyResult = useMemo(() => {
    if (!strategyEnabled) {
      return null;
    }

    const strategyInput = {
      candles: displayCandles,
      symbol: activeRequest.symbol,
      timeframe: activeRequest.timeframe,
      startDate: activeRequest.startDate,
      endDate: activeRequest.endDate,
      structure: marketStructure,
      context: marketContext,
      settings: {
        maxRiskAmount,
        sessionHours: {
          asianStart,
          asianEnd,
          londonStart,
          londonEnd,
          newYorkStart,
          newYorkEnd,
        },
      },
    };

    const optionalMasterSelector = {
      enabled: appMode === "RESEARCH" && masterSelectorEnabled,
      displayMode: masterSelectorDisplayMode,
      cooldownEnabled: masterSelectorCooldownEnabled,
      showSuppressedSignals: showSuppressedMasterSignals,
      showConflictWarnings: showMasterConflictWarnings,
    };

    return strategyId === CUSTOM_MULTI_STRATEGY_ID
      ? runSelectedStrategies(basketStrategyIds, strategyInput, {
          appMode,
          optionalMasterSelector,
          intermarketSnapshot: intermarketEnabled ? intermarketSnapshot : null,
          intermarketGateMode: intermarketEnabled ? intermarketGateMode : "OFF",
        })
      : runSelectedStrategy(strategyId, strategyInput, {
          appMode,
          optionalMasterSelector,
          intermarketSnapshot: intermarketEnabled ? intermarketSnapshot : null,
          intermarketGateMode: intermarketEnabled ? intermarketGateMode : "OFF",
        });
  }, [
    activeRequest.endDate,
    activeRequest.startDate,
    activeRequest.symbol,
    activeRequest.timeframe,
    displayCandles,
    marketContext,
    marketStructure,
    maxRiskAmount,
    basketStrategyIds,
    appMode,
    intermarketEnabled,
    intermarketGateMode,
    intermarketSnapshot,
    masterSelectorCooldownEnabled,
    masterSelectorDisplayMode,
    masterSelectorEnabled,
    showMasterConflictWarnings,
    showSuppressedMasterSignals,
    strategyEnabled,
    strategyId,
    asianStart,
    asianEnd,
    londonStart,
    londonEnd,
    newYorkStart,
    newYorkEnd,
  ]);

  const rawStrategySignals = useMemo(() => strategyResult?.activeSignals ?? [], [strategyResult]);
  const strategySignals = useMemo(() => {
    if (appMode === "PRODUCTION" && strategyResult?.institutionalSelection) {
      const finalSignals = strategyResult.institutionalSelection.finalSignals;
      return showProductionRawMarkers ? [...rawStrategySignals, ...finalSignals] : finalSignals;
    }
    if (!strategyResult?.optionalMasterSelection) return rawStrategySignals;
    return getOptionalMasterDisplaySignals(strategyResult.optionalMasterSelection, masterSelectorDisplayMode, { showSuppressedSignals: showSuppressedMasterSignals });
  }, [appMode, masterSelectorDisplayMode, rawStrategySignals, showProductionRawMarkers, showSuppressedMasterSignals, strategyResult]);
  const selectedSignal = useMemo(
    () => strategySignals.find((signal) => signal.id === selectedSignalId) ?? null,
    [selectedSignalId, strategySignals],
  );
  const handleVisibleRangeChange = useCallback((value: string) => {
    setVisibleRange((current) => (current === value ? current : value));
  }, []);
  const handleMarkerHover = useCallback(() => undefined, []);
  const handleSignalHover = useCallback(() => undefined, []);
  const handleBasketStrategyToggle = useCallback((nextStrategyId: BasketStrategyId, checked: boolean) => {
    setBasketStrategyIds((current) => {
      if (checked) {
        if (current.includes(nextStrategyId)) return current;
        return [...current, nextStrategyId];
      }

      if (current.length <= MIN_BASKET_STRATEGIES) return current;
      return current.filter((item) => item !== nextStrategyId);
    });
  }, []);
  const handleMasterSelectorEnabledChange = useCallback((checked: boolean) => {
    setMasterSelectorEnabled(checked);
    setMasterSelectorDisplayMode(checked ? "MASTER_SELECTED" : "RAW_SIGNALS");
  }, []);

  const fetchAndApplyCandles = useCallback(async (
    request: CandleFetchRequest,
    options: {
      mergeWithExisting?: boolean;
      resetReplay?: boolean;
      syncForm?: boolean;
    } = {},
  ) => {
    const validationError = validateCandleRequest(request);

    if (validationError) {
      setError(validationError);
      return;
    }

    abortRef.current?.abort();

    const abortController = new AbortController();
    abortRef.current = abortController;

    setLoading(true);
    setError(null);
    setHasFetched(true);
    if (options.resetReplay ?? true) {
      setReplay((current) => ({
        ...current,
        enabled: false,
        playing: false,
        index: 0,
      }));
    }

    try {
      const fetchStartedAt = performance.now();
      const response = await fetchCandles(
        request,
        abortController.signal,
      );
      const clientFetchDurationMs = performance.now() - fetchStartedAt;

      await yieldToBrowser();

      const normalization = normalizeCandles(response.rawCandles, {
        timeframe: request.timeframe,
      });
      const shouldMerge =
        Boolean(options.mergeWithExisting) &&
        activeRequest.symbol === request.symbol &&
        activeRequest.timeframe === request.timeframe;
      const previousCandles = shouldMerge ? normalizedCandlesRef.current : [];
      const previousLastClosedCandleTime =
        previousLastClosedCandleTimeRef.current ?? getLastClosedCandleTime(previousCandles);
      const mergeResult = mergeCandlesByTimestamp(previousCandles, normalization.candles);
      const hasNewClosedCandle = shouldRunStrategyScan(
        previousLastClosedCandleTime,
        mergeResult.lastClosedCandleTime,
      );
      const duplicateCandlesDetected = normalization.removedDuplicateCount + mergeResult.duplicateCount;

      setFetchStats({
        lastFetchDurationMs: Math.round(response.fetchDurationMs || clientFetchDurationMs),
        duplicateCandlesDetected,
      });

      const shouldSkipCandleStateUpdate =
        shouldMerge &&
        !hasNewClosedCandle &&
        mergeResult.addedCount === 0 &&
        mergeResult.replacedCount === 0;

      if (!shouldSkipCandleStateUpdate) {
        normalizedCandlesRef.current = mergeResult.candles;
        previousLastClosedCandleTimeRef.current = mergeResult.lastClosedCandleTime;
        setNormalizedCandles((current) =>
          areSameCandleSequence(current, mergeResult.candles) ? current : mergeResult.candles,
        );
        setVisibleRange((current) => (current === "No visible range" ? current : "No visible range"));
      }

      setActiveRequest((current) => (areCandleRequestsEqual(current, request) ? current : request));
      if (options.syncForm) {
        setForm((current) => (areCandleRequestsEqual(current, request) ? current : request));
      }
    } catch (fetchError) {
      if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
        return;
      }

      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Unable to fetch candles.",
      );
    } finally {
      if (abortRef.current === abortController) {
        setLoading(false);
      }
    }
  }, [activeRequest.symbol, activeRequest.timeframe]);

  const handleTimeframeChange = useCallback(async (tf: string) => {
    const updatedForm = { ...form, timeframe: tf as Timeframe };
    const request = {
      ...updatedForm,
      symbol: updatedForm.symbol.trim().toUpperCase(),
    };

    setForm(updatedForm);
    await fetchAndApplyCandles(request, {
      resetReplay: true,
      syncForm: true,
    });
  }, [fetchAndApplyCandles, form]);

  const handleFetch = useCallback(async () => {
    const request = {
      ...form,
      symbol: form.symbol.trim().toUpperCase(),
    };

    await fetchAndApplyCandles(request, {
      resetReplay: true,
      syncForm: true,
    });
  }, [fetchAndApplyCandles, form]);

  useEffect(() => {
    if (!replay.enabled || !replay.playing) {
      return;
    }

    const timer = window.setInterval(() => {
      setReplay((current) => {
        const maxIndex = Math.max(0, chartCandles.length - 1);

        if (current.index >= maxIndex) {
          return {
            ...current,
            playing: false,
            index: maxIndex,
          };
        }

        return {
          ...current,
          index: Math.min(maxIndex, current.index + 1),
        };
      });
    }, Math.max(80, 700 / replay.speed));

    return () => window.clearInterval(timer);
  }, [chartCandles.length, replay.enabled, replay.playing, replay.speed]);

  useEffect(() => {
    if (!liveMode) {
      return;
    }

    const timer = window.setInterval(() => {
      const request = {
        ...form,
        symbol: form.symbol.trim().toUpperCase(),
      };

      void fetchAndApplyCandles(request, {
        mergeWithExisting: true,
        resetReplay: false,
      });
    }, getPollingIntervalMs(form.timeframe));

    return () => window.clearInterval(timer);
  }, [fetchAndApplyCandles, form, liveMode]);

  useEffect(() => {
    if (!chartFullscreen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setChartFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [chartFullscreen]);

  useEffect(() => {
    const renderMeasureStartedAt = performance.now();
    const frame = window.requestAnimationFrame(() => {
      const cacheStats = getStrategyResultCacheStats();
      const nextSnapshot: PerformanceSnapshot = {
        candlesCount: normalizedCandles.length,
        visibleCandlesCount: displayCandles.length,
        lastFetchDurationMs: fetchStats.lastFetchDurationMs,
        lastScanDurationMs: Math.round(strategyResult?.audit.generationTimeMs ?? 0),
        lastRenderDurationMs: Math.round(performance.now() - renderMeasureStartedAt),
        indicatorCalculationMs: Math.round(marketStructure.audit.calculationTimeMs),
        strategyScanMs: Math.round(strategyResult?.audit.generationTimeMs ?? 0),
        memoryCacheSize: cacheStats.size + getIndicatorEngineCacheSize(),
        signalsCount: strategySignals.length,
        pendingSetupsCount: strategyResult?.pendingCandidates.length ?? 0,
        rejectedSetupsCount: strategyResult?.rejectedSetups.length ?? 0,
        duplicateCandlesDetected: fetchStats.duplicateCandlesDetected,
        duplicateSignalsPrevented: cacheStats.duplicateSignalsPrevented,
        visibleMarkersCount: displayMarkers.length + (showStrategySignals ? strategySignals.length : 0),
      };

      setPerformanceSnapshot((current) =>
        arePerformanceSnapshotsEqual(current, nextSnapshot) ? current : nextSnapshot,
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    displayCandles.length,
    displayMarkers.length,
    fetchStats,
    lastClosedCandleTime,
    marketStructure.audit.calculationTimeMs,
    normalizedCandles.length,
    showStrategySignals,
    strategyResult,
    strategySignals.length,
  ]);

  return (
    <main className="min-h-screen bg-[#131722] text-[#d1d4dc] font-sans">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-3 py-4 sm:px-4 lg:px-5">
        <header className="flex flex-col gap-1 border-b border-[#2a2e39] pb-4">
          <h1 className="text-xl font-bold tracking-wider text-white">
            XAUUSD Market Intelligence Portal
          </h1>
          <p className="text-sm text-[#848e9c]">
            Scalping Analysis & Automated Execution Environment
          </p>
        </header>

        <section className="border border-[#2a2e39] bg-[#1c2030] p-4 rounded shadow-lg">
          <div className="grid gap-3 md:grid-cols-[110px_120px_190px_190px_150px_auto_auto] md:items-end">
            <label className="flex flex-col gap-1 text-sm font-semibold text-[#cbd5e1]">
              Symbol
              <select
                value={form.symbol}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    symbol: event.target.value,
                  }))
                }
                className="h-9 border border-[#2a2e39] bg-[#131722] text-white px-2 text-xs uppercase outline-none transition focus:border-[#E91E63] rounded"
              >
                {SYMBOL_OPTIONS.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm font-semibold text-[#cbd5e1]">
              Timeframe
              <select
                value={form.timeframe}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    timeframe: event.target.value as Timeframe,
                  }))
                }
                className="h-10 border border-[#2a2e39] bg-[#131722] text-white px-3 text-sm outline-none transition focus:border-[#E91E63] rounded"
              >
                {TIMEFRAMES.map((timeframe) => (
                  <option key={timeframe} value={timeframe}>
                    {timeframe}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm font-semibold text-[#cbd5e1]">
              Start date
              <input
                type="datetime-local"
                value={form.startDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }))
                }
                className="h-10 border border-[#2a2e39] bg-[#131722] text-white px-3 text-sm outline-none transition focus:border-[#E91E63] rounded"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-semibold text-[#cbd5e1]">
              End date
              <input
                type="datetime-local"
                value={form.endDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }))
                }
                className="h-10 border border-[#2a2e39] bg-[#131722] text-[#cbd5e1] px-3 text-sm outline-none transition focus:border-[#E91E63] rounded"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-semibold text-[#cbd5e1]">
              Display timezone
              <select
                value={displayTimezone}
                onChange={(event) => setSelectedDisplayTimezone(event.target.value)}
                className="h-10 border border-[#2a2e39] bg-[#131722] text-white px-2 text-xs outline-none transition focus:border-[#E91E63] rounded"
              >
                {DISPLAY_TIMEZONES.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={handleFetch}
              disabled={loading}
              className="h-10 bg-[#E91E63] hover:bg-[#FF6B35] disabled:bg-[#2a2e39] disabled:text-[#848e9c] border border-transparent px-5 text-sm font-bold text-white transition rounded disabled:cursor-not-allowed"
            >
              {loading ? "Fetching" : "Fetch"}
            </button>
            <button
              type="button"
              onClick={() => setChartFullscreen(true)}
              className="h-10 border border-[#2a2e39] bg-[#131722] text-[#cbd5e1] px-4 text-sm font-semibold hover:bg-[#2a2e39] transition rounded"
            >
              Full chart
            </button>
          </div>
        </section>

        <section className="grid gap-4 border border-[#2a2e39] bg-[#1c2030] p-4 rounded shadow-lg lg:grid-cols-[1fr_1fr]">
          <MarkerControls
            settings={markerSettings}
            visibility={markerVisibility}
            showTooltips={showTooltips}
            liveMode={liveMode}
            onSettingsChange={setMarkerSettings}
            onVisibilityChange={setMarkerVisibility}
            onShowTooltipsChange={setShowTooltips}
            onLiveModeChange={setLiveMode}
          />
          <ReplayControls
            replay={replay}
            maxIndex={Math.max(0, chartCandles.length - 1)}
            currentTimestamp={currentReplayCandle?.time ?? null}
            onReplayChange={setReplay}
          />
          <ContextOverlayControls visibility={contextOverlays} onChange={setContextOverlays} />
        </section>

        <StrategyActivationControls
          enabled={strategyEnabled}
          appMode={appMode}
          strategyId={strategyId}
          maxRiskAmount={maxRiskAmount}
          showSignals={showStrategySignals}
          signalCount={strategySignals.length}
          onEnabledChange={setStrategyEnabled}
          onAppModeChange={setAppMode}
          onStrategyChange={setStrategyId}
          basketStrategyIds={basketStrategyIds}
          onBasketStrategyToggle={handleBasketStrategyToggle}
          onMaxRiskAmountChange={setMaxRiskAmount}
          onShowSignalsChange={setShowStrategySignals}
          masterSelectorEnabled={masterSelectorEnabled}
          masterSelectorDisplayMode={masterSelectorDisplayMode}
          masterSelectorCooldownEnabled={masterSelectorCooldownEnabled}
          showSuppressedMasterSignals={showSuppressedMasterSignals}
          showMasterConflictWarnings={showMasterConflictWarnings}
          onMasterSelectorEnabledChange={handleMasterSelectorEnabledChange}
          onMasterSelectorDisplayModeChange={setMasterSelectorDisplayMode}
          onMasterSelectorCooldownEnabledChange={setMasterSelectorCooldownEnabled}
          onShowSuppressedMasterSignalsChange={setShowSuppressedMasterSignals}
          onShowMasterConflictWarningsChange={setShowMasterConflictWarnings}
          showProductionRawMarkers={showProductionRawMarkers}
          onShowProductionRawMarkersChange={setShowProductionRawMarkers}
          asianStart={asianStart}
          asianEnd={asianEnd}
          londonStart={londonStart}
          londonEnd={londonEnd}
          newYorkStart={newYorkStart}
          newYorkEnd={newYorkEnd}
          debugGoldmine={debugGoldmine}
          onAsianStartChange={setAsianStart}
          onAsianEndChange={setAsianEnd}
          onLondonStartChange={setLondonStart}
          onLondonEndChange={setLondonEnd}
          onNewYorkStartChange={setNewYorkStart}
          onNewYorkEndChange={setNewYorkEnd}
          onDebugGoldmineChange={setDebugGoldmine}
        />

        <div
          className={
            chartFullscreen
              ? "fixed inset-0 z-50 overflow-hidden bg-[#131722]"
              : "w-full flex-1 overflow-hidden rounded border border-[#2a2e39] bg-[#131722]"
          }
        >
          <CandlestickChart
            candles={displayCandles}
            markers={displayMarkers}
            liquidityZones={displayLiquidityZones}
            loading={loading}
            error={error}
            hasFetched={hasFetched}
            visibleRange={visibleRange}
            showTooltips={showTooltips}
            candleReading={null}
            marketContext={marketContext}
            contextOverlays={contextOverlays}
            setups={[]}
            showSetupOverlays={false}
            signals={strategyEnabled ? strategySignals : []}
            showSignalOverlays={strategyEnabled && showStrategySignals}
            selectedSignalId={selectedSignalId}
            isFullscreen={chartFullscreen}
            activeTimeframe={activeRequest?.timeframe || form.timeframe}
            symbol={activeRequest?.symbol || form.symbol}
            markerVisibility={markerVisibility}
            onMarkerHover={handleMarkerHover}
            onSignalHover={handleSignalHover}
            onFullscreenChange={setChartFullscreen}
            onVisibleRangeChange={handleVisibleRangeChange}
            onTimeframeChange={handleTimeframeChange}
            onMarkerVisibilityChange={setMarkerVisibility}
            v2AsianRanges={strategyEnabled ? (strategyResult?.v2AsianRanges ?? []) : []}
            intermarketSnapshot={intermarketSnapshot}
            showIntermarketOverlay={showIntermarketOverlay}
          />
        </div>

        {strategyEnabled ? (
          <IntermarketMacroPanel
            enabled={intermarketEnabled}
            loading={intermarketLoading}
            error={intermarketError}
            snapshot={intermarketSnapshot}
            mode={intermarketGateMode}
            showOverlay={showIntermarketOverlay}
            onShowOverlayChange={setShowIntermarketOverlay}
          />
        ) : null}

        {strategyEnabled && appMode === "RESEARCH" && strategyResult?.optionalMasterSelection ? (
          <OptionalMasterSelectorPanel selection={strategyResult.optionalMasterSelection} />
        ) : null}

        {strategyEnabled && appMode === "PRODUCTION" && strategyResult?.institutionalSelection ? (
          <InstitutionalGatekeeperPanel selection={strategyResult.institutionalSelection} />
        ) : null}

        {strategyEnabled && strategyResult && (
          <div className="mt-4 border border-[#2a2e39] bg-[#1c2030] p-4 rounded shadow-lg">
            <SignalDebugPanel
              result={strategyResult}
              selectedSignal={selectedSignal}
              cacheStatusLabel={strategyResult.audit.cacheStatus === "hit" ? "Hit" : "Miss"}
              generationTimeLabel={`${strategyResult.audit.generationTimeMs.toFixed(2)} ms`}
            />
          </div>
        )}

        {strategyEnabled && (
          <SignalHistoryTable
            signals={strategySignals}
            symbol={activeRequest.symbol}
            timeframe={activeRequest.timeframe}
            selectedSignalId={selectedSignalId}
            onSignalSelect={(signal) => setSelectedSignalId(signal.id)}
          />
        )}

        <PerformanceMonitorPanel snapshot={performanceSnapshot} />
      </div>
    </main>
  );
}

function ChartLoadingShell() {
  return (
    <div className="flex min-h-[calc(100vh-96px)] items-center justify-center border border-[#2a2e39] bg-[#131722] text-sm font-semibold text-[#cbd5e1]">
      Loading chart
    </div>
  );
}

function PanelLoading({ title }: { title: string }) {
  return (
    <div className="border border-[#2a2e39] bg-[#131722] px-4 py-6 text-sm font-semibold text-[#cbd5e1]">
      {title}
    </div>
  );
}

function IntermarketMacroPanel({
  enabled,
  loading,
  error,
  snapshot,
  mode,
  showOverlay,
  onShowOverlayChange,
}: {
  enabled: boolean;
  loading: boolean;
  error: string | null;
  snapshot: IntermarketSnapshot | null;
  mode: IntermarketGateMode;
  showOverlay: boolean;
  onShowOverlayChange: (value: boolean) => void;
}) {
  const warnings = snapshot?.warnings ?? [];
  const status = snapshot ? goldBiasStatus(snapshot.fred.dailyBias) : "Intermarket data unavailable. Signals are based on XAUUSD only.";

  return (
    <section className="border border-[#2a2e39] bg-[#131722] text-[#cbd5e1]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase text-white">Intermarket Macro</h2>
          <p className="mt-1 text-xs text-[#848e9c]">{enabled ? `Mode ${mode}` : "Gate disabled"}</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-[#cbd5e1]">
          <input
            type="checkbox"
            checked={showOverlay}
            disabled={!snapshot}
            onChange={(event) => onShowOverlayChange(event.target.checked)}
          />
          Show Intermarket Overlay
        </label>
      </div>

      {!enabled ? (
        <div className="px-4 py-3 text-sm text-[#848e9c]">Intermarket gate is disabled.</div>
      ) : error ? (
        <div className="px-4 py-3 text-sm text-amber-200">{error}</div>
      ) : loading && !snapshot ? (
        <div className="px-4 py-3 text-sm text-[#848e9c]">Loading DXY, TNX, and FRED context.</div>
      ) : snapshot ? (
        <div className="grid gap-3 p-4 text-xs lg:grid-cols-[1.2fr_0.8fr]">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <ValueBadge label="Gold Bias" value={snapshot.fred.dailyBias} />
            <ValueBadge label="DXY 5M" value={`${snapshot.dxy.trend} / ${snapshot.dxy.momentum}`} />
            <ValueBadge label="TNX 5M" value={`${snapshot.tnx.trend} / ${snapshot.tnx.momentum}`} />
            <ValueBadge label="Status" value={status} />
            <ValueBadge label="DGS10" value={snapshot.fred.dgs10?.bias ?? "UNKNOWN"} />
            <ValueBadge label="DFII10" value={snapshot.fred.dfii10?.bias ?? "UNKNOWN"} />
            <ValueBadge label="DXY Close" value={formatNullableNumber(snapshot.dxy.latestClose)} />
            <ValueBadge label="TNX Close" value={formatNullableNumber(snapshot.tnx.latestClose)} />
          </div>
          <div className="border border-[#2a2e39] bg-[#1c2030] p-3">
            <p className="font-semibold text-white">Updated {formatShortDateTime(snapshot.updatedAt)}</p>
            <p className="mt-2 text-[#848e9c]">
              DXY {formatChange(snapshot.dxy.changePercent)} | TNX {formatChange(snapshot.tnx.changePercent)}
            </p>
            {warnings.length ? (
              <p className="mt-2 break-words text-amber-200">{warnings.join(", ")}</p>
            ) : (
              <p className="mt-2 text-emerald-300">No API warnings</p>
            )}
          </div>
        </div>
      ) : (
        <div className="px-4 py-3 text-sm text-[#848e9c]">Intermarket data unavailable. Signals are based on XAUUSD only.</div>
      )}
    </section>
  );
}

const PerformanceMonitorPanel = memo(function PerformanceMonitorPanel({ snapshot }: { snapshot: PerformanceSnapshot }) {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const warnings = getPerformanceWarnings(snapshot);

  return (
    <section className="border border-[#2a2e39] bg-[#131722] p-3 text-xs text-[#cbd5e1]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold uppercase text-white">Performance</h2>
        <div className="flex flex-wrap gap-1.5">
          {warnings.length > 0 ? warnings.map((warning) => (
            <span key={warning} className="border border-amber-500/50 bg-amber-500/10 px-2 py-1 font-semibold text-amber-200">
              {warning}
            </span>
          )) : (
            <span className="border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-200">
              OK
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <ValueBadge label="Candles" value={`${snapshot.visibleCandlesCount} / ${snapshot.candlesCount}`} />
        <ValueBadge label="Fetch" value={`${snapshot.lastFetchDurationMs} ms`} />
        <ValueBadge label="Scan" value={`${snapshot.lastScanDurationMs} ms`} />
        <ValueBadge label="Strategy" value={`${snapshot.strategyScanMs} ms`} />
        <ValueBadge label="Render" value={`${snapshot.lastRenderDurationMs} ms`} />
        <ValueBadge label="Indicators" value={`${snapshot.indicatorCalculationMs} ms`} />
        <ValueBadge label="Cache" value={String(snapshot.memoryCacheSize)} />
        <ValueBadge label="Signals" value={String(snapshot.signalsCount)} />
        <ValueBadge label="Pending" value={String(snapshot.pendingSetupsCount)} />
        <ValueBadge label="Rejected" value={String(snapshot.rejectedSetupsCount)} />
      </div>
    </section>
  );
});

const ContextOverlayControls = memo(function ContextOverlayControls({ visibility, onChange }: { visibility: ContextOverlayVisibility; onChange: (value: ContextOverlayVisibility) => void }) {
  const allChecked = Object.values(visibility).every(Boolean);

  return (
    <div className="border-t border-[#2a2e39] pt-3 lg:col-span-2">
      <h2 className="text-sm font-semibold uppercase text-[#cbd5e1]">Context Overlays</h2>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        <label className="flex items-center gap-2 text-sm font-semibold text-white">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={(event) => onChange(setAllContextOverlays(event.target.checked))}
          />
          All overlays
        </label>
        {Object.entries(visibility).map(([key, value]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-[#cbd5e1]">
            <input type="checkbox" checked={value} onChange={(event) => onChange({ ...visibility, [key]: event.target.checked })} />
            {formatControlLabel(key)}
          </label>
        ))}
      </div>
    </div>
  );
});

function OptionalMasterSelectorPanel({ selection }: { selection: OptionalMasterSelectionResult }) {
  const unresolvedConflict = selection.conflictSignals.find((conflict) => conflict.decision === "NO_TRADE");
  return (
    <section className="border border-[#2a2e39] bg-[#131722] text-[#cbd5e1]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase text-white">Master Signal Selector</h2>
          <p className="mt-1 text-xs text-[#848e9c]">
            {selection.enabled ? `${selection.rawSignals.length} raw | ${selection.groupedSignals.length} groups | ${selection.suppressedSignals.length} suppressed` : "Master Selector is disabled. Displaying raw strategy signals."}
          </p>
        </div>
        <span className={`px-2 py-1 text-xs font-bold ${!selection.enabled ? "bg-[#2a2e39] text-[#848e9c]" : unresolvedConflict ? "bg-amber-500/15 text-amber-300" : selection.finalSignals.length ? "bg-emerald-500/15 text-emerald-300" : "bg-[#2a2e39] text-[#848e9c]"}`}>
          {!selection.enabled ? "OFF" : unresolvedConflict ? "NO_TRADE" : selection.finalSignals.length ? `${selection.finalSignals.length} ACTIONABLE` : "NO SIGNAL"}
        </span>
      </div>
      {!selection.enabled ? (
        <div className="px-4 py-3 text-sm text-[#848e9c]">
          Master Selector is disabled. Displaying raw strategy signals.
        </div>
      ) : null}
      {unresolvedConflict ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <strong>BUY/SELL conflict: NO_TRADE.</strong> {unresolvedConflict.reason}
        </div>
      ) : null}
      {selection.enabled ? <div className="grid gap-3 p-4 lg:grid-cols-2">
        {selection.finalSignals.map((signal) => (
          <article key={signal.masterSignalId} className="border border-[#2a2e39] bg-[#1c2030] p-4">
            <div className="flex items-center justify-between gap-3">
              <strong className={signal.action === "BUY" ? "text-emerald-300" : "text-rose-300"}>{signal.masterAction}</strong>
              <span className="text-xs font-bold text-amber-300">{signal.masterScore.toFixed(1)} | {signal.masterConfidence}</span>
            </div>
            <p className="mt-2 text-xs text-[#848e9c]">Selected strategy</p>
            <p className="break-words text-sm font-semibold text-white">{signal.selectedStrategy}</p>
            <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
              <ValueBadge label="Entry" value={signal.entryPrice.toFixed(2)} />
              <ValueBadge label="SL" value={signal.stopLoss.toFixed(2)} />
              <ValueBadge label="TP" value={signal.takeProfit.toFixed(2)} />
              <ValueBadge label="RR" value={`${signal.rr.toFixed(2)}R`} />
            </div>
            <p className="mt-3 text-xs leading-5 text-[#cbd5e1]">{signal.selectionReason}</p>
            <p className="mt-2 text-xs text-[#848e9c]">Confirmed by {signal.sourceStrategies.join(", ")}{signal.postEntryConfluenceCount ? ` + ${signal.postEntryConfluenceCount} after entry` : ""}</p>
            {signal.suppressedSignalIds.length ? <p className="mt-1 text-xs text-[#848e9c]">Suppressed duplicates: {signal.suppressedSignalIds.length}</p> : null}
            {signal.conflictSignalIds.length ? <p className="mt-1 text-xs text-amber-200">Conflict warning: {signal.conflictSignalIds.length} opposite signal{signal.conflictSignalIds.length === 1 ? "" : "s"} nearby</p> : null}
          </article>
        ))}
        {!selection.finalSignals.length && !unresolvedConflict ? <p className="text-sm text-[#848e9c]">No grouped raw signal was selected by the optional master selector.</p> : null}
      </div> : null}
    </section>
  );
}

function InstitutionalGatekeeperPanel({ selection }: { selection: InstitutionalMasterSelectionResult }) {
  const signal = selection.finalSignal;
  const reasons = selection.debug.noTradeReasons;
  return (
    <section className="border border-[#2a2e39] bg-[#131722] text-[#cbd5e1]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2a2e39] bg-[#1e222d] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase text-white">Institutional Master Gatekeeper</h2>
          <p className="mt-1 text-xs text-[#848e9c]">
            {selection.debug.evaluatedCount} evaluated | {selection.finalSignals.length} production signal{selection.finalSignals.length === 1 ? "" : "s"}
          </p>
        </div>
        <span className={`px-3 py-1 text-xs font-bold ${signal ? (signal.action === "MASTER_BUY" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300") : "bg-amber-500/15 text-amber-300"}`}>
          {signal?.action ?? "NO_TRADE"}
        </span>
      </div>

      {signal ? (
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <p className="text-xs text-[#848e9c]">Selected strategy</p>
            <p className="break-words text-sm font-semibold text-white">{signal.selectedStrategy}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <ValueBadge label="Entry" value={signal.entryPrice.toFixed(2)} />
              <ValueBadge label={`SL · ${signal.stopSource}`} value={signal.structuralStopLoss.toFixed(2)} />
              <ValueBadge label={`TP · ${signal.targetSource}`} value={signal.structuralTakeProfit.toFixed(2)} />
              <ValueBadge label="RR" value={`${signal.rr.toFixed(2)}R`} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <ValueBadge label="Factor score" value={`${signal.factorScore}/6`} />
              <ValueBadge label="Threshold" value={signal.sessionThreshold} />
              <ValueBadge label="Killzone" value={signal.killzoneStatus} />
              <ValueBadge label="Risk" value={signal.riskStatus} />
            </div>
            <p className="mt-3 break-words text-xs leading-5 text-[#848e9c]">{signal.htfLiquidityContext}</p>
          </div>
          <FactorChecklist passed={signal.passedFactors} failed={signal.failedFactors} />
        </div>
      ) : (
        <div className="p-4">
          <p className="text-sm font-semibold text-amber-200">No production trade passed every hard blocker.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {reasons.length ? reasons.map((reason) => (
              <span key={reason} className="border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-200">
                {reason}
              </span>
            )) : (
              <span className="text-xs text-[#848e9c]">NO_PRODUCTION_CANDIDATE</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function FactorChecklist({
  passed,
  failed,
}: {
  passed: string[];
  failed: string[];
}) {
  const factors = [
    "HTF Bias Alignment",
    "Killzone / Session Timing",
    "Liquidity Sweep Quality",
    "Displacement / MSS Strength",
    "Entry Zone Quality",
    "Risk:Reward and Structural Trade Quality",
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {factors.map((factor) => {
        const didPass = passed.includes(factor);
        return (
          <div key={factor} className={`border px-3 py-2 text-xs ${didPass ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-rose-500/30 bg-rose-500/10 text-rose-200"}`}>
            <span className="font-bold">{didPass ? "PASS" : failed.includes(factor) ? "FAIL" : "WAIT"}</span>
            <span className="mt-1 block break-words text-[#cbd5e1]">{factor}</span>
          </div>
        );
      })}
    </div>
  );
}

const StrategyActivationControls = memo(function StrategyActivationControls({
  enabled,
  appMode,
  strategyId,
  maxRiskAmount,
  showSignals,
  signalCount,
  basketStrategyIds,
  onEnabledChange,
  onAppModeChange,
  onStrategyChange,
  onBasketStrategyToggle,
  onMaxRiskAmountChange,
  onShowSignalsChange,
  masterSelectorEnabled,
  masterSelectorDisplayMode,
  masterSelectorCooldownEnabled,
  showSuppressedMasterSignals,
  showMasterConflictWarnings,
  onMasterSelectorEnabledChange,
  onMasterSelectorDisplayModeChange,
  onMasterSelectorCooldownEnabledChange,
  onShowSuppressedMasterSignalsChange,
  onShowMasterConflictWarningsChange,
  showProductionRawMarkers,
  onShowProductionRawMarkersChange,
  asianStart,
  asianEnd,
  londonStart,
  londonEnd,
  newYorkStart,
  newYorkEnd,
  debugGoldmine,
  onAsianStartChange,
  onAsianEndChange,
  onLondonStartChange,
  onLondonEndChange,
  onNewYorkStartChange,
  onNewYorkEndChange,
  onDebugGoldmineChange,
}: {
  enabled: boolean;
  appMode: TradingAppMode;
  strategyId: StrategyId;
  maxRiskAmount: number;
  showSignals: boolean;
  signalCount: number;
  basketStrategyIds: BasketStrategyId[];
  onEnabledChange: (value: boolean) => void;
  onAppModeChange: (value: TradingAppMode) => void;
  onStrategyChange: (value: StrategyId) => void;
  onBasketStrategyToggle: (strategyId: BasketStrategyId, checked: boolean) => void;
  onMaxRiskAmountChange: (value: number) => void;
  onShowSignalsChange: (value: boolean) => void;
  masterSelectorEnabled: boolean;
  masterSelectorDisplayMode: SignalDisplayMode;
  masterSelectorCooldownEnabled: boolean;
  showSuppressedMasterSignals: boolean;
  showMasterConflictWarnings: boolean;
  onMasterSelectorEnabledChange: (value: boolean) => void;
  onMasterSelectorDisplayModeChange: (value: SignalDisplayMode) => void;
  onMasterSelectorCooldownEnabledChange: (value: boolean) => void;
  onShowSuppressedMasterSignalsChange: (value: boolean) => void;
  onShowMasterConflictWarningsChange: (value: boolean) => void;
  showProductionRawMarkers: boolean;
  onShowProductionRawMarkersChange: (value: boolean) => void;
  asianStart: number;
  asianEnd: number;
  londonStart: number;
  londonEnd: number;
  newYorkStart: number;
  newYorkEnd: number;
  debugGoldmine: boolean;
  onAsianStartChange: (value: number) => void;
  onAsianEndChange: (value: number) => void;
  onLondonStartChange: (value: number) => void;
  onLondonEndChange: (value: number) => void;
  onNewYorkStartChange: (value: number) => void;
  onNewYorkEndChange: (value: number) => void;
  onDebugGoldmineChange: (value: boolean) => void;
}) {
  return (
    <section className="border border-[#2a2e39] bg-[#1c2030] p-4 rounded shadow-lg">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#2a2e39] pb-4">
        <span className="text-xs font-semibold text-[#cbd5e1]">Application mode</span>
        <div className="grid grid-cols-2 border border-[#2a2e39]" role="group" aria-label="Trading application mode">
          {(["RESEARCH", "PRODUCTION"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onAppModeChange(mode)}
              className={`h-9 px-4 text-xs font-semibold transition ${appMode === mode ? "bg-[#E91E63] text-white" : "bg-[#131722] text-[#848e9c] hover:text-white"}`}
            >
              {mode === "RESEARCH" ? "Research" : "Production Institutional"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase text-[#cbd5e1]">
            Strategy Activation
          </h2>
          <p className="mt-1 text-xs text-[#848e9c]">
            {enabled ? `${signalCount} active chart signal${signalCount === 1 ? "" : "s"}` : "Strategies are off"}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex h-10 items-center gap-2 text-sm font-medium text-[#cbd5e1]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => onEnabledChange(event.target.checked)}
            />
            Active
          </label>

          <label className="flex min-w-64 flex-col gap-1 text-sm font-medium text-[#cbd5e1]">
            Strategy
            <select
              value={strategyId}
              disabled={!enabled}
              onChange={(event) => onStrategyChange(event.target.value as StrategyId)}
              className="h-10 border border-[#2a2e39] bg-[#131722] text-white px-3 text-sm outline-none transition focus:border-[#E91E63] disabled:bg-[#1c2030] disabled:text-[#848e9c] rounded"
            >
              {STRATEGIES.map((strategy) => (
                <option key={strategy.id} value={strategy.id}>
                  {strategy.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex w-36 flex-col gap-1 text-sm font-medium text-[#cbd5e1]">
            Risk
            <input
              type="number"
              min="1"
              step="10"
              value={maxRiskAmount}
              disabled={!enabled}
              onChange={(event) => onMaxRiskAmountChange(Math.max(1, Number(event.target.value) || 1))}
              className="h-10 border border-[#2a2e39] bg-[#131722] text-white px-3 text-sm outline-none transition focus:border-[#E91E63] disabled:bg-[#1c2030] disabled:text-[#848e9c] rounded"
            />
          </label>

          <label className="flex h-10 items-center gap-2 text-sm font-medium text-[#cbd5e1]">
            <input
              type="checkbox"
              checked={showSignals}
              disabled={!enabled}
              onChange={(event) => onShowSignalsChange(event.target.checked)}
            />
            Markers
          </label>
        </div>
      </div>

      <div className="mt-3 grid gap-2 border border-[#2a2e39] bg-[#131722] p-3 text-xs text-[#cbd5e1] rounded md:grid-cols-4">
        <ValueBadge
          label="Min RR"
          value={strategyConfigValue(strategyId, "rr")}
        />
        <ValueBadge
          label="Min score"
          value={strategyConfigValue(strategyId, "score")}
        />
        <ValueBadge
          label="Confirm window"
          value={strategyConfigValue(strategyId, "window")}
        />
        <ValueBadge label="Engine status" value={enabled ? "Active" : "Off"} />
      </div>

      {enabled && strategyId === CUSTOM_MULTI_STRATEGY_ID ? (
        <div className="mt-3 border border-[#2a2e39] bg-[#131722] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#cbd5e1]">Custom strategy basket</span>
            <span className="text-xs text-[#848e9c]">{basketStrategyIds.length}/{BASKET_STRATEGIES.length} selected</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {BASKET_STRATEGIES.map((strategy) => {
              const checked = basketStrategyIds.includes(strategy.id);
              const disabled = !enabled || (checked && basketStrategyIds.length <= MIN_BASKET_STRATEGIES);
              return (
                <label key={strategy.id} className={`flex items-center gap-2 border border-[#2a2e39] bg-[#1c2030] px-3 py-2 text-xs font-medium ${disabled ? "text-[#848e9c]" : "text-[#cbd5e1]"}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => onBasketStrategyToggle(strategy.id, event.target.checked)}
                  />
                  <span className="break-words">{strategy.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {enabled && appMode === "RESEARCH" ? (
        <div className="mt-3 border border-[#2a2e39] bg-[#131722] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#cbd5e1]">
              <input
                type="checkbox"
                checked={masterSelectorEnabled}
                onChange={(event) => onMasterSelectorEnabledChange(event.target.checked)}
              />
              Enable Master Selector
            </label>
            <span className="text-xs text-[#848e9c]">
              {masterSelectorEnabled ? "Grouping and conflict resolution active" : "Master Selector is disabled. Displaying raw strategy signals."}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-[#cbd5e1]">Display Mode</span>
            <div className="grid grid-cols-3 border border-[#2a2e39]" role="group" aria-label="Master Selector display mode">
              {(["RAW_SIGNALS", "MASTER_SELECTED", "BOTH"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={!masterSelectorEnabled && mode !== "RAW_SIGNALS"}
                  onClick={() => onMasterSelectorDisplayModeChange(mode)}
                  className={`h-8 px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${masterSelectorDisplayMode === mode ? "bg-[#E91E63] text-white" : "bg-[#1c2030] text-[#848e9c] hover:text-white"}`}
                >
                  {mode === "RAW_SIGNALS" ? "Raw Signals" : mode === "MASTER_SELECTED" ? "Master Selected" : "Both"}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-[#cbd5e1]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={masterSelectorCooldownEnabled}
                disabled={!masterSelectorEnabled}
                onChange={(event) => onMasterSelectorCooldownEnabledChange(event.target.checked)}
              />
              Optional Cooldown
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showSuppressedMasterSignals}
                disabled={!masterSelectorEnabled || masterSelectorDisplayMode !== "BOTH"}
                onChange={(event) => onShowSuppressedMasterSignalsChange(event.target.checked)}
              />
              Show suppressed signals
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showMasterConflictWarnings}
                disabled={!masterSelectorEnabled}
                onChange={(event) => onShowMasterConflictWarningsChange(event.target.checked)}
              />
              Show conflict warnings
            </label>
          </div>
        </div>
      ) : null}

      {enabled && appMode === "PRODUCTION" ? (
        <label className="mt-3 flex items-center gap-2 border border-[#2a2e39] bg-[#131722] px-3 py-3 text-xs font-semibold text-[#cbd5e1]">
          <input
            type="checkbox"
            checked={showProductionRawMarkers}
            onChange={(event) => onShowProductionRawMarkersChange(event.target.checked)}
          />
          Show raw research markers
        </label>
      ) : null}

      {enabled && (
        <div className="mt-4 border-t border-[#2a2e39] pt-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#cbd5e1] mb-3">
            Strategy Trading Sessions (UTC)
          </h3>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 md:grid-cols-7 items-end">
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#848e9c]">
              Asian Start (Hour)
              <input
                type="number"
                min="0"
                max="23"
                value={asianStart}
                onChange={(e) => onAsianStartChange(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                className="h-9 border border-[#2a2e39] bg-[#131722] text-white px-2 text-xs outline-none transition focus:border-[#E91E63] rounded"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#848e9c]">
              Asian End (Hour)
              <input
                type="number"
                min="0"
                max="23"
                value={asianEnd}
                onChange={(e) => onAsianEndChange(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                className="h-9 border border-[#2a2e39] bg-[#131722] text-white px-2 text-xs outline-none transition focus:border-[#E91E63] rounded"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#848e9c]">
              London Start (Hour)
              <input
                type="number"
                min="0"
                max="23"
                value={londonStart}
                onChange={(e) => onLondonStartChange(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                className="h-9 border border-[#2a2e39] bg-[#131722] text-white px-2 text-xs outline-none transition focus:border-[#E91E63] rounded"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#848e9c]">
              London End (Hour)
              <input
                type="number"
                min="0"
                max="23"
                value={londonEnd}
                onChange={(e) => onLondonEndChange(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                className="h-9 border border-[#2a2e39] bg-[#131722] text-white px-2 text-xs outline-none transition focus:border-[#E91E63] rounded"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#848e9c]">
              New York Start
              <input
                type="number"
                min="0"
                max="23"
                value={newYorkStart}
                onChange={(e) => onNewYorkStartChange(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                className="h-9 border border-[#2a2e39] bg-[#131722] text-white px-2 text-xs outline-none transition focus:border-[#E91E63] rounded"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#848e9c]">
              New York End
              <input
                type="number"
                min="0"
                max="23"
                value={newYorkEnd}
                onChange={(e) => onNewYorkEndChange(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                className="h-9 border border-[#2a2e39] bg-[#131722] text-white px-2 text-xs outline-none transition focus:border-[#E91E63] rounded"
              />
            </label>
            <label className="flex h-9 items-center gap-2 text-xs font-semibold text-white cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded text-[#E91E63] focus:ring-[#E91E63] bg-[#131722] border-[#2a2e39]"
                checked={debugGoldmine}
                onChange={(e) => onDebugGoldmineChange(e.target.checked)}
              />
              DEBUG_GOLDMINE
            </label>
          </div>
        </div>
      )}
    </section>
  );
});

function ValueBadge({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="block text-[#848e9c]">{label}</span>
      <strong className="block text-white">{value}</strong>
    </span>
  );
}

const MarkerControls = memo(function MarkerControls({
  settings,
  visibility,
  showTooltips,
  liveMode,
  onSettingsChange,
  onVisibilityChange,
  onShowTooltipsChange,
  onLiveModeChange,
}: {
  settings: MarketStructureSettings;
  visibility: MarkerVisibility;
  showTooltips: boolean;
  liveMode: boolean;
  onSettingsChange: (settings: MarketStructureSettings) => void;
  onVisibilityChange: (visibility: MarkerVisibility) => void;
  onShowTooltipsChange: (value: boolean) => void;
  onLiveModeChange: (value: boolean) => void;
}) {
  const allMarkersChecked = Object.values(visibility).every(Boolean);

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-normal text-[#cbd5e1]">
        Marker Controls
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-[#cbd5e1]">
          Sensitivity
          <select
            value={settings.sensitivity}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                sensitivity: event.target.value as MarkerSensitivity,
              })
            }
            className="h-9 border border-[#2a2e39] bg-[#131722] text-white px-2 rounded"
          >
            {SENSITIVITIES.map((sensitivity) => (
              <option key={sensitivity} value={sensitivity}>
                {sensitivity}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-[#cbd5e1]">
          Swing window
          <input
            type="number"
            min={1}
            max={10}
            value={settings.leftBars}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                leftBars: Number(event.target.value),
                rightBars: Number(event.target.value),
              })
            }
            className="h-9 border border-[#2a2e39] bg-[#131722] text-white px-2 rounded"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[#cbd5e1]">
          ATR period
          <input
            type="number"
            min={2}
            max={100}
            value={settings.atrPeriod}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                atrPeriod: Number(event.target.value),
              })
            }
            className="h-9 border border-[#2a2e39] bg-[#131722] text-white px-2 rounded"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-white">
          <input
            type="checkbox"
            checked={allMarkersChecked}
            onChange={(event) => onVisibilityChange(setAllMarkerVisibility(event.target.checked))}
          />
          All markers
        </label>
        {Object.entries(visibility).map(([key, value]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-[#cbd5e1]">
            <input
              type="checkbox"
              checked={value}
              onChange={(event) =>
                onVisibilityChange({
                  ...visibility,
                  [key]: event.target.checked,
                })
              }
            />
            {formatControlLabel(key)}
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm text-[#cbd5e1]">
          <input
            type="checkbox"
            checked={settings.showOnlyMajor}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                showOnlyMajor: event.target.checked,
              })
            }
          />
          Major only
        </label>
        <label className="flex items-center gap-2 text-sm text-[#cbd5e1]">
          <input
            type="checkbox"
            checked={showTooltips}
            onChange={(event) => onShowTooltipsChange(event.target.checked)}
          />
          Tooltips
        </label>
        <label className="flex items-center gap-2 text-sm text-[#cbd5e1]">
          <input
            type="checkbox"
            checked={liveMode}
            onChange={(event) => onLiveModeChange(event.target.checked)}
          />
          Live refresh
        </label>
      </div>
    </div>
  );
});

const ReplayControls = memo(function ReplayControls({
  replay,
  maxIndex,
  currentTimestamp,
  onReplayChange,
}: {
  replay: ReplayState;
  maxIndex: number;
  currentTimestamp: string | null;
  onReplayChange: (replay: ReplayState | ((current: ReplayState) => ReplayState)) => void;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-normal text-[#cbd5e1]">
        Replay
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            onReplayChange((current) => ({
              ...current,
              enabled: true,
              playing: true,
            }))
          }
          className="h-9 bg-[#E91E63] text-white px-3 text-sm font-bold rounded"
        >
          Play
        </button>
        <button
          type="button"
          onClick={() =>
            onReplayChange((current) => ({ ...current, playing: false }))
          }
          className="h-9 border border-[#2a2e39] bg-[#131722] text-[#cbd5e1] hover:bg-[#2a2e39] px-3 text-sm font-medium rounded"
        >
          Pause
        </button>
        <button
          type="button"
          onClick={() =>
            onReplayChange((current) => ({
              ...current,
              enabled: true,
              playing: false,
              index: Math.max(0, current.index - 1),
            }))
          }
          className="h-9 border border-[#2a2e39] bg-[#131722] text-[#cbd5e1] hover:bg-[#2a2e39] px-3 text-sm font-medium rounded"
        >
          Step back
        </button>
        <button
          type="button"
          onClick={() =>
            onReplayChange((current) => ({
              ...current,
              enabled: true,
              playing: false,
              index: Math.min(maxIndex, current.index + 1),
            }))
          }
          className="h-9 border border-[#2a2e39] bg-[#131722] text-[#cbd5e1] hover:bg-[#2a2e39] px-3 text-sm font-medium rounded"
        >
          Step forward
        </button>
        <button
          type="button"
          onClick={() =>
            onReplayChange((current) => ({
              ...current,
              enabled: true,
              playing: false,
              index: 0,
            }))
          }
          className="h-9 border border-[#2a2e39] bg-[#131722] text-[#cbd5e1] hover:bg-[#2a2e39] px-3 text-sm font-medium rounded"
        >
          Reset
        </button>
        <label className="flex items-center gap-2 text-sm text-[#cbd5e1]">
          Speed
          <select
            value={replay.speed}
            onChange={(event) =>
              onReplayChange((current) => ({
                ...current,
                speed: Number(event.target.value) as ReplayState["speed"],
              }))
            }
            className="h-9 border border-[#2a2e39] bg-[#131722] text-white px-2 rounded"
          >
            {REPLAY_SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {speed}x
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-[#cbd5e1]">
          <input
            type="checkbox"
            checked={replay.enabled}
            onChange={(event) =>
              onReplayChange((current) => ({
                ...current,
                enabled: event.target.checked,
                playing: event.target.checked ? current.playing : false,
              }))
            }
          />
          Replay mode
        </label>
      </div>
      <p className="mt-3 text-sm text-[#cbd5e1]">
        Candle {replay.enabled ? replay.index : maxIndex} / {maxIndex}
        {currentTimestamp ? ` | ${currentTimestamp}` : ""}
      </p>
    </div>
  );
});

function isMarkerVisible(
  marker: MarketMarker,
  visibility: MarkerVisibility,
): boolean {
  if (marker.type === "SWING_HIGH" || marker.type === "SWING_LOW") {
    return visibility.swings;
  }

  if (marker.type === "SSL_SWEEP" || marker.type === "BSL_SWEEP") {
    return visibility.sweeps;
  }

  if (marker.type === "MOMENTUM" || marker.type === "DISPLACEMENT") {
    return visibility.momentum;
  }

  if (marker.type === "BUYERS" || marker.type === "SELLERS") {
    return visibility.pressure;
  }

  if (marker.type === "BOS" || marker.type === "CHOCH" || marker.type === "MSS") {
    return visibility.structure;
  }

  if (marker.type === "FVG") {
    return visibility.fvg;
  }

  return true;
}

function setAllMarkerVisibility(value: boolean): MarkerVisibility {
  return {
    swings: value,
    liquidity: value,
    sweeps: value,
    momentum: value,
    pressure: value,
    structure: value,
    fvg: value,
  };
}

function setAllContextOverlays(value: boolean): ContextOverlayVisibility {
  return {
    dealingRange: value,
    premiumDiscount: value,
    nearestLevels: value,
    sessionLevels: value,
    contextLabels: value,
  };
}

function formatControlLabel(value: string): string {
  const explicit: Record<string, string> = {
    pressure: "BUYERS/SELLERS",
    structure: "BOS/CHOCH/MSS",
    fvg: "FVG",
    dealingRange: "Dealing range",
    premiumDiscount: "Premium / discount",
    nearestLevels: "Nearest levels",
    sessionLevels: "Session levels",
    contextLabels: "Context labels",
  };

  if (explicit[value]) {
    return explicit[value];
  }

  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatNullableNumber(value: number | null): string {
  if (value === null) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatChange(value: number | null): string {
  if (value === null) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}%`;
}

function formatShortDateTime(value: string): string {
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

function goldBiasStatus(value: IntermarketSnapshot["fred"]["dailyBias"]): string {
  if (value === "BULLISH_GOLD") return "Supports BUY setups";
  if (value === "BEARISH_GOLD") return "Supports SELL setups";
  return "Neutral macro backdrop";
}

function getPollingIntervalMs(timeframe: Timeframe): number {
  if (timeframe === "1m") return 15_000;
  if (timeframe === "5m") return 30_000;
  if (timeframe === "15m") return 60_000;
  if (timeframe === "30m") return 90_000;
  return Math.max(120_000, getTimeframeMs(timeframe));
}

function areCandleRequestsEqual(left: CandleFetchRequest, right: CandleFetchRequest): boolean {
  return (
    left.symbol === right.symbol &&
    left.timeframe === right.timeframe &&
    left.startDate === right.startDate &&
    left.endDate === right.endDate
  );
}

function areSameCandleSequence(left: Candle[], right: Candle[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const leftLast = left.at(-1);
  const rightLast = right.at(-1);

  return (
    (left[0]?.timestamp ?? 0) === (right[0]?.timestamp ?? 0) &&
    (leftLast?.timestamp ?? 0) === (rightLast?.timestamp ?? 0) &&
    (leftLast?.open ?? 0) === (rightLast?.open ?? 0) &&
    (leftLast?.high ?? 0) === (rightLast?.high ?? 0) &&
    (leftLast?.low ?? 0) === (rightLast?.low ?? 0) &&
    (leftLast?.close ?? 0) === (rightLast?.close ?? 0) &&
    (leftLast?.volume ?? 0) === (rightLast?.volume ?? 0)
  );
}

function arePerformanceSnapshotsEqual(left: PerformanceSnapshot, right: PerformanceSnapshot): boolean {
  return (
    left.candlesCount === right.candlesCount &&
    left.visibleCandlesCount === right.visibleCandlesCount &&
    left.lastFetchDurationMs === right.lastFetchDurationMs &&
    left.lastScanDurationMs === right.lastScanDurationMs &&
    left.lastRenderDurationMs === right.lastRenderDurationMs &&
    left.indicatorCalculationMs === right.indicatorCalculationMs &&
    left.strategyScanMs === right.strategyScanMs &&
    left.memoryCacheSize === right.memoryCacheSize &&
    left.signalsCount === right.signalsCount &&
    left.pendingSetupsCount === right.pendingSetupsCount &&
    left.rejectedSetupsCount === right.rejectedSetupsCount &&
    left.duplicateCandlesDetected === right.duplicateCandlesDetected &&
    left.duplicateSignalsPrevented === right.duplicateSignalsPrevented &&
    left.visibleMarkersCount === right.visibleMarkersCount
  );
}

function getInitialTimezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return DISPLAY_TIMEZONES.includes(timezone) ? timezone : "UTC";
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function subscribeToHydration(): () => void {
  return () => undefined;
}
