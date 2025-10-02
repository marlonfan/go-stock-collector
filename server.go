package main

import (
	"log"

	"github.com/gin-gonic/gin"
)

type WebServer struct {
	collector *StockCollector
	router    *gin.Engine
}

func NewWebServer(dbPath string) (*WebServer, error) {
	collector, err := NewStockCollector(dbPath)
	if err != nil {
		return nil, err
	}

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())

	server := &WebServer{
		collector: collector,
		router:    router,
	}

	server.setupRoutes()
	return server, nil
}

func (ws *WebServer) setupRoutes() {
	// Serve static files
	ws.router.Static("/static", "./static")
	ws.router.StaticFile("/", "./static/index.html")
	ws.router.StaticFile("/index.html", "./static/index.html")

	// API routes
	api := ws.router.Group("/api")
	{
		// Stock search
		api.GET("/search", ws.searchStocks)

		// Stock management
		api.GET("/stocks", ws.getWatchedStocks)
		api.POST("/stocks", ws.addWatchedStock)
		api.DELETE("/stocks/:symbol", ws.removeWatchedStock)

		// Stock data
		api.GET("/stocks/:symbol/summary", ws.getStockSummary)
		api.GET("/stocks/:symbol/data", ws.getStockData)
		api.POST("/stocks/:symbol/sync", ws.syncStockData)
	}
}

func (ws *WebServer) Run(addr string) error {
	log.Printf("Web server starting on %s", addr)
	return ws.router.Run(addr)
}

func (ws *WebServer) Close() {
	if ws.collector != nil {
		ws.collector.Close()
	}
}