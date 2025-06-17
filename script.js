/******************************************************
  script.js — FIXED version: metrics + fallback safe
******************************************************/

/* ───────────── 1  ICONS & NAV ───────────── */
feather.replace();
const pages = document.querySelectorAll('.page');
const navBtns = document.querySelectorAll('[data-page]');
const sidebar = document.getElementById('sidebar');
function show(id) {
  pages.forEach(p => p.classList.toggle('active', p.id === id));
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.page === id));
  if (innerWidth < 768) sidebar.classList.remove('open');
}
navBtns.forEach(b => b.onclick = () => show(b.dataset.page));
show('rates');
hamburger.onclick = () => sidebar.classList.toggle('open');

/* ───────────── 2  THEME TOGGLES ─────────── */
matrixToggle.onchange = e => document.body.classList.toggle('matrix', e.target.checked);
blurToggle.onchange = e => document.body.classList.toggle('blurred', e.target.checked);

/* ───────────── 3  DATA STORES ───────────── */
const latest = {};   // live quotes
const barsDB = {};   // historical OHLC
const metrics = {};  // price, SMA, RSI, ATR

/* ───────────── 4  PAIRS INIT ───────────── */
const PAIRS = [
  { key: 'EUR/USD', tv: 'FX:EURUSD', quote: 'EUR', inv: true },
  { key: 'USD/JPY', tv: 'FX:USDJPY', quote: 'JPY', inv: false },
  { key: 'GBP/USD', tv: 'FX:GBPUSD', quote: 'GBP', inv: true },
  { key: 'AUD/USD', tv: 'FX:AUDUSD', quote: 'AUD', inv: true }
];

(async function init() {
  await Promise.all(PAIRS.map(loadPair));
  calcIndicators();
  updateUICards();
  updatePL();
  setInterval(refreshSnapshot, 60000);
})();

/* ───────────── 5  TV OHLC ───────────── */
async function loadPair(p) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 60 * 86400;
  const url = tvUrl(p.tv, from, to);
  try {
    const tv = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`).then(r => r.json());
    if (tv.s !== 'ok' || !tv.c.length) throw 'TV empty';
    barsDB[p.key] = tv.t.map((t, i) => ({
      time: new Date(tv.t[i] * 1000).toISOString().slice(0, 10),
      open: tv.o[i],
      high: tv.h[i],
      low: tv.l[i],
      close: tv.c[i]
    }));
    latest[p.quote] = p.inv ? 1 / tv.c.at(-1) : tv.c.at(-1);
    ensureMetricSkeleton(p.key);
  } catch (e) {
    console.warn(`TV fail for ${p.key}`, e);
    await fallbackPair(p);
  }
}
function tvUrl(symbol, from, to) {
  return `https://tvd.tradingview.com/history?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}`;
}

/* ───────────── 6  FALLBACK API ─────────── */
async function fallbackPair(p) {
  const end = new Date(), start = new Date(end.getTime() - 60 * 864e5);
  const url = `https://api.exchangerate.host/timeseries?start_date=${d(start)}&end_date=${d(end)}&base=USD&symbols=${p.quote}`;
  const js = await fetch(url).then(r => r.json());
  barsDB[p.key] = Object.entries(js.rates).map(([d, v]) => {
    const px = p.inv ? 1 / v[p.quote] : v[p.quote];
    return { time: d, open: px, high: px, low: px, close: px };
  });
  latest[p.quote] = p.inv ? 1 / js.rates[d(end)][p.quote] : js.rates[d(end)][p.quote];
  ensureMetricSkeleton(p.key);
}
function d(x) { return x.toISOString().slice(0, 10); }

/* ───────────── 7  METRIC HELPERS ───────── */
function quotePrice(pairKey) {
  if (pairKey === 'EUR/USD') return 1 / latest.EUR;
  if (pairKey === 'USD/JPY') return latest.JPY;
  if (pairKey === 'GBP/USD') return 1 / latest.GBP;
  if (pairKey === 'AUD/USD') return 1 / latest.AUD;
  return undefined;
}
function ensureMetricSkeleton(pairKey) {
  if (!metrics[pairKey]) {
    const px = quotePrice(pairKey);
    if (px) metrics[pairKey] = { price: px, sma: '--', rsi: '--' };
  }
}

/* ───────────── 8  INDICATORS ───────────── */
function calcIndicators() {
  Object.entries(barsDB).forEach(([pair, b]) => {
    if (b.length < 21) return;
    const closes = b.map(x => x.close);
    const sma = closes.slice(-20).reduce((a, c) => a + c, 0) / 20;
    let up = 0, dn = 0;
    for (let i = closes.length - 15; i < closes.length - 1; i++) {
      const d = closes[i + 1] - closes[i]; d > 0 ? up += d : dn -= d;
    }
    const rsi = 100 - 100 / (1 + up / (dn || .0001));
    const tr = [];
    for (let i = b.length - 15; i < b.length; i++) tr.push(b[i].high - b[i].low);
    const atr = tr.reduce((a, c) => a + c, 0) / tr.length;
    metrics[pair] = { ...(metrics[pair] || {}), price: closes.at(-1), sma, rsi, atr };
  });
}

