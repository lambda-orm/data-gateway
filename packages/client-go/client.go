package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
)

// Version is the version of this client.
const Version = "0.1.0"

// Object is an object of JSON as the gateway answers it: an entity, a mapping, a plan, …
type Object = map[string]any

// QueryOptions are the options of a query (QueryOptions of λORM). The stage of the connection (WithStage, ?stage=)
// fills Stage when it is empty.
type QueryOptions struct {
	Stage     string         `json:"stage,omitempty"`
	View      string         `json:"view,omitempty"`
	ChunkSize int            `json:"chunkSize,omitempty"`
	TryAllCan bool           `json:"tryAllCan,omitempty"`
	Context   map[string]any `json:"context,omitempty"`
	// MaxRows: a query across sources, the rows it can bring to sort or group in memory
	MaxRows int `json:"maxRows,omitempty"`
}

// ScriptOptions are the options of a script: those of a query, and its limits.
type ScriptOptions struct {
	QueryOptions
	// Timeout in milliseconds: past it the loops of the script stop and its transaction rolls back
	Timeout int `json:"timeout,omitempty"`
	// MaxIterations of all the loops of the script together
	MaxIterations int `json:"maxIterations,omitempty"`
}

// VersionInfo is the version of the gateway or of the schema.
type VersionInfo struct {
	Version string `json:"version"`
}

// Health is what the gateway answers to health.
type Health struct {
	Message string  `json:"message"`
	Time    string  `json:"time"`
	Uptime  float64 `json:"uptime"`
}

// Whoami is the credential of the connection and what it can do (REST only).
type Whoami struct {
	Name        string   `json:"name"`
	Permissions []string `json:"permissions"`
	Schema      string   `json:"schema"`
	Scripts     bool     `json:"scripts"`
}

// Source is a source of the schema: its name and its dialect.
type Source struct {
	Name    string `json:"name"`
	Dialect string `json:"dialect"`
}

// DomainSearch is what Schema.Search answers: one line per match; More beyond 40, DidYouMean when nothing matches.
type DomainSearch struct {
	Matches    []string `json:"matches"`
	More       int      `json:"more,omitempty"`
	Hint       string   `json:"hint,omitempty"`
	DidYouMean []string `json:"didYouMean,omitempty"`
}

// DescribedEntities is what Schema.Describe answers: two lines per entity, the names that don't exist apart.
type DescribedEntities struct {
	Entities []string     `json:"entities"`
	NotFound []Suggestion `json:"notFound,omitempty"`
}

// NamedQuery is a query of application.queries of the schema: its parameters and its model, never its text.
type NamedQuery struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Parameters  []Object `json:"parameters"`
	Model       []Object `json:"model"`
	Writes      bool     `json:"writes"`
}

// Approval is the state of a write that waits for a person to approve it: pending, approved, done (with its
// Result), failed, rejected (with the Reason) or expired.
type Approval struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	Result    any    `json:"result,omitempty"`
	Error     string `json:"error,omitempty"`
	Reason    string `json:"reason,omitempty"`
	ExpiresAt string `json:"expiresAt"`
}

// ApprovalPending is what a write that waits for a person answers at once: nothing changed yet; Client.Approval
// tells its state.
type ApprovalPending struct {
	Approval  string `json:"approval"`
	Status    string `json:"status"`
	ExpiresAt string `json:"expiresAt"`
	Message   string `json:"message"`
}

// IsApprovalPending tells whether the result of Execute, Query or ExecuteScript is a write that waits for approval.
func IsApprovalPending(result any) (ApprovalPending, bool) {
	m, ok := result.(map[string]any)
	if !ok {
		return ApprovalPending{}, false
	}
	id, _ := m["approval"].(string)
	status, _ := m["status"].(string)
	if id == "" || status != "pending" {
		return ApprovalPending{}, false
	}
	expires, _ := m["expiresAt"].(string)
	message, _ := m["message"].(string)
	return ApprovalPending{Approval: id, Status: status, ExpiresAt: expires, Message: message}, true
}

// Client is a connection to one schema of a Data Gateway, by the transport its connection string names. The same
// API on the five transports (docs/DATA_GATEWAY_CLIENTS_PLAN.md §3); an operation that fails returns an *Error. It
// is safe for concurrent use.
type Client struct {
	transport transport
	target    *target
	// Schema is the schema as the gateway loaded it
	Schema *SchemaOperations
	// Stage is the data of a stage
	Stage *StageOperations
	// General is the gateway
	General *GeneralOperations
}

