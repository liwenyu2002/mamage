// 内容脚本（隔离世界）：负责 UI + 把 page-api.js 注入页面主世界。
// 公众号文章编辑页(mp.weixin.qq.com/cgi-bin/appmsg…)右下角加一个悬浮按钮，点开面板：
// 粘贴 MaMage 排版器「复制·SVG源码版」的源码 → 点插入 → 经主世界的 page-api 调微信官方 API 写入正文。
(function () {
  // 1) 注入主世界脚本（内容脚本访问不到 __MP_Editor_JSAPI__，必须注入到页面上下文）
  var s = document.createElement('script');
  s.src = chrome.runtime.getURL('page-api.js');
  s.onload = function () { s.remove(); };
  (document.head || document.documentElement).appendChild(s);

  var pending = {}; // reqId -> {done, progress, timer}
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || (d.__mamage !== 'result' && d.__mamage !== 'progress')) return;
    var cb = pending[d.reqId];
    if (!cb) return;
    if (d.__mamage === 'progress') {
      if (cb.progress) cb.progress(d.text || '');
      cb.arm(45000); // 每有进展就续命，图片过户可能较久
      return;
    }
    clearTimeout(cb.timer);
    delete pending[d.reqId];
    cb.done(d.ok, d.err);
  }, false);

  function insertHtml(html, onProgress, onDone) {
    var reqId = 'r' + Math.random().toString(36).slice(2);
    var entry = {
      done: onDone,
      progress: onProgress,
      timer: null,
      arm: function (ms) { clearTimeout(entry.timer); entry.timer = setTimeout(function () { if (pending[reqId]) { delete pending[reqId]; onDone(false, '超时无响应'); } }, ms); },
    };
    pending[reqId] = entry;
    window.postMessage({ __mamage: 'insert', reqId: reqId, html: html }, '*');
    entry.arm(20000);
  }

  function build() {
    if (document.getElementById('mamage-svg-fab')) return;

    var fab = document.createElement('button');
    fab.id = 'mamage-svg-fab';
    fab.type = 'button';
    fab.textContent = 'MaMage 插入';
    fab.style.cssText = 'position:fixed;right:22px;bottom:132px;z-index:2147483646;padding:10px 16px;background:#2b6fe0;color:#fff;border:0;border-radius:22px;box-shadow:0 4px 16px rgba(20,30,50,.28);cursor:pointer;font:14px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;';

    var panel = document.createElement('div');
    panel.id = 'mamage-svg-panel';
    panel.style.cssText = 'display:none;position:fixed;right:22px;bottom:180px;z-index:2147483647;width:380px;max-width:90vw;background:#fff;border:1px solid #e4e8ef;border-radius:12px;box-shadow:0 10px 34px rgba(20,30,50,.2);padding:14px;font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#1a2030;box-sizing:border-box;';
    panel.innerHTML =
      '<div style="font-weight:700;font-size:14px;margin-bottom:6px">插入 MaMage 排版（保 SVG 交互）</div>' +
      '<div style="color:#5b6675;margin-bottom:8px">在排版器点「复制·SVG源码版」，把源码粘到下框，点「插入正文」。走微信官方编辑器 API 保留点击交互；正文里引用的图片会自动过户到你的素材库（否则发布后会被剥掉）。</div>' +
      '<textarea id="mamage-src" placeholder="在此粘贴 SVG 源码…" spellcheck="false" style="width:100%;height:130px;box-sizing:border-box;border:1px solid #e4e8ef;border-radius:8px;padding:8px;font:12px/1.45 ui-monospace,Menlo,monospace;resize:vertical;color:#1a2030"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button id="mamage-paste" type="button" style="padding:7px 12px;border:1px solid #e4e8ef;border-radius:8px;background:#fafbfd;cursor:pointer">读剪贴板</button>' +
        '<button id="mamage-do" type="button" style="flex:1;padding:7px 12px;border:0;border-radius:8px;background:#2b6fe0;color:#fff;cursor:pointer;font-weight:600">插入正文</button>' +
        '<button id="mamage-close" type="button" style="padding:7px 12px;border:1px solid #e4e8ef;border-radius:8px;background:#fff;cursor:pointer">关闭</button>' +
      '</div>' +
      '<div id="mamage-msg" style="margin-top:8px;min-height:16px;color:#16805a"></div>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    function msg(t, err) { var m = panel.querySelector('#mamage-msg'); m.textContent = t; m.style.color = err ? '#c0392b' : '#16805a'; }

    fab.addEventListener('click', function () { panel.style.display = (panel.style.display === 'none') ? 'block' : 'none'; });
    panel.querySelector('#mamage-close').addEventListener('click', function () { panel.style.display = 'none'; });
    panel.querySelector('#mamage-paste').addEventListener('click', async function () {
      try { panel.querySelector('#mamage-src').value = await navigator.clipboard.readText(); msg('已读入剪贴板'); }
      catch (e) { msg('读剪贴板失败，请手动粘贴（Ctrl/⌘+V）', true); }
    });
    panel.querySelector('#mamage-do').addEventListener('click', function () {
      var btn = panel.querySelector('#mamage-do');
      var html = panel.querySelector('#mamage-src').value;
      if (!html || html.indexOf('<') < 0) { msg('内容不像 HTML 源码', true); return; }
      btn.disabled = true;
      msg('准备插入…');
      insertHtml(html, function (text) { msg(text); }, function (ok, err) {
        btn.disabled = false;
        if (ok) { msg('✅ 已插入正文（图片已过户到你的素材库），请检查后保存/预览'); }
        else { msg('插入失败：' + (err || '未知'), true); }
      });
    });
  }

  // 等编辑器就绪再挂按钮
  var iv = setInterval(function () { if (document.querySelector('.ProseMirror')) { clearInterval(iv); build(); } }, 800);
  setTimeout(function () { clearInterval(iv); }, 40000);
})();
