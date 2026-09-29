const { test, expect } = require("@playwright/test");
const { regionHasColor } = require("./helpers.js");

// --clr-overlay-text (#5d4037) - deliberately NOT --clr-dark-blue
// (#000066), which Lightweight Charts also uses for its own axis text
// (layout.textColor in candleChart.js). Checking for that color matched
// the chart's own price-scale numbers instead of the overlay text this
// was meant to verify - see main.css's --clr-overlay-text comment.
const OVERLAY_TEXT_COLOR = [93, 64, 55];

// Screenshots #candleChart for real and checks for the target color
// within one overlay element's own bounding box (converted from
// viewport-relative to screenshot-relative coordinates). This is the
// only reliable way to confirm these DOM overlays are actually painted
// on screen - see helpers.js for why toBeVisible() isn't enough.
//
// insetTop matters specifically for the placeholders: their bounding box
// is the *entire pane* (centered text over the full width/height), which
// overlaps the pane's name label sitting in the top-left corner of that
// same box - checking the placeholder's full box without excluding that
// corner can pick up the label's (separately, already-verified) dark-blue
// text and report a false pass even when the placeholder's own text is
// the thing actually missing.
async function elementRegionHasColor(page, locator, color, { insetTop = 0 } = {}) {
    let container = page.locator("#candleChart");
    let containerBox = await container.boundingBox();
    let elementBox = await locator.boundingBox();
    let screenshot = await container.screenshot();

    return regionHasColor(
        screenshot,
        {
            x: elementBox.x - containerBox.x,
            y: elementBox.y - containerBox.y + insetTop,
            width: elementBox.width,
            height: elementBox.height - insetTop,
        },
        color
    );
}

// Pane name labels sit in roughly the top 20px of their pane - excluding
// that from a placeholder's (full-pane) check region avoids the overlap
// described above.
const PLACEHOLDER_CHECK_OPTS = { insetTop: 24 };

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

test("each indicator pane carries a visible name label, regardless of data availability", async ({ page }) => {
    // Name labels are always shown - unlike the placeholders, they don't
    // depend on candle count - so a short range (21, some panes empty) and
    // a long one (40, all populated) should both show all four labels.
    for (let count of [21, 40]) {
        await page.route("**/api/candles/twelvedata**", (route) =>
            route.fulfill({ status: 200, contentType: "application/json", body: candleBody(count) })
        );

        await page.goto("/");
        // Mode persists across reloads (see preferences.spec.js) - the
        // second iteration can already load in candle mode from the
        // first, so an unconditional click would toggle back OUT of it.
        if ((await page.locator("#candleToggleBtn").getAttribute("aria-pressed")) !== "true") {
            await page.click("#candleToggleBtn");
        }
        await page.waitForTimeout(500);

        await expect(page.locator('[data-indicator-label="macd"]')).toHaveText("MACD (12, 26, 9)");
        await expect(page.locator('[data-indicator-label="rsi"]')).toHaveText("RSI (14)");
        await expect(page.locator('[data-indicator-label="adx"]')).toHaveText("ADX (14)");
        await expect(page.locator('[data-indicator-label="rvi"]')).toHaveText("RVI (10, 14)");

        for (let label of ["macd", "rsi", "adx", "rvi"]) {
            let locator = page.locator(`[data-indicator-label="${label}"]`);
            await expect(locator).toBeVisible();
            // toBeVisible() alone isn't enough - it doesn't detect being
            // painted over by a sibling <canvas>, which is exactly what
            // happened here before this label got its z-index (see
            // candleChart.js). A real screenshot is the only check that
            // reflects what's actually on screen.
            expect(await elementRegionHasColor(page, locator, OVERLAY_TEXT_COLOR)).toBe(true);
        }
    }
});

test("short-range candle counts show a placeholder for indicators that don't have enough data yet", async ({ page }) => {
    // 21 candles - roughly what a real (weekday-only) 1M FX range actually
    // returns. Below MACD's 26 and RVI's 23, at RSI's 15 and ADX's 15.
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(21) })
    );

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);

    let macdPlaceholder = page.locator('[data-indicator="macd"]');
    await expect(macdPlaceholder).toBeVisible();
    await expect(macdPlaceholder).toContainText("MACD needs 26+ candles (have 21)");
    // toBeVisible() doesn't catch being painted over by a sibling canvas -
    // this placeholder was, at one point, exactly that (see candleChart.js
    // and helpers.js). A real screenshot is the only check that reflects
    // what's actually on screen.
    expect(await elementRegionHasColor(page, macdPlaceholder, OVERLAY_TEXT_COLOR, PLACEHOLDER_CHECK_OPTS)).toBe(true);

    let rviPlaceholder = page.locator('[data-indicator="rvi"]');
    await expect(rviPlaceholder).toBeVisible();
    await expect(rviPlaceholder).toContainText("RVI needs 23+ candles (have 21)");
    expect(await elementRegionHasColor(page, rviPlaceholder, OVERLAY_TEXT_COLOR, PLACEHOLDER_CHECK_OPTS)).toBe(true);

    // RSI (15) and ADX's +DI/-DI (15) both have enough data at 21 candles.
    await expect(page.locator('[data-indicator="rsi"]')).toBeHidden();
    await expect(page.locator('[data-indicator="adx"]')).toBeHidden();
});

