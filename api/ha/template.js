import { handleVercelTemplate } from "../../server/haApiHandlers.js";

export default async function handler(req, res) {
  return handleVercelTemplate(req, res);
}
