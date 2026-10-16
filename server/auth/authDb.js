/**
 * 운영자 신원·숙소 범위 확인용 DB 연결(공용). 여러 API 가 같은 코드를 복사하던 것을 한 곳으로 모았다.
 * 연결은 처음 필요할 때(= 운영자 세션이 실제로 들어왔을 때)만 만들어진다 — 관리자·인증 꺼짐 상태에서는 만들지 않는다.
 */
import pg from 'pg';

let pool = null;
export const getAuthDb = () => {
  if (pool) return pool;
  // 접속 주소가 없으면 pg 가 조용히 localhost 로 붙으므로 명시적으로 실패시킨다(호출부는 503 으로 처리)
  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL 이 설정되지 않았어요');
  pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
  // 풀에 쓰이지 않던 연결이 끊기면 'error' 이벤트가 나는데, 리스너가 없으면 프로세스가 죽는다 — 기록만 하고 풀이 다음 요청에 새 연결을 만든다
  pool.on('error', (err) => console.error('[authDb] 유휴 연결 오류:', err.message));
  return pool;
};
/** 테스트 전용 주입 (null 이면 원래대로) */
export function _setAuthDbForTest(fake) { pool = fake ?? null; }
