/**
 * Thin wrapper around TradingView's Lightweight Charts (vendored in
 * js/vendor/), used only for the candle view. The line view keeps using
 * the hand-rolled canvas Graph class.
 */

// A fixed period (the textbook "20-day SMA") turned out to be a poor
// default here: this app's ranges span from ~5 candles (1W) to ~2600
// (10Y), and 20 is right at or below the candle count for the default 1M
// view - so by default the line was a near-invisible 1-3 point sliver at
// the very edge of the chart, not a fixed-period bug. Scaling the period
// to roughly a third of the visible candles (bounded so it's never
// meaninglessly short or absurdly long) keeps the average visible across
// most of the chart regardless of which range is selected.
function smaPeriodFor(candleCount) {
    return Math.min(50, Math.max(3, Math.floor(candleCount / 3)));
}

// Standard MACD periods (12/26/9) - unlike the SMA overlay, these aren't
// adaptive or user-configurable; they're the conventional values traders
// expect, and the indicator is only meaningful when compared like-for-like.
const MACD_FAST_PERIOD = 12;
const MACD_SLOW_PERIOD = 26;
const MACD_SIGNAL_PERIOD = 9;
const MACD_PANE_HEIGHT = 120;

// Standard Wilder RSI period.
const RSI_PERIOD = 14;
const RSI_PANE_HEIGHT = 100;

// Standard Wilder ADX period.
const ADX_PERIOD = 14;
const ADX_PANE_HEIGHT = 100;

// Dorsey's original Relative Volatility Index: a 10-period rolling
// standard deviation of closes, smoothed over 14 periods.
const RVI_STDEV_PERIOD = 10;
const RVI_SMOOTHING_PERIOD = 14;
const RVI_PANE_HEIGHT = 100;

// Fewest candles each fixed-period indicator needs before it draws
// anything at all - used to show a placeholder instead of a silently
// blank pane on short ranges (real, weekday-only FX data for the default
// 1Y range comfortably clears all four; 1W and 1M generally don't).
const MACD_MIN_CANDLES = MACD_SLOW_PERIOD;
const RSI_MIN_CANDLES = RSI_PERIOD + 1;
const ADX_MIN_CANDLES = ADX_PERIOD + 1;
const RVI_MIN_CANDLES = RVI_STDEV_PERIOD + RVI_SMOOTHING_PERIOD - 1;

// Exponential moving average of `values`, seeded with the SMA of the
// first `period` values (the conventional way to start an EMA without an
// arbitrary warm-up bias). Returned array is the same length as `values`,
// with indices before `period - 1` left undefined - callers that need a
// dense array should skip to that index.
export function calculateEMA(values, period) {
    if (values.length < period) {
        return [];
    }

    let result = [];
    let sum = 0;

    for (let i = 0; i < period; i++) {
        sum += values[i];
    }

    let prevEma = sum / period;
    result[period - 1] = prevEma;

    let k = 2 / (period + 1);

    for (let i = period; i < values.length; i++) {
        prevEma = values[i] * k + prevEma * (1 - k);
        result[i] = prevEma;
    }

    return result;
}

export function calculateMACD(candles, labels) {
    let closes = candles.map((candle) => candle.close);
    let fastEma = calculateEMA(closes, MACD_FAST_PERIOD);
    let slowEma = calculateEMA(closes, MACD_SLOW_PERIOD);

    let macdLine = [];
    let signalLine = [];
    let histogram = [];

    if (slowEma.length === 0) {
        return { macdLine, signalLine, histogram };
    }

    // MACD values only exist once the slow EMA does; carry both the
    // value and its original candle index so the eventual signal-line EMA
    // (computed over this dense sub-array) can be mapped back to dates.
    let macdValues = [];
    let macdIndices = [];

    for (let i = MACD_SLOW_PERIOD - 1; i < closes.length; i++) {
        macdValues.push(fastEma[i] - slowEma[i]);
        macdIndices.push(i);
    }

    let signalValues = calculateEMA(macdValues, MACD_SIGNAL_PERIOD);

    for (let j = 0; j < macdValues.length; j++) {
        let i = macdIndices[j];
        macdLine.push({ time: labels[i], value: macdValues[j] });

        if (signalValues[j] !== undefined) {
            let histValue = macdValues[j] - signalValues[j];

            signalLine.push({ time: labels[i], value: signalValues[j] });
            histogram.push({
                time: labels[i],
                value: histValue,
                color: histValue >= 0 ? "#1a9850" : "#d73027",
            });
        }
    }

    return { macdLine, signalLine, histogram };
}

