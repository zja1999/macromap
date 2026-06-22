/* Macro Map — shared UI helpers: DOM building, formatting, toasts, modal. */
window.MM = window.MM || {};

window.MM.ui = (function () {

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null) {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function fmt(n) {
    if (n == null || isNaN(n)) return "—";
    return Math.round(n).toLocaleString();
  }

  function macroRow(label, value, target, cls) {
    var pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;
    var over = target > 0 && value > target;
    var wrap = el("div", { class: "macro-row" }, [
      el("div", { class: "macro-row-head" }, [
        el("span", { class: "macro-label" }, label),
        el("span", { class: "macro-val" + (over ? " over" : "") },
          fmt(value) + (target ? " / " + fmt(target) : ""))
      ]),
      el("div", { class: "bar" }, [
        el("div", { class: "bar-fill " + (cls || ""), style: "width:" + pct + "%" })
      ])
    ]);
    return wrap;
  }

  // Small circular calorie ring (SVG). consumed/target -> ring.
  function calorieRing(consumed, target) {
    var size = 132, stroke = 12, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    var frac = target > 0 ? Math.min(consumed / target, 1) : 0;
    var over = target > 0 && consumed > target;
    var remaining = Math.max(target - consumed, 0);
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + size + " " + size);
    svg.setAttribute("class", "ring");
    function circle(color, dash) {
      var ci = document.createElementNS(ns, "circle");
      ci.setAttribute("cx", size / 2); ci.setAttribute("cy", size / 2);
      ci.setAttribute("r", r); ci.setAttribute("fill", "none");
      ci.setAttribute("stroke", color); ci.setAttribute("stroke-width", stroke);
      ci.setAttribute("stroke-linecap", "round");
      if (dash != null) {
        ci.setAttribute("stroke-dasharray", c);
        ci.setAttribute("stroke-dashoffset", c * (1 - dash));
        ci.setAttribute("transform", "rotate(-90 " + size / 2 + " " + size / 2 + ")");
      }
      return ci;
    }
    svg.appendChild(circle("var(--ring-track)"));
    svg.appendChild(circle(over ? "var(--danger)" : "var(--accent)", frac));
    var wrap = el("div", { class: "ring-wrap" }, [svg]);
    var center = el("div", { class: "ring-center" }, [
      el("div", { class: "ring-num" }, fmt(remaining)),
      el("div", { class: "ring-label" }, over ? "over by " + fmt(consumed - target) : "cal left")
    ]);
    wrap.appendChild(center);
    return wrap;
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var host = document.getElementById("toast");
    if (!host) return;
    host.textContent = msg;
    host.className = "toast show " + (kind || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { host.className = "toast"; }, 3200);
  }

  // Simple modal. content is a DOM node. Returns a close() fn.
  function modal(title, content, actions) {
    var overlay = el("div", { class: "modal-overlay" });
    var close = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    var head = el("div", { class: "modal-head" }, [
      el("h3", null, title),
      el("button", { class: "icon-btn", onclick: close, "aria-label": "Close" }, "✕")
    ]);
    var body = el("div", { class: "modal-body" }, [content]);
    var foot = el("div", { class: "modal-foot" });
    (actions || []).forEach(function (a) {
      foot.appendChild(el("button", {
        class: "btn " + (a.kind || ""),
        onclick: function () { var keep = a.onClick && a.onClick(); if (!keep) close(); }
      }, a.label));
    });
    var box = el("div", { class: "modal" }, [head, body, actions && actions.length ? foot : null]);
    overlay.appendChild(box);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    return close;
  }

  function macroPills(item) {
    return el("div", { class: "pills" }, [
      el("span", { class: "pill cal" }, fmt(item.kcal) + " cal"),
      el("span", { class: "pill p" }, "P " + fmt(item.protein) + "g"),
      el("span", { class: "pill c" }, "C " + fmt(item.carbs) + "g"),
      el("span", { class: "pill f" }, "F " + fmt(item.fat) + "g")
    ]);
  }

  function badge(text, cls) { return el("span", { class: "badge " + (cls || "") }, text); }

  return {
    el: el, clear: clear, escapeHtml: escapeHtml, fmt: fmt,
    macroRow: macroRow, calorieRing: calorieRing, toast: toast,
    modal: modal, macroPills: macroPills, badge: badge
  };
})();
