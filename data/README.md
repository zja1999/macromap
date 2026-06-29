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
| `chain_color`   | Optional | Brand color (hex) for the chain's map pins and list dot. Blank → default green. | `#DA291C` |
| `match`         | Optional | Pipe-separated OpenStreetMap brand aliases (lowercase) used to match real-world locations on the map. Blank → defaults to the chain name. | `mcdonald's\|mcdonalds\|mc donald's` |
| `category`      | Optional | Raw menu section name from the restaurant's own menu (e.g. the heading it appears under on their website). Used by the plate builder to split entrees from sides. If `category_group` is blank, the importer will try to map this to a standard group automatically. | `Burgers` |
| `category_group`| Optional | The filter group this item appears under in the Browse tab. Must be exactly one of: `Breakfast`, `Entrees`, `Salads`, `Sides`, `Soups`, `Snacks`, `Desserts`, `Drinks`. Leave blank for items that don't make sense to filter on (toppings, condiments, add-ons, etc.) — those items simply won't appear in the category dropdown. If blank but `category` is set, the importer attempts to map it automatically; unknown `category` values result in no group. | `Entrees` |
| `serving_label` | Optional | Unit name for one serving of this item. When set, the item gets a quantity stepper instead of a plain Add button. Use `slice` for pizza-by-slice items, `wing` for per-wing items, etc. | `wing` |
| `default_qty`   | Optional | Starting quantity shown in the stepper. Integer. Blank → 1. | `6` |
| `max_qty`       | Optional | Maximum quantity the stepper allows. Integer. Blank → 10. | `30` |

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
