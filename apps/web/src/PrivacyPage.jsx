import React from 'react';
import './privacy-page.css';

// 隐私说明页：文案与线上真实行为一一对应（人脸库/拍照找我/AI 处理/双入口/日志轮转），
// 修改功能时同步更新这里，避免承诺与现实脱节。
const SECTIONS = [
  {
    title: '一、我们收集哪些信息',
    blocks: [
      {
        sub: '账号信息',
        text: '学号或邮箱、姓名、所属组织、角色。密码只存加盐哈希（bcrypt），任何人（包括管理员）都无法查看。',
      },
      {
        sub: '照片与视频',
        text: '你上传的照片/视频存储于校内对象存储，不使用校外云盘。访问一律经过带过期时间的签名链接，未获授权无法读取。',
      },
      {
        sub: '人脸信息（重点）',
        text: '系统会对照片自动做人脸检测，生成人脸位置框和特征向量（一串数学数字，不能还原出照片或你的长相），用于把同一人的照片归到一起。人脸聚类产生的「人物」默认匿名（只有编号），只有当有人为这个人物命名后才会出现姓名。按姓名搜索某人、点开某张脸查看「这个人还出现在哪些照片」，都依赖上述数据。',
      },
      {
        sub: '人脸识别的使用范围',
        text: '本服务目前仅面向融媒体中心内部成员使用，使用本服务即视为同意上述人脸识别功能。未来若向全体学生开放，学生仅能查看与自己本人人脸相关的结果，不会暴露他人的脸档案。',
      },
      {
        sub: '「拍照找我」的自拍照',
        text: '你在公开分享页上传的找我用自拍照只在内存中临时使用，不存库、不进对象存储、不留副本，比对完成后立即丢弃。',
      },
    ],
  },
  {
    title: '二、AI 处理说明',
    blocks: [
      {
        text: '照片的自动打标、画质评分、选片推荐由校内本地部署的视觉模型处理，照片本身不出校门。',
      },
      {
        text: '自然语言搜索（如「某某的单人照」）会把你输入的搜索词发送给文本模型服务（经校内统一采购的模型分发渠道）做语义解析——发送的是文字，不是照片。',
      },
      {
        text: '搜索无结果时系统会自动放宽条件，放宽同样只针对文字条件。',
      },
    ],
  },
  {
    title: '三、谁能看到什么',
    blocks: [
      {
        text: '照片和人脸信息按组织隔离，其他组织的成员不可见。',
      },
      {
        text: '未登录的访客只能看到被明确公开分享（分享码）的内容。',
      },
      {
        text: '管理员可以管理相册与人脸归属（如把认错的人脸拆开），操作在服务端留有记录。',
      },
    ],
  },
  {
    title: '四、你的控制权',
    blocks: [
      {
        text: '人脸归属纠错：点开任意人脸 → 人物信息 →「系统认错人了？」可把混入的脸拆分出去；也可申请合并。',
      },
      {
        text: '删除：删除照片会同时删除其人脸数据；联系本组织管理员可删除整个「人物」及其关联。',
      },
      {
        text: '注销：联系我们删除账号及个人信息。',
      },
      {
        text: '撤回分享：分享链接随时可撤销，撤销后立即失效。',
      },
    ],
  },
  {
    title: '五、网络与日志',
    blocks: [
      {
        text: '校内访问与校外访问使用不同入口（校外经 CDN 隧道回源校内）；「自动切换内网入口」功能通过比对公网出口地址段判断你是否在校园网，不记录、不存储个人 IP 与位置。',
      },
      {
        text: '服务器访问日志仅用于安全审计与故障排查，含访问时间与来源地址，定期清理（保留约 30 天），不用于画像或分析。',
      },
    ],
  },
  {
    title: '六、联系我们',
    blocks: [
      {
        text: '对本说明或你的个人信息有任何疑问，请联系本组织管理员，或通过页面右下角「反馈问题」提交。',
      },
    ],
  },
];

export default function PrivacyPage({ onBack }) {
  return (
    <div className="privacy-page">
      <div className="privacy-hero">
        <h1 className="privacy-title">MaMage 隐私说明</h1>
        <p className="privacy-sub">更新时间：2026 年 9 月 · 适用于 mamage.wenyuli.site 及校内内网入口</p>
        <p className="privacy-lead">
          MaMage 是校园活动的照片/视频图库服务。我们处理的核心是<span className="privacy-em">照片中的人</span>，
          所以这份说明请认真读——尤其是人脸部分。
        </p>
      </div>

      {SECTIONS.map((section) => (
        <section className="privacy-section" key={section.title}>
          <h2 className="privacy-section-title">{section.title}</h2>
          {section.blocks.map((block, idx) => (
            <div className="privacy-block" key={idx}>
              {block.sub ? <h3 className="privacy-block-sub">{block.sub}</h3> : null}
              <p className="privacy-block-text">{block.text}</p>
            </div>
          ))}
        </section>
      ))}

      {onBack ? (
        <div className="privacy-back">
          <button type="button" className="privacy-back-btn" onClick={onBack}>返回</button>
        </div>
      ) : null}
    </div>
  );
}
