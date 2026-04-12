import path from "node:path";

import { parse } from "@babel/parser";

import {
  loadScenarioRegistry,
  readRepoFile,
  repoFileExists,
} from "./scenario-registry.mjs";

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function parseModule(relativePath, sourceType = "module") {
  const source = readRepoFile(relativePath);
  return parse(source, {
    sourceType,
    plugins: ["jsx"],
  });
}

function getExportedFunctionNames(relativePath) {
  const ast = parseModule(relativePath);
  const exported = new Set();

  for (const node of ast.program.body) {
    if (node.type !== "ExportNamedDeclaration") continue;

    if (node.declaration?.type === "FunctionDeclaration" && node.declaration.id?.name) {
      exported.add(node.declaration.id.name);
    }

    if (node.declaration?.type === "VariableDeclaration") {
      for (const declaration of node.declaration.declarations) {
        if (declaration.id?.type === "Identifier") {
          exported.add(declaration.id.name);
        }
      }
    }

    for (const specifier of node.specifiers || []) {
      if (specifier.exported?.type === "Identifier") {
        exported.add(specifier.exported.name);
      }
    }
  }

  return exported;
}

function componentImportsTarget(relativePath, targetImportPath) {
  const ast = parseModule(relativePath);
  return ast.program.body.some(node => (
    node.type === "ImportDeclaration" &&
    node.source?.value === targetImportPath
  ));
}

function toImportPath(fromFile, targetFile) {
  let relativePath = path.relative(path.dirname(fromFile), targetFile).replace(/\\/g, "/");
  if (!relativePath.startsWith(".")) {
    relativePath = `./${relativePath}`;
  }
  return relativePath;
}

const registry = loadScenarioRegistry();
const appSource = readRepoFile("src/components/App.jsx");
const smokeSource = readRepoFile("tests/smoke/app.smoke.spec.js");
const errors = [];

for (const page of registry.system_pages) {
  assert(repoFileExists(page.component), `[verify:scenarios] Missing component: ${page.component}`, errors);
  assert(appSource.includes(page.screen_key), `[verify:scenarios] App router is missing screen key: ${page.screen_key}`, errors);
  assert(appSource.includes(page.title), `[verify:scenarios] Landing page is missing system page title: ${page.title}`, errors);
}

for (const scenario of registry.scenarios) {
  const diagramSource = readRepoFile(scenario.diagram);
  const testSource = readRepoFile(scenario.functional_test);
  const componentBase = path.basename(scenario.component, path.extname(scenario.component));
  const expectedServiceImport = toImportPath(scenario.component, scenario.service);
  const serviceExports = getExportedFunctionNames(scenario.service);

  // 파일 존재 확인
  assert(repoFileExists(scenario.component), `[verify:scenarios] Missing component: ${scenario.component}`, errors);
  assert(repoFileExists(scenario.diagram), `[verify:scenarios] Missing diagram: ${scenario.diagram}`, errors);
  assert(repoFileExists(scenario.functional_test), `[verify:scenarios] Missing functional test: ${scenario.functional_test}`, errors);
  assert(repoFileExists(scenario.service), `[verify:scenarios] Missing service: ${scenario.service}`, errors);

  // 서비스 엔트리 함수 실제 존재 확인 (소스 ↔ 레지스트리 시맨틱 연결)
  assert(
    serviceExports.has(scenario.entry_function),
    `[verify:scenarios] Service ${scenario.service} is missing entry function: ${scenario.entry_function}`,
    errors
  );

  // 도메인 모듈 존재 확인
  for (const modulePath of scenario.domain_modules) {
    assert(repoFileExists(modulePath), `[verify:scenarios] Missing domain module: ${modulePath}`, errors);
  }

  // App 라우터 확인
  assert(appSource.includes(scenario.landing_label), `[verify:scenarios] Landing page is missing stage label: ${scenario.landing_label}`, errors);
  assert(appSource.includes(scenario.use_case_id), `[verify:scenarios] Landing page is missing use-case badge: ${scenario.use_case_id}`, errors);

  // 컴포넌트 ↔ 서비스 연결 확인
  assert(
    componentImportsTarget(scenario.component, expectedServiceImport),
    `[verify:scenarios] Component ${scenario.component} is not linked to service import: ${expectedServiceImport}`,
    errors
  );

  // 다이어그램 ↔ 소스 연결 확인
  assert(diagramSource.includes(scenario.id), `[verify:scenarios] Diagram ${scenario.diagram} is missing scenario id ${scenario.id}`, errors);
  assert(diagramSource.includes(componentBase), `[verify:scenarios] Diagram ${scenario.diagram} is missing component name ${componentBase}`, errors);
  assert(diagramSource.includes(scenario.entry_function), `[verify:scenarios] Diagram ${scenario.diagram} is missing entry function: ${scenario.entry_function}`, errors);

  // 테스트 커버리지 확인
  assert(
    testSource.includes(scenario.id) || testSource.includes(scenario.use_case_id),
    `[verify:scenarios] Functional test ${scenario.functional_test} is missing ${scenario.id}/${scenario.use_case_id}`,
    errors
  );

  // 스모크 테스트 커버리지 확인
  assert(
    smokeSource.includes(scenario.landing_label) || smokeSource.includes(scenario.title),
    `[verify:scenarios] Smoke test is missing navigation coverage for ${scenario.id} (${scenario.landing_label})`,
    errors
  );
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log("[verify:scenarios] All checks passed: registry, diagrams, tests, service entry functions.");
