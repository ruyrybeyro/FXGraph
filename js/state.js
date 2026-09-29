/**
 * Owns the app's mutable state (current view mode, selected time range,
 * in-flight request tracking, the line-chart response cache), separately
 * from the DOM wiring and fetch orchestration in main.js.
 */

// Time ranges shown as date-selector buttons, paired with the equivalent
// Yahoo Finance "range" value for the fallback candle source - one array
// indexed together, rather than two parallel arrays that have to be kept
// in sync by position.
const referenceDate = new Date();

export const DATE_RANGES = [
    { label: "1W", date: new Date(referenceDate.getTime() - 6.048e8), yahooRange: "5d" },
    { label: "1M", date: new Date(referenceDate.getTime() - 2.628e9), yahooRange: "1mo" },
    { label: "1Y", date: new Date(referenceDate.getTime() - 3.154e10), yahooRange: "1y" },
    { label: "2Y", date: new Date(referenceDate.getTime() - 6.307e10), yahooRange: "2y" },
    { label: "5Y", date: new Date(referenceDate.getTime() - 1.577e11), yahooRange: "5y" },
    { label: "10Y", date: new Date(referenceDate.getTime() - 3.154e11), yahooRange: "10y" },
];

const state = {
    mode: "line",
    // 1Y, matching the default-selected date button - not 1M, since real
    // (weekday-only) FX data for a 30-day window is short of what MACD
    // (26+), ADX (15+), and RVI (23+) need to show anything at all.
    rangeIndex: 2,
    requestGeneration: 0,
};

// Caches Frankfurter responses by from-currency + date range, since one
// response already contains rates for every target currency - switching
// "To" (or re-visiting a date range already fetched this session) can
// reuse it instead of hitting the network again.
const lineDataCache = new Map();

export function getMode() {
    return state.mode;
}

export function setMode(mode) {
    state.mode = mode;
}

export function getRangeIndex() {
    return state.rangeIndex;
}

export function setRangeIndex(index) {
    state.rangeIndex = index;
}

export function getSelectedDate() {
    return DATE_RANGES[state.rangeIndex].date;
}

export function getYahooRange() {
    return DATE_RANGES[state.rangeIndex].yahooRange;
}

// Bumped on every updateGraphData call, so a slow-resolving request (e.g.
// a real network fetch racing a quicker one after the user switches mode
// or currency again before it finishes) can tell it's been superseded and
// discard its result instead of overwriting newer data with stale data.
export function nextGeneration() {
    state.requestGeneration++;
    return state.requestGeneration;
}

export function isCurrentGeneration(generation) {
    return generation === state.requestGeneration;
}

export function getCachedLineData(key) {
    return lineDataCache.get(key);
}

export function setCachedLineData(key, value) {
    lineDataCache.set(key, value);
}
