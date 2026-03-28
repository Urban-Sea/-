package model

import (
	"fmt"
	"time"
)

// DateOnly wraps time.Time for date-only columns (PostgreSQL `date` type).
// It scans from time.Time (pgx binary protocol) and marshals to JSON as "2006-01-02".
type DateOnly struct {
	time.Time
}

const dateFormat = "2006-01-02"

// Scan implements database/sql.Scanner so pgx can scan PostgreSQL date values.
func (d *DateOnly) Scan(src any) error {
	switch v := src.(type) {
	case time.Time:
		d.Time = v
		return nil
	case string:
		t, err := time.Parse(dateFormat, v)
		if err != nil {
			return fmt.Errorf("DateOnly.Scan: %w", err)
		}
		d.Time = t
		return nil
	case nil:
		return nil
	default:
		return fmt.Errorf("DateOnly.Scan: unsupported type %T", src)
	}
}

// MarshalJSON outputs "2006-01-02" format.
func (d DateOnly) MarshalJSON() ([]byte, error) {
	return []byte(`"` + d.Time.Format(dateFormat) + `"`), nil
}

// UnmarshalJSON parses "2006-01-02" format.
func (d *DateOnly) UnmarshalJSON(b []byte) error {
	s := string(b)
	if s == "null" || s == `""` {
		return nil
	}
	s = s[1 : len(s)-1]
	t, err := time.Parse(dateFormat, s)
	if err != nil {
		return err
	}
	d.Time = t
	return nil
}

// String returns "2006-01-02".
func (d DateOnly) String() string {
	return d.Time.Format(dateFormat)
}
