import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(
  readFileSync(join(__dir, "../src/config/propos.config.json"), "utf8")
);

const BASE = cfg.ha.baseUrl;
const TOKEN = cfg.ha.token;

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

const SCENES = [
  {
    scene_id: "propos_welcome",
    name: "PROPOS 웰컴 씬",
    entities: {
      "light.rgbcct_8002": { state: "on", brightness: 180, color_temp: 370 },
      "switch.tv_smart_plug_socket_1": { state: "on" },
      "switch.3ch_wifi_usb_switch_module_cbu_switch_1": { state: "on" },
    },
  },
  {
    scene_id: "propos_vacancy",
    name: "PROPOS 공실 모드",
    entities: {
      "light.rgbcct_8002": { state: "off" },
      "switch.tv_smart_plug_socket_1": { state: "off" },
      "switch.3ch_wifi_usb_switch_module_cbu_switch_1": { state: "off" },
    },
  },
];

async function createScene(scene) {
  const res = await fetch(`${BASE}/api/services/scene/create`, {
    method: "POST",
    headers,
    body: JSON.stringify(scene),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${scene.scene_id} 실패 (${res.status}): ${text}`);
  }

  return res.json();
}

console.log("HA 씬 생성 시작...\n");

for (const scene of SCENES) {
  try {
    await createScene(scene);
    console.log(`✅ ${scene.name} (scene.${scene.scene_id}) 생성 완료`);
  } catch (e) {
    console.error(`❌ ${scene.name}: ${e.message}`);
  }
}

console.log("\n완료. HA > 설정 > 씬 에서 확인하세요.");
