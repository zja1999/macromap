/**
 * Macro Map — fetch-chain-data edge function
 *
 * Three-phase agentic pipeline per chain request:
 *   1. Claude searches the web for the chain's official nutrition page or PDF
 *   2. Edge function fetches the URL (HTML text or raw PDF bytes)
 *   3. Claude reads the document and extracts data via submit_nutrition_data
 *
 * Tools in the loop:
 *   web_search_20250305   — server-side (Anthropic handles); returns snippets + URLs
 *   fetch_url             — client-side; edge function GETs the URL and returns content
 *   submit_nutrition_data — client-side; structured output that we validate + insert
 *
 * Required Supabase secret:
 *   ANTHROPIC_API_KEY  — Dashboard → Edge Functions → Secrets
 */

import Anthropic from "npm:@anthropic-ai/sdk@0.35.0";

const ADMIN_EMAILS = new Set(["zja1999@gmail.com", "rannyalex15@gmail.com"]);
const MAX_FETCH_BYTES = 5_000_000;   // 5 MB cap on fetched documents
const MAX_AGENT_TURNS = 12;          // prevent runaway loops

// ---------------------------------------------------------------------------
// helpers

function decodeJwt(token: string): { email?: string } {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "==".slice(b64.length % 4 === 0 ? 0 : 4 - (b64.length % 4));
    return JSON.parse(atob(pad));
  } catch {
    return {};
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResp(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// fetch_url — the client-side tool the agent calls to retrieve a page or PDF

async function executeFetchUrl(url: string): Promise<Anthropic.ToolResultBlockParam> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MacroMapBot/1.0; nutrition data research)" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      return toolResult("fetch_url_result", `HTTP ${resp.status} — could not fetch ${url}`);
    }

    const contentType = resp.headers.get("content-type") ?? "";
    const isPdf = contentType.includes("pdf") || url.toLowerCase().includes(".pdf");

    if (isPdf) {
      const bytes = await resp.arrayBuffer();
      if (bytes.byteLength > MAX_FETCH_BYTES) {
        return toolResult("fetch_url_result", `PDF too large (${Math.round(bytes.byteLength / 1e6)} MB). Try a different URL.`);
      }
      // Return PDF as base64 so Claude can read it as a document block
      const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
      return {
        type: "tool_result" as const,
        tool_use_id: "fetch_url_result",
        content: [{ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: b64 } }],
      };
    }

    // HTML / plain text — strip tags, return first 100k characters
    const text = await resp.text();
    const stripped = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{3,}/g, "\n\n")
      .slice(0, 100_000);
    return toolResult("fetch_url_result", `Content from ${url}:\n\n${stripped}`);

  } catch (err) {
    return toolResult("fetch_url_result", `Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function toolResult(id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: "tool_result" as const, tool_use_id: id, content };
}

// ---------------------------------------------------------------------------
// Claude tool definitions

const FETCH_URL_TOOL: Anthropic.Tool = {
  name: "fetch_url",
  description: "Fetch a web page or PDF by URL. Returns the page text (for HTML) or the PDF as a readable document. Use this to retrieve the chain's official nutrition page or downloadable nutrition PDF.",
  input_schema: {
    type: "object" as const,
    required: ["url"],
    properties: {
      url: { type: "string" as const, description: "Full URL to fetch, e.g. https://www.starbucks.com/menu/nutrition" },
    },
  },
};

const ITEM_SCHEMA = {
  type: "object" as const,
  required: ["name", "kcal", "protein", "carbs", "fat", "sodium"],
  properties: {
    name:     { type: "string" as const, description: "Menu item name exactly as listed" },
    category: { type: "string" as const, description: "Menu section, e.g. Burgers, Frappuccinos, Breakfast, Sides, Drinks" },
    kcal:     { type: "number" as const, description: "Calories — integer" },
    protein:  { type: "number" as const, description: "Protein grams" },
    carbs:    { type: "number" as const, description: "Total carbohydrate grams" },
    fat:      { type: "number" as const, description: "Total fat grams" },
    sodium:   { type: "number" as const, description: "Sodium milligrams" },
    fiber:    { type: "number" as const, description: "Dietary fiber grams (0 if not listed)" },
    sugar:    { type: "number" as const, description: "Total sugar grams (0 if not listed)" },
  },
};

const SUBMIT_TOOL: Anthropic.Tool = {
  name: "submit_nutrition_data",
  description: "Submit all extracted nutrition data for the chain. Call this once you have read the nutrition document and extracted complete data.",
  input_schema: {
    type: "object" as const,
    required: ["chain_id", "chain_name", "chain_color", "match", "items"],
    properties: {
      chain_id:   { type: "string" as const, description: "Lowercase slug, underscores only — e.g. 'starbucks', 'taco_bell', 'chick_fil_a'" },
      chain_name: { type: "string" as const, description: "Brand display name exactly — e.g. \"Starbucks\", \"Taco Bell\"" },
      chain_color:{ type: "string" as const, description: "Brand primary hex color — e.g. '#00704A'" },
      match:      { type: "array" as const, items: { type: "string" as const }, description: "Lowercase name aliases for OpenStreetMap detection" },
      items:      { type: "array" as const, items: ITEM_SCHEMA, description: "ALL menu items extracted from the nutrition document. No artificial cap — include every item that has complete data." },
    },
  },
};

// ---------------------------------------------------------------------------
// validate + shape raw items returned by the agent

function cleanItems(raw: Record<string, unknown>[], chainId: string) {
  const NUMERICS = ["kcal", "protein", "carbs", "fat", "sodium", "fiber", "sugar"] as const;
  const seen = new Set<string>();
  return (raw ?? []).flatMap((it) => {
    const name = String(it.name ?? "").trim();
    if (!name) return [];
    const kcal = Number(it.kcal);
    if (!kcal || kcal <= 0 || kcal > 5000) return [];
    const id = `${chainId}:${slugify(name)}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const nums: Record<string, number> = {};
    for (const col of NUMERICS) {
      const v = Number(it[col]);
      nums[col] = isNaN(v) || v < 0 ? 0 : Math.round(v * 10) / 10;
    }
    return [{ id, chain_id: chainId, name, category: String(it.category ?? "").trim() || null, ...nums }];
  });
}

