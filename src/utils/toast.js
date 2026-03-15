// ============================================================
// toast.js — Toast 알림 유틸리티 (alert() 대체)
// 보안: textContent 사용으로 XSS 완전 차단
// 사용처: CommandCenter (배정 완료, 전송 등 피드백)
// HTML에 필요한 요소: <div id="toast-root" class="toast-wrap"></div>
// ============================================================

window.Toast = {
  /**
   * @param {string} msg   - 표시할 메시지 (XSS-safe: textContent 처리)
   * @param {string} type  - 's'(success) | 'e'(error) | 'i'(info) | 'w'(warning)
   * @param {number} ms    - 자동 사라지는 시간 (기본 3000ms)
   */
  show(msg, type = 'i', ms = 3000) {
    const el = document.createElement('div');
    el.className  = 'toast toast-' + type;
    el.textContent = msg;           // textContent = XSS-safe (innerHTML 절대 사용 금지)
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), ms);
  },
  success: m => Toast.show(m, 's'),
  error:   m => Toast.show(m, 'e'),
  info:    m => Toast.show(m, 'i'),
  warn:    m => Toast.show(m, 'w'),
};
