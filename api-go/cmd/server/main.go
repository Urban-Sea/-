package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"time"

	"gopkg.in/natefinch/lumberjack.v2"

	"github.com/getsentry/sentry-go"
	sentryecho "github.com/getsentry/sentry-go/echo"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"
	"github.com/redis/go-redis/v9"

	"github.com/open-regime/api-go/internal/config"
	"github.com/open-regime/api-go/internal/handler"
	"github.com/open-regime/api-go/internal/middleware"
	"github.com/open-regime/api-go/internal/repository"
	"github.com/open-regime/api-go/internal/service"
)

func main() {
	// ── Config ──
	cfg := config.Load()

	// ── Logger ──
	var logWriter io.Writer = os.Stdout
	if cfg.Environment == "production" {
		logWriter = io.MultiWriter(os.Stdout, &lumberjack.Logger{
			Filename:   "/var/log/open-regime/api-go/app.log",
			MaxSize:    50, // MB
			MaxBackups: 3,
			MaxAge:     7, // days
			Compress:   true,
		})
	}
	logger := slog.New(slog.NewJSONHandler(logWriter, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// ── Sentry ──
	if cfg.SentryDSN != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:              cfg.SentryDSN,
			Environment:      cfg.Environment,
			TracesSampleRate: 0.1,
		}); err != nil {
			slog.Warn("Sentry init failed", "error", err)
		} else {
			defer sentry.Flush(2 * time.Second)
			slog.Info("Sentry initialized")
		}
	}

	// ── PostgreSQL ──
	ctx := context.Background()
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		slog.Error("Failed to parse DB config", "error", err)
		os.Exit(1)
	}
	poolCfg.MinConns = 2
	poolCfg.MaxConns = 10

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		slog.Error("Failed to create DB pool", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		slog.Error("Failed to ping DB", "error", err)
		os.Exit(1)
	}
	slog.Info("PostgreSQL connected")

	// ── Migrations ──
	runMigrations(cfg)

	// ── Redis ──
	opts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		slog.Error("Failed to parse Redis URL", "error", err)
		os.Exit(1)
	}
	rdb := redis.NewClient(opts)
	defer rdb.Close()

	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Warn("Redis ping failed, continuing without cache", "error", err)
	} else {
		slog.Info("Redis connected")
	}

	// ── Repositories ──
	userRepo := repository.NewUserRepository(pool)
	holdingRepo := repository.NewHoldingRepository(pool)
	cashRepo := repository.NewCashRepository(pool)
	snapshotRepo := repository.NewSnapshotRepository(pool)
	stockRepo := repository.NewStockRepository(pool)
	tradeRepo := repository.NewTradeRepository(pool)
	watchlistRepo := repository.NewWatchlistRepository(pool)
	marketStateRepo := repository.NewMarketStateRepository(pool)
	liquidityRepo := repository.NewLiquidityRepository(pool)
	employmentRepo := repository.NewEmploymentRepository(pool)
	adminRepo := repository.NewAdminRepository(pool)
	discoveryRepo := repository.NewDiscoveryRepository(pool)
	mfaRepo := repository.NewMFARepository(pool)

	// ── Services ──
	authSvc := service.NewAuthService(cfg.JWTSecret, userRepo, rdb)
	mfaSvc, mfaSvcErr := service.NewMFAService(cfg.MFAEncryptionKey, mfaRepo, rdb)
	if mfaSvcErr != nil {
		slog.Warn("MFA service init failed (admin MFA will be unavailable)", "error", mfaSvcErr)
	}

	// ── Handlers ──
	authHandler := handler.NewAuthHandler(cfg, authSvc, userRepo, rdb)
	usersHandler := handler.NewUsersHandler(cfg, userRepo)
	holdingsHandler := handler.NewHoldingsHandler(holdingRepo, cashRepo, snapshotRepo)
	fxHandler := handler.NewFXHandler(rdb)
	stocksHandler := handler.NewStocksHandler(stockRepo)
	tradesHandler := handler.NewTradesHandler(tradeRepo)
	watchlistHandler := handler.NewWatchlistHandler(watchlistRepo)
	marketStateHandler := handler.NewMarketStateHandler(marketStateRepo)
	liquidityHandler := handler.NewLiquidityHandler(liquidityRepo)
	employmentHandler := handler.NewEmploymentHandler(employmentRepo, rdb, cfg.WarmupToken)
	adminHandler := handler.NewAdminHandler(adminRepo)
	discoveryHandler := handler.NewDiscoveryHandler(discoveryRepo, adminRepo, rdb, cfg.PublishToken)
	billingHandler := handler.NewBillingHandler(cfg, userRepo)

	// ── Echo ──
	e := echo.New()
	e.HideBanner = true

	// ── Middleware chain ──
	e.Use(echomw.Recover())
	if cfg.SentryDSN != "" {
		e.Use(sentryecho.New(sentryecho.Options{Repanic: true}))
	}
	e.Use(middleware.SecurityHeaders())
	e.Use(middleware.CORSMiddleware(cfg))
	e.Use(middleware.CSRFProtection())
	e.Use(middleware.RateLimitMiddleware(rdb))

	// ── Public routes ──
	e.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	// Auth (no auth required)
	e.GET("/api/auth/google", authHandler.GoogleLogin)
	e.GET("/api/auth/google/callback", authHandler.GoogleCallback)
	e.POST("/api/auth/refresh", authHandler.RefreshToken)
	e.POST("/api/auth/logout", authHandler.Logout)

	// FX (public)
	e.GET("/api/fx/usdjpy", fxHandler.GetUSDJPY)

	// Stocks (public)
	stocksGroup := e.Group("/api/stocks")
	stocksHandler.Register(stocksGroup)

	// Market state (public)
	e.GET("/api/market-state", marketStateHandler.List)
	e.GET("/api/market-state/latest", marketStateHandler.GetLatest)

	// ── Auth-required routes ──
	auth := e.Group("", middleware.AuthMiddleware(authSvc))
	auth.GET("/api/auth/me", authHandler.Me)
	auth.GET("/api/me", usersHandler.GetMe)
	auth.PATCH("/api/me", usersHandler.UpdateMe)

	// Market state (auth POST)
	auth.POST("/api/market-state", marketStateHandler.Create)

	// Holdings
	holdingsGroup := auth.Group("/api/holdings")
	holdingsHandler.Register(holdingsGroup)

	// Trades
	tradesGroup := auth.Group("/api/trades")
	tradesHandler.Register(tradesGroup)

	// Watchlist
	auth.GET("/api/watchlist", watchlistHandler.List)
	auth.POST("/api/watchlist", watchlistHandler.Create)
	auth.GET("/api/watchlist/:id", watchlistHandler.Get)
	auth.PUT("/api/watchlist/:id", watchlistHandler.Update)
	auth.DELETE("/api/watchlist/:id", watchlistHandler.Delete)
	auth.POST("/api/watchlist/:id/tickers", watchlistHandler.ModifyTicker)

	// Liquidity (public GET + auth POST)
	liquidityPublic := e.Group("/api/liquidity")
	liquidityAuth := auth.Group("/api/liquidity")
	liquidityHandler.Register(liquidityPublic, liquidityAuth)

	// Employment (public GET + auth POST)
	employmentPublic := e.Group("/api/employment")
	employmentAuth := auth.Group("/api/employment")
	employmentHandler.Register(employmentPublic, employmentAuth)

	// Billing (auth + public webhook)
	auth.POST("/api/billing/checkout", billingHandler.CreateCheckout)
	e.POST("/api/billing/webhook", billingHandler.Webhook)
	auth.POST("/api/billing/portal", billingHandler.Portal)
	auth.POST("/api/billing/cancel", billingHandler.Cancel)

	// ── Admin routes ──
	admin := e.Group("/api/admin", middleware.AuthMiddleware(authSvc), middleware.AdminMFAMiddleware(cfg, pool))
	adminHandler.Register(admin)

	// Discovery (all token-auth, no cookie/MFA middleware)
	// POST uses X-Publish-Token (handler-level auth).
	discoveryGroup := e.Group("/api/discovery")
	discoveryHandler.Register(discoveryGroup)

	// Admin MFA (auth + admin check, but no MFA required for setup)
	adminMFA := e.Group("/api/admin/mfa", middleware.AuthMiddleware(authSvc), middleware.AdminMiddleware(cfg))
	if mfaSvc != nil {
		adminMFAHandler := handler.NewAdminMFAHandler(cfg, mfaSvc, mfaRepo)
		adminMFA.GET("/status", adminMFAHandler.Status)
		adminMFA.POST("/setup", adminMFAHandler.Setup)
		adminMFA.POST("/verify-setup", adminMFAHandler.SetupVerify)
		adminMFA.POST("/verify", adminMFAHandler.Verify)
		adminMFA.GET("/session", adminMFAHandler.SessionCheck)
		adminMFA.POST("/session/logout", adminMFAHandler.SessionLogout)
	}

	// ── Start server ──
	go func() {
		addr := ":8080"
		slog.Info("Starting server", "addr", addr, "env", cfg.Environment)
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			slog.Error("Server error", "error", err)
			os.Exit(1)
		}
	}()

	// ── Graceful shutdown ──
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt)
	<-quit

	slog.Info("Shutting down server...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := e.Shutdown(shutdownCtx); err != nil {
		slog.Error("Server shutdown error", "error", err)
	}
}

func runMigrations(cfg *config.Config) {
	dbURL := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName)

	m, err := migrate.New("file://migrations", dbURL)
	if err != nil {
		slog.Warn("Migration setup failed, skipping", "error", err)
		return
	}
	defer func() {
		srcErr, dbErr := m.Close()
		if srcErr != nil {
			slog.Warn("Migration source close error", "error", srcErr)
		}
		if dbErr != nil {
			slog.Warn("Migration db close error", "error", dbErr)
		}
	}()

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		slog.Warn("Migration failed", "error", err)
		return
	}
	slog.Info("Migrations applied successfully")
}
