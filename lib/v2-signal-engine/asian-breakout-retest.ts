import type { Candle } from "../candles/types";
import type {
  EntryEngineResult,
  NoRepaintProof,
  RejectedSetup,
  SignalCandidateDebug,
  SignalRejectionCode,
  SignalScoreBreakdown,
  StopLossResult,
  TakeProfitResult,
  TradeSignal,
  V2AsianRangeSnapshot,
  V2AsianRangeWarningCode,
  V2ConfirmationSnapshot,
  V2GoldmineScoreBreakdown,
} from "../entry-engine/types";
import type { TradingSession } from "../market-context/types";
import {
  ACTIVE_SIGNAL_ENGINE,
  BREAKOUT_STRATEGY_ID,
  BREAKOUT_STRATEGY_LABEL,
  ASIAN_BREAKOUT_CONFIG,
  UTC_SESSIONS,
} from "./config";
import type {
  GoldmineAsianRange,
  V2GoldmineInput,
  V2GoldmineSettings,
  V2AsianBreakoutRejectedCandidate,
} from "./types";
import { calculateAsianRanges } from "./goldmine-asian-sweep";

const DEFAULT_SETTINGS: V2GoldmineSettings = {
  maxRiskAmount: 100,
  atrPeriod: 14,
  stopAtrBufferMultiplier: 0.10,
};

const resultCache = new Map<string, EntryEngineResult>();
type DebugWindow = Window & { DEBUG_GOLDMINE?: boolean };

export function clearV2AsianBreakoutCache(): void {
  resultCache.clear();
}

