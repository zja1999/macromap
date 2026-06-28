/* Macro Map — interactive plate builder + quantity stepper.
 *
 * Exports:
 *   MM.plateBuilder.openPlateBuilder(chain, addToLogFn)
 *   MM.plateBuilder.openQtySlider(item, chain, addToLogFn)
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

  function openPlateBuilder(chain, addToLogFn) {
    init();
    var cfg   = window.MM.getChainConfig(chain);
    var sizes = cfg.plate_sizes || [];
    var roles = cfg.category_roles || { entree: [], side: [] };

    // Partition items by slot role
    var entreeItems = chain.items.filter(function (it) {
      return roles.entree.indexOf(it.category) !== -1;
    });
    var sideItems = chain.items.filter(function (it) {
      return roles.side.indexOf(it.category) !== -1;
    });

    // Mutable selection state
    var sizeChoice = null;
    var entrees    = [];   // sparse — length == sizeChoice.entrees
    var sideChoice = null;

    function liveTotal() {
      var t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
      entrees.forEach(function (it) {
        if (!it) return;
        t.kcal += it.kcal; t.protein += it.protein;
        t.carbs += it.carbs; t.fat += it.fat;
      });
      if (sideChoice) {
        t.kcal += sideChoice.kcal; t.protein += sideChoice.protein;
        t.carbs += sideChoice.carbs; t.fat += sideChoice.fat;
      }
      return t;
    }

    function allFilled() {
      if (!sizeChoice) return false;
      for (var i = 0; i < sizeChoice.entrees; i++) { if (!entrees[i]) return false; }
      return !!sideChoice;
    }

    // The modal body container — redrawn in place without reopening modal
    var bodyEl = ui.el('div', { class: 'pb-body' });

    function rebuild() {
      ui.clear(bodyEl);
      if (!sizeChoice) {
        bodyEl.appendChild(renderSizePicker(sizes, function (s) {
          sizeChoice = s;
          entrees = new Array(s.entrees);
          rebuild();
        }));
      } else {
        bodyEl.appendChild(renderPlateOverview());
        bodyEl.appendChild(renderLiveMacros());
        bodyEl.appendChild(renderAddBtn());
      }
    }

    /* Size picker */
    function renderSizePicker(sizes, onPick) {
      var wrap = ui.el('div', null, [
        ui.el('div', { class: 'pb-step-label' }, 'Choose your plate size'),
        ui.el('div', { class: 'pb-size-grid' })
      ]);
      var grid = wrap.querySelector('.pb-size-grid');
      sizes.forEach(function (s) {
        var dots = [];
        for (var i = 0; i < s.entrees; i++) dots.push(ui.el('span', { class: 'pb-dot entree' }, ''));
        dots.push(ui.el('span', { class: 'pb-dot side' }, ''));
        grid.appendChild(ui.el('button', { class: 'pb-size-btn', onclick: function () { onPick(s); } }, [
          ui.el('div', { class: 'pb-size-dots' }, dots),
          ui.el('div', { class: 'pb-size-label' }, s.label),
          ui.el('div', { class: 'pb-size-sub' }, s.entrees + ' entree' + (s.entrees > 1 ? 's' : '') + ' + 1 side')
        ]));
      });
      return wrap;
    }

    /* Plate overview with filled/empty slot cards */
    function renderPlateOverview() {
      var slots = ui.el('div', { class: 'pb-slots' });

      // Header with back button
      var header = ui.el('div', { class: 'pb-plate-header' }, [
        ui.el('button', { class: 'btn small ghost pb-back-btn', onclick: function () {
          sizeChoice = null; entrees = []; sideChoice = null; rebuild();
        } }, '← Back'),
        ui.el('span', { class: 'pb-plate-name' }, sizeChoice.label)
      ]);
      slots.appendChild(header);

      // Entree slots
      for (var i = 0; i < sizeChoice.entrees; i++) {
        slots.appendChild(renderSlot('Entree', entrees[i], (function (idx) {
          return function () {
            openItemPicker('Choose an Entree', entreeItems, function (it) {
              entrees[idx] = it; rebuild();
            });
          };
        })(i), function (idx) {
          return function () { entrees[idx] = null; rebuild(); };
        }(i)));
      }

      // Side slot
      slots.appendChild(renderSlot('Side', sideChoice,
        function () {
          openItemPicker('Choose a Side', sideItems, function (it) {
            sideChoice = it; rebuild();
          });
        },
        function () { sideChoice = null; rebuild(); }
      ));

      return slots;
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

    /* Live macro total strip */
    function renderLiveMacros() {
      var total = liveTotal();
      var filled = entrees.filter(Boolean).length + (sideChoice ? 1 : 0);
      var needed = (sizeChoice ? sizeChoice.entrees : 0) + 1;
      var wrap = ui.el('div', { class: 'pb-live' }, [
        ui.el('div', { class: 'pb-live-label' },
          filled === needed ? 'Plate total' : 'Running total (' + filled + '/' + needed + ' items)'
        ),
        ui.macroPills(total)
      ]);
      return wrap;
    }

    /* Add to log button */
    function renderAddBtn() {
      var ready = allFilled();
      var total = liveTotal();
      return ui.el('button', {
        class: 'btn primary pb-add-btn' + (ready ? '' : ' pb-add-disabled'),
        disabled: ready ? null : 'disabled',
        onclick: function () {
          entrees.forEach(function (it) { if (it) addToLogFn(it, 1); });
          if (sideChoice) addToLogFn(sideChoice, 1);
          closeFn();
          ui.toast('Plate added — ' + ui.fmt(total.kcal) + ' cal total', 'ok');
        }
      }, ready
        ? 'Add ' + sizeChoice.label + ' to Log (' + ui.fmt(total.kcal) + ' cal)'
        : 'Choose all items to add'
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

    // Open the main modal — body is the mutable container
    var closeFn = ui.modal(chain.name + ' — Build your plate', bodyEl, [
      { label: 'Cancel', kind: 'ghost' }
    ]);

    rebuild();
  }

  /* --------------------------------------------------------- util */

  function plural(label, n) {
    if (n === 1) return label;
    // simple pluralisation: "slice" → "slices", "wing" → "wings"
    return label + 's';
  }

  return {
    openPlateBuilder: openPlateBuilder,
    openQtySlider:    openQtySlider
  };
})();
