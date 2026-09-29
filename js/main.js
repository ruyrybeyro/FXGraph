import { containsGivenLetters, formatDate } from "./utils/utils.js";
import { Graph } from "./graph/graph.js";
import { CandleChart } from "./graph/candleChart.js";
import { CurrencyService } from "./services/currencyService.js";
import { YahooService } from "./services/yahooService.js";
import { TwelveDataService } from "./services/twelveDataService.js";
import {
    DATE_RANGES,
    getMode,
    setMode,
    getRangeIndex,
    setRangeIndex,
    getSelectedDate,
    getYahooRange,
    nextGeneration,
    isCurrentGeneration,
    getCachedLineData,
    setCachedLineData,
} from "./state.js";

/**
 * This class handles search input,
 * dropdown input and html label change
 */
class Input {
    constructor(inputField, dropdownContent, labels) {
        this.inputField = inputField;
        this.dropdownContent = dropdownContent;
        this.labels = labels;

        this.lastInput = null;

        // Set by the caller once both Input instances exist, so each side
        // can refuse a selection that would match the other (e.g. EUR/EUR).
        this.other = null;

        // IDs for aria-activedescendant, since the options have none in HTML
        this.dropdownContent.querySelectorAll("option").forEach((opt, i) => {
            opt.id = `${this.inputField.id}-option-${i}`;
            opt.setAttribute("aria-selected", "false");
        });

        this.addSelectionEventToOptions();
        this.addInputFieldFocusListener();
        this.initInputSearch();
        this.addKeyboardNavigation();
    }

    // Single source of truth for which option is "active" - both the
    // typing filter and arrow-key navigation go through this, and Enter
    // always selects whatever it lands on, so the visual highlight and
    // what Enter does can never disagree.
    setHighlight = (node) => {
        this.dropdownContent.querySelectorAll("option").forEach((opt) => {
            opt.classList.remove("highlight");
            opt.setAttribute("aria-selected", "false");
        });

        if (node) {
            node.classList.add("highlight");
            node.setAttribute("aria-selected", "true");
            node.scrollIntoView({ block: "nearest" });
            this.inputField.setAttribute("aria-activedescendant", node.id);
        } else {
            this.inputField.removeAttribute("aria-activedescendant");
        }
    };

    visibleSelectableOptions = () => {
        return [...this.dropdownContent.querySelectorAll("option")].filter(
            (opt) => !opt.classList.contains("hide") && !this.conflictsWithOther(opt.innerText)
        );
    };

