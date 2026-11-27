package gateway

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
)

// The MCP server of a schema as a transport: each operation is the tool with its name (orm_execute,
// schema_entities, …), and its answer what REST answers (docs/DATA_GATEWAY_CLIENTS_PLAN.md §6). The channel
// (Streamable HTTP, the legacy HTTP+SSE or a WebSocket) is what each transport adds.

const mcpProtocolVersion = "2025-03-26"

var initializeParams = map[string]any{
	"protocolVersion": mcpProtocolVersion,
	"capabilities":    map[string]any{},
	"clientInfo":      map[string]any{"name": "github.com/lambda-orm/data-gateway-client-go", "version": Version},
}

// mcpChannel sends a request of JSON-RPC and gives its answer
type mcpChannel interface {
	request(ctx context.Context, method string, params any) (rpcMessage, error)
}

type mcpBase struct {
	target  *target
	channel mcpChannel
}

func (m *mcpBase) name() Transport { return m.target.transport }

func (m *mcpBase) initialize(ctx context.Context) error {
	message, err := m.channel.request(ctx, "initialize", initializeParams)
	if err != nil {
		return failed(ctx, m.target, "initialize", "initialize", err)
	}
	if message.Error != nil {
		return m.rpcError(message.Error)
	}
	return nil
}

func (m *mcpBase) call(ctx context.Context, operation string, a args) (json.RawMessage, error) {
	route, ok := mcp[operation]
	if !ok {
		return nil, unsupported(m.target.transport, operation)
	}
	ctx, cancel := withTimeout(ctx, m.target.timeout)
	defer cancel()
	to := route(a)
	message, err := m.channel.request(ctx, "tools/call", map[string]any{"name": to.method, "arguments": to.params})
	if err != nil {
		return nil, failed(ctx, m.target, operation, "tools/call "+to.method, err)
	}
	if message.Error != nil {
		return nil, m.rpcError(message.Error)
	}
	return m.toolResult(message.Result)
}

var closedMessage = regexp.MustCompile(`closed`)

// rpcError is a JSON-RPC error of the MCP server: not authenticated (-32001), an unknown tool, invalid arguments
func (m *mcpBase) rpcError(e *rpcError) error {
	if e.Code == closedCode && closedMessage.MatchString(e.Message) {
		return transportError(m.target.transport, e.Message, nil)
	}
	status := 400
	if e.Code == -32001 {
		status = 401
	}
	return gatewayError(m.target.transport, answer{status: status, name: "McpError", message: e.Message})
}

