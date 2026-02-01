const TRANSIENT_STATUSES = new Set([
  "QR",
  "LOADING",
  "SYNCING",
  "CONNECTING",
  "AUTHENTICATED",
]);

function mergeSessions(previous = [], incoming = []) {
  const incomingMap = new Map(incoming.map((session) => [session.id, session]));
  const merged = [];

  // Determine which IDs are present in the new incoming list
  const incomingIds = new Set(incoming.map(s => s.id));

  // Filter previous sessions:
  // Keep if:
  // 1. It exists in incoming list (will be updated by incomingMap Loop later, but we need to keep the entry for order/merging?)
  //    Actually, we can rebuild the list.
  // OR
  // 2. It is TRANSIENT (Optimization: Frontend assumes it exists locally until backend confirms success/failure)
  //    Risk: If backend deleted it, but frontend thinks it's transient, it sticks forever.
  //    Fix: Only keep transient if it was created RECENTLY (optimistic) or if we trust backend list is partial?
  //    If backend list is "Full Snapshot", then anything missing MUST be removed unless it's a purely local optimistic creation (temp_id).
  
  // Revised approach:
  // Iterate previous.
  // If in incoming -> Update it.
  // If NOT in incoming:
  //    If it's a "temp_" (optimistic creation) -> Keep it (waiting validation).
  //    If it's transient status (LOADING/CONNECTING) -> Keep it?
  //       If backend returns empty list, and we are "LOADING", we should probably keep it for a bit.
  //       But if we just deleted it, we want it GONE.
  //    For "Delete" action, we assume the component calls 'refreshSessions' immediately.
  //    If 'refreshSessions' returns list without ID, and status was ERROR/DISCONNECTED, it should be gone.
  
  previous.forEach((session) => {
    const updated = incomingMap.get(session.id);
    if (updated) {
      merged.push({ ...session, ...updated });
      incomingMap.delete(session.id); // Marked as handled
    } else {
        // Not in incoming list.
        // Keep ONLY if it is an optimistic temporary session (starts with 'temp_')
        // OR if it's strictly transient AND we suspect backend lag (but for Delete strictness, we should prefer dropping).
        // Let's drop it if it's not in backend, unless it's strictly new 'temp_'.
        if (session.id.startsWith('temp_')) {
             merged.push(session);
        }
    }
  });

  // Add remaining new sessions from incoming
  incomingMap.forEach((session) => {
    merged.push(session);
  });

  return merged;
}

module.exports = {
  mergeSessions,
  TRANSIENT_STATUSES,
};
