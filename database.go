package main

import (
	"fmt"
	"math"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Database struct {
	db *gorm.DB
}

func NewDatabase(dbPath string) (*Database, error) {
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %v", err)
	}

	// Auto migrate tables
	if err := db.AutoMigrate(allModels...); err != nil {
		return nil, fmt.Errorf("failed to auto migrate: %v", err)
	}

	database := &Database{db: db}

	// Create additional indexes that are not covered by GORM tags
	if err := database.createAdditionalIndexes(); err != nil {
		return nil, fmt.Errorf("failed to create additional indexes: %v", err)
	}

	return database, nil
}

// createAdditionalIndexes creates indexes that are not easily covered by GORM tags
func (d *Database) createAdditionalIndexes() error {
	// Create composite unique index for (symbol, timestamp) in stock_minute_data
	if err := d.db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_symbol_timestamp_unique ON stock_minute_data(symbol, timestamp)").Error; err != nil {
		return fmt.Errorf("failed to create unique index: %v", err)
	}

	return nil
}

// Helper function to round float to specific decimal places
func roundToDecimal(value float64, places int) float64 {
	factor := math.Pow10(places)
	return math.Round(value*factor) / factor
}

func (d *Database) InsertMinuteData(bars []MinuteBar) error {
	if len(bars) == 0 {
		return nil
	}

		// Convert MinuteBar to StockMinuteData models
	var stockData []StockMinuteData
	for _, bar := range bars {
		stockData = append(stockData, StockMinuteData{
			Symbol:    bar.Symbol,
			Timestamp: bar.Timestamp,
			Open:      roundToDecimal(bar.Open, 2),
			High:      roundToDecimal(bar.High, 2),
			Low:       roundToDecimal(bar.Low, 2),
			Close:     roundToDecimal(bar.Close, 2),
			Volume:    bar.Volume,
		})
	}

	// Use transaction for batch insert
	return d.db.Transaction(func(tx *gorm.DB) error {
		// Process in batches to avoid memory issues with large datasets
		batchSize := 1000
		for i := 0; i < len(stockData); i += batchSize {
			end := i + batchSize
			if end > len(stockData) {
				end = len(stockData)
			}

			batch := stockData[i:end]

			for _, data := range batch {
				// Use raw SQL with INSERT OR REPLACE to handle conflicts properly
				result := tx.Exec(`
					INSERT OR REPLACE INTO stock_minute_data
					(symbol, timestamp, open, high, low, close, volume, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					data.Symbol, data.Timestamp, data.Open, data.High, data.Low, data.Close, data.Volume,
					time.Now(), time.Now())

				if result.Error != nil {
					return fmt.Errorf("failed to insert bar %s %s: %v", data.Symbol, data.Timestamp, result.Error)
				}
			}
		}
		return nil
	})
}

func (d *Database) GetMinuteData(symbol string, startTime, endTime time.Time) ([]MinuteBar, error) {
	var stockData []StockMinuteData
	result := d.db.Where("symbol = ? AND timestamp BETWEEN ? AND ?", symbol, startTime, endTime).
		Order("timestamp ASC").
		Find(&stockData)

	if result.Error != nil {
		return nil, fmt.Errorf("failed to query data: %v", result.Error)
	}

	// Convert StockMinuteData to MinuteBar for compatibility
	var bars []MinuteBar
	for _, data := range stockData {
		bars = append(bars, MinuteBar{
			Symbol:    data.Symbol,
			Timestamp: data.Timestamp,
			Open:      data.Open,
			High:      data.High,
			Low:       data.Low,
			Close:     data.Close,
			Volume:    data.Volume,
		})
	}

	return bars, nil
}

func (d *Database) GetLatestTimestamp(symbol string) (time.Time, error) {
	var stockData StockMinuteData
	result := d.db.Where("symbol = ?", symbol).
		Order("timestamp DESC").
		First(&stockData)

	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			return time.Time{}, nil
		}
		return time.Time{}, fmt.Errorf("failed to query latest timestamp: %v", result.Error)
	}

	return stockData.Timestamp, nil
}

func (d *Database) GetDataStats(symbol string) (int, time.Time, time.Time, error) {
	// Get count first
	var count int64
	err := d.db.Model(&StockMinuteData{}).
		Where("symbol = ?", symbol).
		Count(&count).Error
	if err != nil {
		return 0, time.Time{}, time.Time{}, fmt.Errorf("failed to get count: %v", err)
	}

	if count == 0 {
		return 0, time.Time{}, time.Time{}, nil
	}

	// Get earliest and latest timestamps using First/Last
	var earliest, latest StockMinuteData

	err = d.db.Where("symbol = ?", symbol).
		Order("timestamp ASC").
		First(&earliest).Error
	if err != nil {
		return 0, time.Time{}, time.Time{}, fmt.Errorf("failed to get earliest timestamp: %v", err)
	}

	err = d.db.Where("symbol = ?", symbol).
		Order("timestamp DESC").
		First(&latest).Error
	if err != nil {
		return 0, time.Time{}, time.Time{}, fmt.Errorf("failed to get latest timestamp: %v", err)
	}

	return int(count), earliest.Timestamp, latest.Timestamp, nil
}

func (d *Database) Close() error {
	sqlDB, err := d.db.DB()
	if err != nil {
		return fmt.Errorf("failed to get underlying sql.DB: %v", err)
	}
	return sqlDB.Close()
}

// Watched Stocks operations
func (d *Database) AddWatchedStock(symbol, name string) error {
	stock := WatchedStock{
		Symbol:   symbol,
		Name:     name,
		IsActive: true,
	}

	result := d.db.Where("symbol = ?", symbol).FirstOrCreate(&stock)
	if result.Error != nil {
		return fmt.Errorf("failed to add watched stock: %v", result.Error)
	}

	return nil
}

func (d *Database) RemoveWatchedStock(symbol string) error {
	result := d.db.Where("symbol = ?", symbol).Delete(&WatchedStock{})
	if result.Error != nil {
		return fmt.Errorf("failed to remove watched stock: %v", result.Error)
	}
	return nil
}

func (d *Database) GetWatchedStocks() ([]WatchedStock, error) {
	var stocks []WatchedStock
	result := d.db.Where("is_active = ?", true).Order("added_at DESC").Find(&stocks)
	if result.Error != nil {
		return nil, fmt.Errorf("failed to query watched stocks: %v", result.Error)
	}

	return stocks, nil
}

func (d *Database) UpdateLastSync(symbol string) error {
	result := d.db.Model(&WatchedStock{}).
		Where("symbol = ?", symbol).
		Update("last_sync", time.Now())
	if result.Error != nil {
		return fmt.Errorf("failed to update last sync: %v", result.Error)
	}
	return nil
}

// Daily Summary operations
func (d *Database) UpdateDailySummary(symbol string, bars []MinuteBar) error {
	if len(bars) == 0 {
		return nil
	}

	// Load US Eastern timezone for proper stock market date grouping
	etLocation, err := time.LoadLocation("America/New_York")
	if err != nil {
		return fmt.Errorf("failed to load Eastern timezone: %v", err)
	}

	// Group bars by US market date (using Eastern time)
	dailyData := make(map[string][]MinuteBar)
	for _, bar := range bars {
		// Convert to Eastern time for proper date grouping
		etTime := bar.Timestamp.In(etLocation)

		// Skip weekends (Saturday=6, Sunday=0) based on Eastern time
		weekday := etTime.Weekday()
		if weekday == time.Saturday || weekday == time.Sunday {
			continue
		}

		// Use Eastern time date for grouping (this ensures one trading day = one date)
		date := etTime.Format("2006-01-02")
		dailyData[date] = append(dailyData[date], bar)
	}

	// Calculate daily summaries from grouped bars
	summaries := make(map[string]StockDailySummary)
	for date, dayBars := range dailyData {
		if len(dayBars) == 0 {
			continue
		}

		// Sort bars by timestamp to find first and last correctly
		// We need to explicitly sort since data may not be in chronological order
		for i := 0; i < len(dayBars)-1; i++ {
			for j := i + 1; j < len(dayBars); j++ {
				if dayBars[i].Timestamp.After(dayBars[j].Timestamp) {
					dayBars[i], dayBars[j] = dayBars[j], dayBars[i]
				}
			}
		}

		firstBar := dayBars[0]
		lastBar := dayBars[len(dayBars)-1]

		var high, low float64
		var volume int64

		// Find proper open (first trade) and close (last trade)
		open := firstBar.Open
		close := lastBar.Close

		// Calculate high, low, and total volume
		for _, bar := range dayBars {
			if bar.High > high {
				high = bar.High
			}
			if bar.Low < low || low == 0 {
				low = bar.Low
			}
			volume += bar.Volume
		}

		// Parse the date string for the summary date (use first bar's date, but set to start of day in UTC)
		parsedDate, err := time.Parse("2006-01-02", date)
		if err != nil {
			return fmt.Errorf("failed to parse date %s: %v", date, err)
		}

		summary := StockDailySummary{
			Symbol: symbol,
			Date:   parsedDate,
			Open:   roundToDecimal(open, 2),
			High:   roundToDecimal(high, 2),
			Low:    roundToDecimal(low, 2),
			Close:  roundToDecimal(close, 2),
			Volume: volume,
		}
		summaries[date] = summary
	}

	// Insert daily summaries using GORM transaction
	return d.db.Transaction(func(tx *gorm.DB) error {
		for _, summary := range summaries {
			// Use FirstOrCreate to handle INSERT OR REPLACE logic
			result := tx.Where("symbol = ? AND date = ?", summary.Symbol, summary.Date).
				FirstOrCreate(&summary, StockDailySummary{
					Symbol: summary.Symbol,
					Date:   summary.Date,
					Open:   summary.Open,
					High:   summary.High,
					Low:    summary.Low,
					Close:  summary.Close,
					Volume: summary.Volume,
				})

			if result.Error != nil {
				return fmt.Errorf("failed to insert daily summary for %s: %v", summary.Date.Format("2006-01-02"), result.Error)
			}

			// If record already exists, update it
			if result.RowsAffected == 0 {
				updateResult := tx.Model(&StockDailySummary{}).
					Where("symbol = ? AND date = ?", summary.Symbol, summary.Date).
					Updates(map[string]interface{}{
						"open":   summary.Open,
						"high":   summary.High,
						"low":    summary.Low,
						"close":  summary.Close,
						"volume": summary.Volume,
					})
				if updateResult.Error != nil {
					return fmt.Errorf("failed to update daily summary for %s: %v", summary.Date.Format("2006-01-02"), updateResult.Error)
				}
			}
		}
		return nil
	})
}

func (d *Database) GetDailySummary(symbol string, days int) ([]DailySummaryAPI, error) {
	var stockSummaries []StockDailySummary
	// Calculate the date threshold
	thresholdDate := time.Now().AddDate(0, 0, -days).Format("2006-01-02")
	result := d.db.Where("symbol = ? AND date >= ?", symbol, thresholdDate).
		Order("date DESC").
		Find(&stockSummaries)

	if result.Error != nil {
		return nil, fmt.Errorf("failed to query daily summary: %v", result.Error)
	}

	// Convert StockDailySummary to DailySummaryAPI for compatibility
	var summaries []DailySummaryAPI
	for _, stockSummary := range stockSummaries {
		summaries = append(summaries, DailySummaryAPI{
			ID:       int(stockSummary.ID),
			Symbol:   stockSummary.Symbol,
			Date:     stockSummary.Date,
			Open:     stockSummary.Open,
			High:     stockSummary.High,
			Low:      stockSummary.Low,
			Close:    stockSummary.Close,
			Volume:   stockSummary.Volume,
			CreateAt: stockSummary.CreatedAt,
		})
	}

	return summaries, nil
}

func (d *Database) GetLatestPrice(symbol string) (float64, time.Time, error) {
	var stockData StockMinuteData
	result := d.db.Where("symbol = ?", symbol).
		Order("timestamp DESC").
		First(&stockData)

	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			return 0, time.Time{}, fmt.Errorf("no data found for symbol %s", symbol)
		}
		return 0, time.Time{}, fmt.Errorf("failed to query latest price: %v", result.Error)
	}

	return stockData.Close, stockData.Timestamp, nil
}