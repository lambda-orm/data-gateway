package gateway

import (
	"encoding/json"
	"net/url"
	"reflect"
	"strings"
)

// The operations of the common API (docs/DATA_GATEWAY_CLIENTS_PLAN.md §3) and how each transport calls them: the
// route of the REST API, the method of the JSON-RPC API and the tool of the MCP server of the schema.

type args map[string]any

// obj is an object of JSON without the values not given (nil, or a nil pointer, map or slice), as JSON.stringify
// drops undefined
func obj(pairs ...any) map[string]any {
	out := make(map[string]any, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		if !isNil(pairs[i+1]) {
			out[pairs[i].(string)] = pairs[i+1]
		}
	}
	return out
}

func isNil(v any) bool {
	if v == nil {
		return true
	}
	switch r := reflect.ValueOf(v); r.Kind() {
	case reflect.Pointer, reflect.Map, reflect.Slice, reflect.Interface, reflect.Func:
		return r.IsNil()
	}
	return false
}

// dataOf is the data of a query: an empty object when none is given
func dataOf(a args) any {
	if isNil(a["data"]) {
		return map[string]any{}
	}
	return a["data"]
}

// asObject is a value as an object of JSON (a struct by its json tags)
func asObject(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	out := map[string]any{}
	if text, err := json.Marshal(v); err == nil {
		_ = json.Unmarshal(text, &out)
	}
	return out
}

func str(a args, key string) string { s, _ := a[key].(string); return s }

var enc = url.PathEscape

type restRoute struct {
	method, path string
	body         any
}

var rest = map[string]func(a args) restRoute{
	"execute": func(a args) restRoute {
		return restRoute{"POST", "/execute", obj("query", a["query"], "data", dataOf(a), "options", a["options"])}
	},
	"executeScript": func(a args) restRoute {
		return restRoute{"POST", "/script", obj("script", a["script"], "data", dataOf(a), "options", a["options"])}
	},
	"executeQueued": func(a args) restRoute {
		return restRoute{"POST", "/execute-queued", obj("topic", a["topic"], "query", a["query"], "data", dataOf(a), "chunk", a["chunk"], "options", a["options"])}
	},
	"plan": func(a args) restRoute {
		return restRoute{"POST", "/plan", obj("query", a["query"], "options", a["options"])}
	},
	"metadata":      func(a args) restRoute { return restRoute{"POST", "/metadata", obj("query", a["query"])} },
	"model":         func(a args) restRoute { return restRoute{"POST", "/model", obj("query", a["query"])} },
	"parameters":    func(a args) restRoute { return restRoute{"POST", "/parameters", obj("query", a["query"])} },
	"constraints":   func(a args) restRoute { return restRoute{"POST", "/constraints", obj("query", a["query"])} },
	"schema":        func(args) restRoute { return restRoute{"GET", "/schema", nil} },
	"schemaVersion": func(args) restRoute { return restRoute{"GET", "/schema/version", nil} },
	"domain":        func(args) restRoute { return restRoute{"GET", "/domain", nil} },
	"entities":      func(args) restRoute { return restRoute{"GET", "/entities", nil} },
	"entity":        func(a args) restRoute { return restRoute{"GET", "/entities/" + enc(str(a, "entity")), nil} },
	"search":        func(a args) restRoute { return restRoute{"GET", "/search?q=" + url.QueryEscape(str(a, "text")), nil} },
	"describe": func(a args) restRoute {
		names, _ := a["entities"].([]string)
		escaped := make([]string, len(names))
		for i, name := range names {
			escaped[i] = url.QueryEscape(name)
		}
		return restRoute{"GET", "/describe?entities=" + strings.Join(escaped, ","), nil}
	},
	"enums":    func(args) restRoute { return restRoute{"GET", "/enums", nil} },
	"enum":     func(a args) restRoute { return restRoute{"GET", "/enums/" + enc(str(a, "enum")), nil} },
	"sources":  func(args) restRoute { return restRoute{"GET", "/sources", nil} },
	"source":   func(a args) restRoute { return restRoute{"GET", "/sources/" + enc(str(a, "source")), nil} },
	"mappings": func(args) restRoute { return restRoute{"GET", "/mappings", nil} },
	"mapping":  func(a args) restRoute { return restRoute{"GET", "/mappings/" + enc(str(a, "mapping")), nil} },
	"entityMapping": func(a args) restRoute {
		return restRoute{"GET", "/mappings/" + enc(str(a, "mapping")) + "/" + enc(str(a, "entity")), nil}
	},
	"stages":      func(args) restRoute { return restRoute{"GET", "/stages", nil} },
	"stage":       func(a args) restRoute { return restRoute{"GET", "/stages/" + enc(str(a, "stage")), nil} },
	"views":       func(args) restRoute { return restRoute{"GET", "/views", nil} },
	"stageExists": func(a args) restRoute { return restRoute{"GET", "/stages/" + enc(str(a, "stage")) + "/exists", nil} },
	"stageExport": func(a args) restRoute { return restRoute{"GET", "/stages/" + enc(str(a, "stage")) + "/export", nil} },
	"stageImport": func(a args) restRoute {
		return restRoute{"POST", "/stages/" + enc(str(a, "stage")) + "/import", a["data"]}
	},
	"version": func(args) restRoute { return restRoute{"GET", "/version", nil} },
	"health":  func(args) restRoute { return restRoute{"GET", "/health", nil} },
	"whoami":  func(args) restRoute { return restRoute{"GET", "/whoami", nil} },
	"queries": func(args) restRoute { return restRoute{"GET", "/queries", nil} },
	"query": func(a args) restRoute {
		return restRoute{"POST", "/queries/" + enc(str(a, "name")), obj("data", dataOf(a), "options", a["options"])}
	},
	"approval": func(a args) restRoute { return restRoute{"GET", "/approvals/" + enc(str(a, "id")), nil} },
}

