const { test, expect } = require("@playwright/test");

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

async function mockFrankfurter(page) {
    await page.route("**://api.frankfurter.dev/**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                rates: { "2026-09-21": { USD: 1.1, JPY: 160, PHP: 58, EUR: 1 } },
            }),
        })
    );
}

test("pair, range, mode, and SMA period survive a reload", async ({ page }) => {
    await mockFrankfurter(page);
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(25) })
    );

    await page.goto("/");

    await page.click("#toInput");
    await page.fill("#toInput", "");
    await page.type("#toInput", "JPY");
    await page.click("body");
    await expect(page.locator("#toInput")).toHaveValue("JPY");

    await page.click(".date-btn:has-text('1Y')");
    await page.click("#candleToggleBtn");
    await page.fill("#smaPeriodInput", "5");
    await expect(page.locator("#dataSourceLabel")).toHaveText("Twelve Data OHLC Chart · SMA(5)");

    await page.reload();

    await expect(page.locator("#toInput")).toHaveValue("JPY");
    await expect(page.locator(".date-btn:not(.view-toggle-btn).selected")).toHaveText("1Y");
    await expect(page.locator("#candleToggleBtn")).toHaveClass(/selected/);
    await expect(page.locator("#smaPeriodInput")).toHaveValue("5");
    await expect(page.locator("#dataSourceLabel")).toHaveText("Twelve Data OHLC Chart · SMA(5)");
});

test("corrupted localStorage falls back to defaults instead of crashing", async ({ page }) => {
    await mockFrankfurter(page);

    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e));

    await page.addInitScript(() => {
        localStorage.setItem("fxGraphPreferences", "{not valid json");
    });

    await page.goto("/");
    await page.waitForTimeout(300);

    expect(pageErrors).toHaveLength(0);
    await expect(page.locator("#fromInput")).toHaveValue("EUR");
    await expect(page.locator("#toInput")).toHaveValue("PHP");
});

test("a stored pair naming an unknown currency falls back to defaults instead of an invalid selection", async ({ page }) => {
    await mockFrankfurter(page);

    await page.addInitScript(() => {
        localStorage.setItem(
            "fxGraphPreferences",
            JSON.stringify({ from: "XXX", to: "YYY", mode: "line", rangeIndex: 1 })
        );
    });

    await page.goto("/");

    await expect(page.locator("#fromInput")).toHaveValue("EUR");
    await expect(page.locator("#toInput")).toHaveValue("PHP");
});

test("a stored 'to' value is validated against the To dropdown, not the From one", async ({ page }) => {
    await mockFrankfurter(page);

    // The From/To currency lists are identical today, but simulate them
    // having drifted apart (as they actually did once in this project) by
    // removing JPY from only the To list before main.js reads it - and
    // persist a pair that relies on JPY still being a legitimate To value.
    await page.addInitScript(() => {
        localStorage.setItem(
            "fxGraphPreferences",
            JSON.stringify({ from: "EUR", to: "JPY", mode: "line", rangeIndex: 1 })
        );

        document.addEventListener("DOMContentLoaded", () => {
            let jpyOption = Array.from(
                document.querySelectorAll("#toDropdownContent option")
            ).find((o) => o.innerText === "JPY");
            jpyOption?.remove();
        });
    });

    await page.goto("/");

    await expect(page.locator("#fromInput")).toHaveValue("EUR");
    // JPY is no longer a valid To selection - must not be restored even
    // though it's still (irrelevantly) present in the From list.
    await expect(page.locator("#toInput")).not.toHaveValue("JPY");
    await expect(page.locator("#toInput")).toHaveValue("PHP");
});
