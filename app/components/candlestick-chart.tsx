"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createSeriesMarkers,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CandleReadingResult } from "@/lib/candle-reading/types";
import type { Candle } from "@/lib/candles/types";
import { findNearestCandleIndexByTime } from "@/lib/chart-utils/visible-range";
import type { TradeSignal } from "@/lib/entry-engine/types";
import type { IntermarketSnapshot } from "@/lib/market-data/types";
import type { InstitutionalMasterSignal, MasterFinalSignal } from "@/lib/v2-signal-engine";
import type { ContextOverlayVisibility, MarketContextResult } from "@/lib/market-context/types";
import type {
  LiquidityZone,
  MarketMarker,
  MarkerVisibility,
} from "@/lib/market-structure/types";
import type { MarketSetup } from "@/lib/setup-scanner/types";

type TooltipCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  signal?: {
    engine: string;
    strategy: string;
    sweep: string;
    asianHigh: number | null;
    asianLow: number | null;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    rr: number;
    score: number;
  };
};

type CandlestickChartProps = {
  candles: Candle[];
  markers: MarketMarker[];
  liquidityZones: LiquidityZone[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  visibleRange: string;
  showTooltips: boolean;
  candleReading: CandleReadingResult | null;
  marketContext: MarketContextResult;
  contextOverlays: ContextOverlayVisibility;
  setups: MarketSetup[];
  showSetupOverlays: boolean;
  signals: TradeSignal[];
  showSignalOverlays: boolean;
  selectedSignalId: string | null;
  isFullscreen: boolean;
  activeTimeframe: string;
  symbol: string;
  onMarkerHover: (marker: MarketMarker | null) => void;
  onSignalHover: (signal: TradeSignal | null) => void;
  onFullscreenChange: (value: boolean) => void;
  onVisibleRangeChange: (value: string) => void;
  onTimeframeChange?: (tf: string) => void;
  markerVisibility: MarkerVisibility;
  onMarkerVisibilityChange?: (vis: MarkerVisibility) => void;
  v2AsianRanges?: import("@/lib/entry-engine/types").V2AsianRangeSnapshot[];
  intermarketSnapshot?: IntermarketSnapshot | null;
  showIntermarketOverlay?: boolean;
};

const EMPTY_CHART_DATA_SIGNATURE = "0:0:0";
const isEmptySignature = (sig: string) => sig === EMPTY_CHART_DATA_SIGNATURE || sig.startsWith("0:");
type DebugWindow = Window & { DEBUG_GOLDMINE?: boolean };

function CandlestickChartComponent({
  candles,
  markers,
  liquidityZones,
  loading,
  error,
  hasFetched,
  visibleRange,
  showTooltips,
  candleReading,
  marketContext,
  contextOverlays,
  setups,
  showSetupOverlays,
  signals,
  showSignalOverlays,
  selectedSignalId,
  isFullscreen,
  activeTimeframe,
  symbol,
  markerVisibility,
  onMarkerHover,
  onSignalHover,
  onFullscreenChange,
  onVisibleRangeChange,
  onTimeframeChange,
  onMarkerVisibilityChange,
  v2AsianRanges = [],
  intermarketSnapshot = null,
  showIntermarketOverlay = false,
}: CandlestickChartProps) {
  const chartBodyRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const currentPriceLineRef = useRef<IPriceLine | null>(null);
  const markerMapRef = useRef<Map<string, MarketMarker>>(new Map());
  const signalMapRef = useRef<Map<string, TradeSignal>>(new Map());
  const signalsRef = useRef(signals);
  const selectedSignalIdRef = useRef(selectedSignalId);
  const showSignalOverlaysRef = useRef(showSignalOverlays);
  const showTooltipsRef = useRef(showTooltips);
  const onMarkerHoverRef = useRef(onMarkerHover);
  const onSignalHoverRef = useRef(onSignalHover);
  const onVisibleRangeChangeRef = useRef(onVisibleRangeChange);
  const candleReadingRef = useRef(candleReading);
  const marketContextRef = useRef(marketContext);
  const contextOverlaysRef = useRef(contextOverlays);
  const setupsRef = useRef(setups);
  const showSetupOverlaysRef = useRef(showSetupOverlays);
  const [analysisZone, setAnalysisZone] = useState<{
    left: number;
    width: number;
  } | null>(null);
  const [isAtLatest, setIsAtLatest] = useState(true);
  const [chartType, setChartType] = useState<"candles" | "heikin-ashi">("candles");
  const [isAutoScale, setIsAutoScale] = useState(true);
  const [contextBands, setContextBands] = useState<{ premiumTop: number; premiumHeight: number; discountTop: number; discountHeight: number } | null>(null);
  const [setupBands, setSetupBands] = useState<Array<{ setup: MarketSetup; top: number; height: number }>>([]);
  const [orderBlockBands, setOrderBlockBands] = useState<Array<{ signal: TradeSignal; left: number; width: number; top: number; height: number }>>([]);
  const [silverBulletBands, setSilverBulletBands] = useState<Array<{ signal: TradeSignal; left: number; width: number; fvgLeft: number; fvgWidth: number; fvgTop: number; fvgHeight: number; selected: boolean }>>([]);
  const [fvgContinuationBands, setFvgContinuationBands] = useState<Array<{ signal: TradeSignal; left: number; width: number; top: number; height: number; selected: boolean }>>([]);
  const [proLiquidityBands, setProLiquidityBands] = useState<Array<{ signal: TradeSignal; left: number; width: number; top: number; height: number; selected: boolean }>>([]);
  const [stockGuruBands, setStockGuruBands] = useState<Array<{ signal: TradeSignal; left: number; width: number; top: number; height: number; selected: boolean }>>([]);
  const [tjrBands, setTjrBands] = useState<Array<{ signal: TradeSignal; left: number; width: number; top: number; height: number; selected: boolean }>>([]);
  const [ictOteBands, setIctOteBands] = useState<Array<{ signal: TradeSignal; left: number; width: number; top: number; height: number; selected: boolean }>>([]);
  const [ictIfvgBands, setIctIfvgBands] = useState<Array<{ signal: TradeSignal; left: number; width: number; top: number; height: number; selected: boolean }>>([]);

  const [renderedDataSignature, setRenderedDataSignature] = useState(
    EMPTY_CHART_DATA_SIGNATURE,
  );

  const updateAnalysisZone = useCallback(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    const reading = candleReadingRef.current;
    if (!chart || !container || !reading) {
      setAnalysisZone(null);
      return;
    }

    const start = chart
      .timeScale()
      .timeToCoordinate(
        Math.floor(reading.windowStartTimestamp / 1000) as UTCTimestamp,
      );
    const end = chart
      .timeScale()
      .timeToCoordinate(
        Math.floor(reading.windowEndTimestamp / 1000) as UTCTimestamp,
      );
    if (start === null || end === null) {
      setAnalysisZone(null);
      return;
    }

    const left = Math.max(0, Math.min(start - 5, container.clientWidth));
    const right = Math.max(left, Math.min(end + 6, container.clientWidth));
    setAnalysisZone({ left, width: Math.max(2, right - left) });
  }, []);

  const updateContextBands = useCallback(() => {
    const series = seriesRef.current;
    const context = marketContextRef.current;
    if (!series || !contextOverlaysRef.current.premiumDiscount || !context.premiumDiscount) {
      setContextBands(null);
      return;
    }
    const high = series.priceToCoordinate(context.premiumDiscount.rangeHigh);
    const equilibrium = series.priceToCoordinate(context.premiumDiscount.equilibrium);
    const low = series.priceToCoordinate(context.premiumDiscount.rangeLow);
    if (high === null || equilibrium === null || low === null) {
      setContextBands(null);
      return;
    }
    setContextBands({
      premiumTop: high,
      premiumHeight: Math.max(0, equilibrium - high),
      discountTop: equilibrium,
      discountHeight: Math.max(0, low - equilibrium),
    });
  }, []);

  const updateSetupBands = useCallback(() => {
    const series = seriesRef.current;
    if (!series || !showSetupOverlaysRef.current) {
      setSetupBands([]);
      return;
    }
    const bands = setupsRef.current.slice(0, 4).flatMap((setup) => {
      const topCoordinate = series.priceToCoordinate(setup.setupZone.maxPrice);
      const bottomCoordinate = series.priceToCoordinate(setup.setupZone.minPrice);
      if (topCoordinate === null || bottomCoordinate === null) return [];
      return [{ setup, top: Math.min(topCoordinate, bottomCoordinate), height: Math.max(3, Math.abs(bottomCoordinate - topCoordinate)) }];
    });
    setSetupBands(bands);
  }, []);

  const updateSignalBands = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || !showSignalOverlaysRef.current) {
      setOrderBlockBands([]);
      setSilverBulletBands([]);
      setFvgContinuationBands([]);
      setProLiquidityBands([]);
      setStockGuruBands([]);
      setIctOteBands([]);
      setIctIfvgBands([]);
      return;
    }
    const selectedSignal = selectedSignalIdRef.current
      ? signalsRef.current.find((signal) => signal.id === selectedSignalIdRef.current) ?? null
      : null;
    const bandSignals = uniqueSignals([selectedSignal, ...signalsRef.current.slice(-3)].filter((signal): signal is TradeSignal => Boolean(signal)));
    const orderBlockBands = bandSignals.flatMap((signal) => {
      const snapshot = signal.orderBlockRetest;
      if (!snapshot) return [];
      const left = chart.timeScale().timeToCoordinate(Math.floor(snapshot.orderBlock.createdAt / 1000) as UTCTimestamp);
      const right = chart.timeScale().timeToCoordinate(Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp);
      const topCoordinate = series.priceToCoordinate(snapshot.orderBlock.top);
      const bottomCoordinate = series.priceToCoordinate(snapshot.orderBlock.bottom);
      if (left === null || right === null || topCoordinate === null || bottomCoordinate === null) return [];
      const minX = Math.min(left, right);
      return [{
        signal,
        left: Math.max(0, minX),
        width: Math.max(12, Math.abs(right - left)),
        top: Math.min(topCoordinate, bottomCoordinate),
        height: Math.max(4, Math.abs(bottomCoordinate - topCoordinate)),
      }];
    });
    const silverBulletBands = bandSignals.flatMap((signal) => {
      const snapshot = signal.silverBullet;
      if (!snapshot) return [];
      const left = chart.timeScale().timeToCoordinate(Math.floor(snapshot.sweep.timestamp / 1000) as UTCTimestamp);
      const right = chart.timeScale().timeToCoordinate(Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp);
      const fvgLeft = chart.timeScale().timeToCoordinate(Math.floor(snapshot.fvg.timestamp / 1000) as UTCTimestamp);
      const fvgRight = chart.timeScale().timeToCoordinate(Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp);
      const topCoordinate = series.priceToCoordinate(snapshot.fvg.top);
      const bottomCoordinate = series.priceToCoordinate(snapshot.fvg.bottom);
      if (left === null || right === null || fvgLeft === null || fvgRight === null || topCoordinate === null || bottomCoordinate === null) return [];
      return [{
        signal,
        left: Math.max(0, Math.min(left, right)),
        width: Math.max(12, Math.abs(right - left)),
        fvgLeft: Math.max(0, Math.min(fvgLeft, fvgRight)),
        fvgWidth: Math.max(12, Math.abs(fvgRight - fvgLeft)),
        fvgTop: Math.min(topCoordinate, bottomCoordinate),
        fvgHeight: Math.max(4, Math.abs(bottomCoordinate - topCoordinate)),
        selected: signal.id === selectedSignalIdRef.current,
      }];
    });
    const fvgContinuationBands = bandSignals.flatMap((signal) => {
      const snapshot = signal.fvgContinuation;
      if (!snapshot) return [];
      const left = chart.timeScale().timeToCoordinate(Math.floor(snapshot.fvg.createdAt / 1000) as UTCTimestamp);
      const right = chart.timeScale().timeToCoordinate(Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp);
      const topCoordinate = series.priceToCoordinate(snapshot.fvg.top);
      const bottomCoordinate = series.priceToCoordinate(snapshot.fvg.bottom);
      if (left === null || right === null || topCoordinate === null || bottomCoordinate === null) return [];
      return [{
        signal,
        left: Math.max(0, Math.min(left, right)),
        width: Math.max(12, Math.abs(right - left)),
        top: Math.min(topCoordinate, bottomCoordinate),
        height: Math.max(4, Math.abs(bottomCoordinate - topCoordinate)),
        selected: signal.id === selectedSignalIdRef.current,
      }];
    });
    const proLiquidityBands = bandSignals.flatMap((signal) => {
      const snapshot = signal.proLiquidityConfluence;
      if (!snapshot) return [];
      const left = chart.timeScale().timeToCoordinate(Math.floor(snapshot.entryZone.createdAt / 1000) as UTCTimestamp);
      const right = chart.timeScale().timeToCoordinate(Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp);
      const topCoordinate = series.priceToCoordinate(snapshot.entryZone.top);
      const bottomCoordinate = series.priceToCoordinate(snapshot.entryZone.bottom);
      if (left === null || right === null || topCoordinate === null || bottomCoordinate === null) return [];
      return [{
        signal,
        left: Math.max(0, Math.min(left, right)),
        width: Math.max(12, Math.abs(right - left)),
        top: Math.min(topCoordinate, bottomCoordinate),
        height: Math.max(4, Math.abs(bottomCoordinate - topCoordinate)),
        selected: signal.id === selectedSignalIdRef.current,
      }];
    });
    const stockGuruBands = bandSignals.flatMap((signal) => {
      const snapshot = signal.stockGuruSweepFvgOb;
      if (!snapshot || snapshot.selectedZone.createdAt === null || snapshot.confirmation.candleTime === null || snapshot.selectedZone.low === null || snapshot.selectedZone.high === null) return [];
      const left = chart.timeScale().timeToCoordinate(Math.floor(snapshot.selectedZone.createdAt / 1000) as UTCTimestamp);
      const right = chart.timeScale().timeToCoordinate(Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp);
      const topCoordinate = series.priceToCoordinate(snapshot.selectedZone.high);
      const bottomCoordinate = series.priceToCoordinate(snapshot.selectedZone.low);
      if (left === null || right === null || topCoordinate === null || bottomCoordinate === null) return [];
      return [{
        signal,
        left: Math.max(0, Math.min(left, right)),
        width: Math.max(12, Math.abs(right - left)),
        top: Math.min(topCoordinate, bottomCoordinate),
        height: Math.max(4, Math.abs(bottomCoordinate - topCoordinate)),
        selected: signal.id === selectedSignalIdRef.current,
      }];
    });
    const tjrBands = bandSignals.flatMap((signal) => {
      const snapshot = signal.tjrSimpleStructurePullback;
      if (!snapshot || snapshot.zoneCreatedAt === null || snapshot.confirmationAt === null || snapshot.selectedZoneLow === null || snapshot.selectedZoneHigh === null) return [];
      const left = chart.timeScale().timeToCoordinate(Math.floor(snapshot.zoneCreatedAt / 1000) as UTCTimestamp);
      const right = chart.timeScale().timeToCoordinate(Math.floor(snapshot.confirmationAt / 1000) as UTCTimestamp);
      const topCoordinate = series.priceToCoordinate(snapshot.selectedZoneHigh);
      const bottomCoordinate = series.priceToCoordinate(snapshot.selectedZoneLow);
      if (left === null || right === null || topCoordinate === null || bottomCoordinate === null) return [];
      return [{
        signal,
        left: Math.max(0, Math.min(left, right)),
        width: Math.max(12, Math.abs(right - left)),
        top: Math.min(topCoordinate, bottomCoordinate),
        height: Math.max(4, Math.abs(bottomCoordinate - topCoordinate)),
        selected: signal.id === selectedSignalIdRef.current,
      }];
    });
    const ictOteBands = bandSignals.flatMap((signal) => {
      const snapshot = signal.ictOteContinuation;
      if (!snapshot) return [];
      const left = chart.timeScale().timeToCoordinate(Math.floor(snapshot.impulse.endTime / 1000) as UTCTimestamp);
      const right = chart.timeScale().timeToCoordinate(Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp);
      const topCoordinate = series.priceToCoordinate(snapshot.ote.high);
      const bottomCoordinate = series.priceToCoordinate(snapshot.ote.low);
      if (left === null || right === null || topCoordinate === null || bottomCoordinate === null) return [];
      return [{ signal, left: Math.max(0, Math.min(left, right)), width: Math.max(12, Math.abs(right - left)), top: Math.min(topCoordinate, bottomCoordinate), height: Math.max(4, Math.abs(bottomCoordinate - topCoordinate)), selected: signal.id === selectedSignalIdRef.current }];
    });
    const ictIfvgBands = bandSignals.flatMap((signal) => {
      const snapshot = signal.ictIfvgReversal;
      if (!snapshot) return [];
      const left = chart.timeScale().timeToCoordinate(Math.floor(snapshot.ifvgZone.createdAt / 1000) as UTCTimestamp);
      const right = chart.timeScale().timeToCoordinate(Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp);
      const topCoordinate = series.priceToCoordinate(snapshot.ifvgZone.top);
      const bottomCoordinate = series.priceToCoordinate(snapshot.ifvgZone.bottom);
      if (left === null || right === null || topCoordinate === null || bottomCoordinate === null) return [];
      return [{ signal, left: Math.max(0, Math.min(left, right)), width: Math.max(12, Math.abs(right - left)), top: Math.min(topCoordinate, bottomCoordinate), height: Math.max(4, Math.abs(bottomCoordinate - topCoordinate)), selected: signal.id === selectedSignalIdRef.current }];
    });
    setOrderBlockBands(orderBlockBands);
    setSilverBulletBands(silverBulletBands);
    setFvgContinuationBands(fvgContinuationBands);
    setProLiquidityBands(proLiquidityBands);
    setStockGuruBands(stockGuruBands);
    setTjrBands(tjrBands);
    setIctOteBands(ictOteBands);
    setIctIfvgBands(ictIfvgBands);
  }, []);


  const chartData = useMemo<CandlestickData<Time>[]>(
    () =>
      candles.map((candle) => ({
        time: Math.floor(candle.timestamp / 1000) as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    [candles],
  );
  const formattedChartData = useMemo(() => {
    if (chartType === "heikin-ashi") {
      return computeHeikinAshi(chartData);
    }
    return chartData;
  }, [chartType, chartData]);

  const chartDataSignature = useMemo(() => {
    const first = candles[0]?.timestamp ?? 0;
    const last = candles.at(-1)?.timestamp ?? 0;
    return `${candles.length}:${first}:${last}:${chartType}`;
  }, [candles, chartType]);
  const chartDataPending =
    hasFetched && candles.length > 0 && renderedDataSignature !== chartDataSignature;
  const hasRenderedCandles =
    !isEmptySignature(renderedDataSignature);
  const markerMap = useMemo(
    () => new Map(markers.map((marker) => [marker.id, marker])),
    [markers],
  );
  const seriesMarkers = useMemo<SeriesMarker<Time>[]>(
    () => filterOverlappingMarkers([
      ...markers.map(toSeriesMarker),
      ...(showSignalOverlays ? signals.flatMap((signal) => toStrategyJourneyMarkers(signal, signal.id === selectedSignalId)) : []),
      ...(showSignalOverlays ? signals.map((signal) => toSignalSeriesMarker(signal, signal.id === selectedSignalId)) : []),
    ]),
    [markers, selectedSignalId, showSignalOverlays, signals],
  );

  useEffect(() => {
    markerMapRef.current = markerMap;
  }, [markerMap]);

  useEffect(() => {
    signalMapRef.current = new Map(
      signals.flatMap((signal) => [
        [signal.id, signal] as const,
        [`${signal.id}:breakout`, signal] as const,
        [`${signal.id}:retest`, signal] as const,
        [`${signal.id}:sweep`, signal] as const,
        [`${signal.id}:sb-reclaim`, signal] as const,
        [`${signal.id}:sb-displacement`, signal] as const,
        [`${signal.id}:sb-mss`, signal] as const,
        [`${signal.id}:fvg`, signal] as const,
        [`${signal.id}:sb-fvg-retest`, signal] as const,
        [`${signal.id}:sb-confirmation`, signal] as const,
        [`${signal.id}:fvg-displacement`, signal] as const,
        [`${signal.id}:fvg-structure`, signal] as const,
        [`${signal.id}:fvg-continuation-box`, signal] as const,
        [`${signal.id}:fvg-continuation-retest`, signal] as const,
        [`${signal.id}:fvg-continuation-confirmation`, signal] as const,
        [`${signal.id}:pro-sweep`, signal] as const,
        [`${signal.id}:pro-pressure`, signal] as const,
        [`${signal.id}:pro-mss`, signal] as const,
        [`${signal.id}:pro-zone`, signal] as const,
        [`${signal.id}:pro-retest`, signal] as const,
        [`${signal.id}:pro-confirmation`, signal] as const,
        [`${signal.id}:ote-impulse`, signal] as const,
        [`${signal.id}:ote-structure`, signal] as const,
        [`${signal.id}:ote-sweep`, signal] as const,
        [`${signal.id}:ote-zone`, signal] as const,
        [`${signal.id}:ote-touch`, signal] as const,
        [`${signal.id}:ote-confluence`, signal] as const,
        [`${signal.id}:ote-pressure`, signal] as const,
        [`${signal.id}:ote-confirmation`, signal] as const,
        [`${signal.id}:pullback`, signal] as const,
        [`${signal.id}:ema-pullback`, signal] as const,
        [`${signal.id}:ema-confirmation`, signal] as const,
        [`${signal.id}:liquidity`, signal] as const,
        [`${signal.id}:reclaim`, signal] as const,
        [`${signal.id}:liquidity-confirmation`, signal] as const,
        [`${signal.id}:ob-displacement`, signal] as const,
        [`${signal.id}:ob-retest`, signal] as const,
        [`${signal.id}:ob-confirmation`, signal] as const,
        [`${signal.id}:follow-through-target`, signal] as const,
        [`${signal.id}:follow-through-obstacle`, signal] as const,
        [`${signal.id}:follow-through-invalidation`, signal] as const,
      ]),
    );
    signalsRef.current = signals;
    selectedSignalIdRef.current = selectedSignalId;
    showSignalOverlaysRef.current = showSignalOverlays;
    const frame = window.requestAnimationFrame(updateSignalBands);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedSignalId, showSignalOverlays, signals, updateSignalBands]);

  useEffect(() => {
    showTooltipsRef.current = showTooltips;
  }, [showTooltips]);

  useEffect(() => {
    onMarkerHoverRef.current = onMarkerHover;
  }, [onMarkerHover]);

  useEffect(() => {
    onSignalHoverRef.current = onSignalHover;
  }, [onSignalHover]);

  useEffect(() => {
    onVisibleRangeChangeRef.current = onVisibleRangeChange;
  }, [onVisibleRangeChange]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setRenderedDataSignature(EMPTY_CHART_DATA_SIGNATURE));
    return () => window.cancelAnimationFrame(frame);
  }, [symbol, activeTimeframe]);

  useEffect(() => {
    candleReadingRef.current = candleReading;
    const frame = window.requestAnimationFrame(updateAnalysisZone);
    return () => window.cancelAnimationFrame(frame);
  }, [candleReading, updateAnalysisZone]);

  useEffect(() => {
    marketContextRef.current = marketContext;
    contextOverlaysRef.current = contextOverlays;
    const frame = window.requestAnimationFrame(updateContextBands);
    return () => window.cancelAnimationFrame(frame);
  }, [contextOverlays, marketContext, updateContextBands]);

  useEffect(() => {
    setupsRef.current = setups;
    showSetupOverlaysRef.current = showSetupOverlays;
    const frame = window.requestAnimationFrame(updateSetupBands);
    return () => window.cancelAnimationFrame(frame);
  }, [setups, showSetupOverlays, updateSetupBands]);

  useEffect(() => {
    if (!containerRef.current || !chartBodyRef.current) {
      return;
    }

    const container = containerRef.current;
    const chartBody = chartBodyRef.current;
    const initialSize = getChartBodySize(chartBody);
    const chart = createChart(container, {
      width: initialSize.width,
      height: initialSize.height,
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#d1d4dc",
      },
      grid: {
        horzLines: { color: "rgba(42, 46, 57, 0.6)" },
        vertLines: { color: "rgba(42, 46, 57, 0.6)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        horzLine: {
          color: "#758696",
          labelBackgroundColor: "#2a2e39",
        },
        vertLine: {
          color: "#758696",
          labelBackgroundColor: "#2a2e39",
        },
      },
      rightPriceScale: {
        borderColor: "#2a2e39",
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: "#2a2e39",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    seriesRef.current = candlestickSeries;
    markerPluginRef.current = createSeriesMarkers(candlestickSeries, [], {
      autoScale: true,
    });

    let resizeTimer = 0;
    const resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const size = getChartBodySize(chartBody);
        chart.resize(size.width, size.height);
        updateAnalysisZone();
        updateContextBands();
        updateSetupBands();
        updateSignalBands();
      }, 100);
    });

    resizeObserver.observe(chartBody);
    const resizeFrame = window.requestAnimationFrame(() => {
      const size = getChartBodySize(chartBody);
      chart.resize(size.width, size.height);
      chart.timeScale().fitContent();
      updateAnalysisZone();
      updateContextBands();
      updateSetupBands();
      updateSignalBands();
    });

    chart.subscribeCrosshairMove((param) => {
      const hoveredId =
        typeof param.hoveredObjectId === "string" ? param.hoveredObjectId : null;
      const hoveredSignal = hoveredId ? signalMapRef.current.get(hoveredId) ?? null : null;
      onMarkerHoverRef.current(hoveredId ? markerMapRef.current.get(hoveredId) ?? null : null);
      onSignalHoverRef.current(hoveredSignal);

      const tooltip = tooltipRef.current;
      if (!tooltip) return;

      const data = candlestickSeries
        ? param.seriesData.get(candlestickSeries)
        : undefined;

      if (
        !showTooltipsRef.current ||
        !isTooltipCandle(data) ||
        typeof param.time === "undefined" ||
        !param.point
      ) {
        tooltip.classList.remove("chart-tooltip--visible");
        return;
      }

      const time = formatChartTime(param.time);
      const change = data.close - data.open;
      const changePct = ((change / data.open) * 100).toFixed(3);
      const changeSign = change >= 0 ? "+" : "";
      const changeColor = change >= 0 ? "chart-tooltip-bullish" : "chart-tooltip-bearish";

      let signalHtml = "";
      if (hoveredSignal) {
        const asianRangeHtml = buildAsianRangeTooltipHtml(hoveredSignal);
        if (isInstitutionalSignal(hoveredSignal)) {
          signalHtml = `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#fbbf24;margin-bottom:4px">${hoveredSignal.action}</div><div>Selected: ${hoveredSignal.selectedStrategy}</div><div>Factors: ${hoveredSignal.factorScore}/6 | ${hoveredSignal.sessionThreshold}</div><div>Entry / Structural SL / HTF TP: ${hoveredSignal.entryPrice.toFixed(2)} / ${hoveredSignal.structuralStopLoss.toFixed(2)} / ${hoveredSignal.structuralTakeProfit.toFixed(2)}</div><div>RR: ${hoveredSignal.rr.toFixed(2)}R</div><div>Stop / target: ${hoveredSignal.stopSource} / ${hoveredSignal.targetSource}</div><div>Killzone: ${hoveredSignal.killzoneStatus}</div><div>HTF: ${hoveredSignal.htfLiquidityContext}</div><div style="margin-top:4px;color:rgba(255,255,255,.7)">Passed: ${hoveredSignal.passedFactors.join(", ")}</div>${hoveredSignal.failedFactors.length ? `<div style="color:#fda4af">Failed: ${hoveredSignal.failedFactors.join(", ")}</div>` : ""}${hoveredSignal.productionWarnings.length ? `<div style="color:#fcd34d">Warnings: ${hoveredSignal.productionWarnings.join(", ")}</div>` : ""}</div>`;
        } else if (isMasterSignal(hoveredSignal)) {
          signalHtml = `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#fbbf24;margin-bottom:4px">MASTER ${hoveredSignal.action}</div><div>Selected: ${hoveredSignal.selectedStrategy}</div><div>Confluence: ${hoveredSignal.confluenceCount} strategies</div><div>Master score: ${hoveredSignal.masterScore.toFixed(1)} | ${hoveredSignal.masterConfidence}</div><div>Entry / SL / TP: ${hoveredSignal.entryPrice.toFixed(2)} / ${hoveredSignal.stopLoss.toFixed(2)} / ${hoveredSignal.takeProfit.toFixed(2)}</div><div>RR: ${hoveredSignal.rr.toFixed(2)}R</div><div style="margin-top:4px;color:rgba(255,255,255,.7)">${hoveredSignal.selectionReason}</div></div>`;
        } else if (hoveredSignal.masterDisplayStatus === "SUPPRESSED") {
          signalHtml = `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#94a3b8;margin-bottom:4px">Suppressed duplicate</div><div>Included as confluence for the master signal.</div><div>Reason: ${hoveredSignal.masterDisplayReason ?? "DUPLICATE_SAME_IDEA"}</div></div>`;
        } else if (hoveredSignal.strategyId === "ASIAN_RANGE_BREAKOUT_RETEST") {
          const retestTime = hoveredSignal.retest
            ? new Date(hoveredSignal.retest.timestamp).toISOString().slice(11, 16) + " UTC"
            : "N/A";
          signalHtml = `
            <div class="chart-tooltip-signal" style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 6px; padding-top: 6px; font-size: 11px;">
              <div style="font-weight: bold; color: #ff6b35; margin-bottom: 4px;">Asian Range Breakout Retest</div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>Breakout Lvl:</span><span>${hoveredSignal.breakout?.level?.toFixed(2) || "N/A"}</span></div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>Retest Candle:</span><span>${retestTime}</span></div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>Entry:</span><span>${hoveredSignal.entryPrice.toFixed(2)}</span></div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>SL:</span><span>${hoveredSignal.stopLoss.toFixed(2)}</span></div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>TP:</span><span>${hoveredSignal.takeProfit.toFixed(2)}</span></div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>RR:</span><span>${hoveredSignal.rr.toFixed(2)}R</span></div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>Score:</span><span>${hoveredSignal.score}</span></div>
              ${asianRangeHtml}
              <div style="margin-top: 4px; color: rgba(255,255,255,0.7); font-size: 10px; line-height: 1.2;">${hoveredSignal.reasons.join(", ")}</div>
            </div>
          `;
        } else if (hoveredSignal.silverBullet) {
          signalHtml = `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#22d3ee;margin-bottom:4px">ICT Silver Bullet</div><div>Killzone: ${hoveredSignal.silverBullet.killzoneName}</div><div>Liquidity: ${hoveredSignal.silverBullet.liquidity.type} ${hoveredSignal.silverBullet.liquidity.source}</div><div>Sweep: ${hoveredSignal.silverBullet.sweep.sweepPrice.toFixed(2)} (${hoveredSignal.silverBullet.sweep.sweepDistanceAtr.toFixed(2)} ATR)</div><div>${hoveredSignal.silverBullet.structureShift.type}: ${hoveredSignal.silverBullet.structureShift.brokenLevel.toFixed(2)}</div><div>FVG: ${hoveredSignal.silverBullet.fvg.bottom.toFixed(2)} - ${hoveredSignal.silverBullet.fvg.top.toFixed(2)} | Mid ${hoveredSignal.silverBullet.fvg.midpoint.toFixed(2)}</div><div>Entry / SL / TP: ${hoveredSignal.entryPrice.toFixed(2)} / ${hoveredSignal.stopLoss.toFixed(2)} / ${hoveredSignal.takeProfit.toFixed(2)}</div><div>RR ${hoveredSignal.rr.toFixed(2)}R | Score ${hoveredSignal.score}</div></div>`;
        } else if (hoveredSignal.ictOteContinuation) {
          signalHtml = `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#22d3ee;margin-bottom:4px">ICT OTE Continuation Engine</div><div>Direction: ${hoveredSignal.ictOteContinuation.impulse.direction}</div><div>Impulse: ${hoveredSignal.ictOteContinuation.impulse.low.toFixed(2)} - ${hoveredSignal.ictOteContinuation.impulse.high.toFixed(2)}</div><div>OTE: ${hoveredSignal.ictOteContinuation.ote.low.toFixed(2)} - ${hoveredSignal.ictOteContinuation.ote.high.toFixed(2)} | 0.705 ${hoveredSignal.ictOteContinuation.ote.level705.toFixed(2)}</div><div>${hoveredSignal.ictOteContinuation.structureBreak.type}: ${hoveredSignal.ictOteContinuation.structureBreak.brokenLevel.toFixed(2)}</div><div>Confluence: ${hoveredSignal.ictOteContinuation.ote.confluence.join(" + ") || "None"}</div><div>Entry / SL / TP: ${hoveredSignal.entryPrice.toFixed(2)} / ${hoveredSignal.stopLoss.toFixed(2)} / ${hoveredSignal.takeProfit.toFixed(2)}</div><div>RR ${hoveredSignal.rr.toFixed(2)}R | Score ${hoveredSignal.ictOteContinuation.confluence.score}/${hoveredSignal.ictOteContinuation.confluence.maxScore} | ${hoveredSignal.confidence}</div><div style="margin-top:4px;color:rgba(255,255,255,.7)">${hoveredSignal.reasons.join(" ")}</div></div>`;
        } else if (hoveredSignal.proLiquidityConfluence) {
          signalHtml = `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#34d399;margin-bottom:4px">Pro Liquidity Confluence</div><div>Session: ${hoveredSignal.proLiquidityConfluence.sessionName}</div><div>Liquidity: ${hoveredSignal.proLiquidityConfluence.liquiditySweep.type} ${hoveredSignal.proLiquidityConfluence.liquiditySweep.source} @ ${hoveredSignal.proLiquidityConfluence.liquiditySweep.level.toFixed(2)}</div><div>Displacement: ${hoveredSignal.proLiquidityConfluence.displacement.rangeAtrMultiple.toFixed(2)} ATR</div><div>${hoveredSignal.proLiquidityConfluence.structureShift.type}: ${hoveredSignal.proLiquidityConfluence.structureShift.brokenLevel.toFixed(2)}</div><div>Zone: ${hoveredSignal.proLiquidityConfluence.entryZone.type} ${hoveredSignal.proLiquidityConfluence.entryZone.bottom.toFixed(2)} - ${hoveredSignal.proLiquidityConfluence.entryZone.top.toFixed(2)}</div><div>Entry / SL / TP: ${hoveredSignal.entryPrice.toFixed(2)} / ${hoveredSignal.stopLoss.toFixed(2)} / ${hoveredSignal.takeProfit.toFixed(2)}</div><div>RR ${hoveredSignal.rr.toFixed(2)}R | Score ${hoveredSignal.proLiquidityConfluence.confluence.score}/${hoveredSignal.proLiquidityConfluence.confluence.maxScore}</div></div>`;
        } else if (hoveredSignal.fvgContinuation) {
          signalHtml = `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#38bdf8;margin-bottom:4px">FVG Continuation Entry</div><div>Session: ${hoveredSignal.fvgContinuation.sessionName}</div><div>${hoveredSignal.fvgContinuation.structureBreak.type}: ${hoveredSignal.fvgContinuation.structureBreak.brokenLevel.toFixed(2)}</div><div>FVG: ${hoveredSignal.fvgContinuation.fvg.bottom.toFixed(2)} - ${hoveredSignal.fvgContinuation.fvg.top.toFixed(2)} | Mid ${hoveredSignal.fvgContinuation.fvg.midpoint.toFixed(2)}</div><div>Size: ${hoveredSignal.fvgContinuation.fvg.sizeAtr.toFixed(2)} ATR | Retest ${hoveredSignal.fvgContinuation.fvg.retestDepthPercent.toFixed(1)}%</div><div>Entry / SL / TP: ${hoveredSignal.entryPrice.toFixed(2)} / ${hoveredSignal.stopLoss.toFixed(2)} / ${hoveredSignal.takeProfit.toFixed(2)}</div><div>RR ${hoveredSignal.rr.toFixed(2)}R | Score ${hoveredSignal.score}</div></div>`;
        } else if (hoveredSignal.ictIfvgReversal) {
          signalHtml = `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#E1BEE7;margin-bottom:4px">ICT IFVG Reversal Engine</div><div>Session: ${hoveredSignal.ictIfvgReversal.sessionName}</div><div>${hoveredSignal.ictIfvgReversal.structureBreak.type}: ${hoveredSignal.ictIfvgReversal.structureBreak.brokenLevel.toFixed(2)}</div><div>IFVG: ${hoveredSignal.ictIfvgReversal.ifvgZone.bottom.toFixed(2)} - ${hoveredSignal.ictIfvgReversal.ifvgZone.top.toFixed(2)} | Mid ${hoveredSignal.ictIfvgReversal.ifvgZone.midpoint.toFixed(2)}</div><div>Original FVG: ${hoveredSignal.ictIfvgReversal.originalFvg.bottom.toFixed(2)} - ${hoveredSignal.ictIfvgReversal.originalFvg.top.toFixed(2)}</div><div>Entry / SL / TP: ${hoveredSignal.entryPrice.toFixed(2)} / ${hoveredSignal.stopLoss.toFixed(2)} / ${hoveredSignal.takeProfit.toFixed(2)}</div><div>RR ${hoveredSignal.rr.toFixed(2)}R | Score ${hoveredSignal.score}</div></div>`;

        } else if (hoveredSignal.tjrSimpleStructurePullback) {
          signalHtml = `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#67e8f9;margin-bottom:4px">TJR Simple Structure Pullback</div><div>Model: ${hoveredSignal.tjrSimpleStructurePullback.modelUsed}</div><div>Direction: ${hoveredSignal.v2Direction ?? hoveredSignal.direction}</div><div>Structure: ${hoveredSignal.tjrSimpleStructurePullback.structureType ?? "-"} ${hoveredSignal.tjrSimpleStructurePullback.bosType ?? "-"}</div><div>Zone: ${hoveredSignal.tjrSimpleStructurePullback.selectedZoneType ?? "-"} ${hoveredSignal.tjrSimpleStructurePullback.selectedZoneLow?.toFixed(2) ?? "-"} - ${hoveredSignal.tjrSimpleStructurePullback.selectedZoneHigh?.toFixed(2) ?? "-"}</div><div>Retest: ${hoveredSignal.tjrSimpleStructurePullback.retestDepthPercent.toFixed(1)}% | Confidence ${hoveredSignal.confidence}</div><div>Entry / SL / TP: ${hoveredSignal.entryPrice.toFixed(2)} / ${hoveredSignal.stopLoss.toFixed(2)} / ${hoveredSignal.takeProfit.toFixed(2)}</div><div>RR ${hoveredSignal.rr.toFixed(2)}R | Score ${hoveredSignal.score}</div><div style="margin-top:4px;color:rgba(255,255,255,.7)">${hoveredSignal.reasons.join(" ")}</div></div>`;
        } else if (hoveredSignal.vwapEma) {
          signalHtml = `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#c4b5fd;margin-bottom:4px">VWAP EMA Regime Pullback</div><div>Session: ${hoveredSignal.vwapEma.sessionName}</div><div>Regime: ${hoveredSignal.vwapEma.regime.direction}</div><div>VWAP: ${hoveredSignal.vwapEma.indicators.sessionVwap.toFixed(2)}</div><div>EMA 20 / 50 / 200: ${hoveredSignal.vwapEma.indicators.ema20.toFixed(2)} / ${hoveredSignal.vwapEma.indicators.ema50.toFixed(2)} / ${hoveredSignal.vwapEma.indicators.ema200.toFixed(2)}</div><div>RR ${hoveredSignal.rr.toFixed(2)}R | Score ${hoveredSignal.score}</div></div>`;
        } else if (hoveredSignal.emaTrendPullback) {
          signalHtml = `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#5eead4;margin-bottom:4px">EMA Trend Pullback</div><div>Session: ${hoveredSignal.emaTrendPullback.sessionName}</div><div>Trend: ${hoveredSignal.emaTrendPullback.trend.direction}</div><div>EMA 20 / 50 / 200: ${hoveredSignal.emaTrendPullback.indicators.ema20.toFixed(2)} / ${hoveredSignal.emaTrendPullback.indicators.ema50.toFixed(2)} / ${hoveredSignal.emaTrendPullback.indicators.ema200.toFixed(2)}</div><div>Pullback: ${hoveredSignal.emaTrendPullback.pullback.touchedEma}</div><div>Entry / SL / TP: ${hoveredSignal.entryPrice.toFixed(2)} / ${hoveredSignal.stopLoss.toFixed(2)} / ${hoveredSignal.takeProfit.toFixed(2)}</div><div>RR ${hoveredSignal.rr.toFixed(2)}R | Score ${hoveredSignal.score}</div></div>`;
        } else if (hoveredSignal.liquiditySweepReversal) {
          signalHtml = `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#fb7185;margin-bottom:4px">Liquidity Sweep Reversal Pro</div><div>Liquidity: ${hoveredSignal.liquiditySweepReversal.liquidity.type} ${hoveredSignal.liquiditySweepReversal.liquidity.source}</div><div>Level: ${hoveredSignal.liquiditySweepReversal.liquidity.level.toFixed(2)}</div><div>Sweep: ${hoveredSignal.liquiditySweepReversal.sweep.sweepPrice.toFixed(2)} (${hoveredSignal.liquiditySweepReversal.sweep.sweepDistanceAtr.toFixed(2)} ATR)</div><div>Session: ${hoveredSignal.liquiditySweepReversal.confluence.sessionName ?? "Outside active session"}</div><div>Entry / SL / TP: ${hoveredSignal.entryPrice.toFixed(2)} / ${hoveredSignal.stopLoss.toFixed(2)} / ${hoveredSignal.takeProfit.toFixed(2)}</div><div>RR ${hoveredSignal.rr.toFixed(2)}R | Score ${hoveredSignal.score}</div></div>`;
        } else {
          signalHtml = `
            <div class="chart-tooltip-signal" style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 6px; padding-top: 6px; font-size: 11px;">
              <div style="font-weight: bold; margin-bottom: 4px;">${hoveredSignal.type} ${hoveredSignal.rr.toFixed(1)}R | Score ${hoveredSignal.score}</div>
              ${asianRangeHtml}
            </div>
          `;
        }
        signalHtml += buildIntermarketTooltipHtml(hoveredSignal);
        signalHtml += buildFollowThroughTooltipHtml(hoveredSignal);
      }

      tooltip.innerHTML = `<div class="chart-tooltip-time">${time}</div><div class="chart-tooltip-row"><span class="chart-tooltip-label">O</span><span class="chart-tooltip-value">${formatPrice(data.open)}</span></div><div class="chart-tooltip-row"><span class="chart-tooltip-label">H</span><span class="chart-tooltip-value">${formatPrice(data.high)}</span></div><div class="chart-tooltip-row"><span class="chart-tooltip-label">L</span><span class="chart-tooltip-value">${formatPrice(data.low)}</span></div><div class="chart-tooltip-row"><span class="chart-tooltip-label">C</span><span class="chart-tooltip-value">${formatPrice(data.close)}</span></div><div class="chart-tooltip-row"><span class="chart-tooltip-label">Chg</span><span class="chart-tooltip-value ${changeColor}">${changeSign}${changePct}%</span></div>${signalHtml}`;

      // Position tooltip near cursor, avoid screen edges
      const containerRect = container.getBoundingClientRect();
      const tx = param.point.x;
      const ty = param.point.y;
      const tooltipWidth = hoveredSignal?.asianRange ? 240 : 180;
      const tooltipHeight = tooltip.offsetHeight || 130;
      const flipX = tx + tooltipWidth + 20 > containerRect.width;
      const flipY = ty + tooltipHeight + 20 > containerRect.height;
      tooltip.style.left = flipX ? `${tx - tooltipWidth - 12}px` : `${tx + 16}px`;
      tooltip.style.top = flipY ? `${ty - tooltipHeight - 8}px` : `${ty + 8}px`;
      tooltip.classList.add("chart-tooltip--visible");
    });

    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range) {
        onVisibleRangeChangeRef.current("No visible range");
        return;
      }

      onVisibleRangeChangeRef.current(
        `${formatChartTime(range.from)} - ${formatChartTime(range.to)}`,
      );
      updateAnalysisZone();
      updateSignalBands();
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      // Track if user is viewing the latest candle
      const logicalRange = chart.timeScale().getVisibleLogicalRange();
      if (logicalRange) {
        const dataLen = seriesRef.current ? candlestickSeries.data().length : 0;
        setIsAtLatest(Number(logicalRange.to) >= dataLen - 2);
      }
      updateSignalBands();
    });

    return () => {
      window.clearTimeout(resizeTimer);
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markerPluginRef.current = null;
      priceLinesRef.current = [];
    };
  }, [updateAnalysisZone, updateContextBands, updateSetupBands, updateSignalBands]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const isFirstLoad = isEmptySignature(renderedDataSignature) && formattedChartData.length > 0;
      const savedRange = !isFirstLoad ? chart.timeScale().getVisibleLogicalRange() : null;

      series.setData(formattedChartData);
      setRenderedDataSignature(chartDataSignature);

      // Update current price line
      if (currentPriceLineRef.current) {
        series.removePriceLine(currentPriceLineRef.current);
        currentPriceLineRef.current = null;
      }
      if (formattedChartData.length > 0) {
        const lastCandle = formattedChartData[formattedChartData.length - 1];
        currentPriceLineRef.current = series.createPriceLine({
          price: lastCandle.close,
          color: lastCandle.close >= lastCandle.open ? "#26a69a" : "#ef5350",
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: "",
        });
      }

      if (isFirstLoad && formattedChartData.length > 0) {
        // First load: fit all content
        chart.timeScale().fitContent();
      } else if (savedRange) {
        // Subsequent updates: preserve scroll position
        chart.timeScale().setVisibleLogicalRange(savedRange);
      }

      updateAnalysisZone();
      updateContextBands();
      updateSetupBands();
      updateSignalBands();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [formattedChartData, chartDataSignature, renderedDataSignature, updateAnalysisZone, updateContextBands, updateSetupBands, updateSignalBands]);

  useEffect(() => {
    markerPluginRef.current?.setMarkers(seriesMarkers);
  }, [seriesMarkers]);



  useEffect(() => {
    if (!selectedSignalId || !chartRef.current || candles.length === 0) {
      return;
    }

    const signal = signals.find((item) => item.id === selectedSignalId);
    if (!signal) {
      return;
    }

    const signalIndex = findNearestCandleIndexByTime(candles, signal.timestamp);
    const fromIndex = Math.max(0, signalIndex - 12);
    const toIndex = Math.min(candles.length - 1, signalIndex + 12);
    chartRef.current.timeScale().setVisibleRange({
      from: Math.floor(candles[fromIndex].timestamp / 1000) as UTCTimestamp,
      to: Math.floor(candles[toIndex].timestamp / 1000) as UTCTimestamp,
    });
  }, [candles, selectedSignalId, signals]);

  useEffect(() => {
    if (!seriesRef.current) {
      return;
    }

    for (const priceLine of priceLinesRef.current) {
      seriesRef.current.removePriceLine(priceLine);
    }

    const liquidityLines = liquidityZones.map((zone) =>
      seriesRef.current!.createPriceLine({
        id: zone.id,
        price: zone.price,
        color: zone.type === "BSL" ? "#b45309" : "#2563eb",
        lineWidth: zone.strength === 3 ? 2 : 1,
        lineStyle: zone.swept ? LineStyle.Dotted : LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${zone.type} ${zone.touches}x${zone.swept ? " swept" : ""}`,
      }),
    );
    const scenarioLines = candleReading
      ? [
          seriesRef.current.createPriceLine({
            id: "reading-previous-high",
            price: candleReading.keyLevels.previousHigh,
            color: "#b45309",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: "Prev high",
          }),
          seriesRef.current.createPriceLine({
            id: "reading-previous-low",
            price: candleReading.keyLevels.previousLow,
            color: "#2563eb",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: "Prev low",
          }),
          seriesRef.current.createPriceLine({
            id: "reading-previous-midpoint",
            price: candleReading.keyLevels.previousMidpoint,
            color: "#64748b",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: "Prev midpoint",
          }),
          seriesRef.current.createPriceLine({
            id: "reading-latest-close",
            price: candleReading.keyLevels.latestClose,
            color:
              candleReading.latestCandle.direction === "BULLISH"
                ? "#047857"
                : candleReading.latestCandle.direction === "BEARISH"
                  ? "#b91c1c"
                  : "#475569",
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `Close ${candleReading.latestCandle.closeStrength.toLowerCase()}`,
          }),
        ]
      : [];

    const contextLines: IPriceLine[] = [];
    const addContextLine = (id: string, price: number | null, color: string, title: string, style = LineStyle.Dashed) => {
      if (price === null) return;
      contextLines.push(seriesRef.current!.createPriceLine({ id, price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
    };
    if (contextOverlays.dealingRange && marketContext.premiumDiscount) {
      addContextLine("context-range-high", marketContext.premiumDiscount.rangeHigh, "#9f1239", "HTF range high");
      addContextLine("context-equilibrium", marketContext.premiumDiscount.equilibrium, "#475569", "HTF EQ", LineStyle.Dotted);
      addContextLine("context-range-low", marketContext.premiumDiscount.rangeLow, "#047857", "HTF range low");
    }
    if (contextOverlays.nearestLevels) {
      addContextLine("context-nearest-resistance", marketContext.nearestLevels.nearestResistance?.price ?? null, "#be123c", "Nearest R");
      addContextLine("context-nearest-support", marketContext.nearestLevels.nearestSupport?.price ?? null, "#15803d", "Nearest S");
    }
    if (contextOverlays.sessionLevels) {
      addContextLine("context-session-high", marketContext.session.currentSessionHigh, "#7c3aed", "Session high", LineStyle.Dotted);
      addContextLine("context-session-low", marketContext.session.currentSessionLow, "#7c3aed", "Session low", LineStyle.Dotted);
      addContextLine("context-previous-session-high", marketContext.session.previousSessionHigh, "#a855f7", "Prev session high", LineStyle.Dotted);
      addContextLine("context-previous-session-low", marketContext.session.previousSessionLow, "#a855f7", "Prev session low", LineStyle.Dotted);
    }

    const setupLines: IPriceLine[] = [];
    if (showSetupOverlays) {
      for (const setup of setups.slice(0, 4)) {
        const color = setupOverlayColor(setup);
        const style = setup.state === "WATCH" || setup.state === "EXPIRED" ? LineStyle.Dotted : setup.state === "INVALIDATED" ? LineStyle.Dashed : LineStyle.Solid;
        setupLines.push(seriesRef.current.createPriceLine({ id: `${setup.id}:zone`, price: setup.setupZone.midpoint, color, lineWidth: setup.state === "TRIGGER" ? 2 : 1, lineStyle: style, axisLabelVisible: true, title: `${setup.state} ${setup.direction} ${setup.score}` }));
        setupLines.push(seriesRef.current.createPriceLine({ id: `${setup.id}:invalid`, price: setup.invalidationLevel.price, color: "#dc2626", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Invalidation" }));
        if (setup.targetLiquidity) setupLines.push(seriesRef.current.createPriceLine({ id: `${setup.id}:target`, price: setup.targetLiquidity.price, color: "#0369a1", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: `Target ${setup.targetLiquidity.targetType}` }));
      }
    }

    const signalLines: IPriceLine[] = [];
    if (showSignalOverlays) {
      const selectedSignal = selectedSignalId ? signals.find((signal) => signal.id === selectedSignalId) ?? null : null;
      const lineSignals = uniqueSignals([selectedSignal, ...signals.slice(-3)].filter((signal): signal is TradeSignal => Boolean(signal)));
      for (const signal of lineSignals) {
        const color = signal.direction === "BULLISH" ? "#047857" : "#b91c1c";
        const width = signal.id === selectedSignalId ? 3 : 2;
        signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:entry`, price: signal.entryPrice, color, lineWidth: width, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `${signal.type} ENTRY` }));
        signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:sl`, price: signal.stopLoss, color: "#dc2626", lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "SL" }));
        signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:tp1`, price: signal.takeProfit, color: "#15803d", lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "TP1" }));
        if (signal.takeProfit2 !== null) signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:tp2`, price: signal.takeProfit2, color: "#16a34a", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "TP2" }));
        if (signal.takeProfit3 !== null) signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:tp3`, price: signal.takeProfit3, color: "#22c55e", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "TP3" }));
        signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:invalid`, price: signal.invalidationLevel, color: "#7f1d1d", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "Signal invalidation" }));
        if (signal.followThrough) {
          const follow = signal.followThrough;
          const followColor = follow.chartOverlay.markerColor;
          if (follow.nearestTarget) {
            signalLines.push(seriesRef.current.createPriceLine({
              id: `${signal.id}:follow-through-target`,
              price: follow.nearestTarget.price,
              color: followColor,
              lineWidth: follow.followThroughGrade === "A+" ? 3 : follow.followThroughGrade === "A" ? 2 : 1,
              lineStyle: follow.followThroughGrade === "C" || follow.followThroughGrade === "AVOID" ? LineStyle.Dashed : LineStyle.Solid,
              axisLabelVisible: true,
              title: follow.chartOverlay.targetLabel,
            }));
          }
          if (follow.nearestObstacle) {
            signalLines.push(seriesRef.current.createPriceLine({
              id: `${signal.id}:follow-through-obstacle`,
              price: follow.nearestObstacle.price,
              color: "#f59e0b",
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: follow.chartOverlay.obstacleLabel ?? "Follow-through obstacle",
            }));
          }
          signalLines.push(seriesRef.current.createPriceLine({
            id: `${signal.id}:follow-through-invalidation`,
            price: follow.invalidationLevel,
            color: "#dc2626",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: follow.chartOverlay.invalidationLabel,
          }));
        }
        if (signal.silverBullet) {
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:sweep-level`, price: signal.silverBullet.sweep.level, color: "#06b6d4", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${signal.silverBullet.sweep.type} sweep` }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:fvg-high`, price: signal.silverBullet.fvg.high, color: "#f59e0b", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "FVG high" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:fvg-low`, price: signal.silverBullet.fvg.low, color: "#f59e0b", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "FVG low" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:fvg-mid`, price: signal.silverBullet.fvg.midpoint, color: "#fbbf24", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "FVG midpoint" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:mss-level`, price: signal.silverBullet.structureShift.brokenLevel, color: "#38bdf8", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: signal.silverBullet.structureShift.type }));
        }
        if (signal.fvgContinuation) {
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:fvg-cont-high`, price: signal.fvgContinuation.fvg.top, color: "#38bdf8", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "FVG top" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:fvg-cont-low`, price: signal.fvgContinuation.fvg.bottom, color: "#38bdf8", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "FVG bottom" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:fvg-cont-mid`, price: signal.fvgContinuation.fvg.midpoint, color: "#fbbf24", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "FVG midpoint" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:fvg-cont-structure`, price: signal.fvgContinuation.structureBreak.brokenLevel, color: "#60a5fa", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: signal.fvgContinuation.structureBreak.type }));
        }
        if (signal.proLiquidityConfluence) {
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:pro-sweep-level`, price: signal.proLiquidityConfluence.liquiditySweep.level, color: "#34d399", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${signal.proLiquidityConfluence.liquiditySweep.type} sweep` }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:pro-zone-top`, price: signal.proLiquidityConfluence.entryZone.top, color: "#10b981", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: `${signal.proLiquidityConfluence.entryZone.source} top` }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:pro-zone-bottom`, price: signal.proLiquidityConfluence.entryZone.bottom, color: "#10b981", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: `${signal.proLiquidityConfluence.entryZone.source} bottom` }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:pro-zone-mid`, price: signal.proLiquidityConfluence.entryZone.midpoint, color: "#fbbf24", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Zone midpoint" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:pro-mss-level`, price: signal.proLiquidityConfluence.structureShift.brokenLevel, color: "#60a5fa", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: signal.proLiquidityConfluence.structureShift.type }));
        }
        if (signal.ictOteContinuation) {
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ote-62`, price: signal.ictOteContinuation.ote.level62, color: "#22d3ee", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "OTE 0.62" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ote-705`, price: signal.ictOteContinuation.ote.level705, color: "#fbbf24", lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "OTE 0.705" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ote-79`, price: signal.ictOteContinuation.ote.level79, color: "#fb7185", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "OTE 0.79" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ote-structure`, price: signal.ictOteContinuation.structureBreak.brokenLevel, color: "#60a5fa", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: signal.ictOteContinuation.structureBreak.type }));
        }
        if (signal.ictIfvgReversal) {
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ifvg-top`, price: signal.ictIfvgReversal.ifvgZone.top, color: "#E1BEE7", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "IFVG top" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ifvg-bottom`, price: signal.ictIfvgReversal.ifvgZone.bottom, color: "#E1BEE7", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "IFVG bottom" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ifvg-mid`, price: signal.ictIfvgReversal.ifvgZone.midpoint, color: "#fbbf24", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "IFVG midpoint" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ifvg-structure`, price: signal.ictIfvgReversal.structureBreak.brokenLevel, color: "#60a5fa", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: signal.ictIfvgReversal.structureBreak.type }));
        }

        if (signal.vwapEma) {
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ema20`, price: signal.vwapEma.indicators.ema20, color: "#22d3ee", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "EMA 20" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ema50`, price: signal.vwapEma.indicators.ema50, color: "#f59e0b", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "EMA 50" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ema200`, price: signal.vwapEma.indicators.ema200, color: "#a78bfa", lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "EMA 200" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:vwap`, price: signal.vwapEma.indicators.sessionVwap, color: "#f472b6", lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Session VWAP" }));
        }
        if (signal.emaTrendPullback) {
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ema-trend-20`, price: signal.emaTrendPullback.indicators.ema20, color: "#22d3ee", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "EMA 20" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ema-trend-50`, price: signal.emaTrendPullback.indicators.ema50, color: "#f59e0b", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "EMA 50" }));
          signalLines.push(seriesRef.current.createPriceLine({ id: `${signal.id}:ema-trend-200`, price: signal.emaTrendPullback.indicators.ema200, color: "#14b8a6", lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "EMA 200" }));
        }
        if (signal.liquiditySweepReversal) {
          signalLines.push(seriesRef.current.createPriceLine({
            id: `${signal.id}:liquidity-level`,
            price: signal.liquiditySweepReversal.liquidity.level,
            color: signal.liquiditySweepReversal.liquidity.type === "SSL" ? "#38bdf8" : "#fb7185",
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${signal.liquiditySweepReversal.liquidity.type} ${signal.liquiditySweepReversal.liquidity.source}`,
          }));
        }
      }
    }

    const asianLines: IPriceLine[] = [];
    const isDebugGoldmine = process.env.DEBUG_GOLDMINE === "true" ||
      (typeof window !== "undefined" && (window as DebugWindow).DEBUG_GOLDMINE === true);

    if (isDebugGoldmine && v2AsianRanges && v2AsianRanges.length > 0) {
      const validRanges = v2AsianRanges.filter((r) => r.valid).slice(-3);
      for (const range of validRanges) {
        asianLines.push(
          seriesRef.current.createPriceLine({
            id: `asian-high-${range.date}`,
            price: range.high,
            color: "hsl(340, 82%, 60%)",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `Asian High (${range.date})`,
          })
        );
        asianLines.push(
          seriesRef.current.createPriceLine({
            id: `asian-low-${range.date}`,
            price: range.low,
            color: "hsl(25, 95%, 62%)",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `Asian Low (${range.date})`,
          })
        );
      }
    }

    priceLinesRef.current = [
      ...liquidityLines,
      ...scenarioLines,
      ...contextLines,
      ...setupLines,
      ...signalLines,
      ...asianLines,
    ];
    window.requestAnimationFrame(updateContextBands);
    window.requestAnimationFrame(updateSetupBands);
  }, [
    candleReading,
    contextOverlays,
    liquidityZones,
    marketContext,
    selectedSignalId,
    setups,
    showSetupOverlays,
    showSignalOverlays,
    signals,
    updateContextBands,
    updateSetupBands,
    v2AsianRanges,
  ]);

  const handleGoLive = useCallback(() => {
    chartRef.current?.timeScale().scrollToRealTime();
    setIsAtLatest(true);
  }, []);

  return (
    <section
      className={
        isFullscreen
          ? "flex h-screen min-h-0 flex-col border border-[#2a2e39] bg-[#131722]"
          : "flex min-h-[calc(100vh-96px)] flex-col border border-[#2a2e39] bg-[#131722]"
      }
    >
      <div className="flex flex-col gap-3 border-b border-[#2a2e39] bg-[#1c2030] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#E91E63]"></span>
            {symbol} Scalping Engine
          </h2>
          <p className="mt-1 text-xs text-[#848e9c]">{visibleRange}</p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          {contextOverlays.contextLabels ? (
            <div className="text-xs font-semibold text-[#cbd5e1] bg-[#131722] border border-[#2a2e39] px-2.5 py-1 rounded">
              HTF: <span className="text-[#26a69a]">{formatLabel(marketContext.htfBias.bias)}</span> ({marketContext.htfBias.strength}/100) | <span className="text-[#ab47bc]">{formatLabel(marketContext.regime.regime)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* TradingView toolbar */}
      <div className="flex flex-wrap items-center justify-between border-b border-[#2a2e39] bg-[#1c2030] px-3 py-1.5 gap-2 text-xs text-[#d1d4dc] font-medium select-none">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Timeframe Group */}
          <div className="flex items-center bg-[#131722] rounded border border-[#2a2e39] p-0.5">
            {['1m', '5m', '15m', '30m', '1h'].map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange?.(tf)}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                  activeTimeframe === tf 
                    ? 'bg-[#E91E63] text-white font-bold' 
                    : 'hover:bg-[#2a2e39] text-[#cbd5e1]'
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="h-4 w-[1px] bg-[#2a2e39]" />

          {/* Chart Type Group */}
          <div className="flex items-center bg-[#131722] rounded border border-[#2a2e39] p-0.5">
            <button
              type="button"
              onClick={() => setChartType('candles')}
              className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                chartType === 'candles' 
                  ? 'bg-[#2a2e39] text-white font-semibold' 
                  : 'hover:bg-[#2a2e39] text-[#848e9c]'
              }`}
            >
              Candles
            </button>
            <button
              type="button"
              onClick={() => setChartType('heikin-ashi')}
              className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                chartType === 'heikin-ashi' 
                  ? 'bg-[#2a2e39] text-white font-semibold' 
                  : 'hover:bg-[#2a2e39] text-[#848e9c]'
              }`}
            >
              Heikin Ashi
            </button>
          </div>

          <div className="h-4 w-[1px] bg-[#2a2e39]" />

          {/* Visibility Toggles */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (onMarkerVisibilityChange) {
                  const anyActive = markerVisibility.swings || markerVisibility.sweeps || markerVisibility.structure || markerVisibility.fvg || markerVisibility.momentum;
                  onMarkerVisibilityChange({
                    ...markerVisibility,
                    swings: !anyActive,
                    sweeps: !anyActive,
                    structure: !anyActive,
                    fvg: !anyActive,
                    momentum: !anyActive,
                  });
                }
              }}
              className={`px-2.5 py-1 rounded border text-[11px] transition-all ${
                (markerVisibility.swings || markerVisibility.sweeps || markerVisibility.structure || markerVisibility.fvg)
                  ? 'border-[#E91E63] bg-[#E91E63]/10 text-white' 
                  : 'border-[#2a2e39] bg-[#131722] text-[#848e9c] hover:border-[#475569]'
              }`}
            >
              Markers
            </button>

            <button
              type="button"
              onClick={() => {
                if (onMarkerVisibilityChange) {
                  onMarkerVisibilityChange({
                    ...markerVisibility,
                    liquidity: !markerVisibility.liquidity,
                  });
                }
              }}
              className={`px-2.5 py-1 rounded border text-[11px] transition-all ${
                markerVisibility.liquidity 
                  ? 'border-[#E91E63] bg-[#E91E63]/10 text-white' 
                  : 'border-[#2a2e39] bg-[#131722] text-[#848e9c] hover:border-[#475569]'
              }`}
            >
              Liquidity
            </button>

            <button
              type="button"
              onClick={() => {
                if (onMarkerVisibilityChange) {
                  onMarkerVisibilityChange({
                    ...markerVisibility,
                    pressure: !markerVisibility.pressure,
                  });
                }
              }}
              className={`px-2.5 py-1 rounded border text-[11px] transition-all ${
                markerVisibility.pressure 
                  ? 'border-[#E91E63] bg-[#E91E63]/10 text-white' 
                  : 'border-[#2a2e39] bg-[#131722] text-[#848e9c] hover:border-[#475569]'
              }`}
            >
              Pressure
            </button>
          </div>
        </div>

        {/* Right Side: Zoom Controls & Fullscreen */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-[#131722] rounded border border-[#2a2e39] p-0.5">
            <button
              type="button"
              title="Zoom In"
              onClick={() => {
                const timeScale = chartRef.current?.timeScale();
                if (timeScale) {
                  const current = timeScale.options().barSpacing || 6;
                  timeScale.applyOptions({ barSpacing: current * 1.2 });
                }
              }}
              className="p-1 rounded hover:bg-[#2a2e39] text-[#cbd5e1]"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7"/></svg>
            </button>
            <button
              type="button"
              title="Zoom Out"
              onClick={() => {
                const timeScale = chartRef.current?.timeScale();
                if (timeScale) {
                  const current = timeScale.options().barSpacing || 6;
                  timeScale.applyOptions({ barSpacing: Math.max(0.5, current / 1.2) });
                }
              }}
              className="p-1 rounded hover:bg-[#2a2e39] text-[#cbd5e1]"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7"/></svg>
            </button>
            <button
              type="button"
              title="Reset View"
              onClick={() => chartRef.current?.timeScale().fitContent()}
              className="p-1 rounded hover:bg-[#2a2e39] text-[#cbd5e1]"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3-3 3 3m-3-3v12"/></svg>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              const next = !isAutoScale;
              chartRef.current?.priceScale('right').applyOptions({ autoScale: next });
              setIsAutoScale(next);
            }}
            className={`px-2 py-1 rounded border text-[11px] transition-colors ${
              isAutoScale 
                ? 'border-[#26a69a] text-[#26a69a] bg-[#26a69a]/5' 
                : 'border-[#2a2e39] bg-[#131722] text-[#848e9c]'
            }`}
          >
            Auto
          </button>

          <button
            type="button"
            onClick={() => onFullscreenChange(!isFullscreen)}
            className="p-1.5 rounded bg-[#131722] border border-[#2a2e39] hover:bg-[#2a2e39] text-[#cbd5e1] transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 9L4 4m0 0h5M4 4v5m11-5l5 5m0-5v5m0-5h-5M9 15l-5 5m0 0h5m-5 0v-5m11 5l5-5m0 5v-5m0 5h-5"/></svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 8V4m0 0h4M4 4l5 5m11-5V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"/></svg>
            )}
          </button>
        </div>
      </div>

      <div ref={chartBodyRef} className="relative min-h-0 w-full flex-1 bg-[#131722]">
        <div
          ref={containerRef}
          className="absolute inset-0 z-[2] size-full"
          style={{ width: "100%", height: "100%" }}
        />

        {/* Floating Glassmorphism Tooltip */}
        <div ref={tooltipRef} className="chart-tooltip" />

        {showIntermarketOverlay && intermarketSnapshot ? (
          <div className="pointer-events-none absolute right-3 top-3 z-20 w-[min(320px,calc(100%-24px))] border border-[#2a2e39] bg-[#1c2030]/95 p-3 text-[11px] text-[#cbd5e1] shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold uppercase text-white">Intermarket</span>
              <span className={intermarketSnapshot.fred.dailyBias === "BULLISH_GOLD" ? "text-emerald-300" : intermarketSnapshot.fred.dailyBias === "BEARISH_GOLD" ? "text-rose-300" : "text-slate-300"}>
                {formatLabel(intermarketSnapshot.fred.dailyBias)}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <span>DXY {formatLabel(intermarketSnapshot.dxy.trend)}</span>
              <span>{formatLabel(intermarketSnapshot.dxy.momentum)}</span>
              <span>TNX {formatLabel(intermarketSnapshot.tnx.trend)}</span>
              <span>{formatLabel(intermarketSnapshot.tnx.momentum)}</span>
            </div>
            {intermarketSnapshot.warnings.length ? (
              <div className="mt-2 truncate text-amber-200">{intermarketSnapshot.warnings.join(", ")}</div>
            ) : null}
          </div>
        ) : null}

        {/* Bouncing Go Live Button */}
        {!isAtLatest && (
          <button
            type="button"
            onClick={handleGoLive}
            className="absolute bottom-6 right-24 z-10 flex items-center gap-1.5 px-3.5 py-2 bg-[#E91E63] text-white text-xs font-bold rounded-full shadow-lg border border-[#FF6B35] hover:scale-105 transition-all animate-bounce"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            Go Live
          </button>
        )}

        {contextBands ? (
          <>
            <div className="pointer-events-none absolute inset-x-0 z-[5] bg-rose-500/5" style={{ top: contextBands.premiumTop, height: contextBands.premiumHeight }} />
            <div className="pointer-events-none absolute inset-x-0 z-[5] bg-emerald-500/5" style={{ top: contextBands.discountTop, height: contextBands.discountHeight }} />
          </>
        ) : null}

        {setupBands.map(({ setup, top, height }, index) => (
          <div
            key={setup.id}
            className="pointer-events-none absolute inset-x-0 z-[6]"
            style={{
              top,
              height,
              borderTop: `${setup.state === "TRIGGER" ? 2 : 1}px ${setup.state === "WATCH" ? "dotted" : "solid"} ${setupOverlayColor(setup)}`,
              borderBottom: `${setup.state === "TRIGGER" ? 2 : 1}px ${setup.state === "WATCH" ? "dotted" : "solid"} ${setupOverlayColor(setup)}`,
              backgroundColor: setupOverlayFill(setup),
              opacity: setup.state === "INVALIDATED" || setup.state === "EXPIRED" ? 0.45 : 1,
            }}
          >
            <span className="absolute right-20 top-0 bg-[#1c2030] px-1 text-[9px] font-bold text-[#d1d4dc] border border-[#2a2e39] rounded" style={{ color: setupOverlayColor(setup), transform: `translateY(${index % 2 ? "-100%" : "0"})` }}>
              {setup.state === "INVALIDATED" ? "X " : ""}{formatLabel(setup.type)} {setup.direction} {setup.score}
            </span>
          </div>
        ))}

        {orderBlockBands.map(({ signal, left, width, top, height }) => (
          <div
            key={`${signal.id}:order-block-band`}
            className="pointer-events-none absolute z-[7]"
            style={{
              left,
              width,
              top,
              height,
              border: `1px solid ${signal.direction === "BULLISH" ? "rgba(20, 184, 166, 0.55)" : "rgba(244, 63, 94, 0.55)"}`,
              backgroundColor: signal.direction === "BULLISH" ? "rgba(20, 184, 166, 0.12)" : "rgba(244, 63, 94, 0.12)",
            }}
          >
            <span className="absolute left-1 top-0 -translate-y-full rounded border border-[#2a2e39] bg-[#1c2030]/95 px-1 text-[9px] font-bold text-[#d1d4dc]">
              OB {signal.direction}
            </span>
          </div>
        ))}

        {silverBulletBands.map(({ signal, left, width, fvgLeft, fvgWidth, fvgTop, fvgHeight, selected }) => {
          const bullish = signal.direction === "BULLISH";
          const accent = selected ? "#00b0ff" : bullish ? "#22d3ee" : "#fb7185";
          return (
            <div key={`${signal.id}:silver-bullet-bands`} className="pointer-events-none absolute inset-0 z-[8]">
              <div
                className="absolute bottom-7 top-0 border-x"
                style={{
                  left,
                  width,
                  borderColor: selected ? "rgba(0, 176, 255, 0.42)" : bullish ? "rgba(34, 211, 238, 0.28)" : "rgba(251, 113, 133, 0.28)",
                  backgroundColor: selected ? "rgba(0, 176, 255, 0.07)" : bullish ? "rgba(34, 211, 238, 0.045)" : "rgba(251, 113, 133, 0.045)",
                }}
              >
                <span
                  className="absolute left-1 top-1 rounded border border-[#2a2e39] bg-[#1c2030]/95 px-1 text-[9px] font-bold"
                  style={{ color: accent }}
                >
                  SB {signal.silverBullet?.killzoneName}
                </span>
              </div>
              <div
                className="absolute rounded-sm border"
                style={{
                  left: fvgLeft,
                  width: fvgWidth,
                  top: fvgTop,
                  height: fvgHeight,
                  borderColor: selected ? "rgba(251, 191, 36, 0.92)" : "rgba(245, 158, 11, 0.74)",
                  backgroundColor: selected ? "rgba(251, 191, 36, 0.22)" : "rgba(245, 158, 11, 0.14)",
                  boxShadow: selected ? "0 0 0 1px rgba(251, 191, 36, 0.18)" : "none",
                }}
              >
                <span className="absolute right-1 top-0 -translate-y-full rounded border border-[#2a2e39] bg-[#1c2030]/95 px-1 text-[9px] font-bold text-[#fbbf24]">
                  FVG
                </span>
              </div>
            </div>
          );
        })}

        {fvgContinuationBands.map(({ signal, left, width, top, height, selected }) => (
          <div
            key={`${signal.id}:fvg-continuation-band`}
            className="pointer-events-none absolute z-[8] rounded-sm border"
            style={{
              left,
              width,
              top,
              height,
              borderColor: selected ? "rgba(56, 189, 248, 0.92)" : "rgba(56, 189, 248, 0.68)",
              backgroundColor: selected ? "rgba(56, 189, 248, 0.20)" : "rgba(56, 189, 248, 0.12)",
              boxShadow: selected ? "0 0 0 1px rgba(56, 189, 248, 0.18)" : "none",
            }}
          >
            <span className="absolute left-1 top-0 -translate-y-full rounded border border-[#2a2e39] bg-[#1c2030]/95 px-1 text-[9px] font-bold text-[#7dd3fc]">
              FVG {signal.fvgContinuation?.sessionName}
            </span>
          </div>
        ))}

        {proLiquidityBands.map(({ signal, left, width, top, height, selected }) => (
          <div
            key={`${signal.id}:pro-liquidity-band`}
            className="pointer-events-none absolute z-[9] rounded-sm border"
            style={{
              left,
              width,
              top,
              height,
              borderColor: selected ? "rgba(52, 211, 153, 0.95)" : "rgba(16, 185, 129, 0.72)",
              backgroundColor: selected ? "rgba(52, 211, 153, 0.22)" : "rgba(16, 185, 129, 0.12)",
              boxShadow: selected ? "0 0 0 1px rgba(52, 211, 153, 0.20)" : "none",
            }}
          >
            <span className="absolute left-1 top-0 -translate-y-full rounded border border-[#2a2e39] bg-[#1c2030]/95 px-1 text-[9px] font-bold text-[#86efac]">
              PLC {signal.proLiquidityConfluence?.entryZone.source}
            </span>
          </div>
        ))}

        {stockGuruBands.map(({ signal, left, width, top, height, selected }) => (
          <div
            key={`${signal.id}:stock-guru-band`}
            className="pointer-events-none absolute z-[10] rounded-sm border"
            style={{
              left,
              width,
              top,
              height,
              borderColor: selected ? "rgba(250, 204, 21, 0.98)" : "rgba(234, 179, 8, 0.76)",
              backgroundColor: selected ? "rgba(250, 204, 21, 0.24)" : "rgba(234, 179, 8, 0.13)",
              boxShadow: selected ? "0 0 0 1px rgba(250, 204, 21, 0.22)" : "none",
            }}
          >
            <span className="absolute left-1 top-0 -translate-y-full rounded border border-[#2a2e39] bg-[#1c2030]/95 px-1 text-[9px] font-bold text-[#fde68a]">
              SG {signal.stockGuruSweepFvgOb?.selectedZone.type} S{signal.score}
            </span>
          </div>
        ))}

        {tjrBands.map(({ signal, left, width, top, height, selected }) => (
          <div
            key={`${signal.id}:tjr-band`}
            className="pointer-events-none absolute z-[10] rounded-sm border"
            style={{
              left,
              width,
              top,
              height,
              borderColor: selected ? "rgba(34, 211, 238, 0.98)" : "rgba(6, 182, 212, 0.76)",
              backgroundColor: selected ? "rgba(34, 211, 238, 0.22)" : "rgba(6, 182, 212, 0.12)",
              boxShadow: selected ? "0 0 0 1px rgba(34, 211, 238, 0.22)" : "none",
            }}
          >
            <span className="absolute left-1 top-0 -translate-y-full rounded border border-[#2a2e39] bg-[#1c2030]/95 px-1 text-[9px] font-bold text-[#67e8f9]">
              TJR {signal.tjrSimpleStructurePullback?.selectedZoneType} S{signal.score}
            </span>
          </div>
        ))}

        {ictOteBands.map(({ signal, left, width, top, height, selected }) => (
          <div
            key={`${signal.id}:ict-ote-band`}
            className="pointer-events-none absolute z-[9] rounded-sm border"
            style={{
              left,
              width,
              top,
              height,
              borderColor: selected ? "rgba(34, 211, 238, 0.95)" : "rgba(6, 182, 212, 0.72)",
              backgroundColor: selected ? "rgba(34, 211, 238, 0.22)" : "rgba(6, 182, 212, 0.12)",
              boxShadow: selected ? "0 0 0 1px rgba(34, 211, 238, 0.20)" : "none",
            }}
          >
            <span className="absolute left-1 top-0 -translate-y-full rounded border border-[#2a2e39] bg-[#1c2030]/95 px-1 text-[9px] font-bold text-[#67e8f9]">
              OTE 0.62-0.79
            </span>
          </div>
        ))}

        {ictIfvgBands.map(({ signal, left, width, top, height, selected }) => (
          <div
            key={`${signal.id}:ict-ifvg-band`}
            className="pointer-events-none absolute z-[8] rounded-sm border"
            style={{
              left,
              width,
              top,
              height,
              borderColor: selected ? "rgba(225, 190, 231, 0.95)" : "rgba(225, 190, 231, 0.7)",
              backgroundColor: selected ? "rgba(225, 190, 231, 0.2)" : "rgba(225, 190, 231, 0.1)",
              boxShadow: selected ? "0 0 0 1px rgba(225, 190, 231, 0.18)" : "none",
            }}
          >
            <span className="absolute left-1 top-0 -translate-y-full rounded border border-[#2a2e39] bg-[#1c2030]/95 px-1 text-[9px] font-bold text-[#E1BEE7]">
              IFVG {signal.ictIfvgReversal?.sessionName}
            </span>
          </div>
        ))}


        {analysisZone && candleReading ? (
          <div
            className="pointer-events-none absolute bottom-7 top-0 z-10 border-x border-[#00b0ff]/30 bg-[#00b0ff]/5"
            style={{ left: analysisZone.left, width: analysisZone.width }}
          >
            <span className="absolute right-full top-1 mr-1 hidden whitespace-nowrap bg-[#1c2030]/90 px-1.5 py-0.5 text-[10px] font-semibold text-[#cbd5e1] border border-[#2a2e39] rounded sm:block">
              Last {candleReading.analyzedCandleCount} closed candles
            </span>
          </div>
        ) : null}

        {candleReading ? (
          <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[190px] border border-[#2a2e39] bg-[#1c2030]/95 px-3 py-2 shadow-lg sm:max-w-[220px] rounded">
            <div className="flex items-center gap-2">
              {candleReading.reversalWarning.reversalRisk === "HIGH" ? (
                <span
                  aria-label="High reversal risk"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#ef5350] text-xs font-bold text-white"
                >
                  !
                </span>
              ) : null}
              <span className="text-xs font-semibold text-white">
                Scenario: {formatLabel(candleReading.scenarios.expectedBias)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-[#cbd5e1]">
              Latest close {candleReading.latestCandle.closeStrength.toLowerCase()} | confidence {candleReading.scores.confidence.score}/10
            </p>
          </div>
        ) : null}

        {loading ? (
          <StateOverlay title="Loading candles" compact={hasRenderedCandles} />
        ) : chartDataPending ? (
          <StateOverlay title="Drawing chart" compact={hasRenderedCandles} />
        ) : error ? (
          <StateOverlay title="Fetch failed" detail={error} compact={hasRenderedCandles} />
        ) : hasFetched && candles.length === 0 ? (
          <StateOverlay title="No candles returned" />
        ) : !hasFetched ? (
          <StateOverlay title="Ready" />
        ) : null}
      </div>
    </section>
  );
}

export const CandlestickChart = memo(CandlestickChartComponent);

function StateOverlay({
  title,
  detail,
  compact = false,
}: {
  title: string;
  detail?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="absolute right-4 top-4 z-30 max-w-sm border border-[#2a2e39] bg-[#1c2030]/95 px-4 py-3 text-left shadow-lg rounded">
        <p className="text-sm font-semibold text-white">{title}</p>
        {detail ? <p className="mt-1 text-xs text-red-400">{detail}</p> : null}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#131722]/85 px-6 text-center backdrop-blur-[2px]">
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        {detail ? <p className="mt-2 text-xs text-red-400">{detail}</p> : null}
      </div>
    </div>
  );
}

function buildAsianRangeTooltipHtml(signal: TradeSignal): string {
  const range = signal.asianRange;
  if (!range) return "";
  const warnings = range.warnings.map(formatRangeWarningLabel);
  const warningHtml = warnings.length
    ? `<div style="margin-top: 4px; color: #fbbf24; font-size: 10px; line-height: 1.2;">${warnings.join(", ")}</div>`
    : "";

  return `
    <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1);">
      <div style="font-weight: bold; margin-bottom: 4px;">Asian Range ${range.rangeType}</div>
      ${tooltipRow("High", formatPrice(range.high))}
      ${tooltipRow("Low", formatPrice(range.low))}
      ${tooltipRow("Mid", formatPrice(range.midpoint))}
      ${tooltipRow("Size", formatPrice(range.rangeSize))}
      ${tooltipRow("Coverage", `${Math.round(range.coverageRatio * 100)}%`)}
      ${warningHtml}
    </div>
  `;
}

function tooltipRow(label: string, value: string): string {
  return `<div style="display: flex; justify-content: space-between; gap: 12px; margin-bottom: 2px;"><span>${label}:</span><span>${value}</span></div>`;
}

function formatRangeWarningLabel(warning: string): string {
  return warning.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 5,
  }).format(value);
}

function formatChartTime(time: Time): string {
  if (typeof time === "number") {
    return new Date(time * 1000).toISOString().replace("T", " ").slice(0, 16);
  }

  if (typeof time === "string") {
    return time;
  }

  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(
    time.day,
  ).padStart(2, "0")}`;
}

