package main

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

// GORM models for the database

// StockMinuteData represents minute-level stock price data
type StockMinuteData struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Symbol    string    `gorm:"index:idx_symbol;not null" json:"symbol"`
	Timestamp time.Time `gorm:"index:idx_timestamp;not null" json:"timestamp"`
	Open      float64   `gorm:"not null" json:"open"`
	High      float64   `gorm:"not null" json:"high"`
	Low       float64   `gorm:"not null" json:"low"`
	Close     float64   `gorm:"not null" json:"close"`
	Volume    int64     `gorm:"not null" json:"volume"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}

// AddIndexes creates additional indexes after auto migration
func (s *StockMinuteData) AddIndexes(db *gorm.DB) error {
	// Create composite unique index for (symbol, timestamp)
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_symbol_timestamp_unique ON stock_minute_data(symbol, timestamp)").Error; err != nil {
		return fmt.Errorf("failed to create unique index: %v", err)
	}
	return nil
}

// TableName specifies the table name for StockMinuteData
func (StockMinuteData) TableName() string {
	return "stock_minute_data"
}

// WatchedStock represents stocks that are being monitored
type WatchedStock struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Symbol    string    `gorm:"uniqueIndex;index:idx_watched_stocks_symbol;not null" json:"symbol"`
	Name      string    `gorm:"" json:"name"`
	AddedAt   time.Time `gorm:"autoCreateTime" json:"addedAt"`
	LastSync  *time.Time `gorm:"" json:"lastSync"`
	IsActive  bool      `gorm:"default:true;not null" json:"isActive"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}

// TableName specifies the table name for WatchedStock
func (WatchedStock) TableName() string {
	return "watched_stocks"
}

// StockDailySummary represents daily aggregated stock data
type StockDailySummary struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Symbol    string    `gorm:"index:idx_daily_summary_symbol_date;not null" json:"symbol"`
	Date      time.Time `gorm:"index:idx_daily_summary_symbol_date;not null" json:"date"`
	Open      float64   `gorm:"not null" json:"open"`
	High      float64   `gorm:"not null" json:"high"`
	Low       float64   `gorm:"not null" json:"low"`
	Close     float64   `gorm:"not null" json:"close"`
	Volume    int64     `gorm:"not null" json:"volume"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}

// TableName specifies the table name for StockDailySummary
func (StockDailySummary) TableName() string {
	return "stock_daily_summary"
}

// Get all model types for auto migration
var allModels = []interface{}{
	&StockMinuteData{},
	&WatchedStock{},
	&StockDailySummary{},
}