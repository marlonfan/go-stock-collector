package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http/cookiejar"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-resty/resty/v2"
)

type YahooChart struct {
	Chart ChartData `json:"chart"`
}

type ChartData struct {
	Result []ChartResult `json:"result"`
	Error  interface{}   `json:"error"`
}

type ChartResult struct {
	Meta    ChartMeta    `json:"meta"`
	Timestamp []int64    `json:"timestamp"`
	Indicators Indicators `json:"indicators"`
}

type ChartMeta struct {
	Symbol          string  `json:"symbol"`
	InstrumentType  string  `json:"instrumentType"`
	RegularMarketPrice float64 `json:"regularMarketPrice"`
	ChartPreviousClose float64 `json:"chartPreviousClose"`
}

type Indicators struct {
	Quote []Quote `json:"quote"`
}

type Quote struct {
	Close []float64 `json:"close"`
	Volume []int64  `json:"volume"`
	Open  []float64 `json:"open"`
	High  []float64 `json:"high"`
	Low   []float64 `json:"low"`
}

type YahooFinanceClient struct {
	client  *resty.Client
	crumb   string
	crumbMu sync.Mutex
}

func NewYahooFinanceClient() *YahooFinanceClient {
	client := resty.New()
	client.SetTimeout(30 * time.Second)
	client.SetHeader("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
	// Enable cookie jar — quoteSummary requires the cookies set by fc.yahoo.com
	// to validate the crumb token in subsequent requests.
	jar, _ := cookiejar.New(nil)
	client.GetClient().Jar = jar

	return &YahooFinanceClient{client: client}
}

func (y *YahooFinanceClient) GetHistoricalData(symbol string, period string, interval string) ([]MinuteBar, error) {
	// Yahoo Finance query format
	url := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%s&period2=%s&interval=%s&includePrePost=true",
		symbol,
		strconv.FormatInt(time.Now().AddDate(0, 0, -30).Unix(), 10), // 30 days ago
		strconv.FormatInt(time.Now().Unix(), 10),                    // now
		interval,
	)

	resp, err := y.client.R().Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch data: %v", err)
	}

	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("unexpected status code: %d, body: %s", resp.StatusCode(), resp.String())
	}

	var chart YahooChart
	if err := json.Unmarshal(resp.Body(), &chart); err != nil {
		return nil, fmt.Errorf("failed to parse response: %v", err)
	}

	if chart.Chart.Error != nil {
		return nil, fmt.Errorf("Yahoo Finance API error: %v", chart.Chart.Error)
	}

	if len(chart.Chart.Result) == 0 {
		return nil, fmt.Errorf("no data returned for symbol %s", symbol)
	}

	result := chart.Chart.Result[0]

	if len(result.Indicators.Quote) == 0 {
		return nil, fmt.Errorf("no quote data available")
	}

	quote := result.Indicators.Quote[0]
	var bars []MinuteBar

	for i, timestamp := range result.Timestamp {
		if i >= len(quote.Close) || i >= len(quote.Open) || i >= len(quote.High) || i >= len(quote.Low) || i >= len(quote.Volume) {
			continue
		}

		// Skip null/zero values
		if quote.Close[i] == 0 || quote.Open[i] == 0 || quote.High[i] == 0 || quote.Low[i] == 0 {
			continue
		}

		// Filter out anomalous data
		open := quote.Open[i]
		high := quote.High[i]
		low := quote.Low[i]
		close := quote.Close[i]
		volume := quote.Volume[i]

		// Skip data with zero volume (likely pre/post market data)
		if volume == 0 {
			continue
		}

		// Basic price validation: prices should be reasonable
		// For most stocks, price should be between $1 and $10000
		if open < 1 || open > 10000 || high < 1 || high > 10000 || low < 1 || low > 10000 || close < 1 || close > 10000 {
			continue
		}

		// High should be >= other prices, Low should be <= other prices
		if high < open || high < close || low > open || low > close {
			continue
		}

		// Price change should not be too extreme (more than 20% in one minute is suspicious)
		priceChange := close - open
		if open > 0 {
			changePercent := (priceChange / open) * 100
			if changePercent > 20 || changePercent < -20 {
				continue
			}
		}

		bar := MinuteBar{
			Symbol:    strings.ToUpper(symbol),
			Timestamp: time.Unix(timestamp, 0),
			Open:      open,
			High:      high,
			Low:       low,
			Close:     close,
			Volume:    volume,
		}
		bars = append(bars, bar)
	}

	return bars, nil
}