function isTooltipCandle(value: unknown): value is Omit<TooltipCandle, "time"> {
  return (
    typeof value === "object" &&
    value !== null &&
    "open" in value &&
    "high" in value &&
    "low" in value &&
    "close" in value &&
    typeof value.open === "number" &&
    typeof value.high === "number" &&
    typeof value.low === "number" &&
    typeof value.close === "number"
  );
}

function getMarkerPriority(marker: SeriesMarker<Time>): number {
  const text = marker.text || "";
  if (text.includes("BUY") || text.includes("SELL")) {
    if (text.includes("RAPID")) return 5;
    return 4;
  }
  if (text.includes("BOS") || text.includes("CHOCH") || text.includes("MSS") || text.includes("STRUCTURE")) {
    return 3;
  }
  if (text.includes("SSL") || text.includes("BSL")) {
    return 2;
  }
  if (text.includes("B") || text.includes("S")) {
    return 1;
  }
  return 0;
}

function filterOverlappingMarkers(markers: SeriesMarker<Time>[]): SeriesMarker<Time>[] {
  const timeMap = new Map<Time, SeriesMarker<Time>>();
  for (const m of markers) {
    const existing = timeMap.get(m.time);
    if (!existing) {
      timeMap.set(m.time, m);
    } else {
      const existingPri = getMarkerPriority(existing);
      const mPri = getMarkerPriority(m);
      if (mPri > existingPri) {
        timeMap.set(m.time, m);
      }
    }
  }
  return Array.from(timeMap.values()).sort(sortSeriesMarkers);
}

