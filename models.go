package main

import (
	"time"
)

// Legacy models for API compatibility (now using GORM models from gorm_models.go)

// WatchedStockAPI is the API-compatible version of WatchedStock
type WatchedStockAPI struct {
	ID        int       `json:"id"`
	Symbol    string    `json:"symbol"`
	Name      string    `json:"name"`
	AddedAt   time.Time `json:"addedAt"`
	LastSync  *time.Time `json:"lastSync"`
	IsActive  bool      `json:"isActive"`
}

// DailySummaryAPI is the API-compatible version of StockDailySummary
type DailySummaryAPI struct {
	ID       int       `json:"id"`
	Symbol   string    `json:"symbol"`
	Date     time.Time `json:"date"`
	Open     float64   `json:"open"`
	High     float64   `json:"high"`
	Low      float64   `json:"low"`
	Close    float64   `json:"close"`
	Volume   int64     `json:"volume"`
	CreateAt time.Time `json:"createdAt"`
}

type StockSummary struct {
	Symbol       string            `json:"symbol"`
	Name         string            `json:"name"`
	CurrentPrice float64           `json:"currentPrice"`
	Change       float64           `json:"change"`
	ChangePercent float64          `json:"changePercent"`
	LastUpdate   time.Time         `json:"lastUpdate"`
	DailyData    []DailySummaryAPI `json:"dailyData"`
	IsActive     bool              `json:"isActive"`
}

type AddStockRequest struct {
	Symbol string `json:"symbol" binding:"required"`
	Name   string `json:"name,omitempty"`
}

type SyncResponse struct {
	Success     bool   `json:"success"`
	Message     string `json:"message"`
	RecordsAdded int   `json:"recordsAdded"`
	LatestDate  string `json:"latestDate"`
}

type StockSearchResult struct {
	Symbol    string `json:"symbol"`
	Name      string `json:"name"`
	ChineseName string `json:"chineseName"`
	FullName  string `json:"fullName"`
}