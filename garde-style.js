/* ============================================================
   Coffre — garde-fou des feuilles de style.

   Pourquoi ce fichier existe. Un client a vu l'appli s'afficher en vrac : clavier du
   code aux touches décalées, barre du bas dans le contenu, éléments normalement
   masqués devenus visibles. Cause : styles.css n'était pas appliqué, alors que la page
   et le reste du code se chargeaient normalement. Le navigateur ne signale rien dans ce
   cas, il affiche simplement une page sans mise en page.

   Ce script vérifie au démarrage que chaque feuille est bien appliquée, en lisant une
   variable sentinelle qu'elle déclare. Si elle manque, il recharge le fichier sous une
   URL unique, ce qui contourne le cache du navigateur comme un service worker qui
   servirait une réponse erronée. En dernier recours il affiche un message lisible
   plutôt que de laisser une interface cassée.

   Chargé dans le <head>, après les deux <link> : à ce moment le navigateur a fini de
   résoudre les feuilles, donc l'état lu est définitif.
   ============================================================ */
(function () {
  'use strict';

  var FEUILLES = [
    // critique : sans elle, l'appli est inutilisable (structure, positions, .hidden).
    { fichier: 'styles.css', variable: '--coffre-styles', critique: true },
    // non critique : purement visuelle, son absence est laide mais l'appli reste utilisable.
    { fichier: 'premium.css', variable: '--coffre-premium', critique: false },
  ];

  var MAX_TENTATIVES = 2;

  function appliquee(feuille) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(feuille.variable);
      return String(v).trim() === 'chargee';
    } catch (e) {
      // En cas de doute on ne déclenche rien : un faux positif serait pire que le défaut.
      return true;
    }
  }

  function recharge(feuille, tentative, ensuite) {
    var lien = document.createElement('link');
    lien.rel = 'stylesheet';
    // L'URL unique est ce qui permet de repasser outre un cache empoisonné.
    lien.href = feuille.fichier + '?secours=' + Date.now() + '-' + tentative;
    lien.onload = function () { setTimeout(ensuite, 0); };
    lien.onerror = function () { setTimeout(ensuite, 0); };
    (document.head || document.documentElement).appendChild(lien);
  }

  function repare(feuille, tentative) {
    if (appliquee(feuille)) {
      // Réparation aboutie : on retire le message de secours s'il avait été affiché.
      var msg = document.getElementById('garde-style-msg');
      if (msg && msg.parentNode) msg.parentNode.removeChild(msg);
      return;
    }
    if (tentative > MAX_TENTATIVES) {
      if (feuille.critique) prevenir();
      return;
    }
    recharge(feuille, tentative, function () { repare(feuille, tentative + 1); });
  }

  function prevenir() {
    function afficher() {
      if (!document.body || document.getElementById('garde-style-msg')) return;
      var boite = document.createElement('div');
      boite.id = 'garde-style-msg';
      boite.setAttribute('style', [
        // top/left/right/bottom plutôt que inset : le message doit s'afficher
        // même sur un Safari ancien, c'est justement un écran de secours.
        'position:fixed', 'top:0', 'right:0', 'bottom:0', 'left:0', 'z-index:99999',
        'display:flex', 'align-items:center', 'justify-content:center',
        'padding:24px', 'background:#0b0f1a', 'color:#eef2ff',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        'text-align:center', 'line-height:1.5',
      ].join(';'));
      boite.innerHTML =
        '<div style="max-width:340px">' +
        '<div style="font-size:19px;font-weight:700;margin-bottom:12px">Affichage incomplet</div>' +
        '<div style="font-size:15px;color:#93a0c2;margin-bottom:22px">' +
        'Un fichier d’affichage n’a pas pu être chargé, l’appli ne peut pas ' +
        's’afficher correctement. Vérifie ta connexion, puis réessaie.' +
        '</div>' +
        '<button type="button" id="garde-style-retry" style="' +
        'padding:13px 26px;font-size:15px;font-weight:600;border:0;border-radius:12px;' +
        'background:#6d7cff;color:#fff">Réessayer</button>' +
        '</div>';
      document.body.appendChild(boite);
      var bouton = document.getElementById('garde-style-retry');
      if (bouton) {
        bouton.addEventListener('click', function () {
          location.replace(location.pathname + '?r=' + Date.now());
        });
      }
    }
    if (document.body) afficher();
    else document.addEventListener('DOMContentLoaded', afficher);
  }

  function controler() {
    for (var i = 0; i < FEUILLES.length; i++) repare(FEUILLES[i], 1);
  }

  controler();
  // Second passage une fois le DOM prêt, au cas où une feuille arriverait en retard.
  document.addEventListener('DOMContentLoaded', controler);
})();
