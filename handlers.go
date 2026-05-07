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
	uid := c.MustGet("userID").(uint)
	stocks, err := ws.collector.database.GetWatchedStocks(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Convert GORM models to API models
	apiStocks := make([]WatchedStockAPI, 0, len(stocks))
	for _, stock := range stocks {
		apiStocks = append(apiStocks, WatchedStockAPI{
			ID:        int(stock.ID),
			Symbol:    stock.Symbol,
			Name:      stock.Name,
			AddedAt:   stock.AddedAt,
			LastSync:  stock.LastSync,
			IsActive:  stock.IsActive,
			Pinned:    stock.Pinned,
			MarketCap: stock.MarketCap,
			PERatio:   stock.PERatio,
		})
	}

	c.JSON(http.StatusOK, apiStocks)
}

func (ws *WebServer) addWatchedStock(c *gin.Context) {
	uid := c.MustGet("userID").(uint)
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

	if err := ws.collector.database.AddWatchedStock(uid, symbol, req.Name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Stock added successfully",
		"symbol":  symbol,
	})
}

func (ws *WebServer) removeWatchedStock(c *gin.Context) {
	uid := c.MustGet("userID").(uint)
	symbol := strings.ToUpper(c.Param("symbol"))
	if symbol == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Symbol is required"})
		return
	}

	if err := ws.collector.database.RemoveWatchedStock(uid, symbol); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Stock removed successfully"})
}

func (ws *WebServer) setStockPinned(c *gin.Context) {
	uid := c.MustGet("userID").(uint)
	symbol := strings.ToUpper(c.Param("symbol"))
	if symbol == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Symbol is required"})
		return
	}
	var body struct {
		Pinned bool `json:"pinned"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := ws.collector.database.SetPinned(uid, symbol, body.Pinned); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "pinned": body.Pinned})
}

func (ws *WebServer) getStockSummary(c *gin.Context) {
	uid := c.MustGet("userID").(uint)
	symbol := strings.ToUpper(c.Param("symbol"))
	if symbol == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Symbol is required"})
		return
	}

	// Get watched stocks to find stock name
	watchedStocks, err := ws.collector.database.GetWatchedStocks(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var stockName, marketCap string
	var peRatio *float64
	var pinned bool
	for _, stock := range watchedStocks {
		if stock.Symbol == symbol {
			stockName = stock.Name
			marketCap = stock.MarketCap
			peRatio = stock.PERatio
			pinned = stock.Pinned
			break
		}
	}

	// Pull a year of daily summaries so the frontend can compute 52W high/low
	// and 30-day average volume without an extra round-trip.
	dailyData, err := ws.collector.database.GetDailySummary(symbol, 365)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get latest price
	currentPrice, lastUpdate, err := ws.collector.database.GetLatestPrice(symbol)
	if err != nil {
		// If no price data, return just the daily data
		c.JSON(http.StatusOK, StockSummary{
			Symbol:    symbol,
			Name:      stockName,
			DailyData: dailyData,
			IsActive:  true,
			Pinned:    pinned,
			MarketCap: marketCap,
			PERatio:   peRatio,
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
		Pinned:        pinned,
		MarketCap:     marketCap,
		PERatio:       peRatio,
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
	uid := c.MustGet("userID").(uint)
	symbol := strings.ToUpper(c.Param("symbol"))
	if symbol == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Symbol is required"})
		return
	}

	// Check if stock is being watched by THIS user — sync is shared market
	// data, but we still gate sync to symbols on the caller's watchlist so
	// random users can't trigger arbitrary Yahoo fetches.
	watchedStocks, err := ws.collector.database.GetWatchedStocks(uid)
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

	const totalLimit = 15

	// Hit local CSV (Chinese-name aware, instant) and Yahoo (global coverage,
	// ~200ms) in parallel. Errors in either source don't break the other.
	type srcResult struct {
		results []StockSearchResult
		err     error
	}
	csvCh := make(chan srcResult, 1)
	yahooCh := make(chan srcResult, 1)

	go func() {
		svc, err := NewStockSearchService()
		if err != nil {
			csvCh <- srcResult{err: err}
			return
		}
		csvCh <- srcResult{results: svc.Search(query, totalLimit)}
	}()

	go func() {
		results, err := ws.collector.yahooClient.SearchSymbols(query, totalLimit)
		yahooCh <- srcResult{results: results, err: err}
	}()

	csvOut := <-csvCh
	yahooOut := <-yahooCh

	// CSV first so Chinese-name matches (e.g. "苹果" → AAPL) appear at the top;
	// Yahoo fills in the long tail. Dedupe by symbol (case-insensitive).
	seen := make(map[string]bool, totalLimit)
	merged := make([]StockSearchResult, 0, totalLimit)
	push := func(rs []StockSearchResult) {
		for _, r := range rs {
			key := strings.ToUpper(r.Symbol)
			if seen[key] {
				continue
			}
			seen[key] = true
			merged = append(merged, r)
			if len(merged) >= totalLimit {
				return
			}
		}
	}
	if csvOut.err == nil {
		push(csvOut.results)
	}
	if len(merged) < totalLimit && yahooOut.err == nil {
		push(yahooOut.results)
	}

	if csvOut.err != nil && yahooOut.err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": fmt.Sprintf("search failed: csv=%v yahoo=%v", csvOut.err, yahooOut.err),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"query":   query,
		"results": merged,
		"count":   len(merged),
	})
}