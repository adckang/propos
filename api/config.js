import { handleVercelConfig } from '../server/configApiHandlers.js';
import { DATA_PROFILE, resolveServerDataProfile } from '../src/config/dataProfile.js';

export default async function handler(req, res) {
  if (resolveServerDataProfile(process.env) === DATA_PROFILE.DEMO) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ dataProfile: 'demo' }));
    return;
  }
  return handleVercelConfig(req, res);
}
