# XAUUSD V2 Strategy Implementation Reference

This document describes the XAUUSD V2 strategy modules implemented in this repository and how their signals are displayed in the chart app. It is an implementation reference only. It does not claim profitability and it is not trading advice.

## Current Signal Stack

The app has seven signal layers:

1. Raw strategy engines generate independent `TradeSignal` objects from closed candles only.
2. `ALL_V2` runs all raw V2 strategies together and merges their confirmed signals.
3. `CUSTOM_MULTI_V2` runs a user-selected basket of one or more raw strategies and merges their confirmed signals.
4. `SIGNAL_FOLLOW_THROUGH_ENGINE` scores each already-confirmed raw signal for likely directional follow-through. It does not create signals and does not modify entry, SL, TP, RR, timestamp, original score, or strategy logic.
5. `OPTIONAL_MASTER_SIGNAL_SELECTOR` is the user-facing Research selector. It is default OFF, preserves raw signals, and only groups, deduplicates, and resolves conflicts when `Enable Master Selector` is turned on.
6. `MASTER_SIGNAL_SELECTOR` is the legacy internal selector result still produced for merged strategy audits and compatibility.
7. `INSTITUTIONAL_MASTER_GATEKEEPER` is the Production-only layer. It recalculates structural SL and HTF TP, enforces 2.5R, evaluates six normalized factors, applies session and HTF liquidity gates, and returns `MASTER_BUY`, `MASTER_SELL`, or `NO_TRADE`.

Raw strategies are preserved. No master layer deletes or rewrites the raw signal list.

## Strategy Inventory

| Priority | Strategy ID | Label | Primary setup | Default/allowed timeframe | Normal threshold |
| ---: | --- | --- | --- | --- | --- |
| 1 | `STOCK_GURU_SWEEP_FVG_OB_ENGINE` | Stock Guru Sweep FVG OB Engine | Liquidity sweep -> reclaim -> displacement -> BOS/CHoCH -> FVG/OB zone retest | Default 5m; 1m/5m/15m allowed | Score 65, RR 1.5R |
| 2 | `PRO_LIQUIDITY_CONFLUENCE_ENGINE` | Pro Liquidity Confluence Engine | Sweep -> displacement -> MSS/CHoCH -> premium/discount zone retest | Default 5m; 1m/5m/15m allowed | 6/8 factors, RR 1.5R |
| 3 | `ICT_IFVG_REVERSAL_ENGINE` | ICT IFVG Reversal Engine | FVG inversion -> zone retest -> reversal confirmation | Default 5m; 1m/5m/15m allowed | Score 62, RR 1.5R |
| 4 | `ICT_OTE_CONTINUATION_ENGINE` | ICT OTE Continuation Engine | Impulse/BOS -> OTE 62-79 retracement -> continuation confirmation | Default 5m; 1m/5m/15m allowed | 6/8 factors, RR 1.5R |
| 5 | `ICT_SILVER_BULLET` | ICT Silver Bullet | Killzone sweep -> reclaim -> displacement/MSS -> FVG retest | Default 1m; 1m/5m allowed | Score 65, RR 1.5R |
| 6 | `FVG_CONTINUATION_ENTRY` | FVG Continuation Entry | Displacement/BOS -> same-direction FVG -> retest -> confirmation | Default 5m; 1m/5m/15m allowed | Score 62, RR 1.5R |
| 7 | `ORDER_BLOCK_RETEST_CONFIRMATION` | Order Block Retest Confirmation | Displacement/BOS -> order block -> retest -> confirmation | Default 5m | Score 62, RR 1.5R |
| 8 | `LIQUIDITY_SWEEP_REVERSAL_PRO` | Liquidity Sweep Reversal Pro | Liquidity sweep -> reclaim -> reversal confirmation | Default 5m | Score 60, RR 1.5R |
| 9 | `GOLDMINE_ASIAN_SWEEP_REVERSAL` | Goldmine Asian Sweep Reversal | Asian range sweep -> rejection -> MSS/displacement confirmation | Chart timeframe | Score 55, RR 1.5R |
| 10 | `ASIAN_RANGE_BREAKOUT_RETEST` | Asian Range Breakout Retest | Asian range breakout -> retest -> continuation confirmation | Chart timeframe | Score 60, RR 1.5R |
| 11 | `TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE` | TJR Simple Structure Pullback Engine | Structure break/CHoCH -> FVG/OB/EMA zone pullback -> confirmation | Default 5m; 1m/5m/15m allowed | Score 60, RR 1.5R |
| 12 | `EMA_TREND_PULLBACK` | EMA Trend Pullback | EMA stack trend -> EMA20/50 pullback -> continuation confirmation | Default 5m | Score 58, RR 1.5R |
| 13 | `VWAP_EMA_REGIME_PULLBACK` | VWAP EMA Regime Pullback | VWAP/EMA regime -> EMA pullback -> continuation confirmation | 5m | Score 60, RR 1.5R |
| - | `ALL_V2` | All V2 Strategies | Runs all thirteen strategy engines and merges raw output | Selected chart timeframe | Per strategy; optional selector only when enabled |
| - | `CUSTOM_MULTI_V2` | Custom Multi Strategy | Runs any selected strategy engines and merges raw output | Selected chart timeframe | Per selected strategy; optional selector only when enabled |
| - | `SIGNAL_FOLLOW_THROUGH_ENGINE` | Signal Follow-Through Engine | Post-confirmation score for directional continuation probability, liquidity runway, target, obstacle, invalidation, and grade | Same as source signal | Grade from follow-through score: A+, A, B, C, AVOID |
| - | `OPTIONAL_MASTER_SIGNAL_SELECTOR` | Optional Master Signal Selector | Default-off Research layer that groups, ranks, deduplicates, and resolves conflicts after raw signals exist | Same as selected chart timeframe | No hard 2.5R; optional cooldown off by default |
| - | `MASTER_SIGNAL_SELECTOR` | Legacy Master Signal Selector | Internal compatibility/audit selector for merged raw output | Same as selected chart timeframe | Score 65, RR 1.5R in normal mode |
| - | `INSTITUTIONAL_MASTER_GATEKEEPER` | Institutional Master Gatekeeper | Production-only six-factor, structural-risk, HTF-liquidity gate | Same as selected chart timeframe | 3/6 London/NY or 4/6 Asian/overlap; mandatory 2.5R |