func (y *YahooFinanceClient) GetMinuteData(symbol string, days int) ([]MinuteBar, error) {
	log.Printf("Fetching %d days of minute data for %s...", days, symbol)

	var allBars []MinuteBar
	maxDaysPerRequest := 7 // Use 7 days to be safe (Yahoo limit is 8)

	remainingDays := days
	batch := 1

	for remainingDays > 0 {
		daysToFetch := remainingDays
		if daysToFetch > maxDaysPerRequest {
			daysToFetch = maxDaysPerRequest
		}

		// Calculate the offset for this batch
		offsetDays := (batch - 1) * maxDaysPerRequest
		startTime := time.Now().AddDate(0, 0, -(offsetDays + daysToFetch))
		endTime := time.Now().AddDate(0, 0, -offsetDays)

		log.Printf("Batch %d: Fetching %d days from %s to %s",
			batch, daysToFetch,
			startTime.Format("2006-01-02"),
			endTime.Format("2006-01-02"))

		// Yahoo Finance query format for this batch
		url := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%s&period2=%s&interval=1m&includePrePost=true",
			symbol,
			strconv.FormatInt(startTime.Unix(), 10),
			strconv.FormatInt(endTime.Unix(), 10),
		)

		resp, err := y.client.R().Get(url)
		if err != nil {
			log.Printf("Warning: failed to fetch batch %d: %v", batch, err)
			break
		}

		if resp.StatusCode() != 200 {
			log.Printf("Warning: batch %d returned status %d", batch, resp.StatusCode())
			break
		}

		var chart YahooChart
		if err := json.Unmarshal(resp.Body(), &chart); err != nil {
			log.Printf("Warning: failed to parse batch %d: %v", batch, err)
			break
		}

		if chart.Chart.Error != nil {
			log.Printf("Warning: batch %d API error: %v", batch, chart.Chart.Error)
			break
		}

		if len(chart.Chart.Result) > 0 {
			result := chart.Chart.Result[0]
			if len(result.Indicators.Quote) > 0 {
				quote := result.Indicators.Quote[0]

				for i, timestamp := range result.Timestamp {
					if i >= len(quote.Close) || i >= len(quote.Open) || i >= len(quote.High) || i >= len(quote.Low) || i >= len(quote.Volume) {
						continue
					}

					// Skip null/zero values
					if quote.Close[i] == 0 || quote.Open[i] == 0 || quote.High[i] == 0 || quote.Low[i] == 0 {
						continue
					}

					// Filter out anomalous data
					open := quote.Open[i]
					high := quote.High[i]
					low := quote.Low[i]
					close := quote.Close[i]
					volume := quote.Volume[i]

					// Skip data with zero volume (likely pre/post market data)
					if volume == 0 {
						continue
					}

					// Basic price validation: prices should be reasonable
					// For most stocks, price should be between $1 and $10000
					if open < 1 || open > 10000 || high < 1 || high > 10000 || low < 1 || low > 10000 || close < 1 || close > 10000 {
						continue
					}

					// High should be >= other prices, Low should be <= other prices
					if high < open || high < close || low > open || low > close {
						continue
					}

					// Price change should not be too extreme (more than 20% in one minute is suspicious)
					priceChange := close - open
					if open > 0 {
						changePercent := (priceChange / open) * 100
						if changePercent > 20 || changePercent < -20 {
							continue
						}
					}

					bar := MinuteBar{
						Symbol:    strings.ToUpper(symbol),
						Timestamp: time.Unix(timestamp, 0),
						Open:      open,
						High:      high,
						Low:       low,
						Close:     close,
						Volume:    volume,
					}
					allBars = append(allBars, bar)
				}
			}
		}

		log.Printf("Batch %d completed, got %d bars", batch, len(allBars))

		// Add delay between requests to avoid rate limiting
		if remainingDays > maxDaysPerRequest {
			time.Sleep(1 * time.Second)
		}

		remainingDays -= daysToFetch
		batch++
	}

	log.Printf("Successfully fetched total of %d minute bars for %s", len(allBars), symbol)
	return allBars, nil
}

