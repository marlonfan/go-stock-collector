package main

import (
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
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
	client *resty.Client
}

func NewYahooFinanceClient() *YahooFinanceClient {
	client := resty.New()
	client.SetTimeout(30 * time.Second)
	client.SetHeader("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")

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