## Shared Signal Rules

- Only closed candles are scanned. Forming candles are ignored.
- BUY and SELL logic is mirrored in every strategy.
- Entry is the confirmation candle close unless a strategy explicitly stores a different immutable entry.
- Stop loss, take profit, RR, score, confirmation index, and evidence are frozen when the signal is created.
- `followThrough` is calculated after confirmation and frozen separately. It may grade a valid signal as `A+`, `A`, `B`, `C`, or `AVOID`, but it must not rewrite the original strategy signal.
- A valid BUY must have `entryPrice > stopLoss` and `takeProfit > entryPrice`.
- A valid SELL must have `entryPrice < stopLoss` and `takeProfit < entryPrice`.
- `RR = abs(takeProfit - entryPrice) / abs(entryPrice - stopLoss)`.
- Signals below the strategy RR threshold are rejected before they reach the chart.
- `noRepaintProof` stores the evidence indexes used to create the signal.
- `followThrough.noRepaintProof` stores the candle count and confirmation index used to freeze follow-through score, grade, target, obstacle, probability, and invalidation display.

## Signal Follow-Through Engine

Source: `lib/v2-signal-engine/signal-follow-through-engine.ts`

`SIGNAL_FOLLOW_THROUGH_ENGINE` runs after a raw strategy creates a confirmed BUY/SELL signal. Its job is to answer a different question from the strategy:

```text
Strategy signal: Is the setup valid?
Follow-through score: Is price likely to keep moving in that signal direction after confirmation?
```

It is a scoring and visual layer only:

- It does not generate random new BUY/SELL signals.
- It does not fetch candles.
- It uses closed candles only.
- It does not use future candles.
- It does not repaint confirmed follow-through values.
- It does not change original `entryPrice`, `stopLoss`, `takeProfit`, `rr`, `timestamp`, `score`, or strategy metadata.

Output is attached to `TradeSignal.followThrough`.

Main output fields:

| Field | Meaning |
| --- | --- |
| `followThroughScore` | 0-100 post-confirmation score |
| `followThroughGrade` | `A+`, `A`, `B`, `C`, or `AVOID` |
| `moveProbability` | User-facing estimated follow-through probability, not guaranteed win probability |
| `expectedMoveSide` | `UP`, `DOWN`, or `LOW_CONFIDENCE` |
| `liquidityRunway` | Clean/limited/blocked runway toward target |
| `nearestTarget` | Nearest directional liquidity target |
| `nearestObstacle` | Nearest supply/demand/FVG/OB/session obstacle |
| `targetDistanceR` | Target distance from entry in risk units |
| `obstacleDistanceR` | Obstacle distance from entry in risk units |
| `invalidationLevel` | Frozen structural invalidation level used for display |
| `chartOverlay` | Marker label, target label, obstacle label, runway arrow metadata, tooltip payload |
| `debug` | Factor scores, passed/failed reason codes, blockers, warnings, no-repaint proof |

Seven-factor score model:

| Factor | Weight |
| --- | ---: |
| HTF directional bias | 15 |
| Liquidity runway | 20 |
| Displacement and momentum quality | 15 |
| Structure alignment | 15 |
| Entry quality and distance from origin | 10 |
| Session and volatility quality | 10 |
| Historical similar setup performance | 15 |

Grade behavior:

- `A+`: score >= 88 with clean runway, strong displacement, aligned structure, and no hard blocker.
- `A`: score 78-87.
- `B`: score 68-77.
- `C`: score 58-67.
- `AVOID`: score < 58 or a hard blocker exists.

Hard blockers include:

- Obstacle before 0.8R.
- Direct signal into HTF supply/demand.
- Spread too high when spread data is supplied.
- News-like extended confirmation candle.
- Structure directly against the signal without sweep/reversal evidence.
- No clean liquidity target.

Chart behavior:

- Marker text upgrades from plain BUY/SELL style to `BUY A 78%`, `SELL A+ 86%`, or an `AVOID` grade.
- Selected/latest signal overlays include follow-through target, obstacle, and invalidation lines.
- Tooltip shows estimated follow-through probability, target, obstacle, runway, passed factors, failed factors, warnings, top reason, and avoid reason.

## 1. Stock Guru Sweep FVG OB Engine

Source: `lib/v2-signal-engine/stock-guru-sweep-fvg-ob-engine.ts`

This is the highest-priority raw strategy in the master selector.

Main sequence:

