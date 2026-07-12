import { handleVercelHistory } from "../../server/haApiHandlers.js";

export default async function handler(req, res) {
  return handleVercelHistory(req, res);
}
