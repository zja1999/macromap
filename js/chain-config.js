/* Macro Map — per-chain interaction config.
 *
 * interaction_type values:
 *   'standard'      — plain Add button, qty=1 (default)
 *   'plate_builder' — guided plate wizard
 *
 * Items with serving_label set in the DB get a quantity stepper
 * automatically in itemCard(), regardless of chain type.
 *
 * JS config here provides fallback defaults only.
 * DB values (interaction_type, plate_sizes, plate_config) always win.
 *
 * To add a new plate-builder chain — no code change needed:
 *   UPDATE public.chains SET
 *     interaction_type = 'plate_builder',
 *     plate_sizes = '[{"id":"bowl","label":"Bowl","entrees":1,"sides":1}]'::jsonb,
 *     plate_config = '{"category_roles":{"entree":["Proteins"],"side":["Rice","Beans"]}}'::jsonb
 *   WHERE id = 'your_chain_id';
 */
window.MM = window.MM || {};

window.MM.CHAIN_CONFIG = {
  // Pizza and wing chains use per-item serving_label for stepper UX
  dominos:          { qty_label: 'slice', default_qty: 2, max_qty: 8 },
  'pizza-hut':      { qty_label: 'slice', default_qty: 2, max_qty: 8 },
  'papa-johns':     { qty_label: 'slice', default_qty: 2, max_qty: 8 },
  'little-caesars': { qty_label: 'slice', default_qty: 2, max_qty: 8 },
  buffalo_wild_wings: { qty_label: 'wing', default_qty: 6, max_qty: 30 }
};

/* Returns a merged config object safe to use from any view function.
 * chain param is the runtime chain object from MM.NUTRITION.
 *
 * Merge priority (highest wins):
 *   DB plate_config.category_roles > DB plate_sizes > DB interaction_type
 *   > JS CHAIN_CONFIG defaults
 */
window.MM.getChainConfig = function (chain) {
  var base = window.MM.CHAIN_CONFIG[chain.id] || {};
  var r = Object.assign(
    { interaction_type: 'standard', default_qty: 1, max_qty: 10, qty_label: 'serving' },
    base
  );
  if (chain.interaction_type) r.interaction_type = chain.interaction_type;
  if (chain.plate_sizes && chain.plate_sizes.length) r.plate_sizes = chain.plate_sizes;
  if (chain.plate_config) {
    if (chain.plate_config.category_roles) r.category_roles = chain.plate_config.category_roles;
  }
  return r;
};
