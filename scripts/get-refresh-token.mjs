/**
 * Google OAuth Refresh Token 발급 스크립트
 * 실행: node scripts/get-refresh-token.mjs           — 캘린더 계정(bnb.paju) → GOOGLE_CALENDAR_REFRESH_TOKEN (토큰을 화면에 출력)
 *       node scripts/get-refresh-token.mjs --gmail   — 예약 메일을 받는 Gmail 계정 → GOOGLE_REFRESH_TOKEN
 *         (계정 선택 화면에서 고른다. 권한은 메일 머리글 읽기(gmail.metadata)만 — 구독·변경 기록·제목·현재 번호에 충분.
 *          토큰은 화면에 출력하지 않고 .env.local 의 GOOGLE_REFRESH_TOKEN 줄에 바로 쓴다. RF-40)
 *
 * 다른 기기(휴대폰 등)에서 승인할 때 — 승인 뒤 localhost 주소로 돌아가 "페이지 없음"이 떠도 주소창에 code 가 있다:
 *       node scripts/get-refresh-token.mjs --gmail --url-only            승인 주소만 출력(브라우저·대기 서버 없음)
 *       node scripts/get-refresh-token.mjs --gmail --code="<돌아온 주소 전체 또는 code 값>"   그 code 로 바로 교환·저장
 *       (code 는 한 번만 쓰이고 몇 분 뒤 만료된다)
 */
import http from "http";
import { exec } from "child_process";
import { readFileSync, writeFileSync } from "fs";
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

const GMAIL_MODE    = process.argv.includes("--gmail");
const URL_ONLY      = process.argv.includes("--url-only");
const CODE_ARG      = process.argv.find(a => a.startsWith("--code="))?.slice("--code=".length) ?? null;
const CLIENT_ID     = envVars.GOOGLE_CLIENT_ID     || process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = envVars.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = "http://localhost:9876/callback";
const SCOPES        = (GMAIL_MODE
  ? ["https://www.googleapis.com/auth/gmail.metadata"]
  : ["https://www.googleapis.com/auth/calendar"]
).join(" ");

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
  // select_account: 브라우저에 이미 로그인된 다른 계정으로 자동 진행되지 않고 계정 선택 화면을 강제로 띄움
  `&prompt=${encodeURIComponent("select_account consent")}` +
  (GMAIL_MODE ? "" : `&login_hint=${encodeURIComponent("bnb.paju@gmail.com")}`);

/** .env.local 의 KEY= 줄을 바꾸거나(없으면 끝에 추가) — 다른 줄은 그대로 */
function saveToEnvLocal(key, value) {
  let text = "";
  try { text = readFileSync(envPath, "utf8"); } catch {}
  const lines = text.split("\n");
  const at = lines.findIndex(line => line.startsWith(`${key}=`));
  if (at >= 0) lines[at] = `${key}=${value}`;
  else lines.splice(lines.length && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
  writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
}

if (URL_ONLY) {
  console.log("\n아래 주소를 승인할 기기의 브라우저에서 여세요. 승인 뒤 localhost 주소로 돌아가 '페이지 없음'이 떠도 정상 — 그 주소 전체를 --code= 로 넘기세요:\n");
  console.log(authUrl + "\n");
  process.exit(0);
}

/** code(또는 code 가 든 주소) → refresh_token 교환 후 저장·안내 */
async function exchangeAndSave(code) {
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

  if (data.refresh_token && GMAIL_MODE) {
    saveToEnvLocal("GOOGLE_REFRESH_TOKEN", data.refresh_token);
    console.log("\n✅ Gmail Refresh Token 발급 완료 — .env.local 의 GOOGLE_REFRESH_TOKEN 줄에 저장했습니다(화면에는 출력하지 않음).");
    console.log(`   권한 범위: ${data.scope}`);
    console.log("   다음: Vercel 환경변수 GOOGLE_REFRESH_TOKEN(Production)을 이 값으로 바꾸고 재배포하세요.");
  } else if (data.refresh_token) {
    console.log("\n✅ Refresh Token 발급 완료!\n");
    console.log("⚠️ 이 토큰은 bnb.paju@gmail.com(캘린더용)입니다.");
    console.log("아래 값을 Vercel 환경변수 GOOGLE_CALENDAR_REFRESH_TOKEN에 붙여넣으세요 (GOOGLE_REFRESH_TOKEN 아님!):\n");
    console.log(data.refresh_token);
    console.log("\n그리고 .env.local의 GOOGLE_CALENDAR_REFRESH_TOKEN도 교체하세요.");
  } else {
    console.error("\n❌ 토큰 교환 실패:", JSON.stringify(data, null, 2));
  }
}

if (CODE_ARG) {
  let code = CODE_ARG.trim();
  try { const u = new URL(code); code = u.searchParams.get("code") ?? ""; } catch { /* code 값만 넘긴 경우 */ }
  if (!code) { console.error("❌ code 를 찾지 못했어요 — 돌아온 주소 전체나 code= 뒤의 값을 넘기세요"); process.exit(1); }
  await exchangeAndSave(code);
  process.exit(0);
}

console.log("\n🚀 브라우저를 여는 중...");
console.log("↳ 자동으로 열린 창이 원치 않는 계정으로 들어가면, 이 URL을 복사해서 시크릿창(쪽)에 직접 붙여넣어 보세요:");
console.log(authUrl + "\n");
exec(`open "${authUrl}"`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:9876");
  const code = url.searchParams.get("code");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!code) { res.end("code 없음"); return; }

  res.end("<h2>인증 완료! 터미널을 확인하세요.</h2>");
  server.close();
  await exchangeAndSave(code);
  process.exit(0);
});

server.listen(9876, () => {
  console.log(GMAIL_MODE
    ? "브라우저 계정 선택 화면에서 에어비앤비 예약 메일을 받는 Gmail 계정을 고르고 권한을 허용해주세요..."
    : "브라우저에서 bnb.paju@gmail.com으로 로그인하고 권한을 허용해주세요...");
});
