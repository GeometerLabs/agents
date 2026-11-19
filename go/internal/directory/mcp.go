// The directory as an MCP server (modules/discovery/mcp.ts, and the JSON-RPC handling of modules/channels/mcp.ts `serverPost`/`serverMessage` it shares with a shop's endpoint, which the
// TypeScript front keeps for the shops' own endpoints), so an AI assistant can find what local shops have. Served at the directory's `/mcp`. A directory takes no payment and changes
// nothing anywhere, so every tool is read-only: search_listings, get_listing, shop_page and (only where the buyer's assistant is on) ask. The tool definitions, their descriptions and the
// instructions are the TypeScript's, generated into the pack. Nothing here ranks: the order is the same function the page uses; and no shop is sent the buyer's words.
package directory

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
)

// opError is a refusal an assistant should read and act on (a tool result with isError): the TypeScript OpError.
type opError struct{ Code, Message string }

func (e *opError) Error() string { return e.Code + ": " + e.Message }

// McpServer is what one endpoint serves.
type McpServer struct {
	Tools        []json.RawMessage
	Names        []string
	Call         func(name string, args map[string]any) (any, error)
	Name, Title  string
	Instructions string
}

const mcpInstructions = "Find what local shops have. Search with the buyer's own words; results are in a fair order that no payment can change, and each is confirmed by its shop when the shop answers. Report only what the results say. You cannot buy or book here: open a result's `chat` link to talk to the shop."

func toolName(raw json.RawMessage) string {
	var t struct{ Name string }
	_ = json.Unmarshal(raw, &t)
	return t.Name
}

// DirectoryServer is the endpoint over a search and its index. who is the caller's address (for the per-buyer cap; never kept as it is).
func DirectoryServer(deps SearchDeps, assistant *Assistant, who string) McpServer {
	p := loadPack()
	tools := append([]json.RawMessage{}, p.MCP.Tools...)
	if assistant != nil {
		tools = append(tools, p.MCP.AskTool)
	}
	names := make([]string, len(tools))
	for i, t := range tools {
		names[i] = toolName(t)
	}
	call := func(name string, args map[string]any) (any, error) {
		if name == "ask" && assistant != nil {
			q, _ := args["question"].(string)
			q = jsTrim(q)
			if q == "" {
				return nil, &opError{"bad_request", "question must be the buyer's words"}
			}
			lang := "en"
			if l, ok := args["lang"].(string); ok && isLang(l) {
				lang = l
			}
			in := AskInput{Question: q, Lang: lang, Who: who}
			if who == "" {
				in.Who = "mcp"
			}
			lat, ok1 := args["lat"].(string)
			lon, ok2 := args["lon"].(string)
			if ok1 && ok2 {
				in.Lat, in.Lon = lat, lon
			}
			r := AskListings(context.Background(), deps, assistant, in)
			if !r.Searched.OK {
				return nil, &opError{"bad_request", r.Searched.Error}
			}
			return askAnswer(r), nil
		}
		if name == "search_listings" {
			r := SearchListings(deps, SearchRequest(args))
			if !r.OK {
				return nil, &opError{"bad_request", r.Error}
			}
			return r.Answer, nil
		}
		shopPage, _ := args["shop"].(string)
		lang := "en"
		if l, ok := args["lang"].(string); ok && isLang(l) {
			lang = l
		}
		shop := deps.Index.Shop(shopPage)
		if shop == nil || shop.Status != "ok" {
			return nil, &opError{"not_found", "This directory has no shop at that address."}
		}
		if name == "shop_page" {
			items := deps.Index.ItemsOf(shop.Page)
			if len(items) > 50 {
				items = items[:50]
			}
			list := make([]any, 0, len(items))
			for _, i := range items {
				t, _, machine := WordsFor(i.Title, i.OwnerLanguage, i.MachineWritten, lang)
				list = append(list, orderedMap(
					"id", i.ID, "title", t, "machineWritten", machine, "category", i.Category, "price", i.Price, "availability", i.Availability, "confirmed", i.Confirmed))
			}
			return orderedMap(
				"shop", orderedMap("name", shop.Name, "page", shop.Page, "trade", shop.Trade, "town", shop.Town, "pincode", shop.PincodeP, "chat", shop.Chat, "agentCard", shop.AgentCard, "registration", shop.Registration, "languages", shop.Languages),
				"listings", list), nil
		}
		// get_listing
		id, _ := args["id"].(string)
		_, found := deps.Index.Item(shop.Page, id)
		if found == nil {
			return nil, &opError{"not_found", "That shop has no such listing here."}
		}
		out := deps.Checker.Check(CheckTarget{Page: shop.Page, Check: shop.Check, Key: shop.Key}, []string{id})
		var said *CheckedItem
		if out.Answered {
			if it, ok := out.Items[id]; ok {
				said = &it
			}
		}
		if said != nil && said.Availability == "gone" {
			return nil, &opError{"not_found", "The shop says this listing is gone."}
		}
		i := *found
		price, qty, avail, confirmed := i.Price, i.Quantity, "call_to_check", i.Confirmed
		if said != nil {
			if said.HasPrice {
				price = said.Price
			}
			if said.Quantity != nil {
				qty = said.Quantity
			}
			avail = said.Availability
			if said.Confirmed != "" {
				confirmed = said.Confirmed
			}
		}
		return orderedMap(
			"shop", orderedMap("name", shop.Name, "page", shop.Page, "town", shop.Town),
			"item", orderedMap("id", i.ID, "category", i.Category, "title", i.Title, "text", i.Text, "ownerLanguage", i.OwnerLanguage, "machineWritten", i.MachineWritten, "price", price, "quantity", qty, "photos", i.Photos, "availability", avail, "confirmed", confirmed, "page", i.Page),
			"chat", shop.Chat+"?about="+encodeURIComponent(i.ID), "checked", said != nil), nil
	}
	return McpServer{Tools: tools, Names: names, Call: call, Name: "geometer-directory", Title: "Directory of local shops", Instructions: mcpInstructions}
}

