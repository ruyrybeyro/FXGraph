const { test, expect } = require("@playwright/test");

function candleBody(count) {
    let values = [];
    for (let i = 0; i < count; i++) {
        let date = new Date(Date.UTC(2026, 8, 21) - i * 86400000);
        values.push({
            datetime: date.toISOString().slice(0, 10),
            open: "60",
            high: "61",
            low: "59",
            close: "60",
        });
    }
    return JSON.stringify({ status: "ok", values });
}

test("SMA period input is hidden in line mode, shown in candle mode", async ({ page }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(25) })
    );

    await page.goto("/");

    await expect(page.locator("#smaPeriodInput")).toBeHidden();

    await page.click("#candleToggleBtn");
    await expect(page.locator("#smaPeriodInput")).toBeVisible();

    await page.click("#candleToggleBtn");
    await expect(page.locator("#smaPeriodInput")).toBeHidden();
});

test("default period is the adaptive formula, shown in the subtitle", async ({ page }) => {
    // 25 candles -> floor(25 / 3) = 8, within the [3, 50] bounds
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(25) })
    );

    await page.goto("/");
    await page.click("#candleToggleBtn");

    await expect(page.locator("#dataSourceLabel")).toHaveText("Twelve Data OHLC Chart · SMA(8)");
});

test("typing a custom period redraws the SMA and updates the subtitle without re-fetching", async ({ page }) => {
    let requestCount = 0;

    await page.route("**/api/candles/twelvedata**", (route) => {
        requestCount++;
        return route.fulfill({ status: 200, contentType: "application/json", body: candleBody(25) });
    });

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await expect(page.locator("#dataSourceLabel")).toHaveText("Twelve Data OHLC Chart · SMA(8)");

    await page.fill("#smaPeriodInput", "5");
    await expect(page.locator("#dataSourceLabel")).toHaveText("Twelve Data OHLC Chart · SMA(5)");

    // Clearing the field reverts to the adaptive default
    await page.fill("#smaPeriodInput", "");
    await expect(page.locator("#dataSourceLabel")).toHaveText("Twelve Data OHLC Chart · SMA(8)");

    expect(requestCount).toBe(1);
});

test("an out-of-range or non-numeric period falls back to the adaptive default", async ({ page }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(25) })
    );

    await page.goto("/");
    await page.click("#candleToggleBtn");

    // Below the HTML min of 2 - CandleChart.redrawSMA must reject it too,
    // not just rely on the <input min> (which doesn't block programmatic
    // or malformed values)
    await page.fill("#smaPeriodInput", "1");
    await expect(page.locator("#dataSourceLabel")).toHaveText("Twelve Data OHLC Chart · SMA(8)");
});

test("a period longer than the candle count falls back to the default instead of labeling a line that isn't drawn", async ({ page }) => {
    // 25 candles - a period of 500 is still longer than the candle count,
    // so it can never produce an SMA point; the label must not claim it did
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(25) })
    );

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await expect(page.locator("#dataSourceLabel")).toHaveText("Twelve Data OHLC Chart · SMA(8)");

    await page.fill("#smaPeriodInput", "500");
    await expect(page.locator("#dataSourceLabel")).toHaveText("Twelve Data OHLC Chart · SMA(8)");
});
