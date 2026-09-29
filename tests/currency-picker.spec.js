const { test, expect } = require("@playwright/test");

// Real Frankfurter response shape, minimal - covers the currencies these
// tests actually pick.
const FRANKFURTER_BODY = JSON.stringify({
    amount: 1,
    base: "EUR",
    start_date: "2026-08-21",
    end_date: "2026-09-21",
    rates: {
        "2026-09-21": { USD: 1.15, PHP: 65.5, JPY: 160.2 },
    },
});

test.beforeEach(async ({ page }) => {
    await page.route("**://api.frankfurter.dev/**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: FRANKFURTER_BODY,
        })
    );
    await page.goto("/");
    await page.waitForTimeout(500);
});

// Regression test: clicking an option used to leave the dropdown open
// with a stale highlight (whatever was highlighted before the click, not
// the option just clicked). A subsequent Enter - still focused, no blur
// in between - would then silently overwrite the just-made selection
// with that stale, unrelated option.
test("clicking an option closes the dropdown, so a follow-up Enter can't revert it", async ({ page }) => {
    await page.click("#fromInput");
    await page
        .locator("#fromDropdownContent option", { hasText: "JPY" })
        .dispatchEvent("mousedown");

    await expect(page.locator("#fromInput")).toHaveValue("JPY");
    await expect(page.locator("#fromDropdownContent")).not.toHaveClass(/dropdown-active/);

    await page.keyboard.press("Enter");
    await expect(page.locator("#fromInput")).toHaveValue("JPY");
});

test("same-currency selection is blocked via dropdown click", async ({ page }) => {
    // From is EUR by default - clicking EUR as To must be refused
    await page.click("#toInput");
    await page
        .locator("#toDropdownContent option", { hasText: "EUR" })
        .dispatchEvent("mousedown");

    await expect(page.locator("#toInput")).not.toHaveValue("EUR");
    await expect(page.locator("#toInput")).toHaveClass(/blocked/);
});

test("same-currency selection is blocked via typing + Enter", async ({ page }) => {
    await page.click("#toInput");
    await page.fill("#toInput", "");
    await page.type("#toInput", "EUR");
    await page.keyboard.press("Enter");

    // The box may still show the literal typed text until blur, but the
    // actual committed state (labels) must never have changed to EUR
    await expect(page.locator(".to-label").first()).not.toHaveText("EUR");
});

// Regression test: focusing a field and pressing Enter immediately, with
// no filter pass having run yet, used to false-trigger the same-currency
// block (scanning the still-fully-unfiltered list found the one
// genuinely-conflicting option and mistook that for "the only match is
// blocked", even though the user hadn't attempted to select anything).
test("focusing a field and pressing Enter with nothing typed does not false-trigger the block", async ({ page }) => {
    await page.click("#toInput");
    await page.keyboard.press("Enter");

    await expect(page.locator("#toInput")).not.toHaveClass(/blocked/);
    await expect(page.locator("#toInput")).not.toHaveValue("");
});

test("typing a valid currency and blurring commits it", async ({ page }) => {
    await page.click("#fromInput");
    await page.fill("#fromInput", "");
    await page.type("#fromInput", "JPY");
    await page.click("body");

    await expect(page.locator("#fromInput")).toHaveValue("JPY");
    await expect(page.locator(".from-label").first()).toHaveText("JPY");
});

test("typing an invalid currency and blurring reverts to the last valid value", async ({ page }) => {
    await page.click("#fromInput");
    await page.fill("#fromInput", "");
    await page.type("#fromInput", "ZZZ");
    await page.click("body");

    await expect(page.locator("#fromInput")).toHaveValue("EUR");
});

test("arrow-key navigation and Enter select the same option", async ({ page }) => {
    await page.click("#toInput");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");

    const highlighted = await page
        .locator("#toDropdownContent option.highlight")
        .textContent();

    await page.keyboard.press("Enter");

    await expect(page.locator("#toInput")).toHaveValue(highlighted);
});

// Regression test: a field's highlighted option could go stale across a
// blur/refocus cycle if the OTHER field changed in the meantime, letting
// Enter blindly select a now-conflicting currency and bypass the guard
// entirely (From and To both ending up USD).
test("a stale highlight cannot bypass the same-currency guard after the other field changes", async ({ page }) => {
    // Highlight To's first option (USD, since From=EUR by default) without selecting it
    await page.click("#toInput");
    await page.click("body");

    // Change From to USD - the same currency that was highlighted (but not selected) in To
    await page.click("#fromInput");
    await page.fill("#fromInput", "");
    await page.type("#fromInput", "USD");
    await page.keyboard.press("Enter");
    await expect(page.locator("#fromInput")).toHaveValue("USD");

    // Reopen To and press Enter with nothing typed - must not select the stale USD
    await page.click("#toInput");
    await page.keyboard.press("Enter");

    await expect(page.locator("#toInput")).not.toHaveValue("USD");
});

test("the swap button exchanges From and To", async ({ page }) => {
    const before = {
        from: await page.locator("#fromInput").inputValue(),
        to: await page.locator("#toInput").inputValue(),
    };

    await page.click("#switchBtn");

    await expect(page.locator("#fromInput")).toHaveValue(before.to);
    await expect(page.locator("#toInput")).toHaveValue(before.from);
});
