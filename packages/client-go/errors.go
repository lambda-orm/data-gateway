package gateway

import (
	"errors"
	"fmt"
	"strconv"
)

// ErrorCode is the code of an error, the same on every transport and in every client of the Data Gateway (the table
// of the conformance suite: packages/conformance/README.md, "Errors").
type ErrorCode string

const (
	// CodeInvalid: 400 or 422, the query, the model or a value is wrong (SchemaError, SintaxisError, ValidationError…)
	CodeInvalid ErrorCode = "invalid"
	// CodeUnauthorized: 401, no credential or a wrong one
	CodeUnauthorized ErrorCode = "unauthorized"
	// CodeForbidden: 403, the credential lacks the permission
	CodeForbidden ErrorCode = "forbidden"
	// CodeNotFound: 404, a name the schema doesn't have, or a script's throw { status: 404 }
	CodeNotFound ErrorCode = "not_found"
	// CodeUnique: 409 with the database's code of a unique key
	CodeUnique ErrorCode = "unique"
	// CodeForeignKey: 409 with the database's code of a foreign key
	CodeForeignKey ErrorCode = "foreign_key"
	// CodeConflict: any other 409
	CodeConflict ErrorCode = "conflict"
	// CodeTimeout: 408 or 504, or the operation took longer than the timeout of the connection
	CodeTimeout ErrorCode = "timeout"
	// CodeTooLarge: 413
	CodeTooLarge ErrorCode = "too_large"
	// CodeRateLimited: 429
	CodeRateLimited ErrorCode = "rate_limited"
	// CodeUnavailable: 503, the schema is not ready
	CodeUnavailable ErrorCode = "unavailable"
	// CodeInternal: any other status
	CodeInternal ErrorCode = "internal"
	// CodeTruncated: MCP only, the list was cut at the mcp.maxRows of the gateway (see WithTruncatedRows)
	CodeTruncated ErrorCode = "truncated"
	// CodeUnsupported: the operation is not on that transport
	CodeUnsupported ErrorCode = "unsupported"
	// CodeTransport: the connection failed (refused, closed, a handshake rejected)
	CodeTransport ErrorCode = "transport"
)

// Suggestion is a name of a query that doesn't exist, with the closest ones of the schema.
type Suggestion struct {
	Name       string   `json:"name"`
	DidYouMean []string `json:"didYouMean"`
}

// Error is what every operation that fails returns, on any transport: branch on Code (errors.As, or IsCode).
type Error struct {
	Code ErrorCode
	// Name is the name the gateway gave the error: SchemaError, ValidationError, ForbiddenError, NotFoundError, …
	Name string
	// Status is the HTTP status the gateway answers it with (also on WebSocket and MCP); 0 when there is none
	Status int
	// DBCode is the code of the database, for an error of the database (Postgres 23505, MySQL ER_DUP_ENTRY, …)
	DBCode  string
	Message string
	// Suggestions: the names of the query that don't exist, with the closest ones
	Suggestions []Suggestion
	Transport   Transport
	Operation   string
	cause       error
}

func (e *Error) Error() string {
	text := string(e.Code)
	if e.Name != "" {
		text += " (" + e.Name + ")"
	}
	return text + ": " + e.Message
}

// Unwrap gives the error behind it (a context.DeadlineExceeded, a network error), when there is one.
func (e *Error) Unwrap() error { return e.cause }

// IsCode tells whether err is (or wraps) an Error of the Data Gateway with that code.
func IsCode(err error, code ErrorCode) bool {
	var e *Error
	return errors.As(err, &e) && e.Code == code
}

var (
	uniqueCodes     = []string{"23505", "ER_DUP_ENTRY", "1062", "ORA-00001", "2627", "2601", "11000"}
	foreignKeyCodes = []string{"23503", "ER_NO_REFERENCED_ROW_2", "ER_ROW_IS_REFERENCED_2", "1451", "1452", "ORA-02291", "ORA-02292", "547"}
)

func contains(list []string, value string) bool {
	for _, v := range list {
		if v == value {
			return true
		}
	}
	return false
}

// CodeOf is the code of an error from the status the gateway answers and, for a conflict, the code of the database.
func CodeOf(status int, dbCode string) ErrorCode {
	if status == 409 {
		switch {
		case dbCode != "" && contains(uniqueCodes, dbCode):
			return CodeUnique
		case dbCode != "" && contains(foreignKeyCodes, dbCode):
			return CodeForeignKey
		}
		return CodeConflict
	}
	switch status {
	case 400, 422:
		return CodeInvalid
	case 401:
		return CodeUnauthorized
	case 403:
		return CodeForbidden
	case 404:
		return CodeNotFound
	case 408, 504:
		return CodeTimeout
	case 413:
		return CodeTooLarge
	case 429:
		return CodeRateLimited
	case 503:
		return CodeUnavailable
	}
	return CodeInternal
}

// answer is an error as the gateway answered it, on any transport
type answer struct {
	status      int
	name        string
	dbCode      any
	message     string
	suggestions []Suggestion
}

func gatewayError(transport Transport, a answer) *Error {
	dbCode := ""
	switch v := a.dbCode.(type) {
	case nil:
	case string:
		dbCode = v
	case float64:
		dbCode = strconv.FormatFloat(v, 'f', -1, 64)
	default:
		dbCode = fmt.Sprint(v)
	}
	var suggestions []Suggestion
	if len(a.suggestions) > 0 {
		suggestions = a.suggestions
	}
	return &Error{Code: CodeOf(a.status, dbCode), Name: a.name, Status: a.status, DBCode: dbCode, Message: a.message, Suggestions: suggestions, Transport: transport}
}

func transportError(transport Transport, message string, cause error) *Error {
	return &Error{Code: CodeTransport, Message: message, Transport: transport, cause: cause}
}

func timeoutError(transport Transport, operation string, timeout fmt.Stringer, cause error) *Error {
	return &Error{Code: CodeTimeout, Message: fmt.Sprintf("%s took longer than %s", operation, timeout), Transport: transport, Operation: operation, cause: cause}
}

func unsupported(transport Transport, operation string) *Error {
	where, ok := where[operation]
	if !ok {
		where = "not on this transport"
	}
	return &Error{Code: CodeUnsupported, Message: fmt.Sprintf("%s is not available on %s: %s", operation, transport, where), Transport: transport, Operation: operation}
}
