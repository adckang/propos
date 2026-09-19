/**
 * API query 파라미터 → propertyIds[] 변환.
 * 순수 함수 — 부작용 없음, 테스트 용이.
 *
 * 계약:
 *   - {}                                    → null  (전체 조회)
 *   - { property_id: 'p1' }                 → ['p1']  (하위 호환)
 *   - { property_ids: 'p1,p2' }             → ['p1','p2']
 *   - { property_ids: 'p1', property_id }   → property_ids 우선 (property_id 무시)
 *   - { property_ids: '' }                  → null  (빈 = 전체)
 *   - 공백 trim, 빈 세그먼트 제거
 *
 * @param {object} query - req.query 또는 URL searchParams 객체
 * @returns {string[]|null}
 */
export function parsePropertyIds(query) {
  if (!query) return null;

  // property_ids 키가 있으면 property_id는 무시
  if ('property_ids' in query) {
    const raw = (query.property_ids ?? '').trim();
    if (!raw) return null;
    const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
    return ids.length > 0 ? ids : null;
  }

  // 하위 호환: property_id 단건
  if (query.property_id) {
    return [query.property_id];
  }

  return null;
}