// [method or tool, params]
type rpcRoute struct {
	method string
	params map[string]any
}

func fixed(method string) func(args) rpcRoute {
	return func(args) rpcRoute { return rpcRoute{method, map[string]any{}} }
}

func with(method string, keys ...string) func(args) rpcRoute {
	return func(a args) rpcRoute {
		params := map[string]any{}
		for _, key := range keys {
			if !isNil(a[key]) {
				params[key] = a[key]
			}
		}
		return rpcRoute{method, params}
	}
}

var rpc = map[string]func(a args) rpcRoute{
	"execute": func(a args) rpcRoute {
		return rpcRoute{"query.execute", obj("query", a["query"], "data", dataOf(a), "options", a["options"])}
	},
	"executeScript": func(a args) rpcRoute {
		return rpcRoute{"query.script", obj("script", a["script"], "data", dataOf(a), "options", a["options"])}
	},
	"executeQueued": func(a args) rpcRoute {
		return rpcRoute{"query.executeQueued", obj("topic", a["topic"], "query", a["query"], "data", dataOf(a), "chunk", a["chunk"], "options", a["options"], "notify", true)}
	},
	"plan":          with("query.plan", "query", "options"),
	"metadata":      with("query.metadata", "query"),
	"model":         with("query.model", "query"),
	"parameters":    with("query.parameters", "query"),
	"constraints":   with("query.constraints", "query"),
	"schema":        fixed("schema.schema"),
	"schemaVersion": fixed("schema.version"),
	"domain":        fixed("schema.domain"),
	"entities":      fixed("schema.entities"),
	"entity":        with("schema.entity", "entity"),
	"search":        with("schema.search", "text"),
	"describe":      with("schema.describe", "entities"),
	"enums":         fixed("schema.enums"),
	"enum":          with("schema.enum", "enum"),
	"sources":       fixed("schema.sources"),
	"source":        with("schema.source", "source"),
	"mappings":      fixed("schema.mappings"),
	"mapping":       with("schema.mapping", "mapping"),
	"entityMapping": with("schema.entityMapping", "mapping", "entity"),
	"stages":        fixed("schema.stages"),
	"stage":         with("schema.stage", "stage"),
	"views":         fixed("schema.views"),
	"stageExists":   with("stage.exists", "stage"),
	"stageExport":   with("stage.export", "stage"),
	"stageImport":   with("stage.import", "stage", "data"),
	"version":       fixed("general.version"),
	"health":        fixed("general.health"),
	"queries":       fixed("queries.list"),
	"query": func(a args) rpcRoute {
		return rpcRoute{"queries.execute", obj("name", a["name"], "data", dataOf(a), "options", a["options"])}
	},
	"approval":        with("approvals.status", "id"),
	"subscribeEntity": with("subscribe.entity", "entity"),
	"subscribeQuery": func(a args) rpcRoute {
		if str(a, "name") != "" {
			return rpcRoute{"subscribe.query", obj("name", a["name"], "data", dataOf(a))}
		}
		return rpcRoute{"subscribe.query", obj("query", a["query"], "data", dataOf(a))}
	},
	"unsubscribe": with("unsubscribe", "subscription"),
}

