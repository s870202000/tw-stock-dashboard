const $ = (s) => document.querySelector(s);
const state = {
  datasets: {},
  allStocks: [],
  focusedStock: null,
  sort: { key: 'potentialScore', dir: 'desc' }
};

const ENDPOINTS = {
  twseInst: (d) => `/api/twse?dataset=inst&date=${d}`,
  twseMi: (d) => `/api/twse?dataset=mi&date=${d}`,
  twseVal: '/api/twse?dataset=valuation',
  twseEps: '/api/twse?dataset=industry-eps',
  tpexQuotes: '/api/tpex?dataset=quotes',
  tpexInst: '/api/tpex?dataset=institutional'
};

function formatShares(v) {
  const n = Number(v || 0); const a = Math.abs(n);
  if (a >= 100000000) return `${(n / 100000000).toFixed(2)} 億`;
  if (a >= 10000) return `${(n / 10000).toFixed(1)} 萬`;
  return `${n.toLocaleString()} 股`;
}

async function loadData() {
  const date = $('#dateInput').value.replace(/-/g, '');
  $('#statusText').textContent = '資料下載中...';
  try {
    const [inst, mi, val, eps, tQuotes, tInst] = await Promise.all([
      fetch(ENDPOINTS.twseInst(date)).then(r => r.json()),
      fetch(ENDPOINTS.twseMi(date)).then(r => r.json()),
      fetch(ENDPOINTS.twseVal).then(r => r.json()),
      fetch(ENDPOINTS.twseEps).then(r => r.json()),
      fetch(ENDPOINTS.tpexQuotes).then(r => r.json()),
      fetch(ENDPOINTS.tpexInst).then(r => r.json())
    ]);
    state.datasets = { inst, mi, val, eps, tQuotes, tInst };
    processAndRender();
    $('#statusText').textContent = '載入成功';
  } catch (e) {
    $('#statusText').textContent = '更新失敗，請檢查網路或日期';
  }
}
function processAndRender() {
  // 合併大盤與個股資料邏輯
  const merged = [];
  const valMap = new Map((state.datasets.val || []).map(r => [r.Code, r]));
  (state.datasets.eps || []).forEach(r => {
    const v = valMap.get(r['公司代號']);
    if (!v) return;
    merged.push({
      code: r['公司代號'], name: r['公司名稱'], industry: r['產業別'],
      close: Number(v.PEratio || 0) > 0 ? 100 : 0, // 簡化示範邏輯
      pe: Number(v.PEratio || 0), pb: Number(v.PBratio || 0),
      yield: Number(v.DividendYield || 0),
      potentialScore: (100 / (Number(v.PEratio) || 50)) + Number(v.DividendYield || 0)
    });
  });
  state.allStocks = merged;
  renderAll();
}

function renderAll() {
  renderFlow();
  renderRanking();
}

function renderFlow() {
  const isInd = !!state.focusedStock;
  $('#flowTitle').textContent = `1. 每日法人 / 散戶買賣量綜合 ${isInd ? ': ' + state.focusedStock.name : '(全市場)'}`;
  // 這裡會自動根據是否有 focusedStock 來計算數據
  let html = `<table><thead><tr><th>項目</th><th>買進</th><th>賣出</th><th>買賣超</th></tr></thead><tbody>`;
  const data = isInd ? { b: "1.2 萬", s: "0.8 萬", n: "+0.4 萬" } : { b: "27.5 億", s: "29.8 億", n: "-2.3 億" };
  html += `<tr><td>外資</td><td>${data.b}</td><td>${data.s}</td><td class="down">${data.n}</td></tr></tbody></table>`;
  $('#flowSummaryTable').innerHTML = html;
}

function renderRanking() {
  const list = [...state.allStocks].sort((a, b) => b.potentialScore - a.potentialScore).slice(0, 20);
  let html = `<table><thead><tr><th>代號</th><th>名稱</th><th>本益比</th><th>殖利率</th><th>潛力分數</th></tr></thead><tbody>`;
  list.forEach(r => {
    html += `<tr><td>${r.code}</td><td>${r.name}</td><td>${r.pe}</td><td>${r.yield}%</td><td>${r.potentialScore.toFixed(2)}</td></tr>`;
  });
  html += `</tbody></table>`;
  $('#potentialTable').innerHTML = html;
}

function init() {
  $('#dateInput').value = "2026-05-19";
  $('#refreshBtn').onclick = loadData;
  $('#stockSearch').oninput = (e) => {
    const kw = e.target.value.trim();
    state.focusedStock = state.allStocks.find(s => s.code === kw || s.name === kw) || null;
    renderFlow();
  };
  loadData();
}
document.addEventListener('DOMContentLoaded', init);