    addKeyboardNavigation() {
        this.inputField.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                this.showDropdown();

                let options = this.visibleSelectableOptions();

                if (options.length === 0) {
                    return;
                }

                let currentIndex = options.findIndex((opt) => opt.classList.contains("highlight"));
                let step = e.key === "ArrowDown" ? 1 : -1;
                let nextIndex =
                    currentIndex === -1
                        ? step === 1 ? 0 : options.length - 1
                        : (currentIndex + step + options.length) % options.length;

                this.setHighlight(options[nextIndex]);
            } else if (e.key === "Escape") {
                this.hideDropdown();
            }
        });
    }

    conflictsWithOther(value) {
        return this.other != null && value === this.other.getInput();
    }

    // Brief shake + red border, so a blocked same-currency selection isn't
    // just a silent no-op
    flashBlocked = () => {
        this.inputField.classList.remove("blocked");
        void this.inputField.offsetWidth; // restart the animation if it's already running
        this.inputField.classList.add("blocked");

        setTimeout(() => this.inputField.classList.remove("blocked"), 400);
    };

    initInputSearch() {
        let searchWord = this.inputField.value;

        this.inputField.addEventListener("keyup", (e) => {
            if (e.key == "Enter") {
                // Always select whatever is currently highlighted - the
                // same element arrow-key navigation moves and the typing
                // filter below sets, so what's visually highlighted and
                // what Enter does can never disagree.
                let highlighted = this.dropdownContent.querySelector("option.highlight");
                let blockedByConflict = false;
                let changed = false;

                // Re-check the conflict here rather than trusting the
                // highlight blindly - it's a backstop in case it's ever
                // stale (the other field changed after this one was
                // highlighted), so a conflicting selection can never slip
                // through even if that invariant is broken elsewhere
                if (highlighted && !this.conflictsWithOther(highlighted.innerText)) {
                    changed = highlighted.innerText != this.lastInput;
                    this.setInput(highlighted.innerText);
                } else if (highlighted) {
                    blockedByConflict = true;
                } else {
                    // Nothing highlighted - most likely because the only
                    // match conflicts with the other field
                    blockedByConflict = [...this.dropdownContent.querySelectorAll("option")].some(
                        (opt) => !opt.classList.contains("hide") && this.conflictsWithOther(opt.innerText)
                    );
                }

                // Reset the filter for next time the dropdown opens
                this.dropdownContent
                    .querySelectorAll("option")
                    .forEach((opt) => this.stopHidingOption(opt));

                if (changed) {
                    updateGraphData(getSelectedDate());
                } else if (blockedByConflict) {
                    this.flashBlocked();
                }

                this.hideDropdown();
            } else if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Escape") {
                searchWord = this.inputField.value;

                // Filter selections by search word - visibility is
                // recomputed fresh from scratch every keystroke (not
                // incrementally), so a node's hide/highlight state can
                // never go stale from an earlier, different search word
                this.dropdownContent.querySelectorAll("option").forEach((opt) => {
                    if (containsGivenLetters(searchWord, opt.innerText)) {
                        this.stopHidingOption(opt);
                    } else {
                        this.hideOption(opt);
                    }
                });

                // Highlight the first visible, non-conflicting match
                let options = this.visibleSelectableOptions();
                this.setHighlight(options.length > 0 ? options[0] : null);
            }
        });
    }

    addInputFieldFocusListener() {
        this.inputField.addEventListener("focus", this.showDropdown);

        this.inputField.addEventListener("blur", () => {
            // Check if the typed value is valid - a value that conflicts
            // with the other field (e.g. EUR/EUR) doesn't count, since
            // selecting it is refused everywhere else too
            let valid = false;

            this.dropdownContent.childNodes.forEach((node) => {
                if (node.innerText == this.inputField.value) {
                    valid = true;
                }
            });

            if (valid && this.conflictsWithOther(this.inputField.value)) {
                valid = false;
            }

            // Commit a valid, non-conflicting typed value (the user may
            // have typed a full currency code and clicked away without
            // pressing Enter or clicking a dropdown option); otherwise
            // revert to the last known-good value, falling back to EUR
            // if there isn't one yet (e.g. before the initial page load)
            let target = valid ? this.inputField.value : this.lastInput || "EUR";

            if (this.conflictsWithOther(target)) {
                target = "EUR";
            }

            let changed = target != this.lastInput;

            this.setInput(target);

            if (changed) {
                updateGraphData(getSelectedDate());
            }

            this.hideDropdown();
        });
    }

    addSelectionEventToOptions() {
        this.dropdownContent.childNodes.forEach((opt) =>
            opt.addEventListener("mousedown", () => {
                if (this.conflictsWithOther(opt.innerText)) {
                    this.flashBlocked();
                    return;
                }

                // Compare against the last actually-committed value, not
                // the box's current text - if the user typed a search
                // string before clicking, the box already shows that text
                // (native input behavior), which can coincidentally equal
                // the clicked option and mask a real change
                let changed = opt.innerText != this.lastInput;

                this.setInput(opt.innerText);

                // Close (and clear highlight) rather than leaving the
                // dropdown open - otherwise the highlight can be left
                // pointing at a completely different, stale option, and a
                // subsequent Enter (still focused, no blur happened) would
                // silently overwrite the selection just made with that
                // stale one instead of being a no-op
                this.hideDropdown();

                if (changed) {
                    updateGraphData(getSelectedDate());
                }
            })
        );
    }

    setInput = (value) => {
        this.inputField.value = value;
        this.lastInput = value;
        this.labels.forEach((label) => (label.innerHTML = value));
    };

    getInput = () => {
        return this.inputField.value;
    };

    showDropdown = () => {
        if (this.dropdownContent == null) {
            console.error("Failed to find dropdown menu on");
            return;
        }

        if (!this.dropdownContent.classList.contains("dropdown-active")) {
            this.dropdownContent.classList.add("dropdown-active");
        }

        this.inputField.setAttribute("aria-expanded", "true");

        // Always have something highlighted while open, not just once the
        // user starts typing - otherwise "nothing highlighted" is
        // ambiguous between "genuinely blocked" and "just opened, no
        // filter has run yet", and Enter can't tell the two apart
        if (!this.dropdownContent.querySelector("option.highlight")) {
            let options = this.visibleSelectableOptions();
            this.setHighlight(options.length > 0 ? options[0] : null);
        }
    };

    hideDropdown = () => {
        if (this.dropdownContent == null) {
            console.error("Failed to find dropdown menu on ", id);
            return;
        }

        if (this.dropdownContent.classList.contains("dropdown-active")) {
            this.dropdownContent.classList.remove("dropdown-active");
        }

        this.inputField.setAttribute("aria-expanded", "false");

        // Clear highlight on close, not just visibility - otherwise it can
        // go stale across a blur/refocus cycle if the OTHER field changes
        // in the meantime (e.g. this field highlights USD, closes, the
        // other field is then set to USD too, and reopening this one would
        // still show the now-conflicting USD as "highlighted" instead of
        // freshly recomputing). showDropdown() re-highlights on open.
        this.setHighlight(null);
    };

    hideOption = (option) => {
        if (!option.classList.contains("hide")) {
            option.classList.add("hide");
        }
    };

    stopHidingOption = (option) => {
        if (option.classList.contains("hide")) {
            option.classList.remove("hide");
        }
    };
}

