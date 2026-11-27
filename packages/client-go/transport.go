package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"time"
)

// transport is one of the five: an operation of the common API in, its result as JSON (or an *Error) out
type transport interface {
	name() Transport
	open(ctx context.Context) error
	close() error
	call(ctx context.Context, operation string, a args) (json.RawMessage, error)
}

// notifier is a transport with the notifications of the gateway: only the WebSocket (JSON-RPC) one
type notifier interface {
	on(method string, listener func(params json.RawMessage)) (off func())
}

// withTimeout is the context of one operation: the timeout of the connection, unless ctx ends before
func withTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, timeout)
}

// failed is the error of an operation that ctx ended or the connection couldn't do
func failed(ctx context.Context, t *target, operation, what string, err error) error {
	if ctx.Err() != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return timeoutError(t.transport, operation, t.timeout, ctx.Err())
		}
		return ctx.Err()
	}
	cause := err
	// a *url.Error already says the method and the URL that `what` says
	var u *url.Error
	if errors.As(err, &u) {
		err = u.Err
	}
	return transportError(t.transport, what+": "+err.Error(), cause)
}
