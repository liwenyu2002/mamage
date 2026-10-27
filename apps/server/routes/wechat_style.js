// routes/wechat_style.js
// 公众号样式块库：POST /extract 从公众号文章链接启发式提取样式块（不落库，预览态）；
// POST /import-article 把整篇文章内容+排版原样解析成内容块序列（不落库，供画布导入）；
// GET/POST/DELETE /blocks 管理本组织已保存的样式块。全部接口要求 ai.generate 权限。
// 挂载于 app.js: app.use('/api/wechat-style', require('./routes/wechat_style'))
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requirePermission } = require('../lib/permissions');
const { resolveWorkspace, sendWorkspaceError } = require('../lib/workspace_access');
const { extractStyleBlocksFromHtml } = require('../lib/wechat_style_extract');
const { extractFullArticleFromHtml } = require('../lib/wechat_article_import');
const { fetchWechatArticleHtml } = require('../lib/wechat_article_source');
const { loadObservedStyleLibrary } = require('../lib/wechat_observed_styles');

// ---- 常量 ----

const MAX_SAVE_BLOCKS = 30; // 与单次提取上限(MAX_BLOCKS=30)对齐，否则"全选保存"必 413
const MAX_TEMPLATE_BYTES = 50 * 1024; // 50KB
const ALLOWED_TYPES = new Set(['h2', 'h3', 'quote', 'divider', 'imageCard', 'signoff']);

// 服务端再洗一遍（防止 POST /blocks 直接绕过 /extract 塞入恶意模板）。
// ⚠️ 与 routes/user_favorites.js 的同名函数同步维护；正则清洗是纵深防御第二道，
// 真正防线是前端 CanvasEditor 渲染前的 DOMPurify。on* 前缀用 [\s/] 同时覆盖空白与
// 斜杠分隔（<svg/onload=> 绕过），并剥 iframe/object/embed 与 javascript: 伪协议。
function sanitizeHtmlTemplate(html) {
  let out = String(html || '');
  out = out.replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<(iframe|object|embed)\b[^>]*>/gi, '');
  out = out.replace(/[\s/]on[a-z]+\s*=\s*"[^"]*"/gi, ' ');
  out = out.replace(/[\s/]on[a-z]+\s*=\s*'[^']*'/gi, ' ');
  out = out.replace(/[\s/]on[a-z]+\s*=\s*[^\s>]+/gi, ' ');
  out = out.replace(/(href|src)\s*=\s*(["']?)\s*(?:javascript|vbscript)\s*:[^"'>\s]*/gi, '$1=$2#');
  // SMIL <animate>/<set> 能在运行时把祖先 <a> 的 href 改写成 javascript: 伪协议（DOMPurify 默认因此整标签
  // 剥除；本站放行 SMIL 以保留可点击 SVG 交互，公开预览是服务端直出、不过客户端 DOMPurify，故这里补齐同等
  // 防线）：剥掉 attributeName 指向 href/xlink:href、或 to/from/by/values 携带伪协议的危险动画元素，保留安全动画。
  out = out.replace(/<(animate|animatetransform|animatemotion|animatecolor|set)\b[^>]*>(?:[\s\S]*?<\/\1\s*>)?/gi, (m) => {
    if (/attributeName\s*=\s*["']?\s*(?:xlink:)?href\b/i.test(m)) return '';
    if (/\b(?:to|from|by|values)\s*=\s*["'][^"']*(?:javascript|vbscript)\s*:/i.test(m)) return '';
    return m;
  });
  return out;
}

function rowToBlock(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    htmlTemplate: row.html_template,
    accentEditable: !!row.accent_editable,
    source: row.source,
    sourceUrl: row.source_url || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
  };
}

// POST /api/wechat-style/extract  body: { url }
// 从公众号文章链接启发式提取样式块，不落库，供前端预览后逐块勾选保存。
router.post('/extract', requirePermission('ai.generate'), async (req, res) => {
  try {
    const url = req.body && req.body.url;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ code: 4001, message: 'url is required' });
    }

    let html;
    let finalUrl;
    try {
      const fetched = await fetchWechatArticleHtml(url);
      html = fetched.html;
      finalUrl = fetched.finalUrl;
    } catch (e) {
      const status = e && e.httpStatus ? e.httpStatus : 502;
      return res.status(status).json({ code: status === 400 ? 4002 : 5020, message: (e && e.message) || '抓取失败' });
    }

    let result;
    try {
      result = extractStyleBlocksFromHtml(html);
    } catch (e) {
      // 目前解析器唯一会 throw 的场景就是找不到 #js_content 容器
      return res.status(422).json({ code: 4220, message: (e && e.message) || '不是有效的公众号文章页' });
    }

    const blocks = result.blocks.map((b) => ({ ...b, sourceUrl: finalUrl }));
    res.json({ blocks, count: blocks.length });
  } catch (e) {
    console.error('POST /api/wechat-style/extract error', e);
    res.status(500).json({ code: 5000, message: 'Internal server error' });
  }
});

// POST /api/wechat-style/import-article  body: { url }
// 整文复现：把公众号文章全文内容+排版原样解析成内容块序列，供前端画布导入。
// 与 /extract（剥文字留模板）互补而非替代，两者共享同一套抓取/校验管线。
router.post('/import-article', requirePermission('ai.generate'), async (req, res) => {
  try {
    const url = req.body && req.body.url;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ code: 4001, message: 'url is required' });
    }

    let html;
    let finalUrl;
    try {
      const fetched = await fetchWechatArticleHtml(url);
      html = fetched.html;
      finalUrl = fetched.finalUrl;
    } catch (e) {
      const status = e && e.httpStatus ? e.httpStatus : 502;
      return res.status(status).json({ code: status === 400 ? 4002 : 5020, message: (e && e.message) || '抓取失败' });
    }

    let result;
    try {
      result = extractFullArticleFromHtml(html);
    } catch (e) {
      // 解析器目前唯一会 throw 的场景：找不到 #js_content 容器，或内容超出体积上限
      return res.status(422).json({ code: 4221, message: (e && e.message) || '不是有效的公众号文章页' });
    }

    // 服务端再洗一遍（防止解析器本身的白名单有漏网之鱼），与 POST /blocks 落库前的处理口径一致
    const blocks = result.blocks.map((b) => sanitizeHtmlTemplate(b));
    res.json({
      title: result.title,
      author: result.author,
      blocks,
      imageCount: result.imageCount,
      blockCount: blocks.length,
      sourceUrl: finalUrl,
    });
  } catch (e) {
    console.error('POST /api/wechat-style/import-article error', e);
    res.status(500).json({ code: 5000, message: 'Internal server error' });
  }
});

