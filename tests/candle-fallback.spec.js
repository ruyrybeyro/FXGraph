const { test, expect } = require("@playwright/test");

const YAHOO_OK_BODY = JSON.stringify({
    chart: {
        result: [
            {
                meta: {},
                timestamp: [1758499200],
                indicators: {
                    quote: [{ open: [1], high: [2], low: [0.5], close: [1.5] }],
                },
            },
        ],
        error: null,
    },
});

test("Twelve Data is used when it succeeds", async ({ page }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                status: "ok",
                values: [
                    { datetime: "2026-09-21", open: "1", high: "2", low: "0.5", close: "1.5" },
                ],
            }),
        })
    );

    await page.goto("/");
    await page.click("#candleToggleBtn");

    await expect(page.locator("#dataSourceLabel")).toHaveText(/^Twelve Data OHLC Chart · SMA\(\d+\)$/);
});

test("falls back to Yahoo Finance when Twelve Data fails", async ({ page }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({
            status: 429,
            contentType: "application/json",
            body: JSON.stringify({ status: "error" }),
        })
    );
    await page.route("**/api/yahoo/**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: YAHOO_OK_BODY })
    );

    await page.goto("/");
    await page.click("#candleToggleBtn");

    await expect(page.locator("#dataSourceLabel")).toHaveText(/^Yahoo Finance OHLC Chart · SMA\(\d+\)$/);
});

test("shows an error (not a crash or stale Frankfurter label) when both candle sources fail", async ({ page }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 500, body: "error" })
    );
    // Malformed response (e.g. a misconfigured proxy returning HTML) -
    // this is exactly the class of bug that used to throw uncaught
    await page.route("**/api/yahoo/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: "<html>502</html>" })
    );

    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e));

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);

    await expect(page.locator("#statusMessage")).toHaveClass(/error/);
    await expect(page.locator("#dataSourceLabel")).not.toHaveText(/Frankfurter/);
    expect(pageErrors).toHaveLength(0);
});

test("a failed re-fetch clears the previous pair's stale candles instead of leaving them on screen", async ({ page }) => {
    let shouldSucceed = true;

    await page.route("**/api/candles/twelvedata**", (route) => {
        if (shouldSucceed) {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    status: "ok",
                    // Twelve Data returns newest-first (see main.js's
                    // fetchTwelveDataCandles, which reverses this order) -
                    // matching that order here matters, since Lightweight
                    // Charts requires ascending time and silently fails to
                    // render anything if the parsed result isn't sorted.
                    values: [
                        { datetime: "2026-09-21", open: "1.5", high: "2.5", low: "1", close: "2" },
                        { datetime: "2026-09-20", open: "1", high: "2", low: "0.5", close: "1.5" },
                    ],
                }),
            });
        }
        return route.fulfill({ status: 500, body: "error" });
    });
    await page.route("**/api/yahoo/**", (route) => route.fulfill({ status: 500, body: "error" }));

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await expect(page.locator("#dataSourceLabel")).toHaveText(/^Twelve Data OHLC Chart · SMA\(\d+\)$/);

    // Candle up-color (also the MACD histogram's up-color) should be on
    // screen now - confirms there's actually something to clear below.
    const hasGreen = () =>
        page.evaluate(() => {
            const canvases = document.querySelectorAll("#candleChart canvas");
            for (const canvas of canvases) {
                const ctx = canvas.getContext("2d");
                if (!ctx) continue;
                let data;
                try {
                    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                } catch (e) {
                    continue;
                }
                for (let p = 0; p < data.length; p += 4) {
                    if (
                        Math.abs(data[p] - 26) < 15 &&
                        Math.abs(data[p + 1] - 152) < 15 &&
                        Math.abs(data[p + 2] - 80) < 15 &&
                        data[p + 3] > 0
                    ) {
                        return true;
                    }
                }
            }
            return false;
        });

    // Canvas painting happens on a later frame than setData() returns, so
    // poll rather than assume one render has already happened.
    await expect.poll(hasGreen).toBe(true);

    // Now make the next fetch fail (both sources) and trigger a re-fetch
    // for the same pair by switching date range.
    shouldSucceed = false;
    await page.click(".date-btn:has-text('1Y')");

    await expect(page.locator("#statusMessage")).toHaveClass(/error/);
    await expect(page.locator("#dataSourceLabel")).toHaveText("OHLC Candle Chart");
    await expect.poll(hasGreen).toBe(false);
});

test("an empty-but-valid result does not crash the chart", async ({ page }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ status: "ok", values: [] }),
        })
    );
    await page.route("**/api/yahoo/**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                chart: {
                    result: [
                        {
                            meta: {},
                            timestamp: [],
                            indicators: { quote: [{ open: [], high: [], low: [], close: [] }] },
                        },
                    ],
                    error: null,
                },
            }),
        })
    );

    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e));

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);

    expect(pageErrors).toHaveLength(0);
});
