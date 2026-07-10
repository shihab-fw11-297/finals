# XAUUSD Signal Execution Guide

This guide explains how the application produces and exposes BUY/SELL signals, and how a confirmed signal should be consumed. The application does **not** currently submit orders to a broker.

## Current UI Defaults

- Selected strategy: `PRO_LIQUIDITY_CONFLUENCE_ENGINE`.
- Strategy activation: off.
- Signal markers: off.
- All market-structure markers and context overlays: off.

To generate signals in the UI:

1. Fetch XAUUSD candles.
2. Enable `Strategy Activation -> Active`.
3. Keep Pro Liquidity Confluence selected or choose another strategy.
4. Enable `Markers` only when chart markers are wanted.
5. Read confirmed outputs in Signal History and rejected/pending stages in Signal Debug.

Markers control visibility only. Turning markers off does not change calculations after the strategy itself is active.

## Runtime Pipeline

```text
POST /api/candles
  -> normalize, deduplicate, sort candles
  -> calculate market structure
  -> calculate market context
  -> runSelectedStrategy(strategyId, input)
  -> generateV2Signals(strategyId, input)
  -> selected strategy engine
  -> SIGNAL_FOLLOW_THROUGH_ENGINE scores confirmed signals
  -> EntryEngineResult
  -> Signal History / Signal Debug / optional chart markers
```

| Responsibility | File |
| --- | --- |
| UI selection/input | `app/components/market-chart-app.tsx` |
| Cached runner | `lib/strategy-runner/run-selected-strategy.ts` |
| Routing/ALL_V2 merge | `lib/v2-signal-engine/coordinator.ts` |
| Follow-through scoring | `lib/v2-signal-engine/signal-follow-through-engine.ts` |
| Thresholds | `lib/v2-signal-engine/config.ts` |
| Output contract | `lib/entry-engine/types.ts` |
| Chart | `app/components/candlestick-chart.tsx` |
| Signal history | `app/components/signal-history-table.tsx` |
| Diagnostics | `app/components/signal-debug-panel.tsx` |

## When a Signal Is Executable

Treat a result as confirmed only when:

```ts
signal.status === "CONFIRMED"
signal.type === "CONFIRMED_BUY" || signal.type === "CONFIRMED_SELL"
signal.immutable === true
signal.noRepaintProof.passed === true
signal.riskPoints > 0
signal.rewardPoints > 0
signal.rr >= requiredStrategyRR
```

`signal.followThrough.followThroughGrade === "AVOID"` is not the same as an invalid strategy signal. It means the setup confirmed, but the post-confirmation follow-through layer sees poor runway, nearby obstacles, weak displacement, conflicting structure, excessive spread, or another hard blocker. Execution tooling should treat `AVOID` as a no-chase/no-execution warning unless a human explicitly overrides it.

Do not execute from `pendingCandidates`, `candidateDebug`, `rejectedSetups`, individual chart setup markers, or a forming candle. Those explain setup progress; they are not entries.

## Confirmed Signal Fields

| Field | Meaning |
| --- | --- |
| `strategyId` | Producing strategy |
| `type` | `CONFIRMED_BUY` or `CONFIRMED_SELL` |
| `timestamp` | Closed confirmation candle time |
| `entryPrice` | Confirmation close used by model |
| `stopLoss` | Immutable model SL |
| `takeProfit` | Immutable primary TP |
| `takeProfit2`, `takeProfit3` | Optional targets |
| `riskPoints` | Entry-to-SL distance |
| `rewardPoints` | Entry-to-TP1 distance |
| `rr` | Reward/risk ratio |
| `score` | Strategy-specific quality |
| `warnings` | Non-blocking context issues |
| `positionSizeSuggestion` | Raw risk/risk-points value; not broker lots |
| `noRepaintProof` | Evidence boundary and validation |
| `followThrough` | Optional frozen post-confirmation follow-through score, grade, estimated probability, target, obstacle, invalidation display, warnings, and debug data |

## Follow-Through Fields

`followThrough` is calculated after a signal is confirmed. It is not a signal generator and it does not modify model entry, SL, TP, RR, timestamp, or original score.

| Field | Meaning |
| --- | --- |
| `followThroughScore` | 0-100 quality score for directional continuation |
| `followThroughGrade` | `A+`, `A`, `B`, `C`, or `AVOID` |
| `moveProbability` | Estimated follow-through probability label, not guaranteed win probability |
| `expectedMoveSide` | `UP`, `DOWN`, or `LOW_CONFIDENCE` |
| `liquidityRunway.status` | `CLEAN`, `LIMITED`, `BLOCKED`, or `NO_TARGET` |
| `nearestTarget` | Nearest directional liquidity target |
| `nearestObstacle` | Nearest obstacle before or near the target |
| `targetDistanceR` | Target distance in risk units |
| `obstacleDistanceR` | Obstacle distance in risk units |
| `hardBlockers` | Reasons to avoid chasing the signal |
| `chartOverlay.markerLabel` | Label used on the chart, for example `BUY A 78%` |
| `debug` | Factor-level diagnostics and no-repaint proof |

Execution interpretation:

- `A+` / `A`: strongest follow-through candidates, still subject to live price, spread, and broker checks.
- `B`: valid but not premium.
- `C`: caution only.
- `AVOID`: confirmed setup exists, but follow-through quality is poor or blocked.

## BUY Handling

For `CONFIRMED_BUY`, expected geometry is `stopLoss < entryPrice < takeProfit`.

Before live submission, an execution adapter should:

