/* Macro Map — application controller.
 *
 * Owns navigation between views, shared state (selected chain, nearby places,
 * the date being viewed), and the cross-cutting helpers used by every view:
 * daily totals, remaining macros, and logging an item. Each view has a render
 * function that rebuilds its persistent container on demand.
 */
window.MM = window.MM || {};

window.MM.app = (function () {
  var ui = window.MM.ui;
  var el = ui.el;

  var state = {
    view: "profile",
    selectedChainId: null,   // chain shown in Menu view
    nearbyPlaces: [],        // last Overpass results
    viewDate: window.MM.store.todayKey(),
    compare: []              // items selected for comparison in Menu view
  };

  var VIEWS = [
    { id: "profile",   label: "Profile",   icon: "👤" },
    { id: "discover",  label: "Discover",  icon: "📍" },
    { id: "menu",      label: "Menus",     icon: "🍔" },
    { id: "recommend", label: "For You",   icon: "✨" },
    { id: "tracker",   label: "Tracker",   icon: "📊" },
    { id: "requests",  label: "Add Data",  icon: "➕" }
  ];

  /* ---------------------------------------------------------------- helpers */

  function totals(entries) {
    var t = { kcal: 0, protein: 0, carbs: 0, fat: 0, sodium: 0, fiber: 0, sugar: 0 };
    entries.forEach(function (e) {
      var q = e.qty || 1;
      t.kcal += (e.kcal || 0) * q;
      t.protein += (e.protein || 0) * q;
      t.carbs += (e.carbs || 0) * q;
      t.fat += (e.fat || 0) * q;
      t.sodium += (e.sodium || 0) * q;
      t.fiber += (e.fiber || 0) * q;
      t.sugar += (e.sugar || 0) * q;
    });
    return t;
  }

  // Remaining macros for the *current* day, vs saved targets.
  function remaining() {
    var tg = window.MM.store.getTargets();
    if (!tg) return null;
    var c = totals(window.MM.store.getLog(window.MM.store.todayKey()));
    return {
      kcal: tg.kcal - c.kcal,
      protein: tg.protein - c.protein,
      carbs: tg.carbs - c.carbs,
      fat: tg.fat - c.fat
    };
  }

  function availableChainIds() {
    var ids = {};
    state.nearbyPlaces.forEach(function (p) { if (p.hasData) ids[p.chain.id] = true; });
    return Object.keys(ids);
  }

  function addToLog(item, qty) {
    var entry = {
      name: item.name,
      chainId: item.chainId || (item.chain && item.chain.id) || null,
      chainName: item.chainName || (item.chain && item.chain.name) || "Custom",
      kcal: item.kcal, protein: item.protein, carbs: item.carbs, fat: item.fat,
      sodium: item.sodium || 0, fiber: item.fiber || 0, sugar: item.sugar || 0,
      qty: qty || 1
    };
    window.MM.store.addLogEntry(entry, window.MM.store.todayKey());
    ui.toast("Added " + item.name + " to today's log", "ok");
    renderTracker();
    renderNavBadge();
  }

  /* ----------------------------------------------------------- navigation */

  function navigate(view) {
    state.view = view;
    document.querySelectorAll(".view").forEach(function (v) { v.classList.add("hidden"); });
    var target = document.getElementById("view-" + view);
    if (target) target.classList.remove("hidden");
    document.querySelectorAll(".nav-item").forEach(function (n) {
      n.classList.toggle("active", n.getAttribute("data-view") === view);
    });
    // per-view refresh on show
    if (view === "profile") renderProfile();
    if (view === "discover") { renderDiscover(); window.MM.map.invalidate(); }
    if (view === "menu") renderMenu();
    if (view === "recommend") renderRecommend();
    if (view === "tracker") renderTracker();
    if (view === "requests") renderRequests();
    window.scrollTo(0, 0);
  }

  function renderNav() {
    var nav = document.getElementById("nav");
    ui.clear(nav);
    VIEWS.forEach(function (v) {
      nav.appendChild(el("button", {
        class: "nav-item", "data-view": v.id,
        onclick: function () { navigate(v.id); }
      }, [
        el("span", { class: "nav-icon" }, v.icon),
        el("span", { class: "nav-label" }, v.label)
      ]));
    });
  }

  function renderNavBadge() {
    // show remaining-cal badge on the Tracker nav item
    var item = document.querySelector('.nav-item[data-view="tracker"]');
    if (!item) return;
    var existing = item.querySelector(".nav-badge");
    if (existing) existing.remove();
    var rem = remaining();
    if (!rem) return;
    var b = el("span", { class: "nav-badge" + (rem.kcal < 0 ? " over" : "") }, ui.fmt(Math.abs(rem.kcal)));
    item.appendChild(b);
  }

  /* =====================================================================
   *  PROFILE VIEW
   * ===================================================================== */

  function renderProfile() {
    var root = document.getElementById("view-profile");
    ui.clear(root);
    var m = window.MM.macros;
    var p = window.MM.store.getProfile() || {
      age: 30, sex: "male", heightCm: 178, weightKg: m.lbToKg(175),
      units: "imperial", activity: "moderate", goal: "lose", rate: "0.5", focus: "fat_loss"
    };

    root.appendChild(header("Your nutrition profile",
      "Tell us about you and we'll estimate daily calories and macros. Saved automatically and reused next time."));

    var form = el("form", { class: "card form-grid", id: "profile-form" });

    // units toggle
    var unitWrap = el("div", { class: "field span2" }, [
      el("label", null, "Units"),
      segmented("units", [
        { v: "imperial", label: "Imperial (lb / ft)" },
        { v: "metric", label: "Metric (kg / cm)" }
      ], p.units || "imperial", function () { rerenderMeasures(); })
    ]);
    form.appendChild(unitWrap);

    form.appendChild(field("Age", numInput("age", p.age, 13, 100)));
    form.appendChild(field("Sex", select("sex", [
      { v: "male", label: "Male" }, { v: "female", label: "Female" }
    ], p.sex)));

    var measures = el("div", { class: "span2 form-grid measures" });
    form.appendChild(measures);

    function rerenderMeasures() {
      ui.clear(measures);
      var units = form.querySelector('input[name="units"]:checked').value;
      if (units === "imperial") {
        var ft = Math.floor(m.cmToIn(p.heightCm) / 12);
        var inch = Math.round(m.cmToIn(p.heightCm) - ft * 12);
        var hWrap = el("div", { class: "field" }, [
          el("label", null, "Height"),
          el("div", { class: "inline" }, [
            numInput("heightFt", ft, 3, 8), el("span", { class: "unit" }, "ft"),
            numInput("heightIn", inch, 0, 11), el("span", { class: "unit" }, "in")
          ])
        ]);
        measures.appendChild(hWrap);
        measures.appendChild(field("Weight",
          el("div", { class: "inline" }, [numInput("weightLb", Math.round(m.kgToLb(p.weightKg)), 50, 700), el("span", { class: "unit" }, "lb")])));
      } else {
        measures.appendChild(field("Height",
          el("div", { class: "inline" }, [numInput("heightCm", Math.round(p.heightCm), 100, 250), el("span", { class: "unit" }, "cm")])));
        measures.appendChild(field("Weight",
          el("div", { class: "inline" }, [numInput("weightKg", Math.round(p.weightKg), 30, 320), el("span", { class: "unit" }, "kg")])));
      }
    }
    rerenderMeasures();

    form.appendChild(field("Activity level", select("activity",
      Object.keys(m.ACTIVITY).map(function (k) { return { v: k, label: m.ACTIVITY[k].label }; }), p.activity), "span2"));

    form.appendChild(field("Weight goal", select("goal",
      Object.keys(m.GOALS).map(function (k) { return { v: k, label: m.GOALS[k].label }; }), p.goal,
      function () { toggleRate(); })));

    var rateField = field("Rate of progress", select("rate",
      Object.keys(m.RATES).map(function (k) { return { v: k, label: m.RATES[k].label }; }), p.rate));
    form.appendChild(rateField);

    form.appendChild(field("Fitness goal", select("focus",
      Object.keys(m.FOCUS).map(function (k) { return { v: k, label: m.FOCUS[k].label }; }), p.focus), "span2"));

    function toggleRate() {
      var goal = form.querySelector('select[name="goal"]').value;
      rateField.style.display = goal === "maintain" ? "none" : "";
    }
    toggleRate();

    form.appendChild(el("div", { class: "span2 form-actions" }, [
      el("button", { class: "btn primary", type: "submit" }, "Calculate my targets")
    ]));

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var prof = readProfileForm(form);
      window.MM.store.setProfile(prof);
      var t = m.compute(prof);
      window.MM.store.setTargets(t);
      ui.toast("Targets saved to your profile", "ok");
      renderProfile();
      renderNavBadge();
    });

    root.appendChild(form);

    // current targets card
    var t = window.MM.store.getTargets();
    if (t) root.appendChild(targetsCard(t, p));
  }

  function readProfileForm(form) {
    var m = window.MM.macros;
    var units = form.querySelector('input[name="units"]:checked').value;
    var heightCm, weightKg;
    if (units === "imperial") {
      var ft = parseFloat(form.querySelector('[name="heightFt"]').value) || 0;
      var inch = parseFloat(form.querySelector('[name="heightIn"]').value) || 0;
      heightCm = m.inToCm(ft * 12 + inch);
      weightKg = m.lbToKg(parseFloat(form.querySelector('[name="weightLb"]').value) || 0);
    } else {
      heightCm = parseFloat(form.querySelector('[name="heightCm"]').value) || 0;
      weightKg = parseFloat(form.querySelector('[name="weightKg"]').value) || 0;
    }
    return {
      age: parseInt(form.querySelector('[name="age"]').value, 10) || 30,
      sex: form.querySelector('[name="sex"]').value,
      heightCm: heightCm,
      weightKg: weightKg,
      units: units,
      activity: form.querySelector('[name="activity"]').value,
      goal: form.querySelector('[name="goal"]').value,
      rate: form.querySelector('[name="rate"]').value,
      focus: form.querySelector('[name="focus"]').value
    };
  }

  function targetsCard(t, p) {
    var card = el("div", { class: "card targets-card" });
    card.appendChild(el("div", { class: "targets-head" }, [
      el("h3", null, "Your daily targets"),
      t.manual ? ui.badge("Manually adjusted", "muted") : ui.badge("Calculated", "ok")
    ]));

    if (p) {
      card.appendChild(el("p", { class: "muted small" },
        "Based on BMR " + ui.fmt(t.bmr || 0) + " · maintenance ≈ " + ui.fmt(t.tdee || 0) + " cal/day."));
    }

    var grid = el("div", { class: "target-grid" }, [
      bigStat(ui.fmt(t.kcal), "calories", "cal"),
      bigStat(ui.fmt(t.protein) + "g", "protein", "p"),
      bigStat(ui.fmt(t.carbs) + "g", "carbs", "c"),
      bigStat(ui.fmt(t.fat) + "g", "fat", "f")
    ]);
    card.appendChild(grid);

    card.appendChild(el("div", { class: "form-actions" }, [
      el("button", { class: "btn", onclick: function () { openManualAdjust(t); } }, "Adjust manually"),
      el("button", { class: "btn ghost", onclick: function () {
        window.MM.app.navigate("discover");
      } }, "Find food nearby →")
    ]));
    return card;
  }

  function openManualAdjust(t) {
    var body = el("div", { class: "form-grid" }, [
      field("Calories", numInput("mKcal", t.kcal, 800, 6000)),
      field("Protein (g)", numInput("mP", t.protein, 0, 500)),
      field("Carbs (g)", numInput("mC", t.carbs, 0, 800)),
      field("Fat (g)", numInput("mF", t.fat, 0, 400))
    ]);
    ui.modal("Adjust targets manually", body, [
      { label: "Cancel", kind: "ghost" },
      { label: "Save", kind: "primary", onClick: function () {
        var nt = {
          kcal: parseInt(body.querySelector('[name="mKcal"]').value, 10),
          protein: parseInt(body.querySelector('[name="mP"]').value, 10),
          carbs: parseInt(body.querySelector('[name="mC"]').value, 10),
          fat: parseInt(body.querySelector('[name="mF"]').value, 10),
          bmr: t.bmr, tdee: t.tdee, manual: true
        };
        window.MM.store.setTargets(nt);
        ui.toast("Targets updated", "ok");
        renderProfile(); renderNavBadge();
      } }
    ]);
  }

  /* =====================================================================
   *  DISCOVER VIEW (map)
   * ===================================================================== */

  var mapReady = false;
  function renderDiscover() {
    var root = document.getElementById("view-discover");
    if (root.getAttribute("data-built") === "1") {
      // already built; just ensure map sized & list current
      window.MM.map.invalidate();
      return;
    }
    root.setAttribute("data-built", "1");
    ui.clear(root);

    root.appendChild(header("Find food near you",
      "Use your location or search a city/address. We'll map nearby restaurants and flag which ones have macro data."));

    var controls = el("div", { class: "card discover-controls" }, [
      el("div", { class: "discover-row" }, [
        el("button", { class: "btn primary", id: "btn-locate" }, "📍 Use my location"),
        el("input", { class: "input grow", id: "addr-input", placeholder: "or search a city or address…", type: "text" }),
        el("button", { class: "btn", id: "btn-geocode" }, "Search"),
        select("radius", [
          { v: "1600", label: "1 mi" },
          { v: "2400", label: "1.5 mi" },
          { v: "4000", label: "2.5 mi" },
          { v: "8000", label: "5 mi" }
        ], "2400")
      ])
    ]);
    root.appendChild(controls);

    var layout = el("div", { class: "discover-layout" }, [
      el("div", { id: "map", class: "map" }),
      el("div", { id: "place-list", class: "place-list" }, [emptyHint("Search to see nearby places.")])
    ]);
    root.appendChild(layout);

    if (!mapReady) { window.MM.map.init("map"); mapReady = true; }

    var last = window.MM.store.getLastLocation();
    if (last) {
      window.MM.map.setView(last.lat, last.lng, last.label);
      runSearch(last.lat, last.lng, last.label);
    }

    controls.querySelector("#btn-locate").addEventListener("click", function () {
      ui.toast("Locating…");
      window.MM.map.locateUser().then(function (pos) {
        window.MM.map.setView(pos.lat, pos.lng, "Your location");
        runSearch(pos.lat, pos.lng, "Your location");
      }).catch(function (e) { ui.toast(e.message, "err"); });
    });
    function doGeocode() {
      var q = controls.querySelector("#addr-input").value.trim();
      if (!q) { ui.toast("Type a city or address first", "err"); return; }
      ui.toast("Searching…");
      window.MM.map.geocode(q).then(function (loc) {
        window.MM.map.setView(loc.lat, loc.lng, loc.label);
        runSearch(loc.lat, loc.lng, loc.label);
      }).catch(function (e) { ui.toast(e.message, "err"); });
    }
    controls.querySelector("#btn-geocode").addEventListener("click", doGeocode);
    controls.querySelector("#addr-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); doGeocode(); }
    });
    window.MM.map.invalidate();
  }

  function runSearch(lat, lng, label) {
    var radius = parseInt(document.querySelector('#view-discover [name="radius"]').value, 10) || 2400;
    var listEl = document.getElementById("place-list");
    ui.clear(listEl);
    listEl.appendChild(emptyHint("Searching nearby restaurants…"));
    window.MM.map.searchNearby(lat, lng, radius).then(function (places) {
      state.nearbyPlaces = places;
      window.MM.map.renderPlaces(places, radius, function (place) {
        state.selectedChainId = place.chain.id;
        navigate("menu");
      });
      renderPlaceList(places);
      renderNavBadge();
    }).catch(function (e) {
      ui.clear(listEl);
      listEl.appendChild(emptyHint("Couldn't load nearby places: " + e.message));
    });
  }

  function renderPlaceList(places) {
    var listEl = document.getElementById("place-list");
    ui.clear(listEl);
    var withData = places.filter(function (p) { return p.hasData; });
    var without = places.filter(function (p) { return !p.hasData; });

    listEl.appendChild(el("div", { class: "list-head" }, [
      el("strong", null, places.length + " places nearby"),
      el("span", { class: "muted small" }, withData.length + " with macro data")
    ]));

    if (!places.length) {
      listEl.appendChild(emptyHint("No restaurants found in this area. Try a larger radius."));
      return;
    }

    withData.forEach(function (p) { listEl.appendChild(placeRow(p)); });
    if (without.length) {
      listEl.appendChild(el("div", { class: "list-subhead" }, "No data yet — help us add them"));
      without.slice(0, 12).forEach(function (p) { listEl.appendChild(placeRow(p)); });
    }
  }

  function placeRow(p) {
    var miles = window.MM.map.metresToMiles(p.distance).toFixed(1);
    var dot = el("span", { class: "place-dot", style: "background:" + (p.hasData ? (p.chain.color || "#16a34a") : "#cbd5e1") });
    var meta = el("div", { class: "place-meta" }, [
      el("div", { class: "place-name" }, p.name),
      el("div", { class: "muted small" }, (p.amenity || "food") + " · " + miles + " mi")
    ]);
    var action = p.hasData
      ? el("button", { class: "btn small", onclick: function () { state.selectedChainId = p.chain.id; navigate("menu"); } }, "Menu")
      : el("button", { class: "btn small ghost", onclick: function () { quickRequest(p); } }, "Request");
    return el("div", { class: "place-row" }, [dot, meta, action]);
  }

  function quickRequest(place) {
    window.MM.store.addRequest({
      chain: place.name, note: "Requested from Discover (no data found nearby)",
      lat: place.lat, lng: place.lng
    });
    ui.toast("Requested macro data for " + place.name, "ok");
  }

  /* =====================================================================
   *  MENU VIEW
   * ===================================================================== */

  function renderMenu() {
    var root = document.getElementById("view-menu");
    ui.clear(root);
    root.appendChild(header("Browse menus", "Compare items by macros. Add anything straight to today's log."));

    var chains = window.MM.NUTRITION;
    var nearbyIds = availableChainIds();
    if (!state.selectedChainId) {
      state.selectedChainId = nearbyIds[0] || chains[0].id;
    }

    var controls = el("div", { class: "card menu-controls" });
    var chainSel = select("chain", chains.map(function (c) {
      var near = nearbyIds.indexOf(c.id) !== -1;
      return { v: c.id, label: c.name + (near ? "  ·  nearby" : "") };
    }), state.selectedChainId, function (e) {
      state.selectedChainId = e.target.value; renderMenu();
    });
    controls.appendChild(field("Restaurant", chainSel));

    var searchInput = el("input", { class: "input", id: "menu-search", placeholder: "Search items…", type: "text" });
    controls.appendChild(field("Search", searchInput));

    var sortSel = select("sort", [
      { v: "ppc", label: "Best protein per calorie" },
      { v: "protein", label: "Most protein" },
      { v: "cal_asc", label: "Fewest calories" },
      { v: "cal_desc", label: "Most calories" }
    ], "ppc");
    controls.appendChild(field("Sort by", sortSel));

    var fitOnly = el("input", { type: "checkbox", id: "fit-only" });
    var fitLabel = el("label", { class: "check" }, [fitOnly, el("span", null, "Only items that fit my remaining calories")]);
    controls.appendChild(el("div", { class: "field span2" }, [fitLabel]));

    root.appendChild(controls);

    var listWrap = el("div", { id: "menu-list", class: "card-list" });
    root.appendChild(listWrap);

    var compareBar = el("div", { id: "compare-bar", class: "compare-bar hidden" });
    root.appendChild(compareBar);

    function draw() {
      var chain = window.MM.getChainById(state.selectedChainId);
      ui.clear(listWrap);
      var q = searchInput.value.trim().toLowerCase();
      var sort = sortSel.value;
      var rem = remaining();
      var fit = fitOnly.checked && rem;

      var items = chain.items.map(function (it) {
        return Object.assign({ chainId: chain.id, chainName: chain.name, chainColor: chain.color }, it);
      });
      if (q) items = items.filter(function (it) {
        return it.name.toLowerCase().indexOf(q) !== -1 || (it.category || "").toLowerCase().indexOf(q) !== -1;
      });
      if (fit) items = items.filter(function (it) { return it.kcal <= rem.kcal; });

      items.sort(function (a, b) {
        if (sort === "protein") return b.protein - a.protein;
        if (sort === "cal_asc") return a.kcal - b.kcal;
        if (sort === "cal_desc") return b.kcal - a.kcal;
        return (b.protein / b.kcal) - (a.protein / a.kcal); // ppc
      });

      if (!items.length) { listWrap.appendChild(emptyHint("No items match.")); return; }
      items.forEach(function (it) { listWrap.appendChild(itemCard(it, rem)); });
    }

    searchInput.addEventListener("input", draw);
    sortSel.addEventListener("change", draw);
    fitOnly.addEventListener("change", draw);
    draw();
    drawCompareBar();
  }

  function itemFlags(it) {
    var flags = [];
    var ppc = it.kcal > 0 ? it.protein / it.kcal : 0;
    if (ppc >= 0.09) flags.push(ui.badge("High protein", "p"));
    if (it.kcal <= 400) flags.push(ui.badge("Lower cal", "c"));
    if (it.sodium >= 1200) flags.push(ui.badge("High sodium", "warn"));
    if (it.sugar >= 20) flags.push(ui.badge("High sugar", "warn"));
    return flags;
  }

  function itemCard(it, rem) {
    var fits = rem ? it.kcal <= rem.kcal : null;
    var checked = state.compare.some(function (c) { return c.chainId === it.chainId && c.name === it.name; });

    var head = el("div", { class: "item-head" }, [
      el("div", null, [
        el("div", { class: "item-name" }, it.name),
        el("div", { class: "muted small" }, it.chainName + " · " + (it.category || ""))
      ]),
      el("div", { class: "item-flags" }, itemFlags(it))
    ]);

    var foot = el("div", { class: "item-foot" }, [
      el("label", { class: "check tiny" }, [
        el("input", { type: "checkbox", checked: checked ? "checked" : null, onchange: function (e) { toggleCompare(it, e.target.checked); } }),
        el("span", null, "Compare")
      ]),
      el("div", { class: "item-actions" }, [
        rem ? el("span", { class: "muted small" }, fits ? "fits remaining" : "over remaining") : null,
        el("button", { class: "btn small primary", onclick: function () { addToLog(it, 1); } }, "Add")
      ])
    ]);

    return el("div", { class: "card item-card" + (rem && !fits ? " dim" : "") }, [head, ui.macroPills(it),
      el("div", { class: "micro muted small" }, "Sodium " + ui.fmt(it.sodium) + "mg · Fiber " + ui.fmt(it.fiber) + "g · Sugar " + ui.fmt(it.sugar) + "g"),
      foot]);
  }

  function toggleCompare(it, on) {
    if (on) {
      if (!state.compare.some(function (c) { return c.chainId === it.chainId && c.name === it.name; }))
        state.compare.push(it);
    } else {
      state.compare = state.compare.filter(function (c) { return !(c.chainId === it.chainId && c.name === it.name); });
    }
    drawCompareBar();
  }

  function drawCompareBar() {
    var bar = document.getElementById("compare-bar");
    if (!bar) return;
    ui.clear(bar);
    if (state.compare.length < 1) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    bar.appendChild(el("div", { class: "compare-head" }, [
      el("strong", null, "Comparing " + state.compare.length + " item(s)"),
      el("div", null, [
        el("button", { class: "btn small ghost", onclick: function () { state.compare = []; renderMenu(); } }, "Clear"),
        el("button", { class: "btn small", onclick: openCompare }, "View comparison")
      ])
    ]));
  }

  function openCompare() {
    if (!state.compare.length) return;
    var rows = ["Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Sodium (mg)", "Sugar (g)", "P / 100 cal"];
    var table = el("table", { class: "compare-table" });
    var thead = el("tr", null, [el("th", null, "")].concat(state.compare.map(function (it) {
      return el("th", null, it.name);
    })));
    table.appendChild(thead);
    rows.forEach(function (label) {
      var tr = el("tr", null, [el("td", { class: "rowlab" }, label)]);
      state.compare.forEach(function (it) {
        var v;
        if (label === "Calories") v = ui.fmt(it.kcal);
        else if (label === "Protein (g)") v = ui.fmt(it.protein);
        else if (label === "Carbs (g)") v = ui.fmt(it.carbs);
        else if (label === "Fat (g)") v = ui.fmt(it.fat);
        else if (label === "Sodium (mg)") v = ui.fmt(it.sodium);
        else if (label === "Sugar (g)") v = ui.fmt(it.sugar);
        else v = (it.kcal > 0 ? (it.protein / it.kcal * 100).toFixed(1) : "—");
        tr.appendChild(el("td", null, String(v)));
      });
      table.appendChild(tr);
    });
    ui.modal("Compare items", el("div", { class: "compare-scroll" }, [table]), [{ label: "Done", kind: "primary" }]);
  }

  /* =====================================================================
   *  RECOMMEND VIEW
   * ===================================================================== */

  function renderRecommend() {
    var root = document.getElementById("view-recommend");
    ui.clear(root);
    root.appendChild(header("Recommended for you", "Picks ranked by how well they fit your remaining macros today."));

    var tg = window.MM.store.getTargets();
    if (!tg) {
      root.appendChild(noticeCard("Set up your profile first", "We need your calorie & macro targets to recommend food. Head to the Profile tab.",
        "Go to Profile", function () { navigate("profile"); }));
      return;
    }

    var rem = remaining();
    root.appendChild(remainingStrip(rem));

    var nearbyIds = availableChainIds();
    var scopeCard = el("div", { class: "card" });
    var scopeNear = el("input", { type: "radio", name: "scope", value: "near", checked: nearbyIds.length ? "checked" : null, disabled: nearbyIds.length ? null : "disabled" });
    var scopeAll = el("input", { type: "radio", name: "scope", value: "all", checked: nearbyIds.length ? null : "checked" });
    scopeCard.appendChild(el("div", { class: "scope-row" }, [
      el("label", { class: "check tiny" }, [scopeNear, el("span", null, "Only chains near me" + (nearbyIds.length ? " (" + nearbyIds.length + ")" : " — search Discover first"))]),
      el("label", { class: "check tiny" }, [scopeAll, el("span", null, "All chains in database")])
    ]));
    root.appendChild(scopeCard);

    // presets
    var presetWrap = el("div", { class: "preset-wrap" });
    Object.keys(window.MM.recommend.PRESETS).forEach(function (key) {
      var preset = window.MM.recommend.PRESETS[key];
      presetWrap.appendChild(el("button", {
        class: "preset", onclick: function () { runRecommend(preset.opts); }
      }, preset.label));
    });
    root.appendChild(el("div", { class: "card" }, [el("div", { class: "section-label" }, "Quick picks"), presetWrap]));

    // custom filters
    var custom = el("div", { class: "card form-grid" });
    custom.appendChild(el("div", { class: "section-label span2" }, "Custom search"));
    custom.appendChild(field("Max calories", numInput("c_maxKcal", "", 0, 3000)));
    custom.appendChild(field("Min protein (g)", numInput("c_minProtein", "", 0, 200)));
    custom.appendChild(field("Max sodium (mg)", numInput("c_maxSodium", "", 0, 4000)));
    custom.appendChild(field("Max sugar (g)", numInput("c_maxSugar", "", 0, 200)));
    custom.appendChild(field("Meal size", select("c_mealSize", [
      { v: "", label: "Any" }, { v: "snack", label: "Snack" }, { v: "regular", label: "Regular" }, { v: "large", label: "Large" }
    ], "")));
    custom.appendChild(field("Prioritize", select("c_prioritize", [
      { v: "protein", label: "Protein efficiency" }, { v: "lowcal", label: "Low calorie" },
      { v: "lowcarb", label: "Low carb" }, { v: "lowfat", label: "Low fat" }
    ], "protein")));
    custom.appendChild(el("div", { class: "span2 form-actions" }, [
      el("button", { class: "btn primary", onclick: function () {
        runRecommend({
          maxKcal: numOrNull(custom, "c_maxKcal"),
          minProtein: numOrNull(custom, "c_minProtein"),
          maxSodium: numOrNull(custom, "c_maxSodium"),
          maxSugar: numOrNull(custom, "c_maxSugar"),
          mealSize: custom.querySelector('[name="c_mealSize"]').value || null,
          prioritize: custom.querySelector('[name="c_prioritize"]').value
        });
      } }, "Find matches")
    ]));
    root.appendChild(custom);

    var results = el("div", { id: "rec-results", class: "card-list" });
    root.appendChild(results);

    // run a sensible default
    runRecommend(window.MM.recommend.PRESETS.fits_remaining.opts);

    function runRecommend(opts) {
      var scope = root.querySelector('input[name="scope"]:checked').value;
      var ids = scope === "near" ? nearbyIds : null;
      var rem2 = remaining();
      var ranked = window.MM.recommend.rank(rem2, opts, ids, 15);
      ui.clear(results);
      results.appendChild(el("div", { class: "list-head" }, [
        el("strong", null, "Top matches"),
        el("span", { class: "muted small" }, scope === "near" ? "from chains near you" : "from all chains")
      ]));
      if (!ranked.length) { results.appendChild(emptyHint("No items match those filters. Loosen them a bit.")); return; }
      ranked.forEach(function (it, i) { results.appendChild(recCard(it, i + 1)); });
    }
  }

  function recCard(it, rankNum) {
    var head = el("div", { class: "item-head" }, [
      el("div", { class: "rec-title" }, [
        el("span", { class: "rank" }, "#" + rankNum),
        el("div", null, [
          el("div", { class: "item-name" }, it.name),
          el("div", { class: "muted small" }, it.chainName)
        ])
      ]),
      el("div", { class: "score", title: "fit score" }, ui.fmt(Math.max(it._score, 0)))
    ]);
    var reasons = el("div", { class: "reasons" }, (it._reasons || []).slice(0, 3).map(function (r) {
      var bad = /over|heavy/i.test(r);
      return ui.badge(r, bad ? "warn" : "ok");
    }));
    var foot = el("div", { class: "item-foot" }, [
      el("span", { class: "muted small" }, (it._ppc * 100).toFixed(1) + " g protein / 100 cal"),
      el("button", { class: "btn small primary", onclick: function () { addToLog(it, 1); } }, "Add")
    ]);
    return el("div", { class: "card item-card" }, [head, ui.macroPills(it), reasons, foot]);
  }

  function remainingStrip(rem) {
    if (!rem) return el("div");
    return el("div", { class: "card remaining-strip" }, [
      el("div", { class: "section-label" }, "Remaining today"),
      el("div", { class: "rem-grid" }, [
        remStat(rem.kcal, "cal", "cal"),
        remStat(rem.protein, "g protein", "p"),
        remStat(rem.carbs, "g carbs", "c"),
        remStat(rem.fat, "g fat", "f")
      ])
    ]);
  }
  function remStat(v, label, cls) {
    var over = v < 0;
    return el("div", { class: "rem-stat " + cls + (over ? " over" : "") }, [
      el("div", { class: "rem-num" }, (over ? "−" : "") + ui.fmt(Math.abs(v))),
      el("div", { class: "rem-label" }, over ? "over " + label : label + " left")
    ]);
  }

  /* =====================================================================
   *  TRACKER VIEW
   * ===================================================================== */

  function renderTracker() {
    var root = document.getElementById("view-tracker");
    ui.clear(root);

    var tg = window.MM.store.getTargets();
    var entries = window.MM.store.getLog(state.viewDate);
    var c = totals(entries);

    // date navigation
    var isToday = state.viewDate === window.MM.store.todayKey();
    var nav = el("div", { class: "tracker-datenav" }, [
      el("button", { class: "icon-btn", onclick: function () { shiftDate(-1); } }, "‹"),
      el("div", { class: "date-label" }, [
        el("strong", null, prettyDate(state.viewDate)),
        isToday ? ui.badge("Today", "ok") : null
      ]),
      el("button", { class: "icon-btn", disabled: isToday ? "disabled" : null, onclick: function () { shiftDate(1); } }, "›"),
      el("div", { class: "spacer" }),
      historySelect()
    ]);
    root.appendChild(nav);

    if (!tg) {
      root.appendChild(noticeCard("No targets set yet", "Create your profile to see calories & macros remaining.",
        "Go to Profile", function () { navigate("profile"); }));
    }

    // summary: ring + macro bars
    var summary = el("div", { class: "card tracker-summary" });
    summary.appendChild(ui.calorieRing(c.kcal, tg ? tg.kcal : 0));
    var bars = el("div", { class: "tracker-bars" }, [
      ui.macroRow("Calories", c.kcal, tg ? tg.kcal : 0, "cal"),
      ui.macroRow("Protein", c.protein, tg ? tg.protein : 0, "p"),
      ui.macroRow("Carbs", c.carbs, tg ? tg.carbs : 0, "c"),
      ui.macroRow("Fat", c.fat, tg ? tg.fat : 0, "f")
    ]);
    summary.appendChild(bars);
    root.appendChild(summary);

    // micro totals
    root.appendChild(el("div", { class: "card micro-row-card" }, [
      microStat("Sodium", ui.fmt(c.sodium) + " mg"),
      microStat("Fiber", ui.fmt(c.fiber) + " g"),
      microStat("Sugar", ui.fmt(c.sugar) + " g"),
      microStat("Items", String(entries.length))
    ]));

    // quick add row
    root.appendChild(quickAddCard());

    // log list
    var logCard = el("div", { class: "card" });
    logCard.appendChild(el("div", { class: "list-head" }, [
      el("strong", null, "Food log"),
      entries.length ? el("div", null, [
        el("button", { class: "btn small ghost", onclick: saveDayAsMeal }, "Save as meal"),
        el("button", { class: "btn small ghost", onclick: clearDay }, "Clear day")
      ]) : null
    ]));
    if (!entries.length) {
      logCard.appendChild(emptyHint("Nothing logged yet. Add items from Menus, For You, or quick-add above."));
    } else {
      entries.forEach(function (e) { logCard.appendChild(logRow(e)); });
    }
    root.appendChild(logCard);

    renderNavBadge();
  }

  function logRow(e) {
    var q = e.qty || 1;
    var line = el("div", { class: "log-row" }, [
      el("div", { class: "log-main" }, [
        el("div", { class: "item-name" }, e.name),
        el("div", { class: "muted small" }, e.chainName + " · " + ui.fmt(e.kcal * q) + " cal · P" + ui.fmt(e.protein * q) + " C" + ui.fmt(e.carbs * q) + " F" + ui.fmt(e.fat * q))
      ]),
      el("div", { class: "qty" }, [
        el("button", { class: "icon-btn small", onclick: function () { changeQty(e, -1); } }, "–"),
        el("span", { class: "qty-num" }, "×" + q),
        el("button", { class: "icon-btn small", onclick: function () { changeQty(e, 1); } }, "+"),
        el("button", { class: "icon-btn small danger", onclick: function () {
          window.MM.store.removeLogEntry(e.id, state.viewDate); renderTracker();
        } }, "✕")
      ])
    ]);
    return line;
  }

  function changeQty(e, delta) {
    var q = Math.max(1, (e.qty || 1) + delta);
    window.MM.store.updateLogEntry(e.id, { qty: q }, state.viewDate);
    renderTracker();
  }

  function quickAddCard() {
    var card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "section-label" }, "Quick add"));

    // frequents + saved meals chips
    var chips = el("div", { class: "chips" });
    window.MM.store.topFrequents(6).forEach(function (f) {
      var parts = f.key.split("::");
      var chain = window.MM.getChainById(parts[0]);
      if (!chain) return;
      var item = chain.items.filter(function (i) { return i.name === parts[1]; })[0];
      if (!item) return;
      chips.appendChild(el("button", { class: "chip", onclick: function () {
        addToLog(Object.assign({ chainId: chain.id, chainName: chain.name }, item), 1);
      } }, "↺ " + item.name));
    });
    window.MM.store.getSavedMeals().forEach(function (meal) {
      chips.appendChild(el("button", { class: "chip meal", onclick: function () {
        meal.items.forEach(function (it) { window.MM.store.addLogEntry(Object.assign({}, it, { id: null }), state.viewDate); });
        ui.toast("Added meal: " + meal.name, "ok"); renderTracker();
      } }, "🍱 " + meal.name));
    });
    if (chips.childNodes.length) card.appendChild(chips);

    // custom item form
    var form = el("form", { class: "quickadd-form" }, [
      el("input", { class: "input grow", name: "qa_name", placeholder: "Custom item name", type: "text", required: "required" }),
      numInput("qa_kcal", "", 0, 5000, "cal"),
      numInput("qa_p", "", 0, 500, "P"),
      numInput("qa_c", "", 0, 800, "C"),
      numInput("qa_f", "", 0, 400, "F"),
      el("button", { class: "btn primary", type: "submit" }, "Add")
    ]);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      addToLog({
        name: form.qa_name.value || "Custom item",
        chainName: "Custom",
        kcal: +form.qa_kcal.value || 0, protein: +form.qa_p.value || 0,
        carbs: +form.qa_c.value || 0, fat: +form.qa_f.value || 0
      }, 1);
      form.reset();
    });
    card.appendChild(form);
    return card;
  }

  function shiftDate(delta) {
    var d = new Date(state.viewDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    var key = window.MM.store.todayKey(d);
    if (key > window.MM.store.todayKey()) return; // no future
    state.viewDate = key;
    renderTracker();
  }

  function historySelect() {
    var dates = window.MM.store.loggedDates();
    if (!dates.length) return el("span");
    var opts = dates.map(function (d) { return { v: d, label: prettyDate(d) }; });
    return select("history", opts, dates.indexOf(state.viewDate) !== -1 ? state.viewDate : opts[0].v, function (e) {
      state.viewDate = e.target.value; renderTracker();
    });
  }

  function clearDay() {
    ui.modal("Clear this day?", el("p", null, "This removes all logged items for " + prettyDate(state.viewDate) + "."), [
      { label: "Cancel", kind: "ghost" },
      { label: "Clear", kind: "danger", onClick: function () {
        window.MM.store.clearDay(state.viewDate); renderTracker(); ui.toast("Day cleared");
      } }
    ]);
  }

  function saveDayAsMeal() {
    var entries = window.MM.store.getLog(state.viewDate);
    if (!entries.length) return;
    var input = el("input", { class: "input", placeholder: "e.g. My usual Chipotle order", type: "text" });
    ui.modal("Save these items as a meal", el("div", { class: "form-grid" }, [field("Meal name", input)]), [
      { label: "Cancel", kind: "ghost" },
      { label: "Save meal", kind: "primary", onClick: function () {
        var name = input.value.trim() || "Saved meal";
        var items = entries.map(function (e) {
          return { name: e.name, chainId: e.chainId, chainName: e.chainName, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, sodium: e.sodium, fiber: e.fiber, sugar: e.sugar, qty: e.qty };
        });
        window.MM.store.saveMeal({ name: name, items: items });
        ui.toast("Saved meal: " + name, "ok"); renderTracker();
      } }
    ]);
  }

  /* =====================================================================
   *  REQUESTS VIEW
   * ===================================================================== */

  function renderRequests() {
    var root = document.getElementById("view-requests");
    ui.clear(root);
    root.appendChild(header("Missing a restaurant?",
      "Our database is growing. If a chain near you has no macro data, request it and we'll prioritize adding it."));

    // nearby-without-data quick chips
    var without = state.nearbyPlaces.filter(function (p) { return !p.hasData; });
    if (without.length) {
      var chips = el("div", { class: "chips" });
      var seen = {};
      without.forEach(function (p) {
        if (seen[p.name]) return; seen[p.name] = true;
        chips.appendChild(el("button", { class: "chip", onclick: function () { quickRequest(p); renderRequests(); } }, "➕ " + p.name));
      });
      root.appendChild(el("div", { class: "card" }, [
        el("div", { class: "section-label" }, "Spotted near you without data"),
        chips
      ]));
    }

    // manual request form
    var form = el("form", { class: "card form-grid" });
    form.appendChild(el("div", { class: "section-label span2" }, "Request a chain"));
    var nameInput = el("input", { class: "input", name: "rq_chain", placeholder: "Restaurant / chain name", type: "text", required: "required" });
    form.appendChild(field("Restaurant", nameInput, "span2"));
    var noteInput = el("textarea", { class: "input", name: "rq_note", placeholder: "Anything that helps — location, specific items…", rows: "2" });
    form.appendChild(field("Note (optional)", noteInput, "span2"));
    form.appendChild(el("div", { class: "span2 form-actions" }, [
      el("button", { class: "btn primary", type: "submit" }, "Submit request")
    ]));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var cur = window.MM.map.getCurrent();
      window.MM.store.addRequest({
        chain: nameInput.value.trim(), note: noteInput.value.trim(),
        lat: cur ? cur.lat : null, lng: cur ? cur.lng : null
      });
      ui.toast("Request submitted — thank you!", "ok");
      renderRequests();
    });
    root.appendChild(form);

    // existing requests
    var reqs = window.MM.store.getRequests().slice().reverse();
    var listCard = el("div", { class: "card" });
    listCard.appendChild(el("div", { class: "section-label" }, "Your requests (" + reqs.length + ")"));
    if (!reqs.length) {
      listCard.appendChild(emptyHint("No requests yet."));
    } else {
      reqs.forEach(function (r) {
        listCard.appendChild(el("div", { class: "req-row" }, [
          el("div", null, [
            el("div", { class: "item-name" }, r.chain),
            el("div", { class: "muted small" }, (r.note ? r.note + " · " : "") + prettyDateTime(r.date))
          ]),
          ui.badge("Submitted", "muted")
        ]));
      });
    }
    root.appendChild(listCard);
  }

  /* ------------------------------------------------------ small builders */

  function header(title, sub) {
    return el("div", { class: "view-header" }, [
      el("h2", null, title),
      sub ? el("p", { class: "muted" }, sub) : null
    ]);
  }
  function field(label, control, cls) {
    return el("div", { class: "field " + (cls || "") }, [el("label", null, label), control]);
  }
  function numInput(name, value, min, max, placeholder) {
    return el("input", { class: "input", type: "number", name: name, value: value === "" || value == null ? null : value, min: min, max: max, placeholder: placeholder || "", step: "1" });
  }
  function select(name, options, selected, onchange) {
    var s = el("select", { class: "input", name: name });
    options.forEach(function (o) {
      var opt = el("option", { value: o.v }, o.label);
      if (String(o.v) === String(selected)) opt.setAttribute("selected", "selected");
      s.appendChild(opt);
    });
    if (onchange) s.addEventListener("change", onchange);
    return s;
  }
  function segmented(name, options, selected, onchange) {
    var wrap = el("div", { class: "segmented" });
    options.forEach(function (o) {
      var id = name + "-" + o.v;
      var input = el("input", { type: "radio", name: name, id: id, value: o.v });
      if (o.v === selected) input.setAttribute("checked", "checked");
      input.addEventListener("change", onchange);
      wrap.appendChild(input);
      wrap.appendChild(el("label", { for: id }, o.label));
    });
    return wrap;
  }
  function bigStat(value, label, cls) {
    return el("div", { class: "big-stat " + cls }, [
      el("div", { class: "big-num" }, value),
      el("div", { class: "big-label" }, label)
    ]);
  }
  function microStat(label, value) {
    return el("div", { class: "micro-stat" }, [
      el("div", { class: "micro-num" }, value),
      el("div", { class: "micro-label" }, label)
    ]);
  }
  function googleIcon() {
    return el("span", { class: "g-icon", html:
      "<svg viewBox='0 0 18 18' width='17' height='17' xmlns='http://www.w3.org/2000/svg'>" +
      "<path fill='#4285F4' d='M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.62z'/>" +
      "<path fill='#34A853' d='M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z'/>" +
      "<path fill='#FBBC05' d='M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z'/>" +
      "<path fill='#EA4335' d='M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z'/>" +
      "</svg>" });
  }
  function emptyHint(text) { return el("div", { class: "empty-hint" }, text); }
  function noticeCard(title, body, btn, onClick) {
    return el("div", { class: "card notice" }, [
      el("h3", null, title), el("p", { class: "muted" }, body),
      el("button", { class: "btn primary", onclick: onClick }, btn)
    ]);
  }
  function numOrNull(scope, name) {
    var v = scope.querySelector('[name="' + name + '"]').value;
    return v === "" ? null : (+v);
  }
  function prettyDate(key) {
    var d = new Date(key + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  function prettyDateTime(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
    catch (e) { return ""; }
  }

  /* =====================================================================
   *  ACCOUNT / AUTH UI
   * ===================================================================== */

  // Re-run the active view's render (used after a cloud sync replaces state).
  function refreshCurrent() {
    var v = state.view;
    if (v === "profile") renderProfile();
    else if (v === "menu") renderMenu();
    else if (v === "recommend") renderRecommend();
    else if (v === "tracker") renderTracker();
    else if (v === "requests") renderRequests();
    renderNavBadge();
  }

  function renderAccount(status) {
    var host = document.getElementById("account");
    if (!host) return;
    ui.clear(host);

    if (!status.enabled) {
      // Cloud accounts not configured — make the local-only nature visible.
      host.appendChild(el("button", {
        class: "acct-chip local", title: "Your data is saved in this browser. Add a Supabase project in config.js to enable accounts & sync.",
        onclick: function () {
          ui.modal("Local mode", el("div", null, [
            el("p", null, "Your profile, targets and food log are saved in this browser via localStorage — no account needed, and it persists across sessions on this device."),
            el("p", { class: "muted small" }, "To sync across devices, create a free Supabase project, run supabase/schema.sql, and paste your URL + anon key into js/config.js. The app will show sign-in automatically.")
          ]), [{ label: "Got it", kind: "primary" }]);
        }
      }, "💾 Local"));
      return;
    }

    if (status.user) {
      var email = status.user.email || "Account";
      var initial = email[0] ? email[0].toUpperCase() : "•";
      host.appendChild(el("button", {
        class: "acct-chip user", title: email,
        onclick: function () {
          ui.modal("Account", el("div", null, [
            el("p", null, ["Signed in as ", el("strong", null, email), "."]),
            el("p", { class: "muted small" }, "Your data syncs automatically to your account. Last-write-wins across devices.")
          ]), [
            { label: "Sign out", kind: "danger", onClick: function () {
              window.MM.auth.signOut().then(function () { ui.toast("Signed out"); });
            } },
            { label: "Close", kind: "ghost" }
          ]);
        }
      }, [el("span", { class: "avatar" }, initial), el("span", { class: "acct-email" }, email)]));
    } else {
      host.appendChild(el("button", { class: "btn small primary", onclick: openAuthModal }, "Sign in"));
    }
  }

  function openAuthModal() {
    var mode = "signin";
    var emailIn = el("input", { class: "input", type: "email", placeholder: "you@example.com", autocomplete: "email", required: "required" });
    var pwIn = el("input", { class: "input", type: "password", placeholder: "Password (min 6 characters)", autocomplete: "current-password", minlength: "6", required: "required" });
    var msg = el("div", { class: "auth-msg" });
    var submitBtn = el("button", { class: "btn primary", type: "submit" }, "Sign in");
    var toggle = el("button", { class: "btn ghost small", type: "button" });

    var googleBtn = el("button", { class: "btn google", type: "button" }, [googleIcon(), el("span", null, "Continue with Google")]);
    googleBtn.addEventListener("click", function () {
      msg.textContent = ""; msg.className = "auth-msg";
      googleBtn.disabled = true;
      window.MM.auth.signInWithGoogle().catch(function (err) {
        showMsg(err.message || "Google sign-in isn't available. Enable the Google provider in Supabase.", true);
        googleBtn.disabled = false;
      });
    });

    var form = el("form", { class: "auth-form" }, [
      googleBtn,
      el("div", { class: "auth-divider" }, el("span", null, "or use email")),
      field("Email", emailIn),
      field("Password", pwIn),
      msg,
      el("div", { class: "form-actions" }, [submitBtn, toggle])
    ]);

    function applyMode() {
      var signin = mode === "signin";
      submitBtn.textContent = signin ? "Sign in" : "Create account";
      toggle.textContent = signin ? "Need an account? Create one" : "Have an account? Sign in";
      pwIn.setAttribute("autocomplete", signin ? "current-password" : "new-password");
      msg.textContent = "";
      msg.className = "auth-msg";
    }
    toggle.addEventListener("click", function () { mode = mode === "signin" ? "signup" : "signin"; applyMode(); });
    applyMode();

    var close = ui.modal("Welcome to Macro Map", form, [{ label: "Cancel", kind: "ghost" }]);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = emailIn.value.trim();
      var pw = pwIn.value;
      if (!email || pw.length < 6) { showMsg("Enter an email and a password of at least 6 characters.", true); return; }
      submitBtn.disabled = true;
      submitBtn.textContent = mode === "signin" ? "Signing in…" : "Creating…";

      var p = mode === "signin" ? window.MM.auth.signIn(email, pw) : window.MM.auth.signUp(email, pw);
      p.then(function (res) {
        if (mode === "signup" && res && res.needsConfirmation) {
          mode = "signin"; applyMode();
          showMsg("Account created. Check your email to confirm, then sign in.", false);
          submitBtn.disabled = false;
          return;
        }
        close(); // onAuthStateChange will sync + refresh the UI
      }).catch(function (err) {
        showMsg(err.message || "Something went wrong.", true);
        submitBtn.disabled = false;
        applyModeKeepMsg();
      });
    });

    function showMsg(text, isErr) { msg.textContent = text; msg.className = "auth-msg " + (isErr ? "err" : "ok"); }
    function applyModeKeepMsg() { submitBtn.textContent = mode === "signin" ? "Sign in" : "Create account"; }
  }

  /* ------------------------------------------------------------- bootstrap */

  function start() {
    renderNav();
    var landing = window.MM.store.getProfile() ? "tracker" : "profile";
    navigate(landing);
    renderNavBadge();

    // Wire up accounts/sync. onState fires on init and on every auth change;
    // after a login pull replaces local state, refresh whatever view is open.
    window.MM.auth.onState(function (status) {
      renderAccount(status);
      refreshCurrent();
    });
    window.MM.auth.init();
  }

  return {
    start: start,
    navigate: navigate,
    addToLog: addToLog,
    remaining: remaining,
    totals: totals,
    state: state
  };
})();

document.addEventListener("DOMContentLoaded", function () { window.MM.app.start(); });