// Connect connects to a schema of a Data Gateway. The scheme of the URL chooses the transport: http(s):// REST,
// ws(s):// JSON-RPC over WebSocket, mcp+http(s):// MCP Streamable HTTP, mcp+sse(s):// MCP HTTP+SSE (legacy),
// mcp+ws(s):// MCP over WebSocket. Without a URL, DATA_GATEWAY_URL. ctx bounds only the opening.
//
//	gw, err := gateway.Connect(ctx, "mcp+http://localhost:8081/northwind", gateway.WithAPIKey(os.Getenv("GATEWAY_KEY")))
//	rows, err := gateway.ExecuteInto[[]Product](ctx, gw, "Products.filter(p => p.price > min)", map[string]any{"min": 50}, nil)
func Connect(ctx context.Context, connection string, options ...Option) (*Client, error) {
	t, err := parse(connection, options...)
	if err != nil {
		return nil, err
	}
	return connectTo(ctx, t, http.DefaultClient)
}

func connectTo(ctx context.Context, t *target, client *http.Client) (*Client, error) {
	var tr transport
	switch t.transport {
	case TransportHTTP:
		tr = &restTransport{target: t, client: client}
	case TransportWebSocket:
		tr = newWebSocketTransport(t, client)
	case TransportMCPHTTP:
		tr = newMCPHTTPTransport(t, client)
	case TransportMCPSSE:
		tr = newMCPSSETransport(t, client)
	case TransportMCPWebSocket:
		tr = newMCPWebSocketTransport(t, client)
	}
	if err := tr.open(ctx); err != nil {
		_ = tr.close()
		return nil, err
	}
	c := &Client{transport: tr, target: t}
	c.Schema, c.Stage, c.General = &SchemaOperations{c}, &StageOperations{c}, &GeneralOperations{c}
	return c, nil
}

// Transport is the transport of the connection: http, ws, mcp+http, mcp+sse or mcp+ws.
func (c *Client) Transport() Transport { return c.transport.name() }

// Close closes the connection (the socket, the MCP session).
func (c *Client) Close() error { return c.transport.close() }

// call is one operation of the common API on the transport: its result as JSON
func (c *Client) call(ctx context.Context, operation string, a args) (json.RawMessage, error) {
	result, err := c.transport.call(ctx, operation, a)
	if err != nil {
		var e *Error
		if errors.As(err, &e) && e.Operation == "" {
			e.Operation = operation
		}
		return nil, err
	}
	return result, nil
}

// callInto is an operation with its result decoded into T
func callInto[T any](ctx context.Context, c *Client, operation string, a args) (T, error) {
	var value T
	raw, err := c.call(ctx, operation, a)
	if err != nil {
		return value, err
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return value, &Error{Code: CodeInternal, Message: "the result of " + operation + " doesn't decode: " + err.Error(), Transport: c.Transport(), Operation: operation, cause: err}
	}
	return value, nil
}

func (c *Client) queryOptions(options *QueryOptions) *QueryOptions {
	if c.target.stage == "" || (options != nil && options.Stage != "") {
		return options
	}
	with := QueryOptions{}
	if options != nil {
		with = *options
	}
	with.Stage = c.target.stage
	return &with
}

func (c *Client) scriptOptions(options *ScriptOptions) *ScriptOptions {
	if c.target.stage == "" || (options != nil && options.Stage != "") {
		return options
	}
	with := ScriptOptions{}
	if options != nil {
		with = *options
	}
	with.Stage = c.target.stage
	return &with
}

// Execute runs a query, the text of a λORM expression with its variables in data: its rows, or what an insert,
// update or delete answers. ExecuteInto decodes it into a type.
func (c *Client) Execute(ctx context.Context, query string, data any, options *QueryOptions) (any, error) {
	return ExecuteInto[any](ctx, c, query, data, options)
}

// ExecuteInto runs a query and decodes its result into T (a struct by its json tags, a slice of them, …).
func ExecuteInto[T any](ctx context.Context, c *Client, query string, data any, options *QueryOptions) (T, error) {
	return callInto[T](ctx, c, "execute", args{"query": query, "data": data, "options": c.queryOptions(options)})
}