export function generateV2AsianBreakoutSignals(input: V2GoldmineInput): EntryEngineResult {
  const started = performance.now();
  const settings = { ...DEFAULT_SETTINGS, ...input.settings };
  const config = ASIAN_BREAKOUT_CONFIG;
  const candles = input.candles.filter((candle) => candle.isClosed);
  const cacheKey = buildCacheKey(input, candles, settings);
  const cached = resultCache.get(cacheKey);
  if (cached) return cloneResult(cached, "hit");

  const atr = calculateAtrSeries(candles, settings.atrPeriod);
  const asianRanges = calculateAsianRanges(candles, atr, input.timeframe, settings);
  const rejectedCandidates: V2AsianBreakoutRejectedCandidate[] = [];
  const candidateDebug: SignalCandidateDebug[] = [];
  const signalsById = new Map<string, TradeSignal>();

  let bullishBreakouts = 0;
  let bearishBreakouts = 0;
  let retestsFound = 0;
  let retestsFailed = 0;
  let confirmationsFound = 0;
  let confirmationsExpired = 0;

  for (const range of asianRanges) {
    if (!range.valid) {
      const reason = range.invalidReason ?? "Not enough range data to calculate usable Asian/fallback range.";
      const code = range.invalidCode ?? "NO_USABLE_RANGE";
      const setupId = `breakout:${range.date}:invalid-asian-range`;
      rejectedCandidates.push({
        id: setupId,
        code,
        reason,
        date: range.date,
        direction: "NONE",
        stage: "REJECTED",
        failedStage: code,
        candleIndex: null,
        timestamp: null,
      });
      candidateDebug.push({
        setupId,
        engine: "V2_GOLDMINE",
        strategyId: BREAKOUT_STRATEGY_ID,
        setupScore: 0,
        requiredSetupScore: 0,
        finalSignalScore: null,
        requiredSignalScore: config.minSignalScore,
        confirmationStatus: "REJECTED",
        confirmationWindowRemaining: 0,
        rejectionReason: reason,
        nextRequiredAction: "Load enough pre-scan candles to build a complete, partial, or fallback range.",
        failedStage: code,
        asianRangeDate: range.date,
      });
      logBreakoutStage(range.date ? `${range.date}T00:00:00.000Z` : "unknown", false, code, reason);
      continue;
    }

    logBreakoutStage(
      new Date(range.sessionEnd).toISOString(),
      true,
      "ASIAN_RANGE",
      `Valid Asian range: date=${range.date}, high=${range.high}, low=${range.low}`
    );

    const tradingIndexes = indexesForTradingDay(candles, range, settings);
    let signalsToday = 0;

    for (let i = 0; i < tradingIndexes.length; i++) {
      const breakoutIndex = tradingIndexes[i];
      const candle = candles[breakoutIndex];
      const session = tradingSessionAt(candle.timestamp, settings);
      if (!session) continue;

      if (signalsToday >= config.maxSignalsPerDay) {
        break;
      }

      // Check breakout close
      const currentAtr = atr[breakoutIndex];
      const isBullishBreakout = candle.close > range.high + currentAtr * config.breakoutCloseBufferAtr;
      const isBearishBreakout = candle.close < range.low - currentAtr * config.breakoutCloseBufferAtr;

      if (!isBullishBreakout && !isBearishBreakout) {
        continue;
      }

      const direction: "BUY" | "SELL" = isBullishBreakout ? "BUY" : "SELL";
      const bias = direction === "BUY" ? "BULLISH" : "BEARISH";
      const setupId = `breakout:${range.date}:${direction}:${breakoutIndex}`;

      if (isBullishBreakout) bullishBreakouts++;
      else bearishBreakouts++;

      logBreakoutStage(
        new Date(candle.timestamp).toISOString(),
        true,
        "BREAKOUT_DETECTED",
        `Breakout detected on index ${breakoutIndex}: ${direction}`
      );

      // Check breakout candle momentum
      const body = Math.abs(candle.close - candle.open);
      const candleRange = candle.high - candle.low;
      const bodyRatio = candleRange > 0 ? body / candleRange : 0;
      const closePosition = candleRange > 0 ? (candle.close - candle.low) / candleRange : 0;

      const bodyRatioPassed = bodyRatio >= config.breakoutBodyMinRatio;
      const closePositionPassed = direction === "BUY" ? closePosition >= 0.60 : closePosition <= 0.40;

      if (!bodyRatioPassed || !closePositionPassed) {
        const reason = `Weak breakout momentum. body/range=${bodyRatio.toFixed(2)} (req >= ${config.breakoutBodyMinRatio}), closePosition=${closePosition.toFixed(2)}`;
        rejectedCandidates.push({
          id: setupId,
          code: "WEAK_BREAKOUT_MOMENTUM",
          reason,
          date: range.date,
          direction,
          stage: "REJECTED",
          failedStage: "WEAK_BREAKOUT_MOMENTUM",
          candleIndex: breakoutIndex,
          timestamp: candle.timestamp,
        });
        candidateDebug.push({
          setupId,
          engine: "V2_GOLDMINE",
          strategyId: BREAKOUT_STRATEGY_ID,
          setupScore: 0,
          requiredSetupScore: 0,
          finalSignalScore: null,
          requiredSignalScore: config.minSignalScore,
          confirmationStatus: "REJECTED",
          confirmationWindowRemaining: 0,
          rejectionReason: reason,
          nextRequiredAction: "Wait for stronger breakout candle.",
          failedStage: "WEAK_BREAKOUT_MOMENTUM",
          asianRangeDate: range.date,
        });
        logBreakoutStage(new Date(candle.timestamp).toISOString(), false, "WEAK_BREAKOUT_MOMENTUM", reason);
        continue;
      }

      // Scan for retest within retestWindowCandles
      let retestIndex = -1;
      let retestFailedDueToCloseInside = false;

      for (let j = 1; j <= config.retestWindowCandles; j++) {
        const checkIdx = breakoutIndex + j;
        if (checkIdx >= candles.length) break;
        const checkCandle = candles[checkIdx];

        // Retest holds check: price must not close back inside Asian range.
        if (direction === "BUY") {
          if (checkCandle.close < range.high) {
            retestFailedDueToCloseInside = true;
            break;
          }
        } else {
          if (checkCandle.close > range.low) {
            retestFailedDueToCloseInside = true;
            break;
          }
        }

        // Retest level touch check
        const targetLevel = direction === "BUY" ? range.high : range.low;
        const tolerance = atr[checkIdx] * config.retestToleranceAtr;
        if (direction === "BUY") {
          if (checkCandle.low <= targetLevel + tolerance) {
            retestIndex = checkIdx;
            break;
          }
        } else {
          if (checkCandle.high >= targetLevel - tolerance) {
            retestIndex = checkIdx;
            break;
          }
        }
      }

      if (retestFailedDueToCloseInside || retestIndex === -1) {
        retestsFailed++;
        const reason = retestFailedDueToCloseInside
          ? "Retest failed: candle closed back inside the Asian range."
          : `Retest not found within ${config.retestWindowCandles} candles.`;
        const code = retestFailedDueToCloseInside ? "RETEST_FAILED" : "RETEST_NOT_FOUND";
        rejectedCandidates.push({
          id: setupId,
          code,
          reason,
          date: range.date,
          direction,
          stage: "REJECTED",
          failedStage: code,
          candleIndex: breakoutIndex,
          timestamp: candle.timestamp,
        });
        candidateDebug.push({
          setupId,
          engine: "V2_GOLDMINE",
          strategyId: BREAKOUT_STRATEGY_ID,
          setupScore: 0,
          requiredSetupScore: 0,
          finalSignalScore: null,
          requiredSignalScore: config.minSignalScore,
          confirmationStatus: "REJECTED",
          confirmationWindowRemaining: 0,
          rejectionReason: reason,
          nextRequiredAction: "Wait for valid retest.",
          failedStage: code,
          asianRangeDate: range.date,
        });
        logBreakoutStage(new Date(candle.timestamp).toISOString(), false, code, reason);
        continue;
      }

      retestsFound++;
      logBreakoutStage(
        new Date(candles[retestIndex].timestamp).toISOString(),
        true,
        "RETEST_CONFIRMED",
        `Retest confirmed at index ${retestIndex}`
      );

      // Scan for confirmation candle within confirmationWindow
      let confirmIndex = -1;
      for (let j = 1; j <= config.confirmationWindow; j++) {
        const checkIdx = retestIndex + j;
        if (checkIdx >= candles.length) break;
        const checkCandle = candles[checkIdx];

        // Retest must continue to hold during confirmation search
        if (direction === "BUY") {
          if (checkCandle.close < range.high) break;
        } else {
          if (checkCandle.close > range.low) break;
        }

        const cBody = Math.abs(checkCandle.close - checkCandle.open);
        const cRange = checkCandle.high - checkCandle.low;
        const cBodyRatio = cRange > 0 ? cBody / cRange : 0;
        const cClosePos = cRange > 0 ? (checkCandle.close - checkCandle.low) / cRange : 0;

        const isDoji = cBodyRatio < 0.10;
        const correctDirection = direction === "BUY" ? checkCandle.close > checkCandle.open : checkCandle.close < checkCandle.open;
        const correctClosePos = direction === "BUY" ? cClosePos >= 0.60 : cClosePos <= 0.40;
        const correctBodyRatio = cBodyRatio >= 0.40;

        if (correctDirection && correctClosePos && correctBodyRatio && !isDoji) {
          confirmIndex = checkIdx;
          break;
        }
      }

      if (confirmIndex === -1) {
        confirmationsExpired++;
        const reason = `Confirmation did not appear within ${config.confirmationWindow} candles after retest.`;
        rejectedCandidates.push({
          id: setupId,
          code: "CONFIRMATION_EXPIRED",
          reason,
          date: range.date,
          direction,
          stage: "EXPIRED",
          failedStage: "CONFIRMATION_EXPIRED",
          candleIndex: breakoutIndex,
          timestamp: candle.timestamp,
        });
        candidateDebug.push({
          setupId,
          engine: "V2_GOLDMINE",
          strategyId: BREAKOUT_STRATEGY_ID,
          setupScore: 0,
          requiredSetupScore: 0,
          finalSignalScore: null,
          requiredSignalScore: config.minSignalScore,
          confirmationStatus: "EXPIRED_CONFIRMATION",
          confirmationWindowRemaining: 0,
          rejectionReason: reason,
          nextRequiredAction: "Wait for new breakout setup.",
          failedStage: "CONFIRMATION_EXPIRED",
          asianRangeDate: range.date,
        });
        logBreakoutStage(new Date(candles[retestIndex].timestamp).toISOString(), false, "CONFIRMATION_EXPIRED", reason);
        continue;
      }

      confirmationsFound++;
      const confirmCandle = candles[confirmIndex];

      // Calculate SL, Entry, TP, RR
      const entryPrice = confirmCandle.close;
      const retestLow = Math.min(...candles.slice(breakoutIndex + 1, confirmIndex + 1).map((c) => c.low));
      const retestHigh = Math.max(...candles.slice(breakoutIndex + 1, confirmIndex + 1).map((c) => c.high));

      const slPrice = direction === "BUY"
        ? Math.min(retestLow, range.high) - atr[confirmIndex] * config.atrBufferMultiplier
        : Math.max(retestHigh, range.low) + atr[confirmIndex] * config.atrBufferMultiplier;

      const riskPoints = Math.abs(entryPrice - slPrice);
      if (riskPoints <= 0) {
        const reason = "Stop Loss calculation yielded invalid risk points <= 0.";
        rejectedCandidates.push({
          id: setupId,
          code: "STOP_LOSS_INVALID",
          reason,
          date: range.date,
          direction,
          stage: "REJECTED",
          failedStage: "STOP_LOSS_INVALID",
          candleIndex: confirmIndex,
          timestamp: confirmCandle.timestamp,
        });
        logBreakoutStage(new Date(confirmCandle.timestamp).toISOString(), false, "STOP_LOSS_INVALID", reason);
        continue;
      }

      // Targets: Measured move, Liquidity BSL/SSL, Fallback 1.5R
      const rangeSize = range.high - range.low;
      const measuredMovePrice = direction === "BUY"
        ? range.high + rangeSize
        : range.low - rangeSize;

      let liquidityPrice: number | null = null;
      if (direction === "BUY") {
        const cleanBsl = input.structure.liquidityZones
          .filter((z) => z.type === "BSL" && !z.swept && z.price > entryPrice)
          .sort((a, b) => a.price - b.price)[0];
        if (cleanBsl) liquidityPrice = cleanBsl.price;
      } else {
        const cleanSsl = input.structure.liquidityZones
          .filter((z) => z.type === "SSL" && !z.swept && z.price < entryPrice)
          .sort((a, b) => b.price - a.price)[0];
        if (cleanSsl) liquidityPrice = cleanSsl.price;
      }

      const tp1Price = measuredMovePrice;
      const tp2Price = liquidityPrice;
      const fallbackPrice = direction === "BUY"
        ? entryPrice + 1.5 * riskPoints
        : entryPrice - 1.5 * riskPoints;

      let finalTp = tp1Price;
      let tpSource = "MEASURED_MOVE";

      const rrTp1 = Math.abs(tp1Price - entryPrice) / riskPoints;
      if (rrTp1 >= config.minRR) {
        finalTp = tp1Price;
        tpSource = "MEASURED_MOVE";
      } else if (tp2Price && (Math.abs(tp2Price - entryPrice) / riskPoints) >= config.minRR) {
        finalTp = tp2Price;
        tpSource = "LIQUIDITY";
      } else {
        finalTp = fallbackPrice;
        tpSource = "FIXED_FALLBACK";
      }

      const rewardPoints = Math.abs(finalTp - entryPrice);
      const rr = rewardPoints / riskPoints;

      if (rr + 1e-9 < config.minRR) {
        const reason = `Risk/Reward too low: ${rr.toFixed(2)}R (req >= ${config.minRR.toFixed(1)}R)`;
        rejectedCandidates.push({
          id: setupId,
          code: "RR_TOO_LOW",
          reason,
          date: range.date,
          direction,
          stage: "REJECTED",
          failedStage: "RR_TOO_LOW",
          candleIndex: confirmIndex,
          timestamp: confirmCandle.timestamp,
        });
        logBreakoutStage(new Date(confirmCandle.timestamp).toISOString(), false, "RR_TOO_LOW", reason);
        continue;
      }

      // Calculate Score
      const scoreResult = calculateScore({
        range,
        breakoutCandle: candle,
        retestCandle: candles[retestIndex],
        confirmCandle,
        rr,
        session,
        atr: currentAtr,
      });

      if (scoreResult.total < config.minSignalScore) {
        const reason = `Signal score too low: ${scoreResult.total} (req >= ${config.minSignalScore})`;
        rejectedCandidates.push({
          id: setupId,
          code: "SCORE_TOO_LOW",
          reason,
          date: range.date,
          direction,
          stage: "REJECTED",
          failedStage: "SCORE_TOO_LOW",
          candleIndex: confirmIndex,
          timestamp: confirmCandle.timestamp,
        });
        logBreakoutStage(new Date(confirmCandle.timestamp).toISOString(), false, "SCORE_TOO_LOW", reason);
        continue;
      }

      // Create confirmed signal
      const signalTimestamp = confirmCandle.timestamp;
      const signalId = [
        input.symbol.trim().toUpperCase(),
        input.timeframe,
        BREAKOUT_STRATEGY_ID,
        signalTimestamp,
        direction,
      ].join(":");

      if (signalsById.has(signalId)) {
        const reason = "Duplicate V2 Asian Breakout signal ID was prevented by the signal map.";
        rejectedCandidates.push({
          id: setupId,
          code: "DUPLICATE_SIGNAL",
          reason,
          date: range.date,
          direction,
          stage: "REJECTED",
          failedStage: "DUPLICATE_SIGNAL",
          candleIndex: confirmIndex,
          timestamp: confirmCandle.timestamp,
        });
        logBreakoutStage(new Date(confirmCandle.timestamp).toISOString(), false, "DUPLICATE_SIGNAL", reason);
        continue;
      }

      const maxEvidenceIndex = Math.max(...rangeIndexes(range), breakoutIndex, retestIndex, confirmIndex);
      const noRepaintPassed = maxEvidenceIndex <= confirmIndex && range.endIndex < breakoutIndex;
      const noRepaintProof: NoRepaintProof = {
        status: noRepaintPassed ? "PASS" : "WARNING",
        signalIndex: confirmIndex,
        latestAllowedCandleIndex: confirmIndex,
        usedMarkerIndexes: [...new Set([...rangeIndexes(range), breakoutIndex, retestIndex, confirmIndex])].sort((a, b) => a - b),
        usedContextCloseTimes: [],
        usedSetupId: setupId,
        passed: noRepaintPassed,
        lastAvailableIndex: confirmIndex,
        maxEvidenceIndex,
        message: noRepaintPassed
          ? `V2 breakout signal uses the ${range.rangeType.toLowerCase()} range and closed breakout, retest, and confirmation candles only.`
          : "V2 breakout signal attempted to use evidence after confirmation.",
      };
      const stopLossDetail: StopLossResult = {
        price: round(slPrice),
        source: "ASIAN_RETEST_LEVEL",
        buffer: round(atr[confirmIndex] * config.atrBufferMultiplier),
        riskPoints: round(riskPoints),
        reason: direction === "BUY"
          ? "BUY SL sits below the retest low or Asian high with an ATR buffer."
          : "SELL SL sits above the retest high or Asian low with an ATR buffer.",
      };
      const takeProfitDetail: TakeProfitResult = {
        tp1: round(finalTp),
        tp2: null,
        tp3: null,
        source: tpSource,
        rewardPoints: round(rewardPoints),
        reason: `TP1 uses ${tpSource.toLowerCase().replaceAll("_", " ")} for the Asian range breakout continuation.`,
      };
      const scoreBreakdown: SignalScoreBreakdown = {
        phase4Setup: scoreResult.asianRangeQuality,
        contextAlignment: scoreResult.breakoutQuality,
        confirmationCandle: scoreResult.breakoutMomentum + scoreResult.confirmationQuality,
        stopLossQuality: scoreResult.retestQuality,
        targetQuality: scoreResult.rrQuality,
        sessionQuality: scoreResult.sessionQuality,
        volatilityQuality: 0,
        antiReversal: 0,
      };
      const v2ScoreBreakdown: V2GoldmineScoreBreakdown = {
        asianRangeQuality: scoreResult.asianRangeQuality,
        sweepQuality: scoreResult.breakoutQuality,
        rejectionCandleQuality: scoreResult.breakoutMomentum,
        displacementMssQuality: scoreResult.retestQuality,
        confirmationCandleQuality: scoreResult.confirmationQuality,
        rrTargetQuality: scoreResult.rrQuality,
        sessionQuality: scoreResult.sessionQuality,
        volatilityQuality: 0,
      };
      const asianRange: V2AsianRangeSnapshot = {
        date: range.date,
        rangeType: range.rangeType,
        sessionStart: range.sessionStart,
        sessionEnd: range.sessionEnd,
        high: range.high,
        low: range.low,
        midpoint: range.midpoint,
        rangeSize: range.rangeSize,
        highTime: range.highTime,
        lowTime: range.lowTime,
        candlesCount: range.candlesCount,
        expectedCandles: range.expectedCandles,
        coverageRatio: range.coverageRatio,
        isComplete: range.isComplete,
        isPartial: range.isPartial,
        isFallback: range.isFallback,
        warnings: range.warnings,
        valid: range.valid,
        invalidCode: range.invalidCode,
        invalidReason: range.invalidReason,
      };
      const confirmation: V2ConfirmationSnapshot = {
        candleIndex: confirmIndex,
        timestamp: confirmCandle.timestamp,
        quality: scoreResult.confirmationQuality,
        reason: "Closed continuation confirmation candle after a held retest.",
        displacementType: "DISPLACEMENT",
        displacementIndex: breakoutIndex,
      };

      const newSignal: TradeSignal = {
        id: signalId,
        engine: ACTIVE_SIGNAL_ENGINE,
        strategyId: BREAKOUT_STRATEGY_ID,
        type: direction === "BUY" ? "CONFIRMED_BUY" : "CONFIRMED_SELL",
        direction: bias,
        v2Direction: direction,
        status: "CONFIRMED",
        sourceSetupId: setupId,
        setupType: "TREND_CONTINUATION",
        strategyModel: BREAKOUT_STRATEGY_LABEL,
        mode: "NORMAL_SCALP",
        timestamp: signalTimestamp,
        candleIndex: confirmIndex,
        confirmedAtIndex: confirmIndex,
        timeframe: input.timeframe,
        session,
        entryPrice: round(entryPrice),
        stopLoss: round(slPrice),
        takeProfit: round(finalTp),
        takeProfit2: tp2Price ? round(tp2Price) : null,
        takeProfit3: null,
        riskPoints: round(riskPoints),
        rewardPoints: round(rewardPoints),
        rr: round(rr),
        score: scoreResult.total,
        confidence: confidenceFor(scoreResult.total),
        positionSizeSuggestion: round(settings.maxRiskAmount / riskPoints, 4),
        maxRiskAmount: settings.maxRiskAmount,
        invalidationLevel: round(slPrice),
        reasons: [
          `${direction} breakout closed beyond the Asian ${direction === "BUY" ? "high" : "low"} during ${session}.`,
          `Retest held the broken Asian level within ${retestIndex - breakoutIndex} candles.`,
          confirmation.reason,
          stopLossDetail.reason,
          takeProfitDetail.reason,
        ],
        warnings: [
          ...range.warnings.map(rangeWarningMessage),
          ...(tpSource === "FIXED_FALLBACK" ? ["V2 breakout used the allowed fixed-R fallback target because measured move/liquidity did not qualify."] : []),
        ],
        rejectionReasons: [],
        relatedMarkers: [],
        noRepaintProof,
        stopLossDetail,
        takeProfitDetail,
        scoreBreakdown,
        v2ScoreBreakdown,
        asianRange,
        breakout: {
          candleIndex: breakoutIndex,
          timestamp: candle.timestamp,
          level: direction === "BUY" ? range.high : range.low,
          direction: bias,
          close: candle.close,
          atr: currentAtr,
          momentumRatio: bodyRatio,
        },
        retest: {
          candleIndex: retestIndex,
          timestamp: candles[retestIndex].timestamp,
          extremePrice: direction === "BUY" ? candles[retestIndex].low : candles[retestIndex].high,
          retestDelay: retestIndex - breakoutIndex,
        },
        confirmation: {
          ...confirmation,
        },
        immutable: true,
      };

      signalsById.set(signalId, newSignal);
      signalsToday++;

      logBreakoutStage(
        new Date(confirmCandle.timestamp).toISOString(),
        true,
        "CONFIRMED_SIGNAL",
        `Created breakout signal ${signalId} with ${rr.toFixed(2)}R, score ${scoreResult.total}`
      );
    }
  }

  const signals = [...signalsById.values()].sort((a, b) => a.confirmedAtIndex - b.confirmedAtIndex);
  const signalMap = new Map(signals.map((s) => [s.id, s]));
  const topRejectionReasons = topReasons(rejectedCandidates);
  const generationTimeMs = round(performance.now() - started, 2);
  const rangeAudit = rangeAuditCounts(asianRanges, signals, rejectedCandidates);
  candidateDebug.splice(
    0,
    candidateDebug.length,
    ...rejectedCandidates.map((candidate) => candidateDebugFromBreakoutRejection(candidate, config.minSignalScore, config.minRR)),
  );

  const result: EntryEngineResult = {
    signals,
    activeSignals: signals,
    signalMap,
    pendingCandidates: [],
    candidateDebug,
    rejectedSetups: rejectedCandidates.map((candidate) => rejectedSetupFromCandidate(candidate, config.minSignalScore, config.minRR)),
    noTrade: signals.length === 0 ? {
      status: "NO_TRADE" as const,
      checkedSetups: bullishBreakouts + bearishBreakouts,
      rejectionReasons: rejectedCandidates.map((c) => c.reason),
      message: "No V2 Breakout signals found.",
      nearestPossibleSetup: null,
      requiredForSignal: ["Asian Range Breakout Close", "Retest within 8 candles", "Confirmation candle close"],
      timestamp: candles.at(-1)?.timestamp ?? null,
    } : null,
    v2AsianRanges: asianRanges,
    audit: {
      activeEngine: ACTIVE_SIGNAL_ENGINE,
      strategyId: BREAKOUT_STRATEGY_ID,
      activeMode: "NORMAL_SCALP",
      minimumScoreRequired: config.minSignalScore,
      minimumSetupScoreRequired: 0,
      minimumSignalScoreRequired: config.minSignalScore,
      minimumRrRequired: config.minRR,
      totalCandlesScanned: candles.length,
      totalMarkersGenerated: 0,
      totalContextsGenerated: 1,
      totalPhase4Setups: 0,
      watchCount: 0,
      setupCount: 0,
      invalidatedCount: 0,
      expiredCount: confirmationsExpired,
      totalSetupsScanned: bullishBreakouts + bearishBreakouts,
      triggerSetupsFound: bullishBreakouts + bearishBreakouts,
      pendingConfirmationCount: 0,
      expiredConfirmationCount: confirmationsExpired,
      invalidatedCandidateCount: 0,
      confirmedBuyCount: signals.filter((s) => s.direction === "BULLISH").length,
      confirmedSellCount: signals.filter((s) => s.direction === "BEARISH").length,
      rapidBuyCount: 0,
      rapidSellCount: 0,
      rapidSignalCount: 0,
      rejectedSetupCount: rejectedCandidates.length,
      lastRejectionReason: rejectedCandidates.at(-1)?.reason ?? null,
      lastConfirmedSignal: signals.at(-1)?.type ?? null,
      topRejectionReasons: topRejectionReasons.map((item) => ({ reason: item.reason, count: item.count })),
      lastFiveTriggerSetups: rejectedCandidates.slice(-5).map((item) => `${item.code} ${item.date} @ ${item.candleIndex}`),
      lastFiveConfirmedSignals: signals.slice(-5).map((s) => `${s.type} ${new Date(s.timestamp).toISOString()}`),
      noSignalMessage: signals.length === 0 ? "No V2 Asian Breakout signals found for this range." : null,
      noRepaintWarnings: signals
        .filter((signal) => !signal.noRepaintProof.passed)
        .map((signal) => `${signal.id}: ${signal.noRepaintProof.message}`),
      rrCalculation: signals.at(-1)
        ? `${signals.at(-1)!.rewardPoints.toFixed(2)} / ${signals.at(-1)!.riskPoints.toFixed(2)} = ${signals.at(-1)!.rr.toFixed(2)}R`
        : null,
      stopLossSource: signals.at(-1)?.stopLossDetail.source ?? null,
      takeProfitSource: signals.at(-1)?.takeProfitDetail.source ?? null,
      scoreBreakdown: signals.at(-1)?.scoreBreakdown ?? null,
      lastCandidateDebug: candidateDebug.at(-1) ?? null,
      noRepaintValidation: signals.every((signal) => signal.noRepaintProof.passed) ? "PASS" : "WARNING",
      calculationTimeMs: generationTimeMs,
      generationTimeMs,
      cacheStatus: "miss",
      v2Breakout: {
        activeEngineLabel: "V2 Asian Range Breakout Retest",
        strategyId: BREAKOUT_STRATEGY_ID,
        totalCandlesScanned: candles.length,
        daysDetected: asianRanges.length,
        validAsianRanges: asianRanges.filter((r) => r.valid).length,
        invalidAsianRanges: asianRanges.filter((r) => !r.valid).length,
        ...rangeAudit,
        bullishBreakouts,
        bearishBreakouts,
        retestsFound,
        retestsFailed,
        confirmationsFound,
        confirmationsExpired,
        confirmedBuyCount: signals.filter((s) => s.direction === "BULLISH").length,
        confirmedSellCount: signals.filter((s) => s.direction === "BEARISH").length,
        rejectedCount: rejectedCandidates.length,
        topRejectionReasons: topRejectionReasons.map((item) => ({ reason: item.reason, count: item.count })),
        generationTimeMs,
      },
    },
  };

  if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value ?? "");
  resultCache.set(cacheKey, result);

  return result;
}

