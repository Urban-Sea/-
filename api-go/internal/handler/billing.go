package handler

import (
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/stripe/stripe-go/v82"
	portalsession "github.com/stripe/stripe-go/v82/billingportal/session"
	checkoutsession "github.com/stripe/stripe-go/v82/checkout/session"
	"github.com/stripe/stripe-go/v82/customer"
	"github.com/stripe/stripe-go/v82/subscription"
	"github.com/stripe/stripe-go/v82/webhook"

	"github.com/open-regime/api-go/internal/config"
	"github.com/open-regime/api-go/internal/repository"
)

// BillingHandler handles /api/billing endpoints.
type BillingHandler struct {
	cfg      *config.Config
	userRepo *repository.UserRepository
}

// NewBillingHandler creates a new BillingHandler.
func NewBillingHandler(cfg *config.Config, userRepo *repository.UserRepository) *BillingHandler {
	stripe.Key = cfg.StripeSecretKey
	return &BillingHandler{cfg: cfg, userRepo: userRepo}
}

// CreateCheckout handles POST /api/billing/create-checkout.
func (h *BillingHandler) CreateCheckout(c echo.Context) error {
	userID := c.Get("user_id").(string)
	ctx := c.Request().Context()

	user, err := h.userRepo.FindByID(ctx, userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "User not found"})
	}

	// Find or create Stripe customer.
	var customerID string
	if user.StripeCustomerID != nil && *user.StripeCustomerID != "" {
		customerID = *user.StripeCustomerID
	} else {
		params := &stripe.CustomerParams{
			Email: stripe.String(user.Email),
			Params: stripe.Params{
				Metadata: map[string]string{"user_id": user.ID},
			},
		}
		cust, err := customer.New(params)
		if err != nil {
			log.Printf("billing: failed to create Stripe customer for user %s: %v", userID, err)
			return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to create customer"})
		}
		customerID = cust.ID

		if err := h.userRepo.UpdateStripeCustomerID(ctx, userID, customerID); err != nil {
			log.Printf("billing: failed to save stripe_customer_id for user %s: %v", userID, err)
		}
	}

	// Create Checkout Session.
	params := &stripe.CheckoutSessionParams{
		Customer: stripe.String(customerID),
		Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(h.cfg.StripePriceID),
				Quantity: stripe.Int64(1),
			},
		},
		SuccessURL: stripe.String(h.cfg.FrontendURL + "/settings?billing=success"),
		CancelURL:  stripe.String(h.cfg.FrontendURL + "/settings?billing=cancel"),
	}

	sess, err := checkoutsession.New(params)
	if err != nil {
		log.Printf("billing: failed to create checkout session for user %s: %v", userID, err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to create checkout session"})
	}

	return c.JSON(http.StatusOK, map[string]string{"url": sess.URL})
}

// Webhook handles POST /api/billing/webhook.
func (h *BillingHandler) Webhook(c echo.Context) error {
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Cannot read body"})
	}

	sig := c.Request().Header.Get("Stripe-Signature")
	event, err := webhook.ConstructEvent(body, sig, h.cfg.StripeWebhookSecret)
	if err != nil {
		log.Printf("billing: webhook signature verification failed: %v", err)
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid signature"})
	}

	ctx := c.Request().Context()

	switch event.Type {
	case "checkout.session.completed":
		var sess stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &sess); err != nil {
			log.Printf("billing: failed to unmarshal checkout.session.completed: %v", err)
			return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid event data"})
		}
		if sess.Customer != nil {
			user, err := h.userRepo.FindByStripeCustomerID(ctx, sess.Customer.ID)
			if err != nil {
				log.Printf("billing: user not found for stripe customer %s: %v", sess.Customer.ID, err)
				break
			}
			if err := h.userRepo.UpdatePlan(ctx, user.ID, "pro"); err != nil {
				log.Printf("billing: failed to update plan to pro for user %s: %v", user.ID, err)
			}
		}

	case "customer.subscription.deleted":
		var sub stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
			log.Printf("billing: failed to unmarshal customer.subscription.deleted: %v", err)
			return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid event data"})
		}
		if sub.Customer != nil {
			user, err := h.userRepo.FindByStripeCustomerID(ctx, sub.Customer.ID)
			if err != nil {
				log.Printf("billing: user not found for stripe customer %s: %v", sub.Customer.ID, err)
				break
			}
			if err := h.userRepo.UpdatePlan(ctx, user.ID, "free"); err != nil {
				log.Printf("billing: failed to update plan to free for user %s: %v", user.ID, err)
			}
		}
	}

	return c.JSON(http.StatusOK, map[string]bool{"received": true})
}

// Portal handles GET /api/billing/portal.
func (h *BillingHandler) Portal(c echo.Context) error {
	userID := c.Get("user_id").(string)
	ctx := c.Request().Context()

	user, err := h.userRepo.FindByID(ctx, userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "User not found"})
	}

	if user.StripeCustomerID == nil || *user.StripeCustomerID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "No billing account"})
	}

	params := &stripe.BillingPortalSessionParams{
		Customer:  user.StripeCustomerID,
		ReturnURL: stripe.String(h.cfg.FrontendURL + "/settings"),
	}

	sess, err := portalsession.New(params)
	if err != nil {
		log.Printf("billing: failed to create portal session for user %s: %v", userID, err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to create portal session"})
	}

	return c.JSON(http.StatusOK, map[string]string{"url": sess.URL})
}

// Cancel handles POST /api/billing/cancel.
func (h *BillingHandler) Cancel(c echo.Context) error {
	userID := c.Get("user_id").(string)
	ctx := c.Request().Context()

	user, err := h.userRepo.FindByID(ctx, userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "User not found"})
	}

	if user.StripeCustomerID == nil || *user.StripeCustomerID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "No billing account"})
	}

	// Find active subscription for customer.
	params := &stripe.SubscriptionListParams{
		Customer: user.StripeCustomerID,
		Status:   stripe.String(string(stripe.SubscriptionStatusActive)),
	}

	iter := subscription.List(params)
	var activeSub *stripe.Subscription
	for iter.Next() {
		activeSub = iter.Subscription()
		break
	}
	if err := iter.Err(); err != nil {
		log.Printf("billing: failed to list subscriptions for user %s: %v", userID, err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to list subscriptions"})
	}

	if activeSub == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "No active subscription"})
	}

	// Cancel at period end.
	_, err = subscription.Update(activeSub.ID, &stripe.SubscriptionParams{
		CancelAtPeriodEnd: stripe.Bool(true),
	})
	if err != nil {
		log.Printf("billing: failed to cancel subscription for user %s: %v", userID, err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to cancel subscription"})
	}

	if err := h.userRepo.UpdatePlan(ctx, user.ID, "free"); err != nil {
		log.Printf("billing: failed to update plan to free for user %s: %v", user.ID, err)
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "cancelled"})
}
