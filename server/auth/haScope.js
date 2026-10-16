/**
 * 운영자의 스마트홈(HA) 요청을 "자기 숙소의 HA 영역 안"으로 제한한다 (D-035).
 *
 * 숙소 이름 = HA 영역 이름(D-016). 운영자는 자기 숙소 영역에 속한 기기(entity)만 읽고 제어할 수 있다.
 * 관리자는 호출부에서 이 검사를 건너뛴다(제한 없음). 순수 함수 — HA 조회는 getAreaEntityIds 로 주입한다.
 *
 * 막는 것: 아무 질문이나 던지는 template, 모든 기기를 돌려주는 all-states, 영역 밖 기기의 상태·이력·제어,
 *          area_id/device_id/floor_id/label_id 같은 서비스 대상(entity_id 로 풀리지 않아 검사를 우회한다),
 *          기기와 무관한 서비스 도메인(notify·script·shell_command 등) 호출.
 */

// 운영자가 제어할 수 없게 막는 기기 도메인. 사용자 결정(D-035)으로 "자기 숙소의 모든 기기 제어"를 허용해 비워 둔다.
// 도어락 같은 민감 기기를 막으려면 여기에 'lock', 'alarm_control_panel' 등을 추가한다.
export const OPERATOR_BLOCKED_DOMAINS = Object.freeze([]);

const SAFE_IDENT = /^[a-z0-9_]+$/;
const ISO_START = /^\d{4}-\d{2}-\d{2}[T ][0-9:.+\-Z]{1,30}$/; // 이력 조회 시작 시각(ISO). 그 밖의 값은 쿼리 조작에 쓰일 수 있어 거절
// 숙소 영역 안의 기기에 쓰는 공통 서비스는 켜기/끄기/토글뿐 — reload_config_entry·update_entity 등은 연동 전체에 영향
const HOMEASSISTANT_SERVICES = new Set(['turn_on', 'turn_off', 'toggle']);
// 도메인은 글자로 시작해야 한다 — 숫자('1.5')를 기기 참조로 오인하지 않게
const ENTITY_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
// 영역·기기·층·라벨 단위 대상은 entity 검사를 우회한다. 특히 영역 전체 켜기/끄기(area_id)는 화면의 **자동화**(퇴실 감지 시 전체 끄기,
// 입실 준비 시 전체 켜기)가 쓰는 호출인데, 열려 있는 아무 운영자 브라우저 탭이 실행하게 되고 OPERATOR_BLOCKED_DOMAINS 도 우회한다 → 운영자에겐 거절.
const FORBIDDEN_TARGET_KEYS = ['area_id', 'device_id', 'floor_id', 'label_id'];
const MAX_ENTITIES = 200;          // 서비스 호출 한 번에 지정할 수 있는 기기 수
const MAX_STATES_REQUEST = 5000;   // 상태 조회 요청 크기의 상식적 상한 — 영역 전체 기기를 한 번에 묻는 화면이 있어 200 으로 막으면 안 된다(실제 제한은 "전부 내 영역 기기")

import { areaEntitiesTemplate, AREA_NAME_FORBIDDEN } from '../../src/domain/haAreaTemplate.js';
export { areaEntitiesTemplate }; // 화면과 서버가 같은 문자열을 쓰도록 한 곳에서 만든다

/** 영역 이름이 템플릿에 안전하게 들어갈 수 있는가 */
export const isSafeAreaName = (name) => typeof name === 'string' && name.length > 0 && name.length <= 60 && !AREA_NAME_FORBIDDEN.test(name);

const deny = (error) => ({ ok: false, status: 403, error, code: 'FORBIDDEN' });
const allow = { ok: true };

/** 운영자 범위의 모든 숙소 영역에 속한 entity id 집합 (영역 조회는 병렬, 실패하면 예외 — 빈 목록으로 오해하지 않는다) */
export async function allowedEntitySet(scope, getAreaEntityIds) {
  const ids = (scope?.propertyIds ?? []).filter(isSafeAreaName);
  const lists = await Promise.all(ids.map((id) => getAreaEntityIds(id)));
  return new Set(lists.flat().filter((x) => typeof x === 'string'));
}

/**
 * data 안 어디에든 "다른 기기를 가리키는 값"이 있으면 모두 허용 기기여야 한다 (group_members 같은 필드로 우회 방지).
 * HA 는 값을 정규화해서 받아들이므로(소문자화, 쉼표로 이은 목록) 검사도 같은 정규화를 한 뒤 비교하고, 객체의 **키**도 본다.
 */
