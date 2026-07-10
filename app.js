'use strict';
/* ============================================================
   Coffre — logique de l'application
   - Chiffrement AES-256 local (Web Crypto), code PIN
   - Stockage 100% sur l'appareil (localStorage), aucun réseau
   - Intelligence budgétaire locale (insights, reste à vivre)
   ============================================================ */

// ---------------- Constantes ----------------
const APP_VERSION = 'v25';
const PIN_LENGTH = 4;
const LS = {
  salt: 'coffre.salt', data: 'coffre.data', meta: 'coffre.meta', guard: 'coffre.guard',
  device: 'coffre.device', install: 'coffre.install', hwm: 'coffre.hwm', licence: 'coffre.licence',
};
// Licence : essai de 15 jours puis déblocage à vie par une clé signée liée à l'appareil.
// L'appli ne connaît QUE la clé publique (elle vérifie). La clé privée reste dans l'outil
// générateur privé de Jonathan (il seul peut fabriquer des clés valides).
const TRIAL_DAYS = 15;
const LICENCE_PUBKEY = { kty: 'EC', crv: 'P-256', x: 'K0QRUtH_hRpYgDzaPwPFCQB7RBtRazqixOSZWoY2fio', y: 'LSPalK2M97ttTsf6Yxzoifvg6eYgXZFDe3AE0IwiPPk' };
let licensed = false;
// Nombre d'itérations PBKDF2. Plus c'est haut, plus chaque tentative de forçage hors ligne
// est lente. Les anciens coffres (150000) sont migrés vers KDF_ITERS au prochain déverrouillage.
const KDF_ITERS = 600000;
const LEGACY_ITERS = 150000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const EXPENSE_CATS = [
  { id: 'alimentation', name: 'Courses', emoji: '🛒' },
  { id: 'restaurant', name: 'Restaurant', emoji: '🍔' },
  { id: 'logement', name: 'Logement', emoji: '🏠' },
  { id: 'transport', name: 'Transport', emoji: '🚗' },
  { id: 'factures', name: 'Factures', emoji: '🧾' },
  { id: 'sante', name: 'Santé', emoji: '💊' },
  { id: 'loisirs', name: 'Loisirs', emoji: '🎉' },
  { id: 'abonnements', name: 'Abonnements', emoji: '📺' },
  { id: 'vetements', name: 'Vêtements', emoji: '👕' },
  { id: 'shopping', name: 'Shopping', emoji: '🛍️' },
  { id: 'banque', name: 'Banque', emoji: '🏛️' },
  { id: 'credits', name: 'Crédits', emoji: '🏦' },
  { id: 'jeux', name: 'Jeux & paris', emoji: '🎰' },
  { id: 'epargne', name: 'Épargne', emoji: '🐖' },
  { id: 'voyage', name: 'Voyage', emoji: '✈️' },
  { id: 'tabac', name: 'Tabac', emoji: '🚬' },
  { id: 'autres', name: 'Autres', emoji: '💸' },
];
const INCOME_CATS = [
  { id: 'salaire', name: 'Salaire', emoji: '💼' },
  { id: 'aide', name: 'Aide', emoji: '🤝' },
  { id: 'remboursement', name: 'Remboursement', emoji: '↩️' },
  { id: 'vente', name: 'Vente', emoji: '🏷️' },
  { id: 'autres_in', name: 'Autres', emoji: '💰' },
];
const PALETTE = ['#6d7cff', '#7c3aed', '#f472b6', '#34d399', '#fbbf24',
  '#f87171', '#22d3ee', '#a3e635', '#fb923c', '#c084fc', '#94a3b8'];

// Mots-clés -> catégorie (catégorisation automatique de la note).
// La correspondance se fait par MOT ENTIER (voir kwMatch), et le PREMIER groupe qui
// correspond gagne : l'ordre compte (ex : "banque" avant "credits" pour que
// "Credit Agricole" soit une banque ; "vetements" avant "shopping").
const KEYWORDS = {
  alimentation: ['carrefour', 'carrefour market', 'carrefour city', 'carrefour contact', 'leclerc', 'e.leclerc', 'lidl', 'aldi', 'auchan', 'intermarche', 'itm', 'super u', 'hyper u', 'u express', 'systeme u', 'casino', 'monoprix', 'monop', 'franprix', 'naturalia', 'biocoop', 'picard', 'grand frais', 'netto', 'cora', 'colruyt', 'spar', 'vival', 'g20', 'leader price', 'la vie claire', 'supeco', 'norma', 'thiriet', 'nespresso', 'boulangerie', 'boucherie', 'charcuterie', 'primeur', 'poissonnerie', 'epicerie', 'supermarche', 'hypermarche', 'course', 'courses'],
  vetements: ['zara', 'h&m', 'uniqlo', 'primark', 'mango', 'pull&bear', 'pull and bear', 'bershka', 'stradivarius', 'massimo dutti', 'kiabi', 'gemo', 'pimkie', 'calzedonia', 'celio', 'jennyfer', 'promod', 'cache cache', 'bonobo', 'bizzbee', 'naf naf', 'camaieu', 'etam', 'undiz', 'darjeeling', 'oysho', 'intimissimi', 'tezenis', 'hunkemoller', 'kaporal', 'teddy smith', 'devred', 'izac', 'sandro', 'maje', 'the kooples', 'zadig', 'comptoir des cotonniers', 'grain de malice', 'du pareil au meme', 'okaidi', 'orchestra', 'sergent major', 'petit bateau', 'vertbaudet', 'jacadi', 'zalando', 'asos', 'shein', 'vinted', 'spartoo', 'sarenza', 'chaussea', 'eram', 'minelli', 'bocage', 'san marina', 'courir', 'foot locker', 'jd sports', 'snipes', 'nike', 'adidas', 'puma', 'new balance', 'lacoste', 'levis', 'damart', 'jott'],
  restaurant: ['restaurant', 'resto', 'brasserie', 'bistrot', 'mcdonald', 'mcdo', 'mc do', 'burger king', 'quick', 'kfc', 'subway', 'o tacos', 'tacos avenue', 'five guys', 'buffalo grill', 'hippopotamus', 'la boucherie', 'courtepaille', 'del arte', 'vapiano', 'flunch', 'class croute', 'pizza', 'pizza hut', 'dominos', 'sushi', 'sushi shop', 'planet sushi', 'starbucks', 'columbus cafe', 'mccafe', 'brioche doree', 'la mie caline', 'pomme de pain', 'deliveroo', 'uber eats', 'ubereats', 'just eat', 'frichti', 'kebab', 'snack', 'cafe', 'traiteur'],
  transport: ['total', 'total fact', 'totalenergies', 'total energies', 'total access', 'esso', 'shell', 'avia', 'dyneff', 'station service', 'station total', 'essence', 'carburant', 'gasoil', 'gazole', 'diesel', 'sp95', 'sp98', 'fioul', 'sncf', 'sncf connect', 'ouigo', 'tgv', 'trainline', 'ratp', 'navigo', 'tisseo', 'blablacar', 'blablabus', 'flixbus', 'uber', 'bolt', 'heetch', 'freenow', 'taxi', 'peage', 'autoroute', 'vinci autoroutes', 'vinci', 'aprr', 'sanef', 'cofiroute', 'escota', 'parking', 'indigo', 'effia', 'q-park', 'saemes', 'paybyphone', 'flowbird', 'yespark', 'zenpark', 'norauto', 'feu vert', 'midas', 'speedy', 'euromaster', 'roady', 'controle technique', 'dekra', 'autovision', 'garage'],
  banque: ['societe generale', 'sg', 'bnp', 'bnp paribas', 'credit agricole', 'lcl', 'banque populaire', 'bpce', 'caisse d epargne', 'caisse epargne', 'cic', 'credit mutuel', 'la banque postale', 'banque postale', 'boursorama', 'boursobank', 'hello bank', 'fortuneo', 'monabanq', 'bforbank', 'n26', 'revolut', 'lydia', 'nickel', 'orange bank', 'ma french bank', 'qonto', 'frais bancaire', 'frais tenue de compte', 'tenue de compte', 'cotisation carte', 'cotisation', 'commission d intervention', 'agios', 'esprit libre', 'quietis', 'sobrio', 'convention de compte'],
  logement: ['loyer', 'charges copro', 'syndic', 'foncia', 'nexity', 'citya', 'immobilier', 'agence immo'],
  factures: ['edf', 'engie', 'gdf', 'eni', 'vattenfall', 'ekwateur', 'enedis', 'grdf', 'veolia', 'saur', 'suez', 'lyonnaise des eaux', 'eau', 'electricite', 'gaz', 'facture', 'impot', 'impots', 'dgfip', 'tresor public', 'finances publiques', 'taxe', 'taxe fonciere', 'taxe habitation', 'urssaf', 'redevance', 'assurance', 'maif', 'macif', 'maaf', 'matmut', 'mma', 'gmf', 'axa', 'allianz', 'groupama', 'generali', 'april', 'direct assurance', 'luko', 'lovys', 'cardif'],
  sante: ['pharmacie', 'parapharmacie', 'medecin', 'docteur', 'dentiste', 'orthodontiste', 'kine', 'kinesitherapeute', 'osteo', 'osteopathe', 'laboratoire', 'labo', 'biogroup', 'cerba', 'synlab', 'hopital', 'clinique', 'ehpad', 'infirmier', 'infirmiere', 'opticien', 'optic', 'optical center', 'afflelou', 'krys', 'atol', 'grandoptical', 'ophtalmo', 'dermatologue', 'radiologie', 'imagerie medicale', 'qare', 'doctolib', 'maiia', 'livi', 'medadom'],
  loisirs: ['steam', 'epic games', 'playstation', 'psn', 'xbox', 'nintendo', 'eshop', 'instant gaming', 'instant-gaming', 'micromania', 'king jouet', 'la grande recre', 'cinema', 'ugc', 'pathe', 'gaumont', 'cgr', 'kinepolis', 'mk2', 'allocine', 'theatre', 'concert', 'fnac spectacles', 'ticketmaster', 'billetreduc', 'decathlon', 'intersport', 'go sport', 'sport 2000', 'basic fit', 'fitness park', 'keepcool', 'neoness', 'salle de sport', 'piscine', 'bowling', 'laser game', 'accrobranche', 'zoo', 'disneyland', 'parc asterix', 'futuroscope', 'twitch', 'patreon', 'cultura', 'gibert', 'museum', 'musee', 'jeux video'],
  abonnements: ['free', 'free mobile', 'freebox', 'orange', 'sosh', 'sfr', 'red by sfr', 'bouygues', 'bbox', 'b and you', 'prixtel', 'nrj mobile', 'la poste mobile', 'lebara', 'lycamobile', 'coriolis', 'netflix', 'disney', 'canal', 'canalplus', 'mycanal', 'spotify', 'deezer', 'amazon prime', 'prime video', 'apple.com', 'itunes', 'icloud', 'apple music', 'apple tv', 'app store', 'google play', 'play store', 'google one', 'youtube premium', 'microsoft 365', 'office 365', 'adobe', 'dropbox', 'ovh', 'gandi', 'molotov', 'salto', 'paramount', 'crunchyroll', 'audible', 'kindle', 'meetic', 'tinder', 'bumble', 'canva', 'chatgpt', 'openai', 'notion', 'abonnement', 'forfait'],
  epargne: ['bitstack', 'coinbase', 'binance', 'kraken', 'bitpanda', 'crypto', 'ledger', 'trade republic', 'traderepublic', 'degiro', 'etoro', 'xtb', 'trading 212', 'yomoni', 'nalo', 'linxea', 'cashbee', 'goodvest', 'ramify', 'livret', 'ldds', 'lep', 'pel', 'pea', 'assurance vie', 'versement epargne', 'moka'],
  jeux: ['fdj', 'francaise des jeux', 'parions sport', 'parionssport', 'winamax', 'betclic', 'unibet', 'pmu', 'zebet', 'netbet', 'bwin', 'pokerstars', 'poker', 'genybet', 'vbet', 'loto', 'euromillions', 'keno'],
  voyage: ['airbnb', 'booking', 'booking.com', 'abritel', 'hotel', 'ibis', 'mercure', 'novotel', 'campanile', 'b&b hotel', 'kyriad', 'ryanair', 'easyjet', 'air france', 'transavia', 'volotea', 'vueling', 'expedia', 'opodo', 'kayak', 'lastminute', 'tui', 'club med', 'center parcs', 'pierre et vacances', 'belambra', 'gite', 'camping', 'huttopia'],
  tabac: ['tabac', 'civette', 'buraliste', 'cigarette', 'presse', 'la civette', 'relay', 'maison de la presse', 'kiosque'],
  shopping: ['amazon', 'amzn', 'amazon.fr', 'amazon mktp', 'cdiscount', 'ebay', 'aliexpress', 'wish', 'temu', 'rakuten', 'fnac', 'darty', 'boulanger', 'ldlc', 'materiel.net', 'rueducommerce', 'apple store', 'samsung', 'action', 'gifi', 'la foir fouille', 'centrakor', 'stokomani', 'noz', 'maxi bazar', 'ikea', 'conforama', 'but', 'maisons du monde', 'alinea', 'la redoute', 'showroomprive', 'veepee', 'leroy merlin', 'castorama', 'brico depot', 'bricomarche', 'bricorama', 'mr bricolage', 'weldom', 'mano mano', 'manomano', 'jardiland', 'truffaut', 'gamm vert', 'botanic', 'nature et decouvertes', 'sephora', 'marionnaud', 'nocibe', 'yves rocher', 'kiko', 'hema', 'flying tiger', 'grow quality'],
  credits: ['credit conso', 'credit renouvelable', 'pret', 'mensualite', 'echeance pret', 'cofidis', 'cetelem', 'sofinco', 'younited', 'franfinance', 'cofinoga', 'floa', 'oney', 'carrefour banque', 'carte pass', 'banque casino', 'credit'],
  salaire: ['salaire', 'paie', 'paye', 'remuneration', 'virement salaire', 'vir salaire', 'bulletin de paie', 'traitement'],
  aide: ['caf', 'apl', 'rsa', 'pole emploi', 'france travail', 'msa', 'allocation', 'prime activite', 'aah', 'bourse', 'crous'],
  remboursement: ['remboursement', 'rembours', 'mutuelle', 'cpam', 'ameli', 'secu', 'harmonie mut', 'assurance maladie', 'mgen'],
  vente: ['leboncoin', 'vinted', 'vente', 'depot vente'],
};

// ---------------- État en mémoire ----------------
let cryptoKey = null;   // clé AES (jamais persistée)
let state = null;       // données déchiffrées
let currentTab = 'dashboard';
let analyticsMonth = null;   // mois affiché dans l'onglet Budgets & analyse (clé 'YYYY-MM')
let lockTimer = null;
let deferredInstall = null;
let swReg = null;          // registration du service worker (pour la mise à jour manuelle)
let updateReady = false;   // une nouvelle version est téléchargée et prête à s'installer

// Saisie du code
let pinBuffer = '';
let pinMode = 'unlock';   // 'create' | 'confirm' | 'unlock'
let pinFirst = '';

// Feuille modale
let editingId = null;
let draft = null;

// Feuille des récurrences
let editRecurId = null;
let rdraft = null;

// Filtres de l'onglet Opérations
let txFilter = { q: '', month: 'all', cat: 'all', type: 'all' };

// ---------------- Raccourcis DOM ----------------
const $ = (s) => document.querySelector(s);
const el = (s) => document.getElementById(s);

// ---------------- Utilitaires ----------------
const fmtEur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const euro = (n) => fmtEur.format(n || 0);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
// Dates en heure LOCALE (jamais toISOString, qui convertit en UTC et décale le mois).
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ym = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const todayISO = () => ymd(new Date());
const monthKey = (iso) => iso.slice(0, 7);
const thisMonth = () => monthKey(todayISO());

