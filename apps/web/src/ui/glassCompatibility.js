export function needsGlassFallback({ userAgent = '', supportsBackdrop = false } = {}) {
  // CSS.supports checks parsing, not whether DingTalk's compositor draws blur.
  const mobileDingTalk = /DingTalk/i.test(userAgent) && /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  return !supportsBackdrop || mobileDingTalk;
}

export function applyGlassCompatibility({ document, navigator, CSS }) {
  const supportsBackdrop = Boolean(CSS?.supports?.('backdrop-filter', 'blur(1px)')
    || CSS?.supports?.('-webkit-backdrop-filter', 'blur(1px)'));
  if (needsGlassFallback({ userAgent: navigator?.userAgent, supportsBackdrop })) {
    document.documentElement.dataset.glassFallback = 'true';
  } else {
    delete document.documentElement.dataset.glassFallback;
  }
}
