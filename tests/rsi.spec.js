const { test, expect } = require("@playwright/test");

// RSI's purple is otherwise unused anywhere in the app, so finding it on
// any canvas inside #candleChart is a reliable signal the indicator
// actually rendered - see macd.spec.js for the same approach.
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

const RSI_PURPLE = [156, 39, 176];

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

test("draws an RSI line in a third pane when there's enough data", async ({ page }) => {
    // RSI(14) needs 15 candles for its first point.
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(25) })
    );

    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e));

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(800);

    expect(pageErrors).toHaveLength(0);
    expect(await hasColor(page, RSI_PURPLE)).toBe(true);
});

test("does not crash and draws no RSI line when there are too few candles for it", async ({ page }) => {
    // 10 candles is short of the 15 (RSI period + 1) needed for a first point.
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(10) })
    );

    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e));

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(800);

    expect(pageErrors).toHaveLength(0);
    expect(await hasColor(page, RSI_PURPLE)).toBe(false);
});
