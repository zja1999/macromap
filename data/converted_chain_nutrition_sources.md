# Converted chain nutrition sources

Generated for `data/converted_chain_nutrition.csv`.

## Schema

The CSV follows `data/menu_template.csv` exactly:

```csv
chain_id,chain_name,chain_color,match,name,category,kcal,protein,carbs,fat,sodium,fiber,sugar
```

## Sources used

- In-N-Out Burger nutrition page: https://www.in-n-out.com/menu/nutrition-info
- Chick-fil-A nutrition and allergens page: https://www.chick-fil-a.com/nutrition-allergens
- Wendy's UK core menu PDF: https://www.wendys.com/sites/default/files/2025-02/Core%20Menu.pdf
- Raising Cane's allergen and nutrition page: https://www.raisingcanes.com/allergens/

## Notes

- Wendy's UK publishes `salt (g)` instead of `sodium (mg)`. For Macro Map's required `sodium` column, sodium was estimated as `salt_g * 393.4` and rounded to the nearest mg.
- Wendy's UK is kept under `chain_id=wendys_uk` to avoid colliding with existing U.S. Wendy's rows.
- The file is intended as an import/bulk-review file. Some chain/item names may already exist in `data/menu_data.csv` or in Supabase, so remove duplicates before uploading if the importer rejects them.
