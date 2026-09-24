/**
 * propertyNameDomain — 화면에 보여줄 숙소 이름 (순수 함수)
 *
 * 레포트의 지표 상세 목록·청소 배정 목록은 서버가 준 property_id(예: P012)를 갖고 있다.
 * 사용자에게는 리스트 화면(ListView)에 표시되는 숙소 이름(예: 개포 L호)을 보여줘야 하므로
 * 화면이 들고 있는 숙소 목록에서 이름을 찾는다.
 *
 * 우선순위: ① 리스트 화면의 숙소 이름 → ② 서버가 함께 준 이름(fallbackName) → ③ property_id
 */

/**
 * @param {Array<{ id: string, name?: string }>|null|undefined} properties  화면의 숙소 목록
 * @param {string} propertyId
 * @param {string|null} [fallbackName]  서버가 내려준 이름 (목록에 없을 때만 사용)
 * @returns {string}
 */
export function resolvePropertyName(properties, propertyId, fallbackName = null) {
  const found = (properties ?? []).find(p => p?.id === propertyId);
  return found?.name || fallbackName || propertyId;
}