1. Reject if current ask has moved too far above model entry.
2. Recalculate RR from actual ask and immutable SL/TP.
3. Reject if live RR is below the strategy minimum.
4. Convert monetary risk into lots using broker symbol metadata.
5. Round price and volume to broker tick/step rules.
6. Include spread, commission, and slippage.
7. Submit BUY with server-side SL/TP.
8. Store broker order ID against `signal.id` to prevent duplicates.

## SELL Handling

For `CONFIRMED_SELL`, expected geometry is `takeProfit < entryPrice < stopLoss`. Perform the same validation with current bid, then submit SELL.

## Live RR Check

```ts
function liveRR(
  side: "BUY" | "SELL",
  fillPrice: number,
  stopLoss: number,
  takeProfit: number,
): number {
  const risk = side === "BUY" ? fillPrice - stopLoss : stopLoss - fillPrice;
  const reward = side === "BUY" ? takeProfit - fillPrice : fillPrice - takeProfit;
  return risk > 0 && reward > 0 ? reward / risk : 0;
}
```

If price crossed TP, crossed SL, or reduced RR below minimum, mark the signal missed/stale rather than chasing it.

## Correct XAUUSD Position Size

The current `positionSizeSuggestion` is not a reliable lot size. A broker adapter needs:

```text
riskMoney = accountBalance * riskPercent
stopDistance = abs(fillPrice - stopLoss)
moneyPerLotAtStop = (stopDistance / tickSize) * tickValuePerLot
rawLots = riskMoney / moneyPerLotAtStop
lots = floorToVolumeStep(clamp(rawLots, minLot, maxLot))
```

Use broker-provided tick size, tick value, contract size, volume limits, account currency, and conversion rates. Never assume one XAUUSD price point equals one account-currency unit per lot.

## Execution State Machine

```text
CONFIRMED
  -> VALIDATING_LIVE_PRICE
  -> ACCEPTED or STALE_REJECTED
  -> ORDER_SUBMITTED
  -> ORDER_FILLED or ORDER_REJECTED
  -> OPEN
  -> STOPPED / TP1 / CLOSED / CANCELLED
```

Persist signal ID, side, strategy, model levels, actual bid/ask and fill, lots, monetary risk, broker IDs, timestamps, and terminal status. The strategy engine should never mutate a confirmed signal after submission.

## Programmatic Call

```ts
import { runSelectedStrategy } from "@/lib/strategy-runner/run-selected-strategy";
import { PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID } from "@/lib/v2-signal-engine";

const result = runSelectedStrategy(PRO_LIQUIDITY_CONFLUENCE_STRATEGY_ID, {
  candles,
  symbol: "XAUUSD",
  timeframe: "5m",
  startDate,
  endDate,
  structure: marketStructure,
  context: marketContext,
  settings: { maxRiskAmount: 100 },
});

for (const signal of result.signals) {
  if (signal.status !== "CONFIRMED" || !signal.noRepaintProof.passed) continue;
  // Pass to a separate broker validation/execution adapter.
}
```

The Pro engine reads `settings.currentMode` or `settings.mode`, but shared `V2GoldmineSettings` does not expose them. Formalize the type and UI before relying on strict/professional mode.

## Pending and Rejected Results

`pendingCandidates` means the sequence is incomplete but inside its deadline. `rejectedSetups` means a hard gate failed or expired.

| Code | Meaning |
| --- | --- |
| `NO_SWEEP` | No qualifying liquidity event |
| `NO_RECLAIM_CLOSE` | Sweep did not reclaim liquidity |
| `NO_DISPLACEMENT` | No strong directional impulse in time |
| `NO_MSS_OR_CHOCH` | Structure did not shift |
| `NO_ENTRY_ZONE` | No accepted retracement zone |
| `FVG_INVALIDATED` | Close through FVG invalidation |
| `WEAK_CONFIRMATION_CANDLE` | Candle failed confirmation quality |
| `CONFIRMATION_EXPIRED` | Deadline elapsed |
| `INVALID_STOP_LOSS` | Invalid SL geometry |
| `STOP_LOSS_TOO_WIDE` | Pro SL exceeds ATR cap |
| `RR_BELOW_MINIMUM` | Target does not compensate for risk |
| `SIGNAL_SCORE_TOO_LOW` | Geometry passed, score failed |
| `MAX_DAILY_SIGNALS_REACHED` | Frequency guard blocked signal |

## Verification Checklist

1. Test mirrored BUY and SELL fixtures.
2. Remove each required stage independently.
3. Test pending versus expired deadlines.
4. Test SL geometry and ATR width cap.
5. Test target fallback and low-RR rejection.
6. Append future candles and assert levels/score do not change.
7. Test follow-through clean runway, obstacle-before-0.8R, weak displacement, choppy structure, missing historical stats, and negative historical edge.
8. Test post-trade follow-through analytics for MFE, MAE, bars to 1R, TP, and SL.
9. Test session boundaries in configured timezone.
10. Replay real XAUUSD candles and inspect rejection counts.
11. Paper trade with actual spread/tick metadata before live connection.

## Known Production Gaps

- No broker connector or order-management service.
- No live broker spread/slippage/commission gate in signal execution. Follow-through can score optional spread if supplied, but the app does not yet have a broker-grade live spread feed.
- No broker-accurate XAUUSD lot calculation.
- No persisted execution idempotency store.
- No portfolio exposure or daily-loss guard.
- No current backtest UI/engine.
- Declared allowed timeframes are not consistently hard-enforced.

See `STRATEGY_IMPLEMENTATION_REFERENCE.md` for every strategy's exact setup rules.
