// 运行在页面「主世界」（由 content.js 以 <script> 注入），才能访问微信编辑器全局 __MP_Editor_JSAPI__，
// 也才能读到 window.wx.commonData（上传票据）并以本页 cookie 调公众号内部上传接口。
//
// 做两件事：
//  1) 图片过户：插入前把正文里引用的 mmbiz/qpic 图片（background-image url()、<image href>、<img src>）
//     逐张下载→上传到「你自己的公众号素材库」，拿到新的 cdn_url，改写回 HTML（url() 保持无引号）。
//     ——否则别人账号的 mmbiz 外链在公众号发布白名单里会被剥掉，导致 Color Walk 这类「背景层上色」
//        点了没反应（SMIL 有触发，但底下该显现的彩色图没了）。
//  2) 走微信官方 API 插入：__MP_Editor_JSAPI__.invoke({apiName:"mp_editor_insert_html"})，
//     裸 SVG(含 <set begin="click">/pointer-events) 经此 API 完整进 ProseMirror，交互属性保留。
//
// 逆向依据：壹伴 content-script.js 的上传即
//   POST https://mp.weixin.qq.com/cgi-bin/filetransfer?action=upload_material&f=json&scene=8
//        &writetype=doublewrite&groupid=1&ticket_id=<user_name>&ticket=<ticket>&svr_time=<s>&token=<token>&lang=zh_CN&seq=<ms>
//   body: FormData{file}  →  resp.base_resp.ret==0 且 resp.cdn_url 为新链接。
(function () {
  var WX_IMG_HOST = /(?:^|\.)qpic\.cn$|(?:^|\.)qlogo\.cn$/i;
  var PROXY = 'https://mamage.wenyuli.site/api/wx-img?url='; // 直取失败时的兜底（去 referer + 开 CORS）
  var CONCURRENCY = 3;
  var IMG_FETCH_TIMEOUT = 15000;

  function post(msg) { try { window.postMessage(msg, '*'); } catch (_) {} }
  function hostOf(u) { try { return new URL(u, location.href).hostname; } catch (_) { return ''; } }
  function isWxImg(u) { return /^https?:\/\//i.test(u) && WX_IMG_HOST.test(hostOf(u)); }

  // 收集正文里所有需要过户的远程图链接（去重）
  function collectUrls(html) {
    var set = Object.create(null), order = [];
    function add(u) { if (u && isWxImg(u) && !set[u]) { set[u] = 1; order.push(u); } }
    var m, re1 = /url\(\s*['"]?(https?:\/\/[^)'"]+?)['"]?\s*\)/gi;
    while ((m = re1.exec(html))) add(m[1]);
    var re2 = /(?:xlink:href|href|src)\s*=\s*['"](https?:\/\/[^'"]+?)['"]/gi;
    while ((m = re2.exec(html))) add(m[1]);
    return order;
  }

  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  // 取图字节：先直取（mp.weixin 生态 referer 一般可拿原图），太小/失败再走我们代理
  async function fetchBlob(u) {
    try {
      var r = await withTimeout(fetch(u, { credentials: 'omit' }), IMG_FETCH_TIMEOUT);
      if (r && r.ok) { var b = await r.blob(); if (b && b.size > 2048) return b; }
    } catch (_) {}
    var r2 = await withTimeout(fetch(PROXY + encodeURIComponent(u), { credentials: 'omit' }), IMG_FETCH_TIMEOUT);
    if (!r2.ok) throw new Error('img ' + r2.status);
    var b2 = await r2.blob();
    if (!b2 || b2.size < 64) throw new Error('img empty');
    return b2;
  }

  function uploadParams() {
    var token = (location.href.match(/[?&]token=(\d+)/) || [])[1] || '';
    var ticket = '', ticketId = '';
    try { var d = window.wx.commonData.data; ticket = d.ticket || ''; ticketId = d.user_name || ''; } catch (_) {}
    if (!ticket || !ticketId) {
      var h = document.documentElement.innerHTML;
      if (!ticket) { var a = h.match(/ticket:\s?"([^"]+)"/); if (a) ticket = a[1]; }
      if (!ticketId) { var b = h.match(/user_name:\s?"([^"]+)"/); if (b) ticketId = b[1]; }
    }
    return { token: token, ticket: ticket, ticketId: ticketId };
  }

  async function uploadToMaterial(blob) {
    var p = uploadParams();
    if (!p.token || !p.ticket || !p.ticketId) throw new Error('缺上传票据(请在公众号后台图文编辑页使用)');
    var fd = new FormData();
    fd.append('file', blob, 'mamage.png');
    var url = 'https://mp.weixin.qq.com/cgi-bin/filetransfer?action=upload_material&f=json&scene=8' +
      '&writetype=doublewrite&groupid=1&ticket_id=' + encodeURIComponent(p.ticketId) +
      '&ticket=' + encodeURIComponent(p.ticket) + '&svr_time=' + Math.floor(Date.now() / 1e3) +
      '&token=' + p.token + '&lang=zh_CN&seq=' + Date.now();
    var resp = await fetch(url, { method: 'POST', body: fd, credentials: 'include' });
    var j = await resp.json();
    if (!j || !j.base_resp || j.base_resp.ret !== 0 || !j.cdn_url) {
      throw new Error('上传失败 ret=' + (j && j.base_resp && j.base_resp.ret));
    }
    return j.cdn_url;
  }

  // 用过户映射改写 HTML：background url() 保持「无引号」（公众号会过滤带引号的 url()）；属性值保留引号
  function rewrite(html, map) {
    html = html.replace(/url\(\s*['"]?(https?:\/\/[^)'"]+?)['"]?\s*\)/gi, function (full, u) {
      return map[u] ? 'url(' + map[u] + ')' : full;
    });
    html = html.replace(/((?:xlink:href|href|src)\s*=\s*)(['"])(https?:\/\/[^'"]+?)\2/gi, function (full, pre, q, u) {
      return map[u] ? pre + q + map[u] + q : full;
    });
    return html;
  }

  async function rehost(html, reqId) {
    var urls = collectUrls(html);
    if (!urls.length) return html;
    post({ __mamage: 'progress', reqId: reqId, text: '发现 ' + urls.length + ' 张图，正在过户到你的素材库…' });
    var map = Object.create(null), done = 0, fail = 0;
    var queue = urls.slice();
    async function worker() {
      while (queue.length) {
        var u = queue.shift();
        try { map[u] = await uploadToMaterial(await fetchBlob(u)); }
        catch (e) { fail++; } // 失败保留原链接，不阻断整体插入
        done++;
        post({ __mamage: 'progress', reqId: reqId, text: '过户 ' + done + '/' + urls.length + (fail ? '（失败 ' + fail + '）' : '') + '…' });
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
    return rewrite(html, map);
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || d.__mamage !== 'insert' || typeof d.html !== 'string') return;

    function reply(ok, err) {
      post({ __mamage: 'result', reqId: d.reqId, ok: ok, err: err || '' });
    }

    (async function () {
      var html = d.html;
      if (d.rehost !== false) {
        try { html = await rehost(html, d.reqId); }
        catch (e) { post({ __mamage: 'progress', reqId: d.reqId, text: '图片过户异常，按原图插入：' + ((e && e.message) || e) }); }
      }
      var api = window.__MP_Editor_JSAPI__;
      if (!api || typeof api.invoke !== 'function') {
        reply(false, '编辑器 API 未就绪（请在「图文消息」编辑页使用，并等页面加载完）');
        return;
      }
      try {
        api.invoke({
          apiName: 'mp_editor_insert_html',
          apiParam: { html: html },
          sucCb: function () { reply(true); },
          errCb: function (x) { reply(false, (function () { try { return JSON.stringify(x); } catch (_) { return String(x); } })().slice(0, 160)); },
        });
      } catch (err) {
        reply(false, (err && err.message) ? err.message : String(err));
      }
    })();
  }, false);
})();
