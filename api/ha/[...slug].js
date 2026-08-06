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
  const slug = req.query.slug;
  const action = Array.isArray(slug) ? slug[0] : slug;
  const handle = HANDLERS[action];
  if (!handle) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  return handle(req, res);
}
