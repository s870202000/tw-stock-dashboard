const $ = (sel) => document.querySelector(sel);
const state = {
  autoRefresh: true,
  refreshTimer: null,
  latestTwseDate: null,
  latestTpexDate: null,
  lastLoadedAt: null,
  datasets: {},
  allStocks: [],
  watchlist: []
};

const WATCHLIST_KEY = 'tw-stock-dashboard-watchlist';

const ENDPOINTS = {
  twseInstByDate: (date) => `/api/twse?dataset=inst&date=${date}`,
  twseMiByDate: (date) => `/api/twse?dataset=mi&date=${date}`,
  twseLatestQuotes: '/api/twse?dataset=latest-quotes',
  twseValuation: '/api/twse?dataset=valuation',
  twseIndustryEps: '/api/twse?dataset=industry-eps',
  tpexQuotes: '/api/tpex?dataset=quotes',
  tpexValuation: '/api/tpex?dataset=valuation',
  tpexIndustryEps: '/api/tpex?dataset=industry-eps',
  tpexInst: '/api/tpex?dataset=institutional'
};


function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').trim();
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const text = stripHtml(value).replace(/,/g, '').replace(/--/g, '').trim();
  if (!text || text === '-') return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatShares(value) {
  return `${formatNumber(value)} 股`;
}

function formatMoney(value) {
  return `${formatNumber(value, 2)} 元`;
}

function formatPercent(value, digits = 2) {
  return `${formatNumber(value, digits)}%`;
}

function safeDiv(a, b) {
  return b ? a / b : 0;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function toTwseDate(dateStr) {
  return String(dateStr || '').replace(/-/g, '');
}

function fromMinguoDate(minguoDate) {
  const text = String(minguoDate || '');
  if (!/^\d{7,8}$/.test(text)) return text;
  const y = Number(text.slice(0, text.length - 4)) + 1911;
  const m = text.slice(-4, -2);
  const d = text.slice(-2);
  return `${y}-${m}-${d}`;
}

function taipeiDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

function taipeiTimeString(date = new Date()) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

function shiftDate(dateStr, diffDays) {
  const date = new Date(`${dateStr}T00:00:00+08:00`);
  date.setDate(date.getDate() + diffDays);
  return taipeiDateString(date);
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`下載失敗：${res.status}`);
  return res.json();
}

function normalizeByFields(fields, rows) {
  return (rows || []).map((row) => {
    const obj = {};
    (fields || []).forEach((field, idx) => {
      obj[field] = row[idx];
    });
    return obj;
  });
}

function findMiStockTable(miJson) {
  return (miJson.tables || []).find((table) =>
    Array.isArray(table.fields) &&
    table.fields.includes('證券代號') &&
    table.fields.includes('成交股數') &&
    table.fields.includes('收盤價')
  );
}

function findKeyByWords(obj, words) {
  return Object.keys(obj).find((key) => words.every((word) => key.includes(word)));
}

function setLoading(loading, text = '') {
  $('#loadingMask').classList.toggle('show', loading);
  $('#loadingText').textContent = text || '資料載入中…';
}

function setStatus(message, type = 'info') {
  const el = $('#statusText');
  el.textContent = message;
  el.dataset.type = type;
}

function loadWatchlist() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
    state.watchlist = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    state.watchlist = [];
  }
}

function saveWatchlist() {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(state.watchlist));
}

function isWatched(code) {
  return state.watchlist.includes(code);
}

function toggleWatchlist(code) {
  if (!code) return;
  if (isWatched(code)) {
    state.watchlist = state.watchlist.filter((item) => item !== code);
  } else {
    state.watchlist = [...state.watchlist, code];
  }
  saveWatchlist();
  renderSearchResults($('#stockSearch').value || '');
  renderWatchlist();
}

function getWatchlistStocks() {
  const map = new Map(state.allStocks.map((row) => [row.code, row]));
  return state.watchlist.map((code) => map.get(code)).filter(Boolean);
}