function calculateScore(input: {
  range: GoldmineAsianRange;
  breakoutCandle: Candle;
  retestCandle: Candle;
  confirmCandle: Candle;
  rr: number;
  session: TradingSession;
  atr: number;
}): {
  asianRangeQuality: number;
  breakoutQuality: number;
  breakoutMomentum: number;
  retestQuality: number;
  confirmationQuality: number;
  rrQuality: number;
  sessionQuality: number;
  total: number;
} {
  const asianRangeQuality = Math.max(0, 15 - asianRangeRiskPenalty(input.range));

  const isBullish = input.breakoutCandle.close > input.range.high;
  const breakDistance = isBullish
    ? input.breakoutCandle.close - input.range.high
    : input.range.low - input.breakoutCandle.close;
  const breakoutQuality = Math.min(20, Math.round(20 * (breakDistance / (0.10 * input.atr))));

  const body = Math.abs(input.breakoutCandle.close - input.breakoutCandle.open);
  const candleRange = input.breakoutCandle.high - input.breakoutCandle.low;
  const bodyRatio = candleRange > 0 ? body / candleRange : 0;
  const breakoutMomentum = Math.min(15, Math.round(15 * (bodyRatio / 0.70)));

  const level = isBullish ? input.range.high : input.range.low;
  const extreme = isBullish ? input.retestCandle.low : input.retestCandle.high;
  const retestDistance = Math.abs(extreme - level);
  let retestQuality = 20;
  if (retestDistance > 0.05 * input.atr) {
    retestQuality = Math.max(0, Math.round(20 * (1 - (retestDistance - 0.05 * input.atr) / (0.10 * input.atr))));
  }

  const cBody = Math.abs(input.confirmCandle.close - input.confirmCandle.open);
  const cRange = input.confirmCandle.high - input.confirmCandle.low;
  const cBodyRatio = cRange > 0 ? cBody / cRange : 0;
  const confirmationQuality = Math.min(15, Math.round(15 * (cBodyRatio / 0.60)));

  const rrQuality = Math.min(10, Math.round(10 * (input.rr - 1.5) / 0.5));

  let sessionQuality = 1;
  if (input.session === "LONDON") sessionQuality = 5;
  else if (input.session === "NEW_YORK") sessionQuality = 3;

  const total = asianRangeQuality + breakoutQuality + breakoutMomentum + retestQuality + confirmationQuality + rrQuality + sessionQuality;

  return {
    asianRangeQuality,
    breakoutQuality,
    breakoutMomentum,
    retestQuality,
    confirmationQuality,
    rrQuality,
    sessionQuality,
    total,
  };
}