1. Find liquidity from swings, equal highs/lows, previous session levels, round numbers, or recent range extremes.
2. BUY sweeps sell-side liquidity and reclaims upward. SELL sweeps buy-side liquidity and reclaims downward.
3. Reclaim must happen within two candles.
4. Displacement must follow within five candles.
5. BOS or wick CHoCH must follow displacement within five candles.
6. Build an entry zone from FVG, order block, or FVG/OB overlap.
7. Wait for a retest of that zone.
8. Confirm with directional close, body quality, and RR validation.

Normal mode thresholds:

- Sweep distance: `0.04-1.5 ATR`.
- Displacement: at least `0.40 ATR`, body ratio `0.55`, close position `0.65`.
- FVG minimum size: `0.08 ATR`.
- Retest window: 12 candles.
- Confirmation body ratio: `0.45`.
- Minimum score: 65.
- Minimum RR: 1.5R.
- Maximum SL: `3.0 ATR`.

Signal output:

- BUY marker appears below the candle.
- SELL marker appears above the candle.
- Signal details include the selected zone, sweep evidence, structure break, entry, SL, TP, RR, score, and mode.

## 2. Pro Liquidity Confluence Engine

Source: `lib/v2-signal-engine/pro-liquidity-confluence-engine.ts`

Main sequence:

1. Detect a confirmed liquidity level from recent swing highs/lows or repeated equal levels.
2. BUY sweeps SSL; SELL sweeps BSL.
3. Price must reclaim the liquidity level.
4. Require directional displacement.
5. Require MSS or CHoCH.
6. Build a zone from FVG, order block, displacement 50%, or OTE.
7. Wait for zone retest.
8. Confirm with a directional candle and valid RR.

Normal mode thresholds:

- Required factor score: 6/8.
- Minimum RR: 1.5R.
- Maximum SL: `4.5 ATR`.
- Zone retest window: 12 candles.
- Confirmation body ratio: `0.40`.

Eight scoring factors:

- Bias alignment.
- Valid sweep.
- Strong displacement.
- MSS/CHoCH.
- Entry zone.
- Confirmation.
- Valid RR.
- Session/volatility.

## 3. ICT IFVG Reversal Engine

Source: `lib/v2-signal-engine/ict-ifvg-reversal.ts`

Main sequence:

1. Detect an original FVG.
2. Wait for price to invert through the FVG.
3. Treat the inverted FVG as a reversal zone.
4. Wait for retest of the inverted zone.
5. Confirm with directional candle quality and structure behavior.
6. Validate RR, stop size, score, and session warning rules.

Normal mode thresholds:

- FVG size: `0.08-2.0 ATR`.
- Inversion buffer: `0.04 ATR`.
- Retest deadline: 15 candles.
- Confirmation range: `0.25 ATR`.
- Confirmation body ratio: `0.42`.
- Confirmation close position: `0.60`.
- Minimum score: 62.
- Minimum RR: 1.5R.
- Maximum SL: `2.8 ATR`.

Direction rule:

- A bearish FVG that later inverts upward can create a BUY IFVG reversal.
- A bullish FVG that later inverts downward can create a SELL IFVG reversal.

## 4. ICT OTE Continuation Engine

Source: `lib/v2-signal-engine/ict-ote-continuation-engine.ts`

Main sequence:

1. Detect a clean impulse leg.
2. Confirm BOS/MSS/CHoCH after the impulse.
3. Optionally detect pre-impulse liquidity sweep.
4. Build OTE retracement zone between 0.62 and 0.79.
5. Add confluence from FVG, liquidity, EMA, VWAP, or order block boundary.
6. Wait for OTE touch.
7. Confirm continuation candle.
8. Validate RR and stop size.

Normal mode thresholds:

- Minimum impulse range: `1.20 ATR`.
- Minimum displacement range: `0.55 ATR`.
- Average range multiple: `1.10`.
- OTE touch window: 20 candles.
- Confirmation window: 4 candles.
- Required factor score: 6/8.
- Minimum RR: 1.5R.
- Maximum SL: `4.0 ATR`.

Direction rule:

- BUY uses a bullish impulse and waits for a pullback into the bullish OTE discount zone.
- SELL uses a bearish impulse and waits for a pullback into the bearish OTE premium zone.

## 5. ICT Silver Bullet

Source: `lib/v2-signal-engine/ict-silver-bullet.ts`

Scanned killzones are based on `America/New_York` time:

- London Silver Bullet: 03:00-04:00.
- New York AM Silver Bullet: 10:00-11:00.
- New York PM Silver Bullet: 14:00-15:00.

Main sequence:

1. Detect swing, equal high/low, previous session, or round-number liquidity.
2. Sweep liquidity by `0.05-1.25 ATR`.
3. Reclaim on the same or next candle.
4. Require displacement.
5. Require MSS, with CHoCH accepted by config.
6. Create same-direction FVG.
7. Retest the FVG.
8. Confirm before the killzone ends.

Normal mode thresholds:

- Minimum score: 65.
- Minimum RR: 1.5R.
- Maximum SL: `2.8 ATR`.
- Maximum one signal per killzone.
- Maximum three signals per day.

## 6. FVG Continuation Entry

Source: `lib/v2-signal-engine/fvg-continuation-entry.ts`

Main sequence:

1. Detect displacement with directional close.
2. Require BOS by close; wick CHoCH is allowed.
3. Detect same-direction three-candle FVG.
4. Wait for FVG retest.
5. Confirm with candle body, range, close position, and midpoint defense.
6. Validate RR and stop size.

Normal mode thresholds:

