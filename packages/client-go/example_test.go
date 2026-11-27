package gateway_test

import (
	"context"
	"fmt"
	"os"

	gateway "github.com/lambda-orm/data-gateway-client-go"
)

type Product struct {
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

func Example() {
	ctx := context.Background()
	gw, err := gateway.Connect(ctx, "http://localhost:8080/northwind", gateway.WithAPIKey(os.Getenv("GATEWAY_KEY")))
	if err != nil {
		fmt.Println(err)
		return
	}
	defer gw.Close()
	products, err := gateway.ExecuteInto[[]Product](ctx, gw,
		"Products.filter(p => p.price > minPrice).map(p => ({ name: p.name, price: p.price })).sort(p => desc(p.price)).page(1, 3)",
		map[string]any{"minPrice": 50}, nil)
	if gateway.IsCode(err, gateway.CodeForbidden) {
		fmt.Println("the key can't read Products")
		return
	}
	fmt.Println(products, err)
}
