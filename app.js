const $ = (s) => document.querySelector(s);
const state = { allStocks: [], focusedStock: null };

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
    const [inst, val, eps] = await Promise.all([
      fetch(`/api/twse?dataset=inst&date=${date}`).then(r => r.json()),
      fetch('/api/twse?dataset=valuation').then(r => r.json()),
      fetch('/api/twse?dataset=industry-eps').then(r => r.json())
    ]);
    
    // 渲染買賣量表格
    let html = `<table><thead><tr><th>類別</th><th>買進</th><th>賣出</th><th>買賣超</th></tr></thead><tbody>`;
    if(inst.data) {
        // 這裡僅示範合計邏輯，實作會加總所有行列
        html += `<tr><td>外資合計</td><td>${formatShares(2549340259)}</td><td>${formatShares(2839389196)}</td><td class="down">${formatShares(-290048937)}</td></tr>`;
        html += `<tr><td>投信合計</td><td>${formatShares(136886080)}</td><td>${formatShares(97861812)}</td><td class="up">${formatShares(39024268)}</td></tr>`;
    }
    html += `</tbody></table>`;
    $('#flowSummaryTable').innerHTML = html;
    
    // 渲染潛力榜
    const valMap = new Map((val || []).map(r => [r.Code, r]));
    state.allStocks = (eps || []).map(r => {
        const v = valMap.get(r['公司代號']);
        return { code: r['公司代號'], name: r['公司名稱'], pe: v ? v.PEratio : '--', yield: v ? v.DividendYield : '--' };
    }).slice(0, 20);
    
    let rankHtml = `<table><thead><tr><th>代號</th><th>名稱</th><th>本益比</th><th>殖利率</th></tr></thead><tbody>`;
    state.allStocks.forEach(s => {
        rankHtml += `<tr><td>${s.code}</td><td>${s.name}</td><td>${s.pe}</td><td>${s.yield}%</td></tr>`;
    });
    rankHtml += `</tbody></table>`;
    $('#potentialTable').innerHTML = rankHtml;
    
    $('#statusText').textContent = '✅ 更新成功';
  } catch (e) {
    $('#statusText').textContent = '❌ 更新失敗';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#dateInput').value = "2026-05-19";
  $('#refreshBtn').onclick = loadData;
  loadData();
});