- Displacement range: `0.40 ATR`.
- Body ratio: `0.55`.
- Close position: `0.65`.
- FVG size: `0.08-2.0 ATR`.
- FVG age: max 40 candles.
- Retest deadline: 12 candles.
- Confirmation window: 4 candles.
- Minimum score: 62.
- Minimum RR: 1.5R.
- Maximum SL: `2.8 ATR`.

Bonuses:

- Liquidity sweep bonus.
- Nearby order block bonus.
- EMA trend alignment bonus.

## 7. Order Block Retest Confirmation

Source: `lib/v2-signal-engine/order-block-retest.ts`

Main sequence:

1. Detect displacement through recent structure.
2. Search backward for the last opposite candle.
3. Build an order block zone.
4. Wait for retest.
5. Confirm rejection from the order block.
6. Validate RR and stop size.

Normal mode thresholds:

- Displacement range: `0.40 ATR`.
- Body ratio: `0.55`.
- Order block size: `0.10-1.50 ATR`.
- Maximum order block age: 80 candles.
- Retest deadline: 40 candles.
- Confirmation body ratio: `0.45`.
- Minimum score: 62.
- Minimum RR: 1.5R.
- Maximum SL: `2.8 ATR`.

Bonuses:

- Nearby FVG.
- Pre-displacement liquidity sweep.

## 8. Liquidity Sweep Reversal Pro

Source: `lib/v2-signal-engine/liquidity-sweep-reversal-pro.ts`

Main sequence:

1. Detect liquidity from swings, equal highs/lows, previous day, current session, or XAUUSD round numbers.
2. BUY sweeps SSL; SELL sweeps BSL.
3. Reclaim on the same or next candle.
4. Confirm within the configured window.
5. MSS and FVG are bonus confluence, not hard requirements.

Normal mode thresholds:

- Sweep distance: `0.05-1.2 ATR`.
- Confirmation window: 4 candles.
- Confirmation body ratio: `0.45`.
- Confirmation close position: `0.60`.
- Minimum score: 60.
- Minimum RR: 1.5R.
- Maximum SL: `2.8 ATR`.
- Maximum six signals per day.

## 9. Goldmine Asian Sweep Reversal

Source: `lib/v2-signal-engine/goldmine-asian-sweep.ts`

Main sequence:

1. Build Asian range from UTC 00:00-07:00.
2. Scan London and New York windows.
3. BUY sweeps below Asian low.
4. SELL sweeps above Asian high.
5. Require close back inside the range and rejection wick quality.
6. Require MSS or displacement confirmation.
7. Validate RR using midpoint, opposite range boundary, liquidity target, or fixed RR fallback.

Normal thresholds:

- Minimum score: 55.
- Minimum RR: 1.5R.
- Confirmation window: 6 candles.
- Sweep rejection wick ratio: around `0.24`.
- Maximum three signals per day.

Session defaults:

- Asian: 00:00-07:00 UTC.
- London: 07:00-11:00 UTC.
- New York: 12:00-16:00 UTC.

The UI allows these session hours to be changed in the Strategy Activation panel.

## 10. Asian Range Breakout Retest

Source: `lib/v2-signal-engine/asian-breakout-retest.ts`

Main sequence:

1. Build the same Asian range used by Goldmine.
2. BUY closes above Asian high plus ATR buffer.
3. SELL closes below Asian low minus ATR buffer.
4. Wait for retest of the broken range boundary.
5. Confirm continuation away from the level.
6. Validate RR using measured move, liquidity target, or fixed RR fallback.

Normal thresholds:

- Breakout close buffer: `0.05 ATR`.
- Breakout body ratio: `0.45`.
- Retest tolerance: `0.15 ATR`.
- Retest window: 8 candles.
- Confirmation window: 6 candles.
- Minimum score: 60.
- Minimum RR: 1.5R.
- Maximum two signals per day.

## 11. TJR Simple Structure Pullback Engine

Source: `lib/v2-signal-engine/tjr-simple-structure-pullback-engine.ts`

This module is designed to be easier to read and debug than the heavier pro engines.

Main sequence:

1. Detect market structure: HH/HL, LH/LL, range, or transition.
2. Detect BOS for trend continuation or CHoCH for reversal.
3. Build a pullback zone from FVG, order block, EMA zone, or structure zone.
4. Wait for a retest of the zone.
5. Confirm with candle body, close position, rejection, and risk validation.
6. Reject very choppy or low-quality structure when thresholds are not met.

Normal mode thresholds:

- Retest window: 14 candles.
- Confirmation body ratio: `0.40`.
- Minimum confirmation range: `0.20 ATR`.
- Minimum score: 60.
- Minimum RR: 1.5R.
- Maximum SL: `3.0 ATR`.
- Maximum three signals per session.
- Maximum six signals per day.

Models:

- `TREND_CONTINUATION` for pullbacks in the direction of structure.
- `CHOCH_REVERSAL` for cleaner reversal cases after a change of character.

## 12. EMA Trend Pullback

Source: `lib/v2-signal-engine/ema-trend-pullback.ts`

Main sequence:

1. Detect EMA trend stack.
2. BUY requires EMA20 > EMA50 > EMA200 and price above trend support.
3. SELL requires EMA20 < EMA50 < EMA200 and price below trend resistance.
4. Wait for pullback into EMA20/50 zone.
5. Confirm continuation away from the zone.
6. Validate RR and stop size.

Normal thresholds:

- Trend strength: `0.20 ATR`.
- Pullback zone buffer: `0.30 ATR`.
- Max pullback candles: 8.
- Confirmation body ratio: `0.45`.
- Confirmation close position: `0.60`.
- Minimum score: 58.
- Minimum RR: 1.5R.
- Maximum SL: `2.5 ATR`.