// GET /api/wechat-style/blocks  当前 org 已保存的样式块列表
router.get('/blocks', requirePermission('ai.generate'), async (req, res) => {
  try {
    const orgId = (req.user && req.user.organization_id !== undefined) ? req.user.organization_id : null;
    const workspace = await resolveWorkspace(req);
    // <=> 为 MySQL NULL 安全等于，兼容用户暂未归属任何组织（org_id 为 NULL）的场景
    const [rows] = await pool.query(
      `SELECT * FROM wechat_style_blocks WHERE org_id <=> ?
       ${workspace.enabled ? (workspace.unitId ? 'AND unit_id = ?' : 'AND unit_id IS NULL') : ''}
       ORDER BY created_at DESC LIMIT 500`,
      workspace.enabled && workspace.unitId ? [orgId, workspace.unitId] : [orgId]
    );
    let observed = [];
    try { observed = (await loadObservedStyleLibrary(pool, workspace)).blocks; }
    catch (error) { console.warn('[wechat.style.observed]', error.code || 'OBSERVED_STYLES_UNAVAILABLE'); }
    res.json({ blocks: [...(rows || []).map(rowToBlock), ...observed] });
  } catch (e) {
    if (sendWorkspaceError(res, e)) return;
    console.error('GET /api/wechat-style/blocks error', e);
    res.status(500).json({ code: 5000, message: 'Internal server error' });
  }
});

router.get('/monitor-templates', requirePermission('ai.generate'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    const result = await loadObservedStyleLibrary(pool, workspace);
    res.set('Cache-Control', 'private, no-store').json(result);
  } catch (error) {
    if (sendWorkspaceError(res, error)) return;
    console.error('[wechat.style.templates]', error.code || 'OBSERVED_STYLES_UNAVAILABLE');
    res.status(503).json({ message: '推文观察库样式暂不可用' });
  }
});