const graph = new Graph();
const candleChart = new CandleChart("candleChart");
const lineChartContainer = document.getElementById("lineChart");

const switchBtn = document.getElementById("switchBtn");

const inputs = {
    from: new Input(
        document.getElementById("fromInput"),
        document.getElementById("fromDropdownContent"),
        document.querySelectorAll(".from-label"),
    ),

    to: new Input(
        document.getElementById("toInput"),
        document.getElementById("toDropdownContent"),
        document.querySelectorAll(".to-label")
    ),
};

// Let each Input see the other's current value, so a selection that
// would make From and To match (e.g. EUR/EUR) can be refused.
inputs.from.other = inputs.to;
inputs.to.other = inputs.from;

const latestValue = document.getElementById("latestValue");
const latestDate = document.getElementById("latestDate");
const periodChange = document.getElementById("periodChange");
const dataSourceLabel = document.getElementById("dataSourceLabel");
const statusMessage = document.getElementById("statusMessage");
const smaPeriodLabel = document.getElementById("smaPeriodLabel");
const smaPeriodInput = document.getElementById("smaPeriodInput");

// The raw source string ("Twelve Data OHLC Chart" / "Yahoo Finance OHLC
// Chart (fallback)") without the "· SMA(n)" suffix, kept around so the
// SMA period can be changed (and the label rebuilt) without re-fetching.
let currentCandleSource = "";

function currentSmaOverride() {
    let value = smaPeriodInput.value.trim();
    return value === "" ? undefined : parseInt(value, 10);
}

// % change from the oldest value in the currently-shown period to the
// latest - computed client-side from data already fetched for the chart,
// no extra request needed.
function updatePeriodChange(oldValue, newValue) {
    let percent = ((newValue - oldValue) / oldValue) * 100;
    let sign = percent >= 0 ? "+" : "";

    periodChange.textContent = `(${sign}${percent.toFixed(2)}%)`;
    periodChange.className = "period-change " + (percent >= 0 ? "positive" : "negative");
}