async function fetchTwseDateBundle(requestedDate) {
  let probe = requestedDate;
  for (let i = 0; i < 8; i += 1) {
    const ymd = toTwseDate(probe);
    const [inst, mi] = await Promise.all([
      fetchJSON(ENDPOINTS.twseInstByDate(ymd)),
      fetchJSON(ENDPOINTS.twseMiByDate(ymd))
    ]);
    const hasInst = inst && inst.stat === 'OK' && Array.isArray(inst.data) && inst.data.length;
    const miTable = hasInst ? findMiStockTable(mi) : null;
    if (hasInst && miTable && Array.isArray(miTable.data) && miTable.data.length) {
      return { requestedDate, actualDate: probe, inst, mi };
    }
    probe = shiftDate(probe, -1);
  }
  throw new Error('最近 8 天都沒有可用的上市資料');
}

function buildTwseSummary(bundle) {
  const instRows = normalizeByFields(bundle.inst.fields, bundle.inst.data);
  const miTable = findMiStockTable(bundle.mi);
  const quoteRows = normalizeByFields(miTable.fields, miTable.data);
  const volumeByCode = new Map(quoteRows.map((row) => [row['證券代號'], cleanNumber(row['成交股數'])]));

  const sums = {
    foreignBuy: 0, foreignSell: 0, foreignNet: 0,
    trustBuy: 0, trustSell: 0, trustNet: 0,
    dealerBuy: 0, dealerSell: 0, dealerNet: 0,
    instBuy: 0, instSell: 0, instNet: 0,
    retailBuy: 0, retailSell: 0, retailNet: 0,
    totalVolume: 0
  };

  for (const row of instRows) {
    const code = row['證券代號'];
    const foreignBuy = cleanNumber(row['外陸資買進股數(不含外資自營商)']);
    const foreignSell = cleanNumber(row['外陸資賣出股數(不含外資自營商)']);
    const foreignNet = cleanNumber(row['外陸資買賣超股數(不含外資自營商)']);
    const trustBuy = cleanNumber(row['投信買進股數']);
    const trustSell = cleanNumber(row['投信賣出股數']);
    const trustNet = cleanNumber(row['投信買賣超股數']);
    const dealerSelfBuy = cleanNumber(row['自營商買進股數(自行買賣)']);
    const dealerSelfSell = cleanNumber(row['自營商賣出股數(自行買賣)']);
    const dealerSelfNet = cleanNumber(row['自營商買賣超股數(自行買賣)']);
    const dealerHedgeBuy = cleanNumber(row['自營商買進股數(避險)']);
    const dealerHedgeSell = cleanNumber(row['自營商賣出股數(避險)']);
    const dealerHedgeNet = cleanNumber(row['自營商買賣超股數(避險)']);
    const dealerBuy = dealerSelfBuy + dealerHedgeBuy;
    const dealerSell = dealerSelfSell + dealerHedgeSell;
    const dealerNet = dealerSelfNet + dealerHedgeNet;
    const instBuy = foreignBuy + trustBuy + dealerBuy;
    const instSell = foreignSell + trustSell + dealerSell;
    const instNet = foreignNet + trustNet + dealerNet;
    const totalVolume = volumeByCode.get(code) || 0;
    const retailBuy = Math.max(0, totalVolume - instBuy);
    const retailSell = Math.max(0, totalVolume - instSell);

    sums.foreignBuy += foreignBuy;
    sums.foreignSell += foreignSell;
    sums.foreignNet += foreignNet;
    sums.trustBuy += trustBuy;
    sums.trustSell += trustSell;
    sums.trustNet += trustNet;
    sums.dealerBuy += dealerBuy;
    sums.dealerSell += dealerSell;
    sums.dealerNet += dealerNet;
    sums.instBuy += instBuy;
    sums.instSell += instSell;
    sums.instNet += instNet;
    sums.retailBuy += retailBuy;
    sums.retailSell += retailSell;
    sums.totalVolume += totalVolume;
  }

  return {
    market: 'TWSE',
    requestedDate: bundle.requestedDate,
    actualDate: bundle.actualDate,
    rawDate: bundle.inst.date,
    sums,
    stockCount: instRows.length
  };
}

