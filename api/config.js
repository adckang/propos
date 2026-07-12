import { handleVercelConfig } from '../server/configApiHandlers.js';

export default async function handler(req, res) {
  return handleVercelConfig(req, res);
}
