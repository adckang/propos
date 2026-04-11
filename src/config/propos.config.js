'use strict';

// ============================================================
// propos.config.js — PROPOS 전체 설정 중앙 관리
//
// 브라우저(Vite)는 propos.config.json을 직접 import합니다.
// Node/CommonJS 계층(application, infrastructure, tests)은
// 이 파일을 통해 동일한 설정을 읽습니다.
// ============================================================

module.exports = require('./propos.config.json');
