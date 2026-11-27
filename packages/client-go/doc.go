// Package gateway is the Go client of the λORM Data Gateway: one API, five transports. The scheme of the connection
// string chooses REST (http://, https://), JSON-RPC over WebSocket (ws://, wss://), MCP Streamable HTTP
// (mcp+http://), MCP HTTP+SSE (mcp+sse://) or MCP over WebSocket (mcp+ws://); the same query gives the same result,
// and the same error the same code, whichever you use.
//
//	gw, err := gateway.Connect(ctx, "http://localhost:8080/northwind", gateway.WithAPIKey(os.Getenv("GATEWAY_KEY")))
//	if err != nil {
//		return err
//	}
//	defer gw.Close()
//	products, err := gateway.ExecuteInto[[]Product](ctx, gw,
//		"Products.filter(p => p.price > minPrice).map(p => ({ name: p.name, price: p.price })).sort(p => desc(p.price)).page(1, 3)",
//		map[string]any{"minPrice": 50}, nil)
//
// Every operation that fails returns an *Error; branch on its Code (gateway.IsCode(err, gateway.CodeUnique)).
package gateway
