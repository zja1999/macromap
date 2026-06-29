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

/* Map raw DB category strings to display groups used in filters.
 * Shared between recommend.js (pre-filter in rank()) and app.js (filter UI). */
var _CATEGORY_GROUPS = {
  "Breakfast": ["Breakfast", "Bagels"],
  "Entrees":   ["Entrees", "Burgers", "Chicken", "Chicken Breast", "Chicken Dippers",
                "Sandwiches", "Wraps", "Wraps & Tacos", "Bap", "Ciabatta", "Focaccia",
                "Toasties/ Croques", "Beef", "Seafood", "Wings", "Wings - Per Wing"],
  "Salads":    ["Salads"],
  "Sides":     ["Sides", "Beans", "Greens", "Rice", "Salsas", "Tortillas", "Vegetables"],
  "Soups":     ["Soup", "Soups"],
  "Snacks":    ["Appetizers", "Grab N Go", "Impulse Items", "Value",
                "Add-ons", "Modifiers", "Toppings", "Breads"],
  "Desserts":  ["Desserts", "Desserts & Snacks", "Cookies", "Sweets",
                "Loaf Cakes", "Muffins & Donuts", "Bar cakes", "Bakery", "Treats"],
  "Drinks":    ["Beverages", "Drinks", "Cold Coffee", "Espresso Drinks", "Frappuccino",
                "Hot Chocolates", "Hot Teas", "Tea Latte", "Protein Beverages",
                "Refreshments", "Promo Beverages", "Promo Beverages Alt Coffees",
                "Bottled Beverages", "Blonde and Decaf Cold Coffee",
                "Blonde and Decaf Espresso Drinks", "Blonde and Decaf Frappuccino"]
};
var _catGroupReverse = null;
function _buildCatGroupReverse() {
  if (_catGroupReverse) return _catGroupReverse;
  _catGroupReverse = {};
  Object.keys(_CATEGORY_GROUPS).forEach(function (g) {
    _CATEGORY_GROUPS[g].forEach(function (c) { _catGroupReverse[c] = g; });
  });
  return _catGroupReverse;
}
window.MM.getCategoryGroup = function (rawCat) {
  return _buildCatGroupReverse()[rawCat] || "Other";
};

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

/* Flatten every item with a reference to its chain — handy for search & ranking.
 * Result is cached; call invalidateItemsCache() when NUTRITION is replaced. */
var _allItemsCache = null;
window.MM.allItems = function () {
  if (_allItemsCache) return _allItemsCache;
  var out = [];
  window.MM.NUTRITION.forEach(function (chain) {
    chain.items.forEach(function (item) {
      out.push(Object.assign({ chainId: chain.id, chainName: chain.name, chainColor: chain.color }, item));
    });
  });
  return (_allItemsCache = out);
};
window.MM.invalidateItemsCache = function () { _allItemsCache = null; };
