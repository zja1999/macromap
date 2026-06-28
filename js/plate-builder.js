/* Macro Map — interactive plate builder + quantity stepper.
 *
 * Exports:
 *   MM.plateBuilder.openPlateBuilder(chain, addToLogFn)
 *   MM.plateBuilder.openQtySlider(item, chain, addToLogFn)
 *
 * plate_sizes slot def flags:
 *   count   — fixed number of slots of this role (default 1)
 *   optional — slot can be empty; Add button still enables
 *   dynamic  — grows: each filled slot reveals a new empty one (unlimited)
 *              dynamic slots are always optional
 *
 * Double toggle: on any filled non-dynamic slot, a "Dbl" button marks
 * the item as ×2, doubling its macro contribution and logging qty=2.
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

  /* Expand size slots into flat slot instances.
   *
   * Fixed slots: one instance per count.
   * Dynamic slots: (filled count + 1) instances — the extra one is empty,
   * and disappears if its predecessor is also empty (no phantom gaps).
   *
   * sel — current selections map { [key]: item } (needed for dynamic count)
   */
  function expandSlots(size, sel) {
    sel = sel || {};
    var result = [];
    (size.slots || []).forEach(function (def) {
      if (def.dynamic) {
        // Find first empty index to determine how many slots to show
        var i = 0;
        while (sel[def.role + '_' + i]) i++;
        // Show all filled + 1 trailing empty
        for (var j = 0; j <= i; j++) {
          result.push({
            role:     def.role,
            label:    i > 0 ? def.label + ' ' + (j + 1) : def.label,
            key:      def.role + '_' + j,
            optional: true,
            dynamic:  true
          });
        }
      } else {
        var count = def.count || 1;
        for (var k = 0; k < count; k++) {
          result.push({
            role:     def.role,
            label:    count > 1 ? def.label + ' ' + (k + 1) : def.label,
            key:      def.role + '_' + k,
            optional: !!def.optional,
            dynamic:  false
          });
        }
      }
    });
    return result;
  }

  function itemsForRole(role, chain, cfg) {
    var cats = (cfg.category_roles && cfg.category_roles[role]) || [];
    return chain.items.filter(function (it) {
      return cats.indexOf(it.category) !== -1;
    });
  }

  function dotClass(role, firstRole) {
    return role === firstRole ? 'pb-dot entree' : 'pb-dot side';
  }

  function slotSummary(size) {
    var seen  = {};
    var parts = [];
    (size.slots || []).forEach(function (def) {
      if (seen[def.role]) return;
      seen[def.role] = true;
      var n = def.count || 1;
      if (def.dynamic) {
        parts.push(def.label.toLowerCase() + 's (opt.)');
      } else {
        parts.push(n + ' ' + def.label.toLowerCase() + (n > 1 ? 's' : '') + (def.optional ? ' (opt.)' : ''));
      }
    });
    return parts.join(' + ');
  }

  function openPlateBuilder(chain, addToLogFn) {
    init();
    var cfg   = window.MM.getChainConfig(chain);
    var sizes = cfg.plate_sizes || [];

    var sizeChoice = null;
    var selections = {}; // { [key]: item }
    var doubles    = {}; // { [key]: true } — marks slot as ×2

    function liveTotal() {
      var t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
      Object.keys(selections).forEach(function (k) {
        var it = selections[k];
        if (!it) return;
        var m = doubles[k] ? 2 : 1;
        t.kcal += it.kcal * m; t.protein += it.protein * m;
        t.carbs += it.carbs * m; t.fat += it.fat * m;
      });
      return t;
    }

    function allFilled() {
      if (!sizeChoice) return false;
      return expandSlots(sizeChoice, selections).every(function (slot) {
        return slot.optional || slot.dynamic || !!selections[slot.key];
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
          if (def.dynamic) {
            dots.push(ui.el('span', { class: dotClass(def.role, firstRole) + ' pb-dot-dashed' }, ''));
          } else {
            for (var i = 0; i < (def.count || 1); i++) {
              dots.push(ui.el('span', { class: dotClass(def.role, firstRole) }, ''));
            }
          }
        });
        grid.appendChild(ui.el('button', {
          class: 'pb-size-btn',
          onclick: function () { sizeChoice = s; selections = {}; doubles = {}; rebuild(); }
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
          onclick: function () { sizeChoice = null; selections = {}; doubles = {}; rebuild(); }
        }, '← Back'),
        ui.el('span', { class: 'pb-plate-name' }, sizeChoice.label)
      ]));

      expandSlots(sizeChoice, selections).forEach(function (slot) {
        var slotItems = itemsForRole(slot.role, chain, cfg);
        var item = selections[slot.key] || null;
        var slotLabel = slot.label + (slot.optional && !slot.dynamic ? ' (optional)' : '');

        wrap.appendChild(renderSlot(
          slotLabel, item, slot.key, slot.dynamic,
          function (k) {
            return function () {
              openItemPicker('Choose ' + slot.label, slotItems, function (it) {
                selections[k] = it; rebuild();
              });
            };
          }(slot.key),
          function (k) {
            return function () { delete selections[k]; delete doubles[k]; rebuild(); };
          }(slot.key)
        ));
      });

      return wrap;
    }

    /* slot.dynamic=true hides the double toggle (pick the same item twice instead) */
    function renderSlot(label, item, key, isDynamic, onPick, onClear) {
      if (item) {
        var isDbl = !!doubles[key];
        var m     = isDbl ? 2 : 1;
        var actions = [];
        if (!isDynamic) {
          actions.push(ui.el('button', {
            class: 'pb-slot-dbl' + (isDbl ? ' active' : ''),
            'aria-label': isDbl ? 'Remove double' : 'Make double',
            onclick: function (e) {
              e.stopPropagation();
              if (doubles[key]) { delete doubles[key]; } else { doubles[key] = true; }
              rebuild();
            }
          }, isDbl ? '×2 on' : 'Dbl'));
        }
        actions.push(ui.el('button', {
          class: 'pb-slot-clear', 'aria-label': 'Remove',
          onclick: function (e) { e.stopPropagation(); onClear(); }
        }, '×'));

        return ui.el('div', { class: 'pb-slot filled', onclick: onPick }, [
          ui.el('span', { class: 'pb-slot-label' }, label),
          ui.el('div', { class: 'pb-slot-info' }, [
            ui.el('div', { class: 'pb-slot-name' }, item.name + (isDbl ? ' ×2' : '')),
            ui.el('div', { class: 'pb-slot-macro muted small' },
              ui.fmt(item.kcal * m) + ' cal · P ' + ui.fmt(item.protein * m) + 'g'
            )
          ]),
          ui.el('div', { class: 'pb-slot-actions' }, actions)
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
      var slots = expandSlots(sizeChoice, selections);
      var filled = slots.filter(function (s) { return !!selections[s.key]; }).length;
      var needed = slots.filter(function (s) { return !s.optional && !s.dynamic; }).length;
      return ui.el('div', { class: 'pb-live' }, [
        ui.el('div', { class: 'pb-live-label' },
          filled >= needed ? 'Order total' : 'Running total (' + filled + '/' + needed + ' required)'
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
          expandSlots(sizeChoice, selections).forEach(function (slot) {
            var it = selections[slot.key];
            if (it) addToLogFn(it, doubles[slot.key] ? 2 : 1);
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
