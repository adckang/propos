/** The designated Pi applies the operation and returns its measured state. */
export async function requestMonitoringEvent(type, propertyId, watcherId) {
  if (typeof propertyId !== 'string' || !propertyId || typeof watcherId !== 'string' || !watcherId) {
    throw new Error('Invalid monitoring target');
  }
  const response = await fetch(`/api/monitoring/event?watcherId=${encodeURIComponent(watcherId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, propertyId }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true || !result.roomState?.mainStatus || !result.roomState?.subStatus) {
    throw new Error(result?.error ?? `Monitoring request failed (${response.status})`);
  }
  return result;
}
