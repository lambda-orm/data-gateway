// The conformance suite (packages/conformance) with the Go client: every case on the five transports, through the
// public API of the client, and the subscriptions on ws. `go run ./conformance` with the environment of the suite up
// (packages/conformance/README.md).
//
//	go run ./conformance [-transport http,ws,mcp+http,mcp+sse,mcp+ws] [-case <text in the name>]
package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	gateway "github.com/lambda-orm/data-gateway-client-go"
)

const schema = "northwind"

var transports = []string{"http", "ws", "mcp+http", "mcp+sse", "mcp+ws"}

func connections() map[string]string {
	host := os.Getenv("CONFORMANCE_HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	return map[string]string{
		"http":     fmt.Sprintf("http://%s:19080/%s", host, schema),
		"ws":       fmt.Sprintf("ws://%s:19083/%s", host, schema),
		"mcp+http": fmt.Sprintf("mcp+http://%s:19081/%s", host, schema),
		"mcp+sse":  fmt.Sprintf("mcp+sse://%s:19081/%s", host, schema),
		"mcp+ws":   fmt.Sprintf("mcp+ws://%s:19082/%s", host, schema),
	}
}

var keys = map[string]string{"reader": "conformance-reader-key", "backend": "conformance-backend-key"}

// the JWT of the suite (runner/index.mjs): HS256 with this secret; public, only for tests
const (
	jwtSecret   = "conformance-jwt-secret-of-32-bytes!!"
	jwtIssuer   = "https://conformance.lambdaorm"
	jwtAudience = "data-gateway"
)

func b64(v any) string {
	text, _ := json.Marshal(v)
	return base64.RawURLEncoding.EncodeToString(text)
}

func jwt(sub string, roles []string, expiresIn int64, claims map[string]any) string {
	now := time.Now().Unix()
	payload := map[string]any{"iss": jwtIssuer, "aud": jwtAudience, "sub": sub, "roles": roles, "tenant": "conformance", "iat": now, "exp": now + expiresIn}
	for k, v := range claims {
		payload[k] = v
	}
	unsigned := b64(map[string]string{"alg": "HS256", "typ": "JWT"}) + "." + b64(payload)
	mac := hmac.New(sha256.New, []byte(jwtSecret))
	mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// credentialOf is how a credential of a case is sent: an API key, or a token
func credentialOf(name string) gateway.Option {
	switch name {
	case "jwtReader":
		return gateway.WithToken(jwt("jwt-reader", []string{"reader"}, 600, nil))
	case "jwtBackend":
		return gateway.WithToken(jwt("jwt-backend", []string{"backend"}, 600, nil))
	case "jwtExpired":
		return gateway.WithToken(jwt("jwt-reader", []string{"reader"}, -120, nil))
	case "jwtSales":
		return gateway.WithToken(jwt("jwt-sales", []string{"sales"}, 600, map[string]any{"country": "Germany"}))
	}
	return gateway.WithAPIKey(keys[name])
}

// ----------------------------------------------------------------------------------------------------------- the cases

type step struct {
	Operation string         `json:"operation"`
	Args      map[string]any `json:"args"`
	Expect    map[string]any `json:"expect"`
	MCP       map[string]any `json:"mcp"`
}

type testCase struct {
	step
	Name       string   `json:"name"`
	Credential string   `json:"credential"`
	Transports []string `json:"transports"`
	Steps      []step   `json:"steps"`
}

func casesDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "conformance", "cases")
}

func loadCases() ([]testCase, error) {
	files, err := filepath.Glob(filepath.Join(casesDir(), "*.json"))
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	var all []testCase
	for _, file := range files {
		text, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		var cases []testCase
		if err := json.Unmarshal(text, &cases); err != nil {
			return nil, fmt.Errorf("%s: %w", file, err)
		}
		all = append(all, cases...)
	}
	return all, nil
}

func (c testCase) steps() []step {
	if c.Steps != nil {
		return c.Steps
	}
	return []step{c.step}
}

var ref = regexp.MustCompile(`^\$(\d+)$`)

