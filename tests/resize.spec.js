const { test, expect } = require("@playwright/test");

// Regression test for a bug where resizing the window while candle mode
// hid the line chart's canvas (display:none) corrupted its pixel buffer
// to 0x0, which never self-healed on switching back to line mode.
test("resizing while candle mode is active does not corrupt the line canvas", async ({ page }) => {
    await page.route("**://api.frankfurter.dev/**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ rates: { "2026-09-21": { PHP: 58.7 } } }),
        })
    );
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 500, body: "x" })
    );
    await page.route("**/api/yahoo/**", (route) => route.fulfill({ status: 500, body: "x" }));

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.setViewportSize({ width: 900, height: 700 });
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);

    const size = await page.evaluate(() => {
        const c = document.getElementById("graph");
        return { width: c.width, height: c.height };
    });

    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
});
