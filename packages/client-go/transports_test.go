package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// What each transport makes of an answer, with a fake gateway: no Docker.

type seen struct {
	method, path string
	header       http.Header
	body         map[string]any
}

func fake(t *testing.T, handler func(w http.ResponseWriter, r *http.Request, s seen)) (*httptest.Server, *[]seen) {
	t.Helper()
	var mu sync.Mutex
	var requests []seen
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := seen{method: r.Method, path: r.URL.RequestURI(), header: r.Header.Clone()}
		if text, _ := io.ReadAll(r.Body); len(text) > 0 {
			_ = json.Unmarshal(text, &s.body)
		}
		mu.Lock()
		requests = append(requests, s)
		mu.Unlock()
		handler(w, r, s)
	}))
	t.Cleanup(server.Close)
	return server, &requests
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func connectTest(t *testing.T, connection string, options ...Option) *Client {
	t.Helper()
	c, err := Connect(context.Background(), connection, append([]Option{withEnv(noEnv)}, options...)...)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func asError(t *testing.T, err error) *Error {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) {
		t.Fatalf("not an *Error: %v", err)
	}
	return e
}

func TestRESTExecute(t *testing.T) {
	server, requests := fake(t, func(w http.ResponseWriter, _ *http.Request, _ seen) {
		reply(w, 200, []map[string]any{{"name": "Chai"}})
	})
	c := connectTest(t, server.URL+"/northwind", WithAPIKey("k"), WithStage("test"))
	type product struct {
		Name string `json:"name"`
	}
	rows, err := ExecuteInto[[]product](context.Background(), c, "Products.map(p => p.name)", map[string]any{"a": 1}, nil)
	if err != nil || len(rows) != 1 || rows[0].Name != "Chai" {
		t.Fatalf("%v %v", rows, err)
	}
	r := (*requests)[0]
	if r.method != "POST" || r.path != "/northwind/execute" || r.header.Get("X-Api-Key") != "k" {
		t.Errorf("%+v", r)
	}
	if got := fmt.Sprint(r.body); got != "map[data:map[a:1] options:map[stage:test] query:Products.map(p => p.name)]" {
		t.Errorf("body %s", got)
	}
}

func TestRESTRoutes(t *testing.T) {
	server, requests := fake(t, func(w http.ResponseWriter, _ *http.Request, _ seen) { reply(w, 200, map[string]any{"exists": true}) })
	c := connectTest(t, server.URL+"/iot/v1")
	ctx := context.Background()
	_, _ = c.Schema.Entity(ctx, "A B")
	_, _ = c.Schema.Search(ctx, "Products.categ")
	_, _ = c.Schema.Describe(ctx, []string{"Categories", "Orders"})
	_, _ = c.Stage.Exists(ctx, "default")
	_, _ = c.Query(ctx, "byName", map[string]any{"name": "x"}, nil)
	want := []string{"GET /iot/v1/entities/A%20B", "GET /iot/v1/search?q=Products.categ", "GET /iot/v1/describe?entities=Categories,Orders", "GET /iot/v1/stages/default/exists", "POST /iot/v1/queries/byName"}
	for i, w := range want {
		if got := (*requests)[i].method + " " + (*requests)[i].path; got != w {
			t.Errorf("%d: %s, want %s", i, got, w)
		}
	}
}

func TestRESTErrors(t *testing.T) {
	server, _ := fake(t, func(w http.ResponseWriter, r *http.Request, _ seen) {
		switch r.URL.Path {
		case "/northwind/execute":
			reply(w, 409, map[string]any{"error": "ExecutionError", "code": "23505", "message": "duplicate key"})
		default:
			reply(w, 400, map[string]any{"error": "SchemaError", "message": "nme?", "suggestions": []map[string]any{{"name": "nme", "didYouMean": []string{"name"}}}})
		}
	})
	c := connectTest(t, server.URL+"/northwind")
	_, err := c.Execute(context.Background(), "Categories.insert()", nil, nil)
	e := asError(t, err)
	if e.Code != CodeUnique || e.Name != "ExecutionError" || e.Status != 409 || e.DBCode != "23505" || e.Message != "duplicate key" || e.Transport != TransportHTTP || e.Operation != "execute" {
		t.Errorf("%+v", e)
	}
	_, err = c.Plan(context.Background(), "Areas.map(p => p.nme)", nil)
	if e := asError(t, err); e.Code != CodeInvalid || len(e.Suggestions) != 1 || e.Suggestions[0].DidYouMean[0] != "name" {
		t.Errorf("%+v", e)
	}
	if _, err := c.On(EventQueueCompleted, func(json.RawMessage) {}); asError(t, err).Code != CodeUnsupported {
		t.Error("On on REST")
	}
}

