const { sendJson, fetchRemoteJson, getDateParam } = require('./_utils');

const DATASETS = {
  'latest-quotes': 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
  valuation: 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL',
  'industry-eps': 'https://openapi.twse.com.tw/v1/opendata/t187ap14_L'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const dataset = String(req.query.dataset || '').trim();

  try {
    if (dataset === 'inst') {
      const date = getDateParam(req);
      if (!date) {
        return sendJson(res, 400, { error: '缺少合法 date，格式需為 YYYYMMDD' });
      }
      const data = await fetchRemoteJson(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`);
      return sendJson(res, 200, data, { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' });
    }

    if (dataset === 'mi') {
      const date = getDateParam(req);
      if (!date) {
        return sendJson(res, 400, { error: '缺少合法 date，格式需為 YYYYMMDD' });
      }
      const data = await fetchRemoteJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${date}&type=ALLBUT0999&response=json`);
      return sendJson(res, 200, data, { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' });
    }

    const url = DATASETS[dataset];
    if (!url) {
      return sendJson(res, 400, { error: '未知 dataset' });
    }

    const data = await fetchRemoteJson(url);
    return sendJson(res, 200, data, { 'Cache-Control': 's-maxage=900, stale-while-revalidate=1800' });
  } catch (error) {
    return sendJson(res, error.statusCode || 502, {
      error: 'TWSE 資料代理失敗',
      message: error.message,
      detail: error.body || ''
    });
  }
};