function toSeriesMarker(marker: MarketMarker): SeriesMarker<Time> {
  const time = Math.floor(marker.timestamp / 1000) as UTCTimestamp;
  let size = 1.5;
  if (marker.type === "BUYERS" || marker.type === "SELLERS") {
    size = 1.0;
  } else if (marker.type === "BOS" || marker.type === "CHOCH" || marker.type === "MSS") {
    size = 2.0;
  } else if (marker.type === "SSL_SWEEP" || marker.type === "BSL_SWEEP") {
    size = 1.5;
  }

  const shared = {
    id: marker.id,
    time,
    color: markerColor(marker),
    shape: markerShape(marker),
    size,
    text: markerText(marker),
  };

  if (
    marker.type === "SWING_HIGH" ||
    marker.type === "BSL_SWEEP" ||
    marker.type === "SELLERS" ||
    (marker.type === "BOS" && marker.direction === "BEARISH") ||
    (marker.type === "CHOCH" && marker.direction === "BEARISH")
  ) {
    return {
      ...shared,
      position: "aboveBar" as const,
    };
  }

  if (
    marker.type === "SWING_LOW" ||
    marker.type === "SSL_SWEEP" ||
    marker.type === "BUYERS" ||
    (marker.type === "BOS" && marker.direction === "BULLISH") ||
    (marker.type === "CHOCH" && marker.direction === "BULLISH")
  ) {
    return {
      ...shared,
      position: "belowBar" as const,
    };
  }

  return {
    ...shared,
    position: "inBar" as const,
  };
}

