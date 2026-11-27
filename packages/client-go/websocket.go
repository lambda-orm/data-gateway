package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

// webSocketTransport is the JSON-RPC 2.0 API of the gateway over WebSocket, with its notifications
type webSocketTransport struct {
	target *target
	client *http.Client
	socket *rpcSocket
}

func newWebSocketTransport(t *target, client *http.Client) *webSocketTransport {
	return &webSocketTransport{target: t, client: client, socket: newRPCSocket(t.url)}
}

func (w *webSocketTransport) name() Transport { return TransportWebSocket }

func (w *webSocketTransport) open(ctx context.Context) error {
	return openSocket(ctx, w.target, w.socket, w.client)
}

// openSocket opens the socket of a transport with the headers of the moment, within the timeout of the connection
func openSocket(ctx context.Context, t *target, socket *rpcSocket, client *http.Client) error {
	ctx, cancel := withTimeout(ctx, t.timeout)
	defer cancel()
	headers, err := t.headersOf(ctx)
	if err != nil {
		return err
	}
	if err := socket.open(ctx, headers, client); err != nil {
		var e *Error
		if errors.As(err, &e) {
			e.Transport = t.transport
			return e
		}
		return failed(ctx, t, "connect", "can't connect to "+socket.url+" (refused, or the credential was rejected)", err)
	}
	return nil
}

func (w *webSocketTransport) close() error { return w.socket.close() }

func (w *webSocketTransport) call(ctx context.Context, operation string, a args) (json.RawMessage, error) {
	route, ok := rpc[operation]
	if !ok {
		return nil, unsupported(TransportWebSocket, operation)
	}
	ctx, cancel := withTimeout(ctx, w.target.timeout)
	defer cancel()
	to := route(a)
	message, err := w.socket.request(ctx, to.method, to.params)
	if err != nil {
		return nil, failed(ctx, w.target, operation, to.method, err)
	}
	if message.Error != nil {
		var data struct {
			Status      int          `json:"status"`
			Name        string       `json:"name"`
			Code        any          `json:"code"`
			Suggestions []Suggestion `json:"suggestions"`
		}
		if len(message.Error.Data) > 0 {
			_ = json.Unmarshal(message.Error.Data, &data)
		}
		if message.Error.Code == closedCode && data.Status == 0 {
			return nil, transportError(TransportWebSocket, message.Error.Message, nil)
		}
		// a JSON-RPC error of its own (an unknown method, invalid params) has no status: the gateway's codes say which
		status := data.Status
		if status == 0 {
			switch message.Error.Code {
			case -32601:
				status = 404
			case -32602:
				status = 400
			default:
				status = 500
			}
		}
		return nil, gatewayError(TransportWebSocket, answer{status: status, name: data.Name, dbCode: data.Code, message: message.Error.Message, suggestions: data.Suggestions})
	}
	if len(message.Result) == 0 {
		return json.RawMessage("null"), nil
	}
	return message.Result, nil
}

func (w *webSocketTransport) on(method string, listener func(json.RawMessage)) func() {
	return w.socket.on(method, listener)
}
