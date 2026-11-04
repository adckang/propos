/**
 * usePropertySelection — 레포트용 숙소 선택(체크박스) 상태. 리스트뷰·대시보드가 같은 규칙을 쓴다.
 *
 *   - 처음엔 전체 선택. 숙소 목록이 바뀌면 처음 보는 숙소만 자동 선택하고, 사용자가 해제한 숙소는 되살리지 않는다.
 *   - 전체를 골라도 화면에 보이는 숙소 id 를 명시적으로 넘긴다(DB 의 레거시·테스트 숙소가 집계에 섞이지 않게).
 *
 * @param {Array<{ id: string }>} properties
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { deriveSelectionScope, syncSelectionWithProperties, toggleAllSelection } from '../domain/selectionScopeDomain.js';

export function usePropertySelection(properties) {
  const [selectedRooms, setSelectedRooms] = useState(() => new Set(properties.map(property => property.id)));
  const knownIdsRef = useRef(new Set(properties.map(property => property.id)));
  useEffect(() => {
    const currentIds = properties.map(property => property.id);
    const previousKnown = knownIdsRef.current;
    knownIdsRef.current = new Set(currentIds);
    setSelectedRooms(previous => syncSelectionWithProperties(previous, previousKnown, currentIds));
  }, [properties]);

  const allIds = properties.map(property => property.id);
  const scope = deriveSelectionScope(selectedRooms, allIds);
  const noSelection = scope.mode === 'none';
  const allSelected = scope.mode === 'all';
  const statsPropertyIds = noSelection ? [] : scope.selectedIds;
  // 매 렌더 새 배열이 되지 않게 — 받는 쪽(PeriodReport)의 예약 집계 memo 가 선택이 바뀔 때만 다시 돈다
  const scopedProperties = useMemo(
    () => (allSelected ? properties : properties.filter(property => selectedRooms.has(property.id))),
    [allSelected, properties, selectedRooms],
  );
  const scopeBadge = { allSelected, selectedCount: scope.selectedCount, totalCount: scope.totalCount };
  return {
    selectedRooms,
    setSelectedRooms,
    scope,
    noSelection,
    allSelected,
    /** 통계·실패 상세 목록 공통 숙소 범위 */
    statsPropertyIds,
    /** 레포트 대상 숙소 객체 */
    scopedProperties,
    /** 선택 숙소 수 표시 */
    scopeBadge,
    /** PeriodReport 에 그대로 펼쳐 넘기는 레포트 범위 — 손으로 하나씩 옮기다 빠뜨리는 일이 없게 한 묶음으로 */
    reportScope: { scopedProperties, propertyIds: statsPropertyIds, noSelection, scopeBadge },
    toggleAll: () => setSelectedRooms(toggleAllSelection(scope.mode, allIds)),
  };
}