function showLoading() {
    statusMessage.textContent = "Loading...";
    statusMessage.className = "status-message loading";
}

function showError(message) {
    statusMessage.textContent = message;
    statusMessage.className = "status-message error";
}

function hideStatus() {
    statusMessage.className = "status-message hide";
}

const currencyService = new CurrencyService();
const yahooService = new YahooService();
const twelveDataService = new TwelveDataService();

const candleToggleBtn = document.getElementById("candleToggleBtn");

const dateButtons = document.querySelectorAll(".date-btn:not(.view-toggle-btn)");
let currentSelectedBtn = dateButtons[getRangeIndex()];

for (let i = 0; i < DATE_RANGES.length; i++) {
    dateButtons[i].addEventListener("click", function (e) {
        if (currentSelectedBtn.classList.contains("selected")) {
            currentSelectedBtn.classList.remove("selected");
        }

        currentSelectedBtn = e.target;
        currentSelectedBtn.classList.add("selected");

        setRangeIndex(i);
        updateGraphData(getSelectedDate());
    });
}

switchBtn.addEventListener("click", function () {
    const temp = inputs.from.getInput();
    inputs.from.setInput(inputs.to.getInput());
    inputs.to.setInput(temp);

    updateGraphData(getSelectedDate());
});

// Shared by the toggle click and by restoring a persisted mode on load,
// so the two can't drift out of sync with each other.
function applyModeUI(mode) {
    candleToggleBtn.classList.toggle("selected", mode === "candle");
    candleToggleBtn.setAttribute("aria-pressed", mode === "candle" ? "true" : "false");

    if (mode === "candle") {
        lineChartContainer.classList.add("hide");
        candleChart.show();
        smaPeriodLabel.classList.remove("hide");
        smaPeriodInput.classList.remove("hide");

        // Set immediately, not just once a fetch succeeds - Frankfurter
        // is never the candle source, so it must never keep showing here
        // while candle data is loading or if both sources fail
        dataSourceLabel.innerHTML = "OHLC Candle Chart";
    } else {
        candleChart.hide();
        lineChartContainer.classList.remove("hide");
        smaPeriodLabel.classList.add("hide");
        smaPeriodInput.classList.add("hide");
        graph.resize();

        dataSourceLabel.innerHTML = "Frankfurter ECB Reference Rates Chart";
    }
}

candleToggleBtn.addEventListener("click", function () {
    let newMode = getMode() === "line" ? "candle" : "line";
    setMode(newMode);
    applyModeUI(newMode);
    updateGraphData(getSelectedDate());
});

// Debounced so redrawing (cheap, but O(candle count) work run on the main
// thread) doesn't happen on every single keystroke - only matters for the
// longer ranges (thousands of candles), but costs nothing on short ones.
let smaRedrawTimeout = null;

smaPeriodInput.addEventListener("input", function () {
    clearTimeout(smaRedrawTimeout);

    smaRedrawTimeout = setTimeout(() => {
        // No candles drawn yet (or the input got shown/edited outside
        // candle mode) - nothing to redraw against.
        if (!candleChart.lastCandles) {
            return;
        }

        let period = candleChart.redrawSMA(currentSmaOverride());
        dataSourceLabel.innerHTML = `${currentCandleSource} · SMA(${period})`;
        savePreferences();
    }, 200);
});

const PREFERENCES_KEY = "fxGraphPreferences";