function topReasons(rejected: Array<{ code: string }>): Array<{ reason: SignalRejectionCode; count: number }> {
  const counts = new Map<string, number>();
  for (const item of rejected) counts.set(item.code, (counts.get(item.code) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason: reason as SignalRejectionCode, count }))
    .sort((a, b) => b.count - a.count);
}

function asianRangeRiskPenalty(range: GoldmineAsianRange): number {
  if (!range.warnings.includes("WARNING_LARGE_ASIAN_RANGE")) return 0;
  const ratio = range.rangeSize / Math.max(range.atrReference, Number.EPSILON);
  return ratio > 10 ? 10 : 5;
}

function rangeWarningMessage(warning: V2AsianRangeWarningCode): string {
  switch (warning) {
    case "WARNING_LARGE_ASIAN_RANGE":
      return "Asian range is large compared with ATR. Signal risk may be higher.";
    case "WARNING_PARTIAL_ASIAN_RANGE":
      return "Partial Asian range used because the full 00:00-07:00 UTC range was unavailable.";
    case "WARNING_FALLBACK_RANGE_USED":
      return "Fallback range used because no usable 00:00-07:00 UTC Asian candles were available.";
  }
}

function rangeAuditCounts(
  ranges: GoldmineAsianRange[],
  signals: TradeSignal[],
  rejectedCandidates: V2AsianBreakoutRejectedCandidate[],
) {
  const hardRangeCodes: SignalRejectionCode[] = ["NO_USABLE_RANGE", "RANGE_HIGH_LOW_INVALID", "RANGE_CANDLES_TOO_FEW"];
  return {
    completeAsianRanges: ranges.filter((range) => range.valid && range.isComplete).length,
    partialAsianRanges: ranges.filter((range) => range.valid && range.isPartial).length,
    fallbackRanges: ranges.filter((range) => range.valid && range.isFallback).length,
    largeRangeWarnings: ranges.filter((range) => range.warnings.includes("WARNING_LARGE_ASIAN_RANGE")).length,
    noUsableRangeRejections: rejectedCandidates.filter((candidate) => hardRangeCodes.includes(candidate.code)).length,
    confirmedSignalsUsingPartialRange: signals.filter((signal) => signal.asianRange?.isPartial).length,
    confirmedSignalsUsingLargeRange: signals.filter((signal) => signal.asianRange?.warnings.includes("WARNING_LARGE_ASIAN_RANGE")).length,
  };
}

