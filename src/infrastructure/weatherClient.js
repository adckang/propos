const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL  = 'https://api.open-meteo.com/v1/forecast';

const WEATHER_META = [
  { max:  0, emoji: '☀️',  desc: '맑음' },
  { max:  1, emoji: '🌤️', desc: '대체로 맑음' },
  { max:  2, emoji: '⛅',  desc: '구름 조금' },
  { max:  3, emoji: '☁️',  desc: '흐림' },
  { max: 48, emoji: '🌫️', desc: '안개' },
  { max: 57, emoji: '🌦️', desc: '이슬비' },
  { max: 67, emoji: '🌧️', desc: '비' },
  { max: 77, emoji: '🌨️', desc: '눈' },
  { max: 82, emoji: '🌦️', desc: '소나기' },
  { max: 86, emoji: '🌨️', desc: '눈소나기' },
  { max: 99, emoji: '⛈️', desc: '천둥번개' },
];

export function weatherMeta(code) {
  return WEATHER_META.find(m => code <= m.max) ?? { emoji: '🌡️', desc: '알 수 없음' };
}

function normalizeDistrict(name) {
  // Open-Meteo는 "파주시" → 인식 못함, "파주" → 인식함
  return name.trim().replace(/[시군구읍면동리]$/, '').trim();
}

export async function getWeatherByDistrict(district) {
  if (!district) return null;
  const normalized = normalizeDistrict(district);

  const geoRes = await fetch(
    `${GEOCODING_URL}?name=${encodeURIComponent(normalized)}&count=1&language=ko&format=json`
  );
  const geoData = await geoRes.json();
  const loc = geoData.results?.[0];
  if (!loc) return null;

  const params = new URLSearchParams({
    latitude:     loc.latitude,
    longitude:    loc.longitude,
    current:      'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code',
    timezone:     'Asia/Seoul',
    forecast_days: '1',
  });
  const weatherRes = await fetch(`${FORECAST_URL}?${params}`);
  const weatherData = await weatherRes.json();
  const cur = weatherData.current;
  if (!cur) return null;

  return {
    locationName: loc.name,
    temp:         cur.temperature_2m,
    feelsLike:    cur.apparent_temperature,
    humidity:     cur.relative_humidity_2m,
    weatherCode:  cur.weather_code,
  };
}
