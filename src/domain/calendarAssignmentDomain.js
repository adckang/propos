const DEFAULT_ORGANIZER_EMAIL = "bnb.paju@gmail.com";

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function attendeeEmail(attendee) {
  return typeof attendee === "string" ? attendee : attendee?.email;
}

export function attendeeEmailsForCleaner(attendees, organizerEmail = DEFAULT_ORGANIZER_EMAIL) {
  const organizer = normalizeEmail(organizerEmail);
  return [...new Set(
    (Array.isArray(attendees) ? attendees : [])
      .map(attendeeEmail)
      .map(normalizeEmail)
      .filter(Boolean)
      .filter((email) => email !== organizer),
  )];
}

export function matchCleanerAttendee(attendees, cleaners, organizerEmail = DEFAULT_ORGANIZER_EMAIL) {
  const byEmail = new Map(
    (Array.isArray(cleaners) ? cleaners : [])
      .map((cleaner) => [normalizeEmail(cleaner?.email), cleaner])
      .filter(([email]) => email),
  );
  for (const email of attendeeEmailsForCleaner(attendees, organizerEmail)) {
    const cleaner = byEmail.get(email);
    if (cleaner) return { email, cleaner };
  }
  return null;
}

/** Google 예약의 확정 시각. 체크아웃 키와 예약 시각은 별도로 보존한다. */
export function calendarCleaningTimes(event, checkoutAt = null) {
  if (event?.status === 'cancelled' || event?.extendedProperties?.private?.propos === 'blocker') return null;
  const start = event?.start?.dateTime;
  const end = event?.end?.dateTime;
  const hasTimezone = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (!hasTimezone(start) || !hasTimezone(end)) return null;
  const startMs = Date.parse(start), endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const kstDate = ms => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
  const date = kstDate(startMs);
  if (checkoutAt != null) {
    const checkoutMs = new Date(checkoutAt).getTime();
    if (!Number.isFinite(checkoutMs) || startMs < checkoutMs || kstDate(checkoutMs) !== date) return null;
  }
  return { date, cleaning_start_at: new Date(startMs).toISOString(), cleaning_end_at: new Date(endMs).toISOString() };
}
