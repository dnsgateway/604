/*********************************************
  script.js  (one file – drop into <script src>)
*********************************************/

/* ---------- 1. ICONS & NAV ROUTER ---------- */
feather.replace();
const pages   = document.querySelectorAll('.page');
const navBtns = document.querySelectorAll('[data-page]');
const sidebar = document.getElementById('sidebar');

function show(id){
  pages.forEach(p=>p.classList.toggle('active',p.id===id));
  navBtns.forEach(b=>b.classList.toggle('active',b.dataset.page===id));
  if(innerWidth<768) sidebar.classList.remove('open');
}
navBtns.forEach(b=>b.onclick=()=>show(b.dataset.page));
show('rates');                                 // default page
hamburger.onclick = ()=>sidebar.classList.toggle('open');

/* ---------- 2. MATRIX & BLUR TOGGLES ---------- */
matrixToggle.onchange = e=>document.body.classList.toggle('matrix',e.target.checked);
blurToggle  .onchange = e=>document.body.classList.toggle('blurred',e.target.checked);

/* ---------- 3. GLOBAL DATA STORES ------------- */
const latest   = {};   // most recent snapshot
const metrics  = {};   // { 'EUR/USD':{price,sma,rsi} ... }
const ohlcMap  = {};   // { 'EUR/USD':[ {t,o,h,l,c}, ... ] }

/* ---------- 4. SNAPSHOT QUOTES (+ update cards) ---------- */
(async function initQuotes(){
  const snap = await fetch('https://api.exchangerate.host/latest?base=USD').then(r=>r.json());
  Object.assign(latest,snap.rates);
  setRateCard('EURUSD','EUR',true);
  setRateCard('USDJPY','JPY',false);
  setRateCard('GBPUSD','GBP',true);
  /* after snapshot, fetch 60-day OHLC in parallel */
  await Promise.all([
    loadSeries('EUR/USD','EUR',true),
    loadSeries('USD/JPY','JPY',false),
    loadSeries('GBP/USD','GBP',true)
  ]);
  /* once OHLC has come back we can compute metrics */
  computeIndicators();
})();
function setRateCard(code,quote,inv){
  const price = inv ? 1/latest[quote] : latest[quote];
  document.querySelector(`[data-pair="${code}"] .price`).textContent = price.toFixed(4);
  metrics[code.replace(/([A-Z]{3})([A-Z]{3})/,'$1/$2')] = { price };
}

/* ---------- 5. LOAD 60-DAY DAILY OHLC ---------- */
async function loadSeries(pair, quote, invert){
  const end = new Date(), start=new Date(end.getTime()-60*864e5);
  const url = `https://api.exchangerate.host/timeseries?start_date=${d(start)}&end_date=${d(end)}&base=USD&symbols=${quote}`;
  const js  = await fetch(url).then(r=>r.json());
  const bars = [];
  for(const [day,v] of Object.entries(js.rates)){
    const p = invert ? 1/v[quote] : v[quote];
    bars.push({ time:day, open:p, high:p, low:p, close:p });
  }
  ohlcMap[pair] = bars.sort((a,b)=> new Date(a.time) - new Date(b.time));
}
function d(dt){return dt.toISOString().slice(0,10);}

/* ---------- 6. INDICATORS (SMA-20, RSI-14) ----- */
function computeIndicators(){
  for(const [pair,bars] of Object.entries(ohlcMap)){
    if(bars.length<21) continue;
    const closes = bars.map(b=>b.close);
    const sma = closes.slice(-20).reduce((a,b)=>a+b,0)/20;
    let gain=0,loss=0;
    for(let i=closes.length-15;i<closes.length-1;i++){
      const diff = closes[i+1]-closes[i];
      diff>0?gain+=diff:loss-=diff;
    }
    const rsi = 100-100/(1+gain/(loss||.0001));
    metrics[pair] = {...metrics[pair], sma, rsi};
    const code = pair.replace('/','');
    const card = document.querySelector(`[data-pair="${code}"]`);
    if(card){
      card.querySelector('.sma span').textContent = sma.toFixed(4);
      card.querySelector('.rsi span').textContent = rsi.toFixed(1);
    }
  }
}

/* ---------- 7. SIMPLE PATTERN DETECTOR -------- */
function detectPattern(bars){
  if(bars.length<2) return null;
  const last = bars[bars.length-1];
  const prev = bars[bars.length-2];

  // Bullish Engulfing
  if(prev.close < prev.open && last.close > last.open &&
     last.close > prev.open && last.open < prev.close){
    return 'bullishEngulf';
  }
  // Bearish Engulfing
  if(prev.close > prev.open && last.close < last.open &&
     last.open > prev.close && last.close < prev.open){
    return 'bearishEngulf';
  }
  // Inside Bar
  if(last.high < prev.high && last.low > prev.low){
    return 'insideBar';
  }
  return null;
}

/* ---------- 8. AI STRATEGY TEXT GEN ----------- */
function aiStrategy(pair){
  const m = metrics[pair];
  const bars = ohlcMap[pair] || [];
  const pat = detectPattern(bars);

  if(!m) return 'Data not ready.';
  if(pat==='bullishEngulf') return '📈 Bullish-engulfing on daily — long bias.';
  if(pat==='bearishEngulf') return '📉 Bearish-engulfing — short bias.';
  if(pat==='insideBar')     return '📊 Inside-bar: wait for breakout.';
  if(m.price < m.sma && m.rsi < 35)
      return '📈 Oversold pullback — consider long.';
  if(m.price > m.sma && m.rsi > 65)
      return '📉 Overbought — consider short.';
  return '⚖️  No clear edge.';
}

/* ---------- 9. PORTFOLIO SIMULATOR ------------ */
const port = [];
portForm.onsubmit = e=>{
  e.preventDefault();
  const pair  = pPair.value;
  const pos   = {
    pair,
    dir   : pDir.value,
    units : +pUnits.value,
    entry : +pEntry.value,
    note  : aiPortToggle.checked ? aiStrategy(pair) : ''
  };
  port.push(pos);
  renderPort();
  pUnits.value=''; pEntry.value='';
};
function renderPort(){
  portGrid.innerHTML='';
  port.forEach(p=>{
    const mark=getMark(p.pair);
    const pl  = ((p.dir==='Buy'?mark-p.entry:p.entry-mark)*p.units).toFixed(2);
    portGrid.insertAdjacentHTML('beforeend',`
      <div class="port-card">
        <h4>${p.pair}</h4>
        <div>Entry <span>${p.entry.toFixed(4)}</span></div>
        <div>Mark  <span>${mark.toFixed(4)}</span></div>
        <div>Units <span>${p.units.toLocaleString()}</span></div>
        <div class="pl">P/L <span style="color:${pl>=0?'lime':'salmon'}">${pl}</span></div>
        ${p.note ? `<div class="ai">${p.note}</div>` : ''}
      </div>`);
  });
}
function getMark(pair){
  if(pair==='EUR/USD') return 1/latest.EUR;
  if(pair==='USD/JPY') return latest.JPY;
  if(pair==='GBP/USD') return 1/latest.GBP;
  return 0;
}
function updatePL(){if(port.length)renderPort();}

/* ----- auto-refresh P/L when snapshot updates every 60 s ----- */
setInterval(async()=>{
  const snap = await fetch('https://api.exchangerate.host/latest?base=USD').then(r=>r.json());
  Object.assign(latest,snap.rates);
  setRateCard('EURUSD','EUR',true);
  setRateCard('USDJPY','JPY',false);
  setRateCard('GBPUSD','GBP',true);
  updatePL();
},60000);
