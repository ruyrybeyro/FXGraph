const { test, expect } = require("@playwright/test");

test("switching To currency reuses the cached Frankfurter response (no new request)", async ({ page }) => {
    let requestCount = 0;

    await page.route("**://api.frankfurter.dev/**", (route) => {
        requestCount++;
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ rates: { "2026-09-21": { USD: 1.15, PHP: 58.7 } } }),
        });
    });

    await page.goto("/");
    await page.waitForTimeout(500);
    expect(requestCount).toBe(1);

    await page.click("#toInput");
    await page
        .locator("#toDropdownContent option", { hasText: "USD" })
        .dispatchEvent("mousedown");
    await page.waitForTimeout(500);

    expect(requestCount).toBe(1);
    await expect(page.locator("#latestValue")).toHaveText("1.15");
});
