# Menu data format

This folder holds the nutrition data files for Macro Map. To add data, fill out a
spreadsheet matching [`menu_template.csv`](menu_template.csv) — **one row per menu
item** — and upload it from the in-app **Admin → Upload nutrition data** card
(admins only). You can also import locally with `scripts/import_data.py`.

The file may be `.csv`, `.xlsx`, or `.xls`. The header row must match the column
names below exactly (order doesn't matter).

## Columns

| Column        | Required? | What it is | Example |
|---------------|-----------|------------|---------|
| `chain_id`    | **Required** | Stable slug for the chain — lowercase letters/numbers/underscores. Used as the chain's database key, so keep it consistent across rows and uploads. | `mcdonalds` |
| `chain_name`  | **Required** | Display name of the chain. | `McDonald's` |
| `name`        | **Required** | Menu item name. | `Quarter Pounder w/ Cheese` |
| `kcal`        | **Required** | Calories. Number. | `520` |
| `protein`     | **Required** | Protein (g). Number. | `30` |
| `carbs`       | **Required** | Carbohydrates (g). Number. | `42` |
| `fat`         | **Required** | Fat (g). Number. | `26` |
| `sodium`      | **Required** | Sodium (mg). Number. | `1140` |
| `fiber`       | **Required** | Fiber (g). Number. | `3` |
| `sugar`       | **Required** | Sugar (g). Number. | `10` |
| `chain_color` | Optional | Brand color (hex) for the chain's map pins and list dot. Blank → default green. | `#DA291C` |
| `match`       | Optional | Pipe-separated OpenStreetMap brand aliases (lowercase) used to match real-world locations on the map. Blank → defaults to the chain name. | `mcdonald's\|mcdonalds\|mc donald's` |
| `category`    | Optional | Menu section, for grouping/search. | `Burgers` |

Optional columns can be left blank or omitted entirely — uploads still succeed.

## Rules the uploader enforces

- **Every required column must be present** (by header name), or the upload is rejected.
- **Numeric columns must be numbers.** Blank numeric cells are treated as `0`.
- **No duplicate items.** An item is identified by `chain_id` + a slug of `name`.
  If the same item appears twice in the file, or already exists in the database,
  the upload is rejected and **nothing is added** — fix the file and re-upload.
  (To change an existing item, delete it first, then re-upload.)

## Tips

- Repeat the chain columns (`chain_id`, `chain_name`, `chain_color`, `match`) on
  every row for that chain — the importer reads them from the first row it sees
  for each `chain_id`.
- Keep `chain_id` identical across uploads so new items attach to the existing
  chain instead of creating a duplicate.
