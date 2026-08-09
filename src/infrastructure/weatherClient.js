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

export async function getWeatherByDistrict(district) {
  if (!district) return null;
  try {
    const res = await fetch(`/api/weather?district=${encodeURIComponent(district)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
