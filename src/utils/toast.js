// ============================================================
// toast.js — Toast 알림 유틸리티 (alert() 대체)
// ============================================================

function ensureToastRoot() {
  let root = document.getElementById("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    root.className = "toast-wrap";
    document.body.appendChild(root);
  }
  return root;
}

const Toast = {
  show(msg, type = "i", ms = 3000) {
    const el = document.createElement("div");
    el.className = "toast toast-" + type;
    el.textContent = msg;
    ensureToastRoot().appendChild(el);
    window.setTimeout(() => el.remove(), ms);
  },
  success(msg) {
    Toast.show(msg, "s");
  },
  error(msg) {
    Toast.show(msg, "e");
  },
  info(msg) {
    Toast.show(msg, "i");
  },
  warn(msg) {
    Toast.show(msg, "w");
  },
};

window.Toast = Toast;

export default Toast;