This strategy requires London/New York/overlap session.

## 13. VWAP EMA Regime Pullback

Source: `lib/v2-signal-engine/vwap-ema-regime-pullback.ts`

Main sequence:

1. Detect VWAP and EMA200 regime.
2. BUY requires close above session VWAP and EMA200, plus EMA20 > EMA50.
3. SELL requires close below session VWAP and EMA200, plus EMA20 < EMA50.
4. Wait for pullback into EMA20/50 zone.
5. Confirm continuation.
6. Validate RR and stop size.

Normal thresholds:

- VWAP distance: `0.10-2.50 ATR`.
- Pullback zone buffer: `0.25 ATR`.
- Max pullback candles: 8.
- Confirmation body ratio: `0.45`.
- Confirmation close position: `0.60`.
- Minimum score: 60.
- Minimum RR: 1.5R.
- Maximum SL: `2.5 ATR`.

Session windows are based on `America/New_York`:

- London: 03:00-06:00.
- New York AM: 08:30-11:30.
- Overlap: 08:00-11:00.

## ALL_V2 Behavior

Source: `lib/v2-signal-engine/coordinator.ts`

`ALL_V2` runs all thirteen raw strategy engines:

- `GOLDMINE_ASIAN_SWEEP_REVERSAL`
- `ASIAN_RANGE_BREAKOUT_RETEST`
- `ICT_SILVER_BULLET`
- `VWAP_EMA_REGIME_PULLBACK`
- `EMA_TREND_PULLBACK`
- `LIQUIDITY_SWEEP_REVERSAL_PRO`
- `ORDER_BLOCK_RETEST_CONFIRMATION`
- `FVG_CONTINUATION_ENTRY`
- `PRO_LIQUIDITY_CONFLUENCE_ENGINE`
- `STOCK_GURU_SWEEP_FVG_OB_ENGINE`
- `TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE`
- `ICT_OTE_CONTINUATION_ENGINE`
- `ICT_IFVG_REVERSAL_ENGINE`

It merges:

- confirmed raw signals,
- active signals,
- pending candidates,
- rejected setups,
- debug rows,
- audit counts,
- Asian ranges.

After raw confirmation, `ALL_V2` attaches `followThrough` to each confirmed signal using `SIGNAL_FOLLOW_THROUGH_ENGINE`.

After the merge and follow-through scoring, `ALL_V2` calls `selectMasterSignals(...)` and stores the result in `EntryEngineResult.masterSelection`.

## CUSTOM_MULTI_V2 Behavior

Source: `lib/strategy-runner/run-selected-strategy.ts`

`CUSTOM_MULTI_V2` is the user-selected multi-strategy basket mode. It is useful when you want more than one engine active, but do not want the noise or scan cost of running every V2 strategy.

Behavior:

- The UI requires at least one selected strategy and allows selecting any number of raw strategies.
- Each selected strategy runs independently with its own rules.
- Confirmed raw signals are merged and sorted by confirmation index.
- Confirmed signals carry `followThrough` when they come through the V2 coordinator.
- Pending candidates, debug rows, rejected setups, Asian ranges, and audit data are merged.
- The merged raw result is passed into `MASTER_SIGNAL_SELECTOR`.
- Raw, Master, and Both display modes work the same way as `ALL_V2`.

## Optional Master Signal Selector

Source: `lib/v2-signal-engine/optional-master-signal-selector.ts`

`OPTIONAL_MASTER_SIGNAL_SELECTOR` is the Research-mode selector exposed in the UI. It is default OFF.

When OFF:

- Chart and tables display raw strategy signals.
- `ALL_V2` and `CUSTOM_MULTI_V2` raw behavior is preserved.
- No grouping, suppression, conflict resolution, cooldown, or final master signal is applied.
- Debug says `Master Selector disabled. Raw signals are displayed.`

When ON:

1. Raw confirmed signals are preserved in `rawSignals`.
2. Same-direction signals are grouped if they are close in time and price.
3. The selector chooses one best raw signal per group.
4. Duplicate same-idea signals are hidden from the main master display but remain in debug/audit and raw mode.
5. BUY/SELL conflicts can select the stronger side or produce `NO_TRADE`.
6. Optional cooldown can suppress repeated same-direction signals from the same zone. Cooldown is OFF by default.

Grouping rules:

- Same direction only.
- Time window: 5 candles on 1m, 4 candles on 5m, 3 candles on 15m.
- Price window: max of `0.35 ATR` and `35%` of average risk.
- Signals from incompatible structure/invalidation are not grouped by the shared compatibility logic.

Master score formula:

```text
masterScore =
  normalizedStrategyScore * 0.35
  + confidence * 0.20
  + rrQuality * 0.20
  + stopQuality * 0.15
  + strategyPriorityScore * 0.10
```

Score normalization:

- `0-100` scores are used directly.
- `0-8` scores are converted to percentages.
- Missing or non-finite score uses fallback `50` and adds a warning.
- Confidence contributes to normalized score and is also scored separately.

Default priority order:

1. `STOCK_GURU_SWEEP_FVG_OB_ENGINE`
2. `PRO_LIQUIDITY_CONFLUENCE_ENGINE`
3. `ICT_SILVER_BULLET`
4. `ICT_IFVG_REVERSAL_ENGINE`
5. `ICT_OTE_CONTINUATION_ENGINE`
6. `FVG_CONTINUATION_ENTRY`
7. `ORDER_BLOCK_RETEST_CONFIRMATION`
8. `LIQUIDITY_SWEEP_REVERSAL_PRO`
9. `GOLDMINE_ASIAN_SWEEP_REVERSAL`
10. `ASIAN_RANGE_BREAKOUT_RETEST`
11. `TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE`
12. `EMA_TREND_PULLBACK`
13. `VWAP_EMA_REGIME_PULLBACK`

