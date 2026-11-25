/**
 * RF-39 — Gmail 새 메일 알림을 "마지막으로 처리한 기록 번호부터" 읽는다.
 *
 * Gmail 알림(Pub/Sub)은 "메일함이 바뀌었다 + 지금 기록 번호(historyId)"만 준다. 새 메일은 그 번호 *까지*에 들어 있어서,
 * 알림의 번호부터 물으면(예전 코드) 늘 아무것도 못 찾았다. Google 안내대로 마지막으로 처리한 번호를 저장해 두고(KV)
 * 거기서부터 읽은 뒤 번호를 앞으로 옮긴다.
 *
 *   - 저장된 번호가 없으면(처음): Gmail이 알려 주는 지금 번호를 시작점으로 저장하고, 놓친 게 있을 수 있어 한 번 다시 동기화한다.
 *   - 알림이 저장된 번호보다 새롭지 않으면(중복·늦게 온 알림): 아무것도 하지 않는다.
 *   - Gmail이 저장된 번호를 더는 모르면(404, 약 1주 지남): 한 번 다시 동기화하고 Gmail의 지금 번호로 새로 시작한다.
 *   - **알림에 실린 번호는 저장하지 않는다** — 웹훅 비밀값(RF-38)이 없는 동안 누구나 알림을 보낼 수 있어, 아주 큰 가짜 번호를
 *     저장하면 이후 진짜 알림이 모두 "이미 처리함"으로 버려진다. 저장하는 번호는 Gmail이 직접 알려 준 것뿐이다.
 *   - Gmail 조회가 실패하면: 번호를 그대로 둬 다음 알림이 같은 범위를 다시 읽는다.
 *   - 같은 범위를 두 알림이 동시에 처리하지 않게 1분짜리 잠금을 건다. 잠겨 있으면 'busy' — 호출한 쪽이 Pub/Sub에
 *     나중에 다시 보내 달라고(503) 답한다. 잠금은 1분 뒤 저절로 풀려 처리 중 멈춰도 막히지 않는다.
 *
 * 예약은 이 알림이 없어도 정기 동기화(08:00·22:00 KST)와 대시보드 15분 동기화로 들어온다 — 이 알림은 앞당기는 길이다.
 */

export const GMAIL_LAST_HISTORY_KEY = 'gmail_last_history_id';
export const GMAIL_HISTORY_LOCK_KEY = 'gmail_history_lock';
const LOCK_SECONDS = 60;

/** Gmail 기록 번호는 부호 없는 64비트 정수를 글자로 준다 — 숫자 글자만 받는다 */
export const isHistoryId = value => (typeof value === 'string' || typeof value === 'number') && /^\d{1,20}$/.test(String(value));
const newer = (a, b) => BigInt(a) > BigInt(b);
const maxId = (...ids) => ids.filter(isHistoryId).map(String).reduce((best, id) => (best == null || newer(id, best) ? id : best), null);

/** 구독 등록·갱신 응답의 번호를 시작점으로 — 이미 저장된 번호가 있으면 그대로 둔다(그 사이 메일을 건너뛰지 않게) */
export async function rememberGmailStart(kv, historyId) {
  if (!isHistoryId(historyId)) return false;
  return (await kv.set(GMAIL_LAST_HISTORY_KEY, String(historyId), { nx: true })) === 'OK';
}

/**
 * 시작점을 Gmail의 지금 번호로. 못 받으면 저장도 동기화도 하지 않고 실패로 알린다 — 알림마다 전체 동기화가 도는 고리를 막고,
 * 시작점은 다음 구독 갱신(아침 정기 작업, 약 주 1회)의 응답 번호로 채워진다.
 */
async function restartFromGmail(kv, deps) {
  const current = await deps.getCurrentHistoryId();
  if (!isHistoryId(current)) throw new Error('Gmail 메일함의 지금 번호를 받지 못함');
  await kv.set(GMAIL_LAST_HISTORY_KEY, String(current));
}

/**
 * @param {string} notifiedId 알림에 실린 지금 기록 번호
 * @param {object} deps
 * @param {object} deps.kv                                        get·set(nx/ex)·del
 * @param {(startId: string, pageToken?: string) => Promise<{status: number, body: any}>} deps.listHistory
 * @param {(messageId: string) => Promise<string>} deps.getSubject
 * @param {() => Promise<string|null>} deps.getCurrentHistoryId      Gmail이 알려 주는 메일함의 지금 번호(프로필)
 * @param {(subject: string) => boolean} deps.isReservation
 * @param {(messageId: string, metadata: {subject: string}) => Promise<void>} [deps.onMessage]
 * @param {() => Promise<void>} deps.onReservation                예약 메일을 찾았을 때(Slack + 동기화)
 * @param {(reason: 'start'|'expired') => Promise<void>} deps.onCatchUp  놓쳤을 수 있을 때(동기화만)
 * @returns {Promise<{result: 'ignored'|'busy'|'started'|'stale'|'reset'|'failed'|'checked', found?: boolean}>}
 */
export async function handleGmailNotification(notifiedId, deps) {
  if (!isHistoryId(notifiedId)) return { result: 'ignored' };
  const { kv } = deps;
  const notified = String(notifiedId);
  if ((await kv.set(GMAIL_HISTORY_LOCK_KEY, '1', { nx: true, ex: LOCK_SECONDS })) !== 'OK') return { result: 'busy' };
  try {
    const stored = await kv.get(GMAIL_LAST_HISTORY_KEY);
    if (!isHistoryId(stored)) {
      await restartFromGmail(kv, deps);
      await deps.onCatchUp('start');
      return { result: 'started' };
    }
    if (!newer(notified, stored)) return { result: 'stale' };

    const messageIds = [];
    let newest = String(stored);
    let pageToken;
    do {
      const { status, body } = await deps.listHistory(String(stored), pageToken);
      if (status === 404) {
        await restartFromGmail(kv, deps);
        await deps.onCatchUp('expired');
        return { result: 'reset' };
      }
      if (status < 200 || status >= 300) throw new Error(`Gmail history API ${status}`);
      for (const h of body?.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          const id = added?.message?.id;
          if (id && !messageIds.includes(id)) messageIds.push(id);
        }
      }
      newest = maxId(newest, body?.historyId) ?? newest;
      pageToken = body?.nextPageToken;
    } while (pageToken);

    let found = false;
    for (const id of messageIds) {
      const subject = await deps.getSubject(id);
      if (deps.isReservation(subject)) found = true;
      if (deps.onMessage) await deps.onMessage(id, { subject });
      else if (found) break;
    }
    if (found) await deps.onReservation();
    if (newer(newest, stored)) await kv.set(GMAIL_LAST_HISTORY_KEY, newest);
    return { result: 'checked', found };
  } finally {
    await kv.del(GMAIL_HISTORY_LOCK_KEY).catch(() => {});
  }
}
