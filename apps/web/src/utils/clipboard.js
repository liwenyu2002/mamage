// HTTP uses a user-initiated selection/copy fallback; focus and selection are restored.
function copyThroughSelection({ html, plainText }) {
  const active = document.activeElement;
  const start = active?.selectionStart, end = active?.selectionEnd;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const field = document.createElement('textarea');
  field.value = String(plainText || '');
  field.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;';
  field.setAttribute('aria-label', '复制稿件');
  field.tabIndex = -1;
  field.setAttribute('readonly', '');
  let handled = false;
  const onCopy = event => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', String(plainText || ''));
    if (html !== undefined) event.clipboardData.setData('text/html', String(html));
    event.preventDefault(); handled = true;
  };
  try {
    document.body.appendChild(field);
    document.addEventListener('copy', onCopy, true);
    field.focus({ preventScroll: true }); field.select();
    if (!document.execCommand('copy') || !handled) throw new Error('浏览器未允许复制，请选中稿件手动复制');
  } finally {
    document.removeEventListener('copy', onCopy, true);
    field.remove();
    if (active?.isConnected) {
      active.focus({ preventScroll: true });
      if (typeof start === 'number' && typeof active.setSelectionRange === 'function') active.setSelectionRange(start, end);
    }
    if (selection) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)); }
  }
}

export async function copyContent({ html, plainText = '' }) {
  try {
    if (html !== undefined && navigator.clipboard?.write && typeof window.ClipboardItem === 'function') {
      await navigator.clipboard.write([new window.ClipboardItem({
        'text/html': new Blob([String(html)], { type: 'text/html' }),
        'text/plain': new Blob([String(plainText)], { type: 'text/plain' }),
      })]);
      return;
    }
    if (html === undefined && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(plainText)); return;
    }
  } catch (error) { /* Fall back to an explicit, verified copy action. */ }
  copyThroughSelection({ html, plainText });
}

export function copyText(text) { return copyContent({ plainText: text }); }
