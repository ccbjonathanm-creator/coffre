'use strict';
/* ============================================================
   Coffre — logique de l'application
   - Chiffrement AES-256 local (Web Crypto), code PIN
   - Stockage 100% sur l'appareil (localStorage), aucun réseau
   - Intelligence budgétaire locale (insights, reste à vivre)
   ============================================================ */

// ---------------- Constantes ----------------
const PIN_LENGTH = 4;
const LS = { salt: 'coffre.salt', data: 'coffre.data' };
const PBKDF2_ITERS = 150000;
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
  { id: 'shopping', name: 'Shopping', emoji: '🛍️' },
  { id: 'credits', name: 'Crédits', emoji: '🏦' },
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

// Mots-clés -> catégorie (catégorisation automatique de la note)
const KEYWORDS = {
  alimentation: ['carrefour', 'leclerc', 'lidl', 'auchan', 'intermarche', 'course', 'super', 'casino', 'aldi', 'monoprix'],
  restaurant: ['resto', 'restaurant', 'mcdo', 'burger', 'kebab', 'pizza', 'uber eats', 'deliveroo', 'bar', 'cafe'],
  logement: ['loyer', 'charges', 'syndic'],
  transport: ['essence', 'carburant', 'gasoil', 'diesel', 'sncf', 'train', 'bus', 'metro', 'peage', 'parking', 'uber'],
  factures: ['edf', 'gdf', 'engie', 'eau', 'electricite', 'gaz', 'facture', 'impot'],
  sante: ['pharmacie', 'medecin', 'docteur', 'mutuelle', 'dentiste', 'opticien'],
  abonnements: ['internet', 'free', 'orange', 'sfr', 'bouygues', 'netflix', 'spotify', 'disney', 'abo', 'forfait'],
  credits: ['credit', 'pret', 'mensualite', 'banque', 'remboursement pret'],
  shopping: ['amazon', 'vetement', 'zara', 'fnac', 'darty'],
  salaire: ['salaire', 'paie', 'paye'],
  aide: ['caf', 'aide', 'apl', 'rsa', 'pole emploi', 'allocation'],
};

// ---------------- État en mémoire ----------------
let cryptoKey = null;   // clé AES (jamais persistée)
let state = null;       // données déchiffrées
let currentTab = 'dashboard';
let lockTimer = null;
let deferredInstall = null;

// Saisie du code
let pinBuffer = '';
let pinMode = 'unlock';   // 'create' | 'confirm' | 'unlock'
let pinFirst = '';

// Feuille modale
let editingId = null;
let draft = null;

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
async function deriveKey(pin, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
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
    settings: { theme: 'dark', autoLockMin: 3, monthlyIncome: 0 },
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
    cryptoKey = await deriveKey(pinFirst, salt);
    state = defaultState();
    await save();
    enterApp();
    return;
  }
  // unlock
  try {
    const salt = fromB64(localStorage.getItem(LS.salt));
    const key = await deriveKey(pinBuffer, salt);
    const loaded = await decryptWith(key, localStorage.getItem(LS.data));
    cryptoKey = key;
    state = Object.assign(defaultState(), loaded);
    enterApp();
  } catch (e) {
    lockError('Code incorrect.');
  }
}
function onKey(k) {
  if (k === 'del') { pinBuffer = pinBuffer.slice(0, -1); renderPinDots(); return; }
  if (k === 'reset') { pinBuffer = ''; renderPinDots(); return; }
  if (!/^\d$/.test(k) || pinBuffer.length >= PIN_LENGTH) return;
  pinBuffer += k;
  renderPinDots();
  if (pinBuffer.length === PIN_LENGTH) setTimeout(pinComplete, 120);
}
function enterApp() {
  applyTheme();
  el('lock-screen').classList.add('hidden');
  el('app').classList.remove('hidden');
  resetAutoLock();
  switchTab('dashboard');
}
function lockApp() {
  cryptoKey = null;
  state = null;
  clearTimeout(lockTimer);
  closeSheet();
  showLock('unlock');
}
function resetAutoLock() {
  clearTimeout(lockTimer);
  if (!state) return;
  const min = state.settings.autoLockMin || 3;
  if (min <= 0) return;
  lockTimer = setTimeout(() => { lockApp(); }, min * 60000);
}

