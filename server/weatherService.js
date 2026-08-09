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
  // KST = UTC+9. 기상청 초단기실황은 매시 10분 이후 갱신.
  const nowMs = Date.now() + 9 * 3600000;
  const now   = new Date(nowMs);
  let hour = now.getUTCHours();
  let dateMs = nowMs;

  if (now.getUTCMinutes() < 10) {
    hour -= 1;
    // 자정(00:00~00:09)이면 날짜도 하루 전으로
    if (hour < 0) {
      hour = 23;
      dateMs -= 24 * 3600000;
    }
  }

  const date = new Date(dateMs).toISOString().slice(0, 10).replaceAll('-', '');
  return { base_date: date, base_time: String(hour).padStart(2, '0') + '00' };
}

function ptyToWmoCode(pty) {
  switch (parseInt(pty ?? '0')) {
    case 1: return 61; // 비
    case 2: return 71; // 비/눈
    case 3: return 73; // 눈
    case 4: return 80; // 소나기
    default: return 1; // 강수 없음 (SKY 정보 없어 맑음/흐림 구분 불가 → 대체로 맑음)
  }
}

async function fetchOpenMeteo(loc) {
  const params = new URLSearchParams({
    latitude: loc.latitude, longitude: loc.longitude,
    current:  'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code',
    timezone: 'Asia/Seoul', forecast_days: '1',
  });
  const r = await fetch(`${OPEN_METEO_URL}?${params}`);
  const d = await r.json();
  const cur = d.current;
  if (cur?.temperature_2m == null) return null;
  return {
    locationName: loc.name,
    temp:        cur.temperature_2m,
    feelsLike:   cur.apparent_temperature ?? null,
    humidity:    cur.relative_humidity_2m ?? null,
    weatherCode: cur.weather_code ?? 1,
    source:      'open-meteo',
  };
}

export async function fetchWeather(district, kmaApiKey) {
  const normalized = district.trim().replace(/[시군구읍면동리]$/, '').trim();

  // 지역명 → 위경도 지오코딩
  let loc;
  try {
    const geoRes = await fetch(
      `${GEOCODING_URL}?name=${encodeURIComponent(normalized)}&count=1&language=ko&format=json`
    );
    const geoData = await geoRes.json();
    loc = geoData.results?.[0];
  } catch (err) {
    return { error: `지오코딩 실패: ${err.message}`, status: 502 };
  }
  if (!loc) return { error: `지역을 찾을 수 없음: ${district}`, status: 404 };

  // KMA API 키 없으면 Open-Meteo 직접 호출
  if (!kmaApiKey) {
    const data = await fetchOpenMeteo(loc);
    if (!data) return { error: 'Open-Meteo 응답 없음', status: 502 };
    return { data };
  }

  // ── 기상청 초단기실황 ──────────────────────────────────────────────────────────
  const { nx, ny } = latLonToKmaGrid(loc.latitude, loc.longitude);
  const { base_date, base_time } = kmaBaseTime();

  const params = new URLSearchParams({
    serviceKey: kmaApiKey,
    pageNo: '1', numOfRows: '10', dataType: 'JSON',
    base_date, base_time,
    nx: String(nx), ny: String(ny),
  });

  try {
    const r    = await fetch(`${KMA_NCST_URL}?${params}`);
    const json = await r.json();
    const items = json.response?.body?.items?.item ?? [];
    const get   = (cat) => items.find(i => i.category === cat)?.obsrValue;

    const temp     = Number.parseFloat(get('T1H') ?? '');
    const humidity = Number.parseInt(get('REH') ?? '');
    const pty      = get('PTY') ?? '0';

    if (!Number.isNaN(temp)) {
      return {
        data: {
          locationName: loc.name,
          temp,
          humidity:    Number.isNaN(humidity) ? null : humidity,
          weatherCode: ptyToWmoCode(pty),
          source:      'kma',
        },
      };
    }

    // KMA 데이터 없음 → Open-Meteo 폴백
    console.warn('[weatherService] KMA 데이터 없음, Open-Meteo로 폴백. base_date=%s base_time=%s', base_date, base_time);
  } catch (err) {
    console.warn('[weatherService] KMA 호출 실패, Open-Meteo로 폴백:', err.message);
  }

  // Open-Meteo 폴백
  const fallback = await fetchOpenMeteo(loc);
  if (!fallback) return { error: '날씨 데이터를 가져올 수 없음', status: 502 };
  return { data: { ...fallback, source: 'open-meteo-fallback' } };
}
