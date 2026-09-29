const { test, expect } = require("@playwright/test");

// These test the pure calculation functions directly (via dynamic import
// in the page, since they're plain ES module exports) rather than only
// checking that *something* rendered - the rendering-level tests
// (macd.spec.js, sma-period.spec.js) already cover that a line with the
// right color appears in the right place; these check the numbers going
// into it are actually correct.

async function importCandleChart(page) {
    await page.goto("/");
    return page.evaluateHandle(() => import("/js/graph/candleChart.js"));
}

function candlesFromCloses(closes) {
    return closes.map((close, i) => ({
        open: close,
        high: close,
        low: close,
        close,
    }));
}

function labelsFor(closes) {
    return closes.map((_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
}

test("calculateEMA: SMA-seeded EMA(5) of 1..10 matches the hand-computed values", async ({ page }) => {
    let mod = await importCandleChart(page);

    let result = await page.evaluate(
        ([mod]) => mod.calculateEMA([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5),
        [mod]
    );

    // Seed (index 4) = average of 1..5 = 3. k = 2/6 = 1/3. Each subsequent
    // step on a run of consecutive integers with this seed lands on a
    // whole number by construction - verified by hand below:
    //   i=5 (v=6): 6/3 + 3*2/3 = 2 + 2 = 4
    //   i=6 (v=7): 7/3 + 4*2/3 = 5
    //   i=7 (v=8): 8/3 + 5*2/3 = 6
    //   i=8 (v=9): 9/3 + 6*2/3 = 7
    //   i=9 (v=10): 10/3 + 7*2/3 = 8
    expect(result[0]).toBeUndefined();
    expect(result[3]).toBeUndefined();
    expect(result[4]).toBeCloseTo(3, 9);
    expect(result[5]).toBeCloseTo(4, 9);
    expect(result[6]).toBeCloseTo(5, 9);
    expect(result[7]).toBeCloseTo(6, 9);
    expect(result[8]).toBeCloseTo(7, 9);
    expect(result[9]).toBeCloseTo(8, 9);
});

test("calculateEMA: fewer values than the period returns an empty array", async ({ page }) => {
    let mod = await importCandleChart(page);

    let result = await page.evaluate(([mod]) => mod.calculateEMA([1, 2, 3], 5), [mod]);

    expect(result).toEqual([]);
});

test("calculateMACD: the MACD line is exactly fastEMA - slowEMA, and the histogram is macd - signal", async ({ page }) => {
    let mod = await importCandleChart(page);

    // Deterministic non-linear series (so fast/slow EMAs actually diverge)
    let closes = Array.from({ length: 40 }, (_, i) => 60 + Math.sin(i / 4) * 5);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let { fastEma, slowEma, macd } = await page.evaluate(
        ([mod, candles, labels]) => {
            let closes = candles.map((c) => c.close);
            return {
                fastEma: mod.calculateEMA(closes, 12),
                slowEma: mod.calculateEMA(closes, 26),
                macd: mod.calculateMACD(candles, labels),
            };
        },
        [mod, candles, labels]
    );

    // 40 candles, slow period 26 -> 15 MACD points (indices 25..39)
    expect(macd.macdLine).toHaveLength(40 - 25);

    for (let point of macd.macdLine) {
        let i = labels.indexOf(point.time);
        expect(point.value).toBeCloseTo(fastEma[i] - slowEma[i], 9);
    }

    // Signal is a 9-period EMA of the (dense) MACD line -> first 8 MACD
    // points have no signal/histogram yet
    expect(macd.signalLine).toHaveLength(macd.macdLine.length - 8);
    expect(macd.histogram).toHaveLength(macd.signalLine.length);

    for (let i = 0; i < macd.histogram.length; i++) {
        expect(macd.histogram[i].time).toBe(macd.signalLine[i].time);
        expect(macd.histogram[i].value).toBeCloseTo(
            macd.macdLine[i + 8].value - macd.signalLine[i].value,
            9
        );
        expect(macd.histogram[i].color).toBe(macd.histogram[i].value >= 0 ? "#1a9850" : "#d73027");
    }
});

test("calculateMACD: too few candles for the slow EMA returns all-empty results, not a crash", async ({ page }) => {
    let mod = await importCandleChart(page);

    let closes = Array.from({ length: 10 }, (_, i) => 60 + i);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateMACD(candles, labels),
        [mod, candles, labels]
    );

    expect(result).toEqual({ macdLine: [], signalLine: [], histogram: [] });
});

test("calculateRSI: a strictly rising series (no losses) is 100 at every point", async ({ page }) => {
    let mod = await importCandleChart(page);

    let closes = Array.from({ length: 30 }, (_, i) => 50 + i);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateRSI(candles, labels),
        [mod, candles, labels]
    );

    expect(result.length).toBe(30 - 14);
    for (let point of result) {
        expect(point.value).toBeCloseTo(100, 9);
    }
});

test("calculateRSI: a strictly falling series (no gains) is 0 at every point", async ({ page }) => {
    let mod = await importCandleChart(page);

    let closes = Array.from({ length: 30 }, (_, i) => 80 - i);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateRSI(candles, labels),
        [mod, candles, labels]
    );

    expect(result.length).toBe(30 - 14);
    for (let point of result) {
        expect(point.value).toBeCloseTo(0, 9);
    }
});

