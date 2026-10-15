/**
 * DB 카탈로그 → ERD 모델 → PlantUML / draw.io
 *
 * 순수 함수만 둔다 (DB 접속은 scripts/generate-erd.mjs). 입력은 pg 카탈로그에서 뽑은 평범한 행 배열이라
 * 테스트에서 픽스처로 그대로 검증할 수 있다.
 *
 * 원칙: 구조(칼럼·키·FK·유니크·카디널리티)는 전부 카탈로그에서 규칙으로 도출한다.
 *       사람이 정하는 것은 scripts/erd.config.json 의 설명·색·배치뿐이다.
 */

const ACTION = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * @param {{columns: object[], constraints: object[], uniqueIndexes: object[]}} catalog
 * @param {object} config  scripts/erd.config.json
 */
export function buildModel(catalog, config) {
  const tables = new Map();
  const warnings = [];
  const wanted = config.tables ?? {};

  for (const c of catalog.columns) {
    if (!tables.has(c.table)) tables.set(c.table, { name: c.table, cols: [], pk: [], uniques: [], checks: [], fks: [] });
    tables.get(c.table).cols.push({ name: c.column, type: c.type, notNull: !!c.not_null, default: c.default ?? null });
  }

  for (const k of catalog.constraints) {
    const t = tables.get(k.table);
    if (!t) continue;
    if (k.contype === 'p') t.pk = k.cols;
    else if (k.contype === 'u') t.uniques.push({ name: k.name, cols: k.cols });
    else if (k.contype === 'c') t.checks.push({ name: k.name, def: k.def });
    else if (k.contype === 'f') {
      t.fks.push({
        name: k.name, table: k.table, cols: k.cols, refTable: k.ref_table, refCols: k.ref_cols,
        onUpdate: ACTION[k.on_update] ?? k.on_update, onDelete: ACTION[k.on_delete] ?? k.on_delete,
        deferrable: !!k.deferrable, validated: !!k.validated, logical: false,
      });
    }
  }
  for (const u of catalog.uniqueIndexes ?? []) {
    tables.get(u.table)?.uniques.push({ name: u.name, cols: u.cols });
  }

  // FK 가 없는 논리 관계 (사람이 config 에 적은 것). 진짜 FK 가 생기면 무시하고 경고한다.
  for (const r of config.logicalRelations ?? []) {
    const child = tables.get(r.to);
    if (!child || !tables.has(r.from)) { warnings.push(`논리 관계 대상 테이블 없음: ${r.from} → ${r.to}`); continue; }
    const dup = child.fks.some((f) => !f.logical && f.refTable === r.from && sameSet(f.cols, r.toCols));
    if (dup) { warnings.push(`논리 관계 ${r.from} → ${r.to} 는 이제 실제 FK 가 있음 — config 에서 지워도 됨`); continue; }
    child.fks.push({
      name: `(논리) ${r.to}.${r.toCols.join('+')}`, table: r.to, cols: r.toCols, refTable: r.from, refCols: r.fromCols,
      onUpdate: null, onDelete: null, deferrable: false, validated: true, logical: true, note: r.note,
    });
  }

  // config 에 없는 테이블/있는데 DB 에 없는 테이블 → 경고 (그림과 DB 가 어긋난 신호)
  for (const name of tables.keys()) if (!wanted[name]) warnings.push(`config 에 없는 테이블: ${name} (임시 위치에 배치됨)`);
  for (const name of Object.keys(wanted)) if (!tables.has(name)) warnings.push(`config 에만 있고 DB 에 없는 테이블: ${name}`);

  let extraCol = 0;
  for (const t of tables.values()) {
    t.cfg = wanted[t.name] ?? { label: '', color: '#ffffff', col: extraCol++, row: 9 };
    t.keyCols = new Set([...t.pk, ...t.fks.flatMap((f) => f.cols), ...t.uniques.flatMap((u) => u.cols)]);
  }

  // 연결 테이블 자동 판정: 서로 다른 부모를 가리키는 FK 2개 이상 + 그 FK 칼럼들을 합친 유니크가 있음
  for (const t of tables.values()) {
    const real = t.fks.filter((f) => !f.logical);
    const parents = new Set(real.map((f) => f.refTable));
    const fkCols = [...new Set(real.flatMap((f) => f.cols))];
    t.isJunction = parents.size >= 2 && [...t.uniques.map((u) => u.cols), t.pk].some((cols) => cols.length && sameSet(cols, fkCols));
  }

  return { tables, warnings };
}

