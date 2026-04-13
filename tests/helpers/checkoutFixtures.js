export function makeCheckoutBooking(overrides = {}) {
  return {
    propId: "P-042",
    propName: "해운대 오션뷰",
    guestName: "김민준",
    guestId: "guest-001",
    checkIn: "2026-04-05T15:00:00",
    checkOut: "2026-04-07T11:00:00",
    status: "occupied",
    wifi: { ssid: "PROPOS_GUEST", pw: "pass1234" },
    ...overrides,
  };
}

export function makeCheckoutEvent(overrides = {}) {
  return {
    event: "door_locked",
    propId: "P-042",
    time: "11:05",
    context: "guest_checkout",
    ...overrides,
  };
}

export function makeCleaners(overrides = []) {
  return [
    { id: "C-01", name: "김청소", available: true, activeJobs: 1, phone: "010-1111-0001" },
    { id: "C-02", name: "이청소", available: true, activeJobs: 0, phone: "010-1111-0002" },
    { id: "C-03", name: "박청소", available: false, activeJobs: 0, phone: "010-1111-0003" },
    ...overrides,
  ];
}
