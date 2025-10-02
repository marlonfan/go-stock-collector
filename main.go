package main

import (
	"flag"
	"log"
	"os"
	"time"
)

func main() {
	// Command line flags
	mode := flag.String("mode", "web", "Run mode: web, cli")
	symbol := flag.String("symbol", "TSLA", "Stock symbol (default: TSLA)")
	days := flag.Int("days", 30, "Number of days to fetch (default: 30)")
	dbPath := flag.String("db", "stock_data.db", "Database file path (default: stock_data.db)")
	action := flag.String("action", "collect", "Action: collect, analyze, sample")
	port := flag.String("port", "8080", "Web server port (default: 8080)")
	flag.Parse()

	switch *mode {
	case "web":
		runWebMode(*port, *dbPath)
	case "cli":
		runCLIMode(*symbol, *days, *dbPath, *action)
	default:
		log.Fatalf("Unknown mode: %s. Available modes: web, cli", *mode)
	}
}

func runWebMode(port, dbPath string) {
	log.Println("=== Stock Tracker Web Server ===")
	log.Printf("Database: %s", dbPath)
	log.Printf("Server will start on http://localhost:%s", port)

	// Initialize web server
	server, err := NewWebServer(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize web server: %v", err)
	}
	defer server.Close()

	// Start server
	if err := server.Run(":" + port); err != nil {
		log.Fatalf("Failed to start web server: %v", err)
	}
}

func runCLIMode(symbol string, days int, dbPath, action string) {
	log.Println("=== Stock Data Collector CLI ===")
	log.Printf("Symbol: %s", symbol)
	log.Printf("Days: %d", days)
	log.Printf("Database: %s", dbPath)
	log.Printf("Action: %s", action)

	// Initialize collector
	collector, err := NewStockCollector(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize collector: %v", err)
	}
	defer collector.Close()

	switch action {
	case "collect":
		// Collect historical data
		start := time.Now()
		if err := collector.CollectHistoricalData(symbol, days); err != nil {
			log.Fatalf("Failed to collect data: %v", err)
		}
		duration := time.Since(start)
		log.Printf("Data collection completed in %v", duration)

		// Display sample data
		if err := collector.DisplaySampleData(symbol, 5); err != nil {
			log.Printf("Warning: failed to display sample data: %v", err)
		}

	case "analyze":
		// Analyze existing data
		bars, err := collector.GetDataForAnalysis(symbol, days)
		if err != nil {
			log.Fatalf("Failed to get data for analysis: %v", err)
		}

		if len(bars) == 0 {
			log.Printf("No data found for %s. Run with -action=collect first.", symbol)
			return
		}

		// Basic analysis
		analyzeBars(bars)

	case "sample":
		// Show sample data
		if err := collector.DisplaySampleData(symbol, 10); err != nil {
			log.Fatalf("Failed to display sample data: %v", err)
		}

	default:
		log.Printf("Unknown action: %s", action)
		log.Printf("Available actions: collect, analyze, sample")
		os.Exit(1)
	}
}

func analyzeBars(bars []MinuteBar) {
	if len(bars) == 0 {
		return
	}

	log.Printf("\n=== Basic Analysis ===")

	// Price range
	var minPrice, maxPrice float64 = bars[0].Close, bars[0].Close
	var totalVolume int64 = 0

	for _, bar := range bars {
		if bar.Close < minPrice {
			minPrice = bar.Close
		}
		if bar.Close > maxPrice {
			maxPrice = bar.Close
		}
		totalVolume += bar.Volume
	}

	latestPrice := bars[len(bars)-1].Close
	firstPrice := bars[0].Close
	priceChange := latestPrice - firstPrice
	priceChangePercent := (priceChange / firstPrice) * 100

	log.Printf("Data Points: %d", len(bars))
	log.Printf("Date Range: %s to %s",
		bars[0].Timestamp.Format("2006-01-02 15:04:05"),
		bars[len(bars)-1].Timestamp.Format("2006-01-02 15:04:05"))
	log.Printf("Price Range: $%.2f - $%.2f", minPrice, maxPrice)
	log.Printf("Current Price: $%.2f", latestPrice)
	log.Printf("Price Change: $%.2f (%.2f%%)", priceChange, priceChangePercent)
	log.Printf("Total Volume: %d", totalVolume)

	// Find highest and lowest trading days
	findHighLowDays(bars)

	// Average hourly volume
	avgVolume := float64(totalVolume) / float64(len(bars))
	log.Printf("Average Volume per Minute: %.0f", avgVolume)
}

func findHighLowDays(bars []MinuteBar) {
	if len(bars) < 2 {
		return
	}

	var maxVolumeBar, minPriceBar MinuteBar
	maxVolume := int64(0)
	minPrice := bars[0].Close

	for _, bar := range bars {
		if bar.Volume > maxVolume {
			maxVolume = bar.Volume
			maxVolumeBar = bar
		}
		if bar.Close < minPrice {
			minPrice = bar.Close
			minPriceBar = bar
		}
	}

	log.Printf("\n=== Notable Points ===")
	log.Printf("Highest Volume Day: %s (Volume: %d, Price: $%.2f)",
		maxVolumeBar.Timestamp.Format("2006-01-02 15:04:05"),
		maxVolumeBar.Volume, maxVolumeBar.Close)
	log.Printf("Lowest Price Point: %s (Price: $%.2f)",
		minPriceBar.Timestamp.Format("2006-01-02 15:04:05"),
		minPriceBar.Close)
}