import { useEffect, useRef, useState } from 'react';
import { toggleAllSelection } from '../../../domain/selectionScopeDomain.js';

function CheckMark({ state }) {
  return (
    <span style={{
      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
      border: `1.5px solid ${state === 'none' ? '#cbd5e1' : state === 'partial' ? '#94a3b8' : '#22c55e'}`,
      background: state === 'all' ? '#22c55e' : state === 'partial' ? '#f1f5f9' : '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {state === 'all' && <span style={{ color: '#fff', fontSize: 11, fontWeight: 800, lineHeight: 1 }}>✓</span>}
      {state === 'partial' && <span style={{ width: 8, height: 2, borderRadius: 1, background: '#64748b' }} />}
    </span>
  );
}

export default function PropertyMultiSelectDropdown({ properties, selectedRooms, setSelectedRooms, scope, isMobile = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const allIds = properties.map(property => property.id);

  useEffect(() => {
    function closeOnOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const buttonLabel = scope.mode === 'all'
    ? `ALL · ${scope.totalCount}`
    : scope.mode === 'none'
      ? '선택 없음'
      : `${scope.selectedCount}개 선택`;

  return (
    <div ref={rootRef} style={{ position: 'relative', padding: isMobile ? '8px 12px' : '10px 20px', background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
      <button
        data-testid="property-multi-select-toggle"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: isMobile ? '8px 10px' : '9px 12px',
          border: '1.5px solid #cbd5e1', borderRadius: 8,
          background: '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <CheckMark state={scope.mode} />
        <span style={{ flex: 1, minWidth: 0, fontSize: isMobile ? 12 : 13, fontWeight: 700, color: '#334155' }}>
          {buttonLabel}
        </span>
        <span style={{ color: '#64748b', fontSize: 12, transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>

      {open && (
        <div data-testid="property-multi-select-menu" style={{
          position: 'absolute', left: isMobile ? 12 : 20, right: isMobile ? 12 : 20, top: 'calc(100% - 5px)',
          maxHeight: 300, overflowY: 'auto', zIndex: 30,
          background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8,
          boxShadow: '0 10px 24px rgba(15,23,42,0.14)',
        }}>
          <button
            onClick={() => setSelectedRooms(toggleAllSelection(scope.mode, allIds))}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 9,
              padding: '10px 12px', border: 'none', borderBottom: '1px solid #e2e8f0',
              background: '#f8fafc', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            }}
          >
            <CheckMark state={scope.mode} />
            <span style={{ fontSize: 12, fontWeight: 800, color: '#334155' }}>ALL</span>
          </button>
          {properties.map(property => {
            const checked = selectedRooms.has(property.id);
            return (
              <button
                key={property.id}
                onClick={() => setSelectedRooms(previous => {
                  const next = new Set(previous);
                  if (next.has(property.id)) next.delete(property.id);
                  else next.add(property.id);
                  return next;
                })}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                  padding: '9px 12px', border: 'none', borderBottom: '1px solid #f1f5f9',
                  background: checked ? '#f0fdf4' : '#fff', cursor: 'pointer',
                  fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                <CheckMark state={checked ? 'all' : 'none'} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {property.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
