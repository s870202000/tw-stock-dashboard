const DEFAULT_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*'
};

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  Object.entries({ ...DEFAULT_HEADERS, ...extraHeaders }).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.status(statusCode).send(JSON.stringify(payload));
}

async function fetchRemoteJson(url) {
  const upstream = await fetch(url, {
    headers: {
      'user-agent': 'tw-stock-dashboard/1.0'
    }
  });

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '');
    const error = new Error(`上游資料失敗：${upstream.status}`);
    error.statusCode = upstream.status;
    error.body = body.slice(0, 400);
    throw error;
  }

  return upstream.json();
}

function getDateParam(req) {
  const raw = String(req.query.date || '').trim();
  if (!/^\d{8}$/.test(raw)) {
    return null;
  }
  return raw;
}

module.exports = {
  sendJson,
  fetchRemoteJson,
  getDateParam
};
