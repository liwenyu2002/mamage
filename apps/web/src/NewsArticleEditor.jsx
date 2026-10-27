import React from 'react';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { Slice, Fragment } from 'prosemirror-model';
import { baseKeymap, splitBlockAs } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import 'prosemirror-view/style/prosemirror.css';
import { TextArea } from './ui';
import { editorDocument, editorMarkdown, editorSelection, setEditorBlockStyle, newsEditorSchema as schema } from './utils/newsEditorModel';
import NewsPhotoPicker from './NewsPhotoPicker';
import NewsBlockControls from './NewsBlockControls';

const plugins = callbacks => [keymap({
  'Mod-z': () => { callbacks.current.onUndo?.(); return true; },
  'Mod-Shift-z': () => { callbacks.current.onRedo?.(); return true; },
  'Mod-y': () => { callbacks.current.onRedo?.(); return true; },
  'Mod-Alt-0': setEditorBlockStyle('paragraph'),
  'Mod-Alt-1': setEditorBlockStyle('h1'),
  'Mod-Alt-2': setEditorBlockStyle('h2'),
  'Mod-Alt-3': setEditorBlockStyle('h3'),
  'Shift-Enter': (state, dispatch) => {
    if (state.selection.$from.parent.type.name === 'photo') return false;
    dispatch?.(state.tr.insertText('\n').setMeta('newsEditBoundary', true).scrollIntoView()); return true;
  },
  Enter: (state, dispatch) => {
    if (state.selection.$from.parent.type.name !== 'photo') return splitBlockAs(() => ({ type: schema.nodes.paragraph }))(state, transaction => dispatch?.(transaction.setMeta('newsEditBoundary', true)));
    const pos = state.selection.$from.after(), transaction = state.tr.insert(pos, schema.nodes.paragraph.create());
    if (dispatch) dispatch(transaction.setSelection(TextSelection.create(transaction.doc, pos + 1)).setMeta('newsEditBoundary', true).scrollIntoView());
    return true;
  },
}), keymap(baseKeymap)];
export default function NewsArticleEditor({ markdown, onChange, title, onChangeTitle, onPhotosAdded, onSelectionChange, highlight, onUndo, onRedo }) {
  const host = React.useRef(null), view = React.useRef(null), emitted = React.useRef(markdown);
  const callbacks = React.useRef(null); callbacks.current = { onChange, onSelectionChange, onUndo, onRedo };
  const editSession = React.useRef(`manual-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const typing = React.useRef({ group: 0, caret: null });
  const captureRef = React.useRef(null), pointerDown = React.useRef(false);
  const highlighted = React.useRef(highlight); highlighted.current = highlight;
  const captionEditing = React.useRef(null);
  const [editorDoc, setEditorDoc] = React.useState(null);
  const [picking, setPicking] = React.useState(null), [insertError, setInsertError] = React.useState('');
  const [missingTitle, setMissingTitle] = React.useState(false);
  const updateMeta = doc => {
    const nodes = []; doc.forEach(node => nodes.push(node));
    setMissingTitle(!nodes.some(node => node.type.name === 'heading' && node.attrs.depth === 1));
  };
  captureRef.current = (event, explicit = false) => {
    const editor = view.current;
    if (!editor || editor.composing || (!explicit && (pointerDown.current || !editor.hasFocus()))) return;
    if (editor.state.selection.empty && !explicit) return;
    const selection = editorSelection(editor.state.doc, editor.state.selection);
    if (!selection.ranges.length) return;
    if (selection.markdown !== emitted.current) { emitted.current = selection.markdown; callbacks.current.onChange(selection.markdown, { record: false }); }
    const rect = editor.coordsAtPos(editor.state.selection.to), first = editor.coordsAtPos(editor.state.selection.from);
    callbacks.current.onSelectionChange?.({ ...selection, explicit, editorRange: { from: editor.state.selection.from, to: editor.state.selection.to }, anchor: {
      x: event?.clientX ?? rect.left, top: Math.min(first.top, rect.top), bottom: Math.max(first.bottom, rect.bottom),
    }, nonce: Date.now() });
  };
  React.useLayoutEffect(() => {
    const editor = new EditorView(host.current, {
      state: EditorState.create({ schema, doc: editorDocument(markdown), plugins: plugins(callbacks) }),
      attributes: { class: 'news-edit-document', 'aria-label': '内容稿正文', spellcheck: 'false' },
      decorations: state => {
        const decorations = []; let paragraph = 0, index = 0, titleFound = false;
        state.doc.forEach((node, pos) => {
          const label = node.type.name === 'heading' ? node.attrs.depth === 1 && !titleFound ? '稿件标题' : ['', '一级标题', '二级标题', '三级标题'][node.attrs.depth] || '小标题' : node.type.name === 'photo' ? '图片说明' : `正文段落 ${++paragraph}`;
          if (node.type.name === 'heading' && node.attrs.depth === 1) titleFound = true;
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-news-index': String(index++), ...(node.type.name !== 'photo' ? {
            role: 'textbox', 'aria-label': label, 'aria-multiline': 'true',
          } : { 'data-caption-empty': node.textContent.trim() ? 'false' : 'true', 'data-caption-editing': captionEditing.current === pos ? 'true' : 'false' }) }));
        });
        const snapshot = highlighted.current, range = snapshot?.editorRange;
        if (range && Number.isInteger(range.from) && Number.isInteger(range.to) && range.from < range.to
          && range.from >= 0 && range.to <= state.doc.content.size && snapshot.markdown === editorMarkdown(state.doc).markdown) {
          state.doc.forEach((node, pos) => {
            // A cross-photo edit excludes its caption, just like editorSelection.
            if (node.type.name === 'photo' && (range.from < pos + 1 || range.to > pos + 1 + node.textContent.length)) return;
            const from = Math.max(pos + 1, range.from), to = Math.min(pos + 1 + node.textContent.length, range.to);
            if (from < to) decorations.push(Decoration.inline(from, to, { class: 'news-ai-selection' }));
          });
        }
        return DecorationSet.create(state.doc, decorations);
      },
      dispatchTransaction: transaction => {
        const origin = editor.state.selection.$from;
        const replacement = !editor.composing && transaction.getMeta('composition') == null
          && transaction.steps.some(step => Number.isInteger(step.from) && step.to - step.from > 1);
        const boundary = transaction.getMeta('newsEditBoundary') || replacement;
        if (boundary || (typing.current.caret !== null && typing.current.caret !== origin.pos)) typing.current.group++;
        const group = boundary ? null : `${editSession.current}:${origin.depth ? origin.before() : 0}:${typing.current.group}`;
        const nextState = editor.state.apply(transaction);
        if (captionEditing.current !== null) {
          const mapped = transaction.mapping.map(captionEditing.current);
          captionEditing.current = nextState.selection.$from.parent.type.name === 'photo' && nextState.selection.$from.before() === mapped ? mapped : null;
        }
        editor.updateState(nextState);
        if (transaction.docChanged) {
          setEditorDoc(nextState.doc);
          typing.current.caret = editor.state.selection.from;
          emitted.current = editorMarkdown(editor.state.doc).markdown;
          callbacks.current.onChange(emitted.current, { group }); callbacks.current.onSelectionChange?.(null); updateMeta(editor.state.doc);
        }
      },
      handleTextInput: (editor, from, to, text) => {
        const { $from, empty } = editor.state.selection;
        if (editor.composing || !empty || from !== to || text !== ' ' || $from.parent.type.name !== 'paragraph'
          || !/^#{1,3}$/.test($from.parent.textContent) || $from.parentOffset !== $from.parent.content.size) return false;
        const depth = $from.parent.textContent.length;
        editor.dispatch(editor.state.tr.delete($from.start(), from).setNodeMarkup($from.before(), schema.nodes.heading, { depth })
          .setMeta('newsEditBoundary', true).scrollIntoView()); return true;
      },
      handlePaste: (editor, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (text == null) return false;
        if (editor.state.selection.$from.parent.type.name === 'photo') {
          editor.dispatch(editor.state.tr.insertText(text.replace(/[\r\n]+/g, ' ')).setMeta('newsEditBoundary', true)); return true;
        }
        const nodes = text.replace(/\r\n/g, '\n').split('\n').map(line => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
        editor.dispatch(editor.state.tr.replaceSelection(new Slice(Fragment.from(nodes), 1, 1)).setMeta('newsEditBoundary', true).scrollIntoView());
        return true;
      },
      handleDOMEvents: {
        pointerdown: () => { pointerDown.current = true; callbacks.current.onSelectionChange?.(null); return false; },
        pointerup: (_, event) => { pointerDown.current = false; setTimeout(() => captureRef.current(event), 0); return false; },
        keyup: (editor, event) => {
          if (event.key === 'Escape') callbacks.current.onSelectionChange?.(null);
          else if (/^(Arrow|Home|End|Shift)/.test(event.key)) {
            if (editor.state.selection.empty) callbacks.current.onSelectionChange?.(null);
            else captureRef.current();
          }
          return false;
        },
        compositionstart: () => { callbacks.current.onSelectionChange?.(null); return false; },
        beforeinput: (_, event) => {
          if (['historyUndo', 'historyRedo'].includes(event.inputType)) {
            event.preventDefault(); callbacks.current[event.inputType === 'historyUndo' ? 'onUndo' : 'onRedo']?.(); return true;
          }
          return false;
        },
        drop: (_, event) => { event.preventDefault(); return true; },
      },
    });
    view.current = editor; setEditorDoc(editor.state.doc); updateMeta(editor.state.doc);
    const onSelection = () => {
      clearTimeout(timer);
      if (!window.getSelection()?.isCollapsed) timer = setTimeout(() => {
        // Ignore a delayed selection event after typing has already replaced it.
        if (!window.getSelection()?.isCollapsed && !editor.state.selection.empty) captureRef.current();
      }, 120);
    };
    const finishPointer = event => { if (pointerDown.current) { pointerDown.current = false; setTimeout(() => captureRef.current(event), 0); } };
    let timer;
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('pointerup', finishPointer);
    return () => { clearTimeout(timer); document.removeEventListener('selectionchange', onSelection); document.removeEventListener('pointerup', finishPointer); view.current = null; editor.destroy(); };
  }, []);
  React.useLayoutEffect(() => {
    if (markdown === emitted.current || !view.current) return;
    emitted.current = markdown;
    captionEditing.current = null;
    const doc = editorDocument(markdown), position = Math.min(view.current.state.selection.from, doc.content.size);
    view.current.updateState(EditorState.create({ schema, doc, selection: TextSelection.near(doc.resolve(position)), plugins: plugins(callbacks) }));
    setEditorDoc(doc);
    updateMeta(view.current.state.doc);
  }, [markdown]);
  React.useLayoutEffect(() => { view.current?.setProps({}); }, [highlight]);
  const insert = (pos, content = schema.nodes.paragraph.create()) => {
    const editor = view.current, transaction = editor.state.tr.insert(pos, content);
    editor.dispatch(transaction.setSelection(TextSelection.create(transaction.doc, pos + 1)).setMeta('newsEditBoundary', true).scrollIntoView());
    editor.focus();
  };
  const blockAction = (action, target, value) => {
    const editor = view.current;
    if (!target || target.doc !== editor.state.doc) return;
    callbacks.current.onSelectionChange?.(null); setInsertError('');
    if (action === 'menu') return;
    if (action === 'insert') { insert(target.pos); return; }
    const node = editor.state.doc.nodeAt(target.pos); if (!node?.isBlock) return;
    if (action === 'insertBefore' || action === 'insertAfter') { insert(target.pos + (action === 'insertAfter' ? node.nodeSize : 0)); return; }
    if (action === 'photo') { setPicking({ pos: target.pos + node.nodeSize, doc: editor.state.doc }); return; }
    if (action === 'addCaption' && node.type.name === 'photo') {
      captionEditing.current = target.pos;
      editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target.pos + 1)).scrollIntoView()); editor.focus(); return;
    }
    if (action === 'removeCaption' && node.type.name === 'photo') {
      captionEditing.current = null;
      editor.dispatch(editor.state.tr.delete(target.pos + 1, target.pos + node.nodeSize - 1).setMeta('newsEditBoundary', true)); return;
    }
    const inside = editor.state.selection.from >= target.pos + 1 && editor.state.selection.to <= target.pos + node.nodeSize - 1;
    if (action === 'format' && node.type.name !== 'photo') {
      const type = value === 'paragraph' ? schema.nodes.paragraph : schema.nodes.heading;
      const attrs = value === 'paragraph' ? { original: null } : { original: null, depth: Number(value.slice(1)) };
      const transaction = editor.state.tr.setNodeMarkup(target.pos, type, attrs);
      if (!inside) transaction.setSelection(TextSelection.near(transaction.doc.resolve(target.pos + 1)));
      editor.dispatch(transaction.setMeta('newsEditBoundary', true).scrollIntoView()); editor.focus();
    } else if (action === 'ai') {
      if (!inside) editor.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(target.pos + 1))));
      editor.focus(); captureRef.current(null, true);
    } else if (action === 'delete') {
      const transaction = editor.state.tr.delete(target.pos, target.pos + node.nodeSize);
      editor.dispatch(transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(target.pos, transaction.doc.content.size))))
        .setMeta('newsEditBoundary', true).scrollIntoView()); editor.focus();
    } else if (action === 'move') {
      const nodes = []; editor.state.doc.forEach(block => nodes.push(block));
      const destination = target.index + value;
      if (destination < 0 || destination >= nodes.length) return;
      [nodes[target.index], nodes[destination]] = [nodes[destination], nodes[target.index]];
      const transaction = editor.state.tr.replaceWith(0, editor.state.doc.content.size, nodes);
      const pos = nodes.slice(0, destination).reduce((sum, block) => sum + block.nodeSize, 0) + 1;
      editor.dispatch(transaction.setSelection(TextSelection.near(transaction.doc.resolve(pos))).setMeta('newsEditBoundary', true).scrollIntoView()); editor.focus();
    }
  };
  return <div className="news-article-editor" aria-label="编辑稿件">
    {missingTitle ? <TextArea className="news-edit-title" aria-label="稿件标题" value={title || ''} rows={2} onChange={onChangeTitle} /> : null}
    <NewsBlockControls editorRef={view} revision={editorDoc} onAction={blockAction}><div ref={host} /></NewsBlockControls>
    {insertError ? <p role="alert" className="news-input-error">{insertError}</p> : null}
    {picking ? <NewsPhotoPicker photos={[]} onClose={() => setPicking(null)} onConfirm={photos => {
      const editor = view.current;
      if (picking.doc !== editor.state.doc) { setInsertError('正文已变化，请重新选择插入位置'); setPicking(null); return; }
      const existing = new Set(); editor.state.doc.forEach(node => { if (node.type.name === 'photo') existing.add(node.attrs.href); });
      const added = photos.filter(photo => !existing.has(photo.url || photo.thumbUrl)).slice(0, Math.max(0, 30 - existing.size));
      const nodes = added.filter(photo => /^(https?:\/\/|\/[^/])/.test(photo.url || photo.thumbUrl || '')).map(photo => schema.nodes.photo.create({ href: photo.url || photo.thumbUrl }));
      if (nodes.length) { insert(picking.pos, nodes); onPhotosAdded?.(added); } setPicking(null);
    }} /> : null}
  </div>;
}
