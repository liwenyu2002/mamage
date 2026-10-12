// src/services/favoritesService.js
// 用户收藏（样式块/照片）接口封装。约束：一用户一收藏，服务端已按 req.user.id 隔离，
// 本文件不做任何本地缓存/去重——列表真源永远是后端。
import { request } from './request';

function listFavorites(kind) {
  // 空对象 data 不能传：request.js 对 GET 只在 data 非空时拼 querystring，
  // 空对象会落进 JSON body 分支，浏览器对带 body 的 GET 直接 throw
  const opts = kind ? { method: 'GET', data: { kind } } : { method: 'GET' };
  return request('/api/favorites', opts);
}

function addFavorite({ kind, refKey, payload }) {
  return request('/api/favorites', { method: 'POST', data: { kind, refKey, payload } });
}

function removeFavorite(id) {
  return request(`/api/favorites/${id}`, { method: 'DELETE' });
}

export { listFavorites, addFavorite, removeFavorite };
