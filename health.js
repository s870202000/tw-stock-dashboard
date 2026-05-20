const { sendJson } = require('./_utils');

module.exports = async function handler(req, res) {
  return sendJson(res, 200, {
    ok: true,
    service: 'tw-stock-dashboard',
    now: new Date().toISOString(),
    routes: ['/api/twse', '/api/tpex']
  }, { 'Cache-Control': 'no-store' });
};
