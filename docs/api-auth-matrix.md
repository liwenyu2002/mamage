# API 路由与可见鉴权（自动生成）

> 根据 app.js 的挂载及其引用的路由注册函数生成；不猜测文件名对应的路径。
> 仅列出显式 HTTP 方法注册和可静态识别的鉴权。未标出守卫不代表匿名可访问；路由内部、动态中间件及对象权限靠行为测试验证。

共 238 条显式路由。

| 方法 | 路径 | 可识别的守卫 | 源文件 |
| --- | --- | --- | --- |
| GET | `/api/ai/news/batches/:batchId` | 权限 ai.generate | `apps/server/routes/ai_news.js` |
| POST | `/api/ai/news/captions` | 权限 ai.generate | `apps/server/routes/ai_news.js` |
| POST | `/api/ai/news/check` | 权限 ai.generate | `apps/server/routes/ai_news.js` |
| POST | `/api/ai/news/generate` | 权限 ai.generate | `apps/server/routes/ai_news.js` |
| POST | `/api/ai/news/generate/batch` | 权限 ai.generate | `apps/server/routes/ai_news.js` |
| GET | `/api/ai/news/jobs/:jobId` | 权限 ai.generate | `apps/server/routes/ai_news.js` |
| GET | `/api/ai/news/jobs/:jobId/references` | 权限 ai.generate | `apps/server/routes/ai_news.js` |
| POST | `/api/ai/news/jobs/:jobId/retry` | 权限 ai.generate | `apps/server/routes/ai_news.js` |
| POST | `/api/ai/news/preview` | 权限 ai.generate | `apps/server/routes/ai_news.js` |
| POST | `/api/ai/news/render-preview` | 权限 ai.generate | `apps/server/routes/ai_news.js` |
| POST | `/api/ai/news/rewrite` | 权限 ai.generate | `apps/server/routes/news_paragraphs.js` |
| GET | `/api/ai/news/rewrites/:clientRequestId` | 权限 ai.generate | `apps/server/routes/news_paragraphs.js` |
| POST | `/api/ai/news/sources` | 权限 ai.generate | `apps/server/routes/news_paragraphs.js` |
| POST | `/api/ai/video/rough-cut` | 权限 ai.generate | `apps/server/routes/ai_video.js` |
| GET | `/api/album-desktop` | 权限 photos.view | `apps/server/routes/album_desktop.js` |
| PUT | `/api/album-desktop/state` | 权限 photos.view | `apps/server/routes/album_desktop.js` |
| GET | `/api/auth/dingtalk/callback` | 未由静态检查确认 | `apps/server/routes/auth_dingtalk.js` |
| GET | `/api/auth/dingtalk/login` | 未由静态检查确认 | `apps/server/routes/auth_dingtalk.js` |
| GET | `/api/auth/iam/callback` | 未由静态检查确认 | `apps/server/routes/auth_iam.js` |
| GET | `/api/auth/iam/login` | 未由静态检查确认 | `apps/server/routes/auth_iam.js` |
| POST | `/api/auth/iam/qr` | 未由静态检查确认 | `apps/server/routes/iam_qr.js` |
| POST | `/api/auth/iam/qr/:id/cancel` | 未由静态检查确认 | `apps/server/routes/iam_qr.js` |
| GET | `/api/auth/iam/qr/:id/complete` | 未由静态检查确认 | `apps/server/routes/iam_qr.js` |
| GET | `/api/auth/iam/qr/:id/image` | 未由静态检查确认 | `apps/server/routes/iam_qr.js` |
| POST | `/api/auth/iam/qr/:id/status` | 未由静态检查确认 | `apps/server/routes/iam_qr.js` |
| POST | `/api/auth/iam/session` | 未由静态检查确认 | `apps/server/routes/auth_iam.js` |
| GET | `/api/auth/oidc/callback` | 未由静态检查确认 | `apps/server/routes/auth_oidc.js` |
| GET | `/api/auth/oidc/login` | 未由静态检查确认 | `apps/server/routes/auth_oidc.js` |
| GET | `/api/auth/oidc/logout` | 未由静态检查确认 | `apps/server/routes/auth_oidc.js` |
| POST | `/api/auth/oidc/session` | 未由静态检查确认 | `apps/server/routes/auth_oidc.js` |
| GET | `/api/auth/providers` | 未由静态检查确认 | `apps/server/routes/auth_dingtalk.js` |
| GET | `/api/external-imports/jobs` | 权限 photos.view | `apps/server/routes/external_imports.js` |
| POST | `/api/external-imports/jobs` | 权限 upload.photo | `apps/server/routes/external_imports.js` |
| GET | `/api/external-imports/jobs/:id` | 权限 photos.view | `apps/server/routes/external_imports.js` |
| POST | `/api/external-imports/jobs/:id/cancel` | 权限 photos.view | `apps/server/routes/external_imports.js` |
| GET | `/api/external-imports/jobs/:id/issues` | 权限 photos.view | `apps/server/routes/external_imports.js` |
| POST | `/api/external-imports/jobs/:id/resume` | 权限 photos.view | `apps/server/routes/external_imports.js` |
| GET | `/api/external-imports/jobs/:id/updates` | 权限 photos.view | `apps/server/routes/external_imports.js` |
| POST | `/api/external-imports/scan` | 权限 upload.photo | `apps/server/routes/external_imports.js` |
| POST | `/api/external-imports/sources/:id/hide` | 权限 projects.update | `apps/server/routes/external_imports.js` |
| GET | `/api/faces` | 权限 photos.view | `apps/server/routes/faces.js` |
| GET | `/api/faces/:faceId` | 权限 photos.view | `apps/server/routes/faces.js` |
| GET | `/api/faces/:faceId/avatar` | 权限 photos.view | `apps/server/routes/faces.js` |
| GET | `/api/faces/:faceId/person` | 权限 photos.view | `apps/server/routes/faces.js` |
| GET | `/api/faces/cluster/config` | 权限 photos.view | `apps/server/routes/faces.js` |
| POST | `/api/faces/detect` | 权限 photos.view | `apps/server/routes/faces.js` |
| POST | `/api/faces/find-me` | 权限 photos.view | `apps/server/routes/faces.js` |
| POST | `/api/faces/find-me/share` | 未由静态检查确认 | `apps/server/routes/faces.js` |
| POST | `/api/faces/label` | 权限 photos.view | `apps/server/routes/faces.js` |
| GET | `/api/faces/person` | 权限 photos.view | `apps/server/routes/faces.js` |
| GET | `/api/faces/profile` | 权限 photos.view | `apps/server/routes/faces.js` |
| GET | `/api/favorites` | 权限 ai.generate | `apps/server/routes/user_favorites.js` |
| POST | `/api/favorites` | 权限 ai.generate | `apps/server/routes/user_favorites.js` |
| DELETE | `/api/favorites/:id` | 权限 ai.generate | `apps/server/routes/user_favorites.js` |
| POST | `/api/folder-shares` | 权限 photos.view | `apps/server/routes/folder_shares.js` |
| GET | `/api/folder-shares/:id` | 权限 photos.view | `apps/server/routes/folder_shares.js` |
| POST | `/api/folder-shares/:id/copy` | 权限 photos.view | `apps/server/routes/folder_shares.js` |
| POST | `/api/folder-shares/:id/revoke` | 权限 photos.view | `apps/server/routes/folder_shares.js` |
| GET | `/api/folder-shares/received` | 权限 photos.view | `apps/server/routes/folder_shares.js` |
| GET | `/api/folder-shares/sent` | 权限 photos.view | `apps/server/routes/folder_shares.js` |
| GET | `/api/folder-shares/status/:folderId` | 权限 photos.view | `apps/server/routes/folder_shares.js` |
| GET | `/api/health` | 未由静态检查确认 | `apps/server/app.js` |
| GET | `/api/health/live` | 未由静态检查确认 | `apps/server/app.js` |
| GET | `/api/health/ready` | 未由静态检查确认 | `apps/server/app.js` |
| POST | `/api/integrations/iam/accounts` | 未由静态检查确认 | `apps/server/routes/iam_push.js` |
| POST | `/api/integrations/iam/departments` | 未由静态检查确认 | `apps/server/routes/iam_push.js` |
| POST | `/api/internal-shares` | 权限 photos.view | `apps/server/routes/internal_shares.js` |
| GET | `/api/internal-shares/:id` | 权限 photos.view | `apps/server/routes/internal_shares.js` |
| POST | `/api/internal-shares/:id/copy` | 权限 photos.view | `apps/server/routes/internal_shares.js` |
| POST | `/api/internal-shares/:id/revoke` | 权限 photos.view | `apps/server/routes/internal_shares.js` |
| GET | `/api/internal-shares/copy-jobs/:id` | 权限 photos.view | `apps/server/routes/internal_shares.js` |
| GET | `/api/internal-shares/received` | 权限 photos.view | `apps/server/routes/internal_shares.js` |
| GET | `/api/internal-shares/sent` | 权限 photos.view | `apps/server/routes/internal_shares.js` |
| GET | `/api/network/lan` | 未由静态检查确认 | `apps/server/routes/network.js` |
| GET | `/api/network/lan/manual` | 权限 photos.view | `apps/server/routes/network.js` |
| POST | `/api/operations/evaluations` | 权限 users.view_all | `apps/server/routes/operations.js` |
| GET | `/api/operations/status` | 权限 users.view_all | `apps/server/routes/operations.js` |
| GET | `/api/organizations` | 权限 photos.view | `apps/server/routes/organizations.js` |
| GET | `/api/persons` | 权限 faces.view | `apps/server/routes/faces.js` |
| GET | `/api/persons/:personId` | 权限 photos.view | `apps/server/routes/faces.js` |
| PATCH | `/api/persons/:personId` | 权限 faces.label | `apps/server/routes/faces.js` |
| GET | `/api/persons/:personId/faces` | 权限 faces.view | `apps/server/routes/faces.js` |
| GET | `/api/persons/:personId/photos` | 权限 photos.view | `apps/server/routes/faces.js` |
| POST | `/api/persons/:personId/split` | 权限 faces.merge | `apps/server/routes/faces.js` |
| POST | `/api/persons/:personId/split-preview` | 权限 faces.merge | `apps/server/routes/faces.js` |
| POST | `/api/persons/merge` | 权限 faces.merge | `apps/server/routes/faces.js` |
| GET | `/api/photos` | 权限 photos.view | `apps/server/routes/photos.js` |
| GET | `/api/photos/:id` | 权限 photos.view | `apps/server/routes/photos.js` |
| PATCH | `/api/photos/:id` | 权限 photos.edit | `apps/server/routes/photos.js` |
| GET | `/api/photos/:id/direct-url` | 权限 photos.view | `apps/server/routes/photos.js` |
| GET | `/api/photos/:id/pixel-source` | 权限 photos.view | `apps/server/routes/photos.js` |
| POST | `/api/photos/:id/rendered` | 权限 photos.view | `apps/server/routes/photos.js` |
| GET | `/api/photos/:photoId/faces` | 权限 photos.view | `apps/server/routes/faces.js` |
| POST | `/api/photos/:photoId/faces` | 权限 photos.view | `apps/server/routes/faces.js` |
| POST | `/api/photos/:photoId/faces/detect` | 权限 photos.view | `apps/server/routes/faces.js` |
| GET | `/api/photos/:photoId/faces/observations` | 权限 photos.view | `apps/server/routes/faces.js` |
| POST | `/api/photos/assign-section` | 权限 photos.edit | `apps/server/routes/photos.js` |
| POST | `/api/photos/delete` | 权限 photos.delete | `apps/server/routes/photos.js` |
| GET | `/api/photos/direct-status` | 权限 photos.view | `apps/server/routes/photos.js` |
| POST | `/api/photos/group-rescue` | 权限 photos.edit | `apps/server/routes/photos.js` |
| GET | `/api/photos/group-rescue/:jobId` | 权限 photos.edit | `apps/server/routes/photos.js` |
| GET | `/api/photos/scenery/random` | 权限 photos.view | `apps/server/routes/photos.js` |
| GET | `/api/photos/search` | 未由静态检查确认 | `apps/server/routes/photos.js` |
| POST | `/api/photos/video-downloads/manifest` | 权限 photos.view | `apps/server/routes/photos.js` |
| POST | `/api/photos/video-downloads/source` | 权限 photos.view | `apps/server/routes/photos.js` |
| POST | `/api/photos/video-downloads/summary` | 权限 photos.view | `apps/server/routes/photos.js` |
| GET | `/api/photos/zip` | 未由静态检查确认 | `apps/server/routes/photos.js` |
| POST | `/api/photos/zip` | 未由静态检查确认 | `apps/server/routes/photos.js` |
| GET | `/api/photos/zip-direct` | 权限 photos.view | `apps/server/routes/photos.js` |
| POST | `/api/photos/zip-direct` | 权限 photos.view | `apps/server/routes/photos.js` |
| GET | `/api/photos/zip-direct/:jobId` | 权限 photos.view | `apps/server/routes/photos.js` |
| POST | `/api/photos/zip-direct/:jobId/cancel` | 权限 photos.view | `apps/server/routes/photos.js` |
| POST | `/api/photos/zip-ticket` | 权限 photos.view | `apps/server/routes/photos.js` |
| GET | `/api/projects` | 未由静态检查确认 | `apps/server/routes/projects.js` |
| POST | `/api/projects` | 权限 projects.create | `apps/server/routes/projects.js` |
| DELETE | `/api/projects/:id` | 权限 projects.delete | `apps/server/routes/projects.js` |
| GET | `/api/projects/:id` | 未由静态检查确认 | `apps/server/routes/projects.js` |
| GET | `/api/projects/:id/previews` | 权限 photos.view | `apps/server/routes/projects.js` |
| GET | `/api/projects/:id/sharing-status` | 未由静态检查确认 | `apps/server/routes/projects.js` |
| POST | `/api/projects/:id/timeline-sections` | 权限 projects.update | `apps/server/routes/projects.js` |
| DELETE | `/api/projects/:id/timeline-sections/:sectionId` | 权限 projects.update | `apps/server/routes/projects.js` |
| PATCH | `/api/projects/:id/timeline-sections/:sectionId` | 权限 projects.update | `apps/server/routes/projects.js` |
| POST | `/api/projects/:id/timeline-sections/reorder` | 权限 projects.update | `apps/server/routes/projects.js` |
| POST | `/api/projects/:id/update` | 权限 projects.update | `apps/server/routes/projects.js` |
| GET | `/api/projects/import-status` | 未由静态检查确认 | `apps/server/routes/projects.js` |
| GET | `/api/projects/list` | 未由静态检查确认 | `apps/server/routes/projects.js` |
| GET | `/api/projects/scenery` | 未由静态检查确认 | `apps/server/routes/projects.js` |
| POST | `/api/share` | 权限 photos.view | `apps/server/routes/share.js` |
| GET | `/api/share/:code` | 未由静态检查确认 | `apps/server/routes/share.js` |
| POST | `/api/share/:code/approve` | 权限 photos.view | `apps/server/routes/share.js` |
| GET | `/api/share/:code/pending` | 权限 photos.view | `apps/server/routes/share.js` |
| POST | `/api/share/:code/revoke` | 权限 photos.view | `apps/server/routes/share.js` |
| GET | `/api/share/mine` | 权限 photos.view | `apps/server/routes/share.js` |
| GET | `/api/similarity/groups` | 权限 photos.view | `apps/server/routes/similarity_groups.js` |
| GET | `/api/similarity/groups/simple` | 未由静态检查确认 | `apps/server/routes/similarity_groups.js` |
| GET | `/api/similarity/pairs` | 权限 photos.view | `apps/server/routes/similarity_groups.js` |
| POST | `/api/upload/photo` | 权限 upload.photo | `apps/server/routes/upload.js` |
| POST | `/api/upload/photo/direct/abort` | 权限 upload.photo | `apps/server/routes/upload.js` |
| POST | `/api/upload/photo/direct/complete` | 权限 upload.photo | `apps/server/routes/upload.js` |
| POST | `/api/upload/photo/direct/init` | 权限 upload.photo | `apps/server/routes/upload.js` |
| POST | `/api/upload/video` | 权限 upload.photo | `apps/server/routes/upload.js` |
| POST | `/api/upload/video/direct/abort` | 权限 upload.photo | `apps/server/routes/upload.js` |
| POST | `/api/upload/video/direct/complete` | 权限 upload.photo | `apps/server/routes/upload.js` |
| POST | `/api/upload/video/direct/init` | 权限 upload.photo | `apps/server/routes/upload.js` |
| PUT | `/api/upload/video/direct/part-proxy/:sessionId/:partNumber` | 权限 upload.photo | `apps/server/routes/upload.js` |
| POST | `/api/upload/video/direct/parts` | 权限 upload.photo | `apps/server/routes/upload.js` |
| GET | `/api/users/:id` | 登录 | `apps/server/routes/users.js` |
| PUT | `/api/users/:id/access` | 未由静态检查确认 | `apps/server/lib/user_access_admin.js` |
| GET | `/api/users/:id/idp-profiles` | 登录 | `apps/server/routes/users.js` |
| PATCH | `/api/users/:id/role` | 登录、权限 users.manage_roles | `apps/server/routes/users.js` |
| GET | `/api/users/access` | 未由静态检查确认 | `apps/server/lib/user_access_admin.js` |
| GET | `/api/users/all` | 登录、权限 users.view_all | `apps/server/routes/users.js` |
| GET | `/api/users/duplicates` | 登录 | `apps/server/routes/users.js` |
| POST | `/api/users/email-code` | 未由静态检查确认 | `apps/server/routes/users.js` |
| GET | `/api/users/invitations` | 登录 | `apps/server/lib/invitation_management.js` |
| POST | `/api/users/invitations` | 登录、权限 users.invitations.create | `apps/server/routes/users.js` |
| DELETE | `/api/users/invitations/:id` | 登录 | `apps/server/lib/invitation_management.js` |
| POST | `/api/users/login` | 未由静态检查确认 | `apps/server/routes/users.js` |
| GET | `/api/users/me` | 登录 | `apps/server/routes/users.js` |
| PUT | `/api/users/me` | 登录 | `apps/server/routes/users.js` |
| POST | `/api/users/me/invite` | 登录 | `apps/server/routes/users.js` |
| PUT | `/api/users/me/password` | 登录 | `apps/server/routes/users.js` |
| POST | `/api/users/merge` | 登录 | `apps/server/routes/users.js` |
| GET | `/api/users/merge/preview` | 登录 | `apps/server/routes/users.js` |
| POST | `/api/users/register` | 未由静态检查确认 | `apps/server/routes/users.js` |
| GET | `/api/users/workspace-join/inbox` | 未由静态检查确认 | `apps/server/lib/workspace_join.js` |
| GET | `/api/users/workspace-join/me` | 未由静态检查确认 | `apps/server/lib/workspace_join.js` |
| POST | `/api/users/workspace-join/read` | 未由静态检查确认 | `apps/server/lib/workspace_join.js` |
| POST | `/api/users/workspace-join/requests` | 未由静态检查确认 | `apps/server/lib/workspace_join.js` |
| POST | `/api/users/workspace-join/requests/:id/review` | 未由静态检查确认 | `apps/server/lib/workspace_join.js` |
| POST | `/api/users/workspace-join/requests/:id/withdraw` | 未由静态检查确认 | `apps/server/lib/workspace_join.js` |
| POST | `/api/users/workspace-join/skip` | 未由静态检查确认 | `apps/server/lib/workspace_join.js` |
| GET | `/api/users/workspace-join/summary` | 未由静态检查确认 | `apps/server/lib/workspace_join.js` |
| GET | `/api/video-projects` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| POST | `/api/video-projects` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| DELETE | `/api/video-projects/:id` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| GET | `/api/video-projects/:id` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| PUT | `/api/video-projects/:id` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| POST | `/api/video-projects/:id/render` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| GET | `/api/video-projects/assets` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| POST | `/api/video-projects/assets` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| POST | `/api/video-projects/assets/:assetId/analyze` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| POST | `/api/video-projects/assets/direct/abort` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| POST | `/api/video-projects/assets/direct/complete` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| POST | `/api/video-projects/assets/direct/init` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| GET | `/api/video-projects/renders/:jobId` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| POST | `/api/video-projects/renders/:jobId/cancel` | 权限 ai.generate | `apps/server/routes/video_projects.js` |
| GET | `/api/wechat-compositions` | 权限 ai.generate | `apps/server/routes/wechat_compositions.js` |
| POST | `/api/wechat-compositions` | 权限 ai.generate | `apps/server/routes/wechat_compositions.js` |
| DELETE | `/api/wechat-compositions/:id` | 权限 ai.generate | `apps/server/routes/wechat_compositions.js` |
| GET | `/api/wechat-compositions/:id` | 权限 ai.generate | `apps/server/routes/wechat_compositions.js` |
| PUT | `/api/wechat-compositions/:id` | 权限 ai.generate | `apps/server/routes/wechat_compositions.js` |
| POST | `/api/wechat-compositions/ai-fill` | 权限 ai.generate | `apps/server/routes/wechat_compositions.js` |
| POST | `/api/wechat-compositions/content-template` | 权限 ai.generate | `apps/server/routes/wechat_layout.js` |
| GET | `/api/wechat-compositions/content-template/:clientRequestId` | 权限 ai.generate | `apps/server/routes/wechat_layout.js` |
| GET | `/api/wechat-compositions/content-templates` | 未由静态检查确认 | `apps/server/routes/wechat_content_templates.js` |
| POST | `/api/wechat-compositions/content-templates` | 未由静态检查确认 | `apps/server/routes/wechat_content_templates.js` |
| DELETE | `/api/wechat-compositions/content-templates/:id` | 未由静态检查确认 | `apps/server/routes/wechat_content_templates.js` |
| PUT | `/api/wechat-compositions/content-templates/:id` | 未由静态检查确认 | `apps/server/routes/wechat_content_templates.js` |
| POST | `/api/wechat-compositions/layout` | 权限 ai.generate | `apps/server/routes/wechat_layout.js` |
| GET | `/api/wechat-compositions/layout/:clientRequestId` | 权限 ai.generate | `apps/server/routes/wechat_layout.js` |
| POST | `/api/wechat-compositions/revision` | 权限 ai.generate | `apps/server/routes/wechat_layout.js` |
| GET | `/api/wechat-compositions/revision/:clientRequestId` | 权限 ai.generate | `apps/server/routes/wechat_layout.js` |
| PATCH | `/api/wechat-monitor/accounts/:id` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| POST | `/api/wechat-monitor/accounts/:id/check` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| POST | `/api/wechat-monitor/accounts/:id/import` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| POST | `/api/wechat-monitor/accounts/:id/reclassify` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| GET | `/api/wechat-monitor/articles` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| GET | `/api/wechat-monitor/articles/:id` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| GET | `/api/wechat-monitor/articles/:id/revisions/:revisionId` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| POST | `/api/wechat-monitor/bootstrap` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| GET | `/api/wechat-monitor/groups` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| GET | `/api/wechat-monitor/groups/:id` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| GET | `/api/wechat-monitor/jobs` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| GET | `/api/wechat-monitor/jobs/:id/events` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| POST | `/api/wechat-monitor/jobs/:id/retry` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| GET | `/api/wechat-monitor/overview` | 未由静态检查确认 | `apps/server/routes/wechat_monitor.js` |
| POST | `/api/wechat-preview` | 权限 ai.generate | `apps/server/routes/wechat_preview.js` |
| GET | `/api/wechat-preview/:token` | 未由静态检查确认 | `apps/server/routes/wechat_preview.js` |
| GET | `/api/wechat-style/blocks` | 权限 ai.generate | `apps/server/routes/wechat_style.js` |
| POST | `/api/wechat-style/blocks` | 权限 ai.generate | `apps/server/routes/wechat_style.js` |
| DELETE | `/api/wechat-style/blocks/:id` | 权限 ai.generate | `apps/server/routes/wechat_style.js` |
| POST | `/api/wechat-style/extract` | 权限 ai.generate | `apps/server/routes/wechat_style.js` |
| POST | `/api/wechat-style/import-article` | 权限 ai.generate | `apps/server/routes/wechat_style.js` |
| GET | `/api/wechat-style/monitor-templates` | 权限 ai.generate | `apps/server/routes/wechat_style.js` |
| GET | `/api/workspaces` | 权限 photos.view | `apps/server/routes/workspaces.js` |
| GET | `/api/workspaces/:unitId/candidates` | 权限 photos.view | `apps/server/routes/workspaces.js` |
| GET | `/api/workspaces/:unitId/members` | 权限 photos.view | `apps/server/routes/workspaces.js` |
| DELETE | `/api/workspaces/:unitId/members/:userId` | 权限 photos.view | `apps/server/routes/workspaces.js` |
| PUT | `/api/workspaces/:unitId/members/:userId` | 权限 photos.view | `apps/server/routes/workspaces.js` |
| GET | `/api/workspaces/:unitId/recipients` | 权限 photos.view | `apps/server/routes/workspaces.js` |
| POST | `/api/workspaces/active` | 权限 photos.view | `apps/server/routes/workspaces.js` |
| GET | `/api/workspaces/albums` | 权限 photos.view | `apps/server/routes/workspaces.js` |
| DELETE | `/api/workspaces/face-search/:userId` | 权限 photos.view | `apps/server/routes/workspaces.js` |
| PUT | `/api/workspaces/face-search/:userId` | 权限 photos.view | `apps/server/routes/workspaces.js` |
| GET | `/api/workspaces/face-search/grants` | 权限 photos.view | `apps/server/routes/workspaces.js` |
| GET | `/api/workspaces/stats/ai` | 权限 photos.view | `apps/server/routes/workspaces.js` |
| GET | `/api/wx-img` | 未由静态检查确认 | `apps/server/routes/wx_image_proxy.js` |
