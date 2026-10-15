import { handleVercelIcal } from "../server/icalApiHandlers.js";
import { DATA_PROFILE, resolveServerDataProfile } from "../src/config/dataProfile.js";

import { guardAdmin } from "../server/auth/operatorAuth.js";
export default async function handler(req, res) {
  if (resolveServerDataProfile(process.env) === DATA_PROFILE.DEMO) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "demo profile cannot access real calendars", dataProfile: "demo" }));
    return;
  }
  if (!guardAdmin(req, res)) return; // D-033: 캘린더 URL 중계
  return handleVercelIcal(req, res);
}
