import { handleVercelService } from "../../server/haApiHandlers.js";

export default async function handler(req, res) {
  return handleVercelService(req, res);
}