function foreignEntityRef(value, allowed, depth = 0) {
  if (depth > 6) return true; // 너무 깊은 구조는 거절
  if (typeof value === 'string') {
    return value.split(',').some((part) => { const t = part.trim().toLowerCase(); return ENTITY_ID.test(t) && !allowed.has(t); });
  }
  if (Array.isArray(value)) return value.some((v) => foreignEntityRef(v, allowed, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => foreignEntityRef(k, allowed, depth + 1) || foreignEntityRef(v, allowed, depth + 1));
  }
  return false;
}

/**
 * @param {{ action: string, query?: object, body?: object, scope: {propertyIds: string[]}, getAreaEntityIds: (area: string) => Promise<string[]> }} input
 * @returns {Promise<{ok: true} | {ok: false, status: number, error: string, code: string}>}
 */
export async function authorizeOperatorHa({ action, query, body, scope, getAreaEntityIds }) {
  query = query && typeof query === 'object' ? query : {};
  body = body && typeof body === 'object' && !Array.isArray(body) ? body : {}; // JSON 본문이 null·배열이어도 안전하게
  if (!scope || scope.all || !Array.isArray(scope.propertyIds)) return deny('관리자만 할 수 있어요'); // 운영자 범위가 아니면 거절(관리자는 호출부에서 우회)
  if (!scope.propertyIds.length) return deny('배정된 숙소가 없어요');

  if (action === 'template') {
    // 숙소 영역 기기 목록을 묻는 정해진 템플릿만 — 문자열이 정확히 일치해야 한다(그 밖의 질문은 전부 거절)
    const ok = typeof body.template === 'string' && scope.propertyIds.some((id) => isSafeAreaName(id) && body.template === areaEntitiesTemplate(id));
    return ok ? allow : deny('허용되지 않은 질의예요');
  }

  if (action === 'all-states') return deny('관리자만 할 수 있어요');

  // 허용 기기 집합은 필요한 동작에서만 계산한다(영역 전체 켜기/끄기는 필요 없음). 같은 요청 안에서는 한 번만.
  let allowedPromise = null;
  const getAllowed = () => (allowedPromise ??= allowedEntitySet(scope, getAreaEntityIds));

  if (action === 'state' || action === 'history') {
    if (typeof query.entityId !== 'string') return deny('이 숙소의 기기가 아니에요');
    if (action === 'history' && !(typeof query.start === 'string' && ISO_START.test(query.start))) return deny('잘못된 요청이에요');
    return (await getAllowed()).has(query.entityId) ? allow : deny('이 숙소의 기기가 아니에요');
  }

  if (action === 'states') {
    const ids = body.entityIds;
    if (!Array.isArray(ids) || ids.length > MAX_STATES_REQUEST) return deny('잘못된 요청이에요');
    const allowed = await getAllowed();
    return ids.every((id) => typeof id === 'string' && allowed.has(id)) ? allow : deny('이 숙소의 기기가 아니에요');
  }

  if (action === 'service') {
    const { domain, service, data } = body;
    if (typeof domain !== 'string' || typeof service !== 'string' || !SAFE_IDENT.test(domain) || !SAFE_IDENT.test(service)) return deny('잘못된 요청이에요');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return deny('제어할 기기를 지정해야 해요');
    // 그 밖의 영역·기기 단위 지정(device_id 등)은 entity 검사를 우회하므로 거절
    if (FORBIDDEN_TARGET_KEYS.some((k) => k in data)) return deny('기기를 하나씩 지정해야 해요');
    const ids = Array.isArray(data.entity_id) ? data.entity_id : [data.entity_id];
    if (!ids.length || ids.length > MAX_ENTITIES) return deny('제어할 기기를 지정해야 해요');
    if (domain === 'homeassistant' && !HOMEASSISTANT_SERVICES.has(service)) return deny('이 서비스는 관리자만 쓸 수 있어요');
    const allowed = await getAllowed();
    if (foreignEntityRef(data, allowed)) return deny('이 숙소 밖의 기기를 가리키는 값이 들어 있어요');
    for (const id of ids) {
      if (typeof id !== 'string' || !ENTITY_ID.test(id)) return deny('잘못된 기기 지정이에요'); // 'all' 같은 값 포함
      if (!allowed.has(id)) return deny('이 숙소의 기기가 아니에요');
      const entityDomain = id.split('.')[0];
      if (OPERATOR_BLOCKED_DOMAINS.includes(entityDomain)) return deny('이 종류의 기기는 관리자만 제어할 수 있어요');
      // 서비스 도메인은 기기 자신의 도메인이거나 homeassistant(공통 켜기/끄기)만 — notify·script 등 무관한 서비스 차단
      if (domain !== entityDomain && domain !== 'homeassistant') return deny('이 기기에 쓸 수 없는 서비스예요');
    }
    return allow;
  }

  return deny('허용되지 않은 요청이에요');
}