function rsiFromAverages(avgGain, avgLoss) {
    // No losses at all over the window means nothing but gains - the
    // textbook 100/(1+RS) form divides by zero here, so this is handled
    // as its own case rather than relying on Infinity/NaN falling out
    // of the arithmetic.
    if (avgLoss === 0) {
        return 100;
    }

    let rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

// Wilder's RSI: the first average gain/loss is a simple average over the
// first `period` price changes, then each subsequent average rolls
// forward with Wilder smoothing (weight (period-1)/period on the running
// average, 1/period on the new change) - the original, still-conventional
// definition, distinct from a plain N-period average of changes.
export function calculateRSI(candles, labels) {
    let closes = candles.map((candle) => candle.close);

    if (closes.length < RSI_PERIOD + 1) {
        return [];
    }

    let gains = [];
    let losses = [];

    for (let i = 1; i < closes.length; i++) {
        let delta = closes[i] - closes[i - 1];
        gains.push(Math.max(delta, 0));
        losses.push(Math.max(-delta, 0));
    }

    let avgGain = gains.slice(0, RSI_PERIOD).reduce((sum, g) => sum + g, 0) / RSI_PERIOD;
    let avgLoss = losses.slice(0, RSI_PERIOD).reduce((sum, l) => sum + l, 0) / RSI_PERIOD;

    let result = [{ time: labels[RSI_PERIOD], value: rsiFromAverages(avgGain, avgLoss) }];

    for (let i = RSI_PERIOD; i < gains.length; i++) {
        avgGain = (avgGain * (RSI_PERIOD - 1) + gains[i]) / RSI_PERIOD;
        avgLoss = (avgLoss * (RSI_PERIOD - 1) + losses[i]) / RSI_PERIOD;

        // gains[i]/losses[i] is the change ending at closes[i + 1]
        result.push({ time: labels[i + 1], value: rsiFromAverages(avgGain, avgLoss) });
    }

    return result;
}

// Wilder's ADX: true range and directional movement per candle, Wilder-
// smoothed (seeded with a plain sum of the first `period` values, then
// each step rolls forward as prev - prev/period + current) into +DI/-DI,
// combined into DX, then DX itself Wilder-smoothed into ADX. No volume
// input - unlike VWAP, this is computable from OHLC alone, which is all
// either candle source actually provides for FX pairs.
export function calculateADX(candles, labels) {
    let tr = [];
    let plusDM = [];
    let minusDM = [];

    for (let i = 1; i < candles.length; i++) {
        let { high, low } = candles[i];
        let prevHigh = candles[i - 1].high;
        let prevLow = candles[i - 1].low;
        let prevClose = candles[i - 1].close;

        tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));

        let upMove = high - prevHigh;
        let downMove = prevLow - low;

        plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    // tr[k]/plusDM[k]/minusDM[k] is the change ending at candles[k + 1]

    if (tr.length < ADX_PERIOD) {
        return { plusDI: [], minusDI: [], adx: [] };
    }

    let smoothedTR = tr.slice(0, ADX_PERIOD).reduce((sum, v) => sum + v, 0);
    let smoothedPlusDM = plusDM.slice(0, ADX_PERIOD).reduce((sum, v) => sum + v, 0);
    let smoothedMinusDM = minusDM.slice(0, ADX_PERIOD).reduce((sum, v) => sum + v, 0);

    let plusDI = [];
    let minusDI = [];
    let dxValues = [];
    let dxIndices = [];

    function recordDI(candleIndex) {
        let plusDIValue = smoothedTR === 0 ? 0 : (100 * smoothedPlusDM) / smoothedTR;
        let minusDIValue = smoothedTR === 0 ? 0 : (100 * smoothedMinusDM) / smoothedTR;

        plusDI.push({ time: labels[candleIndex], value: plusDIValue });
        minusDI.push({ time: labels[candleIndex], value: minusDIValue });

        let diSum = plusDIValue + minusDIValue;
        dxValues.push(diSum === 0 ? 0 : (100 * Math.abs(plusDIValue - minusDIValue)) / diSum);
        dxIndices.push(candleIndex);
    }

    recordDI(ADX_PERIOD);

    for (let k = ADX_PERIOD; k < tr.length; k++) {
        smoothedTR = smoothedTR - smoothedTR / ADX_PERIOD + tr[k];
        smoothedPlusDM = smoothedPlusDM - smoothedPlusDM / ADX_PERIOD + plusDM[k];
        smoothedMinusDM = smoothedMinusDM - smoothedMinusDM / ADX_PERIOD + minusDM[k];

        recordDI(k + 1);
    }

    let adx = [];

    if (dxValues.length >= ADX_PERIOD) {
        let avgDX = dxValues.slice(0, ADX_PERIOD).reduce((sum, v) => sum + v, 0) / ADX_PERIOD;
        adx.push({ time: labels[dxIndices[ADX_PERIOD - 1]], value: avgDX });

        for (let k = ADX_PERIOD; k < dxValues.length; k++) {
            avgDX = (avgDX * (ADX_PERIOD - 1) + dxValues[k]) / ADX_PERIOD;
            adx.push({ time: labels[dxIndices[k]], value: avgDX });
        }
    }

    return { plusDI, minusDI, adx };
}

