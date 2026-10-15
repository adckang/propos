import { handleVercelConfig } from '../server/configApiHandlers.js';
import { Pool } from 'pg';
import { guardAdmin, handleAuthRoute } from '../server/auth/operatorAuth.js';

// 운영자 계정 조회용 (로그인·세션 확인). DB 가 없으면 관리자 로그인만 동작한다.
let pool = null;
const getDb = () => (pool ??= process.env.POSTGRES_URL ? new Pool({ connectionString: process.env.POSTGRES_URL }) : null);
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
  if (action) return handleAuthRoute(action, req, res, process.env, Date.now(), getDb());
  // 설정에는 iCal URL 이 들어 있을 수 있어 운영자만 (로그인 화면 자체는 /api/auth/me 로 판단)
  if (!guardAdmin(req, res)) return;
  return handleVercelConfig(req, res);
}