// resolve: "$0", "$1"… is the result of that step; "$transport" the name of the transport
func resolve(value any, results []any, transport string) any {
	switch v := value.(type) {
	case string:
		if v == "$transport" {
			return transport
		}
		if m := ref.FindStringSubmatch(v); m != nil {
			var i int
			fmt.Sscan(m[1], &i)
			if i < len(results) {
				return results[i]
			}
			return nil
		}
		return strings.ReplaceAll(v, "$transport", transport)
	case []any:
		out := make([]any, len(v))
		for i, e := range v {
			out[i] = resolve(e, results, transport)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, e := range v {
			out[k] = resolve(e, results, transport)
		}
		return out
	}
	return value
}

// ------------------------------------------------------------------------------------------------------- the operations

type operation func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error)

func decode[T any](v any) *T {
	if v == nil {
		return nil
	}
	var out T
	text, _ := json.Marshal(v)
	_ = json.Unmarshal(text, &out)
	return &out
}

func s(a map[string]any, key string) string { v, _ := a[key].(string); return v }

func strs(a map[string]any, key string) []string {
	if p := decode[[]string](a[key]); p != nil {
		return *p
	}
	return nil
}

// each operation of the cases as the public API of the client does it
var operations = map[string]operation{
	"execute": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Execute(ctx, s(a, "query"), a["data"], decode[gateway.QueryOptions](a["options"]))
	},
	"executeScript": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.ExecuteScript(ctx, s(a, "script"), a["data"], decode[gateway.ScriptOptions](a["options"]))
	},
	"plan": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Plan(ctx, s(a, "query"), decode[gateway.QueryOptions](a["options"]))
	},
	"metadata": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Metadata(ctx, s(a, "query"))
	},
	"model": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Model(ctx, s(a, "query"))
	},
	"parameters": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Parameters(ctx, s(a, "query"))
	},
	"constraints": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Constraints(ctx, s(a, "query"))
	},
	"queries": func(ctx context.Context, c *gateway.Client, _ map[string]any) (any, error) { return c.Queries(ctx) },
	"query": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Query(ctx, s(a, "name"), a["data"], decode[gateway.QueryOptions](a["options"]))
	},
	"schemaVersion": func(ctx context.Context, c *gateway.Client, _ map[string]any) (any, error) {
		return c.Schema.Version(ctx)
	},
	"domain": func(ctx context.Context, c *gateway.Client, _ map[string]any) (any, error) {
		return c.Schema.Domain(ctx)
	},
	"entities": func(ctx context.Context, c *gateway.Client, _ map[string]any) (any, error) {
		return c.Schema.Entities(ctx)
	},
	"entity": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Schema.Entity(ctx, s(a, "entity"))
	},
	"search": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Schema.Search(ctx, s(a, "text"))
	},
	"describe": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Schema.Describe(ctx, strs(a, "entities"))
	},
	"enums": func(ctx context.Context, c *gateway.Client, _ map[string]any) (any, error) {
		return c.Schema.Enums(ctx)
	},
	"enum": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Schema.Enum(ctx, s(a, "enum"))
	},
	"sources": func(ctx context.Context, c *gateway.Client, _ map[string]any) (any, error) {
		return c.Schema.Sources(ctx)
	},
	"source": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Schema.Source(ctx, s(a, "source"))
	},
	"mappings": func(ctx context.Context, c *gateway.Client, _ map[string]any) (any, error) {
		return c.Schema.Mappings(ctx)
	},
	"mapping": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Schema.Mapping(ctx, s(a, "mapping"))
	},
	"stages": func(ctx context.Context, c *gateway.Client, _ map[string]any) (any, error) {
		return c.Schema.Stages(ctx)
	},
	"stage": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Schema.Stage(ctx, s(a, "stage"))
	},
	"views": func(ctx context.Context, c *gateway.Client, _ map[string]any) (any, error) {
		return c.Schema.Views(ctx)
	},
	"stageExists": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		exists, err := c.Stage.Exists(ctx, s(a, "stage"))
		return map[string]any{"exists": exists}, err
	},
	"stageExport": func(ctx context.Context, c *gateway.Client, a map[string]any) (any, error) {
		return c.Stage.Export(ctx, s(a, "stage"))
	},
	"version": func(ctx context.Context, c *gateway.Client, _ map[string]any) (any, error) {
		return c.General.Version(ctx)
	},
	"health": func(ctx context.Context, c *gateway.Client, _ map[string]any) (any, error) {
		return c.General.Health(ctx)
	},
}

// ------------------------------------------------------------------------------------------------------- comparisons