// GetDailyHistory fetches daily OHLCV history from Yahoo using interval=1d.
// rangeStr accepts Yahoo range tokens: 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max.
// Yahoo returns one candle per trading day going back many years in a single request.
func (y *YahooFinanceClient) GetDailyHistory(symbol, rangeStr string) ([]DailyBar, error) {
	log.Printf("Fetching daily history for %s (range=%s)...", symbol, rangeStr)

	url := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=1d&range=%s&includePrePost=false",
		symbol, rangeStr)

	resp, err := y.client.R().Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch daily history: %v", err)
	}
	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("unexpected status code: %d, body: %s", resp.StatusCode(), resp.String())
	}

	var chart YahooChart
	if err := json.Unmarshal(resp.Body(), &chart); err != nil {
		return nil, fmt.Errorf("failed to parse daily history response: %v", err)
	}
	if chart.Chart.Error != nil {
		return nil, fmt.Errorf("Yahoo Finance API error: %v", chart.Chart.Error)
	}
	if len(chart.Chart.Result) == 0 {
		return nil, fmt.Errorf("no daily data returned for symbol %s", symbol)
	}

	result := chart.Chart.Result[0]
	if len(result.Indicators.Quote) == 0 {
		return nil, fmt.Errorf("no quote data available")
	}
	quote := result.Indicators.Quote[0]

	// Normalize all dates to midnight UTC keyed off the Eastern trading-day,
	// matching the existing UpdateDailySummary convention so backfilled rows
	// align with minute-aggregated rows on the same date.
	etLocation, err := time.LoadLocation("America/New_York")
	if err != nil {
		return nil, fmt.Errorf("failed to load Eastern timezone: %v", err)
	}

	bars := make([]DailyBar, 0, len(result.Timestamp))
	for i, ts := range result.Timestamp {
		if i >= len(quote.Close) || i >= len(quote.Open) || i >= len(quote.High) || i >= len(quote.Low) || i >= len(quote.Volume) {
			continue
		}
		if quote.Close[i] == 0 || quote.Open[i] == 0 || quote.High[i] == 0 || quote.Low[i] == 0 {
			continue
		}

		open := quote.Open[i]
		high := quote.High[i]
		low := quote.Low[i]
		closeP := quote.Close[i]
		volume := quote.Volume[i]

		if open < 1 || open > 10000 || high < 1 || high > 10000 || low < 1 || low > 10000 || closeP < 1 || closeP > 10000 {
			continue
		}
		if high < open || high < closeP || low > open || low > closeP {
			continue
		}

		dateStr := time.Unix(ts, 0).In(etLocation).Format("2006-01-02")
		parsedDate, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			continue
		}

		bars = append(bars, DailyBar{
			Symbol: strings.ToUpper(symbol),
			Date:   parsedDate,
			Open:   open,
			High:   high,
			Low:    low,
			Close:  closeP,
			Volume: volume,
		})
	}

	log.Printf("Fetched %d daily bars for %s", len(bars), symbol)
	return bars, nil
}

// QuoteFundamentals holds the lightweight fundamentals we surface in the UI.
// Yahoo's `quoteSummary` endpoint is the source. PERatio uses *float64 because
// it can be legitimately absent (e.g. unprofitable companies, ETFs).
type QuoteFundamentals struct {
	MarketCap string
	PERatio   *float64
}

// quoteSummaryResp matches the subset of fields we read from
// /v10/finance/quoteSummary.
type quoteSummaryResp struct {
	QuoteSummary struct {
		Result []struct {
			SummaryDetail struct {
				MarketCap struct {
					Fmt string  `json:"fmt"`
					Raw float64 `json:"raw"`
				} `json:"marketCap"`
				TrailingPE struct {
					Raw float64 `json:"raw"`
				} `json:"trailingPE"`
			} `json:"summaryDetail"`
		} `json:"result"`
		Error interface{} `json:"error"`
	} `json:"quoteSummary"`
}

// refreshCrumb performs the two-step Yahoo cookie+crumb dance. Call before
// quoteSummary requests; cache the result on the client. The crumb token is
// tied to the cookie jar, so both must persist together.
func (y *YahooFinanceClient) refreshCrumb() error {
	y.crumbMu.Lock()
	defer y.crumbMu.Unlock()

	// Step 1: any Yahoo URL that sets cookies. fc.yahoo.com 404s but still
	// sets the necessary cookies in the jar.
	if _, err := y.client.R().Get("https://fc.yahoo.com"); err != nil {
		return fmt.Errorf("fc.yahoo.com cookie probe: %v", err)
	}

	// Step 2: exchange cookies for a crumb token.
	resp, err := y.client.R().Get("https://query1.finance.yahoo.com/v1/test/getcrumb")
	if err != nil {
		return fmt.Errorf("getcrumb: %v", err)
	}
	if resp.StatusCode() != 200 {
		return fmt.Errorf("getcrumb HTTP %d: %s", resp.StatusCode(), resp.String())
	}
	crumb := strings.TrimSpace(resp.String())
	if crumb == "" {
		return fmt.Errorf("empty crumb")
	}
	y.crumb = crumb
	return nil
}

