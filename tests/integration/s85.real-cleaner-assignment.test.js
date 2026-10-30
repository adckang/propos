/**
 * s85 — 실제 운영 DB의 파주201 청소 배정/담당자 연결 진단
 *
 * 읽기 전용 진단 테스트다. 기본 테스트 실행에는 포함하지 않고
 * RUN_LIVE_DB=1일 때만 실행한다.
 *
 * 목적:
 *   - cleaning_jobs.status가 ASSIGNED인지
 *   - assigned_cleaner_id가 실제로 채워져 있는지
 *   - cleaners 조인이 이름을 찾는지
 * 를 집계해서 디테일뷰의 "담당자 미정"이 화면 문제인지 DB 관계 문제인지 구분한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

function loadLocalEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // CI/기본 테스트에서는 .env.local 없이 skip 된다.
  }
}

loadLocalEnv();

const runLive = process.env.RUN_LIVE_DB === '1';
const runLiveGoogle = process.env.RUN_LIVE_GOOGLE === '1';

test('실DB: 파주201 청소 작업의 담당자 연결 상태 진단', { skip: !runLive }, async () => {
  assert.ok(process.env.POSTGRES_URL, 'POSTGRES_URL이 필요합니다.');
  const { Pool } = pg;
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

  try {
    const { rows } = await pool.query(`
      SELECT
        p.property_id,
        p.name,
        p.data_origin,
        j.status,
        j.assigned_cleaner_id,
        j.google_event_id,
        c.name AS cleaner_name
      FROM property_cleaning_config p
      LEFT JOIN cleaning_jobs j ON j.property_id = p.property_id
      LEFT JOIN cleaners c ON c.id = j.assigned_cleaner_id
      WHERE (p.property_id = $1 OR p.name = $1)
        AND p.data_origin = 'REAL'
      ORDER BY j.checkout_at
    `, ['파주201']);

    const { rows: cleanerRows } = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE active)::int AS active,
        COUNT(*) FILTER (WHERE email IS NOT NULL AND email <> '')::int AS with_email
      FROM cleaners
    `);

    const { rows: shapeRows } = await pool.query(`
      SELECT
        COALESCE(j.source, '<null>') AS source,
        COALESCE(j.data_origin, '<null>') AS data_origin,
        j.status,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE j.assigned_cleaner_id IS NOT NULL)::int AS with_cleaner_id,
        COUNT(*) FILTER (WHERE j.google_event_id IS NOT NULL)::int AS with_google_event
      FROM cleaning_jobs j
      JOIN property_cleaning_config p ON p.property_id = j.property_id
      WHERE (p.property_id = $1 OR p.name = $1)
        AND p.data_origin = 'REAL'
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3
    `, ['파주201']);

    assert.ok(rows.length > 0, 'REAL 숙소 파주201 또는 해당 청소 작업이 없습니다.');

    const jobs = rows.filter(row => row.status != null);
    const assigned = jobs.filter(row => ['ASSIGNED', 'COMPLETED'].includes(row.status));
    const assignedWithoutId = assigned.filter(row => !row.assigned_cleaner_id);
    const assignedWithoutName = assigned.filter(row => row.assigned_cleaner_id && !row.cleaner_name);
    const assignedWithName = assigned.filter(row => row.cleaner_name);

    // 민감한 예약/이메일/식별자는 출력하지 않고 집계만 남긴다.
    console.log(JSON.stringify({
      propertyRows: rows.length,
      jobRows: jobs.length,
      assigned: assigned.length,
      assignedWithoutId: assignedWithoutId.length,
      assignedWithoutName: assignedWithoutName.length,
      assignedWithName: assignedWithName.length,
      cleaners: cleanerRows[0],
      assignedWithGoogleEvent: assigned.filter(row => row.google_event_id).length,
      jobShapes: shapeRows,
      statuses: [...new Set(jobs.map(row => row.status))].sort(),
    }));
  } finally {
    await pool.end();
  }
});

test('실Google API: 파주201 배정 이벤트의 참석자 순서와 cleaners 이메일 매칭 진단', { skip: !runLive || !runLiveGoogle }, async () => {
  assert.ok(process.env.POSTGRES_URL, 'POSTGRES_URL이 필요합니다.');
  assert.ok(process.env.GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_ID가 필요합니다.');
  assert.ok(process.env.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET가 필요합니다.');
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN;
  assert.ok(refreshToken, 'Calendar refresh token이 필요합니다.');

  const { Pool } = pg;
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    const { rows: [property] } = await pool.query(`
      SELECT google_calendar_id,
             MIN(j.checkout_at) AS min_checkout,
             MAX(j.checkout_at) AS max_checkout
      FROM property_cleaning_config p
      JOIN cleaning_jobs j ON j.property_id = p.property_id
      WHERE (p.property_id = $1 OR p.name = $1)
        AND p.data_origin = 'REAL'
        AND j.status IN ('ASSIGNED', 'COMPLETED')
      GROUP BY google_calendar_id
      LIMIT 1
    `, ['파주201']);
    assert.ok(property?.google_calendar_id, '파주201의 Google Calendar ID가 없습니다.');

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const tokenBody = await tokenResponse.json();
    assert.ok(
      tokenResponse.ok && tokenBody.access_token,
      `Google token 발급 실패 (${tokenResponse.status}, ${tokenBody.error ?? 'unknown'}: ${tokenBody.error_description ?? 'no description'})`
    );

    const timeMin = new Date(new Date(property.min_checkout).getTime() - 24 * 3600_000).toISOString();
    const timeMax = new Date(new Date(property.max_checkout).getTime() + 24 * 3600_000).toISOString();
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      showDeleted: 'false',
      maxResults: '250',
    });
    const eventsResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(property.google_calendar_id)}/events?${params}`,
      { headers: { Authorization: `Bearer ${tokenBody.access_token}` } },
    );
    const eventsBody = await eventsResponse.json();
    assert.ok(eventsResponse.ok, `Google Calendar 조회 실패 (${eventsResponse.status})`);

    const { rows: cleanerRows } = await pool.query(
      `SELECT lower(trim(email)) AS email FROM cleaners WHERE email IS NOT NULL AND email <> ''`
    );
    const cleanerEmails = new Set(cleanerRows.map(row => row.email));
    const events = (eventsBody.items ?? [])
      .filter(event => event.extendedProperties?.private?.propos !== 'blocker')
      .filter(event => Array.isArray(event.attendees) && event.attendees.length > 0);
    const firstMatches = events.filter(event => cleanerEmails.has(String(event.attendees[0].email ?? '').toLowerCase())).length;
    const anyMatches = events.filter(event => event.attendees.some(attendee => cleanerEmails.has(String(attendee.email ?? '').toLowerCase()))).length;
    const firstMissesButAnyMatches = events.filter(event =>
      !cleanerEmails.has(String(event.attendees[0].email ?? '').toLowerCase()) &&
      event.attendees.some(attendee => cleanerEmails.has(String(attendee.email ?? '').toLowerCase()))
    ).length;

    console.log(JSON.stringify({
      calendarEventsWithAttendees: events.length,
      cleanersWithEmail: cleanerEmails.size,
      firstAttendeeMatchesCleaner: firstMatches,
      anyAttendeeMatchesCleaner: anyMatches,
      firstAttendeeMissesButLaterAttendeeMatches: firstMissesButAnyMatches,
    }));
  } finally {
    await pool.end();
  }
});