function catById(id) {
  return EXPENSE_CATS.concat(INCOME_CATS).find((c) => c.id === id)
    || { id, name: 'Autres', emoji: '💸' };
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

// ---------------- Chiffrement ----------------
function b64(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(str) {
  const bin = atob(str);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}
async function deriveKey(pin, salt, iters) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iters || KDF_ITERS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// Nombre d'itérations du coffre courant (anciens coffres sans meta = LEGACY_ITERS).
function currentIters() {
  try { return JSON.parse(localStorage.getItem(LS.meta)).iter || LEGACY_ITERS; }
  catch (e) { return LEGACY_ITERS; }
}
function setMeta(iters) {
  localStorage.setItem(LS.meta, JSON.stringify({ iter: iters, ver: 2 }));
}
async function encryptState() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(state));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0); out.set(new Uint8Array(ct), iv.length);
  return b64(out);
}
async function decryptWith(key, blob) {
  const buf = fromB64(blob);
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(dec.decode(pt));
}
async function save() {
  if (!cryptoKey) return;
  localStorage.setItem(LS.data, await encryptState());
}

function defaultState() {
  return {
    version: 1,
    transactions: [],
    budgets: {},
    recurring: [],   // opérations récurrentes : { id, type, amount, category, note, day }
    aboManuel: [],   // abonnements ajoutés à la main : { id, cle, marchand, montant, frequence, categorie }
    aboIgnore: {},   // abonnements auto-détectés écartés : { cle: true }
    rules: {},   // marchands appris : { motclé: catégorie }
    iconRules: {},   // icônes apprises par marchand : { motclé: slug d'icône }
    // startBalance : solde réel du compte à la date startBalanceDate (avant les opérations
    // qui suivent). Sert à afficher le VRAI solde du compte, pas seulement la somme des opérations.
    settings: { theme: 'dark', autoLockMin: 3, monthlyIncome: 0, budgetRollover: false, startBalance: null, startBalanceDate: '' },
  };
}

// ---------------- Écran de verrouillage ----------------
function renderPinDots() {
  const wrap = el('pin-dots');
  wrap.innerHTML = '';
  for (let i = 0; i < PIN_LENGTH; i++) {
    const s = document.createElement('span');
    if (i < pinBuffer.length) s.classList.add('filled');
    wrap.appendChild(s);
  }
}
function setLockSubtitle() {
  const sub = el('lock-subtitle');
  if (pinMode === 'create') sub.textContent = 'Crée ton code à 4 chiffres';
  else if (pinMode === 'confirm') sub.textContent = 'Confirme ton code';
  else sub.textContent = 'Entre ton code';
}
function showLock(mode) {
  pinMode = mode;
  pinBuffer = '';
  pinFirst = '';
  el('lock-error').textContent = '';
  setLockSubtitle();
  renderPinDots();
  el('lock-screen').classList.remove('hidden');
  el('app').classList.add('hidden');
  if (mode === 'unlock' && guardRemaining() > 0) renderGuardWait();
}

// ---------------- Anti-forçage (délai croissant après codes faux) ----------------
let guardInterval = null;
function guardData() {
  try { return JSON.parse(localStorage.getItem(LS.guard)) || {}; } catch (e) { return {}; }
}
function guardRemaining() {
  return Math.max(0, (guardData().until || 0) - Date.now());
}
function guardReset() {
  clearInterval(guardInterval); guardInterval = null;
  localStorage.removeItem(LS.guard);
}
// Les 3 premières fautes sont tolérées (fautes de frappe), puis l'attente grimpe.
function guardDelayMs(fails) {
  if (fails <= 3) return 0;
  const steps = { 4: 5, 5: 15, 6: 30, 7: 60, 8: 180 };
  return (steps[fails] || 300) * 1000;
}
function guardFail() {
  const fails = (guardData().fails || 0) + 1;
  localStorage.setItem(LS.guard, JSON.stringify({ fails, until: Date.now() + guardDelayMs(fails) }));
}
function renderGuardWait() {
  const keypad = el('keypad');
  const err = el('lock-error');
  pinBuffer = '';
  renderPinDots();
  clearInterval(guardInterval);
  const tick = () => {
    const ms = guardRemaining();
    if (ms <= 0) {
      clearInterval(guardInterval); guardInterval = null;
      keypad.classList.remove('disabled');
      err.textContent = '';
      setLockSubtitle();
      return;
    }
    keypad.classList.add('disabled');
    err.textContent = `Trop d'essais. Réessaie dans ${Math.ceil(ms / 1000)}s.`;
  };
  tick();
  guardInterval = setInterval(tick, 250);
}
function lockError(msg) {
  el('lock-error').textContent = msg;
  const box = $('.lock-inner');
  box.classList.add('shake');
  setTimeout(() => box.classList.remove('shake'), 420);
  pinBuffer = '';
  renderPinDots();
}
async function pinComplete() {
  if (pinMode === 'create') {
    const first = pinBuffer;
    showLock('confirm');   // remet pinFirst à '' : on le réaffecte juste après
    pinFirst = first;
    return;
  }
  if (pinMode === 'confirm') {
    if (pinBuffer !== pinFirst) {
      pinFirst = '';
      showLock('create');
      lockError('Les codes ne correspondent pas, recommence.');
      return;
    }
    // Création réelle du coffre
    const salt = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem(LS.salt, b64(salt));
    setMeta(KDF_ITERS);
    cryptoKey = await deriveKey(pinFirst, salt, KDF_ITERS);
    state = defaultState();
    await save();
    enterApp();
    return;
  }
  // unlock : bloqué si un délai anti-forçage est en cours
  if (guardRemaining() > 0) { renderGuardWait(); return; }
  try {
    const salt = fromB64(localStorage.getItem(LS.salt));
    const iters = currentIters();
    const key = await deriveKey(pinBuffer, salt, iters);
    const loaded = await decryptWith(key, localStorage.getItem(LS.data));
    cryptoKey = key;
    state = Object.assign(defaultState(), loaded);
    guardReset();
    // Migration transparente : ré-encrypte avec le renforcement actuel si l'ancien coffre est plus faible.
    if (iters < KDF_ITERS) { await rekeyVault(pinBuffer); }
    enterApp();
  } catch (e) {
    guardFail();
    const wait = guardRemaining();
    if (wait > 0) renderGuardWait();
    else lockError('Code incorrect.');
  }
}
// Ré-encrypte tout le coffre avec un nouveau sel et KDF_ITERS (migration ou changement de code).
async function rekeyVault(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(LS.salt, b64(salt));
  setMeta(KDF_ITERS);
  cryptoKey = await deriveKey(pin, salt, KDF_ITERS);
  await save();
}
function onKey(k) {
  if (k === 'del') { pinBuffer = pinBuffer.slice(0, -1); renderPinDots(); return; }
  if (k === 'reset') { pinBuffer = ''; renderPinDots(); return; }
  if (!/^\d$/.test(k) || pinBuffer.length >= PIN_LENGTH) return;
  pinBuffer += k;
  renderPinDots();
  if (pinBuffer.length === PIN_LENGTH) setTimeout(pinComplete, 120);
}
async function enterApp() {
  applyTheme();
  el('lock-screen').classList.add('hidden');
  el('licence-gate').classList.add('hidden');
  await refreshLicence();
  // Essai expiré et pas de licence valide : blocage total (écran de déblocage).
  if (!licensed && trialInfo().expired) { showLicenceGate(); return; }
  el('app').classList.remove('hidden');
  resetAutoLock();
  switchTab('dashboard');
}
function lockApp() {
  cryptoKey = null;
  state = null;
  clearTimeout(lockTimer);
  closeSheet();
  el('licence-gate').classList.add('hidden');
  showLock('unlock');
}
function resetAutoLock() {
  clearTimeout(lockTimer);
  if (!state) return;
  const min = state.settings.autoLockMin || 3;
  if (min <= 0) return;
  lockTimer = setTimeout(() => { lockApp(); }, min * 60000);
}

