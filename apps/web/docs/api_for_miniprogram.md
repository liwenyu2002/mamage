# MaMage API 接口规范（给小程序开发者的对接文档）

文档目的：把前端（Web）当前使用的后端路由、鉴权、请求/响应格式、权限要求和注意点整理给小程序开发者，包含 wx.request / wx.uploadFile / wx.downloadFile 示例，方便小程序快速接入后端。

> 注意：本说明以后端以 `/api` 为前缀、登录返回 JWT 为前提；如果后端实现有差异（如使用 cookie/session、或微信登录链路），请按后端最终实现调整。

## 基本约定

- API 基址（例）：`https://api.example.com`（开发环境可能是 `http://localhost:3000`）。请在小程序配置中统一维护 `API_BASE`。
- 鉴权：登录后后端返回 JWT，后续请求在 Header 中带 `Authorization: Bearer <token>`。
- Content-Type：JSON 请求用 `application/json`，上传用 `multipart/form-data`。
- 错误处理：
  - 401/403 -> 未授权/无权限（小程序应清除本地 token 并引导登录）
  - 400 -> 参数校验错误（展示后端 message）
  - 404 -> 资源不存在
  - 5xx -> 服务端错误，提示“服务异常”并上报日志

## 小程序中通用请求助手（示例）

在小程序中建议写一个统一的请求助手，用于注入 token、处理 401、统一错误格式：

```js
// utils/api.js
const API_BASE = '{YOUR_API_BASE}';
function getToken(){ return wx.getStorageSync('mamage_jwt_token') || '' }
function request({url, method='GET', data, header={}}){
  const token = getToken();
  if(token) header = {...header, Authorization: `Bearer ${token}` };
  return new Promise((resolve, reject)=>{
    wx.request({
      url: API_BASE + url,
      method,
      header: { 'Content-Type': 'application/json', ...header },
      data,
      success(res){
        if(res.statusCode === 401){
          // 清理并通知上层跳转登录
          wx.removeStorageSync('mamage_jwt_token');
          return reject({ code:401, message:'unauthorized', res });
        }
        resolve(res.data);
      },
      fail(err){ reject(err); }
    })
  })
}

module.exports = { request, API_BASE };
```

上传文件（图片）示例：

```js
// 上传单张图片
const token = wx.getStorageSync('mamage_jwt_token')
wx.uploadFile({
  url: API_BASE + '/api/photos/upload',
  filePath: filePath,
  name: 'file',
  formData: { projectId },
  header: { Authorization: `Bearer ${token}` },
  success(res){ const data = JSON.parse(res.data); }
})
```

下载二进制（zip）示例：

```js
wx.downloadFile({
  url: `${API_BASE}/api/photos/zip`,
  method: 'POST',
  header: { Authorization: `Bearer ${wx.getStorageSync('mamage_jwt_token')}`, 'Content-Type': 'application/json' },
  data: JSON.stringify({ photoIds: ids }),
  success(res){
    if(res.statusCode === 200){
      // res.tempFilePath 可用于保存或 openDocument
      wx.saveFile({ tempFilePath: res.tempFilePath, success(){ /* 保存处理 */ } })
    }
  }
})
```

---

## 详细接口清单（示例与说明）

每个接口项给出：方法、路径、是否鉴权、请求示例、响应示例、备注。

### 1. 用户鉴权与资料

- POST /api/users/login — Auth: No
  - Body: { email, password }
  - Success 200:
    ```json
    { "ok": true, "data": { "token": "<jwt>", "user": { "id","email","role","name" } } }
    ```
  - 常见错误：401 (认证失败)

- POST /api/users/register — Auth: No
  - Body: { email, password, name, inviteCode? }
  - Success: 返回同 login（包含 token）或 201
  - 若后端要求 inviteCode（邀请码），小程序注册界面需提供该字段。

- GET /api/users/me — Auth: Yes
  - Header: Authorization: Bearer <token>
  - Success 200: { ok:true, data: { id, email, role, name, createdAt } }