test("calculateRSI: a flat series (no gains or losses) is 100 by this implementation's zero-loss rule", async ({ page }) => {
    let mod = await importCandleChart(page);

    let closes = Array.from({ length: 20 }, () => 60);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateRSI(candles, labels),
        [mod, candles, labels]
    );

    for (let point of result) {
        expect(point.value).toBe(100);
    }
});

test("calculateRSI: fewer than period+1 candles returns an empty array", async ({ page }) => {
    let mod = await importCandleChart(page);

    let closes = Array.from({ length: 14 }, (_, i) => 60 + i);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateRSI(candles, labels),
        [mod, candles, labels]
    );

    expect(result).toEqual([]);
});

test("calculateADX: a strictly rising series (degenerate high=low=close) is +DI=100, -DI=0, ADX=100", async ({ page }) => {
    let mod = await importCandleChart(page);

    // high===low===close every candle -> true range is exactly the size
    // of each day's move, and every move is "up" - by hand: smoothed TR
    // and smoothed +DM are equal every step (both track the constant
    // 1-unit move), smoothed -DM stays 0, so +DI=100, -DI=0, DX=100 -
    // ADX (itself a rolling average of a constant 100) is then also 100.
    let closes = Array.from({ length: 30 }, (_, i) => 50 + i);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateADX(candles, labels),
        [mod, candles, labels]
    );

    expect(result.plusDI.length).toBeGreaterThan(0);
    expect(result.adx.length).toBeGreaterThan(0);

    for (let point of result.plusDI) {
        expect(point.value).toBeCloseTo(100, 9);
    }
    for (let point of result.minusDI) {
        expect(point.value).toBeCloseTo(0, 9);
    }
    for (let point of result.adx) {
        expect(point.value).toBeCloseTo(100, 9);
    }
});

test("calculateADX: a strictly falling series is +DI=0, -DI=100, ADX=100 (trend strength, not direction)", async ({ page }) => {
    let mod = await importCandleChart(page);

    let closes = Array.from({ length: 30 }, (_, i) => 80 - i);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateADX(candles, labels),
        [mod, candles, labels]
    );

    for (let point of result.plusDI) {
        expect(point.value).toBeCloseTo(0, 9);
    }
    for (let point of result.minusDI) {
        expect(point.value).toBeCloseTo(100, 9);
    }
    for (let point of result.adx) {
        expect(point.value).toBeCloseTo(100, 9);
    }
});