// ---------------- Thème ----------------
function applyTheme() {
  const t = state?.settings?.theme || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#f4f6fc' : '#0b0f1a');
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
function guessCategory(note, type) {
  const n = (note || '').toLowerCase();
  if (!n) return null;
  const pool = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    if (!pool.some((c) => c.id === cat)) continue;
    if (words.some((w) => n.includes(w))) return cat;
  }
  return null;
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

  // alertes budget
  for (const [cat, limit] of Object.entries(state.budgets)) {
    if (!limit) continue;
    const used = byCat[cat] || 0;
    const c = catById(cat);
    if (used > limit) { out.push(['⚠️', `Budget <b>${c.name}</b> dépassé de <b>${euro(used - limit)}</b>.`]); }
    else if (used >= limit * 0.8) { out.push(['🟠', `Budget <b>${c.name}</b> presque atteint (${Math.round(used / limit * 100)}%).`]); }
  }

  return out.slice(0, 4);
}

// ---------------- Vues ----------------
function render() {
  const v = el('view');
  if (currentTab === 'dashboard') v.innerHTML = viewDashboard();
  else if (currentTab === 'tx') v.innerHTML = viewTx();
  else if (currentTab === 'budgets') v.innerHTML = viewBudgets();
  else if (currentTab === 'settings') v.innerHTML = viewSettings();
  bindView();
}

function viewDashboard() {
  const mk = thisMonth();
  const cur = txOfMonth(mk);
  const income = sumBy(cur, 'income');
  const expense = sumBy(cur, 'expense');
  const balance = round2(income - expense);
  const monthLabel = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  // reste à vivre / jour : basé sur les revenus (ce qui reste réellement pour vivre),
  // à défaut sur le total des budgets définis.
  let safeBlock = '';
  const income0 = state.settings.monthlyIncome || 0;
  const useIncome = income0 > 0;
  const ref = useIncome ? income0 : totalBudget();
  if (ref > 0) {
    const remaining = round2(ref - expense);
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
          Il te reste <b style="color:${col}">${euro(remaining)}</b> sur ${useIncome ? 'tes revenus' : 'ton budget'} pour ${daysLeftInMonth()} jour(s).
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

  // dernières opérations
  const recent = state.transactions.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4);
  const recentHtml = recent.length ? recent.map(txRow).join('') :
    `<div class="empty"><span class="big-emo">🗒️</span>Aucune opération pour l'instant.</div>`;

  return `
    ${installBanner()}
    <div class="page-head">
      <div>
        <h1 class="page-title">Bonjour 👋</h1>
        <p class="page-sub" style="text-transform:capitalize">${monthLabel}</p>
      </div>
    </div>

    <div class="hero">
      <p class="hero-label">Solde du mois</p>
      <p class="hero-amount">${euro(balance)}</p>
      <div class="hero-row">
        <div class="hero-stat"><p class="l">↓ Revenus</p><p class="v">${euro(income)}</p></div>
        <div class="hero-stat"><p class="l">↑ Dépenses</p><p class="v">${euro(expense)}</p></div>
      </div>
    </div>

    <div style="height:14px"></div>
    ${safeBlock}
    ${insightsHtml}

    <div class="section-title">Dernières opérations</div>
    ${recentHtml}
  `;
}

function txRow(t) {
  const c = catById(t.category);
  const cls = t.type === 'expense' ? 'exp' : 'inc';
  const sign = t.type === 'expense' ? '-' : '+';
  return `
    <div class="tx-item" data-edit="${t.id}">
      <div class="tx-ico">${c.emoji}</div>
      <div class="tx-main">
        <div class="tx-cat">${escapeHtml(c.name)}</div>
        <div class="tx-note">${escapeHtml(t.note || new Date(t.date).toLocaleDateString('fr-FR'))}</div>
      </div>
      <div class="tx-amt ${cls}">${sign}${euro(t.amount)}</div>
    </div>`;
}

function viewTx() {
  const list = state.transactions.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!list.length) {
    return `<div class="page-head"><h1 class="page-title">Opérations</h1></div>
      <div class="empty"><span class="big-emo">🗒️</span>Aucune opération.<br>Appuie sur <b>+</b> pour commencer.</div>`;
  }
  // regroupement par date
  let html = '';
  let lastKey = '';
  for (const t of list) {
    if (t.date !== lastKey) {
      lastKey = t.date;
      const d = new Date(t.date + 'T00:00:00');
      let lbl = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      if (t.date === todayISO()) lbl = "Aujourd'hui";
      html += `<div class="tx-date-group">${lbl}</div>`;
    }
    html += txRow(t);
  }
  return `<div class="page-head"><h1 class="page-title">Opérations</h1></div>${html}`;
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
      <span class="legend-name">${c.emoji} ${escapeHtml(c.name)}</span>
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

