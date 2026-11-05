// Source article photos use anti-hotlink protection, including SVG backgrounds.
const referrerMeta = document.createElement('meta');
referrerMeta.name = 'referrer'; referrerMeta.content = 'no-referrer';
document.head.appendChild(referrerMeta);
const key = 'mamage.aiNewsWriter.draft.v2:900003:900003';
if (!localStorage.getItem(key)) {
  const ids = [1681, 1682, 1683, 1685, 1686, 1687, 1688, 1689, 1691, 1693, 1695, 1696];
  const photos = Array.from({ length: 30 }, (_, index) => ({ id: index + 1,
    url: `/__news-qa/images/${ids[index % ids.length]}.jpg` }));
  const markdownText = '# 校园交流活动（组图测试稿）\n\n这是一份用于检查配图排版的本地测试稿。\n\n'
    + ['活动现场', '交流记录', '更多瞬间'].map((title, group) => `## ${title}\n\n`
      + photos.slice(group * 10, group * 10 + 10).map((photo, index) => `![现场记录 ${group * 10 + index + 1}](${photo.url})`).join('\n\n')).join('\n\n')
    + '\n\n初审：李老师\n终审：王老师';
  localStorage.setItem(key, JSON.stringify({ channelContent: { wechat_article: { title: '校园交流活动（组图测试稿）', markdownText, photos } },
    activeChannelKey: 'wechat_article', selectedChannels: ['wechat_article'], formValues: { sourceMaterial: '本地排版测试材料' } }));
}
fetch('/observed-library.json').then(response => response.json()).then(library => {
  if (Array.isArray(library.templates) && Array.isArray(library.blocks)) window.__newsObservedLibrary = library;
}).catch(() => {}).finally(() => import('./news-usability.jsx'));
