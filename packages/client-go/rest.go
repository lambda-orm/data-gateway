package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// restTransport is the REST API: each operation a request under the route of the schema
type restTransport struct {
	target *target
	client *http.Client
}

func (r *restTransport) name() Transport            { return TransportHTTP }
func (r *restTransport) open(context.Context) error { return nil }
func (r *restTransport) close() error               { return nil }

func (r *restTransport) call(ctx context.Context, operation string, a args) (json.RawMessage, error) {
	route, ok := rest[operation]
	if !ok {
		return nil, unsupported(TransportHTTP, operation)
	}
	ctx, cancel := withTimeout(ctx, r.target.timeout)
	defer cancel()
	to := route(a)
	var body io.Reader
	if to.body != nil {
		text, err := json.Marshal(to.body)
		if err != nil {
			return nil, &Error{Code: CodeInvalid, Message: "the arguments are not JSON: " + err.Error(), Transport: TransportHTTP, Operation: operation, cause: err}
		}
		body = bytes.NewReader(text)
	}
	url := r.target.url + to.path
	request, err := http.NewRequestWithContext(ctx, to.method, url, body)
	if err != nil {
		return nil, transportError(TransportHTTP, err.Error(), err)
	}
	headers, err := r.target.headersOf(ctx)
	if err != nil {
		return nil, err
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("Accept", "application/json")
	response, err := r.client.Do(request)
	if err != nil {
		return nil, failed(ctx, r.target, operation, to.method+" "+url, err)
	}
	defer response.Body.Close()
	text, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, failed(ctx, r.target, operation, to.method+" "+url, err)
	}
	if response.StatusCode == http.StatusNoContent {
		return json.RawMessage("null"), nil
	}
	ok = response.StatusCode >= 200 && response.StatusCode < 300
	trimmed := bytes.TrimSpace(text)
	if ok {
		if len(trimmed) == 0 {
			return json.RawMessage("null"), nil
		}
		if !json.Valid(trimmed) {
			return nil, transportError(TransportHTTP, to.method+" "+to.path+" answered something that is not JSON", nil)
		}
		return json.RawMessage(trimmed), nil
	}
	var payload struct {
		Error       string       `json:"error"`
		Code        any          `json:"code"`
		Message     string       `json:"message"`
		Suggestions []Suggestion `json:"suggestions"`
	}
	_ = json.Unmarshal(trimmed, &payload)
	message := payload.Message
	if message == "" {
		message = strings.TrimSpace(string(text))
	}
	if message == "" {
		message = http.StatusText(response.StatusCode)
	}
	return nil, gatewayError(TransportHTTP, answer{status: response.StatusCode, name: payload.Error, dbCode: payload.Code, message: message, suggestions: payload.Suggestions})
}
