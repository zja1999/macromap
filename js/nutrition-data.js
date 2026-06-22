/* Macro Map — curated restaurant nutrition database.
 *
 * Values are approximate, real-world figures for popular menu items, intended
 * for decision support rather than clinical precision. Each chain lists `match`
 * aliases used to link OpenStreetMap brand/name tags to this dataset.
 *
 * Item fields: name, category, kcal, protein, carbs, fat, sodium(mg), fiber, sugar
 */
window.MM = window.MM || {};

window.MM.NUTRITION = [
  {
    id: "mcdonalds",
    name: "McDonald's",
    match: ["mcdonald's", "mcdonalds", "mc donald's"],
    color: "#DA291C",
    items: [
      { name: "Hamburger",                  category: "Burgers",    kcal: 250, protein: 12, carbs: 31, fat: 9,  sodium: 510,  fiber: 1, sugar: 6 },
      { name: "Cheeseburger",               category: "Burgers",    kcal: 300, protein: 15, carbs: 32, fat: 13, sodium: 720,  fiber: 2, sugar: 7 },
      { name: "Double Cheeseburger",        category: "Burgers",    kcal: 450, protein: 25, carbs: 34, fat: 24, sodium: 1050, fiber: 2, sugar: 7 },
      { name: "Quarter Pounder w/ Cheese",  category: "Burgers",    kcal: 520, protein: 30, carbs: 42, fat: 26, sodium: 1140, fiber: 3, sugar: 10 },
      { name: "Big Mac",                    category: "Burgers",    kcal: 590, protein: 25, carbs: 46, fat: 34, sodium: 1050, fiber: 3, sugar: 9 },
      { name: "McChicken",                  category: "Chicken",    kcal: 400, protein: 14, carbs: 39, fat: 21, sodium: 600,  fiber: 2, sugar: 5 },
      { name: "McDouble",                   category: "Burgers",    kcal: 400, protein: 22, carbs: 33, fat: 20, sodium: 920,  fiber: 2, sugar: 7 },
      { name: "Chicken McNuggets (10 pc)",  category: "Chicken",    kcal: 420, protein: 23, carbs: 25, fat: 25, sodium: 840,  fiber: 1, sugar: 0 },
      { name: "Filet-O-Fish",               category: "Sandwiches", kcal: 390, protein: 16, carbs: 39, fat: 19, sodium: 580,  fiber: 2, sugar: 5 },
      { name: "Egg McMuffin",               category: "Breakfast",  kcal: 310, protein: 17, carbs: 30, fat: 13, sodium: 770,  fiber: 2, sugar: 3 },
      { name: "Medium Fries",               category: "Sides",      kcal: 320, protein: 4,  carbs: 43, fat: 15, sodium: 260,  fiber: 4, sugar: 0 },
      { name: "Side Salad",                 category: "Salads",     kcal: 15,  protein: 1,  carbs: 3,  fat: 0,  sodium: 10,   fiber: 1, sugar: 2 },
      { name: "Apple Slices",               category: "Sides",      kcal: 15,  protein: 0,  carbs: 4,  fat: 0,  sodium: 0,    fiber: 0, sugar: 3 }
    ]
  },
  {
    id: "chipotle",
    name: "Chipotle Mexican Grill",
    match: ["chipotle", "chipotle mexican grill"],
    color: "#A81612",
    items: [
      { name: "Chicken Burrito Bowl (rice, beans, salsa)", category: "Bowls",   kcal: 625, protein: 45, carbs: 67, fat: 19, sodium: 1370, fiber: 14, sugar: 5 },
      { name: "Steak Burrito Bowl (rice, beans, salsa)",   category: "Bowls",   kcal: 600, protein: 40, carbs: 66, fat: 18, sodium: 1300, fiber: 14, sugar: 5 },
      { name: "Carnitas Burrito Bowl",                     category: "Bowls",   kcal: 670, protein: 38, carbs: 65, fat: 25, sodium: 1450, fiber: 13, sugar: 5 },
      { name: "Sofritas Bowl (tofu)",                      category: "Bowls",   kcal: 560, protein: 24, carbs: 70, fat: 20, sodium: 1280, fiber: 16, sugar: 6 },
      { name: "Chicken Salad (no dressing)",               category: "Salads",  kcal: 300, protein: 38, carbs: 12, fat: 12, sodium: 800,  fiber: 5,  sugar: 4 },
      { name: "Chicken Burrito (full)",                    category: "Burritos",kcal: 975, protein: 53, carbs: 102,fat: 36, sodium: 2000, fiber: 12, sugar: 6 },
      { name: "Side of Guacamole",                         category: "Sides",   kcal: 230, protein: 2,  carbs: 8,  fat: 22, sodium: 375,  fiber: 6,  sugar: 1 },
      { name: "Chips",                                     category: "Sides",   kcal: 540, protein: 7,  carbs: 73, fat: 25, sodium: 390,  fiber: 7,  sugar: 1 },
      { name: "3 Chicken Tacos (soft)",                    category: "Tacos",   kcal: 510, protein: 39, carbs: 48, fat: 17, sodium: 1140, fiber: 8,  sugar: 3 }
    ]
  },
  {
    id: "subway",
    name: "Subway",
    match: ["subway"],
    color: "#008C15",
    items: [
      { name: "6\" Turkey Breast",            category: "Subs",   kcal: 280, protein: 18, carbs: 40, fat: 4,  sodium: 760,  fiber: 5, sugar: 6 },
      { name: "6\" Oven Roasted Chicken",     category: "Subs",   kcal: 320, protein: 23, carbs: 41, fat: 6,  sodium: 640,  fiber: 5, sugar: 6 },
      { name: "6\" Tuna",                      category: "Subs",   kcal: 480, protein: 20, carbs: 39, fat: 25, sodium: 700,  fiber: 5, sugar: 5 },
      { name: "6\" Steak & Cheese",           category: "Subs",   kcal: 380, protein: 26, carbs: 42, fat: 12, sodium: 920,  fiber: 5, sugar: 7 },
      { name: "6\" Meatball Marinara",        category: "Subs",   kcal: 480, protein: 21, carbs: 58, fat: 18, sodium: 980,  fiber: 7, sugar: 11 },
      { name: "6\" Veggie Delite",            category: "Subs",   kcal: 200, protein: 8,  carbs: 38, fat: 2,  sodium: 280,  fiber: 5, sugar: 6 },
      { name: "Footlong Turkey Breast",       category: "Subs",   kcal: 560, protein: 36, carbs: 80, fat: 8,  sodium: 1520, fiber: 10,sugar: 12 },
      { name: "Rotisserie Chicken Salad",     category: "Salads", kcal: 130, protein: 20, carbs: 9,  fat: 4,  sodium: 460,  fiber: 4, sugar: 5 }
    ]
  },
  {
    id: "chickfila",
    name: "Chick-fil-A",
    match: ["chick-fil-a", "chick fil a", "chickfila"],
    color: "#E51636",
    items: [
      { name: "Chicken Sandwich",             category: "Sandwiches", kcal: 420, protein: 29, carbs: 41, fat: 18, sodium: 1400, fiber: 2, sugar: 6 },
      { name: "Spicy Chicken Sandwich",       category: "Sandwiches", kcal: 450, protein: 28, carbs: 42, fat: 20, sodium: 1640, fiber: 3, sugar: 6 },
      { name: "Grilled Chicken Sandwich",     category: "Sandwiches", kcal: 320, protein: 28, carbs: 41, fat: 6,  sodium: 680,  fiber: 4, sugar: 9 },
      { name: "Nuggets (8 pc)",               category: "Chicken",    kcal: 250, protein: 27, carbs: 11, fat: 11, sodium: 1210, fiber: 0, sugar: 1 },
      { name: "Grilled Nuggets (8 pc)",       category: "Chicken",    kcal: 130, protein: 25, carbs: 3,  fat: 3,  sodium: 530,  fiber: 0, sugar: 1 },
      { name: "Cobb Salad w/ Grilled Chicken",category: "Salads",     kcal: 510, protein: 40, carbs: 28, fat: 27, sodium: 1110, fiber: 5, sugar: 9 },
      { name: "Grilled Chicken Cool Wrap",    category: "Wraps",      kcal: 350, protein: 37, carbs: 29, fat: 13, sodium: 940,  fiber: 14,sugar: 4 },
      { name: "Waffle Fries (medium)",        category: "Sides",      kcal: 420, protein: 5,  carbs: 45, fat: 24, sodium: 240,  fiber: 5, sugar: 0 },
      { name: "Side Salad",                   category: "Salads",     kcal: 160, protein: 5,  carbs: 8,  fat: 11, sodium: 110,  fiber: 3, sugar: 4 }
    ]
  },
  {
    id: "tacobell",
    name: "Taco Bell",
    match: ["taco bell"],
    color: "#702082",
    items: [
      { name: "Crunchy Taco",                 category: "Tacos",    kcal: 170, protein: 8,  carbs: 13, fat: 10, sodium: 300,  fiber: 3, sugar: 1 },
      { name: "Soft Taco (beef)",             category: "Tacos",    kcal: 180, protein: 9,  carbs: 18, fat: 9,  sodium: 490,  fiber: 3, sugar: 1 },
      { name: "Chicken Chalupa Supreme",      category: "Specialty",kcal: 350, protein: 13, carbs: 29, fat: 19, sodium: 580,  fiber: 3, sugar: 3 },
      { name: "Bean Burrito",                 category: "Burritos", kcal: 350, protein: 13, carbs: 54, fat: 9,  sodium: 1000, fiber: 11,sugar: 3 },
      { name: "Beefy 5-Layer Burrito",        category: "Burritos", kcal: 490, protein: 18, carbs: 65, fat: 18, sodium: 1250, fiber: 8, sugar: 5 },
      { name: "Power Menu Bowl - Chicken",    category: "Bowls",    kcal: 470, protein: 26, carbs: 50, fat: 19, sodium: 1200, fiber: 7, sugar: 4 },
      { name: "Crunchwrap Supreme",           category: "Specialty",kcal: 530, protein: 16, carbs: 71, fat: 21, sodium: 1210, fiber: 6, sugar: 6 },
      { name: "Black Beans & Rice",           category: "Sides",    kcal: 170, protein: 5,  carbs: 30, fat: 4,  sodium: 350,  fiber: 6, sugar: 1 }
    ]
  },
  {
    id: "wendys",
    name: "Wendy's",
    match: ["wendy's", "wendys"],
    color: "#E2203D",
    items: [
      { name: "Jr. Cheeseburger",             category: "Burgers",    kcal: 290, protein: 15, carbs: 26, fat: 14, sodium: 690,  fiber: 1, sugar: 6 },
      { name: "Dave's Single",                category: "Burgers",    kcal: 590, protein: 30, carbs: 39, fat: 34, sodium: 1140, fiber: 2, sugar: 9 },
      { name: "Baconator",                    category: "Burgers",    kcal: 950, protein: 59, carbs: 39, fat: 62, sodium: 1810, fiber: 2, sugar: 9 },
      { name: "Grilled Chicken Sandwich",     category: "Chicken",    kcal: 360, protein: 34, carbs: 38, fat: 9,  sodium: 900,  fiber: 2, sugar: 9 },
      { name: "Spicy Chicken Sandwich",       category: "Chicken",    kcal: 500, protein: 30, carbs: 50, fat: 21, sodium: 1140, fiber: 3, sugar: 8 },
      { name: "Chili (small)",                category: "Sides",      kcal: 240, protein: 17, carbs: 23, fat: 8,  sodium: 920,  fiber: 6, sugar: 7 },
      { name: "Apple Pecan Chicken Salad",    category: "Salads",     kcal: 430, protein: 33, carbs: 32, fat: 21, sodium: 850,  fiber: 6, sugar: 23 },
      { name: "Baked Potato (plain)",         category: "Sides",      kcal: 270, protein: 7,  carbs: 61, fat: 0,  sodium: 25,   fiber: 7, sugar: 3 },
      { name: "Medium Fries",                 category: "Sides",      kcal: 420, protein: 5,  carbs: 56, fat: 20, sodium: 470,  fiber: 5, sugar: 0 }
    ]
  },
  {
    id: "starbucks",
    name: "Starbucks",
    match: ["starbucks"],
    color: "#00704A",
    items: [
      { name: "Caffè Latte (Grande, 2%)",     category: "Drinks",     kcal: 190, protein: 13, carbs: 19, fat: 7,  sodium: 170, fiber: 0, sugar: 18 },
      { name: "Caffè Americano (Grande)",     category: "Drinks",     kcal: 15,  protein: 1,  carbs: 3,  fat: 0,  sodium: 10,  fiber: 0, sugar: 0 },
      { name: "Cold Brew (Grande, black)",    category: "Drinks",     kcal: 5,   protein: 0,  carbs: 0,  fat: 0,  sodium: 15,  fiber: 0, sugar: 0 },
      { name: "Egg White & Roasted Pepper Bites", category: "Food",   kcal: 170, protein: 12, carbs: 11, fat: 8,  sodium: 470, fiber: 1, sugar: 2 },
      { name: "Bacon & Gruyère Egg Bites",    category: "Food",       kcal: 300, protein: 19, carbs: 9,  fat: 20, sodium: 680, fiber: 0, sugar: 2 },
      { name: "Turkey Bacon Egg White Sandwich", category: "Food",    kcal: 230, protein: 17, carbs: 28, fat: 5,  sodium: 560, fiber: 3, sugar: 2 },
      { name: "Spinach Feta Wrap",            category: "Food",       kcal: 290, protein: 20, carbs: 34, fat: 10, sodium: 840, fiber: 6, sugar: 5 },
      { name: "Protein Box (Eggs & Cheese)",  category: "Food",       kcal: 470, protein: 23, carbs: 40, fat: 25, sodium: 470, fiber: 5, sugar: 16 }
    ]
  },
  {
    id: "burgerking",
    name: "Burger King",
    match: ["burger king"],
    color: "#D62300",
    items: [
      { name: "Whopper",                      category: "Burgers",    kcal: 660, protein: 28, carbs: 49, fat: 40, sodium: 980,  fiber: 2, sugar: 11 },
      { name: "Whopper Jr.",                  category: "Burgers",    kcal: 310, protein: 13, carbs: 27, fat: 18, sodium: 410,  fiber: 1, sugar: 6 },
      { name: "Cheeseburger",                 category: "Burgers",    kcal: 280, protein: 15, carbs: 27, fat: 13, sodium: 560,  fiber: 1, sugar: 7 },
      { name: "Chicken Jr.",                  category: "Chicken",    kcal: 450, protein: 14, carbs: 37, fat: 28, sodium: 800,  fiber: 1, sugar: 4 },
      { name: "Original Chicken Sandwich",    category: "Chicken",    kcal: 660, protein: 24, carbs: 48, fat: 40, sodium: 1170, fiber: 2, sugar: 5 },
      { name: "8 pc Chicken Nuggets",         category: "Chicken",    kcal: 340, protein: 17, carbs: 19, fat: 22, sodium: 580,  fiber: 1, sugar: 0 },
      { name: "Medium Fries",                 category: "Sides",      kcal: 380, protein: 4,  carbs: 53, fat: 17, sodium: 560,  fiber: 4, sugar: 0 }
    ]
  },
  {
    id: "pandaexpress",
    name: "Panda Express",
    match: ["panda express"],
    color: "#D02B27",
    items: [
      { name: "Grilled Teriyaki Chicken",     category: "Entrees",  kcal: 300, protein: 36, carbs: 8,  fat: 13, sodium: 980,  fiber: 0, sugar: 5 },
      { name: "Orange Chicken",               category: "Entrees",  kcal: 490, protein: 25, carbs: 51, fat: 23, sodium: 820,  fiber: 2, sugar: 19 },
      { name: "Broccoli Beef",                category: "Entrees",  kcal: 150, protein: 9,  carbs: 13, fat: 7,  sodium: 520,  fiber: 2, sugar: 7 },
      { name: "Kung Pao Chicken",             category: "Entrees",  kcal: 290, protein: 16, carbs: 14, fat: 19, sodium: 970,  fiber: 2, sugar: 7 },
      { name: "String Bean Chicken Breast",   category: "Entrees",  kcal: 210, protein: 12, carbs: 13, fat: 12, sodium: 580,  fiber: 4, sugar: 5 },
      { name: "Steamed White Rice",           category: "Sides",    kcal: 380, protein: 7,  carbs: 87, fat: 0,  sodium: 0,    fiber: 0, sugar: 0 },
      { name: "Super Greens (side)",          category: "Sides",    kcal: 90,  protein: 6,  carbs: 10, fat: 3,  sodium: 250,  fiber: 5, sugar: 4 },
      { name: "Chow Mein",                    category: "Sides",    kcal: 510, protein: 13, carbs: 80, fat: 20, sodium: 860,  fiber: 6, sugar: 9 }
    ]
  },
  {
    id: "panera",
    name: "Panera Bread",
    match: ["panera", "panera bread"],
    color: "#5B8A2B",
    items: [
      { name: "Turkey Sandwich (whole)",      category: "Sandwiches", kcal: 470, protein: 25, carbs: 64, fat: 13, sodium: 1300, fiber: 5, sugar: 8 },
      { name: "Chipotle Chicken Avocado Melt",category: "Sandwiches", kcal: 720, protein: 41, carbs: 65, fat: 33, sodium: 1660, fiber: 5, sugar: 7 },
      { name: "Greek Salad (whole)",          category: "Salads",     kcal: 380, protein: 9,  carbs: 19, fat: 31, sodium: 820,  fiber: 6, sugar: 9 },
      { name: "Caesar Salad w/ Chicken",      category: "Salads",     kcal: 470, protein: 37, carbs: 22, fat: 27, sodium: 970,  fiber: 4, sugar: 4 },
      { name: "Ten Vegetable Soup (cup)",     category: "Soups",      kcal: 70,  protein: 3,  carbs: 14, fat: 1,  sodium: 720,  fiber: 4, sugar: 6 },
      { name: "Broccoli Cheddar Soup (cup)",  category: "Soups",      kcal: 230, protein: 8,  carbs: 16, fat: 15, sodium: 1110, fiber: 3, sugar: 6 },
      { name: "Mac & Cheese (small)",         category: "Sides",      kcal: 480, protein: 17, carbs: 41, fat: 28, sodium: 980,  fiber: 2, sugar: 7 }
    ]
  },
  {
    id: "kfc",
    name: "KFC",
    match: ["kfc", "kentucky fried chicken"],
    color: "#A1060E",
    items: [
      { name: "Original Recipe Chicken Breast", category: "Chicken",  kcal: 390, protein: 39, carbs: 11, fat: 21, sodium: 1190, fiber: 0, sugar: 0 },
      { name: "Original Recipe Drumstick",      category: "Chicken",  kcal: 130, protein: 12, carbs: 4,  fat: 8,  sodium: 380,  fiber: 0, sugar: 0 },
      { name: "Kentucky Grilled Chicken Breast",category: "Chicken",  kcal: 210, protein: 38, carbs: 0,  fat: 7,  sodium: 710,  fiber: 0, sugar: 0 },
      { name: "Crispy Colonel Sandwich",        category: "Sandwiches",kcal: 470, protein: 24, carbs: 41, fat: 24, sodium: 1180, fiber: 3, sugar: 6 },
      { name: "Famous Bowl",                    category: "Bowls",    kcal: 710, protein: 26, carbs: 80, fat: 32, sodium: 2200, fiber: 6, sugar: 3 },
      { name: "Cole Slaw",                      category: "Sides",    kcal: 170, protein: 1,  carbs: 22, fat: 9,  sodium: 320,  fiber: 3, sugar: 16 },
      { name: "Mashed Potatoes w/ Gravy",       category: "Sides",    kcal: 130, protein: 3,  carbs: 20, fat: 4,  sodium: 600,  fiber: 1, sugar: 1 }
    ]
  },
  {
    id: "fiveguys",
    name: "Five Guys",
    match: ["five guys"],
    color: "#ED174F",
    items: [
      { name: "Hamburger",                    category: "Burgers", kcal: 700, protein: 39, carbs: 39, fat: 43, sodium: 430, fiber: 2, sugar: 8 },
      { name: "Little Hamburger",             category: "Burgers", kcal: 480, protein: 23, carbs: 39, fat: 26, sodium: 380, fiber: 2, sugar: 8 },
      { name: "Bacon Cheeseburger",           category: "Burgers", kcal: 920, protein: 51, carbs: 40, fat: 62, sodium: 1310,fiber: 2, sugar: 9 },
      { name: "Little Bacon Burger",          category: "Burgers", kcal: 560, protein: 29, carbs: 39, fat: 33, sodium: 700, fiber: 2, sugar: 8 },
      { name: "Grilled Cheese",               category: "Sandwiches",kcal: 470,protein: 16, carbs: 41, fat: 26, sodium: 715, fiber: 2, sugar: 7 },
      { name: "Fries (regular)",              category: "Sides",   kcal: 950, protein: 15, carbs: 122,fat: 41, sodium: 525, fiber: 13,sugar: 4 }
    ]
  },
  {
    id: "innout",
    name: "In-N-Out Burger",
    match: ["in-n-out", "in n out", "in-n-out burger"],
    color: "#E21833",
    items: [
      { name: "Hamburger w/ Onion",           category: "Burgers", kcal: 390, protein: 16, carbs: 39, fat: 19, sodium: 650, fiber: 3, sugar: 10 },
      { name: "Cheeseburger w/ Onion",        category: "Burgers", kcal: 480, protein: 22, carbs: 39, fat: 27, sodium: 1000,fiber: 3, sugar: 10 },
      { name: "Double-Double",                category: "Burgers", kcal: 670, protein: 37, carbs: 39, fat: 41, sodium: 1440,fiber: 3, sugar: 10 },
      { name: "Protein Style Cheeseburger",   category: "Burgers", kcal: 330, protein: 18, carbs: 11, fat: 25, sodium: 720, fiber: 3, sugar: 7 },
      { name: "Protein Style Double-Double",  category: "Burgers", kcal: 520, protein: 33, carbs: 11, fat: 39, sodium: 1160,fiber: 3, sugar: 7 },
      { name: "French Fries",                 category: "Sides",   kcal: 370, protein: 7,  carbs: 54, fat: 18, sodium: 245, fiber: 2, sugar: 0 }
    ]
  },
  {
    id: "dunkin",
    name: "Dunkin'",
    match: ["dunkin", "dunkin'", "dunkin donuts", "dunkin' donuts"],
    color: "#FF6E1B",
    items: [
      { name: "Egg & Cheese Wake-Up Wrap",    category: "Breakfast", kcal: 180, protein: 7,  carbs: 14, fat: 11, sodium: 470, fiber: 0, sugar: 2 },
      { name: "Turkey Sausage Egg White Sandwich", category: "Breakfast", kcal: 290, protein: 18, carbs: 33, fat: 10, sodium: 750, fiber: 4, sugar: 4 },
      { name: "Sausage Egg & Cheese (croissant)", category: "Breakfast", kcal: 600, protein: 21, carbs: 38, fat: 40, sodium: 940, fiber: 1, sugar: 5 },
      { name: "Hash Browns",                  category: "Sides",     kcal: 130, protein: 1,  carbs: 14, fat: 8,  sodium: 320, fiber: 2, sugar: 0 },
      { name: "Latte (medium, whole milk)",   category: "Drinks",    kcal: 200, protein: 11, carbs: 18, fat: 10, sodium: 150, fiber: 0, sugar: 17 },
      { name: "Glazed Donut",                 category: "Bakery",    kcal: 240, protein: 4,  carbs: 29, fat: 11, sodium: 290, fiber: 1, sugar: 12 }
    ]
  }
];

/* Build quick lookup helpers. */
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
