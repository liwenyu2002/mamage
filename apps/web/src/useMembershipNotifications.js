import React from 'react';
import { getMembershipSummary, MEMBERSHIP_EVENT } from './services/workspaceJoinService';

export default function useMembershipNotifications(userId) {
  const [summary, setSummary] = React.useState(null);
  React.useEffect(() => {
    setSummary(null);
    if (!userId) return undefined;
    let live = true, running = false, refreshAgain = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden || !live) return;
      if (running) { refreshAgain = true; return; }
      running = true;
      try {
        const value = await getMembershipSummary(controller.signal);
        if (live) setSummary(value);
      } catch { /* Notifications must not block the rest of the workspace. */ }
      finally { running = false; if (refreshAgain && live) { refreshAgain = false; void refresh(); } }
    };
    void refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener(MEMBERSHIP_EVENT, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      live = false; controller.abort(); clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(MEMBERSHIP_EVENT, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [userId]);
  return summary;
}