// plain is a value as JSON sees it (a struct by its json tags), to compare it with what the case expects
func plain(v any) any {
	text, err := json.Marshal(v)
	if err != nil {
		return v
	}
	var out any
	_ = json.Unmarshal(text, &out)
	return out
}

// matches: every key of expected is in actual with a matching value; lists have the same length and match one by one
func matches(actual, expected any) bool {
	switch e := expected.(type) {
	case []any:
		a, ok := actual.([]any)
		if !ok || len(a) != len(e) {
			return false
		}
		for i := range e {
			if !matches(a[i], e[i]) {
				return false
			}
		}
		return true
	case map[string]any:
		a, ok := actual.(map[string]any)
		if !ok {
			return false
		}
		for k, v := range e {
			if !matches(a[k], v) {
				return false
			}
		}
		return true
	}
	return reflect.DeepEqual(actual, expected)
}

func typeOf(v any) string {
	switch v.(type) {
	case string:
		return "string"
	case float64:
		return "number"
	case bool:
		return "boolean"
	}
	return "object"
}

func show(v any) string {
	text, _ := json.Marshal(v)
	if len(text) > 300 {
		return string(text[:300]) + "…"
	}
	return string(text)
}

// check is "" when the outcome is what was expected; else what went wrong
func check(expect map[string]any, result any, err *gateway.Error) string {
	if expected, ok := expect["error"].(map[string]any); ok {
		if err == nil {
			return fmt.Sprintf("expected the error %s, got the result %s", show(expected), show(result))
		}
		if code, _ := expected["code"].(string); string(err.Code) != code {
			return fmt.Sprintf("expected the error code %s, got %s (%s %d: %s)", code, err.Code, err.Name, err.Status, err.Message)
		}
		if name, _ := expected["name"].(string); name != "" && err.Name != name {
			return fmt.Sprintf("expected the error %s, got %s", name, err.Name)
		}
		return ""
	}
	if err != nil {
		return fmt.Sprintf("unexpected error %s (%s %d): %s", err.Code, err.Name, err.Status, err.Message)
	}
	if want, ok := expect["result"]; ok && !reflect.DeepEqual(result, want) {
		return fmt.Sprintf("expected %s, got %s", show(want), show(result))
	}
	if want, ok := expect["match"]; ok && !matches(result, want) {
		return fmt.Sprintf("expected to match %s, got %s", show(want), show(result))
	}
	if want, ok := expect["length"].(float64); ok {
		if list, isList := result.([]any); !isList || len(list) != int(want) {
			return fmt.Sprintf("expected a list of %v, got %s", want, show(result))
		}
	}
	if want, ok := expect["keys"].([]any); ok {
		object, isObject := result.(map[string]any)
		for _, k := range want {
			if _, has := object[k.(string)]; !isObject || !has {
				return fmt.Sprintf("expected the keys %s, got %s", show(want), show(result))
			}
		}
	}
	if want, ok := expect["type"].(string); ok && typeOf(result) != want {
		return fmt.Sprintf("expected a %s, got %s", want, show(result))
	}
	return ""
}

// ------------------------------------------------------------------------------------------------------------- the run

func runCase(ctx context.Context, c testCase, transport string, client func(string) (*gateway.Client, error)) string {
	credential := c.Credential
	if credential == "" {
		credential = "reader"
	}
	var results []any
	for i, st := range c.steps() {
		conn, err := client(credential)
		if err != nil {
			return "failed to connect: " + err.Error()
		}
		run, ok := operations[st.Operation]
		if !ok {
			return fmt.Sprintf("step %d: the runner has no operation %s", i, st.Operation)
		}
		a, _ := resolve(st.Args, results, transport).(map[string]any)
		if a == nil {
			a = map[string]any{}
		}
		value, err := run(ctx, conn, a)
		var gwErr *gateway.Error
		if err != nil && !errors.As(err, &gwErr) {
			return fmt.Sprintf("step %d (%s): failed to run: %v", i, st.Operation, err)
		}
		var result any
		if gwErr == nil {
			result = plain(value)
		}
		results = append(results, result)
		expect := st.Expect
		if strings.HasPrefix(transport, "mcp+") && st.MCP != nil {
			expect = st.MCP
		}
		expect, _ = resolve(expect, results, transport).(map[string]any)
		if problem := check(expect, result, gwErr); problem != "" {
			return fmt.Sprintf("step %d (%s): %s", i, st.Operation, problem)
		}
	}
	return ""
}

