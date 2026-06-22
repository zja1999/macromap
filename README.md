# Macro Map

**Eat well, wherever you are.** Macro Map is a location-aware nutrition app that answers one practical question:

> *Based on my body, goals, and location — what can I eat nearby that fits my macros?*

It combines three things into one workflow: **personal macro planning**, **location-based restaurant discovery**, and **menu-item decision support**.

---

## Features

| Tab | What it does |
|-----|--------------|
| **Profile** | Enter age, sex, height, weight, activity, goal, rate & fitness focus → get recommended daily calories + macros (Mifflin–St Jeor → TDEE → goal-adjusted). Manually tweak and save. Persists across sessions. |
| **Discover** | Use your location or search any city/address. A map shows nearby fast-food & restaurants, flagging which chains have macro data. |
| **Menus** | Browse any chain's menu. Filter, search, sort by protein-per-calorie, flag high-protein / lower-cal items, compare side-by-side, add to your log. |
| **For You** | Personalized picks ranked by how well they fit your *remaining* macros today. One-tap presets ("best high-protein under 700 cal") plus custom filters. |
| **Tracker** | Daily food log with a calorie ring, macro bars, remaining totals, sodium/fiber/sugar, quick-add, frequents, saved meals, and day history. |
| **Add Data** | Request chains that don't yet have macro data — nearby chains without data become one-tap requests. |

Everything you enter (profile, targets, food logs, history, saved meals, requests) is stored in your browser's `localStorage`, so it's all there when you come back.

## Tech

Zero build step — plain HTML / CSS / vanilla JavaScript. All external services are **free and require no API key**:

