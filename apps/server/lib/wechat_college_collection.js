const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const cheerio = require('cheerio');
const { canonicalUrl, dateTimestamp, hash, invalid, parseArticle } = require('./wechat_monitor_content');
const { fetchWechatArticleHtml } = require('./wechat_article_source');
const { readLimitedText } = require('./public_remote_fetch');
const { robotsAllowed } = require('./wechat_monitor_discovery');

const DIRECTORY = 'http://10.1.131.10/college';
const TARGETS = [
  { key: 'bjzgca', name: '北京中关村学院', biz: 'Mzk3NTQ2NTY2Ng==' },
  { key: 'bjzgca-graduate', name: '北京中关村学院研究生会', biz: 'MzkzMjk5NDg1Mw==' },
];
const ACCESS_ERRORS = new Set(['SOURCE_VERIFICATION_REQUIRED', 'SOURCE_ACCESS_DENIED', 'SOURCE_RATE_LIMITED']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Deliberately separate from the public importer: one literal IP, one directory, no redirects or credentials.
function directoryUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw invalid('INVALID_DIRECTORY_URL', 'Invalid college directory URL'); }
  if (url.origin !== 'http://10.1.131.10' || url.username || url.password || url.hash || url.pathname !== '/college'
    || [...url.searchParams.keys()].some(key => key !== 'page') || url.searchParams.getAll('page').length > 1
    || url.searchParams.has('page') && !/^[1-9]\d{0,5}$/.test(url.searchParams.get('page'))) {
    throw invalid('INVALID_DIRECTORY_URL', 'Only the approved college directory and its numbered pages are allowed');
  }
  if (url.searchParams.get('page') === '1') url.search = '';
  return url.href;
}

async function readDirectory(raw, { request = http.request } = {}) {
  const url = raw === 'http://10.1.131.10/robots.txt' ? raw : directoryUrl(raw);
  let req, response;
  const timer = setTimeout(() => {
    const error = invalid('SOURCE_TIMEOUT', 'College directory timed out', 502);
    req?.destroy(error); response?.destroy(error);
  }, 15000);
  try {
    response = await new Promise((resolve, reject) => {
      req = request(url, { method: 'GET', headers: { Accept: 'text/html,text/plain', 'User-Agent': 'MaMage-WeChatMonitor/1.0' } }, resolve);
      req.on('error', reject); req.end();
    });
    if (url.endsWith('/robots.txt') && response.statusCode === 404) { response.resume(); return ''; }
    if (response.statusCode !== 200) {
      response.resume();
      throw invalid(response.statusCode >= 300 && response.statusCode < 400 ? 'SOURCE_REDIRECT_REJECTED'
        : [401, 403].includes(response.statusCode) ? 'SOURCE_ACCESS_DENIED' : response.statusCode === 429 ? 'SOURCE_RATE_LIMITED' : 'SOURCE_HTTP_ERROR',
      `College directory returned HTTP ${response.statusCode}`, 502);
    }
    return await readLimitedText(response, 8 * 1024 * 1024);
  } finally { clearTimeout(timer); }
}