/* ───────────── 9  UI CARD UPDATES ──────── */
function updateUICards() {
  PAIRS.forEach(p => {
    const m = metrics[p.key] || {};
    if (!m.price) m.price = quotePrice(p.key);
    const code = p.key.replace('/', '');
    const card = document.querySelector(`[data-pair="${code}"]`);
    if (card) {
      card.querySelector('.price').textContent = m.price?.toFixed ? m.price.toFixed(4) : '--';
      card.querySelector('.sma span').textContent = m.sma?.toFixed ? m.sma.toFixed(4) : '--';
      card.querySelector('.rsi span').textContent = m.rsi?.toFixed ? m.rsi.toFixed(1) : '--';
    }
  });
}

/* ───────────── 10  1-MIN SNAPSHOT ──────── */
async function refreshSnapshot() {
  const snap = await fetch('https://api.exchangerate.host/latest?base=USD').then(r => r.json());
  Object.assign(latest, snap.rates);
  PAIRS.forEach(p => ensureMetricSkeleton(p.key));
  updateUICards(); updatePL();
}

/* ───────────── 11  AI STRATEGY ─────────── */
function detectPattern(b) {
  if (!b || b.length < 2) return null;
  const [prev, last] = b.slice(-2);
  if (prev.close < prev.open && last.close > last.open && last.close > prev.open && last.open < prev.close) return 'BULL';
  if (prev.close > prev.open && last.close < last.open && last.open > prev.close && last.close < prev.open) return 'BEAR';
  if (last.high < prev.high && last.low > prev.low) return 'INSIDE';
  return null;
}
function buildAI(pair, dir, entry) {
  const m = metrics[pair] || {}, bars = barsDB[pair];
  if (!m.atr) return { note: 'AI waiting for data…' };
  const atr = m.atr, stop = dir === 'Buy' ? entry - atr : entry + atr, tgt = dir === 'Buy' ? entry + 2 * atr : entry - 2 * atr;
  const pat = detectPattern(bars);
  let note = '';
  if (pat === 'BULL') note = '📈 Bullish-engulfing — long bias';
  if (pat === 'BEAR') note = '📉 Bearish-engulfing — short bias';
  if (pat === 'INSIDE') note = '📊 Inside-bar, watch breakout';
  if ((pat === 'BULL' && dir === 'Sell') || (pat === 'BEAR' && dir === 'Buy')) note += ' ⚠️ dir vs pattern!';
  return { stop, tgt, note };
}

/* ───────────── 12  PORTFOLIO SIM ───────── */
const pos = [];
portForm.onsubmit = e => {
  e.preventDefault();
  const pair = pPair.value, dir = pDir.value, units = +pUnits.value, entry = +pEntry.value;
  const ai = aiPortToggle.checked ? buildAI(pair, dir, entry) : {};
  pos.push({ pair, dir, units, entry, ...ai });
  render(); pUnits.value = ''; pEntry.value = '';
};
function mark(p) {
  if (p === 'EUR/USD') return 1 / latest.EUR;
  if (p === 'USD/JPY') return latest.JPY;
  if (p === 'GBP/USD') return 1 / latest.GBP;
  if (p === 'AUD/USD') return 1 / latest.AUD;
}
function render() {
  portGrid.innerHTML = '';
  pos.forEach(p => {
    const mp = mark(p.pair);
    const pl = ((p.dir === 'Buy' ? mp - p.entry : p.entry - mp) * p.units).toFixed(2);
    portGrid.insertAdjacentHTML('beforeend', `
      <div class="port-card">
        <h4>${p.pair}</h4>
        <div>Entry <span>${p.entry.toFixed(4)}</span></div>
        <div>Mark <span>${mp.toFixed(4)}</span></div>
        ${p.stop ? `<div>Stop <span>${p.stop.toFixed(4)}</span></div>` : ''}
        ${p.tgt ? `<div>Target <span>${p.tgt.toFixed(4)}</span></div>` : ''}
        <div>Units <span>${p.units.toLocaleString()}</span></div>
        <div class="pl"><b>P/L</b> <span style="color:${pl >= 0 ? 'lime' : 'salmon'}">${pl}</span></div>
        ${p.note ? `<div class="ai">${p.note}</div>` : ''}
      </div>`);
  });
}
function updatePL() {
  if (pos.length) render();
}
