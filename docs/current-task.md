# Current Task
> 세션 시작 시 읽는다. 세션 끝날 때 업데이트한다.
> 업데이트: 2026-07-11 | 마지막: Claude

## 목표
캘린더 싱크 브라우저 실동작 확인.
`npm run dev` → http://localhost:5173 → Room State Machine → ⚙ → URL 입력 → 저장 → **● LIVE HH:MM** 표시 확인.

## 수정 가능 파일
```
src/application/calendarSyncService.js
src/domain/room-state/icalParser.js
src/data/roomStateMockData.js
src/components/v2/RoomStateApp.jsx
src/components/v2/DashboardView.jsx
src/components/v2/PropertyListView.jsx
src/components/v2/PropertyDetailView.jsx
server/icalProxy.js  server/icalApiHandlers.js  api/ical.js
tests/unit/s11~s13.*.test.js
docs/current-task.md
```

## 수정 금지
`src/components/App.jsx` `src/components/v1/*` `docs/scenarios.yaml` `.claude/rules/decisions.md` `dist/`

## Decided
| 결정 | 내용 |
|------|------|
| iCal 프록시 | `/api/ical?url=...` 단일 경로. 외부 CORS 프록시 금지. |
| 설정 저장 | localStorage `propos_calendar_sync`. URL 소스코드 커밋 금지. |
| 싱크 주기 | 마운트 1회 + 15분 인터벌 |
| 데이터 합산 | `[liveProperty, ...PROPERTIES_MOCK]` 순서 고정 |

## Undecided (구현 전 물어볼 것)
- 싱크 실패 시 자동 재시도 여부
- 두 번째 숙소 P002 목업 추가 여부

## 싱크 실패 시 디버그 순서
1. DevTools → Network → `/api/ical?url=...` 상태 코드 확인
2. 200인데 싱크 실패 → 응답에 `BEGIN:VCALENDAR` 있는지 확인
3. 404 → dev 서버 미실행
4. 502 → `server/icalProxy.js` curl 폴백 로그 확인

## 다음 작업
- [x] Google Calendar 청소 배정 현황 UI 통합 (buildLiveProperty + PropertyDetailView + DashboardView)
- [ ] 브라우저 싱크 실동작 확인
- [ ] 미커밋 파일 전체 커밋
- [ ] Vercel 환경변수 주입 후 실배포 확인

---

## 핸드오프 (에이전트 교체 시)
```
[넘기는 쪽]  git commit → 이 파일 업데이트 → "커밋 완료" 보고
[받는 쪽]    git log --oneline -3 → git diff HEAD~1 → 이 파일 읽기
```
> **완료 여부의 정본은 git log다. 이 파일이 낡아 있어도 커밋이 있으면 완료된 것.**
> 이 파일은 *다음 목표*를 기록하고, git은 *완료된 것*을 기록한다.

범위 밖 파일 건드리지 않는다. Decided 재논의 안 한다. 추가 개선은 제안만.
