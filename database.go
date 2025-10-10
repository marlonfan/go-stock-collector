package main

import (
	"database/sql"
	"fmt"
	"math"
	"time"

	_ "modernc.org/sqlite"
)

type Database struct {
	db *sql.DB
}

func NewDatabase(dbPath string) (*Database, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %v", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to connect to database: %v", err)
	}

	database := &Database{db: db}
	if err := database.createTables(); err != nil {
		return nil, fmt.Errorf("failed to create tables: %v", err)
	}

	return database, nil
}

func (d *Database) createTables() error {
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS stock_minute_data (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		symbol TEXT NOT NULL,
		timestamp DATETIME NOT NULL,
		open REAL NOT NULL,
		high REAL NOT NULL,
		low REAL NOT NULL,
		close REAL NOT NULL,
		volume INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(symbol, timestamp)
	);

	CREATE TABLE IF NOT EXISTS watched_stocks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		symbol TEXT UNIQUE NOT NULL,
		name TEXT,
		added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		last_sync DATETIME,
		is_active BOOLEAN DEFAULT TRUE
	);

	CREATE TABLE IF NOT EXISTS stock_daily_summary (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		symbol TEXT NOT NULL,
		date DATE NOT NULL,
		open REAL NOT NULL,
		high REAL NOT NULL,
		low REAL NOT NULL,
		close REAL NOT NULL,
		volume INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(symbol, date)
	);

	CREATE INDEX IF NOT EXISTS idx_symbol_timestamp ON stock_minute_data(symbol, timestamp);
	CREATE INDEX IF NOT EXISTS idx_symbol ON stock_minute_data(symbol);
	CREATE INDEX IF NOT EXISTS idx_timestamp ON stock_minute_data(timestamp);
	CREATE INDEX IF NOT EXISTS idx_watched_stocks_symbol ON watched_stocks(symbol);
	CREATE INDEX IF NOT EXISTS idx_daily_summary_symbol_date ON stock_daily_summary(symbol, date);
	`

	_, err := d.db.Exec(createTableSQL)
	if err != nil {
		return fmt.Errorf("failed to create tables: %v", err)
	}

	return nil
}

func (d *Database) InsertMinuteData(bars []MinuteBar) error {
	if len(bars) == 0 {
		return nil
	}

	tx, err := d.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %v", err)
	}
	defer tx.Rollback()

	insertSQL := `
	INSERT OR REPLACE INTO stock_minute_data
	(symbol, timestamp, open, high, low, close, volume)
	VALUES (?, ?, ?, ?, ?, ?, ?)
	`

	stmt, err := tx.Prepare(insertSQL)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %v", err)
	}
	defer stmt.Close()

	for _, bar := range bars {
		// Round prices to 2 decimal places to avoid floating point precision issues
		open := roundToDecimal(bar.Open, 2)
		high := roundToDecimal(bar.High, 2)
		low := roundToDecimal(bar.Low, 2)
		close := roundToDecimal(bar.Close, 2)

		_, err := stmt.Exec(
			bar.Symbol,
			bar.Timestamp,
			open,
			high,
			low,
			close,
			bar.Volume,
		)
		if err != nil {
			return fmt.Errorf("failed to insert bar %s %s: %v", bar.Symbol, bar.Timestamp, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %v", err)
	}

	return nil
}

// Helper function to round float to specific decimal places
func roundToDecimal(value float64, places int) float64 {
	factor := math.Pow10(places)
	return math.Round(value*factor) / factor
}

func (d *Database) GetMinuteData(symbol string, startTime, endTime time.Time) ([]MinuteBar, error) {
	query := `
	SELECT symbol, timestamp, open, high, low, close, volume
	FROM stock_minute_data
	WHERE symbol = ? AND timestamp BETWEEN ? AND ?
	ORDER BY timestamp ASC
	`

	rows, err := d.db.Query(query, symbol, startTime, endTime)
	if err != nil {
		return nil, fmt.Errorf("failed to query data: %v", err)
	}
	defer rows.Close()

	var bars []MinuteBar
	for rows.Next() {
		var bar MinuteBar
		err := rows.Scan(
			&bar.Symbol,
			&bar.Timestamp,
			&bar.Open,
			&bar.High,
			&bar.Low,
			&bar.Close,
			&bar.Volume,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan row: %v", err)
		}
		bars = append(bars, bar)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("row iteration error: %v", err)
	}

	return bars, nil
}

func (d *Database) GetLatestTimestamp(symbol string) (time.Time, error) {
	query := `
	SELECT MAX(timestamp)
	FROM stock_minute_data
	WHERE symbol = ?
	`

	var latestTimestampStr sql.NullString
	err := d.db.QueryRow(query, symbol).Scan(&latestTimestampStr)
	if err != nil {
		if err == sql.ErrNoRows {
			return time.Time{}, nil
		}
		return time.Time{}, fmt.Errorf("failed to query latest timestamp: %v", err)
	}

	if !latestTimestampStr.Valid || latestTimestampStr.String == "" {
		return time.Time{}, nil
	}

	// Try different time formats
	formats := []string{
		"2006-01-02 15:04:05",
		"2006-01-02 15:04:05-07:00",
		time.RFC3339,
	}

	var latestTimestamp time.Time
	var parseErr error
	for _, format := range formats {
		latestTimestamp, parseErr = time.Parse(format, latestTimestampStr.String)
		if parseErr == nil {
			return latestTimestamp, nil
		}
	}
	return time.Time{}, fmt.Errorf("failed to parse latest timestamp: %v", parseErr)
}

func (d *Database) GetDataStats(symbol string) (int, time.Time, time.Time, error) {
	query := `
	SELECT
		COUNT(*) as total_records,
		MIN(timestamp) as earliest_timestamp,
		MAX(timestamp) as latest_timestamp
	FROM stock_minute_data
	WHERE symbol = ?
	`

	var count int
	var earliestStr, latestStr string
	err := d.db.QueryRow(query, symbol).Scan(&count, &earliestStr, &latestStr)
	if err != nil {
		return 0, time.Time{}, time.Time{}, fmt.Errorf("failed to get stats: %v", err)
	}

	var earliestTime, latestTime time.Time
	var errParse error
	if earliestStr != "" {
		earliestTime, errParse = time.Parse("2006-01-02 15:04:05", earliestStr)
		if errParse != nil {
			return 0, time.Time{}, time.Time{}, fmt.Errorf("failed to parse earliest time: %v", errParse)
		}
	}
	if latestStr != "" {
		latestTime, errParse = time.Parse("2006-01-02 15:04:05", latestStr)
		if errParse != nil {
			return 0, time.Time{}, time.Time{}, fmt.Errorf("failed to parse latest time: %v", errParse)
		}
	}

	return count, earliestTime, latestTime, nil
}

func (d *Database) Close() error {
	return d.db.Close()
}

// Watched Stocks operations
func (d *Database) AddWatchedStock(symbol, name string) error {
	query := `INSERT OR IGNORE INTO watched_stocks (symbol, name) VALUES (?, ?)`
	_, err := d.db.Exec(query, symbol, name)
	if err != nil {
		return fmt.Errorf("failed to add watched stock: %v", err)
	}
	return nil
}

func (d *Database) RemoveWatchedStock(symbol string) error {
	query := `DELETE FROM watched_stocks WHERE symbol = ?`
	_, err := d.db.Exec(query, symbol)
	if err != nil {
		return fmt.Errorf("failed to remove watched stock: %v", err)
	}
	return nil
}

func (d *Database) GetWatchedStocks() ([]WatchedStock, error) {
	query := `
	SELECT id, symbol, name, added_at, last_sync, is_active
	FROM watched_stocks
	WHERE is_active = TRUE
	ORDER BY added_at DESC
	`

	rows, err := d.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query watched stocks: %v", err)
	}
	defer rows.Close()

	var stocks []WatchedStock
	for rows.Next() {
		var stock WatchedStock
		var lastSync sql.NullTime
		err := rows.Scan(
			&stock.ID,
			&stock.Symbol,
			&stock.Name,
			&stock.AddedAt,
			&lastSync,
			&stock.IsActive,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan watched stock: %v", err)
		}
		if lastSync.Valid {
			stock.LastSync = lastSync.Time
		}
		stocks = append(stocks, stock)
	}

	return stocks, rows.Err()
}

func (d *Database) UpdateLastSync(symbol string) error {
	query := `UPDATE watched_stocks SET last_sync = CURRENT_TIMESTAMP WHERE symbol = ?`
	_, err := d.db.Exec(query, symbol)
	if err != nil {
		return fmt.Errorf("failed to update last sync: %v", err)
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
	summaries := make(map[string]DailySummary)
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

		summary := DailySummary{
			Symbol: symbol,
			Date:   firstBar.Timestamp,
			Open:   roundToDecimal(open, 2),
			High:   roundToDecimal(high, 2),
			Low:    roundToDecimal(low, 2),
			Close:  roundToDecimal(close, 2),
			Volume: volume,
		}
		summaries[date] = summary
	}

	// Insert daily summaries
	tx, err := d.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %v", err)
	}
	defer tx.Rollback()

	insertSQL := `
	INSERT OR REPLACE INTO stock_daily_summary
	(symbol, date, open, high, low, close, volume)
	VALUES (?, ?, ?, ?, ?, ?, ?)
	`

	stmt, err := tx.Prepare(insertSQL)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %v", err)
	}
	defer stmt.Close()

	for _, summary := range summaries {
		_, err := stmt.Exec(
			summary.Symbol,
			summary.Date.Format("2006-01-02"),
			summary.Open,
			summary.High,
			summary.Low,
			summary.Close,
			summary.Volume,
		)
		if err != nil {
			return fmt.Errorf("failed to insert daily summary for %s: %v", summary.Date.Format("2006-01-02"), err)
		}
	}

	return tx.Commit()
}

func (d *Database) GetDailySummary(symbol string, days int) ([]DailySummary, error) {
	query := `
	SELECT id, symbol, date, open, high, low, close, volume, created_at
	FROM stock_daily_summary
	WHERE symbol = ? AND date >= date('now', '-%d days')
	ORDER BY date DESC
	`

	rows, err := d.db.Query(fmt.Sprintf(query, days), symbol)
	if err != nil {
		return nil, fmt.Errorf("failed to query daily summary: %v", err)
	}
	defer rows.Close()

	var summaries []DailySummary
	for rows.Next() {
		var summary DailySummary
		err := rows.Scan(
			&summary.ID,
			&summary.Symbol,
			&summary.Date,
			&summary.Open,
			&summary.High,
			&summary.Low,
			&summary.Close,
			&summary.Volume,
			&summary.CreateAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan daily summary: %v", err)
		}
		summaries = append(summaries, summary)
	}

	return summaries, rows.Err()
}

func (d *Database) GetLatestPrice(symbol string) (float64, time.Time, error) {
	query := `
	SELECT close, timestamp
	FROM stock_minute_data
	WHERE symbol = ?
	ORDER BY timestamp DESC
	LIMIT 1
	`

	var price float64
	var timestamp time.Time
	err := d.db.QueryRow(query, symbol).Scan(&price, &timestamp)
	if err != nil {
		if err == sql.ErrNoRows {
			return 0, time.Time{}, fmt.Errorf("no data found for symbol %s", symbol)
		}
		return 0, time.Time{}, fmt.Errorf("failed to query latest price: %v", err)
	}

	return price, timestamp, nil
}