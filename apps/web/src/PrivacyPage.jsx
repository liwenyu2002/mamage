import React from 'react';
import './privacy-page.css';

// 隐私说明页：文案与线上真实行为一一对应（人脸库/拍照找我/AI 处理/内网入口/日志轮转），
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
        text: '系统通过校内统一模型平台检测人脸，生成人脸位置框和用于身份比对的数学特征向量，将同一人的照片归到一起。人物默认匿名编号，人工命名后才显示姓名。人脸特征属于敏感信息；模型平台会留存调用结果（包括特征向量），其日志期限和删除方式以平台政策为准。',
      },
      {
        sub: '人脸识别的使用范围',
        text: '本服务目前仅面向融媒体中心内部成员使用，使用本服务即视为同意上述人脸识别功能。未来若向全体学生开放，学生仅能查看与自己本人人脸相关的结果，不会暴露他人的脸档案。',
      },
      {
        sub: '「拍照找我」的自拍照',
        text: '自拍在 MaMage 服务端内存中临时处理，不存入我们的数据库或对象存储；图片会发送给校内模型平台提取人脸特征，MaMage 在授权相册范围内完成比对。模型平台可能留存调用记录与特征结果，不能保证其日志随本次比对立即删除。',
      },
    ],
  },
  {
    title: '二、AI 处理说明',
    blocks: [
      {
        text: '照片打标、选片评分、人物衣着核验和视频抽帧分析使用校内 ZGCAI Model Hub 的 Qwen 服务。系统发送分析所需的图片字节，不发送对象存储密钥或私有图片签名链接；模型平台可能留存调用内容与结果，留存范围和期限以平台政策为准。',
      },
      {
        text: '自然语言搜索（如「某某的单人照」）会把你输入的搜索词发送给文本模型服务（经校内统一采购的模型分发渠道）做语义解析——发送的是文字，不是照片。',
      },
      {
        text: '人物与衣着检索会在你有权访问的候选照片内核验目标人物。未知或尚未核验不等于不符合条件；无结果时不会自动展示无关照片，相关候选需主动选择。',
      },
      {
        text: '视频语音转文字暂时停用，不再调用原 Mac Mini 上的转写服务；已有转写结果保留。视频画面分析仍由校内模型平台处理。',
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
        text: '目前仅开放学校服务器的校园内网 HTTP 入口，不再提供原公网域名、HTTPS 转发或公网出口探测。HTTP 链路未加密，仅限可信内网使用；请勿将此入口直接暴露到公网。浏览器可能不允许直接调用摄像头，可改为上传照片。',
      },
      {
        text: '服务器访问日志仅用于安全审计与故障排查，含访问时间与来源地址，定期清理（保留约 30 天），不用于画像或分析。',
      },
      {
        sub: '检索改进日志',
        text: '为改进检索效果，系统记录登录用户的搜索文字、所属组织与小组范围、检索条件、结果数量和耗时。常见密钥、令牌、邮箱和手机号会遮盖；专用日志不保存账号标识、IP、照片内容、图片链接或人脸向量，仅供授权维护人员按组织分析，不用于自动训练模型。默认保留 30 天，到期停止用于查询并定期删除。',
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
        <p className="privacy-sub">更新时间：2026 年 10 月 16 日 · 适用于校园内网入口</p>
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
