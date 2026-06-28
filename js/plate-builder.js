/* Macro Map — interactive plate builder + quantity stepper.
 *
 * Exports:
 *   MM.plateBuilder.openPlateBuilder(chain, addToLogFn)
 *   MM.plateBuilder.openQtySlider(item, chain, addToLogFn)
 *
 * plate_sizes format (stored as JSONB in chains table):
 *   [{id, label, slots: [{role, label, count, optional}]}]
 *
 *   role maps to plate_config.category_roles[role] — the DB categories
 *   whose items fill that slot type. count > 1 creates multiple slots of
 *   the same role (e.g. Panda "Plate" has 2 entree slots). optional=true
 *   means the slot can be skipped and the Add button still enables.
 */
window.MM = window.MM || {};

window.MM.plateBuilder = (function () {
  var ui;

  function init() { ui = window.MM.ui; }

  /* -------------------------------------------------------- qty stepper */

  function openQtySlider(item, chain, addToLogFn) {
    init();
    var cfg = window.MM.getChainConfig(chain);
    var label = item.serving_label || cfg.qty_label || 'serving';
    var maxQ  = item.max_qty  || cfg.max_qty  || 10;
    var qty   = item.default_qty || cfg.default_qty || 1;

    var qtyNum  = ui.el('span', { class: 'qs-qty-num' }, String(qty));
    var qtyUnit = ui.el('span', { class: 'qs-qty-unit muted small' }, plural(label, qty));
    var macroWrap = ui.el('div', { class: 'qs-macros' });

    function update() {
      qtyNum.textContent = String(qty);
      qtyUnit.textContent = plural(label, qty);
      ui.clear(macroWrap);
      macroWrap.appendChild(ui.macroPills({
        kcal: item.kcal * qty, protein: item.protein * qty,
        carbs: item.carbs * qty, fat: item.fat * qty
      }));
    }
    update();

    var body = ui.el('div', { class: 'qs-body' }, [
      ui.el('div', { class: 'item-name' }, item.name),
      ui.el('div', { class: 'qs-per-serving muted small' },
        'Per ' + label + ': ' + ui.fmt(item.kcal) + ' cal · P ' + ui.fmt(item.protein) +
        'g · C ' + ui.fmt(item.carbs) + 'g · F ' + ui.fmt(item.fat) + 'g'
      ),
      ui.el('div', { class: 'qs-stepper' }, [
        ui.el('button', {
          class: 'icon-btn qs-step-btn', 'aria-label': 'Decrease',
          onclick: function () { if (qty > 1) { qty--; update(); } }
        }, '–'),
        ui.el('div', { class: 'qs-qty-display' }, [qtyNum, qtyUnit]),
        ui.el('button', {
          class: 'icon-btn qs-step-btn', 'aria-label': 'Increase',
          onclick: function () { if (qty < maxQ) { qty++; update(); } }
        }, '+')
      ]),
      macroWrap
    ]);

    ui.modal(chain.name, body, [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Add to Log', kind: 'primary', onClick: function () {
        addToLogFn(item, qty);
      } }
    ]);
  }

  /* ------------------------------------------------------- plate builder */

  /* Expand a size definition into a flat array of slot instances.
   * Each instance: { role, label, key, optional }
   * key is "role_index" e.g. "entree_0", "entree_1", "side_0" */
  function expandSlots(size) {
    var result = [];
    var slotDefs = size.slots || [];
    slotDefs.forEach(function (def) {
      var count = def.count || 1;
      for (var i = 0; i < count; i++) {
        var displayLabel = count > 1
          ? def.label + ' ' + (i + 1)
          : def.label;
        result.push({
          role:     def.role,
          label:    displayLabel,
          key:      def.role + '_' + i,
          optional: !!def.optional
        });
      }
    });
    return result;
  }

  /* Returns items that belong to a given role based on category_roles config */
  function itemsForRole(role, chain, cfg) {
    var cats = (cfg.category_roles && cfg.category_roles[role]) || [];
    return chain.items.filter(function (it) {
      return cats.indexOf(it.category) !== -1;
    });
  }

  /* CSS class for slot dot in size picker — first role gets "entree" color */
  function dotClass(role, firstRole) {
    return role === firstRole ? 'pb-dot entree' : 'pb-dot side';
  }

  /* Human-readable slot summary for size picker card subtitle */
  function slotSummary(size) {
    var seen  = {};
    var parts = [];
    (size.slots || []).forEach(function (def) {
      if (!seen[def.role]) {
        seen[def.role] = true;
        var n = def.count || 1;
        parts.push(n + ' ' + def.label.toLowerCase() + (n > 1 ? 's' : '') + (def.optional ? ' (opt.)' : ''));
      }
    });
    return parts.join(' + ');
  }

  function openPlateBuilder(chain, addToLogFn) {
    init();
    var cfg   = window.MM.getChainConfig(chain);
    var sizes = cfg.plate_sizes || [];

    // Mutable state
    var sizeChoice = null;
    var selections = {}; // { [slotKey]: item }

    function liveTotal() {
      var t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
      Object.keys(selections).forEach(function (k) {
        var it = selections[k];
        if (!it) return;
        t.kcal += it.kcal; t.protein += it.protein;
        t.carbs += it.carbs; t.fat += it.fat;
      });
      return t;
    }

    function allFilled() {
      if (!sizeChoice) return false;
      return expandSlots(sizeChoice).every(function (slot) {
        return slot.optional || !!selections[slot.key];
      });
    }

    var bodyEl = ui.el('div', { class: 'pb-body' });

    function rebuild() {
      ui.clear(bodyEl);
      if (!sizeChoice) {
        bodyEl.appendChild(renderSizePicker());
      } else {
        bodyEl.appendChild(renderPlateOverview());
        bodyEl.appendChild(renderLiveMacros());
        bodyEl.appendChild(renderAddBtn());
      }
    }

    /* Size picker */
    function renderSizePicker() {
      var wrap = ui.el('div', null, [
        ui.el('div', { class: 'pb-step-label' }, 'Choose your size'),
        ui.el('div', { class: 'pb-size-grid' })
      ]);
      var grid = wrap.querySelector('.pb-size-grid');
      sizes.forEach(function (s) {
        var firstRole = s.slots && s.slots[0] ? s.slots[0].role : 'entree';
        var dots = [];
        (s.slots || []).forEach(function (def) {
          for (var i = 0; i < (def.count || 1); i++) {
            dots.push(ui.el('span', { class: dotClass(def.role, firstRole) }, ''));
          }
        });
        grid.appendChild(ui.el('button', {
          class: 'pb-size-btn',
          onclick: function () { sizeChoice = s; selections = {}; rebuild(); }
        }, [
          ui.el('div', { class: 'pb-size-dots' }, dots),
          ui.el('div', { class: 'pb-size-label' }, s.label),
          ui.el('div', { class: 'pb-size-sub' }, slotSummary(s))
        ]));
      });
      return wrap;
    }

    /* Plate overview */
    function renderPlateOverview() {
      var wrap = ui.el('div', { class: 'pb-slots' });

      wrap.appendChild(ui.el('div', { class: 'pb-plate-header' }, [
        ui.el('button', {
          class: 'btn small ghost pb-back-btn',
          onclick: function () { sizeChoice = null; selections = {}; rebuild(); }
        }, '← Back'),
        ui.el('span', { class: 'pb-plate-name' }, sizeChoice.label)
      ]));

      expandSlots(sizeChoice).forEach(function (slot) {
        var slotItems = itemsForRole(slot.role, chain, cfg);
        var item = selections[slot.key] || null;
        var slotLabel = slot.label + (slot.optional ? ' (optional)' : '');

        wrap.appendChild(renderSlot(slotLabel, item,
          function (k) {
            return function () {
              openItemPicker('Choose ' + slot.label, slotItems, function (it) {
                selections[k] = it; rebuild();
              });
            };
          }(slot.key),
          function (k) {
            return function () { selections[k] = null; rebuild(); };
          }(slot.key)
        ));
      });

      return wrap;
    }

    function renderSlot(label, item, onPick, onClear) {
      if (item) {
        return ui.el('div', { class: 'pb-slot filled', onclick: onPick }, [
          ui.el('span', { class: 'pb-slot-label' }, label),
          ui.el('div', { class: 'pb-slot-info' }, [
            ui.el('div', { class: 'pb-slot-name' }, item.name),
            ui.el('div', { class: 'pb-slot-macro muted small' },
              ui.fmt(item.kcal) + ' cal · P ' + ui.fmt(item.protein) + 'g'
            )
          ]),
          ui.el('button', {
            class: 'pb-slot-clear', 'aria-label': 'Remove',
            onclick: function (e) { e.stopPropagation(); onClear(); }
          }, '×')
        ]);
      }
      return ui.el('div', { class: 'pb-slot empty', onclick: onPick }, [
        ui.el('span', { class: 'pb-slot-label' }, label),
        ui.el('div', { class: 'pb-slot-placeholder' }, [
          ui.el('span', { class: 'pb-slot-plus' }, '+'),
          ui.el('span', { class: 'muted small' }, 'Tap to choose')
        ])
      ]);
    }

    function renderLiveMacros() {
      var total = liveTotal();
      var slots = expandSlots(sizeChoice);
      var filled = slots.filter(function (s) { return !!selections[s.key]; }).length;
      var needed = slots.filter(function (s) { return !s.optional; }).length;
      return ui.el('div', { class: 'pb-live' }, [
        ui.el('div', { class: 'pb-live-label' },
          filled >= needed ? 'Plate total' : 'Running total (' + filled + '/' + needed + ' items)'
        ),
        ui.macroPills(total)
      ]);
    }

    function renderAddBtn() {
      var ready = allFilled();
      var total = liveTotal();
      return ui.el('button', {
        class: 'btn primary pb-add-btn' + (ready ? '' : ' pb-add-disabled'),
        disabled: ready ? null : 'disabled',
        onclick: function () {
          expandSlots(sizeChoice).forEach(function (slot) {
            var it = selections[slot.key];
            if (it) addToLogFn(it, 1);
          });
          closeFn();
          ui.toast('Added — ' + ui.fmt(total.kcal) + ' cal total', 'ok');
        }
      }, ready
        ? 'Add ' + sizeChoice.label + ' to Log (' + ui.fmt(total.kcal) + ' cal)'
        : 'Choose required items to add'
      );
    }

    /* Nested item picker modal */
    function openItemPicker(title, items, onSelect) {
      var searchEl = ui.el('input', {
        class: 'input', type: 'text', placeholder: 'Search items…'
      });
      var listEl = ui.el('div', { class: 'pb-picker-list' });

      function drawList(q) {
        ui.clear(listEl);
        var filtered = q
          ? items.filter(function (it) { return it.name.toLowerCase().indexOf(q) !== -1; })
          : items;
        if (!filtered.length) {
          listEl.appendChild(ui.el('div', { class: 'muted small' }, 'No items match.'));
          return;
        }
        filtered.forEach(function (it) {
          listEl.appendChild(ui.el('button', { class: 'pb-item-row', onclick: function () {
            closePickerFn();
            onSelect(it);
          } }, [
            ui.el('div', { class: 'pb-item-row-head' }, [
              ui.el('div', { class: 'item-name pb-item-name' }, it.name),
              ui.el('div', { class: 'muted small' }, it.category || '')
            ]),
            ui.macroPills(it)
          ]));
        });
      }

      searchEl.addEventListener('input', function () {
        drawList(searchEl.value.trim().toLowerCase());
      });
      drawList('');

      var pickerBody = ui.el('div', { class: 'pb-picker-body' }, [searchEl, listEl]);
      var closePickerFn = ui.modal(title, pickerBody, [{ label: 'Cancel', kind: 'ghost' }]);
    }

    var closeFn = ui.modal(chain.name + ' — Build your order', bodyEl, [
      { label: 'Cancel', kind: 'ghost' }
    ]);

    rebuild();
  }

  /* --------------------------------------------------------- util */

  function plural(label, n) {
    if (n === 1) return label;
    return label + 's';
  }

  return {
    openPlateBuilder: openPlateBuilder,
    openQtySlider:    openQtySlider
  };
})();