test("empty-pane placeholders are also announced via aria-label, not just shown visually", async ({ page }) => {
    // #candleChart has role="img" - per that role's semantics, only its
    // aria-label reaches assistive tech, not descendant text, so the
    // placeholder <div>s alone are invisible to screen readers.
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(21) })
    );

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);

    let label = await page.locator("#candleChart").getAttribute("aria-label");
    expect(label).toContain("Candlestick chart of EUR to PHP exchange rate over time");
    expect(label).toContain("MACD needs 26+ candles, RVI needs 23+ candles (have 21) - try a longer range");
});

test("aria-label carries no stale indicator note once there's enough data", async ({ page }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(40) })
    );

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);

    let label = await page.locator("#candleChart").getAttribute("aria-label");
    expect(label).toBe(
        "Candlestick chart of EUR to PHP exchange rate over time, with MACD, RSI, ADX, and RVI indicator panes below it"
    );
});

test("the candlestick pane is much taller than each indicator pane, not equally split", async ({ page }) => {
    // Regression test: pane sizing used to be set with setHeight(), which
    // (in this vendored build) applies as a multiplicative adjustment
    // against the pane's *current* rendered height rather than an
    // absolute assignment - repeated calls (constructor, then every
    // resize()) compounded into an astronomical, identical stretch factor
    // on every pane, silently collapsing the intended 300/120/100/100/100
    // split into five equal panes. Fixed by using setStretchFactor()
    // instead, which is a plain, idempotent assignment.
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(40) })
    );

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);

    let paneHeights = await page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll("#candleChart canvas"));
        // One row of canvases (content + background, left + right scale)
        // repeats per pane - collect each row's distinct top/height once.
        let seen = new Map();
        for (let canvas of canvases) {
            let rect = canvas.getBoundingClientRect();
            let key = Math.round(rect.top);
            if (!seen.has(key)) seen.set(key, Math.round(rect.height));
        }
        return Array.from(seen.values());
    });

    // Candle pane (first) should be clearly the largest, not equal to
    // (or barely larger than) the indicator panes below it.
    let [candlePane, ...indicatorPanes] = paneHeights;
    for (let height of indicatorPanes) {
        expect(candlePane).toBeGreaterThan(height * 2);
    }
});

test("enough candles for every indicator hides all placeholders", async ({ page }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: candleBody(40) })
    );

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);

    for (let indicator of ["macd", "rsi", "adx", "rvi"]) {
        await expect(page.locator(`[data-indicator="${indicator}"]`)).toBeHidden();
    }
});

test("a failed fetch hides placeholders instead of showing a misleading candle count", async ({ page }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 500, body: "error" })
    );
    await page.route("**/api/yahoo/**", (route) => route.fulfill({ status: 500, body: "error" }));

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);

    for (let indicator of ["macd", "rsi", "adx", "rvi"]) {
        await expect(page.locator(`[data-indicator="${indicator}"]`)).toBeHidden();
    }
});

test("the default range (1Y) clears every indicator's minimum with realistic weekday-only FX data", async ({ page }) => {
    // Regression test for the original bug: the default 1M range only
    // yields ~21 real (weekday) candles, leaving MACD/ADX/RVI blank. 1Y
    // must comfortably clear all four minimums with the same weekday-only
    // data shape.
    let values = [];
    for (let d = new Date("2026-09-21T00:00:00Z"); values.length < 260; d.setUTCDate(d.getUTCDate() - 1)) {
        let day = d.getUTCDay();
        if (day === 0 || day === 6) continue;
        let close = 60 + Math.sin(values.length / 5);
        values.push({
            datetime: new Date(d).toISOString().slice(0, 10),
            open: String(close - 0.2),
            high: String(close + 0.5),
            low: String(close - 0.5),
            close: String(close),
        });
    }

    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", values }) })
    );

    await page.goto("/");
    await expect(page.locator(".date-btn:not(.view-toggle-btn).selected")).toHaveText("1Y");

    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);

    for (let indicator of ["macd", "rsi", "adx", "rvi"]) {
        await expect(page.locator(`[data-indicator="${indicator}"]`)).toBeHidden();
    }
});
