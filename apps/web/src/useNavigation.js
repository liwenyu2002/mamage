import React from 'react';
import { getNavigation } from './utils/navigation';

export default function useNavigation() {
  const navigation = getNavigation();
  return React.useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
}

export function useNavigationState(name, initialValue) {
  const { entry } = useNavigation();
  const initial = React.useRef(initialValue);
  const value = Object.prototype.hasOwnProperty.call(entry.views || {}, name) ? entry.views[name] : initial.current;
  const set = React.useCallback(update => {
    const nav = getNavigation(), views = nav.getSnapshot().entry.views || {};
    const previous = Object.prototype.hasOwnProperty.call(views, name) ? views[name] : initial.current;
    nav.setView(name, typeof update === 'function' ? update(previous) : update);
  }, [name]);
  return [value, set];
}

export function useNavigationScroll() {
  const route = useNavigation();
  React.useEffect(() => {
    if (route.kind === 'initial' && !route.entry.scroll) return undefined;
    const { x = 0, y = 0 } = route.entry.scroll || {};
    let frame, observer, stopped = false;
    const stop = () => { stopped = true; cancelAnimationFrame(frame); observer?.disconnect(); };
    const restore = () => {
      if (stopped) return;
      window.scrollTo({ left: x, top: y, behavior: 'instant' });
      if (Math.abs(window.scrollY - y) < 2) stop();
    };
    // Lazy routes and paginated galleries may not have their final height on the first frame.
    observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore); });
    observer.observe(document.body);
    frame = requestAnimationFrame(restore);
    const timer = setTimeout(stop, 5000);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('pointerdown', stop);
    return () => { stop(); clearTimeout(timer); window.removeEventListener('wheel', stop); window.removeEventListener('touchstart', stop); window.removeEventListener('pointerdown', stop); };
  }, [route.entry.key]);
}