### 2. 邀请码（管理员管理 / 用户兑换）

- GET /api/users/invitations — Auth: Yes (admin)
  - 返回邀请码列表

- POST /api/users/invitations — Auth: Yes (admin)
  - Body: { role: 'photographer'|'visitor'|'admin', expiresInDays: number }

- DELETE /api/users/invitations/:id — Auth: Yes (admin)

- POST /api/users/me/invite — Auth: Yes
  - 用户兑换或申请，Body: { inviteCode }
  - 返回：升级成功或待审核的信息

### 3. 项目（Projects / Albums）

- GET /api/projects — Auth: No
  - Query: ?page=1&limit=20
  - Success: { ok:true, data: { list: [ { id, projectName, description, cover, count, createdAt } ], total } }

- POST /api/projects — Auth: Yes
  - Body: { projectName, description?, eventDate? }
  - Success: 201 { ok:true, data: { id, ... } }

- GET /api/projects/:id — Auth: No
  - 返回项目详情与图片数组：images: [{ id, url, thumbUrl }]

- PUT /api/projects/:id — Auth: Yes (owner or admin)
  - Body: { projectName, description, ... }

- DELETE /api/projects/:id — Auth: Yes (owner or admin)

### 4. 照片（Photos）

- POST /api/photos/upload — Auth: Yes
  - multipart/form-data, field `file`, optional `projectId`
  - Success 201: { ok:true, data: { photoId, url, thumbUrl } }

- POST /api/photos/delete — Auth: Yes
  - Body: { photoIds: ["id1","id2"] }
  - Success 200: { ok:true, data: { deletedIds:[], notFoundIds:[], failedIds:[] } }

- POST /api/photos/zip — Auth: Yes (通常)
  - Body: { photoIds: [...] }
  - 返回二进制 zip（Content-Disposition 设置文件名）

### 5. 静态文件

- /uploads/... 或后端返回的图片 URL
  - 小程序可直接使用返回的绝对 URL；若返回相对路径，请用 `API_BASE + path` 拼接。

---

## 小程序特殊注意事项

- Token 存储：使用 `wx.setStorageSync('mamage_jwt_token', token)` 并在请求时注入。用户登出时必须删除存储。
- 上传：`wx.uploadFile` 支持 `header`，务必加 `Authorization`。
- 下载 zip / 二进制：使用 `wx.downloadFile`，注意保存或打开需要调用 `wx.saveFile`/`wx.openDocument`。
- 微信登录融合：若小程序使用微信授权登录，后端应提供把微信 code 换成内部 token 的接口（例如 `POST /api/auth/wechat`），并返回同样的内部 JWT 给小程序。
- 权限显示：项目详情接口建议后端返回 `canEdit`、`canDelete` 等权限字段，方便小程序显示/隐藏编辑控件。
- 网络与重试：移动端网络不稳定，请在关键写操作加幂等或防重逻辑，避免重复创建/上传。

## 建议的统一错误格式

后端如果用统一结构会更好适配小程序：

```json
{ "ok": false, "code": "ERR_INVALID_PARAM", "message": "参数错误：projectName 必填", "details": { "projectName": "required" } }
```

小程序只需根据 `ok` 与 `code` 的组合处理提示与流程。

## 交付清单（建议交给小程序开发者）

- 本文档（`docs/api_for_miniprogram.md`）
- API 测试地址（staging / prod）及测试账号（admin、普通用户）
- 图片 base URL 与 CORS/鉴权策略说明
- 若需要，我可以生成一个小程序端的 `api-client.js`（封装 `request`, `upload`, `download` 方法）并提交到仓库。

---

如需我立刻生成：
- 小程序 `api-client.js`（包含 token 注入、401 处理）和更多 `wx` 示例；或
- 将本文档格式化为公司内网可读的对接说明（含 API 表格与示例请求/响应），

请选择需要我生成的交付项，我会继续实现并提交到 `docs/` 或 `src/utils/` 。
