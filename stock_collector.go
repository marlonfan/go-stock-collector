package main

import (
	"fmt"
	"log"
	"time"
)

type MinuteBar struct {
	Symbol    string    `json:"symbol"`
	Timestamp time.Time `json:"timestamp"`
	Open      float64   `json:"open"`
	High      float64   `json:"high"`
	Low       float64   `json:"low"`
	Close     float64   `json:"close"`
	Volume    int64     `json:"volume"`
}

// DailyBar is a single daily OHLCV candle. Date is normalized to midnight UTC
// of the corresponding US Eastern trading day, matching the existing
// stock_daily_summary convention.
type DailyBar struct {
	Symbol string    `json:"symbol"`
	Date   time.Time `json:"date"`
	Open   float64   `json:"open"`
	High   float64   `json:"high"`
	Low    float64   `json:"low"`
	Close  float64   `json:"close"`
	Volume int64     `json:"volume"`
}

type StockCollector struct {
	yahooClient *YahooFinanceClient
	database    *Database
}

func NewStockCollector(dbPath string) (*StockCollector, error) {
	yahooClient := NewYahooFinanceClient()
	database, err := NewDatabase(dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize database: %v", err)
	}

	return &StockCollector{
		yahooClient: yahooClient,
		database:    database,
	}, nil
}

func (sc *StockCollector) CollectHistoricalData(symbol string, days int) error {
	log.Printf("Starting data collection for %s (last %d days)...", symbol, days)

	// Check if we already have data for this symbol
	latestTimestamp, err := sc.database.GetLatestTimestamp(symbol)
	if err != nil {
		return fmt.Errorf("failed to check existing data: %v", err)
	}

	if !latestTimestamp.IsZero() {
		log.Printf("Found existing data for %s, latest timestamp: %s", symbol, latestTimestamp.Format("2006-01-02 15:04:05"))

		// Calculate how many days we need to fetch
		// Add 1 to ensure we re-fetch the last day completely (in case it was incomplete)
		daysSinceLatest := int(time.Since(latestTimestamp).Hours()/24) + 1

		// If the last data is very recent (less than 1 day old), check if it's a trading day
		now := time.Now()
		if daysSinceLatest == 1 {
			// Check if we're on the same calendar day (in any timezone)
			if latestTimestamp.Year() == now.Year() &&
			   latestTimestamp.YearDay() == now.YearDay() {
				// Same day - always re-fetch to ensure completeness
				log.Printf("Latest data is from today, re-fetching to ensure completeness")
				days = 1
			} else {
				// Different day - fetch since the day of latest data
				days = daysSinceLatest
			}
		} else if daysSinceLatest <= 0 {
			// This shouldn't happen with the +1 above, but keep as safety check
			log.Printf("Re-fetching last day to ensure data completeness")
			days = 1
		} else {
			days = daysSinceLatest
		}

		log.Printf("Fetching %d days of data for %s (includes re-fetching last day)", days, symbol)
	}

	// Fetch data from Yahoo Finance
	bars, err := sc.yahooClient.GetMinuteData(symbol, days)
	if err != nil {
		return fmt.Errorf("failed to fetch data from Yahoo Finance: %v", err)
	}

	if len(bars) == 0 {
		log.Printf("No data returned for %s", symbol)
		return nil
	}

	// Insert data into database
	if err := sc.database.InsertMinuteData(bars); err != nil {
		return fmt.Errorf("failed to insert data into database: %v", err)
	}

	// Update daily summary
	if err := sc.database.UpdateDailySummary(symbol, bars); err != nil {
		log.Printf("Warning: failed to update daily summary for %s: %v", symbol, err)
	}

	// Auto-backfill 5y of daily history if we don't have enough.
	// Threshold of 200 covers all chart ranges up to 365D once filled
	// and ensures this only fires on first sync (or after a reset).
	if dailyCount, err := sc.database.CountDailySummary(symbol); err == nil && dailyCount < 200 {
		log.Printf("Daily summary count for %s is low (%d), running 5y backfill", symbol, dailyCount)
		if _, backfillErr := sc.BackfillDailyHistory(symbol, "5y"); backfillErr != nil {
			log.Printf("Warning: daily backfill failed for %s: %v", symbol, backfillErr)
		}
	}

	// Log statistics
	count, earliest, latest, err := sc.database.GetDataStats(symbol)
	if err != nil {
		log.Printf("Warning: failed to get data stats: %v", err)
	} else {
		log.Printf("Data collection completed for %s:", symbol)
		log.Printf("  Total records: %d", count)
		log.Printf("  Date range: %s to %s",
			earliest.Format("2006-01-02 15:04:05"),
			latest.Format("2006-01-02 15:04:05"))
	}

	return nil
}

