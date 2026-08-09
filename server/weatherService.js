/**
 * 날씨 조회 공통 로직 — Vite 미들웨어(dev)와 api/weather.js(Vercel) 양쪽에서 import
 */

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const KMA_NCST_URL = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst';

function latLonToKmaGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5.0;
  const SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0;
  const XO = 43, YO = 136;
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD, slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD, olat = OLAT * DEGRAD;
  const sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) /
    Math.log(Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5));
  const sf = Math.pow(Math.tan(Math.PI * 0.25 + slat1 * 0.5), sn) * Math.cos(slat1) / sn;
  const ro = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + olat * 0.5), sn);
  const ra = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5), sn);
  let theta = (lon - OLON) * DEGRAD * sn;
  if (theta > Math.PI)  theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

function kmaBaseTime() {
  const now = new Date(Date.now() + 9 * 3600000);
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  let hour = now.getUTCHours();
  if (now.getUTCMinutes() < 10) hour = (hour - 1 + 24) % 24;
  return { base_date: date, base_time: String(hour).padStart(2, '0') + '00' };
}

function ptyToWmoCode(pty) {
  switch (parseInt(pty ?? '0')) {
    case 1: return 61;
    case 2: return 71;
    case 3: return 73;
    case 4: return 80;
    default: return 1;
  }
}

export async function fetchWeather(district, kmaApiKey) {
  const normalized = district.trim().replace(/[시군구읍면동리]$/, '').trim();

  const geoRes = await fetch(
    `${GEOCODING_URL}?name=${encodeURIComponent(normalized)}&count=1&language=ko&format=json`
  );
  const geoData = await geoRes.json();
  const loc = geoData.results?.[0];
  if (!loc) return { error: `지역을 찾을 수 없음: ${district}`, status: 404 };

  if (!kmaApiKey) {
    const params = new URLSearchParams({
      latitude: loc.latitude, longitude: loc.longitude,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code',
      timezone: 'Asia/Seoul', forecast_days: '1',
    });
    const r = await fetch(`${OPEN_METEO_URL}?${params}`);
    const d = await r.json();
    const cur = d.current;
    if (!cur) return { error: 'Open-Meteo 응답 없음', status: 502 };
    return {
      data: {
        locationName: loc.name,
        temp:        cur.temperature_2m,
        feelsLike:   cur.apparent_temperature,
        humidity:    cur.relative_humidity_2m,
        weatherCode: cur.weather_code,
        source: 'open-meteo',
      },
    };
  }

  const { nx, ny } = latLonToKmaGrid(loc.latitude, loc.longitude);
  const { base_date, base_time } = kmaBaseTime();

  const params = new URLSearchParams({
    serviceKey: kmaApiKey,
    pageNo: '1', numOfRows: '10', dataType: 'JSON',
    base_date, base_time,
    nx: String(nx), ny: String(ny),
  });

  const r = await fetch(`${KMA_NCST_URL}?${params}`);
  const json = await r.json();
  const items = json.response?.body?.items?.item ?? [];
  const get = (cat) => items.find(i => i.category === cat)?.obsrValue;

  const temp     = parseFloat(get('T1H') ?? '');
  const humidity = parseInt(get('REH') ?? '');
  const pty      = get('PTY') ?? '0';

  if (isNaN(temp)) {
    console.error('[weatherService] KMA 응답 이상:', JSON.stringify(json).slice(0, 300));
    return { error: '기상청 데이터 없음', status: 502 };
  }

  return {
    data: {
      locationName: loc.name,
      temp,
      humidity:    isNaN(humidity) ? null : humidity,
      weatherCode: ptyToWmoCode(pty),
      source: 'kma',
    },
  };
}
