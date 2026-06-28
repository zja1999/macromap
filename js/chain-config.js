/* Macro Map — per-chain interaction config.
 *
 * interaction_type values:
 *   'standard'      — plain Add button, qty=1 (default)
 *   'plate_builder' — guided plate wizard (Panda Express)
 *
 * Items with serving_label set in the DB get a quantity stepper
 * automatically in itemCard(), regardless of chain type.
 *
 * JS config here is the default; DB values (chains.interaction_type,
 * chains.plate_sizes) override at runtime via getChainConfig().
 */
window.MM = window.MM || {};

window.MM.CHAIN_CONFIG = {
  panda_express: {
    interaction_type: 'plate_builder',
    plate_sizes: [
      { id: 'bowl',         label: 'Bowl',         entrees: 1, sides: 1 },
      { id: 'plate',        label: 'Plate',        entrees: 2, sides: 1 },
      { id: 'bigger_plate', label: 'Bigger Plate', entrees: 3, sides: 1 }
    ],
    // Maps DB category values to plate slot roles
    category_roles: {
      entree: ['Chicken', 'Beef', 'Chicken Breast', 'Seafood', 'Vegetables'],
      side:   ['Sides']
    }
  },
  // Pizza and wing chains use per-item serving_label for stepper UX
  dominos:          { qty_label: 'slice',  default_qty: 2, max_qty: 8 },
  'pizza-hut':      { qty_label: 'slice',  default_qty: 2, max_qty: 8 },
  'papa-johns':     { qty_label: 'slice',  default_qty: 2, max_qty: 8 },
  'little-caesars': { qty_label: 'slice',  default_qty: 2, max_qty: 8 },
  buffalo_wild_wings: { qty_label: 'wing', default_qty: 6, max_qty: 30 }
};

/* Returns a merged config object safe to use from any view function.
 * chain param is the runtime chain object from MM.NUTRITION. */
window.MM.getChainConfig = function (chain) {
  var base = window.MM.CHAIN_CONFIG[chain.id] || {};
  var r = Object.assign(
    { interaction_type: 'standard', default_qty: 1, max_qty: 10, qty_label: 'serving' },
    base
  );
  // DB values win over JS defaults
  if (chain.interaction_type) r.interaction_type = chain.interaction_type;
  if (chain.plate_sizes && chain.plate_sizes.length) r.plate_sizes = chain.plate_sizes;
  return r;
};