function buildTpexSummary(quotes, inst) {
  const volumeByCode = new Map((quotes || []).map((row) => [row.SecuritiesCompanyCode, cleanNumber(row.TradingShares)]));
  const sums = {
    foreignBuy: 0, foreignSell: 0, foreignNet: 0,
    trustBuy: 0, trustSell: 0, trustNet: 0,
    dealerBuy: 0, dealerSell: 0, dealerNet: 0,
    instBuy: 0, instSell: 0, instNet: 0,
    retailBuy: 0, retailSell: 0, retailNet: 0,
    totalVolume: 0
  };

  for (const row of inst || []) {
    const code = row.SecuritiesCompanyCode;
    const foreignBuy = cleanNumber(row[findKeyByWords(row, ['Foreign Investors include Mainland Area Investors', 'Total Buy'])]);
    const foreignSell = cleanNumber(row[findKeyByWords(row, ['Foreign Investors include Mainland Area Investors', 'Total Sell'])]);
    const foreignNet = cleanNumber(row[findKeyByWords(row, ['Foreign Investors include Mainland Area Investors', 'Difference'])]);
    const trustBuy = cleanNumber(row[findKeyByWords(row, ['Investment Trust', 'Total Buy'])]);
    const trustSell = cleanNumber(row[findKeyByWords(row, ['Investment Trust', 'Total Sell'])]);
    const trustNet = cleanNumber(row[findKeyByWords(row, ['InvestmentTrust', 'Difference'])] ?? row[findKeyByWords(row, ['Investment Trust', 'Difference'])]);
    const dealerPropBuy = cleanNumber(row[findKeyByWords(row, ['Dealers -Proprietary', 'Total Buy'])]);
    const dealerPropSell = cleanNumber(row[findKeyByWords(row, ['Dealers -Proprietary', 'Total Sell'])]);
    const dealerPropNet = cleanNumber(row[findKeyByWords(row, ['Dealers-Proprietary', 'Difference'])] ?? row[findKeyByWords(row, ['Dealers -Proprietary', 'Difference'])]);
    const dealerHedgeBuy = cleanNumber(row[findKeyByWords(row, ['Dealers -Hedging', 'Total Buy'])]);
    const dealerHedgeSell = cleanNumber(row[findKeyByWords(row, ['Dealers -Hedging', 'Total Sell'])]);
    const dealerHedgeNet = cleanNumber(row[findKeyByWords(row, ['Dealers-Hedging', 'Difference'])] ?? row[findKeyByWords(row, ['Dealers -Hedging', 'Difference'])]);
    const dealerBuy = dealerPropBuy + dealerHedgeBuy;
    const dealerSell = dealerPropSell + dealerHedgeSell;
    const dealerNet = dealerPropNet + dealerHedgeNet;
    const instBuy = foreignBuy + trustBuy + dealerBuy;
    const instSell = foreignSell + trustSell + dealerSell;
    const instNet = foreignNet + trustNet + dealerNet;
    const totalVolume = volumeByCode.get(code) || 0;
    const retailBuy = Math.max(0, totalVolume - instBuy);
    const retailSell = Math.max(0, totalVolume - instSell);

    sums.foreignBuy += foreignBuy;
    sums.foreignSell += foreignSell;
    sums.foreignNet += foreignNet;
    sums.trustBuy += trustBuy;
    sums.trustSell += trustSell;
    sums.trustNet += trustNet;
    sums.dealerBuy += dealerBuy;
    sums.dealerSell += dealerSell;
    sums.dealerNet += dealerNet;
    sums.instBuy += instBuy;
    sums.instSell += instSell;
    sums.instNet += instNet;
    sums.retailBuy += retailBuy;
    sums.retailSell += retailSell;
    sums.totalVolume += totalVolume;
  }

  return {
    market: 'TPEX',
    actualDate: fromMinguoDate((inst && inst[0] && inst[0].Date) || (quotes && quotes[0] && quotes[0].Date) || ''),
    rawDate: (inst && inst[0] && inst[0].Date) || (quotes && quotes[0] && quotes[0].Date) || '',
    sums,
    stockCount: inst.length
  };
}

