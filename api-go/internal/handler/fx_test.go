package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

// failTransport always returns an error, ensuring fetchRate fails deterministically.
type failTransport struct{}

func (f *failTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, fmt.Errorf("forced transport failure for test")
}

func TestFXHandler_GetUSDJPY_CacheMiss_ServiceUnavailable(t *testing.T) {
	// With a redis client pointing to nowhere, cache will miss and
	// fetchRate will also fail (no mock server), so we expect 503.
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:0"}) // unreachable

	h := NewFXHandler(rdb)
	// Force fetchRate to fail deterministically (don't rely on network being down).
	h.httpClient = &http.Client{Transport: &failTransport{}}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/fx/usdjpy", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.GetUSDJPY(c)
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}

	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp["detail"] != "Failed to fetch USD/JPY rate" {
		t.Errorf("detail = %q, want %q", resp["detail"], "Failed to fetch USD/JPY rate")
	}
}

func TestFXHandler_GetUSDJPY_WithMockYahoo(t *testing.T) {
	// Mock Yahoo Finance API.
	mockYF := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"chart": {
				"result": [{
					"meta": {
						"regularMarketPrice": 149.567
					}
				}]
			}
		}`))
	}))
	defer mockYF.Close()

	rdb := redis.NewClient(&redis.Options{Addr: "localhost:0"}) // unreachable, cache will miss

	h := NewFXHandler(rdb)
	// Override the HTTP client to hit the mock server instead.
	originalURL := yfChartURL
	_ = originalURL // yfChartURL is a const, so we override via a custom fetchRate approach.

	// We can't override the const, so instead we test the response format
	// by calling fetchRate with a mock transport.
	h.httpClient = mockYF.Client()

	// We need to override the URL too. Since yfChartURL is a const,
	// we test the full handler by temporarily replacing httpClient with
	// a transport that redirects all requests to the mock.
	h.httpClient.Transport = &mockTransport{target: mockYF.URL}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/fx/usdjpy", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.GetUSDJPY(c)
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var resp fxResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if resp.Rate != 149.57 {
		t.Errorf("rate = %v, want 149.57", resp.Rate)
	}
	if resp.Cached != false {
		t.Errorf("cached = %v, want false", resp.Cached)
	}
	if resp.UpdatedAt == "" {
		t.Error("updated_at should not be empty")
	}
}

func TestFXResponse_JSONFormat(t *testing.T) {
	resp := fxResponse{
		Rate:      149.57,
		Cached:    true,
		UpdatedAt: "2026-03-28T12:00:00Z",
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded["rate"] != 149.57 {
		t.Errorf("rate = %v, want 149.57", decoded["rate"])
	}
	if decoded["cached"] != true {
		t.Errorf("cached = %v, want true", decoded["cached"])
	}
	if decoded["updated_at"] != "2026-03-28T12:00:00Z" {
		t.Errorf("updated_at = %v, want 2026-03-28T12:00:00Z", decoded["updated_at"])
	}
}

// mockTransport redirects all HTTP requests to the target URL.
type mockTransport struct {
	target string
}

func (m *mockTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// Replace the URL with the mock server URL, keeping the path.
	newReq := req.Clone(req.Context())
	newReq.URL.Scheme = "http"
	newReq.URL.Host = m.target[len("http://"):]
	return http.DefaultTransport.RoundTrip(newReq)
}