// ExecuteScript runs a script of λORM in one transaction (the gateway needs scripts.enabled): the value of its last
// statement.
func (c *Client) ExecuteScript(ctx context.Context, script string, data any, options *ScriptOptions) (any, error) {
	return ExecuteScriptInto[any](ctx, c, script, data, options)
}

// ExecuteScriptInto runs a script and decodes its result into T.
func ExecuteScriptInto[T any](ctx context.Context, c *Client, script string, data any, options *ScriptOptions) (T, error) {
	return callInto[T](ctx, c, "executeScript", args{"script": script, "data": data, "options": c.scriptOptions(options)})
}

// ExecuteQueued queues a query to the topic: the gateway runs it in the background (on ws, the notifications
// queue.completed and queue.failed tell when). chunk 0 is the default of the gateway.
func (c *Client) ExecuteQueued(ctx context.Context, query, topic string, data any, chunk int, options *QueryOptions) (any, error) {
	a := args{"query": query, "topic": topic, "data": data, "options": c.queryOptions(options)}
	if chunk > 0 {
		a["chunk"] = chunk
	}
	return callInto[any](ctx, c, "executeQueued", a)
}

// Plan is the sentences a query would run, on which source and dialect, without running it.
func (c *Client) Plan(ctx context.Context, query string, options *QueryOptions) (Object, error) {
	return callInto[Object](ctx, c, "plan", args{"query": query, "options": c.queryOptions(options)})
}

// Metadata is what a query reads and returns.
func (c *Client) Metadata(ctx context.Context, query string) (Object, error) {
	return callInto[Object](ctx, c, "metadata", args{"query": query})
}

// Model is the properties a query returns, with their types.
func (c *Client) Model(ctx context.Context, query string) ([]Object, error) {
	return callInto[[]Object](ctx, c, "model", args{"query": query})
}

// Parameters is the variables a query needs, with their types.
func (c *Client) Parameters(ctx context.Context, query string) ([]Object, error) {
	return callInto[[]Object](ctx, c, "parameters", args{"query": query})
}

// Constraints is the constraints a write checks.
func (c *Client) Constraints(ctx context.Context, query string) (Object, error) {
	return callInto[Object](ctx, c, "constraints", args{"query": query})
}

// Queries is the queries of application.queries of the schema that this credential can use (REST and WebSocket; on
// MCP they are the tools query_<name>).
func (c *Client) Queries(ctx context.Context) ([]NamedQuery, error) {
	return callInto[[]NamedQuery](ctx, c, "queries", args{})
}

// Query runs a query of application.queries by its name, with its parameters: every transport.
func (c *Client) Query(ctx context.Context, name string, data any, options *QueryOptions) (any, error) {
	return QueryInto[any](ctx, c, name, data, options)
}

// QueryInto runs a named query and decodes its result into T.
func QueryInto[T any](ctx context.Context, c *Client, name string, data any, options *QueryOptions) (T, error) {
	return callInto[T](ctx, c, "query", args{"name": name, "data": data, "options": c.queryOptions(options)})
}

// Approval is the state now of a write that waits for a person to approve it (see IsApprovalPending).
func (c *Client) Approval(ctx context.Context, id string) (*Approval, error) {
	return callInto[*Approval](ctx, c, "approval", args{"id": id})
}

// Whoami is who the credential is and what it can do (REST only).
func (c *Client) Whoami(ctx context.Context) (*Whoami, error) {
	return callInto[*Whoami](ctx, c, "whoami", args{})
}

// Notification events of the gateway (WebSocket only).
const (
	EventQueueCompleted      = "queue.completed"
	EventQueueFailed         = "queue.failed"
	EventSchemaStatusChanged = "schema.statusChanged"
	EventDataChanged         = "data.changed"
	EventQueryChanged        = "query.changed"
	EventSubscriptionFailed  = "subscription.failed"
)

