package gateway

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Transport is the transport of a connection: the scheme of its URL.
type Transport string

const (
	// TransportHTTP is the REST API: http://, https://
	TransportHTTP Transport = "http"
	// TransportWebSocket is JSON-RPC 2.0 over WebSocket, with notifications: ws://, wss://
	TransportWebSocket Transport = "ws"
	// TransportMCPHTTP is MCP Streamable HTTP: mcp+http://, mcp+https://
	TransportMCPHTTP Transport = "mcp+http"
	// TransportMCPSSE is MCP HTTP+SSE, the legacy one: mcp+sse://, mcp+sses://
	TransportMCPSSE Transport = "mcp+sse"
	// TransportMCPWebSocket is MCP over WebSocket (not standard): mcp+ws://, mcp+wss://
	TransportMCPWebSocket Transport = "mcp+ws"
)

// DefaultTimeout is how long an operation can take when neither the options nor the URL say it.
const DefaultTimeout = 30 * time.Second

// TokenFunc gives the token when it is needed (on every request of REST and MCP over HTTP, on opening a WebSocket):
// the token of an identity provider, refreshed.
type TokenFunc func(ctx context.Context) (string, error)

type settings struct {
	apiKey        string
	apiKeySet     bool
	apiKeyHeader  string
	token         string
	tokenSet      bool
	tokenFunc     TokenFunc
	headers       map[string]string
	timeout       time.Duration
	truncatedRows bool
	stage         string
	env           func(string) string
}

// Option is an option of Connect.
type Option func(*settings)

// WithAPIKey sends the key as the X-Api-Key header (or the one of WithAPIKeyHeader). Default: DATA_GATEWAY_API_KEY.
func WithAPIKey(key string) Option {
	return func(s *settings) { s.apiKey, s.apiKeySet = key, true }
}

// WithAPIKeyHeader is the header of the API key, when the gateway uses another one than X-Api-Key.
func WithAPIKeyHeader(header string) Option { return func(s *settings) { s.apiKeyHeader = header } }

// WithToken sends Authorization: Bearer <token>. Default: DATA_GATEWAY_TOKEN.
func WithToken(token string) Option {
	return func(s *settings) { s.token, s.tokenSet = token, true }
}

// WithTokenFunc asks for the token on every request (and on opening a WebSocket), instead of a fixed one.
func WithTokenFunc(token TokenFunc) Option { return func(s *settings) { s.tokenFunc = token } }

// WithHeader adds any other header to every request (and to the handshake of a WebSocket).
func WithHeader(name, value string) Option {
	return func(s *settings) {
		if s.headers == nil {
			s.headers = map[string]string{}
		}
		s.headers[name] = value
	}
}

// WithTimeout is how long each operation can take before it fails with CodeTimeout. Default 30 s, or ?timeout=<ms>.
func WithTimeout(timeout time.Duration) Option { return func(s *settings) { s.timeout = timeout } }

// WithStage is the stage of every query, unless its options say another one. Default: ?stage= of the URL.
func WithStage(stage string) Option { return func(s *settings) { s.stage = stage } }

// WithTruncatedRows: on MCP, a list cut at the mcp.maxRows of the gateway gives its cut result ({ rows, truncated, …
// }) instead of an Error with CodeTruncated (the default: a program never gets incomplete data without knowing it).
func WithTruncatedRows() Option { return func(s *settings) { s.truncatedRows = true } }

// withEnv replaces the environment (os.Getenv), for the tests
func withEnv(env func(string) string) Option { return func(s *settings) { s.env = env } }

// target is a connection string resolved with its options
type target struct {
	transport Transport
	// the URL of the schema for the transport: http(s)://… or ws(s)://…, without a trailing slash
	url           string
	headers       map[string]string
	tokenFunc     TokenFunc
	timeout       time.Duration
	truncatedRows bool
	stage         string
}

