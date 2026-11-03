# Gitea __APP_VERSION__

VOS 轻量代码托管与评审应用，提供“代码管理”和“API 接入指南”两个同级页面。首次访问自动同步 VOS 账户，后续同步显示名、管理员角色和语言；默认创建私有仓库。

安装时选择架构和专用数据目录，可使用 VOS 公共目录。裸仓库位于 `git/repositories/`，LFS 与附件位于 `gitea/`；配置与密钥使用应用私有存储；元数据使用 PGV 专用 `gitea` PostgreSQL 数据库和账户。NAS 目录授权独立于 Gitea 仓库权限，应限制数据目录的直接访问。备份前停止应用，同时备份数据、私有配置和 PGV 的 gitea 数据库。

API 前缀为 `/app/com.ictrek.gitea/api/v1`；同机应用使用 `http://gitea:8080/app/com.ictrek.gitea/api/v1`。外部 API 使用 VOS access token，Git HTTPS 将其作为密码。OAuth2 / PKCE 说明见应用内指南。浏览器统一 VOS 登录，原生 PAT、SSH 和 Actions 已开放。默认 Git SSH 端口为 2222；外部 Runner 请配置完整的“Gitea 对外访问地址”，供 checkout / 任务 API 使用。API 指南包含注册、认证、工作流和凭据撤销说明。

升级保留原路径。本应用不会迁移或删除已安装 GitLab 的账户、仓库或数据。
