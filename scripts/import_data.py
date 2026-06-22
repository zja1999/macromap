#!/usr/bin/env python3
"""Macro Map — CSV -> Supabase importer.

Reads a flat menu CSV (one row per item, chain columns repeated) and UPSERTS it
into the public `chains` and `menu_items` tables. Re-running updates existing
rows instead of duplicating them, so this is safe to run as often as you like.

Standard library only — no `pip install` required.

Usage:
    python scripts/import_data.py                     # imports data/menu_data.csv
    python scripts/import_data.py path/to/other.csv   # imports a different file
    python scripts/import_data.py --dry-run           # validate only, no upload

Credentials (never commit these) are read from a local .env file in the project
root or from environment variables:
    SUPABASE_URL=https://YOUR-PROJECT.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=eyJ...   <-- the SECRET service_role key, admin only

Get the service_role key from Supabase → Project Settings → API Keys →
"service_role" (secret). It bypasses Row-Level Security, so keep it local.
"""
import csv
import json
import os
import re
import sys
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CSV = os.path.join(ROOT, "data", "menu_data.csv")
REQUIRED_COLS = ["chain_id", "chain_name", "name",
                 "kcal", "protein", "carbs", "fat", "sodium", "fiber", "sugar"]
NUMERIC_COLS = ["kcal", "protein", "carbs", "fat", "sodium", "fiber", "sugar"]


def load_env():
    """Read .env (KEY=VALUE lines) into os.environ if present, then return creds."""
    env_path = os.path.join(ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return url, key


def slug(text):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "item"


def parse_csv(path):
    """Return (chains_by_id, items, errors)."""
    chains, items, errors = {}, [], []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        missing = [c for c in REQUIRED_COLS if c not in (reader.fieldnames or [])]
        if missing:
            errors.append("CSV is missing required columns: " + ", ".join(missing))
            return chains, items, errors

        for i, row in enumerate(reader, start=2):  # line 1 is the header
            cid = (row.get("chain_id") or "").strip()
            name = (row.get("name") or "").strip()
            if not cid or not name:
                errors.append(f"line {i}: chain_id and name are required")
                continue

            nums = {}
            for col in NUMERIC_COLS:
                raw = (row.get(col) or "").strip()
                try:
                    nums[col] = float(raw) if ("." in raw) else int(raw or 0)
                except ValueError:
                    errors.append(f"line {i} ({name}): '{col}' is not a number: {raw!r}")
                    nums[col] = 0

            if cid not in chains:
                aliases = [a.strip().lower() for a in (row.get("match") or "").split("|") if a.strip()]
                if not aliases:
                    aliases = [name.lower()]
                chains[cid] = {
                    "id": cid,
                    "name": (row.get("chain_name") or cid).strip(),
                    "color": (row.get("chain_color") or "").strip() or None,
                    "match": aliases,
                }

            items.append({
                "id": f"{cid}:{slug(name)}",
                "chain_id": cid,
                "name": name,
                "category": (row.get("category") or "").strip() or None,
                **nums,
            })
    return chains, items, errors


def upsert(url, key, table, rows):
    """UPSERT a list of dict rows into a table via PostgREST. Raises on HTTP error."""
    if not rows:
        return
    endpoint = f"{url}/rest/v1/{table}?on_conflict=id"
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(endpoint, data=body, method="POST", headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    try:
        with urllib.request.urlopen(req) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise SystemExit(f"\nSupabase rejected the {table} upsert (HTTP {e.code}):\n{detail}\n")
    except urllib.error.URLError as e:
        raise SystemExit(f"\nCould not reach Supabase ({e.reason}). Check SUPABASE_URL / your connection.\n")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv
    csv_path = args[0] if args else DEFAULT_CSV

    if not os.path.exists(csv_path):
        raise SystemExit(f"CSV not found: {csv_path}")

    chains, items, errors = parse_csv(csv_path)
    if errors:
        print("Found {} problem(s) in the CSV:".format(len(errors)))
        for e in errors:
            print("  -", e)
        if any("missing required" in e for e in errors):
            raise SystemExit(1)
        print()

    print(f"Parsed {len(items)} items across {len(chains)} chains from {os.path.relpath(csv_path, ROOT)}")

    if dry_run:
        print("Dry run - nothing uploaded. Looks good.")
        return

    url, key = load_env()
    if not url or not key:
        raise SystemExit(
            "Missing credentials. Create a .env file in the project root with:\n"
            "  SUPABASE_URL=https://YOUR-PROJECT.supabase.co\n"
            "  SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret-key\n"
        )

    print("Uploading chains...")
    upsert(url, key, "chains", list(chains.values()))
    print("Uploading menu items...")
    # send in batches to keep requests modest
    BATCH = 200
    for start in range(0, len(items), BATCH):
        upsert(url, key, "menu_items", items[start:start + BATCH])

    print(f"\nDone - {len(chains)} chains and {len(items)} items are live in Supabase.")
    print("Reload the app (or wait for its next refresh) to see them.")


if __name__ == "__main__":
    main()