func TestRESTTransportAndTimeout(t *testing.T) {
	c := connectTest(t, "http://127.0.0.1:1/northwind")
	if _, err := c.General.Version(context.Background()); asError(t, err).Code != CodeTransport {
		t.Errorf("refused: %v", err)
	}
	server, _ := fake(t, func(w http.ResponseWriter, _ *http.Request, _ seen) {
		time.Sleep(300 * time.Millisecond)
		reply(w, 200, nil)
	})
	c = connectTest(t, server.URL+"/northwind", WithTimeout(50*time.Millisecond))
	_, err := c.General.Health(context.Background())
	if e := asError(t, err); e.Code != CodeTimeout || !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("timeout: %v", err)
	}
}

// mcpServer is a fake MCP Streamable HTTP server: initialize, then the tools/call answered by tool
func mcpServer(t *testing.T, tool func(name string, arguments map[string]any) any) (*httptest.Server, *[]seen) {
	return fake(t, func(w http.ResponseWriter, r *http.Request, s seen) {
		if r.Method == http.MethodDelete {
			w.WriteHeader(204)
			return
		}
		w.Header().Set("Mcp-Session-Id", "session-1")
		id := s.body["id"]
		if id == nil {
			w.WriteHeader(202)
			return
		}
		var result any = map[string]any{"protocolVersion": mcpProtocolVersion, "capabilities": map[string]any{}}
		if s.body["method"] == "tools/call" {
			params := s.body["params"].(map[string]any)
			arguments, _ := params["arguments"].(map[string]any)
			result = tool(params["name"].(string), arguments)
		}
		// answered as one event of a stream
		w.Header().Set("Content-Type", "text/event-stream")
		text, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
		fmt.Fprintf(w, "event: message\ndata: %s\n\n", text)
	})
}

func text(v any) map[string]any {
	t, _ := json.Marshal(v)
	return map[string]any{"content": []map[string]any{{"type": "text", "text": string(t)}}}
}

func TestMCPHTTP(t *testing.T) {
	server, requests := mcpServer(t, func(name string, arguments map[string]any) any {
		switch name {
		case "orm_execute":
			if arguments["query"] == "Products" {
				return text(map[string]any{"rows": []int{1, 2}, "truncated": true, "returned": 2, "total": 77})
			}
			return text([]map[string]any{{"id": 1}})
		case "query_byName":
			return text(arguments)
		}
		return map[string]any{"isError": true, "content": []map[string]any{{"type": "text", "text": "ExecutionError: duplicate"}},
			"structuredContent": map[string]any{"error": "ExecutionError", "status": 409, "code": "23503", "message": "duplicate"}}
	})
	ctx := context.Background()
	c := connectTest(t, "mcp+"+server.URL+"/northwind", WithToken("jwt"))
	rows, err := c.Execute(ctx, "Categories", nil, nil)
	if err != nil || fmt.Sprint(rows) != "[map[id:1]]" {
		t.Fatalf("%v %v", rows, err)
	}
	last := (*requests)[len(*requests)-1]
	if last.path != "/northwind/mcp" || last.header.Get("Authorization") != "Bearer jwt" || last.header.Get("Mcp-Session-Id") != "session-1" {
		t.Errorf("%+v", last)
	}
	if _, err := c.Execute(ctx, "Products", nil, nil); asError(t, err).Code != CodeTruncated {
		t.Errorf("truncated: %v", err)
	}
	if got, err := c.Query(ctx, "byName", map[string]any{"name": "x"}, nil); err != nil || fmt.Sprint(got) != "map[name:x]" {
		t.Errorf("named query: %v %v", got, err)
	}
	_, err = c.Schema.Entities(ctx)
	if e := asError(t, err); e.Code != CodeForeignKey || e.Name != "ExecutionError" || e.Status != 409 || e.Transport != TransportMCPHTTP {
		t.Errorf("%+v", e)
	}
	if _, err := c.Whoami(ctx); asError(t, err).Code != CodeUnsupported {
		t.Errorf("whoami on MCP: %v", err)
	}
	cut := connectTest(t, "mcp+"+server.URL+"/northwind", WithTruncatedRows())
	if value, err := cut.Execute(ctx, "Products", nil, nil); err != nil || value.(map[string]any)["truncated"] != true {
		t.Errorf("the cut rows: %v %v", value, err)
	}
}