/** FK 하나의 카디널리티를 규칙으로 도출 */
export function cardinality(model, fk) {
  const child = model.tables.get(fk.table);
  const nullable = fk.cols.some((c) => !child.cols.find((x) => x.name === c)?.notNull);
  const childUnique = sameSet(fk.cols, child.pk) || child.uniques.some((u) => sameSet(u.cols, fk.cols));
  return {
    parentSym: nullable ? '|o' : '||', // 자식이 부모를 반드시 가지는가
    childSym: childUnique ? 'o|' : 'o{', // 부모 하나에 자식이 최대 1개인가(1:1) 여러 개인가
    optional: nullable, oneToOne: childUnique,
  };
}

function fkLabel(model, fk, detail = 'full') {
  const card = cardinality(model, fk);
  const lines = [];
  lines.push(fk.cols.length > 1 ? `복합 FK (${fk.cols.join(', ')})` : `${fk.cols[0]}`);
  lines.push(card.oneToOne ? `${card.optional ? '0..1' : '1'} : 1` : `${card.optional ? '0..1' : '1'} : N`);
  if (fk.logical) lines.push(fk.note ?? 'FK 없음');
  else if (detail === 'full' || fk.onDelete !== 'NO ACTION' || fk.deferrable || !fk.validated) {
    // 요약에서는 관계 모양이 핵심이므로 규칙 문구는 예외(삭제 연쇄·지연·미검증)일 때만
    const rules = detail === 'full' ? [`ON UPDATE ${fk.onUpdate}`] : [];
    if (fk.onDelete !== 'NO ACTION') rules.push(`ON DELETE ${fk.onDelete}`);
    if (fk.deferrable) rules.push('DEFERRABLE');
    if (!fk.validated) rules.push('NOT VALID');
    lines.push(rules.join(' · '));
  }
  return lines;
}

function direction(a, b) {
  if (b.cfg.row > a.cfg.row) return 'down';
  if (b.cfg.row < a.cfg.row) return 'up';
  return b.cfg.col >= a.cfg.col ? 'right' : 'left';
}

function visibleCols(t, detail) {
  if (detail === 'full') return t.cols;
  return t.cols.filter((c) => t.keyCols.has(c.name));
}

function colMarks(t, c) {
  const marks = [];
  if (t.pk.includes(c.name)) marks.push('● PK');
  for (const f of t.fks) if (f.cols.includes(c.name)) marks.push(`◆ FK → ${f.refTable}${f.logical ? ' (논리)' : ''}`);
  for (const u of t.uniques) if (u.cols.includes(c.name)) marks.push(u.cols.length > 1 ? '◇ UQ(복합)' : '◇ UQ');
  return [...new Set(marks)];
}

const colLine = (t, c) => `${c.name} : ${c.type}${c.notNull ? '' : ' (null)'}`;

const header = '자동 생성 파일 — 직접 고치지 말 것. 구조는 DB 카탈로그에서, 설명·색·배치는 scripts/erd.config.json 에서. 재생성: npm run erd';