function mergeRankData() {
  const twseQuotes = state.datasets.twseLatestQuotes || [];
  const twseValuation = state.datasets.twseValuation || [];
  const twseIndustry = state.datasets.twseIndustry || [];
  const tpexQuotes = state.datasets.tpexQuotes || [];
  const tpexValuation = state.datasets.tpexValuation || [];
  const tpexIndustry = state.datasets.tpexIndustry || [];

  const twseQuoteMap = new Map(twseQuotes.map((row) => [row.Code, row]));
  const twseValMap = new Map(twseValuation.map((row) => [row.Code, row]));
  const tpexQuoteMap = new Map(tpexQuotes.map((row) => [row.SecuritiesCompanyCode, row]));
  const tpexValMap = new Map(tpexValuation.map((row) => [row.SecuritiesCompanyCode, row]));

  const merged = [];

  for (const row of twseIndustry) {
    const code = row['公司代號'];
    const quote = twseQuoteMap.get(code);
    const val = twseValMap.get(code);
    if (!quote || !val) continue;
    merged.push({
      market: '上市',
      code,
      name: row['公司名稱'],
      industry: row['產業別'],
      close: cleanNumber(quote.ClosingPrice),
      pe: cleanNumber(val.PEratio),
      pb: cleanNumber(val.PBratio),
      yield: cleanNumber(val.DividendYield),
      epsQ: cleanNumber(row['基本每股盈餘(元)']),
      netIncome: cleanNumber(row['稅後淨利']),
      revenue: cleanNumber(row['營業收入']),
      quarter: `${row['年度']}Q${row['季別']}`,
      priceDate: fromMinguoDate(quote.Date),
      sourceDate: fromMinguoDate(row['出表日期'])
    });
  }

  for (const row of tpexIndustry) {
    const code = row.SecuritiesCompanyCode;
    const quote = tpexQuoteMap.get(code);
    const val = tpexValMap.get(code);
    if (!quote || !val) continue;
    merged.push({
      market: '上櫃',
      code,
      name: row.CompanyName,
      industry: row['產業別'],
      close: cleanNumber(quote.Close),
      pe: cleanNumber(val.PriceEarningRatio),
      pb: cleanNumber(val.PriceBookRatio),
      yield: cleanNumber(val.YieldRatio),
      epsQ: cleanNumber(row['基本每股盈餘']),
      netIncome: cleanNumber(row['稅後淨利']),
      revenue: cleanNumber(row['營業收入']),
      quarter: `${row.Year}Q${row['季別']}`,
      priceDate: fromMinguoDate(quote.Date),
      sourceDate: fromMinguoDate(row.Date)
    });
  }

  return merged
    .filter((row) => row.close > 0 && row.industry && !row.code.startsWith('00'))
    .map((row) => {
      const trailingEpsRef = row.pe > 0 ? row.close / row.pe : 0;
      const annualizedQ = row.epsQ * 4;
      const growthProxy = trailingEpsRef > 0 ? annualizedQ / trailingEpsRef : 0;
      const profitability = Math.log10(Math.max(row.netIncome, 0) + 1);
      const revenueScore = Math.log10(Math.max(row.revenue, 0) + 1);
      const valueBoost = (row.pe > 0 ? 180 / row.pe : 0) + (row.pb > 0 ? 55 / row.pb : 0);
      const incomeBoost = (row.epsQ * 18) + (profitability * 12) + (revenueScore * 3);
      const growthBoost = clamp(growthProxy, 0, 3) * 32;
      const yieldBoost = row.yield * 2;
      const potentialScore = incomeBoost + growthBoost + valueBoost + yieldBoost;
      const lowPriceBoost = row.close > 0 ? Math.min(80 / row.close, 12) : 0;
      const undervalueScore = valueBoost + (profitability * 10) + (row.epsQ * 10) + (row.yield * 2) + (lowPriceBoost * 6);
      return {
        ...row,
        trailingEpsRef,
        annualizedQ,
        growthProxy,
        potentialScore,
        undervalueScore
      };
    });
}

function getPotentialTop20(stocks) {
  return stocks
    .filter((row) => row.epsQ > 0 && row.netIncome > 0 && row.pe > 0 && row.pb > 0)
    .sort((a, b) => b.potentialScore - a.potentialScore)
    .slice(0, 20);
}

function getUndervaluedTop20(stocks) {
  return stocks
    .filter((row) => row.epsQ > 0 && row.netIncome > 0 && row.pe > 0 && row.pb > 0 && row.close <= 120)
    .sort((a, b) => b.undervalueScore - a.undervalueScore)
    .slice(0, 20);
}

