package main

import (
	"time"
)

type WatchedStock struct {
	ID        int       `json:"id" db:"id"`
	Symbol    string    `json:"symbol" db:"symbol"`
	Name      string    `json:"name" db:"name"`
	AddedAt   time.Time `json:"addedAt" db:"added_at"`
	LastSync  time.Time `json:"lastSync" db:"last_sync"`
	IsActive  bool      `json:"isActive" db:"is_active"`
}

type DailySummary struct {
	ID       int       `json:"id" db:"id"`
	Symbol   string    `json:"symbol" db:"symbol"`
	Date     time.Time `json:"date" db:"date"`
	Open     float64   `json:"open" db:"open"`
	High     float64   `json:"high" db:"high"`
	Low      float64   `json:"low" db:"low"`
	Close    float64   `json:"close" db:"close"`
	Volume   int64     `json:"volume" db:"volume"`
	CreateAt time.Time `json:"createdAt" db:"created_at"`
}

type StockSummary struct {
	Symbol       string            `json:"symbol"`
	Name         string            `json:"name"`
	CurrentPrice float64           `json:"currentPrice"`
	Change       float64           `json:"change"`
	ChangePercent float64          `json:"changePercent"`
	LastUpdate   time.Time         `json:"lastUpdate"`
	DailyData    []DailySummary    `json:"dailyData"`
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