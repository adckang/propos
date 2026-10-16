/**
 * HA 영역(= 숙소 이름, D-016)의 기기 목록을 묻는 템플릿. 화면(haBrowserClient)과 서버(운영자 요청 검사, haScope)가
 * 반드시 바이트 단위로 같은 문자열을 써야 한다 — 서버가 "정확히 이 문자열만" 허용하기 때문에, 한쪽만 바꾸면
 * 운영자 화면에서만 기기가 사라진다. 그래서 한 곳에서 만들어 둘 다 가져다 쓴다.
 */
export const areaEntitiesTemplate = (areaName) => `{{ area_entities('${areaName}') | list | tojson }}`;

/** 영역 이름(= 숙소 이름)에 허용하지 않는 문자 — 템플릿 문자열에 그대로 들어가므로 따옴표·역슬래시·중괄호·줄바꿈은 안 된다.
 *  숙소 이름 규칙(validatePropertyName)과 운영자 HA 검사(isSafeAreaName)가 같은 정규식을 쓴다. */
export const AREA_NAME_FORBIDDEN = /['"\\{}\n\r]/;
