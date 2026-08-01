#!/bin/sh
# PROPOS 워처 자동 시작 스크립트
# SSH 애드온 init_commands에서 호출됨: sh /config/propos/scripts/start-watcher.sh
# setsid로 새 세션 생성 → init 스크립트 종료 후에도 프로세스 생존

sleep 15

setsid node /config/propos/scripts/occupancy-watcher-standalone.mjs \
  >> /config/propos/watcher.log 2>&1 &

echo "[start-watcher] 시작됨 PID=$!" >> /config/propos/watcher.log
