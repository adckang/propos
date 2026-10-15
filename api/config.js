import { handleVercelConfig } from '../server/configApiHandlers.js';
import { guardOperator, handleAuthRoute } from '../server/auth/operatorAuth.js';
import { DATA_PROFILE, resolveServerDataProfile } from '../src/config/dataProfile.js';

export default async function handler(req, res) {
  if (resolveServerDataProfile(process.env) === DATA_PROFILE.DEMO) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ dataProfile: 'demo' }));
    return;
  }
  // D-033: /api/auth/{me,login,logout} 은 vercel.json rewrite 로 여기(?action=)에 온다 — 함수 12개 한도 때문에 별도 파일을 만들지 않음
  const action = req.query?.action;
  if (action) return handleAuthRoute(action, req, res);
  // 설정에는 iCal URL 이 들어 있을 수 있어 운영자만 (로그인 화면 자체는 /api/auth/me 로 판단)
  if (!guardOperator(req, res)) return;
  return handleVercelConfig(req, res);
}