// ---------------- Licence (essai 15 j -> version à vie) ----------------
// Identifiant d'appareil : aléatoire, stable, non secret. C'est lui qui est signé par la clé.
function genDeviceId() {
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sans I, O, 0, 1, L (lisibilité)
  const r = crypto.getRandomValues(new Uint8Array(8));
  let s = ''; for (const b of r) s += alpha[b % alpha.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}
function getDeviceId() {
  let id = localStorage.getItem(LS.device);
  if (!id) { id = genDeviceId(); localStorage.setItem(LS.device, id); }
  return id;
}
// Suivi de l'essai avec garde anti-recul d'horloge (high-water-mark du temps vu).
function trialInfo() {
  if (!localStorage.getItem(LS.install)) localStorage.setItem(LS.install, String(Date.now()));
  const install = parseInt(localStorage.getItem(LS.install), 10) || Date.now();
  const hwm = Math.max(parseInt(localStorage.getItem(LS.hwm) || '0', 10), Date.now(), install);
  localStorage.setItem(LS.hwm, String(hwm));
  const leftMs = TRIAL_DAYS * 86400000 - (hwm - install);
  return { daysLeft: Math.max(0, Math.ceil(leftMs / 86400000)), expired: leftMs <= 0 };
}
async function verifyLicence(key, deviceId) {
  if (!key) return false;
  try {
    const pub = await crypto.subtle.importKey('jwk', LICENCE_PUBKEY, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64(key), enc.encode('coffre-licence:' + deviceId));
  } catch (e) { return false; }
}
async function refreshLicence() {
  licensed = await verifyLicence(localStorage.getItem(LS.licence), getDeviceId());
  return licensed;
}
// Tente d'activer une clé saisie. Renvoie true si valide pour CET appareil.
async function submitLicence(rawKey) {
  const clean = (rawKey || '').trim().replace(/\s+/g, '');
  const ok = await verifyLicence(clean, getDeviceId());
  if (ok) { localStorage.setItem(LS.licence, clean); licensed = true; }
  return ok;
}
function showLicenceGate() {
  clearTimeout(lockTimer);
  el('lock-screen').classList.add('hidden');
  el('app').classList.add('hidden');
  closeSheet();
  el('lic-device').textContent = getDeviceId();
  el('lic-error').textContent = '';
  el('lic-key').value = '';
  el('licence-gate').classList.remove('hidden');
}
function openLicenceSheet() {
  const ti = trialInfo();
  const sheet = el('sheet');
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <h2>Débloquer la version à vie</h2>
    <p class="muted" style="font-size:13px;margin:-8px 0 14px">${licensed
      ? 'Ta version à vie est déjà active. Merci ! ✓'
      : `Version d'essai : <b>${ti.daysLeft} jour(s)</b> restant(s). Pour débloquer, communique ton identifiant au vendeur puis colle la clé reçue.`}</p>
    <div class="field">
      <label>Ton identifiant d'appareil</label>
      <input id="ls-device" type="text" readonly value="${getDeviceId()}" style="font-weight:700;letter-spacing:1px">
    </div>
    ${licensed ? '' : `
    <div class="field">
      <label>Clé de licence</label>
      <input id="ls-key" type="text" placeholder="Colle la clé reçue ici">
    </div>
    <button class="btn" id="ls-validate">Activer</button>
    <p id="ls-error" class="lock-error" style="text-align:center"></p>`}
  `;
  if (!licensed) {
    el('ls-validate').addEventListener('click', async () => {
      if (await submitLicence(el('ls-key').value)) { closeSheet(); render(); toast('Version à vie activée ✓ Merci !'); }
      else el('ls-error').textContent = 'Clé invalide pour cet appareil.';
    });
  }
  el('sheet-backdrop').classList.remove('hidden');
  el('sheet').classList.remove('hidden');
}

// ---------------- Générateur de licences (accès caché : appui long sur la version) ----------------
// La clé privée n'est PAS dans le code. Le vendeur la colle une fois ; elle est chiffrée
// (AES-GCM, mot de passe via PBKDF2) et gardée uniquement dans ce téléphone.
const GEN_LS = 'coffre.genvault';
let genSignKey = null;
function genVault() { try { return JSON.parse(localStorage.getItem(GEN_LS)); } catch (e) { return null; } }
async function genEncrypt(privStr, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pw, salt, 310000);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(privStr));
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function genDecrypt(vault, pw) {
  const key = await deriveKey(pw, fromB64(vault.salt), 310000);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(vault.iv) }, key, fromB64(vault.ct));
  return dec.decode(pt);
}
function genImportSign(privStr) {
  return crypto.subtle.importKey('jwk', JSON.parse(privStr), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}
async function genMakeLicence(deviceId) {
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, genSignKey, enc.encode('coffre-licence:' + deviceId));
  return b64(sig);
}
function openGeneratorSheet() {
  genSignKey = null;
  genRender(genVault() ? 'unlock' : 'setup');
  el('sheet-backdrop').classList.remove('hidden');
  el('sheet').classList.remove('hidden');
}
function genRender(screen) {
  const sheet = el('sheet');
  if (screen === 'setup') {
    sheet.innerHTML = `
      <div class="sheet-grip"></div>
      <h2>🔑 Générateur — configuration</h2>
      <p class="muted" style="font-size:13px;margin:-8px 0 14px">Première fois. Colle ta clé secrète et choisis un mot de passe maître. La clé sera chiffrée et gardée <b>uniquement sur ce téléphone</b>.</p>
      <div class="field"><label>Clé secrète (fournie par Claude)</label>
        <textarea id="gs-key" class="resil-area" rows="4" placeholder='{"key_ops":["sign"],...}'></textarea></div>
      <div class="field"><label>Mot de passe maître</label>
        <input id="gs-pw" type="password" placeholder="Un mot de passe fort"></div>
      <div class="field"><label>Confirme le mot de passe</label>
        <input id="gs-pw2" type="password" placeholder="Retape-le"></div>
      <button class="btn" id="gs-go">🔒 Chiffrer et enregistrer</button>
      <p id="gs-err" class="lock-error" style="text-align:center"></p>`;
    el('gs-go').addEventListener('click', genDoSetup);
  } else if (screen === 'unlock') {
    sheet.innerHTML = `
      <div class="sheet-grip"></div>
      <h2>🔑 Générateur</h2>
      <div class="field"><label>Mot de passe maître</label>
        <input id="gu-pw" type="password" placeholder="Ton mot de passe"></div>
      <button class="btn" id="gu-go">Déverrouiller</button>
      <p id="gu-err" class="lock-error" style="text-align:center"></p>
      <button class="btn btn-2" id="gu-reset" style="margin-top:10px">Réinitialiser (effacer la clé de ce tél)</button>`;
    el('gu-go').addEventListener('click', genDoUnlock);
    el('gu-reset').addEventListener('click', () => {
      if (confirm('Effacer la clé chiffrée de ce téléphone ?')) { localStorage.removeItem(GEN_LS); genSignKey = null; genRender('setup'); }
    });
  } else {
    sheet.innerHTML = `
      <div class="sheet-grip"></div>
      <h2>🔑 Générer une licence</h2>
      <div class="field"><label>Identifiant d'appareil du client</label>
        <input id="gg-id" type="text" placeholder="XXXX-XXXX" maxlength="9" style="text-align:center;font-weight:800;letter-spacing:2px"></div>
      <button class="btn" id="gg-go">Générer la clé</button>
      <div id="gg-out" class="field hidden" style="margin-top:16px">
        <label>Clé à donner au client</label>
        <div id="gg-key" class="key" style="word-break:break-all;user-select:all;background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:12px;padding:14px;font-family:monospace;font-size:13px"></div>
        <button class="btn btn-2" id="gg-copy" style="margin-top:10px">📋 Copier la clé</button>
        <p id="gg-ok" class="ok" style="color:var(--green);font-size:13px;text-align:center"></p>
      </div>
      <p id="gg-err" class="lock-error" style="text-align:center"></p>
      <button class="btn btn-2" id="gg-lock" style="margin-top:10px">🔒 Verrouiller</button>`;
    el('gg-id').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
    el('gg-go').addEventListener('click', genDoGenerate);
    el('gg-lock').addEventListener('click', () => { genSignKey = null; genRender('unlock'); });
  }
}
async function genDoSetup() {
  const err = el('gs-err'); err.textContent = '';
  const raw = el('gs-key').value.trim();
  const pw = el('gs-pw').value, pw2 = el('gs-pw2').value;
  let jwk;
  try { jwk = JSON.parse(raw); } catch (e) { err.textContent = 'Clé illisible (JSON invalide).'; return; }
  if (jwk.x !== LICENCE_PUBKEY.x || jwk.y !== LICENCE_PUBKEY.y || !jwk.d) { err.textContent = "Cette clé ne correspond pas à Coffre."; return; }
  if (pw.length < 8) { err.textContent = 'Mot de passe : 8 caractères minimum (idéalement une longue phrase).'; return; }
  if (pw !== pw2) { err.textContent = 'Les deux mots de passe diffèrent.'; return; }
  try {
    genSignKey = await genImportSign(raw);
    localStorage.setItem(GEN_LS, JSON.stringify(await genEncrypt(raw, pw)));
    genRender('generate');
  } catch (e) { err.textContent = 'Erreur : ' + e.message; }
}
async function genDoUnlock() {
  const err = el('gu-err'); err.textContent = '';
  const v = genVault(); if (!v) { genRender('setup'); return; }
  try {
    genSignKey = await genImportSign(await genDecrypt(v, el('gu-pw').value));
    genRender('generate');
  } catch (e) { err.textContent = 'Mot de passe incorrect.'; }
}
async function genDoGenerate() {
  const err = el('gg-err'); err.textContent = ''; el('gg-out').classList.add('hidden');
  const id = el('gg-id').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(id)) { err.textContent = 'Identifiant invalide. Format : XXXX-XXXX.'; return; }
  if (!genSignKey) { genRender('unlock'); return; }
  try {
    el('gg-key').textContent = await genMakeLicence(id);
    el('gg-out').classList.remove('hidden');
    el('gg-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(el('gg-key').textContent); el('gg-ok').textContent = 'Copié ✓'; }
      catch (e) { el('gg-ok').textContent = 'Sélectionne et copie la clé.'; }
    };
  } catch (e) { err.textContent = 'Erreur : ' + e.message; }
}

function trialBanner() {
  if (licensed) return '';
  const ti = trialInfo();
  const col = ti.daysLeft <= 3 ? 'var(--red)' : 'var(--orange)';
  return `<div class="install-banner" style="border-color:${col}">
    <span style="font-size:22px">⏳</span>
    <span class="txt">Version d'essai : <b style="color:${col}">${ti.daysLeft} jour(s)</b> restant(s).</span>
    <button id="unlock-lic">Débloquer</button>
  </div>`;
}

// ---------------- Thème ----------------
function applyTheme() {
  const t = state?.settings?.theme || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#eef1fb' : '#05060e');
}

// ---------------- Agrégations & intelligence ----------------
function txOfMonth(mk) {
  return state.transactions.filter((t) => monthKey(t.date) === mk);
}
function sumBy(list, type) {
  return round2(list.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0));
}
function expenseByCat(list) {
  const map = {};
  list.filter((t) => t.type === 'expense').forEach((t) => {
    map[t.category] = round2((map[t.category] || 0) + t.amount);
  });
  return map;
}
function daysLeftInMonth() {
  const now = new Date();
  const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return total - now.getDate() + 1;
}
function totalBudget() {
  return round2(Object.values(state.budgets).reduce((s, v) => s + (v || 0), 0));
}
function prevMonthKey(mk) {
  const d = new Date(mk + '-01T00:00:00');
  d.setMonth(d.getMonth() - 1);
  return ym(d);
}
// Budget effectif d'une catégorie pour un mois : si le report est activé, on ajoute
// le solde non dépensé du mois précédent (positif ou négatif), planché à 0.
function effectiveBudget(catId, mk) {
  const base = state.budgets[catId] || 0;
  if (!base || !state.settings.budgetRollover) return base;
  const prevSpent = expenseByCat(txOfMonth(prevMonthKey(mk)))[catId] || 0;
  const leftover = round2(base - prevSpent);
  return round2(Math.max(0, base + leftover));
}
// Récurrences du mois pas encore enregistrées comme opération réelle.
// "Déjà passée" = une opération du mois a même type, même catégorie et même montant (à l'euro près).
function pendingRecurring(mk) {
  const list = state.recurring || [];
  if (!list.length) return [];
  const cur = txOfMonth(mk);
  return list.filter((r) =>
    !cur.some((t) => t.type === r.type && t.category === r.category && Math.abs(t.amount - r.amount) < 1));
}
// Correspondance par mot entier (évite que "eau" matche dans "chateau").
function kwMatch(n, w) {
  w = normTxt(w);
  if (!w) return false;
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + esc + '([^a-z0-9]|$)').test(n);
}
function guessCategory(note, type) {
  const n = normTxt(note);
  if (!n) return null;
  const pool = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  // 1) règles apprises des corrections manuelles (prioritaires)
  const rules = (state && state.rules) || {};
  for (const kw in rules) {
    const cat = rules[kw];
    if (kw && kwMatch(n, kw) && pool.some((c) => c.id === cat)) return cat;
  }
  // 2) dictionnaire intégré
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    if (!pool.some((c) => c.id === cat)) continue;
    if (words.some((w) => kwMatch(n, w))) return cat;
  }
  return null;
}
// Retient le marchand quand tu corriges une catégorie à la main.
const RULE_STOPWORDS = new Set(['paiement', 'carte', 'cb', 'prlv', 'sepa', 'vir', 'virement', 'achat',
  'retrait', 'france', 'avec', 'pour', 'date', 'ref', 'sarl', 'sas', 'eurl', 'facture', 'mensuel',
  'client', 'clients', 'particuliers', 'recu', 'inst', 'ste', 'du', 'le', 'la', 'les', 'des', 'un', 'une', 'par',
  'www', 'com', 'fra', 'sa', 'to', 'the', 'and']);
// Extrait le "marchand" d'un libellé : le token le plus significatif (celui qui revient
// le plus souvent dans l'historique, une enseigne se répète ; à défaut le plus long).
function merchantKeyword(note) {
  const tokens = normTxt(note).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !RULE_STOPWORDS.has(w));
  if (!tokens.length) return null;
  const freq = (w) => state.transactions.reduce((n, t) => n + (kwMatch(normTxt(t.note), w) ? 1 : 0), 0);
  tokens.sort((a, b) => freq(b) - freq(a) || b.length - a.length);
  return tokens[0];
}
function learnRule(note, cat) {
  const kw = merchantKeyword(note);
  if (!kw) return null;
  state.rules = state.rules || {};
  state.rules[kw] = cat;
  return kw;   // le marchand retenu
}
// Retient l'icône choisie pour un marchand (Steam -> manette) et la retire si on repasse en Auto.
function learnIconRule(note, slug) {
  const kw = merchantKeyword(note);
  if (!kw) return null;
  state.iconRules = state.iconRules || {};
  if (slug) state.iconRules[kw] = slug;
  else delete state.iconRules[kw];
  return kw;
}
// Icône apprise pour ce libellé, s'il correspond à un marchand connu.
function iconFromRules(note) {
  const n = normTxt(note);
  if (!n) return null;
  const rules = (state && state.iconRules) || {};
  for (const kw in rules) { if (kw && kwMatch(n, kw)) return rules[kw]; }
  return null;
}
// Corrige d'un coup toutes les opérations déjà présentes qui correspondent au même marchand.
function applyRuleToExisting(keyword, cat, type, exceptId) {
  if (!keyword) return 0;
  let n = 0;
  for (const t of state.transactions) {
    if (t.id === exceptId || t.type !== type || t.category === cat) continue;
    if (kwMatch(normTxt(t.note), keyword)) { t.category = cat; n++; }
  }
  return n;
}
function buildInsights() {
  const out = [];
  const mk = thisMonth();
  const cur = txOfMonth(mk);
  const spent = sumBy(cur, 'expense');

  // mois précédent
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  const prevKey = ym(d);
  const prevSpent = sumBy(txOfMonth(prevKey), 'expense');

  if (state.transactions.length === 0) {
    out.push(['👋', 'Bienvenue ! Ajoute ta première opération avec le bouton <b>+</b>. Tout reste chiffré sur ton téléphone.']);
    return out;
  }

  if (prevSpent > 0) {
    const diff = Math.round(((spent - prevSpent) / prevSpent) * 100);
    if (diff > 5) out.push(['📈', `Tu as dépensé <b>${diff}% de plus</b> que le mois dernier à la même échelle.`]);
    else if (diff < -5) out.push(['📉', `Bravo, <b>${Math.abs(diff)}% de moins</b> que le mois dernier. Continue.`]);
  }

  // plus gros poste
  const byCat = expenseByCat(cur);
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const c = catById(top[0]);
    out.push(['🔎', `Ton plus gros poste ce mois : <b>${c.emoji} ${c.name}</b> (${euro(top[1])}).`]);
  }

  // alertes budget (sur le budget effectif du mois : report inclus si activé)
  for (const [cat, base] of Object.entries(state.budgets)) {
    if (!base) continue;
    const limit = effectiveBudget(cat, mk);
    const used = byCat[cat] || 0;
    const c = catById(cat);
    if (limit <= 0) { out.push(['⚠️', `Budget <b>${c.name}</b> épuisé par le report du mois dernier.`]); continue; }
    if (used > limit) { out.push(['⚠️', `Budget <b>${c.name}</b> dépassé de <b>${euro(used - limit)}</b>.`]); }
    else if (used >= limit * 0.8) { out.push(['🟠', `Budget <b>${c.name}</b> presque atteint (${Math.round(used / limit * 100)}%).`]); }
  }

  return out.slice(0, 4);
}

// ---------------- Détecteur d'abonnements (la "Liste noire") ----------------
// Pur calcul local sur state.transactions. Aucune connexion. Repère les débits
// récurrents (même marchand, montant stable, cadence régulière) et les chiffre à l'année.

// Catégories qui ne sont jamais des abonnements résiliables (loyer, crédit, virements internes).
const CAT_NON_ABO = new Set(['logement', 'credits', 'banque', 'epargne']);
// Mots parasites des libellés bancaires à jeter pour isoler le nom du marchand.
const ABO_STOPWORDS = new Set(['paiement', 'carte', 'cb', 'prlv', 'prelevement', 'sepa', 'vir',
  'virement', 'achat', 'retrait', 'france', 'fr', 'com', 'www', 'avec', 'pour', 'date', 'ref',
  'sarl', 'sas', 'eurl', 'facture', 'mensuel', 'mensuelle', 'abonnement', 'client', 'recu',
  'inst', 'ste', 'du', 'le', 'la', 'les', 'des', 'un', 'une', 'par', 'sur', 'aux', 'de', 'et',
  'ope', 'no', 'num', 'id', 'euro', 'eur']);

// Signature marchand : 2 tokens les plus significatifs, triés, pour regrouper
// "PRLV SEPA NETFLIX.COM" et "NETFLIX PAIEMENT CB" sous la même clé.
function merchantKey(note) {
  const tokens = normTxt(note).split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !ABO_STOPWORDS.has(w) && !/^\d+$/.test(w));
  if (!tokens.length) return null;
  tokens.sort((a, b) => b.length - a.length);
  return tokens.slice(0, 2).sort().join(' ');
}
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Classe une cadence médiane (jours) en fréquence nommée + nombre de prélèvements/an.
function classifyFreq(gap) {
  if (gap >= 6 && gap <= 9) return { freq: 'hebdomadaire', parAn: 52 };
  if (gap >= 12 && gap <= 16) return { freq: 'bimensuel', parAn: 26 };
  if (gap >= 25 && gap <= 35) return { freq: 'mensuel', parAn: 12 };
  if (gap >= 58 && gap <= 70) return { freq: 'bimestriel', parAn: 6 };
  if (gap >= 85 && gap <= 100) return { freq: 'trimestriel', parAn: 4 };
  if (gap >= 335 && gap <= 395) return { freq: 'annuel', parAn: 1 };
  return null; // cadence irrégulière -> pas un abonnement
}
// Tolérance de montant : 12% relatif, plancher 1€ (absorbe une petite hausse de tarif,
// mais sépare deux abonnements distincts d'un même marchand, ex Bouygues 14,99 et 44,39).
function amountTol(ref) { return Math.max(Math.abs(ref) * 0.12, 1); }
// Regroupe les opérations d'un marchand par PALIER de montant. Un abonnement a un montant
// fixe : ce clustering isole chaque prélèvement récurrent et écarte les montants exceptionnels.
function clusterByAmount(txs) {
  const sorted = txs.slice().sort((a, b) => a.amount - b.amount);
  const clusters = [];
  for (const t of sorted) {
    const last = clusters[clusters.length - 1];
    if (last) {
      const ref = median(last.map((x) => x.amount));
      if (Math.abs(t.amount - ref) <= amountTol(ref)) { last.push(t); continue; }
    }
    clusters.push([t]);
  }
  return clusters;
}
// Le détecteur. Rend la liste triée du plus cher (à l'année) au moins cher.
function detecterAbonnements(opts = {}) {
  const minOcc = opts.minOccurrences || 3;
  const refDate = opts.refDate ? new Date(opts.refDate) : new Date();

  const depenses = (state.transactions || []).filter(
    (t) => t.type === 'expense' && !CAT_NON_ABO.has(t.category));

  const groupes = {};
  for (const t of depenses) {
    const k = merchantKey(t.note);
    if (!k) continue;
    (groupes[k] = groupes[k] || []).push(t);
  }

  const abos = [];
  for (const [key, txs] of Object.entries(groupes)) {
    // On sépare d'abord par palier de montant, puis on teste la régularité de chaque palier.
    for (const cluster of clusterByAmount(txs)) {
      if (cluster.length < minOcc) continue;
      // Couverture : un abonnement domine les opérations de son marchand (Netflix = 3/3).
      // Un marchand de courses (Intermarché) a des dizaines d'achats dont un petit paquet
      // qui semble périodique par hasard : ce cluster est minoritaire, on l'écarte.
      if (cluster.length < txs.length * 0.5) continue;
      cluster.sort((a, b) => (a.date < b.date ? -1 : 1));

      const gaps = [];
      for (let i = 1; i < cluster.length; i++) gaps.push(daysBetween(cluster[i - 1].date, cluster[i].date));
      const gapMed = median(gaps);
      const cls = classifyFreq(gapMed);
      if (!cls) continue;

      const montants = cluster.map((t) => t.amount);
      const montMed = median(montants);
      if (montMed <= 0) continue;

      const dernier = cluster[cluster.length - 1].date;
      const actif = daysBetween(dernier, refDate) <= gapMed * 1.8;

      abos.push({
        marchand: cluster[cluster.length - 1].note.trim(),
        cle: key + '|' + Math.round(montMed * 100), // marchand + palier de montant
        montant: round2(montMed),
        frequence: cls.freq,
        coutAnnuel: round2(montMed * cls.parAn),
        occurrences: cluster.length,
        totalPaye: round2(montants.reduce((s, m) => s + m, 0)),
        premier: cluster[0].date,
        dernier,
        categorie: cluster[0].category,
        actif,
      });
    }
  }
  abos.sort((a, b) => b.coutAnnuel - a.coutAnnuel);
  return abos;
}

// Fréquences proposées pour un abonnement ajouté à la main.
const FREQS = [
  { id: 'hebdomadaire', label: 'Hebdo', parAn: 52 },
  { id: 'mensuel', label: 'Mensuel', parAn: 12 },
  { id: 'bimestriel', label: 'Tous les 2 mois', parAn: 6 },
  { id: 'trimestriel', label: 'Trimestriel', parAn: 4 },
  { id: 'annuel', label: 'Annuel', parAn: 1 },
];
function freqParAn(f) {
  const m = { hebdomadaire: 52, bimensuel: 26, mensuel: 12, bimestriel: 6, trimestriel: 4, annuel: 1 };
  return m[f] || 12;
}

// Palette d'icônes 3D assignables à une opération (purement visuel, ne change PAS la catégorie).
const ICON_CHOICES = ['shield', 'repeat', 'moneywings', 'bank', 'house', 'car', 'fuel', 'receipt',
  'bulb', 'droplet', 'phone', 'antenna', 'tv', 'music', 'game', 'cart', 'burger', 'coffee', 'pill',
  'trophy', 'plane', 'gift', 'briefcase', 'pig', 'cigarette', 'coat', 'beer', 'paw', 'card', 'slot',
  'medical', 'stetho', 'hospital', 'grad', 'fish', 'wrench', 'package'];
// Icônes 3D (Fluent, embarquées localement). L'icône d'une opération = icône perso sinon catégorie.
function iconSrc(slug) { return 'icons/i3d/' + slug + '.png'; }
function iconImg(slug) { return '<img class="ic3d" src="' + iconSrc(slug) + '" alt="" loading="lazy">'; }
function txIconSlug(t) {
  if (t && t.icon) return t.icon;                 // icône choisie explicitement sur CETTE opération
  const learned = t && iconFromRules(t.note);     // icône apprise pour ce marchand
  if (learned) return learned;
  return (t && t.category) || 'autres';           // sinon icône de la catégorie
}

// Marchands distincts tirés des dépenses (pour pré-remplir une récurrence ou repérer un abo).
function merchantsFromTx() {
  const groups = {};
  for (const t of (state.transactions || [])) {
    if (t.type !== 'expense') continue;
    const k = merchantKey(t.note);
    if (!k) continue;
    (groups[k] = groups[k] || []).push(t);
  }
  return Object.entries(groups).map(([k, txs]) => {
    txs.sort((a, b) => (a.date < b.date ? 1 : -1));
    const montants = txs.map((t) => t.amount);
    const catCount = {};
    txs.forEach((t) => { catCount[t.category] = (catCount[t.category] || 0) + 1; });
    const categorie = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0][0];
    return { cle: k, label: txs[0].note.trim(), montant: round2(median(montants)), categorie, count: txs.length };
  }).sort((a, b) => b.count - a.count);
}

// Enrichit un abonnement ajouté à la main avec ses vraies occurrences (même marchand
// et montant proche du palier enregistré dans la clé "marchand|centimes").
function enrichManuel(m) {
  const parAn = freqParAn(m.frequence);
  const occ = [];
  const [mk, cents] = String(m.cle || '').split('|');
  const cible = cents ? parseInt(cents, 10) / 100 : m.montant;
  if (mk) {
    for (const t of (state.transactions || [])) {
      if (t.type !== 'expense' || merchantKey(t.note) !== mk) continue;
      if (cible && Math.abs(t.amount - cible) > amountTol(cible)) continue;
      occ.push(t);
    }
  }
  occ.sort((a, b) => (a.date < b.date ? -1 : 1));
  const montants = occ.map((t) => t.amount);
  const montant = montants.length ? round2(median(montants)) : round2(m.montant);
  const dernier = occ.length ? occ[occ.length - 1].date : null;
  const premier = occ.length ? occ[0].date : null;
  const actif = dernier ? daysBetween(dernier, new Date()) <= (365 / parAn) * 1.8 : true;
  return {
    marchand: m.marchand, cle: m.cle, montant, frequence: m.frequence,
    coutAnnuel: round2(montant * parAn), occurrences: occ.length,
    totalPaye: round2(montants.reduce((s, x) => s + x, 0)),
    premier, dernier, categorie: m.categorie, actif,
    manuel: true, manuelId: m.id,
  };
}

// La liste complète de la Liste noire = auto-détectés + ajoutés à la main, moins les écartés.
function collectAbonnements() {
  const ignore = state.aboIgnore || {};
  const manuel = state.aboManuel || [];
  const manuelCles = new Set(manuel.map((m) => m.cle).filter(Boolean));
  const auto = detecterAbonnements();

  const list = [];
  for (const a of auto) {
    if (ignore[a.cle] || manuelCles.has(a.cle)) continue;
    list.push(Object.assign({}, a, { manuel: false, uid: 'a:' + a.cle }));
  }
  for (const m of manuel) {
    const e = enrichManuel(m);
    e.uid = 'm:' + m.id;
    list.push(e);
  }
  list.sort((a, b) => b.coutAnnuel - a.coutAnnuel);
  const ignores = auto.filter((a) => ignore[a.cle]);
  return { list, ignores };
}

// ---------------- Vues ----------------
function render() {
  const v = el('view');
  if (currentTab === 'dashboard') v.innerHTML = viewDashboard();
  else if (currentTab === 'tx') v.innerHTML = viewTx();
  else if (currentTab === 'budgets') v.innerHTML = viewBudgets();
  else if (currentTab === 'abos') v.innerHTML = viewAbos();
  else if (currentTab === 'settings') v.innerHTML = viewSettings();
  bindView();
}

// Vrai solde du compte = solde de départ (tel qu'affiché par la banque à une date)
// + toutes les opérations POSTÉRIEURES à cette date. Retourne null si non configuré.
// Comparaison de dates en chaîne YYYY-MM-DD (l'ordre lexical = ordre chronologique).
function accountBalance() {
  const s = state.settings;
  if (s.startBalance == null || !s.startBalanceDate) return null;
  const delta = state.transactions.reduce((acc, t) =>
    t.date > s.startBalanceDate ? acc + (t.type === 'expense' ? -t.amount : t.amount) : acc, 0);
  return round2(s.startBalance + delta);
}

function viewDashboard() {
  const mk = thisMonth();
  const cur = txOfMonth(mk);
  const income = sumBy(cur, 'income');
  const expense = sumBy(cur, 'expense');
  const balance = round2(income - expense);
  const acct = accountBalance();
  const monthLabel = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  // reste à vivre / jour : basé sur les revenus (ce qui reste réellement pour vivre),
  // à défaut sur le total des budgets définis.
  let safeBlock = '';
  const income0 = state.settings.monthlyIncome || 0;
  const useIncome = income0 > 0;
  const ref = useIncome ? income0 : totalBudget();
  // Récurrences de dépense encore à venir ce mois : on les met de côté (provision).
  const pend = pendingRecurring(mk);
  const pendExp = round2(pend.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0));
  if (ref > 0) {
    const remaining = round2(ref - expense - pendExp);
    const perDay = round2(remaining / daysLeftInMonth());
    const col = remaining < 0 ? 'var(--red)' : 'var(--green)';
    safeBlock = `
      <div class="card">
        <div class="safe">
          <div>
            <div class="big" style="color:${col}">${euro(Math.max(0, perDay))}</div>
            <div class="lbl">à dépenser par jour d'ici la fin du mois</div>
          </div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:8px">
          Il te reste <b style="color:${col}">${euro(remaining)}</b> sur ${useIncome ? 'tes revenus' : 'ton budget'} pour ${daysLeftInMonth()} jour(s).${pendExp > 0 ? ` <b>${euro(pendExp)}</b> mis de côté pour tes récurrences à venir.` : ''}
        </div>
      </div>`;
  } else {
    safeBlock = `<div class="card muted" style="font-size:13px">
      💡 Définis tes budgets ou tes revenus mensuels (onglet Budgets / Réglages) pour voir ton <b>reste à vivre par jour</b>.
    </div>`;
  }

  const insights = buildInsights();
  const insightsHtml = insights.length ? `
    <div class="section-title">Conseils intelligents</div>
    <div class="card">
      ${insights.map(([e, t]) => `<div class="insight"><span class="emo">${e}</span><span class="txt">${t}</span></div>`).join('')}
    </div>` : '';

  // récurrences à venir ce mois (touche pour enregistrer en une fois)
  const pendHtml = pend.length ? `
    <div class="section-title">À venir ce mois-ci</div>
    <div class="card" style="padding:8px 12px">
      ${pend.slice().sort((a, b) => a.day - b.day).map((r) => {
        const c = catById(r.category);
        const cls = r.type === 'expense' ? 'exp' : 'inc';
        const sign = r.type === 'expense' ? '-' : '+';
        return `<div class="tx-item" data-recpay="${r.id}" style="margin-bottom:6px">
          <div class="tx-ico">${iconImg(c.id)}</div>
          <div class="tx-main"><div class="tx-cat">${escapeHtml(r.note || c.name)}</div>
          <div class="tx-note">prévu le ${r.day} · touche pour enregistrer</div></div>
          <div class="tx-amt ${cls}">${sign}${euro(r.amount)}</div>
        </div>`;
      }).join('')}
    </div>` : '';

  // dernières opérations
  const recent = state.transactions.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4);
  const recentHtml = recent.length ? recent.map(txRow).join('') :
    `<div class="empty"><span class="big-emo">🗒️</span>Aucune opération pour l'instant.</div>`;

  return `
    ${trialBanner()}
    ${installBanner()}
    <div class="page-head">
      <div>
        <h1 class="page-title">Bonjour 👋</h1>
        <p class="page-sub" style="text-transform:capitalize">${monthLabel}</p>
      </div>
    </div>

    <div class="hero">
      <p class="hero-label">${acct !== null ? 'Solde du compte' : 'Solde du mois'}</p>
      <p class="hero-amount">${euro(acct !== null ? acct : balance)}</p>
      <div class="hero-row">
        <div class="hero-stat"><p class="l">↓ Revenus du mois</p><p class="v">${euro(income)}</p></div>
        <div class="hero-stat"><p class="l">↑ Dépenses du mois</p><p class="v">${euro(expense)}</p></div>
      </div>
    </div>
    ${acct === null ? `<div class="card muted" style="font-size:13px;margin-top:12px">
      🏦 Pour afficher le <b>vrai solde de ton compte</b>, indique ton <b>solde de départ</b> dans Réglages → Solde du compte. Sinon Coffre ne connaît pas ce qu'il y avait avant tes opérations et le total ne correspond pas à ta banque.
    </div>` : ''}

    <div style="height:14px"></div>
    ${safeBlock}
    ${insightsHtml}
    ${pendHtml}

    <div class="section-title">Dernières opérations</div>
    ${recentHtml}
  `;
}

// Icône affichée d'une opération : icône perso choisie à la main, sinon celle de la catégorie.
function txRow(t) {
  const c = catById(t.category);
  const cls = t.type === 'expense' ? 'exp' : 'inc';
  const sign = t.type === 'expense' ? '-' : '+';
  return `
    <div class="tx-item" data-edit="${t.id}">
      <div class="tx-ico">${iconImg(txIconSlug(t))}</div>
      <div class="tx-main">
        <div class="tx-cat">${escapeHtml(c.name)}</div>
        <div class="tx-note">${escapeHtml(t.note || new Date(t.date).toLocaleDateString('fr-FR'))}</div>
      </div>
      <div class="tx-amt ${cls}">${sign}${euro(t.amount)}</div>
    </div>`;
}

function availableMonths() {
  return [...new Set(state.transactions.map((t) => monthKey(t.date)))].sort().reverse();
}
// Applique les filtres actifs (recherche, mois, catégorie, type) et trie du plus récent.
function filteredTx() {
  const q = normTxt(txFilter.q);
  return state.transactions.filter((t) => {
    if (txFilter.type !== 'all' && t.type !== txFilter.type) return false;
    if (txFilter.month !== 'all' && monthKey(t.date) !== txFilter.month) return false;
    if (txFilter.cat !== 'all' && t.category !== txFilter.cat) return false;
    if (q) {
      const hay = normTxt((t.note || '') + ' ' + catById(t.category).name);
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (a.date < b.date ? 1 : -1));
}
function renderTxListHtml() {
  const list = filteredTx();
  if (!list.length) {
    return `<div class="empty"><span class="big-emo">🔍</span>Aucune opération ne correspond.</div>`;
  }
  const anyFilter = txFilter.q || txFilter.month !== 'all' || txFilter.cat !== 'all' || txFilter.type !== 'all';
  let solde = 0;
  let html = '';
  let lastKey = '';
  for (const t of list) {
    solde += t.type === 'expense' ? -t.amount : t.amount;
    if (t.date !== lastKey) {
      lastKey = t.date;
      const d = new Date(t.date + 'T00:00:00');
      let lbl = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      if (t.date === todayISO()) lbl = "Aujourd'hui";
      html += `<div class="tx-date-group">${lbl}</div>`;
    }
    html += txRow(t);
  }
  const sum = anyFilter
    ? `<div class="filter-sum">${list.length} opération(s) · solde ${euro(round2(solde))}</div>`
    : '';
  return sum + html;
}
function viewTx() {
  if (!state.transactions.length) {
    return `<div class="page-head"><h1 class="page-title">Opérations</h1></div>
      <div class="empty"><span class="big-emo">🗒️</span>Aucune opération.<br>Appuie sur <b>+</b> pour commencer.</div>`;
  }
  const months = availableMonths();
  if (txFilter.month !== 'all' && !months.includes(txFilter.month)) txFilter.month = 'all';
  const catsPresent = [...new Set(state.transactions.map((t) => t.category))];
  if (txFilter.cat !== 'all' && !catsPresent.includes(txFilter.cat)) txFilter.cat = 'all';

  const monthOpts = ['<option value="all">Tous les mois</option>'].concat(
    months.map((mk) => {
      const lbl = new Date(mk + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      return `<option value="${mk}" ${txFilter.month === mk ? 'selected' : ''}>${lbl}</option>`;
    })).join('');
  const catOpts = ['<option value="all">Toutes catégories</option>'].concat(
    catsPresent.map((id) => {
      const c = catById(id);
      return `<option value="${id}" ${txFilter.cat === id ? 'selected' : ''}>${c.emoji} ${c.name}</option>`;
    })).join('');

  return `
    <div class="page-head"><h1 class="page-title">Opérations</h1></div>
    <div class="filters">
      <input id="flt-q" class="flt-search" type="text" inputmode="search" placeholder="🔍 Rechercher (libellé, catégorie)" value="${escapeHtml(txFilter.q)}">
      <div class="seg flt-seg">
        <button data-ftype="all" class="${txFilter.type === 'all' ? 'on-all' : ''}">Tout</button>
        <button data-ftype="expense" class="${txFilter.type === 'expense' ? 'on-exp' : ''}">Dépenses</button>
        <button data-ftype="income" class="${txFilter.type === 'income' ? 'on-inc' : ''}">Revenus</button>
      </div>
      <div class="flt-row">
        <select id="flt-month">${monthOpts}</select>
        <select id="flt-cat">${catOpts}</select>
      </div>
    </div>
    <div id="tx-list">${renderTxListHtml()}</div>`;
}

function donutSvg(byCat, totalExp) {
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length || totalExp <= 0) {
    return `<div class="empty" style="padding:20px"><span class="big-emo">📊</span>Pas encore de dépenses ce mois.</div>`;
  }
  const r = 42, C = 2 * Math.PI * r;
  let offset = 0;
  let circles = '';
  let legend = '';
  entries.forEach(([cat, val], i) => {
    const frac = val / totalExp;
    const len = frac * C;
    const color = PALETTE[i % PALETTE.length];
    circles += `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="16"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 60 60)"></circle>`;
    offset += len;
    const c = catById(cat);
    legend += `<div class="legend-row">
      <span class="legend-dot" style="background:${color}"></span>
      <span class="legend-name">${iconImg(c.id)} ${escapeHtml(c.name)}</span>
      <span class="legend-val">${Math.round(frac * 100)}%</span>
    </div>`;
  });
  return `
    <div class="chart-wrap">
      <svg class="donut" width="120" height="120" viewBox="0 0 120 120">
        ${circles}
        <text x="60" y="56" text-anchor="middle" font-size="11" fill="var(--muted)">Dépenses</text>
        <text x="60" y="72" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)">${euro(totalExp)}</text>
      </svg>
      <div class="legend">${legend}</div>
    </div>`;
}

function monthsBars(selectedKey) {
  const now = new Date();
  const cols = [];
  let max = 1;
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = ym(d);
    const val = sumBy(txOfMonth(key), 'expense');
    max = Math.max(max, val);
    cols.push({ key, lbl: d.toLocaleDateString('fr-FR', { month: 'short' }), val });
  }
  const bars = cols.map((c) => {
    const h = Math.max(4, Math.round((c.val / max) * 100));
    const sel = c.key === selectedKey ? ' sel' : '';
    return `<button class="month-col${sel}" data-month="${c.key}">
      <div class="month-bar" style="height:${h}%"></div>
      <div class="month-lbl">${c.lbl}</div>
    </button>`;
  }).join('');
  return `<div class="months">${bars}</div>`;
}

function viewBudgets() {
  const mk = analyticsMonth || thisMonth();
  const byCat = expenseByCat(txOfMonth(mk));
  const totalExp = sumBy(txOfMonth(mk), 'expense');
  const moisLabel = new Date(mk + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  // budgets définis
  const budgetRows = EXPENSE_CATS.map((c) => {
    const base = state.budgets[c.id] || 0;
    if (!base) return '';
    const limit = effectiveBudget(c.id, mk);
    const used = byCat[c.id] || 0;
    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
    const cls = used > limit ? 'bar-over' : (used >= limit * 0.8 ? 'bar-warn' : 'bar-ok');
    const diff = round2(limit - base);
    const rollNote = (state.settings.budgetRollover && diff !== 0)
      ? `<div class="muted" style="font-size:11px;margin-top:3px">Base ${euro(base)} · report ${diff > 0 ? '+' : ''}${euro(diff)}</div>`
      : '';
    return `
      <div class="budget-item" data-budget="${c.id}">
        <div class="budget-top">
          <span class="budget-name">${iconImg(c.id)} ${c.name}</span>
          <span class="budget-val">${euro(used)} / ${euro(limit)}</span>
        </div>
        <div class="bar ${cls}"><i style="width:${pct}%"></i></div>
        ${rollNote}
      </div>`;
  }).join('');

  const hasBudgets = Object.values(state.budgets).some((v) => v > 0);

  return `
    <div class="page-head"><h1 class="page-title">Budgets & analyse</h1></div>

    <div class="section-title">Dépenses des 6 derniers mois</div>
    <div class="card">
      ${monthsBars(mk)}
      <div class="muted" style="font-size:12px;text-align:center;margin-top:8px">Touche un mois pour voir sa répartition</div>
    </div>

    <div class="section-title" style="text-transform:capitalize">Répartition — ${moisLabel}</div>
    <div class="card">${donutSvg(byCat, totalExp)}</div>

    <div class="section-title">Budgets de <span style="text-transform:capitalize">${moisLabel}</span></div>
    <div class="card">
      ${hasBudgets ? budgetRows : '<div class="muted" style="font-size:13px">Aucun budget défini. Fixe une limite par catégorie pour être alerté avant de déraper.</div>'}
      <button class="btn btn-2" id="edit-budgets" style="margin-top:14px">🎯 Modifier mes budgets</button>
    </div>
  `;
}

// ---------------- Vue : Liste noire (abonnements) ----------------
function viewAbos() {
  if (!state.transactions.length) {
    return `<div class="section-title">🎯 Liste noire</div>
      <div class="card muted" style="font-size:13px">
        Importe ou saisis tes opérations (onglet Réglages ou bouton <b>+</b>) : je repère
        ensuite tout seul tes abonnements récurrents et je les chiffre à l'année.
      </div>`;
  }
  const { list, ignores } = collectAbonnements();
  const aideManuel = `
    <div class="card muted" style="font-size:12px">
      💡 Un abonnement manque à l'appel (mensualité d'assurance, forfait mobile…) ?
      Ouvre la dépense dans l'onglet <b>Opérations</b> et touche « 🎯 Marquer comme abonnement ».
    </div>`;

  if (!list.length) {
    return `<div class="section-title">🎯 Liste noire</div>
      <div class="card" style="text-align:center;padding:24px">
        <div style="font-size:40px">✅</div>
        <div style="margin-top:8px"><b>Aucun abonnement récurrent détecté.</b></div>
        <div class="muted" style="font-size:12px;margin-top:6px">
          Il me faut au moins 3 prélèvements réguliers du même marchand, à montant stable, pour flairer un abonnement.
        </div>
      </div>
      ${aideManuel}
      ${ignores.length ? aboIgnoresHtml(ignores) : ''}`;
  }

  const actifs = list.filter((a) => a.actif);
  const totalAn = round2(actifs.reduce((s, a) => s + a.coutAnnuel, 0));
  const totalMois = round2(totalAn / 12);

  const hero = `
    <div class="card" style="text-align:center;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff">
      <div style="font-size:12px;opacity:.9;text-transform:uppercase;letter-spacing:.5px">Tes abonnements actifs te coûtent</div>
      <div class="big" style="color:#fff;font-size:34px;margin:4px 0">${euro(totalAn)}<span style="font-size:16px">/an</span></div>
      <div style="font-size:13px;opacity:.95">soit ${euro(totalMois)} par mois · ${actifs.length} abonnement(s) actif(s)</div>
    </div>`;

  const cards = list.map((a) => {
    const c = catById(a.categorie);
    const badge = a.actif
      ? '<span class="abo-badge on">Actif</span>'
      : '<span class="abo-badge off">Inactif</span>';
    const manTag = a.manuel ? '<span class="abo-badge man">ajouté</span>' : '';
    const sub = `${euro(a.montant)} · ${a.frequence}`
      + (a.occurrences ? ` · ${a.occurrences} prélèvement(s)` : '')
      + (a.premier ? ` · depuis ${frDate(a.premier)}` : '');
    const action2 = a.manuel
      ? `<button class="btn btn-2 abo-btn" data-removeabo="${escapeHtml(a.manuelId)}">Retirer</button>`
      : `<button class="btn btn-2 abo-btn" data-noabo="${escapeHtml(a.cle)}">Pas un abonnement</button>`;
    return `
      <div class="card abo-card">
        <div class="abo-top">
          <div class="tx-ico">${iconImg(c.id)}</div>
          <div style="flex:1;min-width:0">
            <div class="abo-name"><span class="abo-name-txt">${escapeHtml(a.marchand)}</span>${badge}${manTag}</div>
            <div class="muted" style="font-size:12px">${sub}</div>
          </div>
          <div style="text-align:right">
            <div class="abo-cost">${euro(a.coutAnnuel)}</div>
            <div class="muted" style="font-size:10px">par an</div>
          </div>
        </div>
        <div class="abo-actions">
          <button class="btn btn-danger abo-btn" data-resil="${escapeHtml(a.uid)}">✍️ Résilier</button>
          ${action2}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="section-title">🎯 Liste noire</div>
    ${hero}
    <div class="muted" style="font-size:11px;margin:10px 2px">
      Détection locale sur tes opérations. Un abonnement mal classé ? Touche « Pas un abonnement », il disparaît de la liste.
    </div>
    ${cards}
    ${aideManuel}
    ${ignores.length ? aboIgnoresHtml(ignores) : ''}`;
}

function aboIgnoresHtml(ignores) {
  return `
    <div class="section-title" style="font-size:13px">Écartés (${ignores.length})</div>
    <div class="card" style="padding:8px 12px">
      ${ignores.map((a) => `
        <div class="tx-item" style="margin-bottom:4px">
          <div class="tx-main"><div class="tx-cat" style="font-size:13px">${escapeHtml(a.marchand)}</div></div>
          <button class="linkbtn" data-restore="${escapeHtml(a.cle)}">Rétablir</button>
        </div>`).join('')}
    </div>`;
}

function bindAbos() {
  document.querySelectorAll('[data-noabo]').forEach((n) =>
    n.addEventListener('click', async () => {
      state.aboIgnore = state.aboIgnore || {};
      state.aboIgnore[n.getAttribute('data-noabo')] = true;
      await save(); render(); toast('Écarté de la liste noire');
    }));
  document.querySelectorAll('[data-removeabo]').forEach((n) =>
    n.addEventListener('click', async () => {
      state.aboManuel = (state.aboManuel || []).filter((m) => m.id !== n.getAttribute('data-removeabo'));
      await save(); render(); toast('Retiré des abonnements');
    }));
  document.querySelectorAll('[data-restore]').forEach((n) =>
    n.addEventListener('click', async () => {
      if (state.aboIgnore) delete state.aboIgnore[n.getAttribute('data-restore')];
      await save(); render();
    }));
  document.querySelectorAll('[data-resil]').forEach((n) =>
    n.addEventListener('click', () => openResiliationSheet(n.getAttribute('data-resil'))));
}

// Lettre de résiliation type (100% locale, générée à partir du marchand).
function openResiliationSheet(uid) {
  const a = collectAbonnements().list.find((x) => x.uid === uid);
  if (!a) return;
  const nom = cleanMerchant(a.marchand);
  const lettre =
`[Ton prénom et nom]
[Ton adresse]
[Code postal, ville]
[N° de client / référence contrat]

À [ville], le ${frDate(todayISO())}

Objet : Résiliation de mon abonnement ${nom}
Lettre recommandée avec accusé de réception

Madame, Monsieur,

Par la présente, je vous informe de ma décision de résilier mon abonnement ${nom} (d'un montant de ${euro(a.montant)}, prélevé à échéance ${a.frequence}), rattaché au compte identifié ci-dessus.

Je vous demande de bien vouloir procéder à cette résiliation dans le respect du préavis contractuel, et de cesser tout prélèvement à compter de la date effective de résiliation.

Je vous remercie de m'adresser une confirmation écrite de la prise en compte de cette demande, ainsi que la date exacte de fin de contrat.

Dans l'attente, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

[Signature]`;

  const sheet = el('sheet');
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <h2>Résilier ${escapeHtml(nom)}</h2>
    <p class="muted" style="font-size:12px;margin:-8px 0 12px">
      Modèle prêt à envoyer. Complète les champs entre crochets, puis copie-le dans un mail ou un courrier.
      La résiliation par lettre recommandée fait foi.
    </p>
    <textarea id="resil-txt" class="resil-area" rows="16">${escapeHtml(lettre)}</textarea>
    <button class="btn" id="resil-copy" style="margin-top:12px">📋 Copier la lettre</button>
    <button class="btn btn-2" id="resil-close" style="margin-top:10px">Fermer</button>
  `;
  el('resil-copy').addEventListener('click', () => {
    const ta = el('resil-txt');
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (!ok && navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(() => {});
    toast('Lettre copiée ✓');
  });
  el('resil-close').addEventListener('click', closeSheet);
  el('sheet-backdrop').classList.remove('hidden');
  el('sheet').classList.remove('hidden');
}

// ---------------- Feuille : marquer une dépense comme abonnement ----------------
let aboFlagDraft = null;
function openAboFlagSheet(txId) {
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) return;
  const mk = merchantKey(tx.note);
  aboFlagDraft = {
    cle: mk ? mk + '|' + Math.round(tx.amount * 100) : null,
    marchand: tx.note.trim() || cleanMerchant(tx.note) || 'Abonnement',
    montant: tx.amount,
    categorie: tx.category,
    frequence: 'mensuel',
  };
  renderAboFlagSheet();
  el('sheet-backdrop').classList.remove('hidden');
  el('sheet').classList.remove('hidden');
}
function renderAboFlagSheet() {
  const d = aboFlagDraft;
  const sheet = el('sheet');
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <h2>Ajouter aux abonnements</h2>
    <p class="muted" style="font-size:13px;margin:-8px 0 16px">
      <b>${escapeHtml(cleanMerchant(d.marchand))}</b> · ${euro(d.montant)}
    </p>
    <div class="field">
      <label>À quelle fréquence est-il prélevé ?</label>
      <div class="cat-grid" id="freq-grid">
        ${FREQS.map((f) => `<button class="cat-chip ${f.id === d.frequence ? 'sel' : ''}" data-freq="${f.id}">${f.label}</button>`).join('')}
      </div>
    </div>
    <button class="btn" id="abo-flag-save">🎯 Ajouter à la liste noire</button>
    <button class="btn btn-2" id="abo-flag-cancel" style="margin-top:10px">Annuler</button>
  `;
  sheet.querySelectorAll('[data-freq]').forEach((n) =>
    n.addEventListener('click', () => {
      d.frequence = n.getAttribute('data-freq');
      document.querySelectorAll('#freq-grid [data-freq]').forEach((x) =>
        x.classList.toggle('sel', x.getAttribute('data-freq') === d.frequence));
    }));
  el('abo-flag-save').addEventListener('click', saveAboFlag);
  el('abo-flag-cancel').addEventListener('click', closeSheet);
}
async function saveAboFlag() {
  const d = aboFlagDraft;
  state.aboManuel = state.aboManuel || [];
  if (d.cle && state.aboManuel.some((m) => m.cle === d.cle)) {
    closeSheet(); switchTab('abos'); toast('Déjà dans tes abonnements'); return;
  }
  if (d.cle && state.aboIgnore) delete state.aboIgnore[d.cle]; // s'il avait été écarté, on le réactive
  state.aboManuel.push({
    id: crypto.randomUUID(), cle: d.cle, marchand: d.marchand,
    montant: round2(d.montant), frequence: d.frequence, categorie: d.categorie,
  });
  await save();
  closeSheet();
  switchTab('abos');
  toast('Ajouté à la liste noire ✓');
}

// Nettoie un libellé bancaire pour un courrier : enlève les mots parasites (PRLV, SEPA, CB...)
// et met en forme (Netflix, Salle Sport Basic Fit). Le libellé brut reste affiché sur la carte.
function cleanMerchant(note) {
  const mots = normTxt(note).split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !ABO_STOPWORDS.has(w) && !/^\d+$/.test(w));
  if (!mots.length) return note.trim();
  return mots.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
// Date ISO -> format FR lisible (jj/mm/aaaa), en heure locale.
function frDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function viewSettings() {
  const s = state.settings;
  return `
    <div class="page-head"><h1 class="page-title">Réglages</h1></div>

    <div class="section-title">Licence</div>
    <div class="card">
      <div class="set-row">
        <div>
          <div class="set-label">${licensed ? '✅ Version à vie' : '⏳ Version d\'essai'}</div>
          <div class="set-desc">${licensed ? 'Débloquée, merci !' : `${trialInfo().daysLeft} jour(s) restant(s)`}</div>
        </div>
        <button class="btn btn-2" style="width:auto;padding:8px 14px" id="open-licence">${licensed ? 'Voir' : 'Débloquer'}</button>
      </div>
    </div>

    <div class="section-title">Sécurité</div>
    <div class="card">
      <div class="set-row">
        <div><div class="set-label">🔒 Verrouillage auto</div><div class="set-desc">Après inactivité</div></div>
        <select id="autolock" style="width:auto;padding:8px 10px;border-radius:10px;background:var(--card-2);color:var(--text);border:1px solid var(--line)">
          <option value="1" ${s.autoLockMin == 1 ? 'selected' : ''}>1 min</option>
          <option value="3" ${s.autoLockMin == 3 ? 'selected' : ''}>3 min</option>
          <option value="5" ${s.autoLockMin == 5 ? 'selected' : ''}>5 min</option>
          <option value="0" ${s.autoLockMin == 0 ? 'selected' : ''}>Jamais</option>
        </select>
      </div>
      <div class="set-row">
        <div><div class="set-label">🔑 Changer le code PIN</div></div>
        <button class="btn btn-2" style="width:auto;padding:8px 14px" id="change-pin">Changer</button>
      </div>
      <div class="set-row">
        <div><div class="set-label">🔐 Verrouiller maintenant</div></div>
        <button class="btn btn-2" style="width:auto;padding:8px 14px" id="lock-now">Verrouiller</button>
      </div>
    </div>

    <div class="section-title">Budget</div>
    <div class="card">
      <div class="set-row">
        <div><div class="set-label">💶 Revenus mensuels</div><div class="set-desc">Sert au "reste à vivre" si pas de budgets</div></div>
        <input id="income" type="text" inputmode="decimal" value="${s.monthlyIncome || ''}" placeholder="0" style="width:110px;text-align:right;padding:10px;border-radius:10px;background:var(--card-2);color:var(--text);border:1px solid var(--line)">
      </div>
      <div class="set-row">
        <div><div class="set-label">🔁 Report du budget</div><div class="set-desc">Le solde non dépensé s'ajoute au mois suivant</div></div>
        <label class="switch"><input type="checkbox" id="rollover-toggle" ${s.budgetRollover ? 'checked' : ''}><span class="track"></span></label>
      </div>
      <div class="set-row">
        <div><div class="set-label">🌗 Thème clair</div></div>
        <label class="switch"><input type="checkbox" id="theme-toggle" ${s.theme === 'light' ? 'checked' : ''}><span class="track"></span></label>
      </div>
    </div>

    <div class="section-title">Opérations récurrentes</div>
    <div class="card">
      <div class="set-desc" style="margin-bottom:12px">Loyer, abonnements, salaire… déclare ce qui revient chaque mois. Le tableau de bord <b>met de côté</b> ces montants dans ton reste à vivre tant que tu ne les as pas enregistrés.</div>
      ${recurringListHtml()}
      <button class="btn btn-2" id="add-recurring" style="margin-top:12px">➕ Ajouter une récurrence</button>
    </div>

    <div class="section-title">Solde du compte</div>
    <div class="card">
      <div class="set-desc" style="margin-bottom:12px">Reporte le <b>solde exact affiché par ta banque</b> à une date, <b>avant</b> les opérations qui suivent (par ex. le dernier solde connu juste avant ta première opération importée). Coffre ajoute ensuite tes opérations des jours suivants pour afficher ton <b>vrai solde de compte</b>.</div>
      <div class="set-row">
        <div><div class="set-label">💰 Solde de départ</div></div>
        <input id="start-balance" type="text" inputmode="decimal" value="${s.startBalance != null ? s.startBalance : ''}" placeholder="0" style="width:120px;text-align:right;padding:10px;border-radius:10px;background:var(--card-2);color:var(--text);border:1px solid var(--line)">
      </div>
      <div class="set-row">
        <div><div class="set-label">📅 À cette date</div><div class="set-desc">Solde de ce jour-là, avant les opérations suivantes</div></div>
        <input id="start-date" type="date" value="${s.startBalanceDate || ''}" max="${todayISO()}" style="padding:10px;border-radius:10px;background:var(--card-2);color:var(--text);border:1px solid var(--line)">
      </div>
      <button class="btn btn-2" id="save-start" style="margin-top:12px">Enregistrer le solde de départ</button>
    </div>

    <div class="section-title">Importer un relevé</div>
    <div class="card">
      <div class="set-desc" style="margin-bottom:12px">Importe le fichier <b>Excel (.xlsx), CSV ou PDF</b> exporté depuis ta banque. Il est lu <b>sur ton téléphone</b>, jamais envoyé ailleurs. Tu vérifies tout avant de valider, et les doublons sont ignorés. <b>Excel reste le plus fiable</b> ; le PDF marche mais vérifie bien l'aperçu.</div>
      <button class="btn" id="import-stmt">📥 Importer un relevé bancaire</button>
      <input type="file" id="stmt-file" accept=".csv,.xls,.xlsx,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hidden">
      <button class="btn btn-2" id="recat" style="margin-top:10px">🏷️ Re-catégoriser mes opérations</button>
    </div>

    <div class="section-title">Mes données</div>
    <div class="card">
      <div class="set-desc" style="margin-bottom:12px">Tes données sont chiffrées et stockées <b>uniquement sur cet appareil</b>. La sauvegarde est elle aussi <b>chiffrée</b> : le fichier est illisible sans ton code. Fais-en une régulièrement : si tu perds le téléphone ou oublies ton code, elles sont irrécupérables.</div>
      <div class="btn-row">
        <button class="btn btn-2" id="export">⬇️ Sauvegarder</button>
        <button class="btn btn-2" id="import">⬆️ Restaurer</button>
      </div>
      <input type="file" id="import-file" accept="application/json" class="hidden">
      <button class="btn btn-2" id="clear-tx" style="margin-top:12px">🧹 Effacer les opérations</button>
      <button class="btn btn-danger" id="wipe" style="margin-top:10px">🗑️ Tout effacer (code compris)</button>
    </div>

    <div class="section-title">Mise à jour</div>
    <div class="card">
      <div class="set-row">
        <div>
          <div class="set-label">Version installée</div>
          <div class="set-desc">${updateReady ? '<b style="color:var(--accent)">Nouvelle version disponible !</b>' : 'Ta version est à jour.'}</div>
        </div>
        <span class="ver-pill">Coffre ${APP_VERSION}</span>
      </div>
      <button class="btn ${updateReady ? '' : 'btn-2'}" id="do-update" style="margin-top:12px">${updateReady ? '⬇️ Installer la nouvelle version' : '🔄 Mettre à jour'}</button>
      <div class="set-desc" style="margin-top:10px">🔒 Une mise à jour <b>n'efface jamais</b> tes opérations ni tes réglages. Elle ne remplace que l'application.</div>
    </div>

    <p id="ver-foot" class="muted" style="text-align:center;font-size:12px;margin-top:20px">Coffre ${APP_VERSION} • 100% hors-ligne • chiffré AES-256</p>
  `;
}

function recurringListHtml() {
  const list = state.recurring || [];
  if (!list.length) return '<div class="muted" style="font-size:13px">Aucune récurrence définie.</div>';
  return list.slice().sort((a, b) => a.day - b.day).map((r) => {
    const c = catById(r.category);
    const cls = r.type === 'expense' ? 'exp' : 'inc';
    const sign = r.type === 'expense' ? '-' : '+';
    return `<div class="tx-item" data-recur="${r.id}" style="margin-bottom:8px">
      <div class="tx-ico">${iconImg(c.id)}</div>
      <div class="tx-main">
        <div class="tx-cat">${escapeHtml(r.note || c.name)}</div>
        <div class="tx-note">le ${r.day} de chaque mois · ${c.name}</div>
      </div>
      <div class="tx-amt ${cls}">${sign}${euro(r.amount)}</div>
    </div>`;
  }).join('');
}

function installBanner() {
  if (!deferredInstall) return '';
  return `<div class="install-banner">
    <span style="font-size:22px">📲</span>
    <span class="txt">Installe Coffre sur ton écran d'accueil pour un accès rapide.</span>
    <button id="do-install">Installer</button>
  </div>`;
}

// ---------------- Liaison des événements de la vue ----------------
function bindView() {
  document.querySelectorAll('[data-edit]').forEach((n) =>
    n.addEventListener('click', () => openSheet(n.getAttribute('data-edit'))));

  const install = el('do-install');
  if (install) install.addEventListener('click', doInstall);

  if (currentTab === 'dashboard') {
    el('unlock-lic')?.addEventListener('click', openLicenceSheet);
    document.querySelectorAll('[data-recpay]').forEach((n) =>
      n.addEventListener('click', () => recordRecurring(n.getAttribute('data-recpay'))));
  }
  if (currentTab === 'tx') bindTxFilters();
  if (currentTab === 'budgets') {
    el('edit-budgets')?.addEventListener('click', openBudgetSheet);
    document.querySelectorAll('[data-month]').forEach((n) =>
      n.addEventListener('click', () => { analyticsMonth = n.getAttribute('data-month'); render(); }));
  }
  if (currentTab === 'abos') bindAbos();
  if (currentTab === 'settings') bindSettings();
}

// Filtres de l'onglet Opérations : ne re-rend QUE la liste (préserve le focus/curseur de la recherche).
function bindEditRows(container) {
  container.querySelectorAll('[data-edit]').forEach((n) =>
    n.addEventListener('click', () => openSheet(n.getAttribute('data-edit'))));
}
function refreshTxList() {
  const box = el('tx-list');
  if (!box) return;
  box.innerHTML = renderTxListHtml();
  bindEditRows(box);
}
function bindTxFilters() {
  el('flt-q')?.addEventListener('input', (e) => { txFilter.q = e.target.value; refreshTxList(); });
  el('flt-month')?.addEventListener('change', (e) => { txFilter.month = e.target.value; refreshTxList(); });
  el('flt-cat')?.addEventListener('change', (e) => { txFilter.cat = e.target.value; refreshTxList(); });
  document.querySelectorAll('[data-ftype]').forEach((b) =>
    b.addEventListener('click', () => {
      txFilter.type = b.getAttribute('data-ftype');
      document.querySelectorAll('[data-ftype]').forEach((x) => {
        const tp = x.getAttribute('data-ftype');
        x.className = txFilter.type !== tp ? '' : (tp === 'expense' ? 'on-exp' : tp === 'income' ? 'on-inc' : 'on-all');
      });
      refreshTxList();
    }));
}

function bindSettings() {
  el('autolock').addEventListener('change', async (e) => {
    state.settings.autoLockMin = parseInt(e.target.value, 10);
    await save(); resetAutoLock(); toast('Enregistré');
  });
  el('theme-toggle').addEventListener('change', async (e) => {
    state.settings.theme = e.target.checked ? 'light' : 'dark';
    applyTheme(); await save();
  });
  el('rollover-toggle').addEventListener('change', async (e) => {
    state.settings.budgetRollover = e.target.checked;
    await save(); toast('Enregistré');
  });
  el('add-recurring').addEventListener('click', () => openRecurringSheet(null));
  document.querySelectorAll('[data-recur]').forEach((n) =>
    n.addEventListener('click', () => openRecurringSheet(n.getAttribute('data-recur'))));
  el('income').addEventListener('change', async (e) => {
    const v = parseFloat(e.target.value.replace(',', '.'));
    state.settings.monthlyIncome = isNaN(v) ? 0 : round2(v);
    await save(); toast('Enregistré');
  });
  el('save-start').addEventListener('click', async () => {
    const raw = el('start-balance').value.trim();
    const date = el('start-date').value;
    if (raw === '' || !date) {
      // champs vidés : on efface le solde de départ (revient à la somme des opérations)
      state.settings.startBalance = null;
      state.settings.startBalanceDate = '';
      await save(); render(); toast('Solde de départ effacé');
      return;
    }
    const v = parseFloat(raw.replace(/\s/g, '').replace(',', '.'));
    if (isNaN(v)) { toast('Montant invalide'); return; }
    state.settings.startBalance = round2(v);
    state.settings.startBalanceDate = date;
    await save(); render(); toast('Solde de départ enregistré');
  });
  el('open-licence').addEventListener('click', openLicenceSheet);
  el('lock-now').addEventListener('click', lockApp);
  el('change-pin').addEventListener('click', changePin);
  el('export').addEventListener('click', exportData);
  el('import').addEventListener('click', () => el('import-file').click());
  el('import-file').addEventListener('change', importData);
  el('import-stmt').addEventListener('click', () => el('stmt-file').click());
  el('stmt-file').addEventListener('change', handleStatementFile);
  el('recat').addEventListener('click', recategorizeAll);
  el('clear-tx').addEventListener('click', clearTransactions);
  el('wipe').addEventListener('click', wipeAll);
  el('do-update')?.addEventListener('click', doAppUpdate);
  bindLongPress(el('ver-foot'), openGeneratorSheet);   // accès caché au générateur de licences
}
// Détecte un appui long (700 ms) sur un élément, souris et tactile.
function bindLongPress(node, cb, ms) {
  if (!node) return;
  let t = null;
  const start = () => { t = setTimeout(() => { t = null; cb(); }, ms || 700); };
  const cancel = () => { if (t) { clearTimeout(t); t = null; } };
  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchend', cancel);
  node.addEventListener('touchmove', cancel, { passive: true });
  node.addEventListener('mousedown', start);
  node.addEventListener('mouseup', cancel);
  node.addEventListener('mouseleave', cancel);
  node.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------------- Feuille : ajout / édition d'opération ----------------
function openSheet(id) {
  editingId = id || null;
  const existing = id ? state.transactions.find((t) => t.id === id) : null;
  draft = existing
    ? Object.assign({}, existing)
    : { type: 'expense', amount: 0, category: 'alimentation', date: todayISO(), note: '' };
  renderSheet();
  el('sheet-backdrop').classList.remove('hidden');
  el('sheet').classList.remove('hidden');
}
function closeSheet() {
  const sheet = el('sheet');
  sheet.style.transition = ''; sheet.style.transform = ''; // réinitialise après un glissement
  el('sheet-backdrop').classList.add('hidden');
  sheet.classList.add('hidden');
  editingId = null; draft = null;
  editRecurId = null; rdraft = null;
}
// Glisser la feuille vers le bas pour la fermer (comme une vraie feuille modale mobile).
// Ne s'active que si le contenu est déjà en haut, sinon on laisse défiler normalement.
function setupSheetSwipe() {
  const sheet = el('sheet');
  let startY = 0, dy = 0, dragging = false;
  sheet.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || sheet.scrollTop > 0) { dragging = false; return; }
    startY = e.touches[0].clientY; dy = 0; dragging = true;
    sheet.style.transition = 'none';
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    dy = e.touches[0].clientY - startY;
    if (dy > 0) { sheet.style.transform = `translateY(${dy}px)`; e.preventDefault(); }
  }, { passive: false });
  sheet.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = 'transform .2s ease';
    if (dy > 90) {                    // glissé assez loin -> on ferme
      sheet.style.transform = 'translateY(100%)';
      setTimeout(closeSheet, 190);
    } else {                          // pas assez -> retour en place
      sheet.style.transform = '';
    }
  });
}
function renderSheet() {
  const cats = draft.type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  if (!cats.some((c) => c.id === draft.category)) draft.category = cats[0].id;
  const sheet = el('sheet');
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <h2>${editingId ? 'Modifier' : 'Nouvelle opération'}</h2>
    <div class="seg">
      <button id="seg-exp" class="${draft.type === 'expense' ? 'on-exp' : ''}">Dépense</button>
      <button id="seg-inc" class="${draft.type === 'income' ? 'on-inc' : ''}">Revenu</button>
    </div>
    <div class="field">
      <input id="f-amount" class="amount-input" type="text" inputmode="decimal" placeholder="0,00" value="${draft.amount ? String(draft.amount).replace('.', ',') : ''}">
    </div>
    <div class="field">
      <label>Catégorie</label>
      <div class="cat-grid" id="cat-grid">
        ${cats.map((c) => `<button class="cat-chip ${c.id === draft.category ? 'sel' : ''}" data-cat="${c.id}"><span class="e">${iconImg(c.id)}</span>${c.name}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Note (facultatif)</label>
      <input id="f-note" type="text" placeholder="ex : Courses Lidl" value="${escapeHtml(draft.note || '')}">
    </div>
    <div class="field">
      <label>Icône (facultatif, ne change pas la catégorie)</label>
      <div class="icon-grid" id="icon-grid">
        <button class="icon-chip auto ${!draft.icon ? 'sel' : ''}" data-icon="">Auto</button>
        ${ICON_CHOICES.map((s) => `<button class="icon-chip ${draft.icon === s ? 'sel' : ''}" data-icon="${s}">${iconImg(s)}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Date</label>
      <input id="f-date" type="date" value="${draft.date}" max="${todayISO()}">
    </div>
    <button class="btn" id="f-save">${editingId ? 'Enregistrer' : 'Ajouter'}</button>
    ${editingId && draft.type === 'expense' ? '<button class="btn btn-2" id="f-abo" style="margin-top:10px">🎯 Marquer comme abonnement</button>' : ''}
    ${editingId ? '<button class="btn btn-danger" id="f-delete" style="margin-top:10px">Supprimer</button>' : ''}
  `;

  el('seg-exp').addEventListener('click', () => { draft.type = 'expense'; syncDraftFromInputs(); renderSheet(); });
  el('seg-inc').addEventListener('click', () => { draft.type = 'income'; syncDraftFromInputs(); renderSheet(); });
  sheet.querySelectorAll('[data-cat]').forEach((n) =>
    n.addEventListener('click', () => {
      // Pas de re-rendu complet (sinon on perd le montant/la date déjà saisis) :
      // on met juste à jour la sélection visuelle.
      draft.category = n.getAttribute('data-cat');
      draft._catManual = true;
      highlightCat(draft.category);
    }));
  el('f-note').addEventListener('input', (e) => {
    draft.note = e.target.value;
    if (!draft._catManual) {
      const g = guessCategory(draft.note, draft.type);
      if (g && g !== draft.category) { draft.category = g; highlightCat(g); }
    }
  });
  sheet.querySelectorAll('[data-icon]').forEach((n) =>
    n.addEventListener('click', () => {
      draft.icon = n.getAttribute('data-icon') || '';
      draft._iconManual = true;
      document.querySelectorAll('#icon-grid [data-icon]').forEach((x) =>
        x.classList.toggle('sel', (x.getAttribute('data-icon') || '') === draft.icon));
    }));
  el('f-save').addEventListener('click', saveTx);
  el('f-abo')?.addEventListener('click', () => openAboFlagSheet(editingId));
  el('f-delete')?.addEventListener('click', deleteTx);
}
function highlightCat(id) {
  document.querySelectorAll('#cat-grid [data-cat]').forEach((n) =>
    n.classList.toggle('sel', n.getAttribute('data-cat') === id));
}
function syncDraftFromInputs() {
  const a = el('f-amount'); if (a) draft.amount = a.value;
  const n = el('f-note'); if (n) draft.note = n.value;
  const d = el('f-date'); if (d) draft.date = d.value;
}
async function saveTx() {
  const raw = el('f-amount').value.replace(/\s/g, '').replace(',', '.');
  const amount = round2(parseFloat(raw));
  if (isNaN(amount) || amount <= 0) { toast('Entre un montant valide'); return; }
  const tx = {
    id: editingId || crypto.randomUUID(),
    type: draft.type,
    amount,
    category: draft.category,
    note: el('f-note').value.trim(),
    date: el('f-date').value || todayISO(),
  };
  if (draft.icon) tx.icon = draft.icon; // icône perso (facultative)
  if (editingId) {
    const i = state.transactions.findIndex((t) => t.id === editingId);
    state.transactions[i] = tx;
  } else {
    state.transactions.push(tx);
  }
  // Apprentissage : si tu as choisi la catégorie toi-même sur une opération qui a un libellé,
  // l'appli retient le marchand (futurs imports) ET corrige toutes les opérations identiques déjà là.
  let propagated = 0;
  if (tx.note && draft && draft._catManual && tx.category !== 'autres' && tx.category !== 'autres_in') {
    const kw = learnRule(tx.note, tx.category);
    propagated = applyRuleToExisting(kw, tx.category, tx.type, tx.id);
  }
  // Apprentissage de l'icône : si le marchand est identifiable, la règle gouverne TOUTES ses
  // opérations (passées et futures). Sinon l'icône reste posée sur cette seule opération.
  let iconApplied = 0;
  if (tx.note && draft && draft._iconManual) {
    const kw = learnIconRule(tx.note, draft.icon);
    if (kw) {
      // La règle marchand pilote TOUT : on retire les icônes figées de toutes ses opérations
      // (y compris celles changées à la main avant) pour qu'elles suivent la règle uniformément.
      for (const t of state.transactions) {
        if (t.type === 'expense' && kwMatch(normTxt(t.note), kw)) { delete t.icon; iconApplied++; }
      }
    }
  }
  await save();
  closeSheet();
  render();
  const base = editingId ? 'Modifié' : 'Ajouté ✓';
  if (iconApplied > 1) toast(`Icône appliquée à ${iconApplied} opérations de ce marchand ✓`);
  else toast(propagated ? `${base} · ${propagated} similaire(s) corrigée(s)` : base);
}
async function deleteTx() {
  state.transactions = state.transactions.filter((t) => t.id !== editingId);
  await save();
  closeSheet();
  render();
  toast('Supprimé');
}

// ---------------- Feuille : budgets ----------------
function openBudgetSheet() {
  const sheet = el('sheet');
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <h2>Mes budgets mensuels</h2>
    <p class="muted" style="font-size:13px;margin-top:-8px;margin-bottom:16px">Laisse vide pour ne pas suivre une catégorie.</p>
    ${EXPENSE_CATS.map((c) => `
      <div class="field" style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="flex:1;font-size:15px;display:flex;align-items:center;gap:8px">${iconImg(c.id)} ${c.name}</span>
        <input data-bud="${c.id}" type="text" inputmode="decimal" placeholder="—"
          value="${state.budgets[c.id] || ''}"
          style="width:110px;text-align:right;padding:12px;border-radius:12px;background:var(--card);color:var(--text);border:1px solid var(--line)">
      </div>`).join('')}
    <button class="btn" id="bud-save" style="margin-top:8px">Enregistrer</button>
  `;
  el('bud-save').addEventListener('click', async () => {
    sheet.querySelectorAll('[data-bud]').forEach((inp) => {
      const id = inp.getAttribute('data-bud');
      const v = parseFloat(inp.value.replace(',', '.'));
      if (isNaN(v) || v <= 0) delete state.budgets[id];
      else state.budgets[id] = round2(v);
    });
    await save();
    closeSheet();
    render();
    toast('Budgets enregistrés ✓');
  });
  el('sheet-backdrop').classList.remove('hidden');
  el('sheet').classList.remove('hidden');
}

// ---------------- Feuille : opérations récurrentes ----------------
function openRecurringSheet(id) {
  editRecurId = id || null;
  const ex = id ? (state.recurring || []).find((r) => r.id === id) : null;
  rdraft = ex ? Object.assign({}, ex) : { type: 'expense', amount: 0, category: 'logement', note: '', day: 1 };
  renderRecurringSheet();
  el('sheet-backdrop').classList.remove('hidden');
  el('sheet').classList.remove('hidden');
}
function syncRDraft() {
  const a = el('r-amount'); if (a) rdraft.amount = a.value;
  const n = el('r-note'); if (n) rdraft.note = n.value;
  const d = el('r-day'); if (d) rdraft.day = d.value;
}
function renderRecurringSheet() {
  const cats = rdraft.type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  if (!cats.some((c) => c.id === rdraft.category)) rdraft.category = cats[0].id;
  const sheet = el('sheet');
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <h2>${editRecurId ? 'Modifier la récurrence' : 'Nouvelle récurrence'}</h2>
    <div class="seg">
      <button id="rseg-exp" class="${rdraft.type === 'expense' ? 'on-exp' : ''}">Dépense</button>
      <button id="rseg-inc" class="${rdraft.type === 'income' ? 'on-inc' : ''}">Revenu</button>
    </div>
    ${(!editRecurId && rdraft.type === 'expense' && merchantsFromTx().length) ? `
    <div class="field">
      <label>Pré-remplir depuis une dépense existante</label>
      <select id="r-pick" class="r-select">
        <option value="">— saisie manuelle —</option>
        ${merchantsFromTx().map((m) => `<option value="${escapeHtml(m.cle)}">${escapeHtml(cleanMerchant(m.label))} · ${euro(m.montant)} · ${m.count}x</option>`).join('')}
      </select>
    </div>` : ''}
    <div class="field">
      <input id="r-amount" class="amount-input" type="text" inputmode="decimal" placeholder="0,00" value="${rdraft.amount ? String(rdraft.amount).replace('.', ',') : ''}">
    </div>
    <div class="field">
      <label>Catégorie</label>
      <div class="cat-grid" id="rcat-grid">
        ${cats.map((c) => `<button class="cat-chip ${c.id === rdraft.category ? 'sel' : ''}" data-rcat="${c.id}"><span class="e">${iconImg(c.id)}</span>${c.name}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Libellé</label>
      <input id="r-note" type="text" placeholder="ex : Loyer, Netflix, Salaire" value="${escapeHtml(rdraft.note || '')}">
    </div>
    <div class="field">
      <label>Jour du mois (1 à 28)</label>
      <input id="r-day" type="number" inputmode="numeric" min="1" max="28" value="${rdraft.day || 1}">
    </div>
    <button class="btn" id="r-save">${editRecurId ? 'Enregistrer' : 'Ajouter'}</button>
    ${editRecurId ? '<button class="btn btn-danger" id="r-delete" style="margin-top:10px">Supprimer</button>' : ''}
  `;
  el('rseg-exp').addEventListener('click', () => { rdraft.type = 'expense'; syncRDraft(); renderRecurringSheet(); });
  el('rseg-inc').addEventListener('click', () => { rdraft.type = 'income'; syncRDraft(); renderRecurringSheet(); });
  el('r-pick')?.addEventListener('change', (e) => {
    const m = merchantsFromTx().find((x) => x.cle === e.target.value);
    if (!m) return;
    syncRDraft();
    rdraft.amount = m.montant;
    rdraft.note = cleanMerchant(m.label);
    rdraft.category = m.categorie;
    renderRecurringSheet();
  });
  sheet.querySelectorAll('[data-rcat]').forEach((n) =>
    n.addEventListener('click', () => {
      rdraft.category = n.getAttribute('data-rcat');
      document.querySelectorAll('#rcat-grid [data-rcat]').forEach((x) =>
        x.classList.toggle('sel', x.getAttribute('data-rcat') === rdraft.category));
    }));
  el('r-save').addEventListener('click', saveRecurring);
  el('r-delete')?.addEventListener('click', deleteRecurring);
}
async function saveRecurring() {
  const raw = el('r-amount').value.replace(/\s/g, '').replace(',', '.');
  const amount = round2(parseFloat(raw));
  if (isNaN(amount) || amount <= 0) { toast('Entre un montant valide'); return; }
  let day = parseInt(el('r-day').value, 10);
  if (isNaN(day) || day < 1) day = 1;
  if (day > 28) day = 28;
  const rec = {
    id: editRecurId || crypto.randomUUID(),
    type: rdraft.type,
    amount,
    category: rdraft.category,
    note: el('r-note').value.trim(),
    day,
  };
  state.recurring = state.recurring || [];
  if (editRecurId) {
    const i = state.recurring.findIndex((r) => r.id === editRecurId);
    state.recurring[i] = rec;
  } else {
    state.recurring.push(rec);
  }
  await save();
  closeSheet();
  render();
  toast(editRecurId ? 'Récurrence modifiée ✓' : 'Récurrence ajoutée ✓');
}
async function deleteRecurring() {
  state.recurring = (state.recurring || []).filter((r) => r.id !== editRecurId);
  await save();
  closeSheet();
  render();
  toast('Récurrence supprimée');
}
// Enregistre une récurrence du mois comme opération réelle (feuille pré-remplie à valider).
function recordRecurring(id) {
  const r = (state.recurring || []).find((x) => x.id === id);
  if (!r) return;
  editingId = null;
  const d = new Date();
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const day = Math.min(r.day, lastDay);
  let date = `${ym(d)}-${pad2(day)}`;
  if (date > todayISO()) date = todayISO();   // pas de dépense future
  draft = { type: r.type, amount: r.amount, category: r.category, date, note: r.note || '' };
  renderSheet();
  el('sheet-backdrop').classList.remove('hidden');
  el('sheet').classList.remove('hidden');
}

// ---------------- Changement de PIN ----------------
async function changePin() {
  const p1 = prompt('Nouveau code à 4 chiffres :');
  if (p1 === null) return;
  if (!/^\d{4}$/.test(p1)) { toast('Le code doit faire 4 chiffres'); return; }
  const p2 = prompt('Confirme le nouveau code :');
  if (p2 !== p1) { toast('Les codes ne correspondent pas'); return; }
  await rekeyVault(p1);   // nouveau sel + renforcement PBKDF2 actuel
  guardReset();
  toast('Code modifié ✓');
}

// ---------------- Sauvegarde / restauration / effacement ----------------
// Sauvegarde CHIFFRÉE : le fichier est illisible sans le code du coffre.
// Il embarque son propre sel + le nombre d'itérations, donc restaurable sur un autre appareil.
async function exportData() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, cryptoKey, enc.encode(JSON.stringify(state)));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0); out.set(new Uint8Array(ct), iv.length);
  const pkg = {
    app: 'coffre', fmt: 'enc-1',
    kdf: 'PBKDF2-SHA256', iter: currentIters(),
    salt: localStorage.getItem(LS.salt),
    payload: b64(out),
  };
  const blob = new Blob([JSON.stringify(pkg)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `coffre-sauvegarde-${todayISO()}.coffre.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Sauvegarde chiffrée téléchargée 🔒');
}
async function applyRestored(obj) {
  if (!obj || !Array.isArray(obj.transactions)) throw new Error('format');
  state = Object.assign(defaultState(), obj);
  applyTheme();
  await save();
  render();
  toast('Données restaurées ✓');
}
function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    let pkg;
    try { pkg = JSON.parse(reader.result); }
    catch (err) { toast('Fichier invalide'); return; }

    // Nouvelle sauvegarde chiffrée
    if (pkg && pkg.fmt === 'enc-1' && pkg.payload) {
      try {
        const buf = fromB64(pkg.payload);
        const iv = buf.slice(0, 12), data = buf.slice(12);
        // 1) même appareil / même code : la clé en mémoire suffit, rien à demander.
        let obj = null;
        try {
          obj = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, data)));
        } catch (e1) {
          // 2) autre appareil / autre code : on demande le code de CETTE sauvegarde.
          const code = prompt('Code de la sauvegarde à restaurer :');
          if (code === null) return;
          const key = await deriveKey(code, fromB64(pkg.salt), pkg.iter || KDF_ITERS);
          obj = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)));
        }
        await applyRestored(obj);
      } catch (err) {
        toast('Code incorrect ou sauvegarde illisible');
      }
      return;
    }

    // Ancienne sauvegarde en clair (rétrocompatibilité)
    try { await applyRestored(pkg); }
    catch (err) { toast('Fichier invalide'); }
  };
  reader.readAsText(file);
}
async function recategorizeAll() {
  // Re-classe uniquement les opérations encore en "Autres" (ne touche pas à tes choix manuels).
  let changed = 0;
  for (const t of state.transactions) {
    if (t.category !== 'autres' && t.category !== 'autres_in') continue;
    const g = guessCategory(t.note, t.type);
    if (g) { t.category = g; changed++; }
  }
  await save();
  render();
  toast(changed ? `${changed} opération(s) reclassée(s) ✓` : 'Rien à reclasser (libellés non reconnus)');
}
async function clearTransactions() {
  if (!confirm('Effacer toutes tes opérations ? Ton code et tes budgets sont conservés.')) return;
  state.transactions = [];
  await save();
  render();
  toast('Opérations effacées');
}
async function wipeAll() {
  if (!confirm('Effacer TOUTES tes données et ton code ? Cette action est irréversible.')) return;
  localStorage.removeItem(LS.data);
  localStorage.removeItem(LS.salt);
  localStorage.removeItem(LS.meta);
  localStorage.removeItem(LS.guard);
  cryptoKey = null; state = null;
  showLock('create');
  toast('Tout a été effacé');
}

// ---------------- Import de relevé bancaire ----------------
let imp = null;      // { rows, headerIdx, headers }
let impMap = null;   // mapping des colonnes

function normTxt(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
function decodeBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (text.includes('�')) {
    try { text = new TextDecoder('windows-1252').decode(bytes); } catch (e) { /* garde utf-8 */ }
  }
  return text;
}
function detectSep(line) {
  const counts = { ';': 0, ',': 0, '\t': 0 };
  for (const c of line) if (c in counts) counts[c]++;
  let best = ';', max = -1;
  for (const s in counts) if (counts[s] > max) { max = counts[s]; best = s; }
  return best;
}
function parseCSV(text) {
  const nl = text.indexOf('\n');
  const sep = detectSep(nl >= 0 ? text.slice(0, nl) : text);
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}
function excelSerialToDate(n) {
  if (n < 20000 || n > 80000) return null;
  const d = new Date(Math.round((n - 25569) * 86400000));
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function parseDateFlexible(v) {
  if (v instanceof Date && !isNaN(v)) return ymd(v);
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) {
    let y = m[3]; if (y.length === 2) y = '20' + y;
    return `${y}-${pad2(m[2])}-${pad2(m[1])}`;
  }
  if (/^\d{4,6}(\.\d+)?$/.test(s)) { const d = excelSerialToDate(parseFloat(s)); if (d) return ymd(d); }
  return null;
}
function parseAmountFlexible(v) {
  if (typeof v === 'number') return isNaN(v) ? null : v;
  let s = String(v == null ? '' : v).replace(/[\s €$]/g, '').trim();
  if (!s || s === '-') return null;
  const hasC = s.includes(','), hasD = s.includes('.');
  if (hasC && hasD) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasC) s = s.replace(',', '.');
  const val = parseFloat(s);
  return isNaN(val) ? null : val;
}
function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('lecture impossible'));
    reader.onload = () => {
      try {
        if (isCsv) { resolve(parseCSV(decodeBuffer(reader.result))); return; }
        const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: '' }));
      } catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}
// --- Lecture d'un relevé PDF (texte, pas image) ---
function isMoneyStr(s) {
  return /^-?\d{1,3}(?:[ .]\d{3})*,\d{2}-?$|^-?\d+,\d{2}-?$/.test(String(s).replace(/ /g, ' ').trim());
}
async function readPdf(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const its = tc.items
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({ x: i.transform[4], y: Math.round(vp.height - i.transform[5]), str: i.str.trim() }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    let cur = null;
    for (const it of its) {
      if (cur && Math.abs(it.y - cur.y) <= 3) cur.items.push(it);
      else { cur = { y: it.y, items: [it] }; lines.push(cur); }
    }
  }
  return pdfLinesToRows(lines);
}
function pdfLinesToRows(lines) {
  const dateTok = /^\d{1,2}[\/.\-]\d{2}([\/.\-]\d{2,4})?$/;   // token entier = une date
  const anyDate = /\d{1,2}[\/.\-]\d{2}(?:[\/.\-]\d{2,4})?/;
  const signTok = /^[+\-−]$/;
  const hasCents = (s) => /\d[.,]\d{2}$/.test(String(s).replace(/[\s ]/g, ''));
  const raw = [];
  for (const ln of lines) {
    const items = ln.items.slice().sort((a, b) => a.x - b.x);
    const strs = items.map((i) => i.str.trim());
    // date d'opération : premier token date, situé en début de ligne (écarte les lignes de solde)
    const di = strs.findIndex((s) => dateTok.test(s));
    if (di < 0 || items[di].x > 110) continue;
    const dm = strs[di].match(anyDate);
    if (!dm) continue;
    // tous les montants de la ligne (chaque token à centimes, avec ses milliers et son signe)
    const amounts = [];
    for (let i = 0; i < strs.length; i++) {
      if (!hasCents(strs[i])) continue;
      let s = i;
      while (s - 1 >= 0 && /^\d{1,3}$/.test(strs[s - 1]) && !hasCents(strs[s - 1]) && (items[s].x - items[s - 1].x) < 30) s--;
      const num = strs.slice(s, i + 1).join('').replace(/[\s ]/g, '');
      let sign = '';
      if (s - 1 >= 0 && signTok.test(strs[s - 1])) sign = (strs[s - 1] === '-' || strs[s - 1] === '−') ? '-' : '+';
      amounts.push({ x: items[i].x, value: (sign === '-' ? '-' : '') + num });
    }
    if (!amounts.length) continue;
    const firstAmtX = Math.min(...amounts.map((a) => a.x));
    // libellé : entre la date et le 1er montant, hors dates et signes
    const label = items
      .filter((it, idx) => idx > di && it.x < firstAmtX - 1 && !dateTok.test(strs[idx]) && !signTok.test(strs[idx]))
      .map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    raw.push({ date: dm[0], label, amounts });
  }
  if (!raw.length) return [];
  // Regrouper les positions X des montants en colonnes
  const centers = [];
  raw.forEach((t) => t.amounts.forEach((m) => {
    const c = centers.find((c) => Math.abs(c.mean - m.x) < 30);
    if (c) { c.sum += m.x; c.n++; c.mean = c.sum / c.n; } else centers.push({ sum: m.x, n: 1, mean: m.x });
  }));
  centers.sort((a, b) => a.mean - b.mean);
  const names = centers.length === 1 ? ['Montant']
    : centers.map((c, i) => (i === 0 ? 'Débit' : (i === 1 ? 'Crédit' : (i === centers.length - 1 ? 'Solde' : 'Colonne ' + (i + 1)))));
  const rows = [['Date', 'Libellé', ...names]];
  for (const t of raw) {
    const row = [t.date, t.label];
    for (const c of centers) {
      const m = t.amounts.find((mm) => Math.abs(mm.x - c.mean) < 30);
      row.push(m ? m.value : '');
    }
    rows.push(row);
  }
  return rows;
}
function detectHeader(rows) {
  const reDate = /date/;
  const reLabel = /(libell|nature|operation|detail|motif|designation|reference|desig|intitul|objet|communication|description|transaction|mouvement|ecriture)/;
  const reAmt = /(montant|debit|credit|amount|somme|valeur)/;
  let bestIdx = 0, bestScore = -1;
  const n = Math.min(rows.length, 20);
  for (let i = 0; i < n; i++) {
    let score = 0;
    for (const cell of rows[i]) {
      const h = normTxt(cell);
      if (reDate.test(h)) score++;
      if (reLabel.test(h)) score++;
      if (reAmt.test(h)) score++;
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return { idx: bestScore >= 2 ? bestIdx : 0, headers: rows[bestScore >= 2 ? bestIdx : 0] || [] };
}
function detectMapping(headers) {
  const H = headers.map(normTxt);
  const find = (re) => H.findIndex((h) => re.test(h));
  const dateCol = find(/date/);
  const labelCol = find(/(libell|nature|operation|detail|motif|designation|reference|desig|intitul|objet|communication|description|transaction|mouvement|ecriture)/);
  const debitCol = find(/(debit|retrait)/);
  const creditCol = find(/(credit|versement|depot)/);
  const amountCol = H.findIndex((h) => /(montant|amount)/.test(h) && !/solde/.test(h));
  const mode = (debitCol >= 0 || creditCol >= 0) ? 'split' : 'single';
  return { dateCol: dateCol < 0 ? 0 : dateCol, labelCol, mode, amountCol, debitCol, creditCol };
}
// Secours : quand aucune colonne "libellé" n'est reconnue par son nom, on choisit
// la colonne qui contient le plus de texte (le libellé est la plus "bavarde").
function pickLabelColumn(rows, headerIdx, m) {
  const exclude = new Set([m.dateCol, m.amountCol, m.debitCol, m.creditCol].filter((i) => i >= 0));
  let ncol = 0;
  for (let i = headerIdx; i < Math.min(rows.length, headerIdx + 30); i++) ncol = Math.max(ncol, rows[i].length);
  let best = -1, bestAvg = -1;
  for (let c = 0; c < ncol; c++) {
    if (exclude.has(c)) continue;
    let letters = 0, n = 0;
    for (let i = headerIdx + 1; i < Math.min(rows.length, headerIdx + 51); i++) {
      const v = rows[i][c];
      if (v == null || v instanceof Date || typeof v === 'number') continue;
      letters += (String(v).match(/[A-Za-zÀ-ÿ]/g) || []).length;
      n++;
    }
    const avg = n ? letters / n : 0;
    if (avg > bestAvg) { bestAvg = avg; best = c; }
  }
  return bestAvg >= 2 ? best : -1;
}
function buildParsed() {
  const { rows, headerIdx } = imp, m = impMap;
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseDateFlexible(r[m.dateCol]);
    if (!date) continue;
    const note = m.labelCol >= 0 ? String(r[m.labelCol] || '').trim().replace(/\s+/g, ' ') : '';
    let amount = null, type = null;
    if (m.mode === 'split') {
      const deb = m.debitCol >= 0 ? parseAmountFlexible(r[m.debitCol]) : null;
      const cre = m.creditCol >= 0 ? parseAmountFlexible(r[m.creditCol]) : null;
      if (deb && Math.abs(deb) > 0) { amount = Math.abs(deb); type = 'expense'; }
      else if (cre && Math.abs(cre) > 0) { amount = Math.abs(cre); type = 'income'; }
      else continue;
    } else {
      const v = parseAmountFlexible(r[m.amountCol]);
      if (v === null || v === 0) continue;
      amount = Math.abs(v); type = v < 0 ? 'expense' : 'income';
    }
    const category = guessCategory(note, type) || (type === 'income' ? 'autres_in' : 'autres');
    out.push({ date, note, amount: round2(amount), type, category });
  }
  return out;
}
function sigOf(t) { return `${t.date}|${t.type}|${t.amount}|${normTxt(t.note)}`; }

async function handleStatementFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  toast(isPdf ? 'Lecture du PDF…' : 'Lecture du fichier…');
  try {
    const rows = isPdf ? await readPdf(file) : await readWorkbook(file);
    if (!rows.length) {
      toast(isPdf ? 'PDF illisible (scanné ?) : essaie l\'export Excel' : 'Fichier vide ou illisible');
      return;
    }
    const h = detectHeader(rows);
    imp = { rows, headerIdx: h.idx, headers: h.headers, isPdf };
    impMap = detectMapping(h.headers);
    if (impMap.labelCol < 0) impMap.labelCol = pickLabelColumn(rows, h.idx, impMap);
    renderImportSheet();
    el('sheet-backdrop').classList.remove('hidden');
    el('sheet').classList.remove('hidden');
  } catch (err) {
    console.error(err);
    toast('Impossible de lire ce fichier');
  }
}
function colOptions(sel) {
  return imp.headers.map((h, i) =>
    `<option value="${i}" ${i === sel ? 'selected' : ''}>${escapeHtml(h || ('Colonne ' + (i + 1)))}</option>`).join('');
}
function renderImportSheet() {
  const parsed = buildParsed();
  const existing = new Set(state.transactions.map(sigOf));
  const fresh = parsed.filter((p) => !existing.has(sigOf(p)));
  const preview = parsed.slice(0, 8).map((p) => {
    const c = catById(p.category);
    const cls = p.type === 'expense' ? 'exp' : 'inc';
    const sign = p.type === 'expense' ? '-' : '+';
    const d = p.date.slice(8, 10) + '/' + p.date.slice(5, 7);
    return `<div class="tx-item" style="margin-bottom:8px">
      <div class="tx-ico">${iconImg(c.id)}</div>
      <div class="tx-main"><div class="tx-cat" style="font-size:13px">${escapeHtml(p.note || c.name)}</div>
      <div class="tx-note">${d} · ${c.name}</div></div>
      <div class="tx-amt ${cls}">${sign}${euro(p.amount)}</div>
    </div>`;
  }).join('');

  el('sheet').innerHTML = `
    <div class="sheet-grip"></div>
    <h2>Importer un relevé</h2>
    <p class="muted" style="font-size:13px;margin:-8px 0 14px">Vérifie que les colonnes sont bien reconnues, puis valide.</p>
    ${imp.isPdf ? `<div class="install-banner" style="border-color:var(--orange);margin-bottom:14px"><span style="font-size:20px">⚠️</span><span class="txt">Lecture PDF : vérifie surtout les <b>montants</b> et le sens (dépense/revenu). Si une colonne "Solde" existe, ne la choisis pas comme montant. En cas de souci, préfère l'export Excel.</span></div>` : ''}

    <div class="field">
      <label>Colonne Date</label>
      <select id="map-date">${colOptions(impMap.dateCol)}</select>
    </div>
    <div class="field">
      <label>Colonne Libellé</label>
      <select id="map-label">${colOptions(impMap.labelCol)}</select>
    </div>
    <div class="field">
      <label>Montant</label>
      <div class="seg" style="margin-bottom:12px">
        <button id="mode-single" class="${impMap.mode === 'single' ? 'on-inc' : ''}">1 colonne (signé)</button>
        <button id="mode-split" class="${impMap.mode === 'split' ? 'on-inc' : ''}">Débit / Crédit</button>
      </div>
      ${impMap.mode === 'single'
        ? `<select id="map-amount">${colOptions(impMap.amountCol)}</select>`
        : `<div style="display:flex;gap:8px">
             <select id="map-debit" style="flex:1">${colOptions(impMap.debitCol)}</select>
             <select id="map-credit" style="flex:1">${colOptions(impMap.creditCol)}</select>
           </div>
           <div class="muted" style="font-size:11px;margin-top:6px">Débit (dépenses) à gauche, Crédit (revenus) à droite.</div>`}
    </div>

    <div class="section-title" style="margin-top:8px">Aperçu (${parsed.length} ligne(s) lue(s))</div>
    ${parsed.length ? preview : '<div class="muted" style="font-size:13px">Aucune opération détectée. Vérifie le choix des colonnes ci-dessus.</div>'}

    <button class="btn" id="do-import" style="margin-top:16px" ${fresh.length ? '' : 'disabled style="opacity:.5"'}>
      Importer ${fresh.length} nouvelle(s) opération(s)
    </button>
    ${parsed.length - fresh.length > 0 ? `<p class="muted" style="text-align:center;font-size:12px;margin-top:8px">${parsed.length - fresh.length} déjà présente(s), ignorée(s).</p>` : ''}
  `;

  const reMap = () => { readMappingFromDom(); renderImportSheet(); };
  el('map-date').addEventListener('change', reMap);
  el('map-label').addEventListener('change', reMap);
  el('mode-single').addEventListener('click', () => { impMap.mode = 'single'; renderImportSheet(); });
  el('mode-split').addEventListener('click', () => { impMap.mode = 'split'; renderImportSheet(); });
  if (impMap.mode === 'single') el('map-amount').addEventListener('change', reMap);
  else { el('map-debit').addEventListener('change', reMap); el('map-credit').addEventListener('change', reMap); }
  el('do-import').addEventListener('click', () => doImport(fresh));
}
function readMappingFromDom() {
  const g = (id) => { const n = el(id); return n ? parseInt(n.value, 10) : -1; };
  impMap.dateCol = g('map-date');
  impMap.labelCol = g('map-label');
  if (impMap.mode === 'single') impMap.amountCol = g('map-amount');
  else { impMap.debitCol = g('map-debit'); impMap.creditCol = g('map-credit'); }
}
async function doImport(fresh) {
  if (!fresh.length) return;
  for (const p of fresh) state.transactions.push({ id: crypto.randomUUID(), ...p });
  await save();
  imp = null; impMap = null;
  closeSheet();
  switchTab('tx');
  toast(`${fresh.length} opération(s) importée(s) ✓`);
}

// ---------------- Navigation ----------------
function switchTab(tab) {
  // Si l'essai vient d'expirer en cours de session, on bascule sur l'écran de déblocage.
  if (!licensed && trialInfo().expired) { showLicenceGate(); return; }
  currentTab = tab;
  document.querySelectorAll('.tab[data-tab]').forEach((b) =>
    b.classList.toggle('active', b.getAttribute('data-tab') === tab));
  render();
}

// ---------------- Installation PWA ----------------
async function doInstall() {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  render();
}

// ---------------- Mise à jour de l'application ----------------
// Important : mettre à jour ne touche JAMAIS aux données (elles sont en localStorage chiffré,
// séparé du cache du service worker). On ne fait que remplacer le code de l'appli.
function markUpdateReady() {
  updateReady = true;
  if (state && currentTab === 'settings') render(); // fait apparaître "nouvelle version dispo"
}
// Mise à jour à toute épreuve : active le nouveau worker, VIDE le cache du code (jamais les
// données, qui sont en localStorage), puis recharge du réseau. Impossible de rester bloqué.
let updating = false;
async function doAppUpdate() {
  if (updating) return;
  updating = true;
  toast('Mise à jour…');
  try {
    if (swReg) {
      await swReg.update();
      if (swReg.waiting) swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  } catch (e) { /* hors-ligne : on tente quand même le rechargement */ }
  // On efface UNIQUEMENT le Cache Storage (coquille de l'appli). localStorage (tes opérations
  // chiffrées) n'est PAS touché.
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch (e) { /* ignore */ }
  setTimeout(() => location.reload(), 500);
}

// ---------------- Démarrage ----------------
function init() {
  // Service worker (hors-ligne) + détection des mises à jour.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      swReg = reg;
      reg.update();
      if (reg.waiting && navigator.serviceWorker.controller) markUpdateReady();
      // une nouvelle version arrive : on la repère quand elle est prête (installée)
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) markUpdateReady();
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
    }).catch(() => {});
    // quand un nouveau service worker prend la main, on recharge une fois
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (state && currentTab === 'dashboard') render();
  });

  // Clavier PIN
  el('keypad').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    onKey(b.getAttribute('data-k'));
  });

  // Barre d'onglets
  el('tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b) return;
    const tab = b.getAttribute('data-tab');
    if (tab === 'add') openSheet(null);
    else switchTab(tab);
  });

  // Écran de déblocage (essai terminé)
  el('lic-validate').addEventListener('click', async () => {
    if (await submitLicence(el('lic-key').value)) {
      el('licence-gate').classList.add('hidden');
      toast('Version à vie activée ✓ Merci !');
      enterApp();
    } else {
      el('lic-error').textContent = 'Clé invalide pour cet appareil.';
    }
  });
  el('lic-lock').addEventListener('click', lockApp);

  // Fermeture de la feuille
  el('sheet-backdrop').addEventListener('click', closeSheet);
  setupSheetSwipe();

  // Auto-lock : réinitialisé à chaque interaction
  ['click', 'touchstart', 'keydown'].forEach((ev) =>
    document.addEventListener(ev, () => { if (state) resetAutoLock(); }, { passive: true }));

  // Écran initial
  const initialized = localStorage.getItem(LS.data) && localStorage.getItem(LS.salt);
  showLock(initialized ? 'unlock' : 'create');
}

init();