function toSignalSeriesMarker(signal: TradeSignal, selected: boolean): SeriesMarker<Time> {
  const bullish = signal.direction === "BULLISH";
  const followLabel = signal.followThrough?.chartOverlay.markerLabel;
  const followColor = signal.followThrough?.chartOverlay.markerColor;
  const withMacro = (label: string) => {
    const macro = macroMarkerLabel(signal);
    return macro ? `${label} ${macro}` : label;
  };
  if (isInstitutionalSignal(signal)) {
    return {
      id: signal.id,
      time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: selected ? "#fde68a" : followColor ?? "#fbbf24",
      shape: bullish ? "arrowUp" as const : "arrowDown" as const,
      text: withMacro(followLabel ? `${signal.action} ${followLabel}` : `${signal.action} ${signal.factorScore}/6 ${signal.rr.toFixed(1)}R`),
      size: selected ? 4 : 3.5,
    };
  }
  if (isMasterSignal(signal)) {
    return {
      id: signal.id,
      time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: selected ? "#fde68a" : followColor ?? "#fbbf24",
      shape: bullish ? "arrowUp" as const : "arrowDown" as const,
      text: withMacro(followLabel ? `MASTER ${followLabel}` : `MASTER ${signal.action} C${signal.confluenceCount} S${signal.masterScore.toFixed(0)}`),
      size: selected ? 4 : 3.5,
    };
  }
  if (signal.masterDisplayStatus === "SUPPRESSED") {
    return {
      id: signal.id,
      time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: "#64748b",
      shape: "circle" as const,
      text: "Suppressed",
      size: 1.5,
    };
  }
  if (signal.strategyId === "ASIAN_RANGE_BREAKOUT_RETEST") {
    return {
      id: signal.id,
      time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: selected ? "#00b0ff" : followColor ?? (bullish ? "#ff6b35" : "#e91e63"),
      shape: "circle" as const,
      text: withMacro(followLabel ?? `BO ${bullish ? "BUY" : "SELL"} ${signal.rr.toFixed(1)}R`),
      size: selected ? 3.0 : 2.5,
    };
  }
  if (signal.strategyId === "ICT_SILVER_BULLET") {
    return {
      id: signal.id,
      time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: selected ? "#00b0ff" : followColor ?? (bullish ? "#22d3ee" : "#fb7185"),
      shape: bullish ? "arrowUp" as const : "arrowDown" as const,
      text: withMacro(followLabel ?? `SB ${bullish ? "BUY" : "SELL"} ${signal.rr.toFixed(1)}R S${signal.score}`),
      size: selected ? 3.0 : 2.5,
    };
  }
  if (signal.strategyId === "FVG_CONTINUATION_ENTRY") {
    return {
      id: signal.id,
      time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: selected ? "#00b0ff" : followColor ?? (bullish ? "#38bdf8" : "#fb7185"),
      shape: bullish ? "arrowUp" as const : "arrowDown" as const,
      text: withMacro(followLabel ?? `FVG ${bullish ? "BUY" : "SELL"} ${signal.rr.toFixed(1)}R S${signal.score}`),
      size: selected ? 3.0 : 2.5,
    };
  }
  if (signal.strategyId === "PRO_LIQUIDITY_CONFLUENCE_ENGINE") {
    return {
      id: signal.id,
      time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: selected ? "#00b0ff" : followColor ?? (bullish ? "#34d399" : "#fb7185"),
      shape: bullish ? "arrowUp" as const : "arrowDown" as const,
      text: withMacro(followLabel ?? `PLC ${bullish ? "BUY" : "SELL"} ${signal.rr.toFixed(1)}R S${signal.proLiquidityConfluence?.confluence.score ?? signal.score}`),
      size: selected ? 3.0 : 2.5,
    };
  }
  if (signal.strategyId === "STOCK_GURU_SWEEP_FVG_OB_ENGINE") {
    return {
      id: signal.id,
      time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: selected ? "#00b0ff" : followColor ?? (bullish ? "#facc15" : "#f97316"),
      shape: bullish ? "arrowUp" as const : "arrowDown" as const,
      text: withMacro(followLabel ?? `SG ${bullish ? "BUY" : "SELL"} ${signal.rr.toFixed(1)}R S${signal.score}`),
      size: selected ? 3.0 : 2.5,
    };
  }
  if (signal.strategyId === "TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE") {
    return {
      id: signal.id,
      time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: selected ? "#00b0ff" : followColor ?? (bullish ? "#22d3ee" : "#06b6d4"),
      shape: bullish ? "arrowUp" as const : "arrowDown" as const,
      text: withMacro(followLabel ?? `TJR ${bullish ? "BUY" : "SELL"} ${signal.rr.toFixed(1)}R S${signal.score}`),
      size: selected ? 3.0 : 2.5,
    };
  }
  if (signal.strategyId === "ICT_OTE_CONTINUATION_ENGINE") {
    return {
      id: signal.id,
      time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: selected ? "#00b0ff" : followColor ?? (bullish ? "#22d3ee" : "#fb7185"),
      shape: bullish ? "arrowUp" as const : "arrowDown" as const,
      text: withMacro(followLabel ?? `OTE ${bullish ? "BUY" : "SELL"} ${signal.rr.toFixed(1)}R S${signal.ictOteContinuation?.confluence.score ?? signal.score}`),
      size: selected ? 3.0 : 2.5,
    };
  }
  if (signal.strategyId === "EMA_TREND_PULLBACK") {
    return {
      id: signal.id,
      time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: selected ? "#00b0ff" : followColor ?? (bullish ? "#14b8a6" : "#f43f5e"),
      shape: bullish ? "arrowUp" as const : "arrowDown" as const,
      text: withMacro(followLabel ?? `EMA ${bullish ? "BUY" : "SELL"} ${signal.rr.toFixed(1)}R S${signal.score}`),
      size: selected ? 3.0 : 2.5,
    };
  }
  if (signal.strategyId === "LIQUIDITY_SWEEP_REVERSAL_PRO") {
    return {
      id: signal.id,
      time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: selected ? "#00b0ff" : followColor ?? (bullish ? "#38bdf8" : "#fb7185"),
      shape: bullish ? "arrowUp" as const : "arrowDown" as const,
      text: withMacro(followLabel ?? `LS ${bullish ? "BUY" : "SELL"} ${signal.rr.toFixed(1)}R S${signal.score}`),
      size: selected ? 3.0 : 2.5,
    };
  }
  const rapid = signal.type.startsWith("RAPID");
  return {
    id: signal.id,
    time: Math.floor(signal.timestamp / 1000) as UTCTimestamp,
    position: bullish ? "belowBar" as const : "aboveBar" as const,
    color: selected ? "#00b0ff" : followColor ?? (bullish ? "#26a69a" : "#ef5350"),
    shape: bullish ? "arrowUp" as const : "arrowDown" as const,
    text: withMacro(followLabel ?? `${rapid ? "FAST " : ""}${signal.type} ${signal.rr.toFixed(1)}R`),
    size: selected ? 3.0 : 2.5,
  };
}

