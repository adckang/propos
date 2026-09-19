/**
 * selectionScopeDomain — ListView 숙소 체크박스 선택 → 레포트 집계 범위 (순수 함수)
 *
 * 범위(scope) 계약:
 *   mode 'none'    → propertyIds []      (집계 안 함 — "숙소를 선택해주세요")
 *   mode 'partial' → propertyIds [...]   (선택 숙소만, allIds 순서로 정렬)
 *   mode 'all'     → propertyIds null    (필터 없음 = 전체)
 *
 * allIds에 없는 선택값(사라진 숙소)은 무시한다 — 개수 비교로 전체 여부를 판단하지 않는다.
 */

/**
 * @param {Set<string>|string[]} selectedIds
 * @param {string[]} allIds
 * @returns {{ mode: 'none'|'partial'|'all', propertyIds: string[]|null,
 *             selectedIds: string[], selectedCount: number, totalCount: number }}
 */
export function deriveSelectionScope(selectedIds, allIds) {
  const all = allIds ?? [];
  const sel = selectedIds instanceof Set ? selectedIds : new Set(selectedIds ?? []);
  const inScope = all.filter(id => sel.has(id));

  let mode;
  if (inScope.length === 0)            mode = 'none';
  else if (inScope.length === all.length) mode = 'all';
  else                                 mode = 'partial';

  const propertyIds = mode === 'none' ? [] : mode === 'all' ? null : inScope;
  return { mode, propertyIds, selectedIds: inScope, selectedCount: inScope.length, totalCount: all.length };
}

/**
 * ALL 체크박스 토글 — 전체 선택 상태면 전체 해제, 그 외(일부/없음)는 전체 선택.
 * @param {'none'|'partial'|'all'} mode
 * @param {string[]} allIds
 * @returns {Set<string>}
 */
export function toggleAllSelection(mode, allIds) {
  return mode === 'all' ? new Set() : new Set(allIds ?? []);
}

/**
 * 숙소 목록이 바뀔 때(iCal 동기화 후 실숙소 추가 등) 선택 상태를 맞춘다.
 *   - 사라진 숙소: 선택에서 제거
 *   - 이번에 처음 보는 숙소: 자동 선택
 *   - 이미 알고 있던 숙소: 사용자의 선택/해제를 그대로 유지 (해제한 숙소를 되살리지 않는다)
 * 변경이 없으면 입력 Set 그대로 반환 (React 불필요 재렌더 방지).
 *
 * @param {Set<string>} selected   현재 선택
 * @param {Set<string>} known      이전에 관측한 숙소 ID 전체
 * @param {string[]}    currentIds 현재 숙소 ID 목록
 * @returns {Set<string>}
 */
export function syncSelectionWithProperties(selected, known, currentIds) {
  const current = new Set(currentIds ?? []);
  const next = new Set();
  for (const id of selected) if (current.has(id)) next.add(id);
  for (const id of current)  if (!known.has(id))  next.add(id);

  const unchanged = next.size === selected.size && [...next].every(id => selected.has(id));
  return unchanged ? selected : next;
}