function standardDeviation(values) {
    let mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    let variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

// Dorsey's Relative Volatility Index: RSI's up/down-stream arithmetic
// applied to a rolling standard deviation of closes instead of to price
// changes themselves - a given day's stdev is credited entirely to an
// "up" or "down" stream depending on whether that day's close rose or
// fell, both streams are EMA-smoothed, and RVI is the up stream's share
// of the total, as a percentage.
export function calculateRVI(candles, labels) {
    let closes = candles.map((candle) => candle.close);

    if (closes.length < RVI_STDEV_PERIOD) {
        return [];
    }

    let upStream = [];
    let downStream = [];
    let streamIndices = [];

    for (let i = RVI_STDEV_PERIOD - 1; i < closes.length; i++) {
        let window = closes.slice(i - RVI_STDEV_PERIOD + 1, i + 1);
        let stdev = standardDeviation(window);

        if (closes[i] > closes[i - 1]) {
            upStream.push(stdev);
            downStream.push(0);
        } else if (closes[i] < closes[i - 1]) {
            upStream.push(0);
            downStream.push(stdev);
        } else {
            upStream.push(0);
            downStream.push(0);
        }

        streamIndices.push(i);
    }

    if (upStream.length < RVI_SMOOTHING_PERIOD) {
        return [];
    }

    let emaUp = calculateEMA(upStream, RVI_SMOOTHING_PERIOD);
    let emaDown = calculateEMA(downStream, RVI_SMOOTHING_PERIOD);

    let result = [];

    for (let j = RVI_SMOOTHING_PERIOD - 1; j < upStream.length; j++) {
        let total = emaUp[j] + emaDown[j];
        // Unlike RSI's avgLoss===0 case (which means "only gains, pin to
        // the max"), zero total here means neither stream has any
        // smoothed volatility to report - genuinely undefined, not
        // "all one direction", so this falls to the neutral midpoint
        // rather than to 100.
        let value = total === 0 ? 50 : (100 * emaUp[j]) / total;

        result.push({ time: labels[streamIndices[j]], value });
    }

    return result;
}

export class CandleChart {
    constructor(containerId) {
        this.container = document.getElementById(containerId);

        this.chart = LightweightCharts.createChart(this.container, {
            layout: {
                textColor: "#000066",
                background: { type: "solid", color: "white" },
            },
            grid: {
                vertLines: { color: "#b8c8cf" },
                horzLines: { color: "#b8c8cf" },
            },
            timeScale: { borderColor: "#b8c8cf" },
            rightPriceScale: { borderColor: "#b8c8cf" },
            width: this.container.clientWidth,
            height: this.container.clientHeight,
        });

        this.series = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: "#1a9850",
            downColor: "#d73027",
            borderUpColor: "#1a9850",
            borderDownColor: "#d73027",
            wickUpColor: "#1a9850",
            wickDownColor: "#d73027",
        });

        this.smaSeries = this.chart.addSeries(LightweightCharts.LineSeries, {
            color: "#ff9800",
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });

        this.macdLineSeries = this.chart.addSeries(
            LightweightCharts.LineSeries,
            { color: "#2196f3", lineWidth: 1, priceLineVisible: false },
            1
        );
        this.signalLineSeries = this.chart.addSeries(
            LightweightCharts.LineSeries,
            { color: "#e91e63", lineWidth: 1, priceLineVisible: false },
            1
        );
        this.histogramSeries = this.chart.addSeries(
            LightweightCharts.HistogramSeries,
            { priceLineVisible: false, lastValueVisible: false },
            1
        );

        this.rsiSeries = this.chart.addSeries(
            LightweightCharts.LineSeries,
            { color: "#9c27b0", lineWidth: 1, priceLineVisible: false },
            2
        );
        // Conventional overbought/oversold reference lines - not part of
        // the series data itself, just fixed guides on its own price scale.
        this.rsiSeries.createPriceLine({
            price: 70,
            color: "#b8c8cf",
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
        });
        this.rsiSeries.createPriceLine({
            price: 30,
            color: "#b8c8cf",
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
        });

        this.plusDISeries = this.chart.addSeries(
            LightweightCharts.LineSeries,
            { color: "#1a9850", lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
            3
        );
        this.minusDISeries = this.chart.addSeries(
            LightweightCharts.LineSeries,
            { color: "#d73027", lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
            3
        );
        this.adxSeries = this.chart.addSeries(
            LightweightCharts.LineSeries,
            { color: "#3f51b5", lineWidth: 2, priceLineVisible: false },
            3
        );
        // Conventional "trending market" reference line.
        this.adxSeries.createPriceLine({
            price: 25,
            color: "#b8c8cf",
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
        });

        this.rviSeries = this.chart.addSeries(
            LightweightCharts.LineSeries,
            { color: "#009688", lineWidth: 2, priceLineVisible: false },
            4
        );
        // Midline: above it, volatility on up days dominates; below it,
        // volatility on down days does.
        this.rviSeries.createPriceLine({
            price: 50,
            color: "#b8c8cf",
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
        });

        window.addEventListener("resize", () => this.resize());

        this.lastCandles = null;
        this.lastLabels = null;

        // Overlay elements shown instead of a silently blank pane when
        // there isn't yet enough data for that indicator - each is
        // positioned to exactly cover its pane in applyPaneHeights().
        this.macdPlaceholder = this.createPlaceholder("macd");
        this.rsiPlaceholder = this.createPlaceholder("rsi");
        this.adxPlaceholder = this.createPlaceholder("adx");
        this.rviPlaceholder = this.createPlaceholder("rvi");

        // Always-visible name tags: the price-scale badges (e.g. "45.83")
        // and reference lines give no indication of which indicator a
        // pane actually is, unlike the candlestick pane which is
        // identified elsewhere (page header, subtitle).
        this.macdLabel = this.createPaneLabel("macd", "MACD (12, 26, 9)");
        this.rsiLabel = this.createPaneLabel("rsi", "RSI (14)");
        this.adxLabel = this.createPaneLabel("adx", "ADX (14)");
        this.rviLabel = this.createPaneLabel("rvi", "RVI (10, 14)");

        this.applyPaneHeights();
    }

    createPlaceholder(indicator) {
        let element = document.createElement("div");
        element.className = "indicator-placeholder";
        element.dataset.indicator = indicator;
        this.container.appendChild(element);
        return element;
    }

    createPaneLabel(indicator, text) {
        let element = document.createElement("div");
        element.className = "indicator-pane-label";
        element.dataset.indicatorLabel = indicator;
        element.textContent = text;
        this.container.appendChild(element);
        return element;
    }

    // Shows/hides one indicator's placeholder based on whether the current
    // candle count clears that indicator's minimum, and keeps its message
    // in sync (candle counts change every time setData runs).
    updatePlaceholder(element, label, candleCount, minCandles) {
        if (candleCount >= minCandles) {
            element.style.display = "none";
            return;
        }

        element.textContent = `${label} needs ${minCandles}+ candles (have ${candleCount}) - try a longer range`;
        element.style.display = "flex";
    }

    // The placeholder <div>s are only visible to sighted users: #candleChart
    // has role="img", and per the ARIA img role's semantics, an element's
    // accessible name comes solely from its aria-label - descendant text
    // isn't exposed to assistive tech at all, so without this, a screen
    // reader user gets no indication these panes are empty or why. main.js
    // sets the base aria-label immediately before calling setData() on
    // every fetch, so it's always the fresh base here, safe to append to.
    announceShortIndicators(candleCount) {
        let short = [];

        if (candleCount < MACD_MIN_CANDLES) short.push(`MACD needs ${MACD_MIN_CANDLES}+ candles`);
        if (candleCount < RSI_MIN_CANDLES) short.push(`RSI needs ${RSI_MIN_CANDLES}+ candles`);
        if (candleCount < ADX_MIN_CANDLES) short.push(`ADX needs ${ADX_MIN_CANDLES}+ candles`);
        if (candleCount < RVI_MIN_CANDLES) short.push(`RVI needs ${RVI_MIN_CANDLES}+ candles`);

        if (short.length === 0) {
            return;
        }

        let baseLabel = this.container.getAttribute("aria-label") || "";

        this.container.setAttribute(
            "aria-label",
            `${baseLabel} - ${short.join(", ")} (have ${candleCount}) - try a longer range`
        );
    }

    // Keeps the MACD/RSI/ADX/RVI panes at fixed heights and gives the rest
    // to the candlestick pane, so the split stays sane as the container
    // resizes - and keeps each placeholder positioned over its own pane.
    //
    // Uses stretch factors, not setHeight(): setHeight() in this vendored
    // build turned out to apply as a *multiplicative* adjustment against
    // the pane's current (already-rendered) height, not an absolute
    // assignment - calling it repeatedly (once in the constructor, while
    // the container is still hidden/zero-height, and again on every
    // resize()) compounded into an astronomical, identical stretch factor
    // on every pane, which made them render as equal-height regardless of
    // the numbers passed in. Stretch factors set directly, every time,
    // don't have that compounding problem - and since #candleChart's CSS
    // height is exactly the sum of these constants, using the constants
    // themselves as weights reproduces the exact intended pixel split.
    applyPaneHeights() {
        let panes = this.chart.panes();

        if (panes.length > 4) {
            let candlePaneHeight = Math.max(
                this.container.clientHeight -
                    MACD_PANE_HEIGHT -
                    RSI_PANE_HEIGHT -
                    ADX_PANE_HEIGHT -
                    RVI_PANE_HEIGHT,
                0
            );

            panes[0].setStretchFactor(candlePaneHeight);
            panes[1].setStretchFactor(MACD_PANE_HEIGHT);
            panes[2].setStretchFactor(RSI_PANE_HEIGHT);
            panes[3].setStretchFactor(ADX_PANE_HEIGHT);
            panes[4].setStretchFactor(RVI_PANE_HEIGHT);

            let macdTop = candlePaneHeight;
            let rsiTop = macdTop + MACD_PANE_HEIGHT;
            let adxTop = rsiTop + RSI_PANE_HEIGHT;
            let rviTop = adxTop + ADX_PANE_HEIGHT;

            this.macdPlaceholder.style.top = `${macdTop}px`;
            this.macdPlaceholder.style.height = `${MACD_PANE_HEIGHT}px`;
            this.rsiPlaceholder.style.top = `${rsiTop}px`;
            this.rsiPlaceholder.style.height = `${RSI_PANE_HEIGHT}px`;
            this.adxPlaceholder.style.top = `${adxTop}px`;
            this.adxPlaceholder.style.height = `${ADX_PANE_HEIGHT}px`;
            this.rviPlaceholder.style.top = `${rviTop}px`;
            this.rviPlaceholder.style.height = `${RVI_PANE_HEIGHT}px`;

            this.macdLabel.style.top = `${macdTop}px`;
            this.rsiLabel.style.top = `${rsiTop}px`;
            this.adxLabel.style.top = `${adxTop}px`;
            this.rviLabel.style.top = `${rviTop}px`;
        }
    }

    // Returns the actual SMA period used (the override if valid, otherwise
    // the adaptive default), so callers can reflect it back to the user.
    setData(candles, labels, periodOverride) {
        this.series.setData(
            candles.map((candle, i) => ({
                time: labels[i],
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
            }))
        );

        this.lastCandles = candles;
        this.lastLabels = labels;

        let { macdLine, signalLine, histogram } = calculateMACD(candles, labels);
        this.macdLineSeries.setData(macdLine);
        this.signalLineSeries.setData(signalLine);
        this.histogramSeries.setData(histogram);

        this.rsiSeries.setData(calculateRSI(candles, labels));

        let { plusDI, minusDI, adx } = calculateADX(candles, labels);
        this.plusDISeries.setData(plusDI);
        this.minusDISeries.setData(minusDI);
        this.adxSeries.setData(adx);

        this.rviSeries.setData(calculateRVI(candles, labels));

        this.updatePlaceholder(this.macdPlaceholder, "MACD", candles.length, MACD_MIN_CANDLES);
        this.updatePlaceholder(this.rsiPlaceholder, "RSI", candles.length, RSI_MIN_CANDLES);
        this.updatePlaceholder(this.adxPlaceholder, "ADX", candles.length, ADX_MIN_CANDLES);
        this.updatePlaceholder(this.rviPlaceholder, "RVI", candles.length, RVI_MIN_CANDLES);
        this.announceShortIndicators(candles.length);

        this.chart.timeScale().fitContent();

        return this.redrawSMA(periodOverride);
    }

    // Empties every series and forgets the last-drawn candles, so a chart
    // left showing one currency pair's data doesn't keep displaying it
    // (looking current) after a fetch for a different pair/range fails.
    clear() {
        this.series.setData([]);
        this.smaSeries.setData([]);
        this.macdLineSeries.setData([]);
        this.signalLineSeries.setData([]);
        this.histogramSeries.setData([]);
        this.rsiSeries.setData([]);
        this.plusDISeries.setData([]);
        this.minusDISeries.setData([]);
        this.adxSeries.setData([]);
        this.rviSeries.setData([]);

        // A fetch failure isn't "not enough data yet" - hide the
        // placeholders rather than show a misleading candle count.
        this.macdPlaceholder.style.display = "none";
        this.rsiPlaceholder.style.display = "none";
        this.adxPlaceholder.style.display = "none";
        this.rviPlaceholder.style.display = "none";

        this.lastCandles = null;
        this.lastLabels = null;
    }

    // Recomputes just the SMA overlay against the most recently drawn
    // candles, without touching the candlestick series or re-fetching -
    // used when the user changes the SMA period via the input field.
    redrawSMA(periodOverride) {
        // A period longer than the candle count can never produce a line
        // (calculateSMA needs at least `period` candles to average) - an
        // override like that must fall back to the adaptive default too,
        // the same as an out-of-range one, so the "SMA(n)" label shown to
        // the user always matches a line that's actually on the chart.
        let isValidOverride =
            Number.isInteger(periodOverride) &&
            periodOverride >= 2 &&
            periodOverride <= this.lastCandles.length;

        let period = isValidOverride ? periodOverride : smaPeriodFor(this.lastCandles.length);

        this.smaSeries.setData(this.calculateSMA(this.lastCandles, this.lastLabels, period));

        return period;
    }

    calculateSMA(candles, labels, period) {
        if (candles.length < period) {
            return [];
        }

        let result = [];

        for (let i = period - 1; i < candles.length; i++) {
            let sum = 0;

            for (let j = i - period + 1; j <= i; j++) {
                sum += candles[j].close;
            }

            result.push({ time: labels[i], value: sum / period });
        }

        return result;
    }

    resize() {
        this.chart.applyOptions({
            width: this.container.clientWidth,
            height: this.container.clientHeight,
        });

        this.applyPaneHeights();
    }

    show() {
        this.container.classList.remove("hide");
        this.resize();
    }

    hide() {
        this.container.classList.add("hide");
    }
}
