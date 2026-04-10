package config

import (
	"os"
	"strings"
)

type Config struct {
	// PostgreSQL
	DBHost     string
	DBPort     string
	DBName     string
	DBUser     string
	DBPassword string

	// Redis
	RedisURL string

	// JWT
	JWTSecret string

	// Google OAuth
	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string

	// Frontend
	FrontendURL string

	// Stripe
	StripeSecretKey    string
	StripeWebhookSecret string
	StripePriceID      string

	// Admin
	AdminEmails []string

	// Cookie
	CookieDomain string

	// MFA
	MFAEncryptionKey string

	// Sentry
	SentryDSN string

	// Warmup token (batch から ?purge=1 を叩く際の認証ヘッダ X-Warmup-Token と照合)
	WarmupToken string

	// Publish token (finviz-publish.py から discovery upsert を叩く際の X-Publish-Token)
	PublishToken string

	// Environment
	Environment string
}

func Load() *Config {
	adminEmails := strings.Split(getEnv("ADMIN_EMAILS", ""), ",")
	// Filter empty strings
	filtered := make([]string, 0, len(adminEmails))
	for _, e := range adminEmails {
		e = strings.TrimSpace(e)
		if e != "" {
			filtered = append(filtered, strings.ToLower(e))
		}
	}

	return &Config{
		DBHost:     getEnv("DB_HOST", "postgres"),
		DBPort:     getEnv("DB_PORT", "5432"),
		DBName:     getEnv("DB_NAME", "open_regime"),
		DBUser:     getEnv("DB_USER", "app"),
		DBPassword: getEnv("DB_PASSWORD", ""),

		RedisURL: getEnv("REDIS_URL", "redis://redis:6379"),

		JWTSecret: getEnv("JWT_SECRET", ""),

		GoogleClientID:     getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: getEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURL:  getEnv("GOOGLE_REDIRECT_URL", "http://localhost/api/auth/google/callback"),

		FrontendURL: getEnv("FRONTEND_URL", "http://localhost"),

		StripeSecretKey:    getEnv("STRIPE_SECRET_KEY", ""),
		StripeWebhookSecret: getEnv("STRIPE_WEBHOOK_SECRET", ""),
		StripePriceID:      getEnv("STRIPE_PRICE_ID", ""),

		AdminEmails: filtered,

		CookieDomain: getEnv("COOKIE_DOMAIN", ""),

		MFAEncryptionKey: getEnv("MFA_ENCRYPTION_KEY", ""),

		SentryDSN: getEnv("SENTRY_DSN", ""),

		WarmupToken:  getEnv("WARMUP_TOKEN", ""),
		PublishToken: getEnv("PUBLISH_TOKEN", ""),

		Environment: getEnv("ENVIRONMENT", "development"),
	}
}

func (c *Config) IsProduction() bool {
	return c.Environment == "production"
}

func (c *Config) IsAdmin(email string) bool {
	email = strings.ToLower(strings.TrimSpace(email))
	for _, admin := range c.AdminEmails {
		if admin == email {
			return true
		}
	}
	return false
}

func (c *Config) DSN() string {
	return "host=" + c.DBHost +
		" port=" + c.DBPort +
		" dbname=" + c.DBName +
		" user=" + c.DBUser +
		" password=" + c.DBPassword +
		" sslmode=disable"
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