// GetQuoteSummary fetches market cap and trailing P/E for a symbol via Yahoo's
// authenticated quoteSummary endpoint. Best-effort: returns a partial struct
// with whatever fields parsed cleanly, plus an error if the network leg failed.
func (y *YahooFinanceClient) GetQuoteSummary(symbol string) (QuoteFundamentals, error) {
	if y.crumb == "" {
		if err := y.refreshCrumb(); err != nil {
			return QuoteFundamentals{}, fmt.Errorf("init crumb: %v", err)
		}
	}

	doFetch := func() (*resty.Response, error) {
		url := fmt.Sprintf(
			"https://query1.finance.yahoo.com/v10/finance/quoteSummary/%s?modules=summaryDetail&crumb=%s",
			symbol, y.crumb,
		)
		return y.client.R().Get(url)
	}

	resp, err := doFetch()
	if err != nil {
		return QuoteFundamentals{}, fmt.Errorf("quoteSummary fetch: %v", err)
	}
	// 401 typically means the crumb expired; retry once with a fresh crumb.
	if resp.StatusCode() == 401 {
		if err := y.refreshCrumb(); err != nil {
			return QuoteFundamentals{}, fmt.Errorf("refresh crumb: %v", err)
		}
		resp, err = doFetch()
		if err != nil {
			return QuoteFundamentals{}, fmt.Errorf("quoteSummary retry: %v", err)
		}
	}
	if resp.StatusCode() != 200 {
		return QuoteFundamentals{}, fmt.Errorf("quoteSummary HTTP %d", resp.StatusCode())
	}

	var parsed quoteSummaryResp
	if err := json.Unmarshal(resp.Body(), &parsed); err != nil {
		return QuoteFundamentals{}, fmt.Errorf("quoteSummary parse: %v", err)
	}
	if len(parsed.QuoteSummary.Result) == 0 {
		return QuoteFundamentals{}, fmt.Errorf("quoteSummary empty result")
	}
	sd := parsed.QuoteSummary.Result[0].SummaryDetail

	out := QuoteFundamentals{MarketCap: sd.MarketCap.Fmt}
	if sd.TrailingPE.Raw > 0 {
		v := sd.TrailingPE.Raw
		out.PERatio = &v
	}
	return out, nil
}

// yahooSearchResp matches the subset of Yahoo's /v1/finance/search response
// we care about. Many other fields exist (news, lists, hits, etc.) but they're
// not needed for symbol search.
type yahooSearchResp struct {
	Quotes []struct {
		Symbol    string `json:"symbol"`
		Shortname string `json:"shortname"`
		Longname  string `json:"longname"`
		QuoteType string `json:"quoteType"`
		ExchDisp  string `json:"exchDisp"`
	} `json:"quotes"`
}

// SearchSymbols hits Yahoo's public search endpoint. Returns up to `limit`
// matches across global exchanges (NYSE/NASDAQ/HKEX/TSE/SSE/etc.) filtered to
// instrument types worth tracking. No API key needed.
func (y *YahooFinanceClient) SearchSymbols(query string, limit int) ([]StockSearchResult, error) {
	if limit <= 0 {
		limit = 15
	}
	url := fmt.Sprintf(
		"https://query1.finance.yahoo.com/v1/finance/search?q=%s&quotesCount=%d&newsCount=0&enableFuzzyQuery=false",
		strings.ReplaceAll(query, " ", "+"),
		limit,
	)

	resp, err := y.client.R().Get(url)
	if err != nil {
		return nil, fmt.Errorf("yahoo search failed: %v", err)
	}
	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("yahoo search HTTP %d", resp.StatusCode())
	}

	var parsed yahooSearchResp
	if err := json.Unmarshal(resp.Body(), &parsed); err != nil {
		return nil, fmt.Errorf("yahoo search parse: %v", err)
	}

	out := make([]StockSearchResult, 0, len(parsed.Quotes))
	for _, q := range parsed.Quotes {
		if q.Symbol == "" {
			continue
		}
		// Filter to instrument types our app actually plots: regular equities,
		// ETFs, and indices. Skip futures/options/currencies/crypto.
		switch q.QuoteType {
		case "EQUITY", "ETF", "INDEX", "MUTUALFUND":
		default:
			continue
		}

		name := q.Shortname
		if name == "" {
			name = q.Longname
		}
		full := name
		if q.ExchDisp != "" {
			full = fmt.Sprintf("%s · %s", name, q.ExchDisp)
		}

		out = append(out, StockSearchResult{
			Symbol:   q.Symbol,
			Name:     name,
			FullName: full,
		})
	}
	return out, nil
}