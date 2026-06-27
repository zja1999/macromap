/**
 * Macro Map — fetch-chain-data edge function
 *
 * Called by the admin UI when an open chain request should be auto-populated.
 * Uses Claude to compile nutritional data for the requested chain, validates it,
 * upserts to chains + menu_items, updates the request status, and logs the upload.
 *
 * Required Supabase secret (set in Dashboard → Edge Functions → Secrets):
 *   ANTHROPIC_API_KEY — your Anthropic API key
 */

import Anthropic from "npm:@anthropic-ai/sdk@0.35.0";

const ADMIN_EMAILS = new Set(["zja1999@gmail.com", "rannyalex15@gmail.com"]);

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

// ---------------------------------------------------------------------------
// Claude tool definition — structured output for one chain's nutrition data

const SUBMIT_TOOL: Anthropic.Tool = {
  name: "submit_nutrition_data",
  description: "Submit the compiled US nutrition data for the restaurant chain.",
  input_schema: {
    type: "object" as const,
    required: ["chain_id", "chain_name", "chain_color", "match", "items"],
    properties: {
      chain_id: {
        type: "string" as const,
        description: "Lowercase slug, underscores only. e.g. 'mcdonalds', 'taco_bell', 'chick_fil_a'",
      },
      chain_name: {
        type: "string" as const,
        description: "Exact brand display name, e.g. \"McDonald's\", \"Taco Bell\", \"Chick-fil-A\"",
      },
      chain_color: {
        type: "string" as const,
        description: "Brand primary hex color, e.g. '#DA291C'. Must be valid CSS hex.",
      },
      match: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "Lowercase name aliases used in OpenStreetMap, e.g. [\"mcdonald's\", \"mcdonalds\"]",
      },
      items: {
        type: "array" as const,
        description: "Menu items with complete nutritional data. Include 30–80 major items.",
        items: {
          type: "object" as const,
          required: ["name", "kcal", "protein", "carbs", "fat", "sodium"],
          properties: {
            name:     { type: "string" as const, description: "Exact menu item name" },
            category: { type: "string" as const, description: "Category, e.g. Burgers, Salads, Sides, Drinks, Breakfast, Sandwiches, Desserts" },
            kcal:     { type: "number" as const, description: "Total calories (integer)" },
            protein:  { type: "number" as const, description: "Protein grams" },
            carbs:    { type: "number" as const, description: "Total carbohydrate grams" },
            fat:      { type: "number" as const, description: "Total fat grams" },
            sodium:   { type: "number" as const, description: "Sodium milligrams" },
            fiber:    { type: "number" as const, description: "Dietary fiber grams (0 if not listed)" },
            sugar:    { type: "number" as const, description: "Total sugar grams (0 if not listed)" },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// main handler

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  // --- auth: verify caller is a known admin
  const rawToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { email } = decodeJwt(rawToken);
  if (!email || !ADMIN_EMAILS.has(email.toLowerCase().trim())) {
    return json({ error: "Admin access required" }, 403, cors);
  }

  // --- parse body
  let body: { chainName?: string; requestId?: string };
  try { body = await req.json(); } catch { body = {}; }
  const chainName = (body.chainName ?? "").trim();
  const requestId = (body.requestId ?? "").trim();
  if (!chainName) return json({ error: "chainName is required" }, 400, cors);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY secret is not set — add it in Supabase Dashboard → Edge Functions → Secrets." }, 500, cors);

  const dbHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // --- call Claude
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

    const agentResponse = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: `You are a nutrition database compiler for Macro Map, a US restaurant macro-tracking app.

Compile complete, accurate US nutritional data for "${chainName}" and call submit_nutrition_data.

Data standards:
- Use standard US menu serving sizes (not "for sharing" or custom sizes)
- Include 30–80 items covering all major menu categories
- Only include items with FULL data: kcal, protein, carbs, fat, sodium are required
- fiber and sugar: include if known, otherwise 0
- kcal: integer, realistic range 50–3000 for a single item
- sodium: milligrams, typical range 50–4000 mg
- protein, carbs, fat: grams with up to one decimal
- chain_id: lowercase letters and underscores only, no hyphens (e.g. "chick_fil_a" not "chick-fil-a")
- chain_color: the brand's recognized primary color as a hex code
- match: lowercase variants of the name as they appear on OpenStreetMap

Accuracy matters — this data is shown to users tracking their nutrition.`,
      tools: [SUBMIT_TOOL],
      tool_choice: { type: "any" },
      messages: [
        {
          role: "user",
          content: `Compile and submit US nutritional data for the restaurant chain: "${chainName}"`,
        },
      ],
    });

    // --- extract structured data from tool call
    const toolCall = agentResponse.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_nutrition_data"
    );
    if (!toolCall) {
      throw new Error(`Agent could not compile data for "${chainName}". Try the manual CSV upload instead.`);
    }

    const data = toolCall.input as {
      chain_id: string;
      chain_name: string;
      chain_color: string;
      match: string[];
      items: Record<string, unknown>[];
    };

    // --- validate chain fields
    const chainId = String(data.chain_id ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!chainId) throw new Error("Agent returned an invalid chain_id.");

    const chainColor = /^#[0-9a-fA-F]{3,6}$/.test(String(data.chain_color ?? ""))
      ? String(data.chain_color)
      : "#6b7280";

    const matchAliases = (Array.isArray(data.match) ? data.match : [])
      .map((a) => String(a).toLowerCase().trim())
      .filter(Boolean);
    if (!matchAliases.length) matchAliases.push(chainName.toLowerCase());

    // --- validate and clean items
    const NUMERICS = ["kcal", "protein", "carbs", "fat", "sodium", "fiber", "sugar"] as const;
    const seenIds = new Set<string>();

    const items = (Array.isArray(data.items) ? data.items : []).flatMap((it) => {
      const name = String(it.name ?? "").trim();
      if (!name) return [];
      const kcal = Number(it.kcal);
      if (!kcal || kcal <= 0 || kcal > 5000) return []; // sanity-check calories
      const id = `${chainId}:${slugify(name)}`;
      if (seenIds.has(id)) return []; // skip exact duplicates
      seenIds.add(id);

      const nums: Record<string, number> = {};
      for (const col of NUMERICS) {
        const v = Number(it[col]);
        nums[col] = isNaN(v) || v < 0 ? 0 : Math.round(v * 10) / 10;
      }
      return [{ id, chain_id: chainId, name, category: String(it.category ?? "").trim() || null, ...nums }];
    });

    if (!items.length) throw new Error("No valid menu items were returned by the agent.");

    // --- upsert chain row
    const chainRow = {
      id: chainId,
      name: String(data.chain_name ?? chainName).trim(),
      color: chainColor,
      match: matchAliases,
    };
    const chainRes = await fetch(`${SUPABASE_URL}/rest/v1/chains?on_conflict=id`, {
      method: "POST",
      headers: { ...dbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([chainRow]),
    });
    if (!chainRes.ok) throw new Error("Failed to save chain: " + await chainRes.text());

    // --- skip items that already exist (don't error, just skip)
    const existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/menu_items?select=id&chain_id=eq.${encodeURIComponent(chainId)}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const existIds = new Set<string>(
      (existRes.ok ? (await existRes.json() as { id: string }[]) : []).map((r) => r.id)
    );
    const newItems = items.filter((it) => !existIds.has(it.id));

    // --- batch insert new items
    let added = 0;
    for (let i = 0; i < newItems.length; i += 200) {
      const chunk = newItems.slice(i, i + 200);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/menu_items`, {
        method: "POST",
        headers: { ...dbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) throw new Error("Failed to insert items (batch " + Math.ceil(i / 200 + 1) + "): " + await res.text());
      added += chunk.length;
    }

    // --- mark request as added
    if (requestId) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/data_requests?id=eq.${encodeURIComponent(requestId)}`,
        {
          method: "PATCH",
          headers: { ...dbHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ status: "added" }),
        }
      );
    }

    // --- write to upload_log
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

    return json(
      { success: true, chainName: chainRow.name, chainId, itemsAdded: added, itemsSkipped: items.length - newItems.length },
      200,
      cors
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("fetch-chain-data error:", msg);
    return json({ error: msg }, 500, cors);
  }
});

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