function renderOverviewCards(twseSummary, tpexSummary) {
  const sameDate = twseSummary.actualDate === tpexSummary.actualDate;
  const combined = sameDate ? {
    foreignNet: twseSummary.sums.foreignNet + tpexSummary.sums.foreignNet,
    instNet: twseSummary.sums.instNet + tpexSummary.sums.instNet,
    retailBuy: twseSummary.sums.retailBuy + tpexSummary.sums.retailBuy,
    totalVolume: twseSummary.sums.totalVolume + tpexSummary.sums.totalVolume
  } : null;

  $('#overviewCards').innerHTML = `
    <div class="metric-card">
      <div class="metric-label">選取日期</div>
      <div class="metric-value">${escapeHtml(twseSummary.requestedDate)}</div>
      <div class="metric-sub">上市實際載入：${escapeHtml(twseSummary.actualDate)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">上市資料筆數</div>
      <div class="metric-value">${formatNumber(twseSummary.stockCount)}</div>
      <div class="metric-sub">來源：本站 API 代理 TWSE 官方資料</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">上櫃最新日期</div>
      <div class="metric-value">${escapeHtml(tpexSummary.actualDate)}</div>
      <div class="metric-sub">來源：本站 API 代理 TPEx 官方快照</div>
    </div>
    <div class="metric-card ${combined ? '' : 'metric-card-warn'}">
      <div class="metric-label">綜合狀態</div>
      <div class="metric-value">${combined ? '可合併' : '日期未對齊'}</div>
      <div class="metric-sub">${combined ? `合計量能 ${formatNumber(combined.totalVolume)} 股` : '上櫃採官方最新可得日資料'}</div>
    </div>
  `;
}

function renderFlowSummaryTable(twseSummary, tpexSummary) {
  const types = [
    { key: 'foreign', label: '外資' },
    { key: 'trust', label: '投信' },
    { key: 'dealer', label: '自營商' },
    { key: 'inst', label: '三大法人合計' },
    { key: 'retail', label: '散戶推估' }
  ];

  const rows = types.map(({ key, label }) => {
    const t1b = twseSummary.sums[`${key}Buy`] || 0;
    const t1s = twseSummary.sums[`${key}Sell`] || 0;
    const t1n = twseSummary.sums[`${key}Net`] || 0;
    const t2b = tpexSummary.sums[`${key}Buy`] || 0;
    const t2s = tpexSummary.sums[`${key}Sell`] || 0;
    const t2n = tpexSummary.sums[`${key}Net`] || 0;
    const canCombine = twseSummary.actualDate === tpexSummary.actualDate;
    const cb = canCombine ? t1b + t2b : t1b;
    const cs = canCombine ? t1s + t2s : t1s;
    const cn = canCombine ? t1n + t2n : t1n;
    return `
      <tr>
        <td>${label}</td>
        <td>${formatShares(t1b)}</td>
        <td>${formatShares(t1s)}</td>
        <td class="${t1n >= 0 ? 'up' : 'down'}">${formatShares(t1n)}</td>
        <td>${formatShares(t2b)}</td>
        <td>${formatShares(t2s)}</td>
        <td class="${t2n >= 0 ? 'up' : 'down'}">${formatShares(t2n)}</td>
        <td>${formatShares(cb)}</td>
        <td>${formatShares(cs)}</td>
        <td class="${cn >= 0 ? 'up' : 'down'}">${formatShares(cn)}</td>
      </tr>
    `;
  }).join('');

  $('#flowSummaryTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th rowspan="2">類別</th>
          <th colspan="3">上市 ${escapeHtml(twseSummary.actualDate)}</th>
          <th colspan="3">上櫃 ${escapeHtml(tpexSummary.actualDate)}</th>
          <th colspan="3">綜合欄</th>
        </tr>
        <tr>
          <th>買進</th><th>賣出</th><th>買賣超</th>
          <th>買進</th><th>賣出</th><th>買賣超</th>
          <th>買進</th><th>賣出</th><th>買賣超</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderFlowBars(twseSummary, tpexSummary) {
  const categories = [
    { label: '外資', key: 'foreignNet' },
    { label: '投信', key: 'trustNet' },
    { label: '自營商', key: 'dealerNet' },
    { label: '三大法人', key: 'instNet' },
    { label: '散戶推估', key: 'retailBuy' }
  ];
  const values = categories.map((c) => Math.abs((twseSummary.sums[c.key] || 0) + (tpexSummary.actualDate === twseSummary.actualDate ? (tpexSummary.sums[c.key] || 0) : 0)));
  const maxValue = Math.max(...values, 1);
  $('#flowBars').innerHTML = categories.map((c, idx) => {
    const combined = (twseSummary.sums[c.key] || 0) + (tpexSummary.actualDate === twseSummary.actualDate ? (tpexSummary.sums[c.key] || 0) : 0);
    const width = clamp(Math.abs(combined) / maxValue * 100, 0, 100);
    const positive = combined >= 0;
    return `
      <div class="bar-row">
        <div class="bar-label">${c.label}</div>
        <div class="bar-track"><div class="bar-fill ${positive ? 'positive' : 'negative'}" style="width:${width}%"></div></div>
        <div class="bar-value ${positive ? 'up' : 'down'}">${formatNumber(combined)}</div>
      </div>
    `;
  }).join('');
}

function renderPotentialSection(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.industry)) groups.set(item.industry, []);
    groups.get(item.industry).push(item);
  }
  const chips = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([industry, rows]) => `<span class="industry-chip">${escapeHtml(industry)} <b>${rows.length}</b></span>`)
    .join('');

  const tables = [...groups.entries()].map(([industry, rows]) => `
    <div class="industry-block">
      <div class="industry-head">
        <h3>${escapeHtml(industry)}</h3>
        <span>${rows.length} 檔</span>
      </div>
      ${renderRankingTable(rows, 'potential')}
    </div>
  `).join('');

  $('#potentialMeta').innerHTML = chips || '<span class="industry-chip">目前無資料</span>';
  $('#potentialTables').innerHTML = tables;
}

