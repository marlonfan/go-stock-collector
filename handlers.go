package main

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func (ws *WebServer) getWatchedStocks(c *gin.Context) {
	stocks, err := ws.collector.database.GetWatchedStocks()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Convert GORM models to API models
	var apiStocks []WatchedStockAPI
	for _, stock := range stocks {
		apiStocks = append(apiStocks, WatchedStockAPI{
			ID:       int(stock.ID),
			Symbol:   stock.Symbol,
			Name:     stock.Name,
			AddedAt:  stock.AddedAt,
			LastSync: stock.LastSync,
			IsActive: stock.IsActive,
		})
	}

	c.JSON(http.StatusOK, apiStocks)
}

func (ws *WebServer) addWatchedStock(c *gin.Context) {
	var req AddStockRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	symbol := strings.ToUpper(req.Symbol)
	if !isValidSymbol(symbol) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid stock symbol"})
		return
	}

	// Add to watched stocks
	if err := ws.collector.database.AddWatchedStock(symbol, req.Name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Stock added successfully",
		"symbol":  symbol,
	})
}

func (ws *WebServer) removeWatchedStock(c *gin.Context) {
	symbol := strings.ToUpper(c.Param("symbol"))
	if symbol == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Symbol is required"})
		return
	}

	if err := ws.collector.database.RemoveWatchedStock(symbol); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Stock removed successfully"})
}

func (ws *WebServer) getStockSummary(c *gin.Context) {
	symbol := strings.ToUpper(c.Param("symbol"))
	if symbol == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Symbol is required"})
		return
	}

	// Get watched stocks to find stock name
	watchedStocks, err := ws.collector.database.GetWatchedStocks()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var stockName string
	for _, stock := range watchedStocks {
		if stock.Symbol == symbol {
			stockName = stock.Name
			break
		}
	}

	// Get daily summary for last 30 days
	dailyData, err := ws.collector.database.GetDailySummary(symbol, 30)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get latest price
	currentPrice, lastUpdate, err := ws.collector.database.GetLatestPrice(symbol)
	if err != nil {
		// If no price data, return just the daily data
		c.JSON(http.StatusOK, StockSummary{
			Symbol:     symbol,
			Name:       stockName,
			DailyData:  dailyData,
			IsActive:   true,
		})
		return
	}

	// Calculate change from previous day's close
	var change float64
	var changePercent float64
	if len(dailyData) > 0 {
		previousClose := dailyData[0].Close // Most recent day
		if len(dailyData) > 1 {
			previousClose = dailyData[1].Close // Previous day
		}
		change = currentPrice - previousClose
		if previousClose > 0 {
			changePercent = (change / previousClose) * 100
		}
	}

	summary := StockSummary{
		Symbol:        symbol,
		Name:          stockName,
		CurrentPrice:  currentPrice,
		Change:        change,
		ChangePercent: changePercent,
		LastUpdate:    lastUpdate,
		DailyData:     dailyData,
		IsActive:      true,
	}

	c.JSON(http.StatusOK, summary)
}

type dailyBar struct {
	Timestamp time.Time `json:"timestamp"`
	Open      float64   `json:"open"`
	High      float64   `json:"high"`
	Low       float64   `json:"low"`
	Close     float64   `json:"close"`
	Volume    int64     `json:"volume"`
}

