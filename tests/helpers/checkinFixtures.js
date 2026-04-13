export function makeCheckinBooking(overrides = {}) {
  return {
    propId: "P-042",
    propName: "해운대 오션뷰 펜트하우스",
    guestName: "김민준",
    guestId: "guest_001",
    checkIn: "2026-03-28T15:00:00",
    checkOut: "2026-03-30T11:00:00",
    status: "confirmed",
    pinRequired: true,
    wifi: { ssid: "ProposGuest_5G", pw: "1234567890" },
    ...overrides,
  };
}

export function makeSecondaryCheckinBooking(overrides = {}) {
  return {
    propId: "P-007",
    propName: "강남 럭셔리 스위트",
    guestName: "이수진",
    guestId: "guest_002",
    checkIn: "2026-03-28T14:00:00",
    checkOut: "2026-03-29T11:00:00",
    status: "confirmed",
    pinRequired: true,
    wifi: { ssid: "ProposGuest_7", pw: "abcde12345" },
    ...overrides,
  };
}

export function makeExcludedCheckinBooking(overrides = {}) {
  return {
    propId: "P-099",
    propName: "제주 바다뷰",
    guestName: "박지호",
    guestId: "guest_003",
    checkIn: "2026-03-27T15:00:00",
    checkOut: "2026-03-29T11:00:00",
    status: "confirmed",
    pinRequired: true,
    wifi: { ssid: "Jeju_5G", pw: "jeju1234" },
    ...overrides,
  };
}

export function makeCheckinBookings() {
  return [
    makeCheckinBooking(),
    makeSecondaryCheckinBooking(),
    makeExcludedCheckinBooking(),
  ];
}

export function makeDoorUnlockedEvent(overrides = {}) {
  return {
    event: "door_unlocked",
    propId: "P-042",
    time: "15:12",
    context: "guest_checkin",
    failCount: 0,
    ...overrides,
  };
}