function monthsBars() {
  const now = new Date();
  const cols = [];
  let max = 1;
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = ym(d);
    const val = sumBy(txOfMonth(key), 'expense');
    max = Math.max(max, val);
    cols.push({ lbl: d.toLocaleDateString('fr-FR', { month: 'short' }), val });
  }
  const bars = cols.map((c) => {
    const h = Math.max(4, Math.round((c.val / max) * 100));
    return `<div class="month-col">
      <div class="month-bar" style="height:${h}%" title="${euro(c.val)}"></div>
      <div class="month-lbl">${c.lbl}</div>
    </div>`;
  }).join('');
  return `<div class="months">${bars}</div>`;
}

function viewBudgets() {
  const mk = thisMonth();
  const byCat = expenseByCat(txOfMonth(mk));
  const totalExp = sumBy(txOfMonth(mk), 'expense');

  // budgets définis
  const budgetRows = EXPENSE_CATS.map((c) => {
    const limit = state.budgets[c.id] || 0;
    if (!limit) return '';
    const used = byCat[c.id] || 0;
    const pct = Math.min(100, Math.round((used / limit) * 100));
    const cls = used > limit ? 'bar-over' : (used >= limit * 0.8 ? 'bar-warn' : 'bar-ok');
    return `
      <div class="budget-item" data-budget="${c.id}">
        <div class="budget-top">
          <span class="budget-name">${c.emoji} ${c.name}</span>
          <span class="budget-val">${euro(used)} / ${euro(limit)}</span>
        </div>
        <div class="bar ${cls}"><i style="width:${pct}%"></i></div>
      </div>`;
  }).join('');

  const hasBudgets = Object.values(state.budgets).some((v) => v > 0);

  return `
    <div class="page-head"><h1 class="page-title">Budgets & analyse</h1></div>

    <div class="section-title">Répartition du mois</div>
    <div class="card">${donutSvg(byCat, totalExp)}</div>

    <div class="section-title">Dépenses des 6 derniers mois</div>
    <div class="card">${monthsBars()}</div>

    <div class="section-title">Mes budgets mensuels</div>
    <div class="card">
      ${hasBudgets ? budgetRows : '<div class="muted" style="font-size:13px">Aucun budget défini. Fixe une limite par catégorie pour être alerté avant de déraper.</div>'}
      <button class="btn btn-2" id="edit-budgets" style="margin-top:14px">🎯 Modifier mes budgets</button>
    </div>
  `;
}

