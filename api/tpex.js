const { sendJson, fetchRemoteJson } = require('./_utils');

const DATASETS = {
  quotes: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes',
  valuation: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis',
  'industry-eps': 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O',
  institutional: 'https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const dataset = String(req.query.dataset || '').trim();
  const url = DATASETS[dataset];
  if (!url) {
    return sendJson(res, 400, { error: '未知 dataset' });
  }

  try {
    const data = await fetchRemoteJson(url);
    return sendJson(res, 200, data, { 'Cache-Control': 's-maxage=900, stale-while-revalidate=1800' });
  } catch (error) {
    return sendJson(res, error.statusCode || 502, {
      error: 'TPEx 資料代理失敗',
      message: error.message,
      detail: error.body || ''
    });
  }
};
