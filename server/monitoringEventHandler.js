import { dispatchMonitoringEvent } from './occupancyWatcher.js';

export async function handleMonitoringEventRequest(req, res) {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Invalid monitoring event'), { status: 400 });
    const result = await dispatchMonitoringEvent(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(error.status ?? (error instanceof SyntaxError ? 400 : 500), { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}
