// ── propStateStore.js ──────────────────────────────────────────
// 화면 전환 간 숙소 상태를 유지하는 모듈 레벨 싱글턴 스토어.
// React state가 아니므로 화면 재마운트 시에도 값이 보존됩니다.
// S04에서 처리한 결과가 CC 재진입 시 반영되는 것이 주된 용도입니다.

const store = new Map();

// propId(숫자)와 { status, automationHealth, ... } 형태로 override 저장
export function setOverride(propId, fields) {
  const current = store.get(propId) || {};
  store.set(propId, { ...current, ...fields });
}

// ALL_PROPS 배열에 스토어 오버라이드를 병합하여 반환
export function augmentProps(props) {
  if (store.size === 0) return props;
  return props.map(p => {
    const override = store.get(p.id);
    return override ? { ...p, ...override } : p;
  });
}

export function clearStore() {
  store.clear();
}
