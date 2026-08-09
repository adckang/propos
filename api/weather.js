import { fetchWeather } from '../server/weatherService.js';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const district = req.query?.district;
  if (!district) { sendJson(res, 400, { error: 'district required' }); return; }

  try {
    const result = await fetchWeather(district, process.env.PROPOS_KMA_API_KEY ?? null);
    if (result.error) { sendJson(res, result.status ?? 500, { error: result.error }); return; }
    sendJson(res, 200, result.data);
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}