Conflict rules:

- BUY/SELL groups conflict inside the same time window and within `0.50 ATR`.
- If one master score leads by at least 12 points, that side wins.
- If RR plus stop quality is much better, that side wins.
- HTF/ITF alignment can resolve close conflicts.
- If quality is too close, the decision is `NO_TRADE`.

No-repaint behavior:

- A master signal only selects among raw signals already confirmed at the selection candle.
- Later same-direction raw signals can appear as post-entry confluence but cannot change the original selected raw signal.
- Entry, SL, TP, RR, selected strategy, timestamp, and master score are frozen in `optionalNoRepaintProof`.

## Legacy Master Signal Selector

Source: `lib/v2-signal-engine/master-signal-selector.ts`

The legacy master selector still exists for compatibility and audit data. The current user-facing Research selector is `OPTIONAL_MASTER_SIGNAL_SELECTOR`.

What it does:

1. Validates raw signals for entry/SL/TP direction, RR, stop width, closed-candle proof, and no-repaint proof.
2. Groups same-direction signals that appear near the same time and price.
3. Scores every candidate using strategy score, strategy priority, confluence, RR quality, market context, session quality, stop quality, confirmation quality, bonuses, and penalties.
4. Selects the best signal from each same-direction group.
5. Suppresses weaker duplicate ideas.
6. Detects close BUY/SELL conflicts.
7. Returns `NO_TRADE` for unresolved opposite-direction conflicts.
8. Applies cooldown and max-trade limits.
9. Freezes the final master signal levels and proof.

Normal master thresholds:

- Minimum master score: 65.
- Minimum RR: 1.5R.
- Default cooldown: 10 candles on 1m, 6 candles on 5m, 4 candles on 15m.
- Grouping window: 5 candles on 1m, 4 candles on 5m, 3 candles on 15m.
- Price grouping threshold: max of `0.35 ATR` and `35%` of signal risk.

Master priority order:

1. `STOCK_GURU_SWEEP_FVG_OB_ENGINE`
2. `PRO_LIQUIDITY_CONFLUENCE_ENGINE`
3. `ICT_IFVG_REVERSAL_ENGINE`
4. `ICT_OTE_CONTINUATION_ENGINE`
5. `ICT_SILVER_BULLET`
6. `FVG_CONTINUATION_ENTRY`
7. `ORDER_BLOCK_RETEST_CONFIRMATION`
8. `LIQUIDITY_SWEEP_REVERSAL_PRO`
9. `GOLDMINE_ASIAN_SWEEP_REVERSAL`
10. `ASIAN_RANGE_BREAKOUT_RETEST`
11. `TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE`
12. `EMA_TREND_PULLBACK`
13. `VWAP_EMA_REGIME_PULLBACK`

Important no-repaint behavior:

- Same-candle signals can compete before the master signal is frozen.
- Later same-direction signals inside the group are stored as post-entry confluence.
- Later confluence never changes the original master entry, SL, TP, RR, selected strategy, or master score.

## Institutional Production Gatekeeper

Sources:

- `lib/v2-signal-engine/institutional-master-selector.ts`
- `lib/v2-signal-engine/institutional-confluence-model.ts`
- `lib/v2-signal-engine/structural-stop-engine.ts`
- `lib/v2-signal-engine/htf-liquidity-target-engine.ts`
- `lib/v2-signal-engine/htf-liquidity-context.ts`
- `lib/v2-signal-engine/killzone-gatekeeper.ts`
- `lib/v2-signal-engine/risk-management-layer.ts`

The app has two operating modes:

| Mode | Behavior |
| --- | --- |
| `RESEARCH` | Preserves existing raw strategies, original thresholds, standard master selection, candidates, rejection data, and debugging. |
| `PRODUCTION` | Treats raw signals only as candidates and displays institutional master signals by default. |

Strict Production-enabled strategies:

1. `STOCK_GURU_SWEEP_FVG_OB_ENGINE`
2. `ICT_SILVER_BULLET`
3. `GOLDMINE_ASIAN_SWEEP_REVERSAL`
4. `ASIAN_RANGE_BREAKOUT_RETEST`

Other strategies remain available as Research signals. `TJR_SIMPLE_STRUCTURE_PULLBACK_ENGINE` can be enabled programmatically only with the gatekeeper easy-mode option.

Every Production candidate is normalized through exactly six factors:

1. HTF bias alignment.
2. Killzone/session timing.
3. Liquidity sweep quality.
4. Displacement and close-based MSS/BOS strength.
5. Entry-zone quality.
6. Structural stop, structural target, and reward-to-risk quality.

London and New York require at least `3/6`. Asian and overlap sessions require at least `4/6`. Risk factor 6 is mandatory regardless of the total factor count. A dead-zone signal, non-structural stop, RR below `2.5R`, HTF obstacle, excessive spread, risk-limit breach, or oversized confirmation candle remains a hard rejection.

Structural stop priority:

1. Sweep extreme.
2. Order-block boundary.
3. FVG boundary.
4. Explicit retest extreme.
5. Confirmed recent swing.
6. ATR is added only as a buffer and width filter.

Structural target priority:

