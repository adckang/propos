import { handleVercelIcal } from "../server/icalApiHandlers.js";

export default async function handler(req, res) {
  return handleVercelIcal(req, res);
}