// On listens to a notification of the gateway (ws only): EventQueueCompleted / EventQueueFailed when an
// ExecuteQueued of this connection ends, EventSchemaStatusChanged. The listener runs on the reading goroutine of the
// socket: it must not block. Answers how to stop listening.
func (c *Client) On(event string, listener func(params json.RawMessage)) (off func(), err error) {
	n, ok := c.transport.(notifier)
	if !ok {
		return nil, &Error{Code: CodeUnsupported, Message: "notifications are not available on " + string(c.Transport()) + ": use a ws:// connection", Transport: c.Transport(), Operation: "on"}
	}
	return n.on(event, listener), nil
}

// SubscribeTarget is what a subscription follows: an Entity, a Query (with its Data) or a named query (Name, Data).
type SubscribeTarget struct {
	Entity string
	Query  string
	Name   string
	Data   any
}

// Event is a notification of a subscription: Type is data.changed, query.changed or subscription.failed, Params
// all of it (action, keys and count of a write of the entity; the result of the query again).
type Event struct {
	Type         string
	Subscription string
	Params       Object
}

// Subscription is a subscription started: its id, and for a query its result now.
type Subscription struct {
	ID     string
	Result any
	client *Client
	offs   []func()
}

// Unsubscribe ends the subscription.
func (s *Subscription) Unsubscribe(ctx context.Context) error {
	for _, off := range s.offs {
		off()
	}
	_, err := s.client.call(ctx, "unsubscribe", args{"subscription": s.ID})
	return err
}

// Subscribe follows the writes of the schema (ws only, docs/SUBSCRIPTIONS.md): those of an entity (each write: the
// action, the keys its view sees, the count) or the result of a query, a named one too (its result now, and again
// when it changes). The listener gets the events of this subscription only, on the reading goroutine of the socket.
func (c *Client) Subscribe(ctx context.Context, to SubscribeTarget, listener func(Event)) (*Subscription, error) {
	n, ok := c.transport.(notifier)
	if !ok {
		return nil, unsupported(c.Transport(), "subscribeEntity")
	}
	// the listeners go first: an event may arrive right behind the answer that says the id of the subscription
	s := &Subscription{client: c}
	// mu guards known and early; deliver keeps the order: the early events before the later ones
	var mu, deliver sync.Mutex
	known := false
	var early []Event
	for _, event := range []string{EventDataChanged, EventQueryChanged, EventSubscriptionFailed} {
		event := event
		s.offs = append(s.offs, n.on(event, func(raw json.RawMessage) {
			var params Object
			if json.Unmarshal(raw, &params) != nil {
				return
			}
			id, _ := params["subscription"].(string)
			e := Event{Type: event, Subscription: id, Params: params}
			mu.Lock()
			if !known {
				early = append(early, e)
				mu.Unlock()
				return
			}
			mine := id == s.ID
			mu.Unlock()
			if mine {
				deliver.Lock()
				listener(e)
				deliver.Unlock()
			}
		}))
	}
	stop := func() {
		for _, off := range s.offs {
			off()
		}
	}
	var id string
	var result any
	var err error
	switch {
	case to.Entity != "":
		id, result, err = subscribeCall(ctx, c, "subscribeEntity", args{"entity": to.Entity})
	case to.Name != "":
		id, result, err = subscribeCall(ctx, c, "subscribeQuery", args{"name": to.Name, "data": to.Data})
	case to.Query != "":
		id, result, err = subscribeCall(ctx, c, "subscribeQuery", args{"query": to.Query, "data": to.Data})
	default:
		err = errors.New("subscribe: an Entity, a Query or a Name")
	}
	if err != nil {
		stop()
		return nil, err
	}
	deliver.Lock()
	defer deliver.Unlock()
	mu.Lock()
	s.ID, s.Result, known = id, result, true
	pending := early
	early = nil
	mu.Unlock()
	for _, e := range pending {
		if e.Subscription == id {
			listener(e)
		}
	}
	return s, nil
}

func subscribeCall(ctx context.Context, c *Client, operation string, a args) (string, any, error) {
	started, err := callInto[struct {
		Subscription string `json:"subscription"`
		Result       any    `json:"result"`
	}](ctx, c, operation, a)
	return started.Subscription, started.Result, err
}

// SchemaOperations is the schema as the gateway loaded it. A name that doesn't exist fails with CodeNotFound.
type SchemaOperations struct{ c *Client }

// Get is the whole schema.
func (s *SchemaOperations) Get(ctx context.Context) (Object, error) {
	return callInto[Object](ctx, s.c, "schema", args{})
}