1. Clean HTF BSL/SSL.
2. HTF swing.
3. Previous-day extreme.
4. Session extreme.
5. Fixed `2.5R` only when no closer structural obstacle blocks the path.

The institutional score does not reuse the raw strategy score. It combines normalized factor count, RR, HTF context, session quality, stop quality, and target quality.

Risk defaults:

- 1% risk per trade.
- 2% only when aggressive risk is explicitly enabled.
- Stop after `3R` or 6% daily loss.
- Stop after `6R` or 12% weekly loss.
- Reduce risk by half after two consecutive losses.
- Stop for the day after three consecutive losses.
- Maximum three Production signals per day and one per session.
- Without full broker contract data, the result shows `LOT_SIZE_ESTIMATE_ONLY`; it does not claim a broker-valid lot size.

No-repaint behavior:

- Each candidate is evaluated with closed LTF/ITF/HTF candles at or before its confirmation timestamp.
- Future candles are excluded from stop, target, HTF context, and factor calculations.
- Final entry, structural SL, structural TP, RR, factor score, and evidence index are frozen in `institutionalNoRepaintProof`.

## How To Show Production Signals

1. Enable `Active`.
2. Set `Application mode` to `Production Institutional`.
3. Select `ALL_V2`, a custom basket, or a Production-enabled raw strategy.
4. Enable `Markers`.
5. Leave `Show raw research markers` off to display only `MASTER_BUY` and `MASTER_SELL`.
6. Read the `Institutional Master Gatekeeper` panel for the six factors, structural SL source, HTF target source, RR, killzone, HTF context, risk state, and warnings.

When no setup passes, the panel displays `NO_TRADE` and exact codes such as `RR_BELOW_2_5`, `STOP_NOT_STRUCTURAL`, `CONTINUATION_REJECTED_OUTSIDE_KILLZONE`, `HTF_LIQUIDITY_TARGET_TOO_CLOSE`, or `BUY_SELL_CONFLICT_UNRESOLVED`.

## How To Show Signals In The App

1. Start the app:

```bash
npm run dev
```

2. Open:

```text
http://localhost:3015
```

3. In the top form, choose:

- `Symbol`: normally `XAUUSD`.
- `Timeframe`: `1m`, `5m`, or `15m` are best supported by the V2 strategies.
- `Start date` and `End date`.

4. Click `Fetch`.

5. In `Strategy Activation`, enable `Active`.

6. Choose a strategy from the `Strategy` dropdown.

7. Enable `Markers`.

8. Read signals on the chart and in the tables below the chart.

## How To Show Master Signals

Optional master signal display is available in `Research` mode for any selected strategy, including `ALL_V2` and `Custom Multi Strategy`. It is OFF by default, so raw strategy signals are shown unless you enable it.

Steps:

1. Enable `Active`.
2. Keep `Application mode` set to `Research`.
3. Select `ALL_V2`, `Custom Multi Strategy`, or any raw strategy in the `Strategy` dropdown.
4. If using `Custom Multi Strategy`, choose any number of strategies in `Custom strategy basket`.
5. Enable `Markers`.
6. In `Master Selector`, turn on `Enable Master Selector`.
7. Use `Display Mode`.

| Display mode | What appears |
| --- | --- |
| `RAW_SIGNALS` | Every raw strategy signal. This is also what disabled mode shows. |
| `MASTER_SELECTED` | Only optional master-selected `MASTER BUY` and `MASTER SELL` markers. |
| `BOTH` | Optional master markers plus raw markers; suppressed duplicates can be shown as muted markers. |

Optional controls:

- `Optional Cooldown`: OFF by default. When enabled, suppresses repeated same-direction same-zone master signals.
- `Show suppressed signals`: controls whether suppressed raw signals appear in `BOTH` mode.
- `Show conflict warnings`: adds conflict warnings to selected master signals.

## How To Run Multiple Strategies Together

1. Enable `Active`.
2. Select `Custom Multi Strategy`.
3. In `Custom strategy basket`, tick the strategies you want.
4. Keep at least one selected. The UI allows selecting all raw strategies if desired.
5. Enable `Markers`.
6. Leave `Enable Master Selector` OFF to see every raw signal from the selected basket.
7. Turn `Enable Master Selector` ON only when you want grouped/deduplicated master output.
8. Use `Display Mode`:

- `RAW_SIGNALS` shows every signal from the selected strategy basket.
- `MASTER_SELECTED` shows only the selected master signals from that basket.
- `BOTH` shows selected master signals plus raw signals for audit.

Good example baskets:

- `Stock Guru Sweep FVG OB Engine` + `Pro Liquidity Confluence Engine` + `FVG Continuation Entry`.
- `ICT IFVG Reversal Engine` + `ICT OTE Continuation Engine` + `ICT Silver Bullet`.
- `Asian Range Breakout Retest` + `Goldmine Asian Sweep Reversal`.

Legacy behavior:

- `MASTER_SIGNAL_SELECTOR` may still be present in result data for compatibility.
- The visible Research master controls use `OPTIONAL_MASTER_SIGNAL_SELECTOR`.
- Raw signals are never deleted.

## Chart Marker Meaning

Raw strategy signals:

- BUY appears below the candle.
- SELL appears above the candle.
- Entry, SL, TP1, TP2, TP3, invalidation, and strategy-specific evidence lines are drawn when available.

Master signals:

- Master BUY/SELL markers are larger and gold.
- Marker text includes `MASTER BUY` or `MASTER SELL`, confluence count, and master score.
- Tooltip shows selected strategy, source strategies, confluence count, master score, confidence, entry, SL, TP, RR, and selection reason.

