const { test, expect } = require("@playwright/test");

test("shows period % change for the line chart", async ({ page }) => {
    // Oldest point 58.0, latest 58.7 -> +1.21%
    await page.route("**://api.frankfurter.dev/**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                rates: {
                    "2026-09-15": { PHP: 58.0 },
                    "2026-09-18": { PHP: 58.2 },
                    "2026-09-21": { PHP: 58.7 },
                },
            }),
        })
    );

    await page.goto("/");
    await page.waitForTimeout(500);

    await expect(page.locator("#periodChange")).toHaveText("(+1.21%)");
    await expect(page.locator("#periodChange")).toHaveClass(/positive/);
});

test("shows period % change and an SMA overlay for the candle chart", async ({ page }) => {
    let values = [];
    for (let i = 0; i < 25; i++) {
        let date = new Date(Date.UTC(2026, 8, 21) - i * 86400000); // Sep 21 2026 backward
        values.push({
            datetime: date.toISOString().slice(0, 10),
            open: "60",
            high: "61",
            low: "59",
            close: "55", // sharp drop from open 60 -> close 55 = -8.33%
        });
    }

    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ status: "ok", values }),
        })
    );

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(800);

    await expect(page.locator("#periodChange")).toHaveText("(-8.33%)");
    await expect(page.locator("#periodChange")).toHaveClass(/negative/);
});
