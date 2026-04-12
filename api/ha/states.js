import { handleVercelStates } from "../../server/haApiHandlers.js";

export default async function handler(req, res) {
  return handleVercelStates(req, res);
}