function parseDirectory(html, rawUrl) {
  const url = directoryUrl(rawUrl), $ = cheerio.load(html);
  const totalText = $('.list-summary b').text().trim();
  if (!/^\d+$/.test(totalText) || !$('.news-list').length) throw invalid('SOURCE_FORMAT_CHANGED', 'College directory markup not recognized');
  const rows = [], rejected = [];
  $('.news-row').each((index, el) => {
    const row = $(el), title = row.find('strong').text().trim(), directoryPublisher = row.find('.news-tag').text().trim();
    const directoryDate = row.find('time[datetime]').attr('datetime');
    try {
      const articleUrl = canonicalUrl(row.attr('href'));
      dateTimestamp(directoryDate);
      if (!title) throw invalid('DIRECTORY_METADATA_MISSING', 'Directory title missing');
      const biz = new URL(articleUrl).searchParams.get('__biz');
      const target = biz ? TARGETS.find(item => item.biz === biz) : TARGETS.find(item => item.name === directoryPublisher);
      if (!target) throw invalid('DIRECTORY_ACCOUNT_UNKNOWN', 'Article link does not identify an approved publisher');
      rows.push({ id: hash(articleUrl), url: articleUrl, accountKey: target.key, expectedPublisher: target.name,
        expectedBiz: target.biz, directoryTitle: title, directoryPublisher, directoryDate, discoveryUrl: url,
        directoryLabelMatches: directoryPublisher === target.name,
        identityEvidence: biz ? 'directory_link_biz_unverified' : 'directory_label_only_unverified' });
    } catch (error) { rejected.push({ index, title, directoryPublisher, code: error.code || 'INVALID_DIRECTORY_ROW' }); }
  });
  const pages = new Set();
  $('.news-pager a[href]').each((_, el) => pages.add(directoryUrl(new URL($(el).attr('href'), url).href)));
  if (!rows.length && !rejected.length && Number(totalText) > 0) throw invalid('SOURCE_FORMAT_CHANGED', 'Nonempty directory has no article rows');
  return { rows, rejected, pages: [...pages], total: Number(totalText) };
}

function reverseArticle(html, sourceUrl, entry, since, now) {
  const target = TARGETS.find(item => item.key === entry.accountKey);
  if (!target) throw invalid('ACCOUNT_MISMATCH', 'Unknown target account');
  const article = parseArticle(html, sourceUrl, { biz: target.biz, since_date: since }, now);
  // The directory tag and URL are discovery clues, not proof of the original publisher.
  const bodyBiz = html.match(/(?:var\s+|[;\n]\s*)biz\s*=\s*["']([^"'\r\n]+)["']/)?.[1];
  if (!bodyBiz) throw invalid('ARTICLE_IDENTITY_UNVERIFIED', 'Original article lacks publisher biz evidence');
  if (bodyBiz !== target.biz || article.author !== target.name) {
    throw Object.assign(invalid('ACCOUNT_MISMATCH', 'Original publisher differs from the target; manual review required'),
      { publisherEvidence: { name: article.author, biz: bodyBiz } });
  }
  const originalUrl = new URL(canonicalUrl(entry.url));
  const identity = [target.biz, originalUrl.searchParams.get('mid'), originalUrl.searchParams.get('idx')].join(':');
  if (originalUrl.searchParams.has('mid') && article.metadata.identity !== identity) {
    throw invalid('ARTICLE_IDENTITY_MISMATCH', 'Original article ID differs from the directory link');
  }
  article.metadata.provenance = { sourceKind: 'approved_college_directory', discoveryUrl: directoryUrl(entry.discoveryUrl),
    directoryTitle: entry.directoryTitle, directoryPublisher: entry.directoryPublisher, directoryDate: entry.directoryDate,
    originalPublisherVerified: true, transport: 'shared_reverse_import' };
  return article;
}

async function writeJson(file, data) {
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, file);
}
function errorRecord(error) {
  return { code: error.code || 'COLLECTION_FAILED', message: String(error.message || 'Failed').slice(0, 500),
    ...(error.publisherEvidence ? { publisherEvidence: error.publisherEvidence } : {}) };
}
function summarize(manifest) {
  const entries = Object.values(manifest.entries), states = {};
  for (const item of entries) states[item.state] = (states[item.state] || 0) + 1;
  const accounts = TARGETS.map(target => {
    const items = entries.filter(item => item.accountKey === target.key), dates = items.map(item => item.directoryDate).sort();
    return { ...target, discovered: items.length, reversed: items.filter(item => item.state === 'reversed').length,
      directoryDateRange: [dates[0] || null, dates.at(-1) || null],
      originalPublishers: [...new Set(items.filter(item => item.state === 'reversed').map(item => item.publisher))] };
  });
  const pages = Object.values(manifest.pages);
  return { source: DIRECTORY, since: manifest.since, pages: pages.filter(item => item.state === 'done').length,
    declaredDirectoryTotal: pages.find(item => item.total !== undefined)?.total ?? null,
    discovered: entries.length, states, accounts, stop: manifest.stop || null,
    rejectedRows: pages.reduce((sum, item) => sum + (item.rejected?.length || 0), 0),
    directoryTraversalComplete: pages.length > 0 && pages.every(item => item.state === 'done'),
    coverage: 'observed_directory_only_not_complete_account_history',
    databaseWritten: false, images: 'Original URLs preserved; image binaries are not downloaded' };
}