function macroMarkerLabel(signal: TradeSignal): string | null {
  const intermarket = signal.intermarket;
  if (!intermarket || intermarket.macroGrade === "UNKNOWN") return null;
  if (intermarket.macroGrade === "CONFLICT") return "Macro Conflict";
  return `${intermarket.macroGrade} Macro`;
}

function buildFollowThroughTooltipHtml(signal: TradeSignal): string {
  const follow = signal.followThrough;
  if (!follow) return "";
  const tooltip = follow.chartOverlay.tooltip;
  const obstacle = tooltip.nearestObstacle
    ? `${tooltip.nearestObstacle.type} ${tooltip.nearestObstacle.price.toFixed(2)} (${tooltip.nearestObstacle.distanceR.toFixed(1)}R)`
    : "None before target";
  const target = tooltip.target
    ? `${tooltip.target.type} ${tooltip.target.price.toFixed(2)} (${tooltip.target.distanceR.toFixed(1)}R)`
    : "No clean target";
  const warningHtml = tooltip.warnings.length
    ? `<div style="color:#fcd34d">Warnings: ${tooltip.warnings.join(", ")}</div>`
    : "";
  const avoidHtml = tooltip.avoidReason
    ? `<div style="color:#fda4af">Avoid reason: ${tooltip.avoidReason}</div>`
    : "";
  return `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:${follow.chartOverlay.markerColor};margin-bottom:4px">Signal Follow-Through ${follow.followThroughGrade} ${follow.moveProbability}%</div><div>Estimated follow-through probability: ${follow.moveProbability}%</div><div>Expected move: ${follow.expectedMoveSide}</div><div>Liquidity runway: ${follow.liquidityRunway.status} ${follow.liquidityRunway.cleanRoomR.toFixed(1)}R</div><div>Target: ${target}</div><div>Obstacle: ${obstacle}</div><div>Invalidation: ${follow.invalidationLevel.toFixed(2)}</div><div>Passed: ${tooltip.passedFactors.slice(0, 5).join(", ") || "None"}</div><div>Failed: ${tooltip.failedFactors.slice(0, 5).join(", ") || "None"}</div><div>Top reason: ${tooltip.topReason}</div>${avoidHtml}${warningHtml}</div>`;
}

