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
