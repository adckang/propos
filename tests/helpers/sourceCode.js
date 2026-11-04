/**
 * sourceCode — 소스 파일 읽기 + 컴포넌트 안의 useMemo 계산을 떼어내 실제로 실행하는 공용 도우미.
 * 여러 테스트가 각자 복사해 쓰던 read()/AST 평가기를 한 곳으로 모았다.
 *
 * evaluateMemo: `const <name> = useMemo(() => {...}, deps)` 의 콜백을 소스에서 찾아, 주어진 변수들로 실행한다.
 * 정규식으로 "이 글자가 있다"를 보는 대신 그 계산의 결과를 단언할 수 있다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function readSource(rel) {
  return readFileSync(path.resolve(ROOT, rel), 'utf8');
}

function findMemoCallback(source, name) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let callback = null;
  const visit = node => {
    if (!node || typeof node !== 'object' || callback) return;
    if (node.type === 'VariableDeclarator' && node.id?.name === name && node.init?.type === 'CallExpression') {
      callback = node.init.arguments[0];
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  return callback;
}

/**
 * @param {string} rel   컴포넌트 파일
 * @param {string} name  useMemo 결과를 받는 변수 이름
 * @param {Record<string, unknown>} scope  콜백이 참조하는 바깥 변수들
 */
export function evaluateMemo(rel, name, scope) {
  const source = readSource(rel);
  const callback = findMemoCallback(source, name);
  if (!callback) throw new Error(`${rel} 에서 ${name} = useMemo(...) 를 찾지 못함`);
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `return (${source.slice(callback.start, callback.end)})();`)(...names.map(key => scope[key]));
}

/**
 * 컴포넌트 파일 안의 export 되지 않은 최상위 함수(`function <name>(...)`)를 꺼내 실행 가능한 함수로 돌려준다.
 * @param {string} rel
 * @param {string} name
 * @param {Record<string, unknown>} [scope]  그 함수가 참조하는 바깥 변수들
 */
export function extractFunction(rel, name, scope = {}) {
  const source = readSource(rel);
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const node = ast.program.body.find(item => item.type === 'FunctionDeclaration' && item.id?.name === name);
  if (!node) throw new Error(`${rel} 에서 function ${name} 을 찾지 못함`);
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `return (${source.slice(node.start, node.end)});`)(...names.map(key => scope[key]));
}