- **Map tiles & data:** [OpenStreetMap](https://www.openstreetmap.org)
- **Nearby restaurants:** [Overpass API](https://overpass-api.de)
- **Address search:** [Nominatim](https://nominatim.openstreetmap.org)
- **Map rendering:** [Leaflet](https://leafletjs.com) (via CDN)
- **Nutrition data:** a curated, bundled database in [`js/nutrition-data.js`](js/nutrition-data.js)

## Run it

The app needs to be served over HTTP (browser geolocation and the map APIs require it — opening the file directly won't work). Python is all you need:

```bash
cd "Macro Map"
python -m http.server 8000
```

Then open <http://localhost:8000> in your browser. `localhost` counts as a secure context, so "Use my location" works.

> If geolocation is blocked, just type a city or address into the search box on the **Discover** tab.

## Accounts & cloud sync (optional)

Out of the box, Macro Map is **local-only** — everything is saved in your browser and the topbar shows a `💾 Local` chip. To add sign-in and cross-device sync, connect a free [Supabase](https://supabase.com) project:

1. Create a project at [supabase.com](https://supabase.com) (free tier is plenty).
2. In the dashboard: **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and **Run**. This creates the per-user `app_state` table with Row-Level Security.
3. In **Project Settings → API**, copy your **Project URL** and **anon public** key.
4. Paste both into [`js/config.js`](js/config.js):
   ```js
   window.MM.CONFIG = {
     supabaseUrl: "https://YOUR-PROJECT.supabase.co",
     supabaseAnonKey: "eyJhbGci...your-anon-key..."
   };
   ```
5. Reload. The topbar now shows **Sign in**; create an account and your data syncs automatically.

### Google sign-in (optional)

The auth screen has a **Continue with Google** button. To make it work, enable the provider:

1. In **Google Cloud Console** → APIs & Services → Credentials → create an **OAuth 2.0 Client ID** (type: Web application). Under **Authorized redirect URIs** add your Supabase callback:
   `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
2. Copy the **Client ID** and **Client secret**.
3. In Supabase → **Authentication → Sign In / Providers → Google** → enable it and paste the Client ID + secret → Save.
4. In Supabase → **Authentication → URL Configuration**, add your app's URL (e.g. `http://localhost:8000` for local, and your deployed URL) to **Redirect URLs**.

Until the provider is enabled, the button shows a friendly error instead of breaking. Email/password works regardless.

Notes:
- The anon key is **meant to be public** — it's safe in client code. Security comes from Row-Level Security (each user can only read/write their own row), not from hiding the key.
- For frictionless testing, you can turn off **Authentication → Sign In / Providers → Confirm email** in Supabase so new accounts work instantly. With it on, new users get a confirmation email first.
- Sync is **last-write-wins per device** on a single JSON blob — ideal for one person across phone + laptop. Real-time multi-device merge is a future enhancement.

## Nutrition database (CSV → Supabase)

The menu database is shared by all users and lives in Supabase (`chains` + `menu_items`). The app loads it at runtime and caches it, **falling back to the bundled list in [`js/nutrition-data.js`](js/nutrition-data.js)** if Supabase is unconfigured or unreachable — so it never breaks. You grow the database by editing a CSV and running one import command.

**One-time setup:**
1. Supabase → SQL Editor → run [`supabase/data-schema.sql`](supabase/data-schema.sql) (creates `chains`, `menu_items`, `data_requests` with the right security).
2. Copy [`.env.example`](.env.example) to `.env` and paste your **service_role** key (Supabase → Project Settings → API Keys → `service_role`). `.env` is git-ignored — never commit it.

**Import / update data:**
```bash
python scripts/import_data.py --dry-run     # validate the CSV, upload nothing
python scripts/import_data.py               # upsert data/menu_data.csv into Supabase
```
It **upserts**, so re-running updates existing rows instead of duplicating. No `pip install` needed (standard library only).

**Editing the data:** open [`data/menu_data.csv`](data/menu_data.csv) in Excel/Google Sheets. One row per menu item; columns:

| Column | Meaning |
|---|---|
| `chain_id` | unique slug, e.g. `wendys` (repeat on every row for that chain) |
| `chain_name`, `chain_color` | display name and brand hex color |
| `match` | OSM brand aliases that link map pins to this chain, separated by `\|` |
| `name`, `category` | item name and grouping |
| `kcal`, `protein`, `carbs`, `fat`, `sodium`, `fiber`, `sugar` | numbers |

Add a chain by adding its rows; add items by adding rows with an existing `chain_id`. *(No-script alternative: Supabase Table Editor → Import data from CSV, though you'd split it into separate `chains`/`menu_items` files.)*

### Where chain requests go

When a user taps **Request** (Discover) or submits the **Add Data** form, the request is saved to their own list **and** inserted into the central **`data_requests`** table. Review them in Supabase → **Table Editor → data_requests**; flip `status` from `open` to `added`/`declined` as you work through them.

## Deploy (static hosting)

Because it's just static files, you can host it free on any static host — no server needed:

- **GitHub Pages:** push this folder to a repo → Settings → Pages → deploy from branch. Done.
- **Netlify / Cloudflare Pages / Vercel:** "Add new site" → point at the repo (build command: *none*, publish dir: project root) or drag-and-drop the folder.

Add your Supabase config (above) before deploying if you want accounts live. If you host on Pages/Netlify, also add your deployed URL to Supabase **Authentication → URL Configuration → Redirect URLs**.

## Project layout

```
Macro Map/
├── index.html              # app shell, loads scripts in dependency order
├── css/styles.css          # full design system (light + dark)
├── data/menu_data.csv      # editable seed/template for the nutrition database
├── scripts/import_data.py  # CSV -> Supabase upsert importer (stdlib only)
├── .env.example            # template for the import script's service-role key
├── supabase/
│   ├── schema.sql          # cloud-accounts table (app_state)
│   └── data-schema.sql     # shared nutrition DB + data_requests tables
└── js/
    ├── config.js           # Supabase URL + anon key (blank = local-only)
    ├── nutrition-data.js   # bundled fallback database + lookup helpers
    ├── data-source.js      # loads shared DB from Supabase; routes requests
    ├── storage.js          # localStorage store + change/sync hooks
    ├── macros.js           # BMR / TDEE / macro-target math
    ├── recommend.js        # item scoring & ranking engine
    ├── map.js              # Leaflet + geolocation + Overpass + Nominatim
    ├── ui.js               # shared DOM / formatting helpers
    ├── auth.js             # Supabase accounts + cloud sync engine
    └── app.js              # controller + all six views + account UI
```

## Notes & limitations

- Nutrition figures are **approximate** and meant for guidance, not clinical precision.
- Coverage is limited to the bundled chains; everything else shows as "no data yet" with a request option. Adding a chain is just a new entry in `js/nutrition-data.js`.
- Without Supabase configured, data is per-browser (localStorage). With it configured, data syncs to your account across devices (last-write-wins).
