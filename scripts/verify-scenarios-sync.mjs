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

function walkAst(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      walkAst(item, visit);
    }
    return;
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      walkAst(value, visit);
    }
  }
}

function getComponentServiceLink(relativePath, targetImportPath, entryFunction) {
  const ast = parseModule(relativePath);
  const binding = {
    importsTarget: false,
    defaultLocal: null,
    namedLocals: new Set(),
    entryLinked: false,
  };

  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration" || node.source?.value !== targetImportPath) {
      continue;
    }

    binding.importsTarget = true;

    for (const specifier of node.specifiers || []) {
      if (specifier.type === "ImportDefaultSpecifier") {
        binding.defaultLocal = specifier.local?.name || null;
      }

      if (
        specifier.type === "ImportSpecifier" &&
        specifier.imported?.type === "Identifier" &&
        specifier.imported.name === entryFunction &&
        specifier.local?.name
      ) {
        binding.namedLocals.add(specifier.local.name);
      }
    }
  }

  if (!binding.importsTarget) {
    return binding;
  }

  walkAst(ast.program.body, node => {
    if (binding.entryLinked || node.type !== "CallExpression") return;

    if (
      node.callee?.type === "Identifier" &&
      binding.namedLocals.has(node.callee.name)
    ) {
      binding.entryLinked = true;
      return;
    }

    if (
      node.callee?.type === "MemberExpression" &&
      !node.callee.computed &&
      node.callee.object?.type === "Identifier" &&
      node.callee.property?.type === "Identifier" &&
      node.callee.property.name === entryFunction &&
      node.callee.object.name === binding.defaultLocal
    ) {
      binding.entryLinked = true;
    }
  });

  return binding;
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
const operationsModelSource = readRepoFile("src/config/operationsModel.js");
const landingSource = `${appSource}\n${operationsModelSource}`;
const smokeSource = readRepoFile("tests/smoke/app.smoke.spec.js");
const errors = [];

for (const page of registry.system_pages) {
  assert(repoFileExists(page.component), `[verify:scenarios] Missing component: ${page.component}`, errors);
  assert(appSource.includes(page.screen_key), `[verify:scenarios] App router is missing screen key: ${page.screen_key}`, errors);
  assert(
    appSource.includes(page.landing_entry_label),
    `[verify:scenarios] Landing page is missing system page entry label: ${page.landing_entry_label}`,
    errors
  );
}

for (const scenario of registry.scenarios) {
  const diagramSource = readRepoFile(scenario.diagram);
  const testSource = readRepoFile(scenario.functional_test);
  const componentSource = readRepoFile(scenario.component);
  const componentBase = path.basename(scenario.component, path.extname(scenario.component));
  const expectedServiceImport = toImportPath(scenario.component, scenario.service);
  const serviceExports = getExportedFunctionNames(scenario.service);
  const componentServiceLink = getComponentServiceLink(
    scenario.component,
    expectedServiceImport,
    scenario.entry_function
  );

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
  assert(landingSource.includes(scenario.landing_label), `[verify:scenarios] Landing page is missing stage label: ${scenario.landing_label}`, errors);
  assert(
    componentSource.includes(scenario.use_case_id) || testSource.includes(scenario.use_case_id),
    `[verify:scenarios] Traceability is missing use-case id ${scenario.use_case_id} in component/test: ${scenario.component}`,
    errors
  );

  // 컴포넌트 ↔ 서비스 연결 확인
  assert(
    componentServiceLink.importsTarget,
    `[verify:scenarios] Component ${scenario.component} is not linked to service import: ${expectedServiceImport}`,
    errors
  );
  assert(
    componentServiceLink.entryLinked,
    `[verify:scenarios] Component ${scenario.component} does not call service entry function: ${scenario.entry_function}`,
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

console.log("[verify:scenarios] All checks passed: registry, service exports, component links, diagrams, tests.");
