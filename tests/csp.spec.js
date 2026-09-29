const { test, expect } = require("@playwright/test");

test("no CSP violations during normal usage (line mode, candle mode, picker interaction)", async ({ page }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                status: "ok",
                values: [
                    { datetime: "2026-09-21", open: "58.2", high: "58.9", low: "58.0", close: "58.7" },
                    { datetime: "2026-09-18", open: "58.6", high: "59.0", low: "58.3", close: "58.2" },
                ],
            }),
        })
    );

    const violations = [];
    page.on("console", (msg) => {
        if (msg.text().includes("Content Security Policy") || msg.text().includes("Refused")) {
            violations.push(msg.text());
        }
    });

    await page.goto("/", { waitUntil: "networkidle" });
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);
    await page.click("#toInput");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");

    expect(violations).toHaveLength(0);
});
