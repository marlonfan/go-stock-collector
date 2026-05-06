package main

import (
	"log"
	"time"

	"github.com/robfig/cron/v3"
)

// Scheduler handles scheduled data updates for watched stocks
type Scheduler struct {
	collector *StockCollector
	database  *Database
	cron      *cron.Cron
}

// NewScheduler creates a new scheduler instance with China timezone
func NewScheduler(collector *StockCollector, database *Database) (*Scheduler, error) {
	// Load China timezone (UTC+8)
	chinaTZ, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return nil, err
	}

	// Create cron with China timezone
	c := cron.New(cron.WithLocation(chinaTZ))

	return &Scheduler{
		collector: collector,
		database:  database,
		cron:      c,
	}, nil
}

// Start begins the scheduler with daily updates at 8:00 AM China time
func (s *Scheduler) Start() {
	// Schedule daily update at 8:00 AM China time
	// Cron format: minute hour day month weekday
	// "0 8 * * *" means: at 8:00 AM every day
	_, err := s.cron.AddFunc("0 8 * * *", func() {
		log.Println("[Scheduler] Starting scheduled data update at 8:00 AM China time...")
		s.updateAllWatchedStocks()
	})

	if err != nil {
		log.Printf("[Scheduler] Failed to schedule task: %v", err)
		return
	}

	s.cron.Start()
	log.Println("[Scheduler] Scheduler started - will update all watched stocks daily at 8:00 AM China time")
}

// updateAllWatchedStocks fetches latest data for the union of every user's
// watchlist (deduplicated). Market data is shared across users, so each
// unique symbol is synced once per scheduler run.
func (s *Scheduler) updateAllWatchedStocks() {
	symbols, err := s.database.GetAllUniqueSymbols()
	if err != nil {
		log.Printf("[Scheduler] Error getting unique symbols: %v", err)
		return
	}

	if len(symbols) == 0 {
		log.Println("[Scheduler] No watched stocks to update")
		return
	}

	log.Printf("[Scheduler] Updating %d unique symbols...", len(symbols))

	successCount := 0
	failCount := 0

	for _, symbol := range symbols {
		log.Printf("[Scheduler] Updating %s...", symbol)

		err := s.collector.CollectHistoricalData(symbol, 1)
		if err != nil {
			log.Printf("[Scheduler] Failed to update %s: %v", symbol, err)
			failCount++
			continue
		}

		if err := s.database.UpdateLastSync(symbol); err != nil {
			log.Printf("[Scheduler] Warning: failed to update last sync time for %s: %v", symbol, err)
		}

		successCount++
		time.Sleep(2 * time.Second)
	}

	log.Printf("[Scheduler] Update completed: %d succeeded, %d failed", successCount, failCount)
}

// Stop gracefully stops the scheduler
func (s *Scheduler) Stop() {
	log.Println("[Scheduler] Stopping scheduler...")
	s.cron.Stop()
	log.Println("[Scheduler] Scheduler stopped")
}