var mcp = map[string]func(a args) rpcRoute{
	"execute": func(a args) rpcRoute {
		return rpcRoute{"orm_execute", obj("query", a["query"], "data", dataOf(a), "options", a["options"])}
	},
	"executeScript": func(a args) rpcRoute {
		return rpcRoute{"orm_execute_script", obj("script", a["script"], "data", dataOf(a), "options", a["options"])}
	},
	"executeQueued": func(a args) rpcRoute {
		return rpcRoute{"orm_execute_queued", obj("topic", a["topic"], "query", a["query"], "data", dataOf(a), "chunk", a["chunk"], "options", a["options"])}
	},
	"plan":          with("orm_plan", "query", "options"),
	"metadata":      with("orm_metadata", "query"),
	"model":         with("orm_model", "query"),
	"parameters":    with("orm_parameters", "query"),
	"constraints":   with("orm_constraints", "query"),
	"schema":        fixed("schema_get"),
	"schemaVersion": fixed("schema_version"),
	"domain":        fixed("schema_domain"),
	"entities":      fixed("schema_entities"),
	"entity":        with("schema_entities", "entity"),
	"search":        with("schema_search", "text"),
	"describe":      with("schema_describe", "entities"),
	"enums":         fixed("schema_enums"),
	"enum":          with("schema_enums", "enum"),
	"sources":       fixed("schema_sources"),
	"source":        with("schema_sources", "source"),
	"mappings":      fixed("schema_mappings"),
	"mapping":       with("schema_mappings", "mapping"),
	"entityMapping": with("schema_mappings", "mapping", "entity"),
	"stages":        fixed("schema_stages"),
	"stage":         with("schema_stages", "stage"),
	"views":         fixed("schema_views"),
	"stageExists":   with("stage_exists", "stage"),
	"stageExport":   with("stage_export", "stage"),
	"stageImport":   with("stage_import", "stage", "data"),
	"version":       fixed("gateway_version"),
	"health":        fixed("gateway_health"),
	// a named query is the tool query_<name>, its parameters as its arguments
	"query": func(a args) rpcRoute {
		return rpcRoute{"query_" + str(a, "name"), asObject(dataOf(a))}
	},
	"approval": with("approval_status", "id"),
}

// where an operation that a transport doesn't have can be found
var where = map[string]string{
	"whoami":          "use an http(s):// connection",
	"queries":         "use an http(s):// or ws(s):// connection (on MCP they are the tools query_<name> of tools/list)",
	"subscribeEntity": "use a ws(s):// connection (or the SSE of GET /subscribe)",
	"subscribeQuery":  "use a ws(s):// connection (or the SSE of GET /subscribe)",
	"unsubscribe":     "use a ws(s):// connection",
	"on":              "use a ws(s):// connection",
}
