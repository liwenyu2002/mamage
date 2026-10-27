import { articleBlocks, changeArticleBlock } from './newsArticle';

export const REVISION_ACTIONS = [
  { value: 'custom', label: '自定义修改' }, { value: 'polish', label: '润色' },
  { value: 'complete', label: '补全' }, { value: 'add_paragraph', label: '补段落' },
  { value: 'continue', label: '续写' }, { value: 'shorten', label: '精简' }, { value: 'expand', label: '扩写' },
];
export function requiresExactSelection(instruction = '') {
  return /(?:其他|其余|剩余).{0,12}(?:不变|不改|不要改|勿改)|(?:只|仅)(?:修改|替换|改动|改|将|把).{0,12}(?:选中|选区|文字)|不要(?:修改|改动|改变).{0,12}(?:其他|其余|剩余)/.test(instruction);
}
export function contextualRevisionTarget(mode, target, source, instruction = '') {
  if (!['custom', 'polish', 'shorten', 'expand'].includes(mode) || !target?.uid
    || !Number.isInteger(target.start) || !Number.isInteger(target.end) || target.end <= target.start
    || requiresExactSelection(instruction)) return { target, originalSelection: null };
  const block = source.blocks.find(item => item.uid === target.uid);
  if (!block || block.type !== 'paragraph' || /[。！？!?；;\n]/.test(block.text.slice(target.start, target.end))) return { target, originalSelection: null };
  let start = target.start, end = target.end;
  while (start > 0 && !/[。！？!?；;\n]/.test(block.text[start - 1])) start--;
  while (end < block.text.length && !/[。！？!?；;\n]/.test(block.text[end])) end++;
  if (end < block.text.length && block.text[end] !== '\n') end++;
  if (end - start > 500 || /[\[\]*_`<>]/.test(block.text.slice(start, end))
    || (start === target.start && end === target.end)) return { target, originalSelection: null };
  return { target: { uid: target.uid, start, end }, originalSelection: { ...target } };
}
export function revisionTarget(mode, scope, source, selection) {
  if (mode === 'continue') return null;
  let target = null;
  if (scope === 'selection') {
    if (selection?.ranges?.length > 1) {
      const ranges = selection.ranges.map(range => {
        const block = source.blocks.find(item => item.uid === range.uid);
        if (!block || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start || range.end > block.text.length) throw Error('选区已变化，请重新选择正文');
        return { uid: range.uid, start: range.start, end: range.end };
      });
      if (mode === 'complete') throw Error('请将光标放到一个具体位置后补全');
      return mode === 'add_paragraph' ? { uid: ranges.at(-1).uid } : { ranges };
    }
    const block = source.blocks.find(item => item.uid === selection?.uid);
    if (!block || !Number.isInteger(selection.start) || !Number.isInteger(selection.end) || selection.start < 0 || selection.end < selection.start || selection.end > block.text.length) throw Error('选区已变化，请重新选择正文');
    target = { uid: block.uid };
    if (mode === 'complete' || selection.end > selection.start) Object.assign(target, { start: selection.start, end: selection.end });
  } else if (scope !== 'all') {
    if (!source.blocks.some(block => block.uid === scope)) throw Error('选中的段落已变化，请重新选择');
    target = { uid: scope };
  }
  if (mode === 'complete') {
    const block = source.blocks.find(item => item.uid === target?.uid) || [...source.blocks].reverse().find(item => item.type === 'paragraph');
    if (!block) throw Error('请先选择要补全的正文位置');
    target = target?.start !== undefined ? target : { uid: block.uid, start: block.text.length, end: block.text.length };
  }
  if (mode === 'add_paragraph') target = { uid: target?.uid || source.blocks.at(-1).uid };
  return target;
}

export function revisionSource(article) {
  const blocks = articleBlocks(article.markdown).filter(block => block.type !== 'space');
  if (!blocks.length || blocks.length > 120) throw Error('内容稿需要包含 1 至 120 个内容块');
  return { title: article.title || '', blocks: blocks.map(block => ({ uid: `b-${block.id}`,
    type: block.type === 'image' ? 'image' : block.type === 'heading' ? 'heading' : 'paragraph',
    text: block.text, ...(block.type === 'heading' ? { depth: block.depth } : {}) })) };
}

export function applyRevision(article, plan) {
  const original = new Map(articleBlocks(article.markdown).filter(block => block.type !== 'space').map(block => [`b-${block.id}`, block]));
  const seen = new Set();
  if (!plan || typeof plan.title !== 'string' || !Array.isArray(plan.blocks) || !plan.blocks.length || plan.blocks.length > 120) throw Error('改稿建议不完整');
  const parts = plan.blocks.map(item => {
    if (seen.has(item.uid) || typeof item.text !== 'string') throw Error('改稿建议内容块重复或无效');
    seen.add(item.uid);
    const block = original.get(item.uid);
    if (!block && !/^new-[A-Za-z0-9_-]{1,60}$/.test(item.uid)) throw Error('改稿建议引用了未知内容');
    if (!block) return item.text.trim();
    if (block.text === item.text) return block.raw.trimEnd();
    return changeArticleBlock({ ...block, tail: '' }, item.text).raw;
  });
  if ([...original].some(([uid, block]) => block.type === 'image' && !seen.has(uid))) throw Error('改稿建议遗漏了原有图片，原稿已保留');
  return { title: plan.title, markdown: parts.join('\n\n') + '\n' };
}

export function revisionContinuation(pending, plan, article) {
  const nextSource = revisionSource(article), previous = pending.source;
  if (nextSource.blocks.length !== plan.blocks.length) throw Error('建议中的段落结构已变化，请先采用建议，再选择局部修改');
  const oldIds = new Set(previous.blocks.map(block => block.uid));
  const ids = ['add_paragraph', 'continue'].includes(pending.mode) ? plan.blocks.filter(block => !oldIds.has(block.uid)).map(block => block.uid)
    : pending.target?.ranges?.map(range => range.uid) || pending.target?.uids || (pending.target?.uid ? [pending.target.uid] : []);
  if (!ids.length) return null;
  const mapped = ids.map(uid => nextSource.blocks[plan.blocks.findIndex(block => block.uid === uid)]?.uid);
  if (mapped.some(uid => !uid)) throw Error('建议中的目标位置已变化，请先采用后再编辑');
  if (pending.target?.ranges) return { ranges: pending.target.ranges.map((range, index) => ({ uid: mapped[index], start: range.start,
    end: plan.blocks.find(block => block.uid === range.uid).text.length - (previous.blocks.find(block => block.uid === range.uid).text.length - range.end) })) };
  if (mapped.length > 1) return { uids: mapped };
  const target = { uid: mapped[0] };
  if (pending.target?.start !== undefined) {
    const old = previous.blocks.find(block => block.uid === ids[0]);
    const updated = plan.blocks.find(block => block.uid === ids[0]);
    target.start = pending.target.start; target.end = updated.text.length - (old.text.length - pending.target.end);
  }
  return target;
}