function candidateDebugFromBreakoutRejection(
  candidate: V2AsianBreakoutRejectedCandidate,
  minSignalScore: number,
  minRR: number,
): SignalCandidateDebug {
  return {
    setupId: candidate.id,
    engine: ACTIVE_SIGNAL_ENGINE,
    strategyId: BREAKOUT_STRATEGY_ID,
    setupScore: 0,
    requiredSetupScore: 0,
    finalSignalScore: null,
    requiredSignalScore: minSignalScore,
    signalScore: null,
    rr: null,
    requiredRR: minRR,
    htfBias: "-",
    directionBias: candidate.direction === "BUY" ? "BULLISH" : candidate.direction === "SELL" ? "BEARISH" : "NEUTRAL",
    asianRangeDate: candidate.date ?? undefined,
    session: "-",
    confirmationStatus: candidate.stage === "EXPIRED" || candidate.code === "CONFIRMATION_EXPIRED" ? "EXPIRED_CONFIRMATION" : "REJECTED",
    confirmationWindowRemaining: 0,
    rejectionReason: candidate.reason,
    nextRequiredAction: candidate.nextRequiredAction ?? nextActionForBreakoutRejection(candidate.code),
    failedStage: candidate.failedStage ?? candidate.code,
  };
}

function rejectedSetupFromCandidate(
  candidate: V2AsianBreakoutRejectedCandidate,
  minSignalScore: number,
  minRR: number,
): RejectedSetup {
  return {
    setupId: candidate.id,
    setupType: "TREND_CONTINUATION",
    setupState: candidate.candleIndex === null ? "WATCH" : candidate.stage === "EXPIRED" ? "EXPIRED" : "TRIGGER",
    direction: candidate.direction === "BUY" ? "BULLISH" : candidate.direction === "SELL" ? "BEARISH" : "NEUTRAL",
    triggerIndex: candidate.candleIndex,
    rejectionReasons: [candidate.reason],
    rejectionReasonCodes: [candidate.code],
    debug: candidateDebugFromBreakoutRejection(candidate, minSignalScore, minRR),
  };
}