function renderUndervaluedSection(items) {
  $('#undervaluedTable').innerHTML = renderRankingTable(items, 'undervalued');
}

function renderWatchButton(code) {
  const active = isWatched(code);
  return `<button class="mini-btn ${active ? 'active' : ''}" data-watch-code="${escapeHtml(code)}">${active ? '★ 已自選' : '☆ 加自選'}</button>`;
}

function renderRankingTable(items, mode) {
  const scoreKey = mode === 'potential' ? 'potentialScore' : 'undervalueScore';
  const title = mode === 'potential' ? '潛力分數' : '低估分數';
  const rows = items.map((row, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(row.market)}</td>
      <td>${escapeHtml(row.code)}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.industry)}</td>
      <td>${formatMoney(row.close)}</td>
      <td>${formatNumber(row.epsQ, 2)}</td>
      <td>${formatNumber(row.pe, 2)}</td>
      <td>${formatNumber(row.pb, 2)}</td>
      <td>${formatPercent(row.yield, 2)}</td>
      <td>${formatNumber(row.netIncome / 1000, 0)} 千</td>
      <td>${formatNumber(row.growthProxy, 2)}</td>
      <td><b>${formatNumber(row[scoreKey], 2)}</b></td>
      <td>${renderWatchButton(row.code)}</td>
    </tr>
  `).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>市場</th>
            <th>代號</th>
            <th>名稱</th>
            <th>產業</th>
            <th>股價</th>
            <th>最新單季 EPS</th>
            <th>本益比</th>
            <th>股價淨值比</th>
            <th>殖利率</th>
            <th>稅後淨利</th>
            <th>成長代理值</th>
            <th>${title}</th>
            <th>自選</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderMethodology(stocks) {
  const medianPe = median(stocks.map((s) => s.pe).filter((v) => v > 0));
  const medianPb = median(stocks.map((s) => s.pb).filter((v) => v > 0));
  $('#methodology').innerHTML = `
    <div class="note-card">
      <h3>篩選邏輯</h3>
      <ul>
        <li><b>每日買賣量綜合</b>：上市用 TWSE 指定日期資料；上櫃用 TPEx 最新公開快照。散戶為「成交量扣除三大法人買進/賣出量」的推估值。</li>
        <li><b>潛力前 20</b>：以最新單季 EPS、稅後淨利、年化單季 EPS 相對於市價/本益比推估的成長代理值、殖利率、低本益比與低股價淨值比綜合排序。</li>
        <li><b>低估前 20</b>：先保留獲利為正、EPS 為正、股價不高於 120 元的個股，再用低本益比、低股價淨值比、殖利率、獲利能力與低價加權排序。</li>
        <li><b>穩定版部署</b>：前端不再直接打第三方 CORS proxy，而是改由同站 API 代理 TWSE / TPEx 官方資料，降低瀏覽器跨網域失敗率。</li>
      </ul>
    </div>
    <div class="note-card">
      <h3>目前市場中位數參考</h3>
      <ul>
        <li>本益比中位數：約 <b>${formatNumber(medianPe, 2)}</b></li>
        <li>股價淨值比中位數：約 <b>${formatNumber(medianPb, 2)}</b></li>
        <li>若要改成你自己的模型，可以直接改 app.js 內的 <code>potentialScore</code> 與 <code>undervalueScore</code> 權重。</li>
      </ul>
    </div>
  `;
}

function median(list) {
  const arr = [...list].sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function searchStocks(keyword) {
  const q = String(keyword || '').trim().toLowerCase();
  if (!q) return [];
  return state.allStocks
    .filter((row) => {
      const haystack = `${row.code} ${row.name} ${row.industry} ${row.market}`.toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => {
      const aExact = a.code === keyword || a.name === keyword;
      const bExact = b.code === keyword || b.name === keyword;
      if (aExact !== bExact) return aExact ? -1 : 1;
      return b.potentialScore - a.potentialScore;
    })
    .slice(0, 12);
}

function stockSummaryCard(row) {
  return `
    <div class="stock-card">
      <div class="stock-card-head">
        <div>
          <div class="stock-name">${escapeHtml(row.name)}</div>
          <div class="stock-meta">${escapeHtml(row.market)} · ${escapeHtml(row.code)} · ${escapeHtml(row.industry)}</div>
        </div>
        ${renderWatchButton(row.code)}
      </div>
      <div class="stock-grid">
        <div><span>股價</span><b>${formatMoney(row.close)}</b></div>
        <div><span>單季 EPS</span><b>${formatNumber(row.epsQ, 2)}</b></div>
        <div><span>本益比</span><b>${formatNumber(row.pe, 2)}</b></div>
        <div><span>股價淨值比</span><b>${formatNumber(row.pb, 2)}</b></div>
        <div><span>殖利率</span><b>${formatPercent(row.yield, 2)}</b></div>
        <div><span>潛力 / 低估</span><b>${formatNumber(row.potentialScore, 1)} / ${formatNumber(row.undervalueScore, 1)}</b></div>
      </div>
    </div>
  `;
}

function renderSearchResults(keyword) {
  const results = searchStocks(keyword);
  const el = $('#searchResults');
  if (!keyword.trim()) {
    el.innerHTML = '<div class="empty-box">輸入股票代號、名稱或產業，例如：2330、台積電、半導體。</div>';
    return;
  }
  if (!results.length) {
    el.innerHTML = '<div class="empty-box">找不到符合條件的個股。</div>';
    return;
  }
  el.innerHTML = results.map(stockSummaryCard).join('');
}

function renderWatchlist() {
  const rows = getWatchlistStocks().sort((a, b) => b.potentialScore - a.potentialScore);
  const meta = $('#watchlistMeta');
  meta.textContent = `共 ${rows.length} 檔`;
  if (!rows.length) {
    $('#watchlistTable').innerHTML = '<div class="empty-box">目前還沒有自選股，先從上方搜尋或排行榜加入。</div>';
    return;
  }
  $('#watchlistTable').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>市場</th>
            <th>代號</th>
            <th>名稱</th>
            <th>產業</th>
            <th>股價</th>
            <th>單季 EPS</th>
            <th>本益比</th>
            <th>股價淨值比</th>
            <th>殖利率</th>
            <th>潛力分數</th>
            <th>低估分數</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.market)}</td>
              <td>${escapeHtml(row.code)}</td>
              <td>${escapeHtml(row.name)}</td>
              <td>${escapeHtml(row.industry)}</td>
              <td>${formatMoney(row.close)}</td>
              <td>${formatNumber(row.epsQ, 2)}</td>
              <td>${formatNumber(row.pe, 2)}</td>
              <td>${formatNumber(row.pb, 2)}</td>
              <td>${formatPercent(row.yield, 2)}</td>
              <td>${formatNumber(row.potentialScore, 2)}</td>
              <td>${formatNumber(row.undervalueScore, 2)}</td>
              <td>${renderWatchButton(row.code)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function loadDashboard() {
  const requestedDate = $('#dateInput').value || taipeiDateString();
  setLoading(true, '正在下載股價、法人與財報資料…');
  setStatus('資料更新中…', 'loading');

  try {
    const [twseBundle, twseLatestQuotes, twseValuation, twseIndustry, tpexQuotes, tpexValuation, tpexIndustry, tpexInst] = await Promise.all([
      fetchTwseDateBundle(requestedDate),
      fetchJSON(ENDPOINTS.twseLatestQuotes),
      fetchJSON(ENDPOINTS.twseValuation),
      fetchJSON(ENDPOINTS.twseIndustryEps),
      fetchJSON(ENDPOINTS.tpexQuotes),
      fetchJSON(ENDPOINTS.tpexValuation),
      fetchJSON(ENDPOINTS.tpexIndustryEps),
      fetchJSON(ENDPOINTS.tpexInst)
    ]);

    state.datasets.twseLatestQuotes = twseLatestQuotes;
    state.datasets.twseValuation = twseValuation;
    state.datasets.twseIndustry = twseIndustry;
    state.datasets.tpexQuotes = tpexQuotes;
    state.datasets.tpexValuation = tpexValuation;
    state.datasets.tpexIndustry = tpexIndustry;

    const twseSummary = buildTwseSummary(twseBundle);
    const tpexSummary = buildTpexSummary(tpexQuotes, tpexInst);
    state.latestTwseDate = twseSummary.actualDate;
    state.latestTpexDate = tpexSummary.actualDate;
    state.lastLoadedAt = new Date();

    renderOverviewCards(twseSummary, tpexSummary);
    renderFlowSummaryTable(twseSummary, tpexSummary);
    renderFlowBars(twseSummary, tpexSummary);

    const merged = mergeRankData();
    state.allStocks = merged;
    const potential = getPotentialTop20(merged);
    const undervalued = getUndervaluedTop20(merged);
    renderPotentialSection(potential);
    renderUndervaluedSection(undervalued);
    renderMethodology(merged);
    renderSearchResults($('#stockSearch')?.value || '');
    renderWatchlist();

    $('#lastUpdated').textContent = `上次更新：${taipeiTimeString(state.lastLoadedAt)}`;
    setStatus(`載入完成：上市 ${twseSummary.actualDate}、上櫃 ${tpexSummary.actualDate}。`, 'ok');
    if (twseSummary.actualDate !== requestedDate) {
      $('#dateHint').textContent = `你選的是 ${requestedDate}，上市因無資料自動回退到最近交易日 ${twseSummary.actualDate}。`;
    } else {
      $('#dateHint').textContent = '日期切換已套用到上市每日綜合；上櫃與財報排行採官方最新公開快照。';
    }
  } catch (error) {
    console.error(error);
    setStatus(`更新失敗：${error.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

function setupAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  if (!state.autoRefresh) return;
  state.refreshTimer = setInterval(() => {
    loadDashboard();
  }, 180000);
}

function init() {
  loadWatchlist();
  $('#dateInput').value = taipeiDateString();
  $('#refreshBtn').addEventListener('click', () => loadDashboard());
  $('#dateInput').addEventListener('change', () => loadDashboard());
  $('#autoRefresh').addEventListener('change', (e) => {
    state.autoRefresh = e.target.checked;
    setupAutoRefresh();
  });
  $('#stockSearch').addEventListener('input', (e) => renderSearchResults(e.target.value));
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-watch-code]');
    if (!button) return;
    toggleWatchlist(button.dataset.watchCode);
  });
  setupAutoRefresh();
  renderSearchResults('');
  renderWatchlist();
  loadDashboard();
}

document.addEventListener('DOMContentLoaded', init);