// Preferences persistence is a nice-to-have, not required for the app to
// function - localStorage can throw (private browsing, storage disabled,
// quota exceeded), and any failure here should just fall back to defaults
// rather than break the page.
function loadPreferences() {
    try {
        let raw = localStorage.getItem(PREFERENCES_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function savePreferences() {
    try {
        localStorage.setItem(
            PREFERENCES_KEY,
            JSON.stringify({
                from: inputs.from.getInput(),
                to: inputs.to.getInput(),
                mode: getMode(),
                rangeIndex: getRangeIndex(),
                smaPeriod: smaPeriodInput.value,
            })
        );
    } catch (e) {
        // Ignored - see comment above.
    }
}

window.addEventListener("DOMContentLoaded", () => {
    let prefs = loadPreferences();
    // Validated against each field's own dropdown, not one shared list -
    // the From/To lists happen to be identical today, but this project has
    // already had them silently drift apart once (the To list briefly
    // missing most currencies), and that's exactly the scenario this
    // restore logic needs to survive rather than assume away.
    let optionCodes = (dropdownId) =>
        new Set(
            Array.from(document.querySelectorAll(`#${dropdownId} option`)).map((o) => o.innerText)
        );
    let fromCodes = optionCodes("fromDropdownContent");
    let toCodes = optionCodes("toDropdownContent");

    let from = prefs && fromCodes.has(prefs.from) ? prefs.from : "EUR";
    let to = prefs && toCodes.has(prefs.to) && prefs.to !== from ? prefs.to : "PHP";

    // The stored pair itself could have gone stale (e.g. a currency
    // removed from the list) and collapsed to the same code on both sides
    if (to === from) {
        to = from === "PHP" ? "EUR" : "PHP";
    }

    inputs.from.setInput(from);
    inputs.to.setInput(to);

    if (prefs && Number.isInteger(prefs.rangeIndex) && DATE_RANGES[prefs.rangeIndex]) {
        currentSelectedBtn.classList.remove("selected");
        setRangeIndex(prefs.rangeIndex);
        currentSelectedBtn = dateButtons[prefs.rangeIndex];
        currentSelectedBtn.classList.add("selected");
    }

    if (typeof prefs?.smaPeriod === "string") {
        smaPeriodInput.value = prefs.smaPeriod;
    }

    if (prefs && (prefs.mode === "line" || prefs.mode === "candle")) {
        setMode(prefs.mode);
        applyModeUI(prefs.mode);
    }

    updateGraphData(getSelectedDate());
});

function updateGraphData(date) {
    let generation = nextGeneration();

    savePreferences();

    if (getMode() === "candle") {
        updateCandleData(generation);
    } else {
        updateLineData(date, generation);
    }
}

async function updateLineData(date, generation) {
    let from = inputs.from.getInput();
    let formattedDate = formatDate(date);
    let cacheKey = `${from}|${formattedDate}`;

    showLoading();

    try {
        let jsonCurrencyData = getCachedLineData(cacheKey);

        if (!jsonCurrencyData) {
            jsonCurrencyData = await currencyService.getTimeseries(from, formattedDate);
            setCachedLineData(cacheKey, jsonCurrencyData);
        }

        if (!isCurrentGeneration(generation)) {
            return;
        }

        let currencyData = [];
        let labels = [];

        for (const [key, value] of Object.entries(jsonCurrencyData["rates"])) {
            labels.push(key);
            currencyData.push(value[inputs.to.getInput()]);
        }

        let latest = currencyData.pop();

        latestValue.innerHTML = latest;
        latestDate.innerHTML = new Date(labels.pop()).toUTCString();

        // currencyData[0] is the oldest point still in the charted period
        // (the latest one was just popped above) - undefined only if the
        // period had a single data point to begin with
        if (currencyData.length > 0) {
            updatePeriodChange(currencyData[0], latest);
        }

        dataSourceLabel.innerHTML = "Frankfurter ECB Reference Rates Chart";
        lineChartContainer.setAttribute(
            "aria-label",
            `Line chart of ${from} to ${inputs.to.getInput()} exchange rate over time`
        );

        graph.drawClient(currencyData, labels, inputs.to.getInput());
        hideStatus();
    } catch (e) {
        if (!isCurrentGeneration(generation)) {
            return;
        }

        console.error("Failed to load exchange rate data:", e);
        showError("Unable to load exchange rate data.");
    }
}

// Twelve Data is the primary candle source (real quota, no bot-detection).
// Yahoo Finance is used only as a fallback, since its endpoint has no
// official quota and is prone to rate-limiting/blocking.
async function updateCandleData(generation) {
    showLoading();

    let result = await fetchTwelveDataCandles();
    let source = "Twelve Data OHLC Chart";

    if (!result) {
        console.warn("Twelve Data unavailable, falling back to Yahoo Finance");
        result = await fetchYahooCandles();
        source = "Yahoo Finance OHLC Chart";
    }

    if (!isCurrentGeneration(generation)) {
        return;
    }

    if (result) {
        drawCandleResult(result.candles, result.labels, source);
        hideStatus();
    } else {
        // Otherwise the chart keeps showing whatever pair/range it last
        // successfully drew - easy to mistake for current data, since
        // nothing about the candles themselves marks them as stale.
        candleChart.clear();
        currentCandleSource = "";
        dataSourceLabel.innerHTML = "OHLC Candle Chart";
        showError("Unable to load candle data from Twelve Data or Yahoo Finance.");
    }
}

async function fetchTwelveDataCandles() {
    try {
        let json = await twelveDataService.getCandles(
            inputs.from.getInput(),
            inputs.to.getInput(),
            formatDate(getSelectedDate()),
            formatDate(new Date())
        );

        if (
            json.status === "ok" &&
            Array.isArray(json.values) &&
            json.values.length > 0
        ) {
            let candles = [];
            let labels = [];

            // Twelve Data returns newest-first; draw chronologically
            for (let i = json.values.length - 1; i >= 0; i--) {
                let value = json.values[i];

                candles.push({
                    open: parseFloat(value.open),
                    high: parseFloat(value.high),
                    low: parseFloat(value.low),
                    close: parseFloat(value.close),
                });
                labels.push(value.datetime);
            }

            return { candles, labels };
        }
    } catch (e) {
        console.error("Twelve Data response error:", e);
    }

    return null;
}

async function fetchYahooCandles() {
    try {
        let json = await yahooService.getCandles(
            inputs.from.getInput(),
            inputs.to.getInput(),
            getYahooRange()
        );

        let result = json.chart.result[0];
        let timestamps = result.timestamp;
        let quote = result.indicators.quote[0];

        let candles = [];
        let labels = [];

        for (let i = 0; i < timestamps.length; i++) {
            if (
                quote.open[i] == null ||
                quote.high[i] == null ||
                quote.low[i] == null ||
                quote.close[i] == null
            ) {
                continue;
            }

            candles.push({
                open: quote.open[i],
                high: quote.high[i],
                low: quote.low[i],
                close: quote.close[i],
            });
            labels.push(new Date(timestamps[i] * 1000).toISOString().slice(0, 10));
        }

        // Nothing to draw (e.g. no trading data for this range/pair) -
        // treat it the same as a failure rather than drawing an empty chart
        if (candles.length > 0) {
            return { candles, labels };
        }
    } catch (e) {
        // Both candle sources are now exhausted - surface this loudly
        // instead of leaving the UI silently stuck on stale state
        console.error("Yahoo Finance response error (candle chart could not be updated):", e);
    }

    return null;
}

function drawCandleResult(candles, labels, source) {
    let lastCandle = candles[candles.length - 1];

    latestValue.innerHTML = lastCandle.close;
    latestDate.innerHTML = new Date(labels[labels.length - 1]).toUTCString();
    // Period return: first candle's open (start of period) to the latest
    // candle's close (end of period) - the standard definition
    updatePeriodChange(candles[0].open, lastCandle.close);
    candleChart.container.setAttribute(
        "aria-label",
        `Candlestick chart of ${inputs.from.getInput()} to ${inputs.to.getInput()} exchange rate over time, ` +
            "with MACD, RSI, ADX, and RVI indicator panes below it"
    );

    currentCandleSource = source;
    let period = candleChart.setData(candles, labels, currentSmaOverride());
    dataSourceLabel.innerHTML = `${source} · SMA(${period})`;
}