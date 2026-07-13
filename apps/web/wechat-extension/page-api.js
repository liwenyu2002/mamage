// 运行在页面「主世界」（由 content.js 以 <script> 注入），才能访问微信编辑器全局 __MP_Editor_JSAPI__。
// 内容脚本(隔离世界)通过 window.postMessage 把要插入的 SVG 源码传进来，这里调微信官方 API 插入。
// 逆向依据：壹伴 mpa-editor.js 就是调 __MP_Editor_JSAPI__.invoke({apiName:"mp_editor_insert_html", apiParam:{html}})，
// 实测裸 SVG(含 <set begin="click">)经此 API 能进 ProseMirror 模型、交互属性(begin/set/pointer-events)完整保留。
(function () {
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || d.__mamage !== 'insert' || typeof d.html !== 'string') return;

    function reply(ok, err) {
      window.postMessage({ __mamage: 'result', reqId: d.reqId, ok: ok, err: err || '' }, '*');
    }

    var api = window.__MP_Editor_JSAPI__;
    if (!api || typeof api.invoke !== 'function') {
      reply(false, '编辑器 API 未就绪（请在「图文消息」编辑页使用，并等页面加载完）');
      return;
    }
    try {
      api.invoke({
        apiName: 'mp_editor_insert_html',
        apiParam: { html: d.html },
        sucCb: function () { reply(true); },
        errCb: function (x) { reply(false, (function () { try { return JSON.stringify(x); } catch (_) { return String(x); } })().slice(0, 160)); },
      });
    } catch (err) {
      reply(false, (err && err.message) ? err.message : String(err));
    }
  }, false);
})();