function buildIntermarketTooltipHtml(signal: TradeSignal): string {
  const intermarket = signal.intermarket;
  if (!intermarket) return "";
  const warningHtml = intermarket.warnings.length
    ? `<div style="color:#fcd34d">Warnings: ${intermarket.warnings.join(", ")}</div>`
    : "";
  const blockHtml = intermarket.blockReason
    ? `<div style="color:#fda4af">Block: ${intermarket.blockReason}</div>`
    : "";

  return `<div class="chart-tooltip-signal" style="border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:6px;font-size:11px"><div style="font-weight:bold;color:#fbbf24;margin-bottom:4px">Macro Confirmation ${intermarket.macroGrade} ${intermarket.macroScore}/100</div><div>Gold bias: ${intermarket.goldBias}</div><div>DXY: ${intermarket.dxyConfirmation.status} (${intermarket.dxyConfirmation.reasonCode})</div><div>TNX: ${intermarket.tnxConfirmation.status} (${intermarket.tnxConfirmation.reasonCode})</div><div>FRED daily: ${intermarket.fredConfirmation.status} (${intermarket.fredConfirmation.reasonCode})</div>${blockHtml}${warningHtml}</div>`;
}

function isMasterSignal(signal: TradeSignal): signal is MasterFinalSignal {
  return "masterSignalId" in signal && typeof signal.masterSignalId === "string";
}

