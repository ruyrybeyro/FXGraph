export class YahooService {
    constructor() {
        // Same-origin path, proxied to Yahoo Finance by the web server
        // (Yahoo's endpoint sends no CORS headers, so the browser can't call it directly).
        this.apiUrl = "/api/yahoo";
    }

    async getCandles(fromCurrency, toCurrency, range) {
        let ticker = `${fromCurrency}${toCurrency}=X`;
        let requestUrl = `${this.apiUrl}/${ticker}?range=${range}&interval=1d`;

        let response = await fetch(requestUrl);

        if (!response.ok) {
            throw new Error(`Yahoo Finance request failed: ${response.status}`);
        }

        let json = await response.json();
        let result = json?.chart?.result?.[0];

        if (!result || !Array.isArray(result.timestamp) || !result.indicators?.quote?.[0]) {
            throw new Error("Yahoo Finance response is missing the expected chart data");
        }

        return json;
    }
}
