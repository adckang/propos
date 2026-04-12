import { getStates } from "./haBrowserClient.js";

export function createStatePollingConnection({
  entityIds,
  pollIntervalMs = 3000,
  onStatusChange,
  onStates,
}) {
  let active = true;
  let timer = null;
  let hasConnected = false;

  async function tick() {
    if (!active) return;

    try {
      const states = await getStates(entityIds);
      hasConnected = true;
      onStatusChange?.("connected");
      onStates?.(states);
    } catch (_) {
      onStatusChange?.(hasConnected ? "reconnecting" : "error");
    }
  }

  onStatusChange?.("connecting");
  tick();
  timer = setInterval(tick, pollIntervalMs);

  return {
    disconnect() {
      active = false;
      clearInterval(timer);
      onStatusChange?.("disconnected");
    },
  };
}
