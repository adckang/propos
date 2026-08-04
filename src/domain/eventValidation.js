import { z } from "zod";
import { EVENT_TYPES } from "../config/eventTypes.js";

const ALL_EVENT_TYPE_VALUES = Object.values(EVENT_TYPES);

// ISO 8601 전체 타임스탬프 (날짜만 "2026-08-04" 는 거부)
const isoTimestamp = z
  .string()
  .refine(
    (val) => {
      if (!/T/.test(val)) return false;
      const d = new Date(val);
      return !isNaN(d.getTime());
    },
    { message: "ISO 8601 전체 타임스탬프 필요 (T 포함)" }
  );

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const eventSchema = z.object({
  id: z.string().regex(UUID_RE, "UUID v4 형식 필요"),
  property_id: z.string().min(1).max(64),
  type: z.enum(ALL_EVENT_TYPE_VALUES),
  device_time: isoTimestamp,
  data: z.record(z.unknown()).optional(),
});

/**
 * 이벤트 객체를 Zod 스키마로 검증한다.
 * @param {unknown} raw
 * @returns {{ success: true, data: object } | { success: false, error: ZodError }}
 */
export function validateEvent(raw) {
  return eventSchema.safeParse(raw);
}