// toolResult is the JSON of the text, or the error of an isError result with the name, status and code of its
// structuredContent
func (m *mcpBase) toolResult(raw json.RawMessage) (json.RawMessage, error) {
	var result struct {
		Content []struct {
			Type string  `json:"type"`
			Text *string `json:"text"`
		} `json:"content"`
		StructuredContent *struct {
			Error       string       `json:"error"`
			Status      int          `json:"status"`
			Code        any          `json:"code"`
			Message     string       `json:"message"`
			Suggestions []Suggestion `json:"suggestions"`
		} `json:"structuredContent"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, transportError(m.target.transport, "the answer of tools/call is not a result of a tool", err)
	}
	var text *string
	for _, c := range result.Content {
		if c.Type == "text" && c.Text != nil {
			text = c.Text
			break
		}
	}
	if result.IsError {
		a := answer{message: "error"}
		if text != nil {
			a.message = *text
			if i := strings.Index(*text, ":"); i > 0 {
				a.name = (*text)[:i]
			}
		}
		if s := result.StructuredContent; s != nil {
			a.status, a.dbCode, a.suggestions = s.Status, s.Code, s.Suggestions
			if s.Error != "" {
				a.name = s.Error
			}
			if s.Message != "" {
				a.message = s.Message
			}
		}
		return nil, gatewayError(m.target.transport, a)
	}
	if text == nil || *text == "" {
		return json.RawMessage("null"), nil
	}
	value := json.RawMessage(*text)
	if !json.Valid(value) {
		return nil, transportError(m.target.transport, "the text of the result of the tool is not JSON", nil)
	}
	if !m.target.truncatedRows {
		var cut struct {
			Truncated bool              `json:"truncated"`
			Rows      []json.RawMessage `json:"rows"`
			Returned  any               `json:"returned"`
			Total     any               `json:"total"`
			Hint      string            `json:"hint"`
		}
		if bytes.HasPrefix(bytes.TrimSpace(value), []byte("{")) && json.Unmarshal(value, &cut) == nil && cut.Truncated && cut.Rows != nil {
			hint := cut.Hint
			if hint == "" {
				hint = "ask for less with page()"
			}
			return nil, &Error{Code: CodeTruncated, Message: fmt.Sprintf("%v of %v rows (mcp.maxRows of the gateway): %s", cut.Returned, cut.Total, hint), Transport: m.target.transport}
		}
	}
	return value, nil
}

// ---------------------------------------------------------------------------------------------- Streamable HTTP

// mcpHTTPTransport is MCP Streamable HTTP: every request a POST to {schema}/mcp (the answer as JSON, or as one
// event of a stream)
type mcpHTTPTransport struct {
	mcpBase
	client  *http.Client
	mu      sync.Mutex
	next    int64
	session string
}

func newMCPHTTPTransport(t *target, client *http.Client) *mcpHTTPTransport {
	m := &mcpHTTPTransport{client: client}
	m.mcpBase = mcpBase{target: t, channel: m}
	return m
}

func (m *mcpHTTPTransport) endpoint() string { return m.target.url + "/mcp" }

func (m *mcpHTTPTransport) headers(ctx context.Context, request *http.Request) error {
	headers, err := m.target.headersOf(ctx)
	if err != nil {
		return err
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	m.mu.Lock()
	if m.session != "" {
		request.Header.Set("Mcp-Session-Id", m.session)
	}
	m.mu.Unlock()
	return nil
}

func (m *mcpHTTPTransport) post(ctx context.Context, body map[string]any) (*rpcMessage, error) {
	text, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, m.endpoint(), bytes.NewReader(text))
	if err != nil {
		return nil, err
	}
	if err := m.headers(ctx, request); err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	response, err := m.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if session := response.Header.Get("Mcp-Session-Id"); session != "" {
		m.mu.Lock()
		m.session = session
		m.mu.Unlock()
	}
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if _, isRequest := body["id"]; !isRequest {
		return nil, nil
	}
	if strings.Contains(response.Header.Get("Content-Type"), "text/event-stream") {
		// the last data of the stream is the answer
		var last string
		for _, line := range strings.Split(strings.ReplaceAll(string(payload), "\r\n", "\n"), "\n") {
			if strings.HasPrefix(line, "data:") {
				if data := strings.TrimSpace(line[5:]); data != "" {
					last = data
				}
			}
		}
		payload = []byte(last)
	}
	if len(bytes.TrimSpace(payload)) == 0 {
		return nil, gatewayError(m.target.transport, answer{status: response.StatusCode, name: "McpError", message: fmt.Sprintf("POST %s answered %d without a body", m.endpoint(), response.StatusCode)})
	}
	var message rpcMessage
	if err := json.Unmarshal(payload, &message); err != nil {
		if response.StatusCode >= 400 {
			return nil, gatewayError(m.target.transport, answer{status: response.StatusCode, name: "McpError", message: strings.TrimSpace(string(payload))})
		}
		return nil, fmt.Errorf("POST %s answered something that is not JSON-RPC", m.endpoint())
	}
	return &message, nil
}

func (m *mcpHTTPTransport) request(ctx context.Context, method string, params any) (rpcMessage, error) {
	m.mu.Lock()
	m.next++
	id := m.next
	m.mu.Unlock()
	message, err := m.post(ctx, map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	if err != nil {
		return rpcMessage{}, err
	}
	return *message, nil
}

func (m *mcpHTTPTransport) open(ctx context.Context) error {
	ctx, cancel := withTimeout(ctx, m.target.timeout)
	defer cancel()
	if err := m.initialize(ctx); err != nil {
		return err
	}
	if _, err := m.post(ctx, map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"}); err != nil {
		return failed(ctx, m.target, "initialize", "notifications/initialized", err)
	}
	return nil
}

// close ends the session of a stateful server
func (m *mcpHTTPTransport) close() error {
	m.mu.Lock()
	session := m.session
	m.mu.Unlock()
	if session == "" {
		return nil
	}
	ctx, cancel := withTimeout(context.Background(), m.target.timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, m.endpoint(), nil)
	if err != nil {
		return nil
	}
	if m.headers(ctx, request) != nil {
		return nil
	}
	if response, err := m.client.Do(request); err == nil {
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
	}
	return nil
}

// ---------------------------------------------------------------------------------------------- HTTP+SSE (legacy)

// mcpSSETransport is MCP HTTP+SSE (legacy): GET {schema}/sse opens the stream; its first event says where to POST
// the requests, and the answers come by the stream
type mcpSSETransport struct {
	mcpBase
	client   *http.Client
	mu       sync.Mutex
	next     int64
	pending  map[int64]chan rpcMessage
	closed   bool
	messages string
	cancel   context.CancelFunc
	done     chan struct{}
}

func newMCPSSETransport(t *target, client *http.Client) *mcpSSETransport {
	m := &mcpSSETransport{client: client, pending: map[int64]chan rpcMessage{}, done: make(chan struct{})}
	m.mcpBase = mcpBase{target: t, channel: m}
	return m
}

func (m *mcpSSETransport) open(ctx context.Context) error {
	sse := m.target.url + "/sse"
	// the stream lives until close(), not until the ctx of open ends
	stream, cancel := context.WithCancel(context.Background())
	m.cancel = cancel
	opening, stop := withTimeout(ctx, m.target.timeout)
	defer stop()
	request, err := http.NewRequestWithContext(stream, http.MethodGet, sse, nil)
	if err != nil {
		return transportError(m.target.transport, err.Error(), err)
	}
	headers, err := m.target.headersOf(opening)
	if err != nil {
		return err
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	request.Header.Set("Accept", "text/event-stream")
	type opened struct {
		response *http.Response
		err      error
	}
	got := make(chan opened, 1)
	go func() { r, err := m.client.Do(request); got <- opened{r, err} }()
	var response *http.Response
	select {
	case o := <-got:
		if o.err != nil {
			cancel()
			return transportError(m.target.transport, "GET "+sse+": "+o.err.Error(), o.err)
		}
		response = o.response
	case <-opening.Done():
		cancel()
		return failed(opening, m.target, "connect", "GET "+sse, opening.Err())
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		cancel()
		return gatewayError(m.target.transport, answer{status: response.StatusCode, name: "McpError", message: fmt.Sprintf("GET %s answered %d", sse, response.StatusCode)})
	}
	endpoint := make(chan string, 1)
	go m.read(response.Body, endpoint)
	select {
	case path := <-endpoint:
		base, _ := url.Parse(sse)
		ref, err := url.Parse(path)
		if err != nil {
			cancel()
			return transportError(m.target.transport, "the endpoint event of "+sse+" is not a URL: "+path, err)
		}
		m.messages = base.ResolveReference(ref).String()
	case <-m.done:
		cancel()
		return transportError(m.target.transport, sse+" closed before its endpoint event", nil)
	case <-opening.Done():
		cancel()
		return transportError(m.target.transport, sse+" sent no endpoint event", opening.Err())
	}
	if err := m.initialize(opening); err != nil {
		return err
	}
	if err := m.post(opening, map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"}); err != nil {
		return failed(opening, m.target, "initialize", "notifications/initialized", err)
	}
	return nil
}

func (m *mcpSSETransport) read(body io.ReadCloser, endpoint chan<- string) {
	defer close(m.done)
	defer body.Close()
	reader := bufio.NewReaderSize(body, 64*1024)
	event, data := "message", []string{}
	sentEndpoint := false
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			break
		}
		line = strings.TrimRight(line, "\r\n")
		switch {
		case line == "":
			if len(data) > 0 || event == "endpoint" {
				text := strings.Join(data, "\n")
				if event == "endpoint" && !sentEndpoint {
					sentEndpoint = true
					endpoint <- text
				} else if event == "message" {
					m.receive(text)
				}
			}
			event, data = "message", data[:0]
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(line[6:])
		case strings.HasPrefix(line, "data:"):
			data = append(data, strings.TrimPrefix(line[5:], " "))
		}
	}
	m.mu.Lock()
	m.closed = true
	for id, waiting := range m.pending {
		waiting <- rpcMessage{Error: &rpcError{Code: closedCode, Message: "the SSE stream was closed"}}
		delete(m.pending, id)
	}
	m.mu.Unlock()
}

func (m *mcpSSETransport) receive(text string) {
	var message rpcMessage
	if json.Unmarshal([]byte(text), &message) != nil || message.ID == nil {
		return
	}
	var id int64
	if json.Unmarshal(*message.ID, &id) != nil {
		return
	}
	m.mu.Lock()
	waiting, ok := m.pending[id]
	delete(m.pending, id)
	m.mu.Unlock()
	if ok {
		waiting <- message
	}
}

func (m *mcpSSETransport) post(ctx context.Context, body map[string]any) error {
	text, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, m.messages, bytes.NewReader(text))
	if err != nil {
		return err
	}
	headers, err := m.target.headersOf(ctx)
	if err != nil {
		return err
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := m.client.Do(request)
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode >= 400 {
		return gatewayError(m.target.transport, answer{status: response.StatusCode, name: "McpError", message: fmt.Sprintf("POST %s answered %d", m.messages, response.StatusCode)})
	}
	return nil
}

func (m *mcpSSETransport) request(ctx context.Context, method string, params any) (rpcMessage, error) {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return rpcMessage{Error: &rpcError{Code: closedCode, Message: "the SSE stream is closed"}}, nil
	}
	m.next++
	id := m.next
	waiting := make(chan rpcMessage, 1)
	m.pending[id] = waiting
	m.mu.Unlock()
	forget := func() { m.mu.Lock(); delete(m.pending, id); m.mu.Unlock() }
	if err := m.post(ctx, map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
		forget()
		return rpcMessage{}, err
	}
	select {
	case message := <-waiting:
		return message, nil
	case <-ctx.Done():
		forget()
		return rpcMessage{}, ctx.Err()
	}
}

func (m *mcpSSETransport) close() error {
	if m.cancel != nil {
		m.cancel()
		<-m.done
	}
	return nil
}

// ---------------------------------------------------------------------------------------------- WebSocket

// mcpWebSocketTransport is MCP over WebSocket (not standard): the same JSON-RPC messages on a socket at {schema}/mcp
type mcpWebSocketTransport struct {
	mcpBase
	client *http.Client
	socket *rpcSocket
}

func newMCPWebSocketTransport(t *target, client *http.Client) *mcpWebSocketTransport {
	m := &mcpWebSocketTransport{client: client, socket: newRPCSocket(t.url + "/mcp")}
	m.mcpBase = mcpBase{target: t, channel: m.socket}
	return m
}

func (m *mcpWebSocketTransport) open(ctx context.Context) error {
	if err := openSocket(ctx, m.target, m.socket, m.client); err != nil {
		return err
	}
	ctx, cancel := withTimeout(ctx, m.target.timeout)
	defer cancel()
	if err := m.initialize(ctx); err != nil {
		return err
	}
	if err := m.socket.notify(ctx, "notifications/initialized"); err != nil {
		return failed(ctx, m.target, "initialize", "notifications/initialized", err)
	}
	return nil
}

func (m *mcpWebSocketTransport) close() error { return m.socket.close() }
