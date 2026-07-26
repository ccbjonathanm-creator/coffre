/*
 * Coffre, bibliothèque d'icônes bitmap 3D premium.
 * Couche strictement visuelle : aucun état ni comportement métier.
 */
(function (root) {
  "use strict";

  const ICONS = new Set([
    "addtx", "antenna", "backspace", "bank", "beer", "briefcase", "broom", "bulb",
    "burger", "calendar", "car", "card", "cart", "chart", "check",
    "cigarette", "clock", "coat", "coffee", "download", "droplet", "fish",
    "fuel", "game", "gift", "grad", "handshake", "hospital", "house", "key",
    "lock", "medical", "moneywings", "music", "package", "paw", "phone",
    "pig", "pill", "plane", "plus", "receipt", "repeat", "search", "settings",
    "shield", "slot", "spark", "stetho", "tag", "target", "trash", "trophy",
    "tv", "upload", "warning", "wrench"
  ]);

  const ALIASES = {
    alimentation: "cart",
    restaurant: "burger",
    logement: "house",
    transport: "car",
    factures: "receipt",
    sante: "pill",
    loisirs: "trophy",
    abonnements: "repeat",
    vetements: "coat",
    shopping: "gift",
    banque: "bank",
    credits: "card",
    jeux: "slot",
    epargne: "pig",
    voyage: "plane",
    tabac: "cigarette",
    autres: "moneywings",
    salaire: "briefcase",
    aide: "handshake",
    remboursement: "repeat",
    vente: "tag",
    autres_in: "moneywings",
    home: "house",
    // app.js demande "chartdown" (dépenses en baisse) : pas d'asset dédié pour
    // l'instant, on retombe sur le graphique plutôt que sur l'étincelle générique.
    chartdown: "chart"
  };

  function canonical(requestedName) {
    const requested = String(requestedName || "spark").toLowerCase();
    const resolved = ALIASES[requested] || requested;
    return ICONS.has(resolved) ? resolved : "spark";
  }

  function safeClasses(extraClass) {
    return String(extraClass || "")
      .split(/\s+/)
      .filter((name) => /^[a-z0-9_-]+$/i.test(name))
      .join(" ");
  }

  function icon3D(requestedName, extraClass) {
    const name = canonical(requestedName);
    const classes = safeClasses(extraClass);
    return '<img class="cf-icon3d cf-icon3d-' + name +
      (classes ? " " + classes : "") +
      '" src="icons/premium3d/' + name +
      '.webp" alt="" aria-hidden="true" draggable="false" decoding="async">';
  }

  function hydrate(scope) {
    const host = scope || document;
    host.querySelectorAll("[data-cf-icon]").forEach(function (node) {
      if (node.dataset.cfIconReady === "1") return;
      node.innerHTML = icon3D(node.dataset.cfIcon || "spark");
      node.dataset.cfIconReady = "1";
    });
  }

  root.CoffreIcons3D = icon3D;
  root.CoffreHydrateIcons3D = hydrate;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      hydrate(document);
    });
  } else {
    hydrate(document);
  }

  new MutationObserver(function (changes) {
    changes.forEach(function (change) {
      change.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches("[data-cf-icon]")) {
          hydrate(node.parentNode || document);
        } else if (node.querySelector) {
          hydrate(node);
        }
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})(window);
