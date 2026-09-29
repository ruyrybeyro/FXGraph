export class CurrencyService {
    constructor() {
        this.apiUrl = "https://api.frankfurter.dev/v1";
    }

    async getTimeseries(baseCurrency, date) {
        let requestUrl = `${this.apiUrl}/${date}..?from=${baseCurrency}`;

        let response = await fetch(requestUrl);

        if (!response.ok) {
            throw new Error(`Frankfurter request failed: ${response.status}`);
        }

        let json = await response.json();

        if (!json || typeof json.rates !== "object" || json.rates === null) {
            throw new Error("Frankfurter response is missing the expected 'rates' field");
        }

        return json;
    }
}
