package main

import (
	"log"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

type WebServer struct {
	collector  *StockCollector
	scheduler  *Scheduler
	router     *gin.Engine
	inviteCode string
}

func NewWebServer(dbPath string, enableScheduler bool, inviteCode string) (*WebServer, error) {
	collector, err := NewStockCollector(dbPath)
	if err != nil {
		return nil, err
	}

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())

	// Session middleware. Cookie store keeps session data signed inside the
	// cookie itself, so we don't need a server-side session table.
	secret, err := loadSessionSecret()
	if err != nil {
		return nil, err
	}
	router.Use(sessions.Sessions(sessionName, sessionStore(secret)))

	server := &WebServer{
		collector:  collector,
		router:     router,
		inviteCode: inviteCode,
	}

	// Initialize scheduler if enabled
	if enableScheduler {
		scheduler, err := NewScheduler(collector, collector.database)
		if err != nil {
			log.Printf("Warning: Failed to initialize scheduler: %v", err)
		} else {
			server.scheduler = scheduler
			scheduler.Start()
		}
	}

	server.setupRoutes()
	return server, nil
}

func (ws *WebServer) setupRoutes() {
	// Serve static files
	ws.router.Static("/static", "./static")
	ws.router.StaticFile("/", "./static/index.html")
	ws.router.StaticFile("/index.html", "./static/index.html")

	// Public auth endpoints
	auth := ws.router.Group("/api/auth")
	{
		auth.POST("/register", ws.handleRegister)
		auth.POST("/login", ws.handleLogin)
		auth.GET("/onboarding", ws.handleOnboarding)
		// Authenticated auth helpers
		auth.GET("/me", authMiddleware(), ws.handleMe)
		auth.POST("/logout", authMiddleware(), ws.handleLogout)
	}

	// Authenticated API routes — every read/write of stock data requires login
	api := ws.router.Group("/api", authMiddleware())
	{
		// Stock search
		api.GET("/search", ws.searchStocks)

		// Stock management (per-user watchlist)
		api.GET("/stocks", ws.getWatchedStocks)
		api.POST("/stocks", ws.addWatchedStock)
		api.DELETE("/stocks/:symbol", ws.removeWatchedStock)
		api.PATCH("/stocks/:symbol/pin", ws.setStockPinned)

		// Stock data (shared market cache, gated to authenticated users)
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
	if ws.scheduler != nil {
		ws.scheduler.Stop()
	}
	if ws.collector != nil {
		ws.collector.Close()
	}
}