function isInstitutionalSignal(signal: TradeSignal): signal is InstitutionalMasterSignal {
  return "institutionalSignalId" in signal && typeof signal.institutionalSignalId === "string";
}

function toStrategyJourneyMarkers(signal: TradeSignal, selected: boolean): SeriesMarker<Time>[] {
  const bullish = signal.direction === "BULLISH";
  const markers: SeriesMarker<Time>[] = [];
  if (signal.breakout) {
    markers.push({
      id: `${signal.id}:breakout`,
      time: Math.floor(signal.breakout.timestamp / 1000) as UTCTimestamp,
      position: "inBar" as const,
      color: selected ? "#00b0ff" : "#f97316",
      shape: "square" as const,
      text: "BO",
      size: selected ? 2.2 : 1.8,
    });
  }
  if (signal.retest) {
    markers.push({
      id: `${signal.id}:retest`,
      time: Math.floor(signal.retest.timestamp / 1000) as UTCTimestamp,
      position: bullish ? "belowBar" as const : "aboveBar" as const,
      color: selected ? "#00b0ff" : "#f59e0b",
      shape: bullish ? "arrowUp" as const : "arrowDown" as const,
      text: "RT",
      size: selected ? 2.2 : 1.8,
    });
  }
  if (signal.silverBullet) {
    markers.push({ id: `${signal.id}:sweep`, time: Math.floor(signal.silverBullet.sweep.timestamp / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#06b6d4", shape: "circle", text: signal.silverBullet.sweep.type, size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:sb-reclaim`, time: Math.floor(signal.silverBullet.sweep.reclaimedAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#fbbf24", shape: "square", text: "RCL", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:sb-displacement`, time: Math.floor(signal.silverBullet.displacement.timestamp / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#22d3ee", shape: bullish ? "arrowUp" : "arrowDown", text: "DISP", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:sb-mss`, time: Math.floor(signal.silverBullet.structureShift.confirmedAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#38bdf8", shape: "square", text: signal.silverBullet.structureShift.type, size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:fvg`, time: Math.floor(signal.silverBullet.fvg.timestamp / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#f59e0b", shape: "square", text: "FVG", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:sb-fvg-retest`, time: Math.floor(signal.silverBullet.fvg.retestedAt / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: "#fbbf24", shape: "circle", text: "RT", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:sb-confirmation`, time: Math.floor(signal.silverBullet.confirmation.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#22c55e", shape: bullish ? "arrowUp" : "arrowDown", text: "CONF", size: selected ? 2.2 : 1.8 });
  }
  if (signal.fvgContinuation) {
    markers.push({ id: `${signal.id}:fvg-displacement`, time: Math.floor(signal.fvgContinuation.displacement.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#38bdf8", shape: bullish ? "arrowUp" : "arrowDown", text: "DISP", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:fvg-structure`, time: Math.floor(signal.fvgContinuation.structureBreak.confirmedAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#60a5fa", shape: "square", text: signal.fvgContinuation.structureBreak.type, size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:fvg-continuation-box`, time: Math.floor(signal.fvgContinuation.fvg.createdAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#38bdf8", shape: "square", text: "FVG", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:fvg-continuation-retest`, time: Math.floor(signal.fvgContinuation.retest.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: "#fbbf24", shape: "circle", text: "RT", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:fvg-continuation-confirmation`, time: Math.floor(signal.fvgContinuation.confirmation.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#22c55e", shape: bullish ? "arrowUp" : "arrowDown", text: "CONF", size: selected ? 2.2 : 1.8 });
  }
  if (signal.proLiquidityConfluence) {
    markers.push({ id: `${signal.id}:pro-sweep`, time: Math.floor(signal.proLiquidityConfluence.liquiditySweep.timestamp / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#34d399", shape: "circle", text: `${signal.proLiquidityConfluence.liquiditySweep.type}`, size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:pro-pressure`, time: Math.floor(signal.proLiquidityConfluence.displacement.timestamp / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : bullish ? "#22c55e" : "#fb7185", shape: bullish ? "arrowUp" : "arrowDown", text: bullish ? "BUYERS" : "SELLERS", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:pro-mss`, time: Math.floor(signal.proLiquidityConfluence.structureShift.confirmedAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#60a5fa", shape: "square", text: signal.proLiquidityConfluence.structureShift.type, size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:pro-zone`, time: Math.floor(signal.proLiquidityConfluence.entryZone.createdAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#10b981", shape: "square", text: signal.proLiquidityConfluence.entryZone.source, size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:pro-retest`, time: Math.floor(signal.proLiquidityConfluence.entryZone.retestedAt / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: "#fbbf24", shape: "circle", text: "RT", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:pro-confirmation`, time: Math.floor(signal.proLiquidityConfluence.confirmation.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#22c55e", shape: bullish ? "arrowUp" : "arrowDown", text: "CONF", size: selected ? 2.2 : 1.8 });
  }
  if (signal.stockGuruSweepFvgOb) {
    const snapshot = signal.stockGuruSweepFvgOb;
    if (snapshot.liquidity.sweepFound && snapshot.liquidity.sweepAt !== null && snapshot.liquidity.type) {
      markers.push({ id: `${signal.id}:sg-sweep`, time: Math.floor(snapshot.liquidity.sweepAt / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#facc15", shape: "circle", text: snapshot.liquidity.type, size: selected ? 2.2 : 1.8 });
    }
    if (snapshot.liquidity.reclaimAt !== null) {
      markers.push({ id: `${signal.id}:sg-reclaim`, time: Math.floor(snapshot.liquidity.reclaimAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#fbbf24", shape: "square", text: "RCL", size: selected ? 2.2 : 1.8 });
    }
    if (snapshot.displacement.candleTime !== null) {
      markers.push({ id: `${signal.id}:sg-displacement`, time: Math.floor(snapshot.displacement.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : bullish ? "#fde047" : "#fb923c", shape: bullish ? "arrowUp" : "arrowDown", text: "DISP", size: selected ? 2.2 : 1.8 });
    }
    if (snapshot.structure.confirmedAt !== null) {
      markers.push({ id: `${signal.id}:sg-structure`, time: Math.floor(snapshot.structure.confirmedAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#f59e0b", shape: "square", text: snapshot.structure.bosType ?? "BOS", size: selected ? 2.2 : 1.8 });
    }
    if (snapshot.fvg.createdAt !== null) {
      markers.push({ id: `${signal.id}:sg-fvg`, time: Math.floor(snapshot.fvg.createdAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#fde047", shape: "square", text: "FVG", size: selected ? 2.2 : 1.8 });
    }
    if (snapshot.orderBlock.createdAt !== null) {
      markers.push({ id: `${signal.id}:sg-ob`, time: Math.floor(snapshot.orderBlock.createdAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#f97316", shape: "square", text: "OB", size: selected ? 2.2 : 1.8 });
    }
    if (snapshot.selectedZone.retestedAt !== null) {
      markers.push({ id: `${signal.id}:sg-retest`, time: Math.floor(snapshot.selectedZone.retestedAt / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#fbbf24", shape: "circle", text: "RT", size: selected ? 2.2 : 1.8 });
    }
    if (snapshot.confirmation.candleTime !== null) {
      markers.push({ id: `${signal.id}:sg-confirmation`, time: Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : bullish ? "#22c55e" : "#fb7185", shape: bullish ? "arrowUp" : "arrowDown", text: "CONF", size: selected ? 2.2 : 1.8 });
    }
  }
  if (signal.tjrSimpleStructurePullback) {
    const snapshot = signal.tjrSimpleStructurePullback;
    if (snapshot.structureTime !== null) {
      markers.push({ id: `${signal.id}:tjr-structure`, time: Math.floor(snapshot.structureTime / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#38bdf8", shape: "square", text: snapshot.chochFound ? "CHOCH" : "BOS", size: selected ? 2.2 : 1.8 });
    }
    if (snapshot.zoneCreatedAt !== null) {
      markers.push({ id: `${signal.id}:tjr-zone`, time: Math.floor(snapshot.zoneCreatedAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#06b6d4", shape: "square", text: snapshot.selectedZoneType ?? "ZONE", size: selected ? 2.2 : 1.8 });
    }
    if (snapshot.retestAt !== null) {
      markers.push({ id: `${signal.id}:tjr-retest`, time: Math.floor(snapshot.retestAt / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: "#fbbf24", shape: "circle", text: "RT", size: selected ? 2.2 : 1.8 });
    }
    if (snapshot.confirmationAt !== null) {
      markers.push({ id: `${signal.id}:tjr-confirmation`, time: Math.floor(snapshot.confirmationAt / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : bullish ? "#22c55e" : "#fb7185", shape: bullish ? "arrowUp" : "arrowDown", text: "CONF", size: selected ? 2.2 : 1.8 });
    }
  }
  if (signal.ictOteContinuation) {
    const snapshot = signal.ictOteContinuation;
    markers.push({ id: `${signal.id}:ote-impulse`, time: Math.floor(snapshot.impulse.endTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#22d3ee", shape: bullish ? "arrowUp" : "arrowDown", text: "IMP", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:ote-structure`, time: Math.floor(snapshot.structureBreak.confirmedAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#60a5fa", shape: "square", text: snapshot.structureBreak.type, size: selected ? 2.2 : 1.8 });
    if (snapshot.liquiditySweep.found && snapshot.liquiditySweep.timestamp !== null) markers.push({ id: `${signal.id}:ote-sweep`, time: Math.floor(snapshot.liquiditySweep.timestamp / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: "#34d399", shape: "circle", text: snapshot.liquiditySweep.type ?? "SWP", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:ote-zone`, time: Math.floor(snapshot.impulse.endTime / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#06b6d4", shape: "square", text: "OTE", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:ote-touch`, time: Math.floor(snapshot.ote.touchedAt / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: "#fbbf24", shape: "circle", text: "OTE RT", size: selected ? 2.2 : 1.8 });
    if (snapshot.ote.confluence.length) markers.push({ id: `${signal.id}:ote-confluence`, time: Math.floor(snapshot.ote.touchedAt / 1000) as UTCTimestamp, position: "inBar", color: "#a78bfa", shape: "square", text: snapshot.ote.confluence.join("+"), size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:ote-pressure`, time: Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: bullish ? "#22c55e" : "#fb7185", shape: bullish ? "arrowUp" : "arrowDown", text: snapshot.confirmation.pressure, size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:ote-confirmation`, time: Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#22d3ee", shape: bullish ? "arrowUp" : "arrowDown", text: "CONF", size: selected ? 2.2 : 1.8 });
  }
  if (signal.ictIfvgReversal) {
    const snapshot = signal.ictIfvgReversal;
    markers.push({ id: `${signal.id}:ifvg-displacement`, time: Math.floor(snapshot.displacement.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#E1BEE7", shape: bullish ? "arrowUp" : "arrowDown", text: "DISP", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:ifvg-structure`, time: Math.floor(snapshot.structureBreak.confirmedAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#60a5fa", shape: "square", text: snapshot.structureBreak.type, size: selected ? 2.2 : 1.8 });
    if (snapshot.liquiditySweep.found && snapshot.liquiditySweep.timestamp !== null) markers.push({ id: `${signal.id}:ifvg-sweep`, time: Math.floor(snapshot.liquiditySweep.timestamp / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: "#34d399", shape: "circle", text: snapshot.liquiditySweep.type ?? "SWP", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:ifvg-zone`, time: Math.floor(snapshot.ifvgZone.createdAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#E1BEE7", shape: "square", text: "IFVG", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:ifvg-retest`, time: Math.floor(snapshot.retest.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: "#fbbf24", shape: "circle", text: "RT", size: selected ? 2.2 : 1.8 });
    if (snapshot.confirmation.pressure) {
      markers.push({ id: `${signal.id}:ifvg-pressure`, time: Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : bullish ? "#22c55e" : "#fb7185", shape: bullish ? "arrowUp" : "arrowDown", text: snapshot.confirmation.pressure, size: selected ? 2.2 : 1.8 });
    }
    markers.push({ id: `${signal.id}:ifvg-confirmation`, time: Math.floor(snapshot.confirmation.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#22c55e", shape: bullish ? "arrowUp" : "arrowDown", text: "CONF", size: selected ? 2.2 : 1.8 });
  }

  if (signal.vwapEma) {
    markers.push({ id: `${signal.id}:pullback`, time: Math.floor(signal.vwapEma.pullback.pullbackStartedAt / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#a78bfa", shape: "circle", text: signal.vwapEma.pullback.touchedEma, size: selected ? 2.2 : 1.8 });
  }
  if (signal.emaTrendPullback) {
    markers.push({ id: `${signal.id}:ema-pullback`, time: Math.floor(signal.emaTrendPullback.pullback.pullbackStartedAt / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#14b8a6", shape: "circle", text: signal.emaTrendPullback.pullback.touchedEma, size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:ema-confirmation`, time: Math.floor(signal.emaTrendPullback.confirmation.candleTime / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#5eead4", shape: "square", text: "CONF", size: selected ? 2.2 : 1.8 });
  }
  if (signal.liquiditySweepReversal) {
    markers.push({ id: `${signal.id}:liquidity`, time: Math.floor(signal.liquiditySweepReversal.sweep.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : bullish ? "#38bdf8" : "#fb7185", shape: "circle", text: signal.liquiditySweepReversal.liquidity.type, size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:reclaim`, time: Math.floor(signal.liquiditySweepReversal.sweep.reclaimedAt / 1000) as UTCTimestamp, position: "inBar", color: selected ? "#00b0ff" : "#fbbf24", shape: "square", text: "RCL", size: selected ? 2.2 : 1.8 });
    markers.push({ id: `${signal.id}:liquidity-confirmation`, time: Math.floor(signal.liquiditySweepReversal.confirmation.candleTime / 1000) as UTCTimestamp, position: bullish ? "belowBar" : "aboveBar", color: selected ? "#00b0ff" : "#fb7185", shape: bullish ? "arrowUp" : "arrowDown", text: "CONF", size: selected ? 2.2 : 1.8 });
  }
  return markers;
}

function sortSeriesMarkers(a: SeriesMarker<Time>, b: SeriesMarker<Time>): number {
  const timeA = typeof a.time === "number" ? a.time : 0;
  const timeB = typeof b.time === "number" ? b.time : 0;
  return timeA - timeB;
}

function markerColor(marker: MarketMarker): string {
  if (marker.type === "BUYERS" || marker.direction === "BULLISH") {
    return "#26a69a";
  }

  if (marker.type === "SELLERS" || marker.direction === "BEARISH") {
    return "#ef5350";
  }

  if (marker.type === "FVG") {
    return "#ab47bc";
  }

  return "#787b86";
}

function markerShape(marker: MarketMarker): SeriesMarker<Time>["shape"] {
  if (marker.type === "SWING_HIGH" || marker.type === "SWING_LOW" || marker.type === "BUYERS" || marker.type === "SELLERS") {
    return "circle" as const;
  }

  if (marker.type === "SSL_SWEEP") {
    return "arrowUp" as const;
  }

  if (marker.type === "BSL_SWEEP") {
    return "arrowDown" as const;
  }

  return "square" as const;
}

function markerText(marker: MarketMarker): string {
  if (marker.type === "MOMENTUM" || marker.type === "DISPLACEMENT") {
    return marker.direction === "BULLISH" ? "M+" : "M-";
  }

  if (marker.type === "SWING_HIGH") {
    return "SH";
  }

  if (marker.type === "SWING_LOW") {
    return "SL";
  }

  return marker.type;
}

function setupOverlayColor(setup: MarketSetup): string {
  if (setup.state === "INVALIDATED") return "#dc2626";
  if (setup.state === "EXPIRED") return "#64748b";
  if (setup.state === "TRIGGER") return setup.direction === "BULLISH" ? "#047857" : "#b91c1c";
  if (setup.state === "SETUP") return "#0891b2";
  return "#b45309";
}

function setupOverlayFill(setup: MarketSetup): string {
  if (setup.state === "INVALIDATED") return "rgba(254, 202, 202, 0.12)";
  if (setup.state === "EXPIRED") return "rgba(203, 213, 225, 0.10)";
  if (setup.state === "TRIGGER") return setup.direction === "BULLISH" ? "rgba(167, 243, 208, 0.20)" : "rgba(254, 202, 202, 0.20)";
  if (setup.state === "SETUP") return "rgba(165, 243, 252, 0.14)";
  return "rgba(253, 230, 138, 0.08)";
}

function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function uniqueSignals(signals: TradeSignal[]): TradeSignal[] {
  const byId = new Map<string, TradeSignal>();
  for (const signal of signals) byId.set(signal.id, signal);
  return [...byId.values()];
}

function computeHeikinAshi(candles: CandlestickData<Time>[]): CandlestickData<Time>[] {
  if (candles.length === 0) return [];
  const haCandles: CandlestickData<Time>[] = [];
  let prevOpen = candles[0].open;
  let prevClose = candles[0].close;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = i === 0 ? (c.open + c.close) / 2 : (prevOpen + prevClose) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);

    haCandles.push({
      time: c.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
    });

    prevOpen = haOpen;
    prevClose = haClose;
  }
  return haCandles;
}

function getChartBodySize(element: HTMLDivElement | null): { width: number; height: number } {
  if (!element) return { width: 0, height: 0 };
  const rect = element.getBoundingClientRect();
  return {
    width: rect.width || element.clientWidth || 0,
    height: rect.height || element.clientHeight || 450,
  };
}