function viewSettings() {
  const s = state.settings;
  return `
    <div class="page-head"><h1 class="page-title">Réglages</h1></div>

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
        <div><div class="set-label">🌗 Thème clair</div></div>
        <label class="switch"><input type="checkbox" id="theme-toggle" ${s.theme === 'light' ? 'checked' : ''}><span class="track"></span></label>
      </div>
    </div>

    <div class="section-title">Mes données</div>
    <div class="card">
      <div class="set-desc" style="margin-bottom:12px">Tes données sont chiffrées et stockées <b>uniquement sur cet appareil</b>. Fais une sauvegarde régulièrement : si tu perds le téléphone ou oublies ton code, elles sont irrécupérables.</div>
      <div class="btn-row">
        <button class="btn btn-2" id="export">⬇️ Sauvegarder</button>
        <button class="btn btn-2" id="import">⬆️ Restaurer</button>
      </div>
      <input type="file" id="import-file" accept="application/json" class="hidden">
      <button class="btn btn-danger" id="wipe" style="margin-top:12px">🗑️ Tout effacer</button>
    </div>

    <p class="muted" style="text-align:center;font-size:12px;margin-top:20px">Coffre • 100% hors-ligne • chiffré AES-256</p>
  `;
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

  if (currentTab === 'budgets') {
    el('edit-budgets')?.addEventListener('click', openBudgetSheet);
  }
  if (currentTab === 'settings') bindSettings();
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
  el('income').addEventListener('change', async (e) => {
    const v = parseFloat(e.target.value.replace(',', '.'));
    state.settings.monthlyIncome = isNaN(v) ? 0 : round2(v);
    await save(); toast('Enregistré');
  });
  el('lock-now').addEventListener('click', lockApp);
  el('change-pin').addEventListener('click', changePin);
  el('export').addEventListener('click', exportData);
  el('import').addEventListener('click', () => el('import-file').click());
  el('import-file').addEventListener('change', importData);
  el('wipe').addEventListener('click', wipeAll);
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
  el('sheet-backdrop').classList.add('hidden');
  el('sheet').classList.add('hidden');
  editingId = null; draft = null;
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
        ${cats.map((c) => `<button class="cat-chip ${c.id === draft.category ? 'sel' : ''}" data-cat="${c.id}"><span class="e">${c.emoji}</span>${c.name}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Note (facultatif)</label>
      <input id="f-note" type="text" placeholder="ex : Courses Lidl" value="${escapeHtml(draft.note || '')}">
    </div>
    <div class="field">
      <label>Date</label>
      <input id="f-date" type="date" value="${draft.date}" max="${todayISO()}">
    </div>
    <button class="btn" id="f-save">${editingId ? 'Enregistrer' : 'Ajouter'}</button>
    ${editingId ? '<button class="btn btn-danger" id="f-delete" style="margin-top:10px">Supprimer</button>' : ''}
  `;

  el('seg-exp').addEventListener('click', () => { draft.type = 'expense'; syncDraftFromInputs(); renderSheet(); });
  el('seg-inc').addEventListener('click', () => { draft.type = 'income'; syncDraftFromInputs(); renderSheet(); });
  sheet.querySelectorAll('[data-cat]').forEach((n) =>
    n.addEventListener('click', () => { draft.category = n.getAttribute('data-cat'); draft._catManual = true; renderSheet(); }));
  el('f-note').addEventListener('input', (e) => {
    draft.note = e.target.value;
    if (!draft._catManual) {
      const g = guessCategory(draft.note, draft.type);
      if (g && g !== draft.category) { draft.category = g; highlightCat(g); }
    }
  });
  el('f-save').addEventListener('click', saveTx);
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
  if (editingId) {
    const i = state.transactions.findIndex((t) => t.id === editingId);
    state.transactions[i] = tx;
  } else {
    state.transactions.push(tx);
  }
  await save();
  closeSheet();
  render();
  toast(editingId ? 'Modifié' : 'Ajouté ✓');
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
        <span style="flex:1;font-size:15px">${c.emoji} ${c.name}</span>
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

// ---------------- Changement de PIN ----------------
async function changePin() {
  const p1 = prompt('Nouveau code à 4 chiffres :');
  if (p1 === null) return;
  if (!/^\d{4}$/.test(p1)) { toast('Le code doit faire 4 chiffres'); return; }
  const p2 = prompt('Confirme le nouveau code :');
  if (p2 !== p1) { toast('Les codes ne correspondent pas'); return; }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(LS.salt, b64(salt));
  cryptoKey = await deriveKey(p1, salt);
  await save();
  toast('Code modifié ✓');
}

// ---------------- Sauvegarde / restauration / effacement ----------------
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `coffre-sauvegarde-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Sauvegarde téléchargée');
}
function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.transactions)) throw new Error('format');
      state = Object.assign(defaultState(), data);
      applyTheme();
      await save();
      render();
      toast('Données restaurées ✓');
    } catch (err) {
      toast('Fichier invalide');
    }
  };
  reader.readAsText(file);
}
async function wipeAll() {
  if (!confirm('Effacer TOUTES tes données et ton code ? Cette action est irréversible.')) return;
  localStorage.removeItem(LS.data);
  localStorage.removeItem(LS.salt);
  cryptoKey = null; state = null;
  showLock('create');
  toast('Tout a été effacé');
}

// ---------------- Navigation ----------------
function switchTab(tab) {
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

// ---------------- Démarrage ----------------
function init() {
  // Service worker (hors-ligne)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
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

  // Fermeture de la feuille
  el('sheet-backdrop').addEventListener('click', closeSheet);

  // Auto-lock : réinitialisé à chaque interaction
  ['click', 'touchstart', 'keydown'].forEach((ev) =>
    document.addEventListener(ev, () => { if (state) resetAutoLock(); }, { passive: true }));

  // Écran initial
  const initialized = localStorage.getItem(LS.data) && localStorage.getItem(LS.salt);
  showLock(initialized ? 'unlock' : 'create');
}

init();