function nextActionForBreakoutRejection(code: SignalRejectionCode): string {
  switch (code) {
    case "INVALID_ASIAN_RANGE":
    case "NO_USABLE_RANGE":
    case "RANGE_HIGH_LOW_INVALID":
    case "RANGE_CANDLES_TOO_FEW":
      return "Load enough pre-scan candles to build a complete, partial, or fallback range.";
    case "WEAK_BREAKOUT_MOMENTUM":
    case "WEAK_BREAKOUT_CLOSE":
      return "Wait for a stronger closed breakout candle.";
    case "RETEST_NOT_FOUND":
    case "RETEST_FAILED":
      return "Wait for a clean retest that holds the broken Asian level.";
    case "NO_CONFIRMATION":
    case "CONFIRMATION_EXPIRED":
      return "Wait for a closed continuation confirmation candle.";
    case "RR_TOO_LOW":
    case "TP_NOT_FOUND":
      return "Wait for a setup with cleaner risk-to-reward or a better target.";
    case "SCORE_TOO_LOW":
      return "Wait for a higher-quality breakout, retest, and confirmation sequence.";
    default:
      return "Wait for the next valid Asian range breakout retest setup.";
  }
}

function calculateAtrSeries(candles: Candle[], period: number): number[] {
  return candles.map((item, index) => {
    if (index < period - 1) return item.high - item.low || 1;
    const start = Math.max(0, index - period + 1);
    const trueRanges = candles.slice(start, index + 1).map((item, offset, window) => {
      const previous = index === start + offset ? candles[start + offset - 1] : window[offset - 1];
      const previousClose = previous?.close ?? item.close;
      return Math.max(item.high - item.low, Math.abs(item.high - previousClose), Math.abs(item.low - previousClose));
    });
    return round(mean(trueRanges));
  });
}