func (sc *StockCollector) GetDataForAnalysis(symbol string, days int) ([]MinuteBar, error) {
	endTime := time.Now()
	startTime := endTime.AddDate(0, 0, -days)

	bars, err := sc.database.GetMinuteData(symbol, startTime, endTime)
	if err != nil {
		return nil, fmt.Errorf("failed to get data for analysis: %v", err)
	}

	log.Printf("Retrieved %d minute bars for %s analysis", len(bars), symbol)
	return bars, nil
}

func (sc *StockCollector) DisplaySampleData(symbol string, limit int) error {
	bars, err := sc.GetDataForAnalysis(symbol, 1) // Get last day's data
	if err != nil {
		return fmt.Errorf("failed to get sample data: %v", err)
	}

	if len(bars) == 0 {
		log.Printf("No data available for %s", symbol)
		return nil
	}

	log.Printf("\n=== Sample Data for %s ===", symbol)
	log.Printf("Total records: %d", len(bars))
	log.Printf("\nFirst 5 records:")
	count := limit
	if count > len(bars) {
		count = len(bars)
	}

	for i := 0; i < count; i++ {
		bar := bars[i]
		log.Printf("%s | O:%.2f H:%.2f L:%.2f C:%.2f V:%d",
			bar.Timestamp.Format("2006-01-02 15:04:05"),
			bar.Open, bar.High, bar.Low, bar.Close, bar.Volume)
	}

	if len(bars) > limit {
		log.Printf("...")
		log.Printf("Last 5 records:")
		for i := len(bars) - 5; i < len(bars); i++ {
			bar := bars[i]
			log.Printf("%s | O:%.2f H:%.2f L:%.2f C:%.2f V:%d",
				bar.Timestamp.Format("2006-01-02 15:04:05"),
				bar.Open, bar.High, bar.Low, bar.Close, bar.Volume)
		}
	}

	return nil
}

// BackfillDailyHistory fetches daily OHLCV from Yahoo (interval=1d) for the
// given range token (e.g. "5y", "2y", "max") and inserts any missing rows into
// stock_daily_summary. Existing rows are not overwritten — recent days that
// were already aggregated from minute data keep their (more accurate) values.
func (sc *StockCollector) BackfillDailyHistory(symbol, rangeStr string) (int, error) {
	bars, err := sc.yahooClient.GetDailyHistory(symbol, rangeStr)
	if err != nil {
		return 0, fmt.Errorf("failed to fetch daily history: %v", err)
	}
	if len(bars) == 0 {
		log.Printf("No daily history returned for %s", symbol)
		return 0, nil
	}

	inserted, err := sc.database.InsertDailySummaryBatch(bars)
	if err != nil {
		return 0, fmt.Errorf("failed to insert daily history: %v", err)
	}
	log.Printf("Backfill for %s: inserted %d new daily bars (fetched %d, range=%s)",
		symbol, inserted, len(bars), rangeStr)
	return inserted, nil
}

func (sc *StockCollector) Close() {
	if sc.database != nil {
		sc.database.Close()
	}
}