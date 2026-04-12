import { handleVercelState } from "../../server/haApiHandlers.js";

export default async function handler(req, res) {
  return handleVercelState(req, res);
}