Suppressed raw signals in `Both` mode:

- Suppressed markers are smaller and gray.
- Tooltip shows that the signal was suppressed and why.
- Suppressed signals remain visible only for explanation; they are not final actionable master signals.

## Panels And Tables

When a strategy is active:

- `Master Signal Selector` panel appears in Research mode and shows OFF/raw mode or the optional selector's groups, final signals, suppressed signals, conflicts, and selected master trades.
- `Signal Debug Panel` shows strategy audit rows, rejected setups, pending confirmations, and optional master debug information.
- `Signal History Table` lists displayed signals. Optional master rows show `OPTIONAL_MASTER_SIGNAL_SELECTOR`, selected strategy, master score, confidence, and reason.
- Performance panel shows current visible signal count, pending count, rejected count, and scan timing in development.

## Programmatic Usage

Run one strategy:

```ts
import { generateV2Signals } from "./lib/v2-signal-engine/coordinator";

const result = generateV2Signals("FVG_CONTINUATION_ENTRY", input);
console.log(result.signals);
```

Run all strategies and then optionally enable master selection:

```ts
import { runSelectedStrategy } from "./lib/strategy-runner/run-selected-strategy";

const result = runSelectedStrategy("ALL_V2", input, {
  appMode: "RESEARCH",
  optionalMasterSelector: {
    enabled: true,
    displayMode: "MASTER_SELECTED",
  },
});

const rawSignals = result.optionalMasterSelection?.rawSignals ?? result.signals;
const masterSignals = result.optionalMasterSelection?.finalSignals ?? [];
const suppressed = result.optionalMasterSelection?.suppressedSignals ?? [];
```

Run a custom multi-strategy basket:

```ts
import { runSelectedStrategies } from "./lib/strategy-runner/run-selected-strategy";

const result = runSelectedStrategies([
  "STOCK_GURU_SWEEP_FVG_OB_ENGINE",
  "PRO_LIQUIDITY_CONFLUENCE_ENGINE",
  "FVG_CONTINUATION_ENTRY",
], input);
```

Run a custom basket with the optional master selector enabled:

```ts
const result = runSelectedStrategies([
  "STOCK_GURU_SWEEP_FVG_OB_ENGINE",
  "PRO_LIQUIDITY_CONFLUENCE_ENGINE",
  "FVG_CONTINUATION_ENTRY",
], input, {
  appMode: "RESEARCH",
  optionalMasterSelector: {
    enabled: true,
    displayMode: "MASTER_SELECTED",
    cooldownEnabled: false,
  },
});
```

Run the same basket through Production mode:

```ts
const result = runSelectedStrategies([
  "STOCK_GURU_SWEEP_FVG_OB_ENGINE",
  "ICT_SILVER_BULLET",
  "GOLDMINE_ASIAN_SWEEP_REVERSAL",
  "ASIAN_RANGE_BREAKOUT_RETEST",
], input, { appMode: "PRODUCTION" });

const productionAction = result.institutionalSelection?.action ?? "NO_TRADE";
const productionSignals = result.institutionalSelection?.finalSignals ?? [];
const exactNoTradeReasons = result.institutionalSelection?.debug.noTradeReasons ?? [];
```

Compare Research raw signals with Production institutional signals:

```ts
import { runInstitutionalBacktestComparison } from "./lib/backtesting/engine";

const comparison = runInstitutionalBacktestComparison(
  backtestInput,
  result.institutionalSelection!,
);
```

Choose chart display signals exactly like the UI:

```ts
import { getOptionalMasterDisplaySignals } from "./lib/v2-signal-engine/optional-master-signal-selector";

const displaySignals = result.optionalMasterSelection
  ? getOptionalMasterDisplaySignals(result.optionalMasterSelection, "MASTER_SELECTED")
  : result.signals;
```

Available optional display modes are `"RAW_SIGNALS"`, `"MASTER_SELECTED"`, and `"BOTH"`.

## Why You May See Only BUY Or Only SELL

Seeing only BUY or only SELL can be valid if the selected candle range only confirms one side. The engines do not force both directions.

Common reasons:

- The market structure and context are one-sided.
- SELL setups were detected but failed RR, stop width, session, confirmation, or score rules.
- If `Enable Master Selector` is ON, raw SELL signals may be suppressed by stronger BUY groups or marked `NO_TRADE` in conflict.
- A short date range may not include a full Asian range, retest, or confirmation window.
- `Markers` may be off, or the selected strategy may be a single raw strategy instead of `ALL_V2`.

To diagnose:

1. Select `ALL_V2`.
2. Leave `Enable Master Selector` OFF, or set `Display Mode` to `RAW_SIGNALS`.
3. Enable `Markers`.
4. Check the `Signal Debug Panel` for rejected SELL setups.
5. Turn `Enable Master Selector` ON and switch to `BOTH` to see whether SELL was suppressed by the optional master selector.

For a smaller check, select `Custom Multi Strategy` and run only the strategies you trust most.

## No-Repaint Contract

- Strategies only use candles with `isClosed === true`.
- A signal is timestamped at its confirmation candle.
- Entry, SL, TP, RR, score, and selected strategy are immutable after confirmation.
- Master signals freeze their own `masterNoRepaintProof`.
- Future candles may add later confluence, but they must not modify the original master trade levels.

Tests cover raw strategy behavior, master BUY/SELL grouping, duplicate suppression, conflict handling, display modes, and no-repaint behavior.
