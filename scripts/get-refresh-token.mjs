/**
 * Google OAuth Refresh Token 발급 스크립트
 * 실행: node scripts/get-refresh-token.mjs
 */
import http from "http";
import { exec } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// .env.local에서 환경변수 읽기
const envPath = join(dirname(fileURLToPath(import.meta.url)), "../.env.local");
const envVars = {};
try {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) envVars[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
} catch {}

const CLIENT_ID     = envVars.GOOGLE_CLIENT_ID     || process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = envVars.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = "http://localhost:9876/callback";
const SCOPES        = [
  "https://www.googleapis.com/auth/calendar",
  "https://mail.google.com/",
].join(" ");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ GOOGLE_CLIENT_ID 또는 GOOGLE_CLIENT_SECRET 없음");
  process.exit(1);
}

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth` +
  `?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log("\n🚀 브라우저를 여는 중...");
exec(`open "${authUrl}"`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:9876");
  const code = url.searchParams.get("code");
  if (!code) { res.end("code 없음"); return; }

  res.end("<h2>인증 완료! 터미널을 확인하세요.</h2>");
  server.close();

  // code → refresh_token 교환
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    "authorization_code",
    }),
  });
  const data = await tokenRes.json();

  if (data.refresh_token) {
    console.log("\n✅ Refresh Token 발급 완료!\n");
    console.log("아래 값을 Vercel 환경변수 GOOGLE_REFRESH_TOKEN에 붙여넣으세요:\n");
    console.log(data.refresh_token);
    console.log("\n그리고 .env.local의 GOOGLE_REFRESH_TOKEN도 교체하세요.");
  } else {
    console.error("\n❌ 토큰 교환 실패:", JSON.stringify(data, null, 2));
  }
  process.exit(0);
});

server.listen(9876, () => {
  console.log("브라우저에서 bnb.paju@gmail.com으로 로그인하고 권한을 허용해주세요...");
});
