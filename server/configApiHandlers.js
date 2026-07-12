/**
 * /api/config 핸들러
 * Vercel 환경변수에서 숙소 기본 설정을 읽어 클라이언트에 내려준다.
 * iCal URL은 소스코드에 커밋하지 않고 환경변수로만 관리한다.
 *
 * 환경변수 목록:
 *   PROPOS_PROP_NAME               숙소 이름
 *   PROPOS_PROP_DISTRICT           지역 (시·군·구 제외)
 *   PROPOS_AIRBNB_ICAL_URL         Airbnb iCal URL
 *   PROPOS_GOOGLE_CAL_URL          Google 캘린더 iCal URL
 *   PROPOS_CHECKIN_HOUR            체크인 시각 (기본 15)
 *   PROPOS_CHECKOUT_HOUR           체크아웃 시각 (기본 11)
 *   PROPOS_CLEANING_DURATION_HOURS 청소 시간 시간 단위 (기본 2.5)
 */

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readConfig() {
  const e = process.env;
  const config = {};

  if (e.PROPOS_PROP_NAME)           config.name                  = e.PROPOS_PROP_NAME;
  if (e.PROPOS_PROP_DISTRICT)       config.district              = e.PROPOS_PROP_DISTRICT;
  if (e.PROPOS_AIRBNB_ICAL_URL)     config.airbnbIcalUrl         = e.PROPOS_AIRBNB_ICAL_URL;
  if (e.PROPOS_GOOGLE_CAL_URL)      config.googleCalIcalUrl      = e.PROPOS_GOOGLE_CAL_URL;
  if (e.PROPOS_CHECKIN_HOUR)        config.checkInHour           = Number(e.PROPOS_CHECKIN_HOUR);
  if (e.PROPOS_CHECKOUT_HOUR)       config.checkOutHour          = Number(e.PROPOS_CHECKOUT_HOUR);
  if (e.PROPOS_CLEANING_DURATION_HOURS)
                                    config.cleaningDurationHours = Number(e.PROPOS_CLEANING_DURATION_HOURS);

  return config;
}

export async function handleVercelConfig(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  sendJson(res, 200, readConfig());
}

export async function handleNodeConfig(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/config') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    sendJson(res, 200, readConfig());
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Unknown error' });
  }
}
