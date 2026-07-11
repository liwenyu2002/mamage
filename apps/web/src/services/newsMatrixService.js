// src/services/newsMatrixService.js
// AI 创作矩阵服务层：渠道元数据常量 + 批次生成/轮询/重试。
// 全部走 services/request（自带 token 头 + JSON 序列化），与后端 /api/ai/news/* 契约对齐。
import { request } from './request';

// 与后端 channel_templates.channel_key 一一对应，顺序即前端多选 tile 的展示顺序。
// 新增渠道时先由后端 seed 好 channel_templates 行，这里再补一条元数据，两边 key 必须一致。
const CHANNELS = [
  { key: 'wechat_article', name: '公众号推文', desc: '800-1800字图文报道', defaultFor: ['campus'] },
  { key: 'xiaohongshu',    name: '小红书笔记', desc: '第一人称短文+话题', defaultFor: ['campus'] },
  { key: 'press_release',  name: '新闻稿',     desc: '官网/校网正式报道' },
  { key: 'report_brief',   name: '通讯稿',     desc: '上级报送公文体' },
  { key: 'weibo',          name: '微博',       desc: '140字短讯+话题' },
];

// 默认勾选渠道：校园场景最常发的公众号+小红书组合。
const DEFAULT_CHANNEL_KEYS = CHANNELS
  .filter((c) => Array.isArray(c.defaultFor) && c.defaultFor.includes('campus'))
  .map((c) => c.key);

// 提交一次矩阵生成：一次表单+照片，并行拆成多个渠道 job。
// resp: { batchId, jobs: [{ jobId, channelKey }] }
async function startBatch(payload) {
  return request('/api/ai/news/generate/batch', { method: 'POST', data: payload });
}

// 查询批次状态（含每个渠道 job 的状态与已完成的结果），用于 2.5s 轮询。
// resp: { batchId, status, jobs: [{ jobId, channelKey, status, error, result }] }
async function getBatch(batchId) {
  return request(`/api/ai/news/batches/${encodeURIComponent(batchId)}`, { method: 'GET' });
}

// 单个失败渠道重试：复用原 prompt 重新入队，返回 { jobId, status: 'pending' }。
async function retryJob(jobId) {
  return request(`/api/ai/news/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' });
}

export { CHANNELS, DEFAULT_CHANNEL_KEYS, startBatch, getBatch, retryJob };