function tradingSessionAt(timestamp: number, settings?: Partial<V2GoldmineSettings>): TradingSession | null {
  const hour = utcHour(timestamp);
  const hours = settings?.sessionHours ?? {
    londonStart: UTC_SESSIONS.london.startHour,
    londonEnd: UTC_SESSIONS.london.endHour,
    newYorkStart: UTC_SESSIONS.newYork.startHour,
    newYorkEnd: UTC_SESSIONS.newYork.endHour,
  };
  if (hour >= hours.londonStart && hour < hours.londonEnd) return "LONDON";
  if (hour >= hours.newYorkStart && hour < hours.newYorkEnd) return "NEW_YORK";
  return null;
}

function utcHour(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getUTCHours() + date.getUTCMinutes() / 60;
}

function utcDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function indexesForTradingDay(candles: Candle[], range: GoldmineAsianRange, settings?: Partial<V2GoldmineSettings>): number[] {
  const date = range.date;
  const indexes: number[] = [];
  for (let index = range.endIndex + 1; index < candles.length; index += 1) {
    const candle = candles[index];
    if (utcDateKey(candle.timestamp) !== date) continue;
    if (tradingSessionAt(candle.timestamp, settings)) indexes.push(index);
  }
  return indexes;
}

function rangeIndexes(range: GoldmineAsianRange): number[] {
  const indexes: number[] = [];
  for (let index = range.startIndex; index <= range.endIndex; index += 1) indexes.push(index);
  return indexes;
}

