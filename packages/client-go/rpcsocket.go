package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/coder/websocket"
)

// rpcMessage is a message of JSON-RPC 2.0
type rpcMessage struct {
	JSONRPC string           `json:"jsonrpc,omitempty"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Method  string           `json:"method,omitempty"`
	Params  json.RawMessage  `json:"params,omitempty"`
	Result  json.RawMessage  `json:"result,omitempty"`
	Error   *rpcError        `json:"error,omitempty"`
}

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// closedCode is the code of the error a request gets when the connection closes before its answer
const closedCode = -32603

// maxMessage is the largest message a socket reads (the export of a stage can be large)
const maxMessage = 1 << 30

// rpcSocket is JSON-RPC 2.0 over a WebSocket: requests matched to their answers by id, and the notifications of the
// server to their listeners. The handshake carries the headers (the credential).
type rpcSocket struct {
	url       string
	conn      *websocket.Conn
	mu        sync.Mutex
	next      int64
	pending   map[int64]chan rpcMessage
	listeners map[string]map[int]func(json.RawMessage)
	nextOff   int
	closed    bool
	done      chan struct{}
}

func newRPCSocket(url string) *rpcSocket {
	return &rpcSocket{url: url, pending: map[int64]chan rpcMessage{}, listeners: map[string]map[int]func(json.RawMessage){}, done: make(chan struct{})}
}

func (s *rpcSocket) open(ctx context.Context, headers map[string]string, client *http.Client) error {
	header := http.Header{}
	for name, value := range headers {
		header.Set(name, value)
	}
	conn, response, err := websocket.Dial(ctx, s.url, &websocket.DialOptions{HTTPHeader: header, HTTPClient: client})
	if err != nil {
		if response != nil && response.StatusCode >= 400 {
			return gatewayError("", answer{status: response.StatusCode, name: "HandshakeError", message: "the handshake of " + s.url + " was rejected: " + response.Status})
		}
		return err
	}
	conn.SetReadLimit(maxMessage)
	s.conn = conn
	go s.read()
	return nil
}

func (s *rpcSocket) read() {
	defer close(s.done)
	for {
		_, data, err := s.conn.Read(context.Background())
		if err != nil {
			break
		}
		var message rpcMessage
		if json.Unmarshal(data, &message) != nil {
			continue
		}
		if message.ID != nil && string(*message.ID) != "null" {
			var id int64
			if json.Unmarshal(*message.ID, &id) != nil {
				continue
			}
			s.mu.Lock()
			waiting, ok := s.pending[id]
			delete(s.pending, id)
			s.mu.Unlock()
			if ok {
				waiting <- message
			}
			continue
		}
		if message.Method != "" {
			s.mu.Lock()
			listeners := make([]func(json.RawMessage), 0, len(s.listeners[message.Method]))
			for _, listener := range s.listeners[message.Method] {
				listeners = append(listeners, listener)
			}
			s.mu.Unlock()
			for _, listener := range listeners {
				listener(message.Params)
			}
		}
	}
	s.mu.Lock()
	s.closed = true
	for id, waiting := range s.pending {
		waiting <- rpcMessage{Error: &rpcError{Code: closedCode, Message: "the connection was closed"}}
		delete(s.pending, id)
	}
	s.mu.Unlock()
}

// request sends a request and waits for its answer, until ctx ends
func (s *rpcSocket) request(ctx context.Context, method string, params any) (rpcMessage, error) {
	s.mu.Lock()
	if s.closed || s.conn == nil {
		s.mu.Unlock()
		return rpcMessage{Error: &rpcError{Code: closedCode, Message: "the connection is closed"}}, nil
	}
	s.next++
	id := s.next
	waiting := make(chan rpcMessage, 1)
	s.pending[id] = waiting
	s.mu.Unlock()
	text, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	if err != nil {
		s.forget(id)
		return rpcMessage{}, err
	}
	if err := s.conn.Write(ctx, websocket.MessageText, text); err != nil {
		s.forget(id)
		if ctx.Err() != nil {
			return rpcMessage{}, ctx.Err()
		}
		return rpcMessage{Error: &rpcError{Code: closedCode, Message: "the connection was closed: " + err.Error()}}, nil
	}
	select {
	case message := <-waiting:
		return message, nil
	case <-ctx.Done():
		s.forget(id)
		return rpcMessage{}, ctx.Err()
	}
}

func (s *rpcSocket) forget(id int64) {
	s.mu.Lock()
	delete(s.pending, id)
	s.mu.Unlock()
}

func (s *rpcSocket) notify(ctx context.Context, method string) error {
	text, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": method})
	return s.conn.Write(ctx, websocket.MessageText, text)
}

func (s *rpcSocket) on(method string, listener func(json.RawMessage)) func() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listeners[method] == nil {
		s.listeners[method] = map[int]func(json.RawMessage){}
	}
	s.nextOff++
	key := s.nextOff
	s.listeners[method][key] = listener
	return func() {
		s.mu.Lock()
		delete(s.listeners[method], key)
		s.mu.Unlock()
	}
}

func (s *rpcSocket) close() error {
	if s.conn == nil {
		return nil
	}
	_ = s.conn.Close(websocket.StatusNormalClosure, "")
	<-s.done
	return nil
}