// Version is the version of the schema.
func (s *SchemaOperations) Version(ctx context.Context) (VersionInfo, error) {
	return callInto[VersionInfo](ctx, s.c, "schemaVersion", args{})
}

// Domain is the domain of the schema: its entities and enums.
func (s *SchemaOperations) Domain(ctx context.Context) (Object, error) {
	return callInto[Object](ctx, s.c, "domain", args{})
}

func (s *SchemaOperations) Entities(ctx context.Context) ([]Object, error) {
	return callInto[[]Object](ctx, s.c, "entities", args{})
}

func (s *SchemaOperations) Entity(ctx context.Context, entity string) (Object, error) {
	return callInto[Object](ctx, s.c, "entity", args{"entity": entity})
}

// Search is the entities, properties and relations whose name contains the text, as compact lines (Areas.type only
// in Areas).
func (s *SchemaOperations) Search(ctx context.Context, text string) (DomainSearch, error) {
	return callInto[DomainSearch](ctx, s.c, "search", args{"text": text})
}

// Describe is some entities, two lines each; the names that don't exist apart, with the closest ones.
func (s *SchemaOperations) Describe(ctx context.Context, entities []string) (DescribedEntities, error) {
	return callInto[DescribedEntities](ctx, s.c, "describe", args{"entities": entities})
}

func (s *SchemaOperations) Enums(ctx context.Context) ([]Object, error) {
	return callInto[[]Object](ctx, s.c, "enums", args{})
}

func (s *SchemaOperations) Enum(ctx context.Context, name string) (Object, error) {
	return callInto[Object](ctx, s.c, "enum", args{"enum": name})
}

func (s *SchemaOperations) Sources(ctx context.Context) ([]Source, error) {
	return callInto[[]Source](ctx, s.c, "sources", args{})
}

func (s *SchemaOperations) Source(ctx context.Context, source string) (Source, error) {
	return callInto[Source](ctx, s.c, "source", args{"source": source})
}

func (s *SchemaOperations) Mappings(ctx context.Context) ([]Object, error) {
	return callInto[[]Object](ctx, s.c, "mappings", args{})
}

func (s *SchemaOperations) Mapping(ctx context.Context, mapping string) (Object, error) {
	return callInto[Object](ctx, s.c, "mapping", args{"mapping": mapping})
}

func (s *SchemaOperations) EntityMapping(ctx context.Context, mapping, entity string) (Object, error) {
	return callInto[Object](ctx, s.c, "entityMapping", args{"mapping": mapping, "entity": entity})
}

func (s *SchemaOperations) Stages(ctx context.Context) ([]Object, error) {
	return callInto[[]Object](ctx, s.c, "stages", args{})
}

func (s *SchemaOperations) Stage(ctx context.Context, stage string) (Object, error) {
	return callInto[Object](ctx, s.c, "stage", args{"stage": stage})
}

// Views is the views of the schema the credential can use.
func (s *SchemaOperations) Views(ctx context.Context) ([]string, error) {
	return callInto[[]string](ctx, s.c, "views", args{})
}

// StageOperations is the data of a stage.
type StageOperations struct{ c *Client }

func (s *StageOperations) Exists(ctx context.Context, stage string) (bool, error) {
	answer, err := callInto[struct {
		Exists bool `json:"exists"`
	}](ctx, s.c, "stageExists", args{"stage": stage})
	return answer.Exists, err
}

// Export is the data of the stage (SchemaData of λORM).
func (s *StageOperations) Export(ctx context.Context, stage string) (Object, error) {
	return callInto[Object](ctx, s.c, "stageExport", args{"stage": stage})
}

// Import loads data (SchemaData of λORM, as Export gives it) into the stage.
func (s *StageOperations) Import(ctx context.Context, stage string, data any) error {
	_, err := s.c.call(ctx, "stageImport", args{"stage": stage, "data": data})
	return err
}

// GeneralOperations is the gateway.
type GeneralOperations struct{ c *Client }

func (g *GeneralOperations) Version(ctx context.Context) (VersionInfo, error) {
	return callInto[VersionInfo](ctx, g.c, "version", args{})
}

func (g *GeneralOperations) Health(ctx context.Context) (Health, error) {
	return callInto[Health](ctx, g.c, "health", args{})
}
