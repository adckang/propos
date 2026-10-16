/**
 * 운영자 신원·숙소 범위 확인용 DB 연결(공용). 여러 API 가 같은 코드를 복사하던 것을 한 곳으로 모았다.
 * 연결은 처음 필요할 때(= 운영자 세션이 실제로 들어왔을 때)만 만들어진다 — 관리자·인증 꺼짐 상태에서는 만들지 않는다.
 */
import pg from 'pg';

let pool = null;
export const getAuthDb = () => (pool ??= new pg.Pool({ connectionString: process.env.POSTGRES_URL }));
/** 테스트 전용 주입 (null 이면 원래대로) */
export function _setAuthDbForTest(fake) { pool = fake ?? null; }