async function collectCollege(options, dependencies = {}) {
  const root = path.resolve(options.output), manifestFile = path.join(root, 'manifest.json');
  const since = options.since || '2024-01-01'; dateTimestamp(since);
  const interval = Number(options.intervalMs ?? 2000);
  if (!Number.isFinite(interval) || interval < 1000) throw invalid('INVALID_INTERVAL', 'Use at least 1000ms between requests');
  const read = dependencies.readDirectory || readDirectory, fetchArticle = dependencies.fetchArticle || fetchWechatArticleHtml;
  const pause = dependencies.sleep || sleep, clock = dependencies.clock || Date.now;
  const log = dependencies.log || (() => {});
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const lock = await fs.open(path.join(root, '.collection.lock'), 'wx', 0o600);
  let manifest;
  try {
    await lock.writeFile(String(process.pid));
    try { manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      manifest = { version: 1, source: DIRECTORY, since, createdAt: clock(), pages: {}, entries: {} };
    }
    if (manifest.version !== 1 || manifest.source !== DIRECTORY || manifest.since !== since) throw invalid('BUNDLE_MISMATCH', 'Output bundle source/version/history start differs');
    await fs.mkdir(path.join(root, 'directory'), { recursive: true });
    await fs.mkdir(path.join(root, 'articles'), { recursive: true });
    const save = async () => {
      manifest.updatedAt = clock();
      await writeJson(manifestFile, manifest);
      await writeJson(path.join(root, 'report.json'), summarize(manifest));
    };
    if (options.reparseDirectory) {
      for (const [url, previous] of Object.entries(manifest.pages)) {
        if (previous.state !== 'done') continue;
        const found = parseDirectory(await fs.readFile(path.join(root, 'directory', `${hash(url)}.html`), 'utf8'), url);
        Object.assign(previous, { rows: found.rows.length, rejected: found.rejected });
        for (const entry of found.rows) {
          if (!manifest.entries[entry.id]) manifest.entries[entry.id] = { ...entry, state: 'pending', attempts: [] };
          else Object.assign(manifest.entries[entry.id], entry);
        }
      }
      await save();
    }
    if (manifest.stop && !options.resumeBlocked) return summarize(manifest);
    if (options.resumeBlocked) {
      for (const item of Object.values(manifest.entries)) if (['blocked', 'failed'].includes(item.state)) item.state = 'pending';
      for (const item of Object.values(manifest.pages)) if (item.state === 'failed') item.state = 'pending';
      delete manifest.stop;
    }
    if (options.refreshDirectory) for (const page of Object.values(manifest.pages)) page.state = 'pending';
    manifest.pages[DIRECTORY] ||= { state: 'pending' };
    if (Object.values(manifest.pages).some(page => page.state !== 'done')) {
      let robots;
      try { robots = await read('http://10.1.131.10/robots.txt'); }
      catch (error) {
        manifest.stop = { phase: 'directory_policy', at: clock(), ...errorRecord(error) }; await save();
        return summarize(manifest);
      }
      for (;;) {
        const url = Object.keys(manifest.pages).find(key => manifest.pages[key].state !== 'done');
        if (!url) break;
        try {
          const checked = new URL(directoryUrl(url));
          if (!robotsAllowed(robots, checked.pathname + checked.search)) throw invalid('SOURCE_ROBOTS_DISALLOWED', 'Directory robots policy disallows collection');
          await pause(interval);
          const html = await read(url);
          await fs.writeFile(path.join(root, 'directory', `${hash(url)}.html`), html, { mode: 0o600 });
          const found = parseDirectory(html, url);
          manifest.pages[url] = { state: 'done', fetchedAt: clock(), total: found.total, rows: found.rows.length, rejected: found.rejected };
          for (const pageUrl of found.pages) manifest.pages[pageUrl] ||= { state: 'pending' };
          for (const entry of found.rows) {
            if (!manifest.entries[entry.id]) manifest.entries[entry.id] = { ...entry, state: 'pending', attempts: [] };
          }
          log({ phase: 'directory', url, rows: found.rows.length, discovered: Object.keys(manifest.entries).length });
          await save();
        } catch (error) {
          manifest.pages[url] = { state: 'failed', error: errorRecord(error) };
          manifest.stop = { phase: 'directory', at: clock(), ...errorRecord(error) }; await save();
          return summarize(manifest);
        }
      }
    }
    if (options.discoverOnly) { await save(); return summarize(manifest); }
    // Interleave publishers for a representative first batch; a source-wide breaker stops repeated access challenges.
    const queues = TARGETS.map(target => Object.values(manifest.entries).filter(item => item.accountKey === target.key && item.state === 'pending'));
    let accessFailures = 0, transientFailures = 0;
    while (queues.some(queue => queue.length)) {
      for (const queue of queues) {
        const entry = queue.shift(); if (!entry) continue;
        const attempt = { startedAt: clock() }; entry.attempts.push(attempt);
        await save();
        try {
          await pause(interval);
          const sourceUrl = canonicalUrl(entry.url), id = hash(sourceUrl);
          if (id !== entry.id) throw invalid('BUNDLE_MISMATCH', 'Article ID differs from bundle URL');
          const page = await fetchArticle(sourceUrl);
          await fs.writeFile(path.join(root, 'articles', `${id}.html`), page.html, { mode: 0o600 });
          entry.rawFile = `articles/${id}.html`;
          const article = reverseArticle(page.html, page.finalUrl, entry, since, clock());
          await writeJson(path.join(root, 'articles', `${id}.json`), article);
          Object.assign(entry, { state: 'reversed', publisher: article.author, canonicalKey: article.canonicalKey,
            parsedFile: `articles/${id}.json`, rawFile: `articles/${id}.html`, textLength: article.text.length,
            blockCount: article.blocks.length, styleBlockCount: article.styleBlocks.length, publishedAt: article.publishedAt });
          accessFailures = 0; transientFailures = 0;
        } catch (error) {
          attempt.error = errorRecord(error);
          entry.state = ACCESS_ERRORS.has(error.code) ? 'blocked' : error.code === 'BEFORE_HISTORY_START' ? 'skipped'
            : /MISMATCH|UNVERIFIED/.test(error.code || '') ? 'quarantined' : 'failed';
          if (ACCESS_ERRORS.has(error.code)) accessFailures++;
          if (/TIMEOUT|FETCH_FAILED|HTTP_ERROR|READ_FAILED/.test(error.code || '')) transientFailures++;
          if (error.code === 'SOURCE_RATE_LIMITED' || accessFailures >= 2 || transientFailures >= 3) {
            manifest.stop = { phase: 'articles', at: clock(), ...errorRecord(error), accessFailures, transientFailures };
          }
        }
        attempt.finishedAt = clock(); attempt.state = entry.state;
        await save(); log({ phase: 'article', id: entry.id, state: entry.state, error: attempt.error?.code });
        if (manifest.stop) return summarize(manifest);
      }
    }
    await save(); return summarize(manifest);
  } finally {
    await lock.close(); await fs.unlink(path.join(root, '.collection.lock'));
  }
}

module.exports = { DIRECTORY, TARGETS, directoryUrl, readDirectory, parseDirectory, reverseArticle, collectCollege, summarize };
