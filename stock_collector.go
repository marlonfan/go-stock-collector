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

func (sc *StockCollector) Close() {
	if sc.database != nil {
		sc.database.Close()
	}
}