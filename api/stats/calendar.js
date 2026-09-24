import { Pool } from 'pg';
import { getMonthlyCalendarData } from '../../src/application/reportingService.js';
import { parsePropertyIds } from '../../src/application/statsQueryParser.js';

const VALID_PERIODS = new Set(['last_month', 'this_month', 'next_month']);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const period = req.query.period ?? 'this_month';
  if (!VALID_PERIODS.has(period)) return res.status(400).json({ error: `invalid period: ${period}` });

  const db = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    const result = await getMonthlyCalendarData(period, {
      db,
      propertyIds: parsePropertyIds(req.query),
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[api/stats/calendar] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    await db.end();
  }
}