// ordered is a JSON object that keeps the order its members were given in (a Go map would sort them; JSON.stringify keeps the order they were written in).
type ordered struct {
	keys []string
	vals []any
}

func orderedMap(kv ...any) *ordered {
	o := &ordered{}
	for i := 0; i+1 < len(kv); i += 2 {
		o.keys = append(o.keys, kv[i].(string))
		o.vals = append(o.vals, kv[i+1])
	}
	return o
}

func (o *ordered) MarshalJSON() ([]byte, error) {
	out := []byte{'{'}
	for i, k := range o.keys {
		if i > 0 {
			out = append(out, ',')
		}
		kb, _ := marshalNoEscape(k)
		vb, err := marshalNoEscape(o.vals[i])
		if err != nil {
			return nil, err
		}
		out = append(append(append(out, kb...), ':'), vb...)
	}
	return append(out, '}'), nil
}

// ---- JSON-RPC ----

func rpcError(id json.RawMessage, code int, message string) any {
	if len(id) == 0 || string(id) == "null" {
		id = json.RawMessage("null")
	}
	return orderedMap("jsonrpc", "2.0", "id", id, "error", orderedMap("code", code, "message", message))
}

func rpcResult(id json.RawMessage, v any) any {
	return orderedMap("jsonrpc", "2.0", "id", id, "result", v)
}

// jsString is JavaScript's String(value) for a decoded JSON value, as far as a tool's name needs it.
func jsString(raw json.RawMessage) string {
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return "undefined"
	}
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	case nil:
		return "null"
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				b, _ := json.Marshal(e)
				parts[i] = jsString(b)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// serverMessage handles one JSON-RPC message; nil for a notification (no answer).
func serverMessage(s McpServer, raw json.RawMessage) any {
	var msg map[string]json.RawMessage
	if json.Unmarshal(raw, &msg) != nil || msg == nil {
		return rpcError(nil, -32600, "Not a JSON-RPC 2.0 request.")
	}
	var method string
	if string(msg["jsonrpc"]) != `"2.0"` || json.Unmarshal(msg["method"], &method) != nil {
		return rpcError(msg["id"], -32600, "Not a JSON-RPC 2.0 request.")
	}
	id := msg["id"]
	if len(id) == 0 || string(id) == "null" {
		return nil // a notification (notifications/initialized and the like): nothing to answer
	}
	var params map[string]json.RawMessage
	if json.Unmarshal(msg["params"], &params) != nil || params == nil {
		params = map[string]json.RawMessage{}
	}
	switch method {
	case "initialize":
		var asked string
		_ = json.Unmarshal(params["protocolVersion"], &asked)
		version := loadPack().MCP.Versions[0]
		for _, v := range loadPack().MCP.Versions {
			if v == asked {
				version = asked
			}
		}
		return rpcResult(id, orderedMap("protocolVersion", version, "capabilities", orderedMap("tools", orderedMap("listChanged", false)),
			"serverInfo", orderedMap("name", s.Name, "title", s.Title, "version", "1"), "instructions", s.Instructions))
	case "ping":
		return rpcResult(id, orderedMap())
	case "tools/list":
		return rpcResult(id, orderedMap("tools", s.Tools))
	case "tools/call":
		var name string
		okName := json.Unmarshal(params["name"], &name) == nil
		known := false
		for _, n := range s.Names {
			known = known || okName && n == name
		}
		if !known {
			return rpcError(id, -32602, "There is no tool called "+jsString(params["name"])+".")
		}
		args := map[string]any{}
		var a map[string]any
		if json.Unmarshal(params["arguments"], &a) == nil && a != nil {
			args = a
		}
		value, err := s.Call(name, args)
		if err != nil {
			if e, ok := err.(*opError); ok {
				return rpcResult(id, orderedMap("content", []any{orderedMap("type", "text", "text", e.Code+": "+e.Message)}, "structuredContent", orderedMap("error", orderedMap("code", e.Code, "message", e.Message)), "isError", true))
			}
			return rpcResult(id, orderedMap("content", []any{orderedMap("type", "text", "text", "unavailable: the shop's system did not answer. Try again in a minute.")}, "structuredContent", orderedMap("error", orderedMap("code", "unavailable", "message", "The shop's system did not answer.")), "isError", true))
		}
		text, _ := marshalNoEscape(value)
		return rpcResult(id, orderedMap("content", []any{orderedMap("type", "text", "text", string(text))}, "structuredContent", value, "isError", false))
	}
	return rpcError(id, -32601, "There is no method "+method+" here.")
}

// ServerPost handles a POST body to the endpoint: one message or a batch. It returns the HTTP status and the body to send (nil body, and 202, for notifications only).
func ServerPost(s McpServer, body json.RawMessage) (int, any) {
	trimmed := strings.TrimSpace(string(body))
	if strings.HasPrefix(trimmed, "[") {
		var batch []json.RawMessage
		_ = json.Unmarshal(body, &batch)
		if len(batch) == 0 || len(batch) > 20 {
			return 400, rpcError(nil, -32600, "A batch holds 1 to 20 messages.")
		}
		var answers []any
		for _, m := range batch {
			if a := serverMessage(s, m); a != nil {
				answers = append(answers, a)
			}
		}
		if len(answers) == 0 {
			return 202, nil
		}
		return 200, answers
	}
	if a := serverMessage(s, body); a != nil {
		return 200, a
	}
	return 202, nil
}
