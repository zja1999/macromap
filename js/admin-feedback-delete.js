/* Macro Map — admin feedback deletion enhancement.
 *
 * Loaded after app.js so the owner-only Admin feedback list can delete rows
 * without widening access beyond Supabase Row-Level Security. The database
 * still enforces the real permission boundary via supabase/admin-schema.sql.
 */
window.MM = window.MM || {};

(function () {
  var lastFeedbackRows = [];
  var scheduled = false;

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

  function deleteFeedback(id) {
    if (!cfg().supabaseUrl || !cfg().supabaseAnonKey) {
      return Promise.reject(new Error("Feedback deletion needs the app's cloud connection."));
    }
    return fetch(cfg().supabaseUrl + "/rest/v1/feedback?id=eq." + encodeURIComponent(id), {
      method: "DELETE",
      headers: Object.assign({ Prefer: "return=minimal" }, authHeaders())
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || "Couldn't delete feedback."); });
      return true;
    });
  }

  function performDelete(feedback, row, button) {
    if (!feedback || !feedback.id) return;
    if (button) {
      button.disabled = true;
      button.textContent = "Deleting...";
    }

    deleteFeedback(feedback.id).then(function () {
      lastFeedbackRows = lastFeedbackRows.filter(function (f) { return f.id !== feedback.id; });
      if (row && row.parentNode) row.parentNode.removeChild(row);
      var host = document.getElementById("admin-feedback");
      if (host && !host.querySelector(".admin-row")) {
        var empty = document.createElement("div");
        empty.className = "muted small";
        empty.textContent = "No feedback yet.";
        host.appendChild(empty);
      }
      toast("Feedback deleted", "ok");
    }).catch(function (e) {
      if (button) {
        button.disabled = false;
        button.textContent = "Delete";
      }
      toast((e && e.message) || "Couldn't delete feedback.", "err");
    });
  }

  function confirmDelete(feedback, row, button) {
    var ui = window.MM.ui;
    if (ui && ui.modal && ui.el) {
      ui.modal("Delete feedback?", ui.el("div", null, [
        ui.el("p", null, "This permanently deletes this feedback entry from Supabase."),
        ui.el("p", { class: "muted small" }, snippet(feedback.message))
      ]), [
        { label: "Cancel", kind: "ghost" },
        { label: "Delete", kind: "danger", onClick: function () { performDelete(feedback, row, button); } }
      ]);
      return;
    }

    if (window.confirm("Delete this feedback permanently?")) performDelete(feedback, row, button);
  }

  function addDeleteButtons() {
    var data = window.MM.data;
    if (!data || !data.isAdmin || !data.isAdmin()) return;

    var host = document.getElementById("admin-feedback");
    if (!host || !lastFeedbackRows.length) return;

    var rows = host.querySelectorAll(".admin-row");
    Array.prototype.forEach.call(rows, function (row, idx) {
      var feedback = lastFeedbackRows[idx];
      if (!feedback || !feedback.id) return;
      if (row.getAttribute("data-feedback-delete") === feedback.id) return;

      row.setAttribute("data-feedback-delete", feedback.id);
      var actions = row.querySelector(".admin-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "admin-actions";
        row.appendChild(actions);
      }

      var button = document.createElement("button");
      button.className = "btn small danger";
      button.type = "button";
      button.textContent = "Delete";
      button.addEventListener("click", function () { confirmDelete(feedback, row, button); });
      actions.appendChild(button);
    });
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      addDeleteButtons();
    }, 0);
  }

  function wrapFetchFeedback() {
    var data = window.MM.data;
    if (!data || !data.fetchFeedback || data._feedbackDeleteWrapped) return;

    var originalFetchFeedback = data.fetchFeedback;
    data.fetchFeedback = function () {
      return originalFetchFeedback.apply(data, arguments).then(function (rows) {
        lastFeedbackRows = Array.isArray(rows) ? rows.slice() : [];
        scheduleEnhance();
        return rows;
      });
    };
    data.deleteFeedback = deleteFeedback;
    data._feedbackDeleteWrapped = true;
  }

  wrapFetchFeedback();
  scheduleEnhance();

  if (window.MutationObserver) {
    var adminView = document.getElementById("view-admin");
    if (adminView) {
      new MutationObserver(scheduleEnhance).observe(adminView, { childList: true, subtree: true });
    }
  }
})();