// ───────────────────────── PlantUML ─────────────────────────
export function renderPlantUml(model, { detail = 'summary', title = 'PROPOS DB 관계도' } = {}) {
  const out = [];
  out.push(`@startuml PROPOS_DB_ERD_${detail}`);
  out.push(`' ${header}`);
  out.push(`' 읽는 방향: 위 → 아래 (부모 → 자식), 왼쪽 → 오른쪽`);
  out.push('', '!pragma layout smetana', 'top to bottom direction', '');
  out.push('skinparam defaultFontName "DM Sans"', 'skinparam backgroundColor #f0f4f8', 'skinparam shadowing false',
    'skinparam linetype ortho', 'skinparam ArrowColor #475569', 'skinparam ArrowThickness 1.4', 'skinparam roundCorner 8',
    'skinparam entity {', '  BackgroundColor #ffffff', '  BorderColor #94a3b8', '  FontColor #1e293b', '}',
    'skinparam note {', '  BackgroundColor #fefce8', '  BorderColor #d97706', '  FontColor #78350f', '}', '');
  out.push(`title ${title}${detail === 'full' ? ' (전체 칼럼)' : ' (요약)'}\\n<size:12><color:#475569>● PK 기본키   ◆ FK 외래키   ◇ UQ 유니크   (복합키는 * 가 여러 개)</color></size>`, '');

  const sorted = [...model.tables.values()].sort((a, b) => a.cfg.row - b.cfg.row || a.cfg.col - b.cfg.col || a.name.localeCompare(b.name));
  for (const t of sorted) {
    const sub = t.isJunction ? `${t.cfg.label} · 연결 테이블` : t.cfg.label;
    out.push(`entity "${t.name}${sub ? `\\n<size:11>${sub}</size>` : ''}" as ${t.name} ${t.cfg.color} {`);
    const cols = visibleCols(t, detail);
    const pkCols = cols.filter((c) => t.pk.includes(c.name));
    const rest = cols.filter((c) => !t.pk.includes(c.name));
    for (const c of pkCols) out.push(`  * ${colLine(t, c)}  ${colMarks(t, c).join('  ')}`);
    if (pkCols.length && rest.length) out.push('  --');
    for (const c of rest) out.push(`  ${colLine(t, c)}${colMarks(t, c).length ? '  ' + colMarks(t, c).join('  ') : ''}`);
    if (detail !== 'full') {
      const hidden = t.cols.length - cols.length;
      if (hidden > 0) out.push(`  … 그 밖의 칼럼 ${hidden}개 (전체 버전 참고)`);
    }
    const compositeUq = t.uniques.filter((u) => u.cols.length > 1);
    if (compositeUq.length || (detail === 'full' && t.checks.length)) {
      out.push('  ..');
      for (const u of compositeUq) out.push(`  ◇ UQ (${u.cols.join(', ')})`);
      if (detail === 'full') for (const k of t.checks) out.push(`  ${k.def.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
    out.push('}', '');
  }

  for (const t of sorted) {
    for (const fk of t.fks) {
      const parent = model.tables.get(fk.refTable);
      const card = cardinality(model, fk);
      const dir = direction(parent, t);
      const line = fk.logical ? `.${dir}.` : `-${dir}-`;
      out.push(`${fk.refTable} ${card.parentSym}${line}${card.childSym} ${t.name} : "${fkLabel(model, fk, detail).join('\\n')}"`);
    }
  }
  out.push('');

  for (const t of sorted.filter((x) => x.isJunction)) {
    out.push(`note right of ${t.name}`, '  **연결 테이블 (N:M 해소)**',
      `  ${t.fks.filter((f) => !f.logical).map((f) => f.refTable).join(' ↔ ')} 는 원래 다대다.`,
      `  UQ (${t.uniques.find((u) => u.cols.length > 1)?.cols.join(', ') ?? t.pk.join(', ')}) 로 중복을 차단.`, 'end note', '');
  }

  out.push('legend right', '  |= 선 |= 의미 |', '  | 실선 | DB 가 강제하는 FK |', '  | 점선 | FK 없음 (코드가 지키는 논리 관계) |',
    '  | 두 줄(‖) | 정확히 1 |', '  | o | 0 또는 1 (선택) |', '  | 까마귀발 | 0개 이상 (여러 개) |', 'endlegend', '', '@enduml', '');
  return out.join('\n');
}

// ───────────────────────── draw.io ─────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textWidth = (s) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 13 : 7.2), 0);

export function renderDrawio(model, { detail = 'summary' } = {}) {
  const sorted = [...model.tables.values()].sort((a, b) => a.cfg.row - b.cfg.row || a.cfg.col - b.cfg.col || a.name.localeCompare(b.name));
  const box = new Map();
  for (const t of sorted) {
    const cols = visibleCols(t, detail);
    const lines = cols.map((c) => `${t.pk.includes(c.name) ? '* ' : ''}${colLine(t, c)}  ${colMarks(t, c).join(' ')}`);
    const width = Math.max(220, Math.ceil(Math.max(textWidth(t.name), textWidth(t.cfg.label) + 40, ...lines.map(textWidth)) + 28));
    const height = 54 + lines.length * 18 + (detail !== 'full' && t.cols.length > cols.length ? 18 : 0);
    box.set(t.name, { cols, lines, width, height });
  }
  // 배치: row/col 격자. 행 높이 = 그 행의 가장 큰 상자, 열 너비 = 그 열의 가장 큰 상자
  const colW = {}; const rowH = {};
  for (const t of sorted) {
    const b = box.get(t.name);
    colW[t.cfg.col] = Math.max(colW[t.cfg.col] ?? 0, b.width);
    rowH[t.cfg.row] = Math.max(rowH[t.cfg.row] ?? 0, b.height);
  }
  const GAP_X = 90; const GAP_Y = 110;
  const xOf = (c) => 40 + Object.keys(colW).map(Number).filter((k) => k < c).reduce((s, k) => s + colW[k] + GAP_X, 0);
  const yOf = (r) => 40 + Object.keys(rowH).map(Number).filter((k) => k < r).reduce((s, k) => s + rowH[k] + GAP_Y, 0);

  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const idOf = (name) => `t_${name}`;
  for (const t of sorted) {
    const b = box.get(t.name);
    const html = `<b>${esc(t.name)}</b>${t.cfg.label ? `<br/><i><font style="font-size:11px">${esc(t.cfg.label)}${t.isJunction ? ' · 연결 테이블' : ''}</font></i>` : ''}<hr/>` +
      b.cols.map((c, i) => (t.pk.includes(c.name) ? `<b>${esc(b.lines[i])}</b>` : esc(b.lines[i]))).join('<br/>') +
      (detail !== 'full' && t.cols.length > b.cols.length ? `<br/><font color="#64748b">… 그 밖의 칼럼 ${t.cols.length - b.cols.length}개</font>` : '');
    const style = `rounded=1;arcSize=3;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingTop=6;fillColor=${t.cfg.color};strokeColor=#94a3b8;fontColor=#1e293b;fontSize=12;`;
    cells.push(`<mxCell id="${idOf(t.name)}" value="${esc(html)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${xOf(t.cfg.col)}" y="${yOf(t.cfg.row)}" width="${b.width}" height="${b.height}" as="geometry"/></mxCell>`);
  }
  const arrow = { '||': 'ERmandOne', '|o': 'ERzeroToOne', 'o{': 'ERzeroToMany', 'o|': 'ERzeroToOne' };
  let n = 0;
  for (const t of sorted) {
    for (const fk of t.fks) {
      const card = cardinality(model, fk);
      const style = `edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;startArrow=${arrow[card.parentSym]};endArrow=${arrow[card.childSym]};startFill=0;endFill=0;strokeColor=#475569;strokeWidth=1.5;fontSize=10;fontColor=#334155;labelBackgroundColor=#f0f4f8;${fk.logical ? 'dashed=1;' : ''}`;
      cells.push(`<mxCell id="e_${n++}" value="${esc(fkLabel(model, fk, detail).join('\n'))}" style="${style}" edge="1" parent="1" source="${idOf(fk.refTable)}" target="${idOf(t.name)}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${esc(header)} -->\n<mxfile host="app.diagrams.net"><diagram name="PROPOS ERD (${detail === 'full' ? '전체' : '요약'})" id="propos-erd-${detail}"><mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" background="#f0f4f8"><root>${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`;
}

// ───────────────────────── 카탈로그 조회 SQL ─────────────────────────
const colsOf = (rel, arr) => `ARRAY(SELECT a.attname::text FROM unnest(${arr}) WITH ORDINALITY AS ku(attnum, ord) JOIN pg_attribute a ON a.attrelid = ${rel} AND a.attnum = ku.attnum ORDER BY ku.ord)`;

export const CATALOG_SQL = {
  columns: `
    SELECT c.relname AS "table", a.attname AS "column", format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS not_null, pg_get_expr(d.adbin, d.adrelid) AS "default", a.attnum
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = $1
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE c.relkind = 'r'
     ORDER BY c.relname, a.attnum`,
  constraints: `
    SELECT cl.relname AS "table", k.conname AS name, k.contype,
           ${colsOf('k.conrelid', 'k.conkey')} AS cols,
           rc.relname AS ref_table,
           CASE WHEN k.contype = 'f' THEN ${colsOf('k.confrelid', 'k.confkey')} END AS ref_cols,
           k.confupdtype AS on_update, k.confdeltype AS on_delete,
           k.condeferrable AS deferrable, k.convalidated AS validated,
           CASE WHEN k.contype = 'c' THEN pg_get_constraintdef(k.oid) END AS def
      FROM pg_constraint k
      JOIN pg_class cl ON cl.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = $1
      LEFT JOIN pg_class rc ON rc.oid = k.confrelid
     WHERE k.contype IN ('p','u','f','c')
     ORDER BY cl.relname, k.conname`,
  uniqueIndexes: `
    SELECT t.relname AS "table", i.relname AS name,
           ${colsOf('x.indrelid', 'x.indkey::int2[]')} AS cols
      FROM pg_index x
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = $1
     WHERE x.indisunique AND NOT x.indisprimary AND x.indpred IS NULL AND 0 <> ALL (x.indkey::int2[])
       AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = x.indexrelid)
     ORDER BY t.relname, i.relname`,
};