test("calculateADX: a flat series (no movement) is 0 across +DI/-DI/ADX, not NaN", async ({ page }) => {
    let mod = await importCandleChart(page);

    let closes = Array.from({ length: 30 }, () => 60);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateADX(candles, labels),
        [mod, candles, labels]
    );

    expect(result.adx.length).toBeGreaterThan(0);
    for (let point of [...result.plusDI, ...result.minusDI, ...result.adx]) {
        expect(point.value).toBe(0);
    }
});

test("calculateADX: enough candles for +DI/-DI but not yet for ADX returns a populated DI and an empty ADX", async ({ page }) => {
    let mod = await importCandleChart(page);

    // 15 candles -> exactly one +DI/-DI point (14 diffs = the period),
    // but ADX itself needs `period` DX points before its first value.
    let closes = Array.from({ length: 15 }, (_, i) => 60 + i);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateADX(candles, labels),
        [mod, candles, labels]
    );

    expect(result.plusDI.length).toBe(1);
    expect(result.minusDI.length).toBe(1);
    expect(result.adx).toEqual([]);
});

test("calculateADX: too few candles for even the first +DI/-DI returns all-empty results, not a crash", async ({ page }) => {
    let mod = await importCandleChart(page);

    let closes = Array.from({ length: 10 }, (_, i) => 60 + i);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateADX(candles, labels),
        [mod, candles, labels]
    );

    expect(result).toEqual({ plusDI: [], minusDI: [], adx: [] });
});

test("calculateRVI: a strictly rising series is 100 at every point (all volatility credited to the up stream)", async ({ page }) => {
    let mod = await importCandleChart(page);

    // Every day closes higher than the last, so the down stream is 0
    // throughout and EMA(down) stays 0 - the up/(up+down) ratio is then
    // exactly 100 regardless of the actual stdev values involved.
    let closes = Array.from({ length: 30 }, (_, i) => 50 + i);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateRVI(candles, labels),
        [mod, candles, labels]
    );

    expect(result.length).toBeGreaterThan(0);
    for (let point of result) {
        expect(point.value).toBeCloseTo(100, 9);
    }
});

test("calculateRVI: a strictly falling series is 0 at every point", async ({ page }) => {
    let mod = await importCandleChart(page);

    let closes = Array.from({ length: 30 }, (_, i) => 80 - i);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateRVI(candles, labels),
        [mod, candles, labels]
    );

    expect(result.length).toBeGreaterThan(0);
    for (let point of result) {
        expect(point.value).toBeCloseTo(0, 9);
    }
});

test("calculateRVI: a flat series (zero volatility) is the neutral 50, not NaN", async ({ page }) => {
    let mod = await importCandleChart(page);

    let closes = Array.from({ length: 30 }, () => 60);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateRVI(candles, labels),
        [mod, candles, labels]
    );

    expect(result.length).toBeGreaterThan(0);
    for (let point of result) {
        expect(point.value).toBe(50);
    }
});

test("calculateRVI: too few candles for the rolling stdev returns an empty array", async ({ page }) => {
    let mod = await importCandleChart(page);

    let closes = Array.from({ length: 5 }, (_, i) => 60 + i);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateRVI(candles, labels),
        [mod, candles, labels]
    );

    expect(result).toEqual([]);
});

test("calculateRVI: enough candles for the stdev stream but not for the smoothing returns an empty array", async ({ page }) => {
    let mod = await importCandleChart(page);

    // 15 candles -> 6 stdev-stream points, short of the 14 needed to seed
    // the EMA smoothing.
    let closes = Array.from({ length: 15 }, (_, i) => 60 + i);
    let candles = candlesFromCloses(closes);
    let labels = labelsFor(closes);

    let result = await page.evaluate(
        ([mod, candles, labels]) => mod.calculateRVI(candles, labels),
        [mod, candles, labels]
    );

    expect(result).toEqual([]);
});
