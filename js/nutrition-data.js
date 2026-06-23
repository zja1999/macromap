/* Macro Map — nutrition database (populated at runtime from Supabase).
 *
 * The data array starts empty. window.MM.data.loadNutrition() fetches chains
 * and menu_items from Supabase on every session and fills this in. If the load
 * fails the app shows an error rather than stale bundled data.
 *
 * The helper functions below iterate window.MM.NUTRITION and work correctly
 * whether it holds 0 or 10,000 items.
 */
window.MM = window.MM || {};

window.MM.NUTRITION = [];

/* Return a single chain object by its id string, or null. */
window.MM.getChainById = function (id) {
  return window.MM.NUTRITION.find(function (c) { return c.id === id; }) || null;
};

/* Match an OSM brand/name string to a chain in our database. */
window.MM.matchChain = function (rawName) {
  if (!rawName) return null;
  var n = String(rawName).toLowerCase().trim();
  for (var i = 0; i < window.MM.NUTRITION.length; i++) {
    var chain = window.MM.NUTRITION[i];
    for (var j = 0; j < chain.match.length; j++) {
      if (n.indexOf(chain.match[j]) !== -1) return chain;
    }
  }
  return null;
};

/* Flatten every item with a reference to its chain — handy for search & ranking. */
window.MM.allItems = function () {
  var out = [];
  window.MM.NUTRITION.forEach(function (chain) {
    chain.items.forEach(function (item) {
      out.push(Object.assign({ chainId: chain.id, chainName: chain.name, chainColor: chain.color }, item));
    });
  });
  return out;
};