// POST /api/wechat-style/blocks  body: { blocks: [{type,name,htmlTemplate,accentEditable,sourceUrl}] }
// 批量保存提取结果（或用户自建块），≤30/次（与提取上限对齐）。
router.post('/blocks', requirePermission('ai.generate'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (workspace.enabled && (!workspace.unitId || (!workspace.collegeAdmin && !['editor', 'manager'].includes(workspace.role)))) {
      return res.status(403).json({ error: 'UNIT_EDITOR_REQUIRED' });
    }
    const input = req.body && req.body.blocks;
    if (!Array.isArray(input) || input.length === 0) {
      return res.status(400).json({ code: 4001, message: 'blocks is required (non-empty array)' });
    }
    if (input.length > MAX_SAVE_BLOCKS) {
      return res.status(413).json({ code: 4132, message: `blocks exceed max ${MAX_SAVE_BLOCKS} per request` });
    }

    const rowsToInsert = [];
    for (let i = 0; i < input.length; i += 1) {
      const b = input[i] || {};
      const type = String(b.type || '').trim();
      if (!ALLOWED_TYPES.has(type)) {
        return res.status(400).json({ code: 4003, message: `blocks[${i}].type invalid: ${type}` });
      }
      const name = String(b.name || '').trim().slice(0, 64);
      if (!name) {
        return res.status(400).json({ code: 4004, message: `blocks[${i}].name is required` });
      }
      const rawTemplate = String(b.htmlTemplate || '');
      if (!rawTemplate.trim()) {
        return res.status(400).json({ code: 4005, message: `blocks[${i}].htmlTemplate is required` });
      }
      if (Buffer.byteLength(rawTemplate, 'utf8') > MAX_TEMPLATE_BYTES) {
        return res.status(413).json({ code: 4133, message: `blocks[${i}].htmlTemplate exceeds ${MAX_TEMPLATE_BYTES} bytes` });
      }
      const htmlTemplate = sanitizeHtmlTemplate(rawTemplate);
      const accentEditable = !!b.accentEditable;
      const sourceUrl = b.sourceUrl ? String(b.sourceUrl).slice(0, 512) : null;

      rowsToInsert.push({ type, name, htmlTemplate, accentEditable, sourceUrl });
    }

    const orgId = (req.user && req.user.organization_id !== undefined) ? req.user.organization_id : null;
    const createdBy = req.user && req.user.id ? req.user.id : null;

    const insertedIds = [];
    for (const r of rowsToInsert) {
      // source 恒为 'extracted'：builtin 块只存在于前端内置数组，不经此接口落库，防止客户端伪造 source='builtin'
      const [result] = await pool.query(
        `INSERT INTO wechat_style_blocks
           (org_id, unit_id, type, name, html_template, accent_editable, source, source_url, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'extracted', ?, ?, NOW())`,
        [orgId, workspace.enabled ? workspace.unitId : null, r.type, r.name, r.htmlTemplate,
          r.accentEditable ? 1 : 0, r.sourceUrl, createdBy]
      );
      insertedIds.push(result.insertId);
    }

    const [savedRows] = await pool.query(
      `SELECT * FROM wechat_style_blocks WHERE id IN (${insertedIds.map(() => '?').join(',')}) ORDER BY id ASC`,
      insertedIds
    );
    res.status(201).json({ blocks: (savedRows || []).map(rowToBlock) });
  } catch (e) {
    if (sendWorkspaceError(res, e)) return;
    console.error('POST /api/wechat-style/blocks error', e);
    res.status(500).json({ code: 5000, message: 'Internal server error' });
  }
});

// DELETE /api/wechat-style/blocks/:id  本 org 且（创建者本人或 admin/superadmin）
router.delete('/blocks/:id', requirePermission('ai.generate'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ code: 4001, message: 'invalid id' });

    const [rows] = await pool.query('SELECT * FROM wechat_style_blocks WHERE id = ? LIMIT 1', [id]);
    if (!rows || rows.length === 0) return res.status(404).json({ code: 4041, message: 'block not found' });
    const row = rows[0];

    const orgId = (req.user && req.user.organization_id !== undefined) ? req.user.organization_id : null;
    const rowOrgId = row.org_id === undefined ? null : row.org_id;
    // 跨组织一律 404，不暴露"存在但无权"这一信息
    const sameOrg = (rowOrgId === null && orgId === null) || (rowOrgId !== null && orgId !== null && Number(rowOrgId) === Number(orgId));
    if (!sameOrg) return res.status(404).json({ code: 4041, message: 'block not found' });

    if (workspace.enabled && (!workspace.unitId || Number(row.unit_id) !== workspace.unitId)) {
      return res.status(404).json({ code: 4041, message: 'block not found' });
    }

    const requesterId = req.user && req.user.id ? Number(req.user.id) : null;
    const isOwner = requesterId !== null && row.created_by !== null && Number(row.created_by) === requesterId;
    const isAdmin = workspace.enabled ? (workspace.collegeAdmin || workspace.role === 'manager')
      : req.user && (req.user.role === 'admin' || req.user.role === 'superadmin');
    if (!isOwner && !isAdmin) return res.status(403).json({ code: 4030, message: 'forbidden' });

    await pool.query('DELETE FROM wechat_style_blocks WHERE id = ?', [id]);
    res.json({ deleted: true, id });
  } catch (e) {
    if (sendWorkspaceError(res, e)) return;
    console.error('DELETE /api/wechat-style/blocks/:id error', e);
    res.status(500).json({ code: 5000, message: 'Internal server error' });
  }
});

module.exports = router;