// ---------------------------------------------------------------------------
// main handler

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  // auth
  const rawToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { email } = decodeJwt(rawToken);
  if (!email || !ADMIN_EMAILS.has(email.toLowerCase().trim())) {
    return jsonResp({ error: "Admin access required" }, 403, cors);
  }

  let body: { chainName?: string; requestId?: string };
  try { body = await req.json(); } catch { body = {}; }
  const chainName = (body.chainName ?? "").trim();
  const requestId = (body.requestId ?? "").trim();
  if (!chainName) return jsonResp({ error: "chainName is required" }, 400, cors);

  const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANTHROPIC_KEY  = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_KEY) {
    return jsonResp({ error: "ANTHROPIC_API_KEY not set — add it in Supabase Dashboard → Edge Functions → Secrets." }, 500, cors);
  }

  const dbHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

    // -----------------------------------------------------------------------
    // Agentic loop
    // Turn 1: Claude searches for the nutrition page/PDF
    // Turn 2: Our code fetches the URL Claude identified
    // Turn 3: Claude reads the document and calls submit_nutrition_data
    // -----------------------------------------------------------------------

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content:
          `Find the official US nutritional information for "${chainName}" and submit it using submit_nutrition_data.\n\n` +
          `Step 1 — Search for the chain's nutrition PDF or page (e.g. search "${chainName} nutrition facts PDF" or "${chainName} full menu nutrition information").\n` +
          `Step 2 — Use fetch_url to retrieve the nutrition page or PDF you found.\n` +
          `Step 3 — Extract ALL menu items with complete data from the document and call submit_nutrition_data.\n\n` +
          `Include every item that has kcal, protein, carbs, fat, and sodium listed — there is no upper limit on item count.\n` +
          `For beverages sold in multiple sizes, include each size as a separate item (e.g. "Latte (Tall)", "Latte (Grande)", "Latte (Venti)").\n` +
          `Data must come from the actual document — do not invent or estimate values.`,
      },
    ];

    const systemPrompt =
      `You are a nutrition data researcher for Macro Map, a US restaurant macro-tracking app.\n\n` +
      `Your job: find and fetch the official nutritional document for "${chainName}", read it carefully, and submit every menu item using submit_nutrition_data.\n\n` +
      `Standards:\n` +
      `- chain_id: lowercase + underscores only (e.g. "starbucks", "taco_bell", "chick_fil_a")\n` +
      `- chain_color: brand primary hex (e.g. "#00704A" for Starbucks)\n` +
      `- match: lowercase OpenStreetMap aliases (e.g. ["starbucks", "starbucks coffee"])\n` +
      `- kcal: integer calories\n` +
      `- sodium: milligrams\n` +
      `- protein, carbs, fat: grams\n` +
      `- fiber, sugar: grams (use 0 if not in the document)\n` +
      `- Include ALL items with complete data — no artificial limit\n` +
      `- Only submit values found in the actual document, never estimated`;

    let submittedData: Record<string, unknown> | null = null;
    let turns = 0;

    while (!submittedData && turns < MAX_AGENT_TURNS) {
      turns++;
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: systemPrompt,
        tools: [
          { type: "web_search_20250305" as const, name: "web_search" },
          FETCH_URL_TOOL,
          SUBMIT_TOOL,
        ],
        messages,
      });

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn") break;

      // Process tool calls
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (!toolUses.length) break;

      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const tu of toolUses) {
        if (tu.name === "submit_nutrition_data") {
          submittedData = tu.input as Record<string, unknown>;
          results.push({ type: "tool_result", tool_use_id: tu.id, content: "Data received." });

        } else if (tu.name === "fetch_url") {
          const url = String((tu.input as { url?: string }).url ?? "").trim();
          if (!url.startsWith("http")) {
            results.push(toolResult(tu.id, "Invalid URL — must start with http or https."));
          } else {
            const fetched = await executeFetchUrl(url);
            // Attach the correct tool_use_id from this specific call
            results.push({ ...fetched, tool_use_id: tu.id });
          }

        }
        // web_search is server-side — Anthropic handles it; no result needed from us
      }

      if (results.length) {
        messages.push({ role: "user", content: results });
      }
    }

    if (!submittedData) {
      throw new Error(
        `Agent could not find nutritional data for "${chainName}" after ${turns} turns. ` +
        `Try the manual CSV upload, or check that the chain has a public nutrition page.`
      );
    }

    // -----------------------------------------------------------------------
    // Validate and save
    // -----------------------------------------------------------------------

    const chainId = String(submittedData.chain_id ?? "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!chainId) throw new Error("Agent returned an invalid chain_id.");

    const chainColor = /^#[0-9a-fA-F]{3,6}$/.test(String(submittedData.chain_color ?? ""))
      ? String(submittedData.chain_color)
      : "#6b7280";

    const matchAliases = (Array.isArray(submittedData.match) ? submittedData.match : [])
      .map((a) => String(a).toLowerCase().trim()).filter(Boolean);
    if (!matchAliases.length) matchAliases.push(chainName.toLowerCase());

    const items = cleanItems(
      Array.isArray(submittedData.items) ? submittedData.items as Record<string, unknown>[] : [],
      chainId
    );
    if (!items.length) throw new Error("No valid menu items were extracted from the document.");

    const chainRow = {
      id: chainId,
      name: String(submittedData.chain_name ?? chainName).trim(),
      color: chainColor,
      match: matchAliases,
    };

    // Upsert chain
    const chainRes = await fetch(`${SUPABASE_URL}/rest/v1/chains?on_conflict=id`, {
      method: "POST",
      headers: { ...dbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([chainRow]),
    });
    if (!chainRes.ok) throw new Error("Failed to save chain: " + await chainRes.text());

    // Skip items that already exist
    const existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/menu_items?select=id&chain_id=eq.${encodeURIComponent(chainId)}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const existIds = new Set<string>(
      (existRes.ok ? (await existRes.json() as { id: string }[]) : []).map((r) => r.id)
    );
    const newItems = items.filter((it) => !existIds.has(it.id));

    // Batch insert
    let added = 0;
    for (let i = 0; i < newItems.length; i += 200) {
      const chunk = newItems.slice(i, i + 200);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/menu_items`, {
        method: "POST",
        headers: { ...dbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) throw new Error("Insert failed (batch " + (Math.floor(i / 200) + 1) + "): " + await res.text());
      added += chunk.length;
    }

    // Mark request as added
    if (requestId) {
      await fetch(`${SUPABASE_URL}/rest/v1/data_requests?id=eq.${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        headers: { ...dbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ status: "added" }),
      });
    }

    // Upload log
    await fetch(`${SUPABASE_URL}/rest/v1/upload_log`, {
      method: "POST",
      headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        uploader_email: email,
        item_count: added,
        chain_count: 1,
        chains: chainRow.name,
        filename: `agent-fetch:${chainName}`,
      }),
    });

    return jsonResp(
      { success: true, chainName: chainRow.name, chainId, itemsAdded: added, itemsSkipped: items.length - newItems.length },
      200, cors
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("fetch-chain-data error:", msg);
    return jsonResp({ error: msg }, 500, cors);
  }
});