func TestMCPSSE(t *testing.T) {
	var mu sync.Mutex
	streams := map[string]chan string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/northwind/sse":
			w.Header().Set("Content-Type", "text/event-stream")
			flusher := w.(http.Flusher)
			out := make(chan string, 8)
			mu.Lock()
			streams["s1"] = out
			mu.Unlock()
			fmt.Fprint(w, "event: endpoint\ndata: /northwind/messages?sessionId=s1\n\n")
			flusher.Flush()
			for {
				select {
				case message := <-out:
					fmt.Fprintf(w, "event: message\ndata: %s\n\n", message)
					flusher.Flush()
				case <-r.Context().Done():
					return
				}
			}
		case "/northwind/messages":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			w.WriteHeader(202)
			if body["id"] == nil {
				return
			}
			result := any(map[string]any{})
			if body["method"] == "tools/call" {
				result = text(map[string]any{"version": "5.0.0"})
			}
			message, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": body["id"], "result": result})
			mu.Lock()
			streams[r.URL.Query().Get("sessionId")] <- string(message)
			mu.Unlock()
		}
	}))
	t.Cleanup(server.Close)
	c := connectTest(t, strings.Replace(server.URL, "http://", "mcp+sse://", 1)+"/northwind")
	version, err := c.General.Version(context.Background())
	if err != nil || version.Version != "5.0.0" {
		t.Fatalf("%v %v", version, err)
	}
}

