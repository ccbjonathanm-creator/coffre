# Coffre — appli mobile de gestion de budget

Une appli web installable sur Android (PWA) pour gérer tes finances **en sécurité totale** :
tout est **chiffré (AES-256)**, protégé par un **code PIN**, et stocké **uniquement sur ton
téléphone**. Aucune donnée n'est envoyée sur internet, aucun compte, aucun abonnement.

## Ce qu'elle fait

- **Solde du mois** en un coup d'œil (revenus, dépenses).
- **Reste à vivre par jour** calculé automatiquement d'ici la fin du mois.
- **Ajout d'opérations** ultra-rapide, avec **catégorisation automatique** (tape "essence", ça
  choisit Transport tout seul).
- **Budgets par catégorie** avec jauges et **alertes** avant de déraper.
- **Analyse** : répartition en camembert + dépenses des 6 derniers mois.
- **Conseils intelligents** locaux (plus gros poste, comparaison au mois dernier, dépassements).
- **Import de relevé bancaire** (Excel .xlsx ou CSV) : détection automatique des colonnes
  (date, libellé, débit/crédit ou montant signé), aperçu avant validation, catégorisation
  automatique, anti-doublon. Le fichier est lu sur l'appareil, jamais envoyé ailleurs.
- **Sauvegarde / restauration** de tes données (fichier JSON).
- **Hors-ligne** total, **thème clair/sombre**.

## Importer ton relevé (Excel recommandé)

1. Depuis ton espace bancaire, exporte tes opérations en **Excel (.xlsx)** ou **CSV**.
2. Dans Coffre : **Réglages > Importer un relevé bancaire**, choisis le fichier.
3. Vérifie que les colonnes sont bien reconnues (tu peux les corriger), regarde l'aperçu,
   puis valide. Les opérations déjà présentes sont ignorées automatiquement.

> Évite le PDF : la mise en page casse l'extraction. L'export Excel donne un import fiable.

## Sécurité (le point important)

- Les données sont chiffrées avec une clé dérivée de ton **code PIN** (PBKDF2 + AES-256-GCM).
- La clé **n'est jamais stockée** : sans ton code, le contenu est illisible, même en copiant le fichier.
- Tout reste **sur l'appareil**. Le code de l'appli peut être public sans danger : il n'y a rien
  à voler côté serveur, il n'y a pas de serveur.
- **Attention :** si tu oublies ton code, les données sont **irrécupérables**. Fais des sauvegardes
  (Réglages > Sauvegarder).

## Fichiers

```
budget_app/
├── index.html            # structure
├── styles.css            # design (mobile-first, sombre/clair)
├── app.js                # toute la logique (chiffrement, budgets, graphiques, PWA)
├── sw.js                 # service worker (fonctionnement hors-ligne)
├── manifest.webmanifest  # métadonnées d'installation
├── make_icons.py         # génère les icônes
└── icons/                # icônes PNG (192, 512, maskable)
```

## Tester sur ton PC (Windows)

```powershell
cd budget_app
python -m http.server 5055
```
Ouvre http://localhost:5055 dans Chrome. Sur `localhost`, tout marche (installation comprise).

## L'installer sur ton téléphone Android

Pour être **installable** (icône sur l'écran d'accueil + hors-ligne), une PWA exige du **HTTPS**.
Sur ton réseau local en `http://` ça ne suffit pas. Le plus simple et gratuit : l'héberger sur
**GitHub Pages** (le code est public, mais tes données restent privées sur ton téléphone).

Une fois la page en ligne (URL en `https://…`) :
1. Ouvre l'URL dans **Chrome sur Android**.
2. Menu **⋮** > **Installer l'application** (ou "Ajouter à l'écran d'accueil").
3. L'icône Coffre apparaît. Ça s'ouvre en plein écran, comme une vraie app, et marche hors-ligne.

Au premier lancement, tu crées ton **code à 4 chiffres**. C'est lui qui chiffre tout.
