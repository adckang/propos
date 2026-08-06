import {
  handleVercelService,
  handleVercelState,
  handleVercelStates,
  handleVercelHistory,
  handleVercelTemplate,
} from "../../server/haApiHandlers.js";

const HANDLERS = {
  service:  handleVercelService,
  state:    handleVercelState,
  states:   handleVercelStates,
  history:  handleVercelHistory,
  template: handleVercelTemplate,
};

export default async function handler(req, res) {
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