// wsServer is a fake JSON-RPC (or MCP) server over WebSocket
func wsServer(t *testing.T, answer func(conn *websocket.Conn, message rpcMessage)) *httptest.Server {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "k" {
			http.Error(w, "unauthorized", 401)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		for {
			_, data, err := conn.Read(r.Context())
			if err != nil {
				return
			}
			var message rpcMessage
			_ = json.Unmarshal(data, &message)
			answer(conn, message)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func send(conn *websocket.Conn, v any) {
	text, _ := json.Marshal(v)
	_ = conn.Write(context.Background(), websocket.MessageText, text)
}

func TestWebSocket(t *testing.T) {
	server := wsServer(t, func(conn *websocket.Conn, m rpcMessage) {
		switch m.Method {
		case "query.execute":
			send(conn, map[string]any{"jsonrpc": "2.0", "id": m.ID, "error": map[string]any{"code": -32000, "message": "duplicate", "data": map[string]any{"status": 409, "name": "ExecutionError", "code": "23505"}}})
		case "schema.schema":
			// never answers
		case "subscribe.entity":
			send(conn, map[string]any{"jsonrpc": "2.0", "id": m.ID, "result": map[string]any{"subscription": "sub-1"}})
			send(conn, map[string]any{"jsonrpc": "2.0", "method": "data.changed", "params": map[string]any{"subscription": "sub-2", "action": "insert"}})
			send(conn, map[string]any{"jsonrpc": "2.0", "method": "data.changed", "params": map[string]any{"subscription": "sub-1", "action": "insert"}})
		case "general.version":
			send(conn, map[string]any{"jsonrpc": "2.0", "method": "schema.statusChanged", "params": map[string]any{"status": "ready"}})
			send(conn, map[string]any{"jsonrpc": "2.0", "id": m.ID, "result": map[string]any{"version": "5.0.0"}})
		default:
			send(conn, map[string]any{"jsonrpc": "2.0", "id": m.ID, "error": map[string]any{"code": -32601, "message": "unknown method"}})
		}
	})
	url := strings.Replace(server.URL, "http://", "ws://", 1) + "/northwind"
	if _, err := Connect(context.Background(), url, withEnv(noEnv)); asError(t, err).Code != CodeUnauthorized {
		t.Errorf("a rejected handshake: %v", err)
	}
	ctx := context.Background()
	c := connectTest(t, url, WithAPIKey("k"))
	_, err := c.Execute(ctx, "Categories.insert()", nil, nil)
	if e := asError(t, err); e.Code != CodeUnique || e.Transport != TransportWebSocket {
		t.Errorf("%+v", e)
	}
	if _, err := c.Schema.Entities(ctx); asError(t, err).Code != CodeNotFound {
		t.Errorf("an unknown method: %v", err)
	}
	statuses := make(chan json.RawMessage, 1)
	off, _ := c.On(EventSchemaStatusChanged, func(p json.RawMessage) { statuses <- p })
	if v, err := c.General.Version(ctx); err != nil || v.Version != "5.0.0" {
		t.Fatalf("%v %v", v, err)
	}
	select {
	case p := <-statuses:
		if !strings.Contains(string(p), "ready") {
			t.Errorf("%s", p)
		}
	case <-time.After(time.Second):
		t.Error("no notification")
	}
	off()
	slow := connectTest(t, url, WithAPIKey("k"), WithTimeout(50*time.Millisecond))
	if _, err := slow.Schema.Get(ctx); asError(t, err).Code != CodeTimeout {
		t.Errorf("no answer: %v", err)
	}
	events := make(chan Event, 2)
	s, err := c.Subscribe(ctx, SubscribeTarget{Entity: "Categories"}, func(e Event) { events <- e })
	if err != nil || s.ID != "sub-1" {
		t.Fatalf("%v %v", s, err)
	}
	select {
	case e := <-events:
		if e.Subscription != "sub-1" || e.Type != EventDataChanged || e.Params["action"] != "insert" {
			t.Errorf("%+v", e)
		}
	case <-time.After(time.Second):
		t.Error("no event")
	}
}

func TestWebSocketClosed(t *testing.T) {
	server := wsServer(t, func(conn *websocket.Conn, m rpcMessage) { conn.Close(websocket.StatusGoingAway, "bye") })
	c := connectTest(t, strings.Replace(server.URL, "http://", "ws://", 1)+"/northwind", WithAPIKey("k"))
	if _, err := c.General.Health(context.Background()); asError(t, err).Code != CodeTransport {
		t.Errorf("closed: %v", err)
	}
}

func TestMCPWebSocket(t *testing.T) {
	server := wsServer(t, func(conn *websocket.Conn, m rpcMessage) {
		if m.ID == nil {
			return
		}
		result := any(map[string]any{})
		if m.Method == "tools/call" {
			result = text([]string{"default", "sales"})
		}
		send(conn, map[string]any{"jsonrpc": "2.0", "id": m.ID, "result": result})
	})
	c := connectTest(t, strings.Replace(server.URL, "http://", "mcp+ws://", 1)+"/northwind", WithAPIKey("k"))
	views, err := c.Schema.Views(context.Background())
	if err != nil || strings.Join(views, ",") != "default,sales" {
		t.Fatalf("%v %v", views, err)
	}
}

func TestIsApprovalPending(t *testing.T) {
	if p, ok := IsApprovalPending(map[string]any{"approval": "a1", "status": "pending", "expiresAt": "x"}); !ok || p.Approval != "a1" {
		t.Error("pending")
	}
	if _, ok := IsApprovalPending([]any{}); ok {
		t.Error("a list")
	}
}