var schemes = map[string]struct {
	transport Transport
	protocol  string
}{
	"http":      {TransportHTTP, "http"},
	"https":     {TransportHTTP, "https"},
	"ws":        {TransportWebSocket, "ws"},
	"wss":       {TransportWebSocket, "wss"},
	"mcp+http":  {TransportMCPHTTP, "http"},
	"mcp+https": {TransportMCPHTTP, "https"},
	"mcp+sse":   {TransportMCPSSE, "http"},
	"mcp+sses":  {TransportMCPSSE, "https"},
	"mcp+ws":    {TransportMCPWebSocket, "ws"},
	"mcp+wss":   {TransportMCPWebSocket, "wss"},
}

var credentialParams = []string{"apikey", "api_key", "api-key", "key", "token", "access_token", "password", "secret"}

const credentialHint = "pass it with WithAPIKey or WithToken, or by DATA_GATEWAY_API_KEY / DATA_GATEWAY_TOKEN"

// parse resolves a connection string (docs/DATA_GATEWAY_CLIENTS_PLAN.md §2):
// <scheme>://host[:port][/basePath]/<schema>[?timeout=<ms>&stage=<stage>]. A credential in the URL is an error.
func parse(connection string, options ...Option) (*target, error) {
	s := &settings{env: os.Getenv}
	for _, option := range options {
		option(s)
	}
	text := connection
	if text == "" {
		text = s.env("DATA_GATEWAY_URL")
	}
	if text == "" {
		return nil, fmt.Errorf("no connection string: pass one (http://host/schema, ws://…, mcp+http://…) or set DATA_GATEWAY_URL")
	}
	u, err := url.Parse(text)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("invalid connection string: %s", text)
	}
	scheme, ok := schemes[strings.ToLower(u.Scheme)]
	if !ok {
		return nil, fmt.Errorf("unknown transport %s (http, https, ws, wss, mcp+http, mcp+https, mcp+sse, mcp+sses, mcp+ws, mcp+wss)", u.Scheme)
	}
	if u.User != nil {
		return nil, fmt.Errorf("the connection string has a credential (user:password@): %s", credentialHint)
	}
	query := u.Query()
	for name := range query {
		if contains(credentialParams, strings.ToLower(name)) {
			return nil, fmt.Errorf("the connection string has a credential (%s=): %s", name, credentialHint)
		}
		if name != "timeout" && name != "stage" {
			return nil, fmt.Errorf("unknown option of the connection string: %s (timeout, stage)", name)
		}
	}
	t := &target{
		transport:     scheme.transport,
		url:           scheme.protocol + "://" + u.Host + strings.TrimRight(u.EscapedPath(), "/"),
		headers:       map[string]string{},
		tokenFunc:     s.tokenFunc,
		timeout:       s.timeout,
		truncatedRows: s.truncatedRows,
		stage:         s.stage,
	}
	if t.timeout <= 0 {
		t.timeout = DefaultTimeout
		if ms, err := strconv.Atoi(query.Get("timeout")); err == nil && ms > 0 {
			t.timeout = time.Duration(ms) * time.Millisecond
		}
	}
	if t.stage == "" {
		t.stage = query.Get("stage")
	}
	apiKey := s.apiKey
	if !s.apiKeySet {
		apiKey = s.env("DATA_GATEWAY_API_KEY")
	}
	if apiKey != "" {
		header := s.apiKeyHeader
		if header == "" {
			header = "X-Api-Key"
		}
		t.headers[header] = apiKey
	}
	token := s.token
	if !s.tokenSet {
		token = s.env("DATA_GATEWAY_TOKEN")
	}
	if token != "" && s.tokenFunc == nil {
		t.headers["Authorization"] = "Bearer " + token
	}
	for name, value := range s.headers {
		t.headers[name] = value
	}
	return t, nil
}

// headersOf are the headers of a request: the fixed ones, and the token of the moment when a TokenFunc gives it
func (t *target) headersOf(ctx context.Context) (map[string]string, error) {
	headers := make(map[string]string, len(t.headers)+1)
	for name, value := range t.headers {
		headers[name] = value
	}
	if t.tokenFunc != nil {
		token, err := t.tokenFunc(ctx)
		if err != nil {
			return nil, transportError(t.transport, "the token: "+err.Error(), err)
		}
		if token != "" {
			headers["Authorization"] = "Bearer " + token
		}
	}
	return headers, nil
}