func (ws *WebServer) getStockData(c *gin.Context) {
	symbol := strings.ToUpper(c.Param("symbol"))
	days := 30

	if daysQuery := c.Query("days"); daysQuery != "" {
		if d, err := parseDays(daysQuery); err == nil {
			days = d
		}
	}

	if c.Query("granularity") == "daily" {
		summaries, err := ws.collector.database.GetDailySummary(symbol, days)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		bars := make([]dailyBar, len(summaries))
		for i, s := range summaries {
			bars[len(summaries)-1-i] = dailyBar{
				Timestamp: s.Date,
				Open:      s.Open,
				High:      s.High,
				Low:       s.Low,
				Close:     s.Close,
				Volume:    s.Volume,
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"symbol": symbol,
			"days":   days,
			"count":  len(bars),
			"data":   bars,
		})
		return
	}

	bars, err := ws.collector.GetDataForAnalysis(symbol, days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Optional aggregation: ?interval=N collapses N consecutive minute bars into
	// one OHLCV bar. Used by the 5D chart view (interval=15) to keep the payload
	// and visual density manageable.
	if intervalStr := c.Query("interval"); intervalStr != "" {
		if interval, err := strconv.Atoi(intervalStr); err == nil && interval > 1 {
			bars = aggregateMinuteBars(bars, interval)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"symbol": symbol,
		"days":   days,
		"count":  len(bars),
		"data":   bars,
	})
}

// aggregateMinuteBars buckets minute-level bars into windowMin-minute candles.
// The bucket key is floor(timestamp / windowMin) so gaps (overnight, weekends)
// produce no spurious empty bars.
func aggregateMinuteBars(bars []MinuteBar, windowMin int) []MinuteBar {
	if windowMin <= 1 || len(bars) == 0 {
		return bars
	}
	window := time.Duration(windowMin) * time.Minute

	type bucket struct {
		open, high, low, close float64
		volume                 int64
		first, last            time.Time
	}
	order := make([]time.Time, 0)
	buckets := make(map[time.Time]*bucket)

	for _, b := range bars {
		key := b.Timestamp.Truncate(window)
		bk, ok := buckets[key]
		if !ok {
			bk = &bucket{
				open: b.Open, high: b.High, low: b.Low, close: b.Close,
				volume: b.Volume, first: b.Timestamp, last: b.Timestamp,
			}
			buckets[key] = bk
			order = append(order, key)
			continue
		}
		if b.Timestamp.Before(bk.first) {
			bk.first = b.Timestamp
			bk.open = b.Open
		}
		if b.Timestamp.After(bk.last) {
			bk.last = b.Timestamp
			bk.close = b.Close
		}
		if b.High > bk.high {
			bk.high = b.High
		}
		if b.Low < bk.low {
			bk.low = b.Low
		}
		bk.volume += b.Volume
	}

	out := make([]MinuteBar, 0, len(order))
	for _, key := range order {
		bk := buckets[key]
		out = append(out, MinuteBar{
			Symbol:    bars[0].Symbol,
			Timestamp: key,
			Open:      bk.open,
			High:      bk.high,
			Low:       bk.low,
			Close:     bk.close,
			Volume:    bk.volume,
		})
	}
	return out
}

func (ws *WebServer) syncStockData(c *gin.Context) {
	symbol := strings.ToUpper(c.Param("symbol"))
	if symbol == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Symbol is required"})
		return
	}

	// Check if stock is being watched
	watchedStocks, err := ws.collector.database.GetWatchedStocks()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	isWatched := false
	for _, stock := range watchedStocks {
		if stock.Symbol == symbol {
			isWatched = true
			break
		}
	}

	if !isWatched {
		c.JSON(http.StatusNotFound, gin.H{"error": "Stock not found in watchlist"})
		return
	}

	// Sync data (30 days for initial, then incremental)
	days := 30
	latestTimestamp, _ := ws.collector.database.GetLatestTimestamp(symbol)
	if !latestTimestamp.IsZero() {
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
				days = 1
			} else {
				// Different day - fetch since the day of latest data
				days = daysSinceLatest
			}
		} else if daysSinceLatest <= 0 {
			// This shouldn't happen with the +1 above, but keep as safety check
			days = 1
		} else {
			days = daysSinceLatest
		}
	}

	err = ws.collector.CollectHistoricalData(symbol, days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Update last sync time
	if err := ws.collector.database.UpdateLastSync(symbol); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get latest timestamp after sync
	latestTimestamp, _ = ws.collector.database.GetLatestTimestamp(symbol)

	response := SyncResponse{
		Success:     true,
		Message:     "Data synchronized successfully",
		RecordsAdded: days,
		LatestDate:  latestTimestamp.Format("2006-01-02 15:04:05"),
	}

	c.JSON(http.StatusOK, response)
}

func isValidSymbol(symbol string) bool {
	if len(symbol) < 1 || len(symbol) > 5 {
		return false
	}
	for _, char := range symbol {
		if !((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z')) {
			return false
		}
	}
	return true
}

func parseDays(s string) (int, error) {
	var days int
	_, err := fmt.Sscanf(s, "%d", &days)
	return days, err
}

func (ws *WebServer) searchStocks(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Query parameter 'q' is required"})
		return
	}

	// 初始化搜索服务
	searchService, err := NewStockSearchService()
	if err != nil {
		fmt.Printf("Error initializing search service: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initialize search service"})
		return
	}

	fmt.Printf("Search service initialized successfully, loaded %d stocks\n", len(searchService.stocks))

	// 执行搜索，最多返回15个结果
	results := searchService.Search(query, 15)

	fmt.Printf("Search for '%s' returned %d results\n", query, len(results))

	c.JSON(http.StatusOK, gin.H{
		"query":   query,
		"results": results,
		"count":   len(results),
	})
}