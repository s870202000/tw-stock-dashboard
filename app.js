const $ = (s) => document.querySelector(s);
const state = {
  datasets: {},
  allStocks: [],
  watchlist: JSON.parse(localStorage.getItem('tw-watchlist') || '[]'),
  sort: { key: 'potentialScore', dir: 'desc' }
};

// V3 使用 Vercel API 代理
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
  $('#statusText').textContent = '⚡ 資料更新中...';
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
    processData();
    $('#statusText').textContent = '✅ 更新成功';
  } catch (e) {
    $('#statusText').textContent = '❌ 更新失敗，請檢查日期或稍後再試';
  }
}
function processData() {
  const merged = [];
  const valMap = new Map((state.datasets.val || []).map(r => [r.Code, r]));
  (state.datasets.eps || []).forEach(r => {
    const v = valMap.get(r['公司代號']);
    if (!v) return;
    const pe = parseFloat(v.PEratio) || 0;
    const yield = parseFloat(v.DividendYield) || 0;
    merged.push({
      code: r['公司代號'], name: r['公司名稱'], industry: r['產業別'],
      close: pe > 0 ? 100 : 0, pe, pb: parseFloat(v.PBratio) || 0, yield,
      potentialScore: pe > 0 ? (100 / pe + yield) : yield
    });
  });
  state.allStocks = merged;
  renderAll();
}

function renderAll() {
  // 簡易渲染 V3 表格邏輯
  const top20 = [...state.allStocks].sort((a, b) => b.potentialScore - a.potentialScore).slice(0, 20);
  let html = `<table><thead><tr><th>代號</th><th>名稱</th><th>本益比</th><th>殖利率</th><th>潛力分數</th></tr></thead><tbody>`;
  top20.forEach(s => {
    html += `<tr><td>${s.code}</td><td>${s.name}</td><td>${s.pe}</td><td>${s.yield}%</td><td>${s.potentialScore.toFixed(2)}</td></tr>`;
  });
  html += `</tbody></table>`;
  $('#potentialTable').innerHTML = html;
  
  // 渲染大盤買賣量 (示範固定數據，實際會連動 API)
  $('#flowSummaryTable').innerHTML = `<table><thead><tr><th>類別</th><th>買進</th><th>賣出</th><th>買賣超</th></tr></thead>
    <tbody><tr><td>外資</td><td>27.04 億</td><td>29.97 億</td><td class="down">-2.92 億</td></tr></tbody></table>`;
}

function init() {
  $('#dateInput').value = "2026-05-19";
  $('#refreshBtn').onclick = loadData;
  loadData();
}
document.addEventListener('DOMContentLoaded', init);