func main() {
	only := flag.String("transport", strings.Join(transports, ","), "the transports, separated by commas")
	filter := flag.String("case", "", "only the cases with this text in their name")
	flag.Parse()
	all, err := loadCases()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	var cases []testCase
	for _, c := range all {
		if *filter == "" || strings.Contains(c.Name, *filter) {
			cases = append(cases, c)
		}
	}
	ctx := context.Background()
	urls := connections()
	chosen := strings.Split(*only, ",")
	passed, failures := 0, 0
	for _, transport := range chosen {
		open := map[string]*gateway.Client{}
		client := func(credential string) (*gateway.Client, error) {
			if c, ok := open[credential]; ok {
				return c, nil
			}
			c, err := gateway.Connect(ctx, urls[transport], credentialOf(credential))
			if err != nil {
				return nil, err
			}
			open[credential] = c
			return c, nil
		}
		fmt.Printf("\n%s  %s\n", transport, urls[transport])
		for _, c := range cases {
			if c.Transports != nil && !containsString(c.Transports, transport) {
				continue
			}
			problem := runCase(ctx, c, transport, client)
			if problem != "" {
				failures++
				fmt.Printf("  ✗ %s\n      %s\n", c.Name, problem)
			} else {
				passed++
				fmt.Printf("  ✓ %s\n", c.Name)
			}
		}
		for _, c := range open {
			_ = c.Close()
		}
	}
	if containsString(chosen, "ws") && *filter == "" {
		problem := subscriptions(ctx, urls["ws"])
		if problem != "" {
			failures++
			fmt.Printf("  ✗ subscriptions: an entity and a query\n      %s\n", problem)
		} else {
			passed++
			fmt.Println("  ✓ subscriptions: an entity and a query")
		}
	}
	fmt.Printf("\n%d passed, %d failed (%d cases × %d transports, and the subscriptions)\n", passed, failures, len(cases), len(chosen))
	if failures > 0 {
		os.Exit(1)
	}
}

func containsString(list []string, value string) bool {
	for _, v := range list {
		if v == value {
			return true
		}
	}
	return false
}

// subscriptions: a write reaches the subscription of its entity and the one of a query that reads it
func subscriptions(ctx context.Context, url string) string {
	c, err := gateway.Connect(ctx, url, credentialOf("backend"))
	if err != nil {
		return "failed to connect: " + err.Error()
	}
	defer c.Close()
	name := fmt.Sprintf("conformance go client subscription %d", time.Now().UnixNano())
	var mu sync.Mutex
	var events []gateway.Event
	listener := func(e gateway.Event) { mu.Lock(); events = append(events, e); mu.Unlock() }
	entity, err := c.Subscribe(ctx, gateway.SubscribeTarget{Entity: "Categories"}, listener)
	if err != nil {
		return "subscribe to the entity: " + err.Error()
	}
	query, err := c.Subscribe(ctx, gateway.SubscribeTarget{Query: "Categories.filter(p => p.name == name).map(p => p.name)", Data: map[string]any{"name": name}}, listener)
	if err != nil {
		return "subscribe to the query: " + err.Error()
	}
	if list, ok := query.Result.([]any); !ok || len(list) != 0 {
		return "the first result of the query: " + show(query.Result)
	}
	if _, err := c.Execute(ctx, "Categories.insert()", map[string]any{"name": name}, nil); err != nil {
		return "insert: " + err.Error()
	}
	want := show([]any{map[string]any{"name": name}})
	arrived := func() bool {
		mu.Lock()
		defer mu.Unlock()
		var data, changed bool
		for _, e := range events {
			data = data || (e.Type == gateway.EventDataChanged && e.Subscription == entity.ID)
			changed = changed || (e.Type == gateway.EventQueryChanged && e.Subscription == query.ID && show(e.Params["result"]) == want)
		}
		return data && changed
	}
	for end := time.Now().Add(3 * time.Second); !arrived() && time.Now().Before(end); {
		time.Sleep(50 * time.Millisecond)
	}
	_, _ = c.Execute(ctx, "Categories.delete().filter(p => p.name == name)", map[string]any{"name": name}, nil)
	_ = entity.Unsubscribe(ctx)
	_ = query.Unsubscribe(ctx)
	if !arrived() {
		mu.Lock()
		defer mu.Unlock()
		return "events: " + show(events)
	}
	return ""
}
