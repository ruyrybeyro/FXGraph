export class TwelveDataService {
    constructor() {
        // Same-origin path; nginx injects the API key server-side
        // so it never reaches the browser.
        this.apiUrl = "/api/candles/twelvedata";
    }

    async getCandles(fromCurrency, toCurrency, startDate, endDate) {
        let symbol = encodeURIComponent(`${fromCurrency}/${toCurrency}`);
        let requestUrl = `${this.apiUrl}?symbol=${symbol}&interval=1day&start_date=${startDate}&end_date=${endDate}`;

        let response = await fetch(requestUrl);

        if (!response.ok) {
            throw new Error(`Twelve Data request failed: ${response.status}`);
        }

        let json = await response.json();

        // Only a basic shape check here - a valid Twelve Data response can
        // legitimately be {"status":"error", ...}, and the caller (main.js)
        // already distinguishes that from a usable result
        if (!json || typeof json !== "object" || typeof json.status !== "string") {
            throw new Error("Twelve Data response is missing the expected 'status' field");
        }

        return json;
    }
}
