const { test, expect } = require("@playwright/test");

// MACD/signal colors are otherwise unused anywhere in the app (candles and
// the SMA overlay use green/red/orange), so finding them on any canvas
// inside #candleChart is a reliable signal that the indicator actually
// rendered - no need to know which of Lightweight Charts' internal
// per-pane canvases is "the" content canvas.
async function hasColor(page, [tr, tg, tb]) {
    return page.evaluate(
        ([tr, tg, tb]) => {
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
                        Math.abs(data[p] - tr) < 15 &&
                        Math.abs(data[p + 1] - tg) < 15 &&
                        Math.abs(data[p + 2] - tb) < 15 &&
                        data[p + 3] > 0
                    ) {
                        return true;
                    }
                }
            }

            return false;
        },
        [tr, tg, tb]
    );
}

const MACD_BLUE = [33, 150, 243];
const SIGNAL_PINK = [233, 30, 99];

function candleBody(count) {
    let values = [];
    for (let i = 0; i < count; i++) {
        let date = new Date(Date.UTC(2026, 8, 21) - i * 86400000);
        let close = 60 + Math.sin(i / 3);
        values.push({
            datetime: date.toISOString().slice(0, 10),
            open: String(close - 0.2),
            high: String(close + 0.5),
            low: String(close - 0.5),
            close: String(close),
        });
    }
    return JSON.stringify({ status: "ok", values });
}

test("draws a MACD line and signal line in a second pane when there's enough data", async ({ page }) => {
    // 40 candles clears the 26 (slow EMA) + 9 (signal EMA) warm-up needed
    // for both lines to have points.
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(40) })
    );

    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e));

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(800);

    expect(pageErrors).toHaveLength(0);
    expect(await hasColor(page, MACD_BLUE)).toBe(true);
    expect(await hasColor(page, SIGNAL_PINK)).toBe(true);

    // The candle chart container grows to fit the extra MACD/RSI/ADX panes.
    let box = await page.locator("#candleChart").boundingBox();
    expect(box.height).toBe(720);
});

test("does not crash and draws no MACD/signal line when there are too few candles for it", async ({ page }) => {
    // 10 candles is short of the 26-candle slow EMA warm-up.
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(10) })
    );

    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e));

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(800);

    expect(pageErrors).toHaveLength(0);
    expect(await hasColor(page, MACD_BLUE)).toBe(false);
    expect(await hasColor(page, SIGNAL_PINK)).toBe(false);
});

test("switching back to line mode after MACD has rendered does not crash on resize", async ({ page }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(40) })
    );

    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e));

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(300);

    await expect(page.locator("#lineChart")).toBeVisible();
    expect(pageErrors).toHaveLength(0);
});