function buildCacheKey(input: V2GoldmineInput, candles: Candle[], settings: V2GoldmineSettings): string {
  const last = candles.at(-1);
  return [
    BREAKOUT_STRATEGY_ID,
    input.symbol,
    input.timeframe,
    input.startDate,
    input.endDate,
    candles.length,
    last?.timestamp ?? 0,
    input.structure.markers.length,
    input.structure.liquidityZones.length,
    JSON.stringify(settings),
  ].join(":");
}

function cloneResult(result: EntryEngineResult, cacheStatus: "hit" | "miss"): EntryEngineResult {
  return { ...result, signalMap: new Map(result.signalMap), audit: { ...result.audit, cacheStatus } };
}

function confidenceFor(score: number): TradeSignal["confidence"] {
  if (score >= 90) return "PREMIUM";
  if (score >= 78) return "STRONG";
  if (score >= 65) return "MODERATE";
  return "LOW_CONFIRMED";
}

function mean(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? finite.reduce((total, value) => total + value, 0) / finite.length : 0;
}

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function logBreakoutStage(candleTime: string, passed: boolean, failedStage: string, reason: string): void {
  const isDebug = process.env.DEBUG_GOLDMINE === "true" ||
    (typeof window !== "undefined" && (window as DebugWindow).DEBUG_GOLDMINE === true);
  if (!isDebug) return;

  console.log(JSON.stringify({
    strategy: BREAKOUT_STRATEGY_ID,
    candleTime,
    passed,
    failedStage,
    reason,
  }));
}
