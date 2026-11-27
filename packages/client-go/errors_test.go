package gateway

import (
	"errors"
	"fmt"
	"testing"
)

func TestCodeOf(t *testing.T) {
	cases := []struct {
		status int
		dbCode string
		want   ErrorCode
	}{
		{400, "", CodeInvalid}, {422, "", CodeInvalid}, {401, "", CodeUnauthorized}, {403, "", CodeForbidden},
		{404, "", CodeNotFound}, {409, "23505", CodeUnique}, {409, "ER_DUP_ENTRY", CodeUnique}, {409, "11000", CodeUnique},
		{409, "23503", CodeForeignKey}, {409, "ORA-02291", CodeForeignKey}, {409, "", CodeConflict}, {408, "", CodeTimeout},
		{504, "", CodeTimeout}, {413, "", CodeTooLarge}, {429, "", CodeRateLimited}, {503, "", CodeUnavailable},
		{500, "", CodeInternal}, {0, "", CodeInternal},
	}
	for _, c := range cases {
		if got := CodeOf(c.status, c.dbCode); got != c.want {
			t.Errorf("CodeOf(%d, %q) = %s, want %s", c.status, c.dbCode, got, c.want)
		}
	}
}

func TestGatewayErrorNumericDBCode(t *testing.T) {
	e := gatewayError(TransportHTTP, answer{status: 409, dbCode: float64(1062), message: "dup"})
	if e.Code != CodeUnique || e.DBCode != "1062" {
		t.Errorf("got %+v", e)
	}
}

func TestIsCode(t *testing.T) {
	err := fmt.Errorf("wrapped: %w", &Error{Code: CodeForbidden, Message: "no"})
	if !IsCode(err, CodeForbidden) || IsCode(err, CodeInvalid) || IsCode(errors.New("x"), CodeForbidden) {
		t.Error("IsCode")
	}
}
