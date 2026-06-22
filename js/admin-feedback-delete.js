/* Macro Map — admin row deletion controls.
 *
 * Loaded after app.js so the owner-only Admin lists can delete rows without
 * widening access beyond Supabase Row-Level Security. The database still
 * enforces the real permission boundary via supabase/admin-schema.sql.
 */
window.MM = window.MM || {};

(function () {
  var lastRequestRows = [];
  var lastFeedbackRows = [];
  var scheduled = false;

  var LISTS = {
    request: {
      hostId: "admin-requests",
      table: "data_requests",
      emptyText: "No requests yet.",
      singular: "chain request",
      plural: "chain requests",
      getRows: function () { return requestRowsForDisplay(); },
      setRows: function (rows) { lastRequestRows = rows; },
      preview: function (row) { return row.chain || "Chain request"; }
    },
    feedback: {
      hostId: "admin-feedback",
      table: "feedback",
      emptyText: "No feedback yet.",
      singular: "feedback entry",
      plural: "feedback entries",
      getRows: function () { return lastFeedbackRows; },
      setRows: function (rows) { lastFeedbackRows = rows; },
      preview: function (row) { return row.message || "Feedback"; }
    }
  };

  function cfg() { return window.MM.CONFIG || {}; }

  function authHeaders() {
    var token = (window.MM.auth && window.MM.auth.accessToken && window.MM.auth.accessToken()) || cfg().supabaseAnonKey;
    return { apikey: cfg().supabaseAnonKey, Authorization: "Bearer " + token };
  }

  function toast(message, kind) {
    if (window.MM.ui && window.MM.ui.toast) window.MM.ui.toast(message, kind);
  }

  function snippet(message) {
    var s = String(message || "").replace(/\s+/g, " ").trim();
    return s.length > 140 ? s.slice(0, 137) + "..." : s;
  }

  function requestRowsForDisplay() {
    return lastRequestRows.slice().sort(function (a, b) {
      return (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1);
    });
  }

  function deleteRow(type, id) {
    var spec = LISTS[type];
    if (!spec) return Promise.reject(new Error("Unknown admin list."));
    if (!cfg().supabaseUrl || !cfg().supabaseAnonKey) {
      return Promise.reject(new Error("Deletion needs the app's cloud connection."));
    }
    return fetch(cfg().supabaseUrl + "/rest/v1/" + spec.table + "?id=eq." + encodeURIComponent(id), {
      method: "DELETE",
      headers: Object.assign({ Prefer: "return=minimal" }, authHeaders())
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || "Couldn't delete row."); });
      return true;
    });
  }

  function removeDeletedRows(type, ids) {
    var spec = LISTS[type];
    var idSet = {};
    ids.forEach(function (id) { idSet[id] = true; });
    spec.setRows((type === "request" ? lastRequestRows : lastFeedbackRows).filter(function (row) {
      return !idSet[row.id];
    }));

    var host = document.getElementById(spec.hostId);
    if (!host) return;
    ids.forEach(function (id) {
      var row = host.querySelector('.admin-row[data-admin-row-id="' + cssEscape(id) + '"]');
      if (row && row.parentNode) row.parentNode.removeChild(row);
    });
    refreshToolbar(type);
    refreshEmpty(type);
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(String(value));
    return String(value).replace(/"/g, '\\"');
  }

  function refreshEmpty(type) {
    var spec = LISTS[type];
    var host = document.getElementById(spec.hostId);
    if (!host) return;
    if (!host.querySelector(".admin-row")) {
      var old = host.querySelector(".admin-empty");
      if (old) old.remove();
      var empty = document.createElement("div");
      empty.className = "muted small admin-empty";
      empty.textContent = spec.emptyText;
      host.appendChild(empty);
    }
  }

  function selectedInputs(type) {
    var spec = LISTS[type];
    var host = document.getElementById(spec.hostId);
    if (!host) return [];
    return Array.prototype.slice.call(host.querySelectorAll('input[data-admin-select="' + type + '"]:checked'));
  }

  function selectedIds(type) {
    return selectedInputs(type).map(function (input) { return input.value; });
  }

  function refreshToolbar(type) {
    var spec = LISTS[type];
    var host = document.getElementById(spec.hostId);
    if (!host) return;
    var toolbar = host.querySelector('[data-admin-toolbar="' + type + '"]');
    if (!toolbar) return;

    var all = Array.prototype.slice.call(host.querySelectorAll('input[data-admin-select="' + type + '"]'));
    var checked = selectedInputs(type);
    var selectAll = toolbar.querySelector('input[data-admin-select-all="' + type + '"]');
    var deleteButton = toolbar.querySelector('button[data-admin-delete-selected="' + type + '"]');

    if (selectAll) {
      selectAll.checked = !!all.length && checked.length === all.length;
      selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
      selectAll.disabled = !all.length;
    }
    if (deleteButton) {
      deleteButton.disabled = !checked.length;
      deleteButton.textContent = checked.length ? "Delete selected (" + checked.length + ")" : "Delete selected";
    }
  }

  function createToolbar(type) {
    var spec = LISTS[type];
    var toolbar = document.createElement("div");
    toolbar.className = "form-actions admin-bulk-actions";
    toolbar.setAttribute("data-admin-toolbar", type);

    var label = document.createElement("label");
    label.className = "check tiny";

    var selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.setAttribute("data-admin-select-all", type);
    selectAll.addEventListener("change", function () {
      var host = document.getElementById(spec.hostId);
      if (!host) return;
      Array.prototype.forEach.call(host.querySelectorAll('input[data-admin-select="' + type + '"]'), function (input) {
        input.checked = selectAll.checked;
      });
      refreshToolbar(type);
    });

    label.appendChild(selectAll);
    label.appendChild(document.createTextNode("Select all"));

    var deleteSelected = document.createElement("button");
    deleteSelected.className = "btn small danger";
    deleteSelected.type = "button";
    deleteSelected.disabled = true;
    deleteSelected.textContent = "Delete selected";
    deleteSelected.setAttribute("data-admin-delete-selected", type);
    deleteSelected.addEventListener("click", function () { confirmBulkDelete(type); });

    toolbar.appendChild(label);
    toolbar.appendChild(deleteSelected);
    return toolbar;
  }

  function ensureToolbar(type) {
    var spec = LISTS[type];
    var host = document.getElementById(spec.hostId);
    if (!host || !host.querySelector(".admin-row")) return;
    if (host.querySelector('[data-admin-toolbar="' + type + '"]')) return;
    host.insertBefore(createToolbar(type), host.firstChild);
    refreshToolbar(type);
  }

  function confirmSingleDelete(type, item, row, button) {
    var spec = LISTS[type];
    var ui = window.MM.ui;
    var bodyText = "This permanently deletes this " + spec.singular + " from Supabase.";
    if (ui && ui.modal && ui.el) {
      ui.modal("Delete " + spec.singular + "?", ui.el("div", null, [
        ui.el("p", null, bodyText),
        ui.el("p", { class: "muted small" }, snippet(spec.preview(item)))
      ]), [
        { label: "Cancel", kind: "ghost" },
        { label: "Delete", kind: "danger", onClick: function () { performSingleDelete(type, item, row, button); } }
      ]);
      return;
    }

    if (window.confirm("Delete this " + spec.singular + " permanently?")) performSingleDelete(type, item, row, button);
  }

  function performSingleDelete(type, item, row, button) {
    if (!item || !item.id) return;
    if (button) {
      button.disabled = true;
      button.textContent = "Deleting...";
    }

    deleteRow(type, item.id).then(function () {
      removeDeletedRows(type, [item.id]);
      toast(capitalize(LISTS[type].singular) + " deleted", "ok");
    }).catch(function (e) {
      if (button) {
        button.disabled = false;
        button.textContent = "Delete";
      }
      toast((e && e.message) || "Couldn't delete row.", "err");
    });
  }

  function confirmBulkDelete(type) {
    var ids = selectedIds(type);
    if (!ids.length) return;
    var spec = LISTS[type];
    var ui = window.MM.ui;
    var label = ids.length === 1 ? spec.singular : spec.plural;

    if (ui && ui.modal && ui.el) {
      ui.modal("Delete selected?", ui.el("p", null,
        "This permanently deletes " + ids.length + " selected " + label + " from Supabase."), [
        { label: "Cancel", kind: "ghost" },
        { label: "Delete selected", kind: "danger", onClick: function () { performBulkDelete(type, ids); } }
      ]);
      return;
    }

    if (window.confirm("Delete " + ids.length + " selected " + label + " permanently?")) performBulkDelete(type, ids);
  }

  function performBulkDelete(type, ids) {
    var spec = LISTS[type];
    var host = document.getElementById(spec.hostId);
    if (host) {
      var button = host.querySelector('button[data-admin-delete-selected="' + type + '"]');
      if (button) {
        button.disabled = true;
        button.textContent = "Deleting...";
      }
    }

    Promise.all(ids.map(function (id) { return deleteRow(type, id); })).then(function () {
      removeDeletedRows(type, ids);
      toast("Deleted " + ids.length + " " + (ids.length === 1 ? spec.singular : spec.plural), "ok");
    }).catch(function (e) {
      refreshToolbar(type);
      toast((e && e.message) || "Couldn't delete selected rows.", "err");
    });
  }

  function capitalize(text) {
    return String(text || "").charAt(0).toUpperCase() + String(text || "").slice(1);
  }

  function enhanceRows(type) {
    var spec = LISTS[type];
    var data = window.MM.data;
    if (!data || !data.isAdmin || !data.isAdmin()) return;

    var host = document.getElementById(spec.hostId);
    if (!host) return;
    var sourceRows = spec.getRows();
    if (!sourceRows.length) return;

    ensureToolbar(type);
    var rows = host.querySelectorAll(".admin-row");
    Array.prototype.forEach.call(rows, function (row, idx) {
      var item = sourceRows[idx];
      if (!item || !item.id) return;
      if (row.getAttribute("data-admin-row-id") === item.id) return;

      row.setAttribute("data-admin-row-id", item.id);
      row.setAttribute("data-admin-row-type", type);

      var main = row.querySelector(".admin-main") || row.firstElementChild;
      if (main && !row.querySelector('input[data-admin-select="' + type + '"]')) {
        var check = document.createElement("input");
        check.type = "checkbox";
        check.value = item.id;
        check.setAttribute("data-admin-select", type);
        check.setAttribute("aria-label", "Select " + spec.singular);
        check.addEventListener("change", function () { refreshToolbar(type); });
        row.insertBefore(check, row.firstChild);
      }

      var actions = row.querySelector(".admin-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "admin-actions";
        row.appendChild(actions);
      }

      if (!actions.querySelector('button[data-admin-delete-row="' + type + '"]')) {
        var button = document.createElement("button");
        button.className = "btn small danger";
        button.type = "button";
        button.textContent = "Delete";
        button.setAttribute("data-admin-delete-row", type);
        button.addEventListener("click", function () { confirmSingleDelete(type, item, row, button); });
        actions.appendChild(button);
      }
    });
    refreshToolbar(type);
  }

  function addAdminControls() {
    enhanceRows("request");
    enhanceRows("feedback");
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      addAdminControls();
    }, 0);
  }

  function wrapAdminFetches() {
    var data = window.MM.data;
    if (!data || data._adminDeleteWrapped) return;

    if (data.fetchRequests) {
      var originalFetchRequests = data.fetchRequests;
      data.fetchRequests = function () {
        return originalFetchRequests.apply(data, arguments).then(function (rows) {
          lastRequestRows = Array.isArray(rows) ? rows.slice() : [];
          scheduleEnhance();
          return rows;
        });
      };
    }

    if (data.fetchFeedback) {
      var originalFetchFeedback = data.fetchFeedback;
      data.fetchFeedback = function () {
        return originalFetchFeedback.apply(data, arguments).then(function (rows) {
          lastFeedbackRows = Array.isArray(rows) ? rows.slice() : [];
          scheduleEnhance();
          return rows;
        });
      };
    }

    data.deleteAdminRequest = function (id) { return deleteRow("request", id); };
    data.deleteFeedback = function (id) { return deleteRow("feedback", id); };
    data._adminDeleteWrapped = true;
  }

  wrapAdminFetches();
  scheduleEnhance();

  if (window.MutationObserver) {
    var adminView = document.getElementById("view-admin");
    if (adminView) {
      new MutationObserver(scheduleEnhance).observe(adminView, { childList: true, subtree: true });
    }
  }
})();
