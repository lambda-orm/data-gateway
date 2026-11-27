package gateway

import (
	"context"
	"strings"
	"testing"
	"time"
)

func noEnv(string) string { return "" }

func TestParseTransports(t *testing.T) {
	cases := map[string]struct {
		transport Transport
		url       string
	}{
		"http://gw:8080/northwind":     {TransportHTTP, "http://gw:8080/northwind"},
		"https://gw/data/iot/v1/":      {TransportHTTP, "https://gw/data/iot/v1"},
		"ws://gw:8083/northwind":       {TransportWebSocket, "ws://gw:8083/northwind"},
		"wss://gw/northwind":           {TransportWebSocket, "wss://gw/northwind"},
		"mcp+http://gw:8081/northwind": {TransportMCPHTTP, "http://gw:8081/northwind"},
		"mcp+https://gw/northwind":     {TransportMCPHTTP, "https://gw/northwind"},
		"mcp+sse://gw:8081/northwind":  {TransportMCPSSE, "http://gw:8081/northwind"},
		"mcp+sses://gw/northwind":      {TransportMCPSSE, "https://gw/northwind"},
		"mcp+ws://gw:8082/iot/v1":      {TransportMCPWebSocket, "ws://gw:8082/iot/v1"},
		"mcp+wss://gw/northwind":       {TransportMCPWebSocket, "wss://gw/northwind"},
	}
	for connection, want := range cases {
		target, err := parse(connection, withEnv(noEnv))
		if err != nil {
			t.Fatalf("%s: %v", connection, err)
		}
		if target.transport != want.transport || target.url != want.url {
			t.Errorf("%s: got %s %s, want %s %s", connection, target.transport, target.url, want.transport, want.url)
		}
	}
}

func TestParseRejects(t *testing.T) {
	for connection, want := range map[string]string{
		"":                              "no connection string",
		"ftp://gw/northwind":            "unknown transport",
		"http://user:pass@gw/northwind": "credential",
		"http://gw/northwind?apiKey=x":  "credential (apiKey=)",
		"http://gw/northwind?token=x":   "credential",
		"http://gw/northwind?nope=1":    "unknown option",
		"not a url":                     "invalid connection string",
	} {
		_, err := parse(connection, withEnv(noEnv))
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: got %v, want an error with %q", connection, err, want)
		}
	}
}

func TestParseOptionsAndEnvironment(t *testing.T) {
	env := map[string]string{"DATA_GATEWAY_URL": "ws://gw/northwind?timeout=1500&stage=test", "DATA_GATEWAY_API_KEY": "env-key", "DATA_GATEWAY_TOKEN": "env-token"}
	target, err := parse("", withEnv(func(k string) string { return env[k] }))
	if err != nil {
		t.Fatal(err)
	}
	if target.timeout != 1500*time.Millisecond || target.stage != "test" {
		t.Errorf("timeout %s stage %q", target.timeout, target.stage)
	}
	if target.headers["X-Api-Key"] != "env-key" || target.headers["Authorization"] != "Bearer env-token" {
		t.Errorf("headers %v", target.headers)
	}
	// what is explicit wins over the environment
	target, _ = parse("http://gw/northwind?timeout=1500", withEnv(func(k string) string { return env[k] }),
		WithAPIKey("k"), WithAPIKeyHeader("X-Key"), WithToken(""), WithTimeout(time.Second), WithStage("prod"), WithHeader("X-Tenant", "t"))
	if target.headers["X-Key"] != "k" || target.headers["Authorization"] != "" || target.headers["X-Tenant"] != "t" || target.timeout != time.Second || target.stage != "prod" {
		t.Errorf("target %+v", target)
	}
	if target, _ := parse("http://gw/northwind", withEnv(noEnv)); target.timeout != DefaultTimeout {
		t.Errorf("default timeout %s", target.timeout)
	}
}

func TestTokenFunc(t *testing.T) {
	n := 0
	target, _ := parse("http://gw/northwind", withEnv(noEnv), WithTokenFunc(func(context.Context) (string, error) { n++; return "jwt-" + string(rune('0'+n)), nil }))
	first, _ := target.headersOf(context.Background())
	second, _ := target.headersOf(context.Background())
	if first["Authorization"] != "Bearer jwt-1" || second["Authorization"] != "Bearer jwt-2" {
		t.Errorf("got %v %v", first, second)
	}
}
