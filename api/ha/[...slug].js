import {
  handleVercelService,
  handleVercelState,
  handleVercelStates,
  handleVercelAllStates,
  handleVercelHistory,
  handleVercelTemplate,
} from "../../server/haApiHandlers.js";
import { DATA_PROFILE, resolveServerDataProfile } from "../../src/config/dataProfile.js";

const HANDLERS = {
  service:    handleVercelService,
  state:      handleVercelState,
  states:     handleVercelStates,
  'all-states': handleVercelAllStates,
  history:    handleVercelHistory,
  template:   handleVercelTemplate,
};

export default async function handler(req, res) {
  if (resolveServerDataProfile(process.env) === DATA_PROFILE.DEMO) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "demo profile cannot access Home Assistant", dataProfile: "demo" }));
    return;
  }
  const action = (req.query?.slug
    ? (Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug)
    : (req.url || "").split("?")[0].split("/").filter(Boolean)[2]) || "";
  const handle = HANDLERS[action];
  if (!handle) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  return handle(req, res);
}
