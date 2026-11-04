# Gitea __APP_VERSION__

VOS 轻量代码托管与评审应用，提供“代码管理”和“API 接入指南”两个同级页面。首次访问自动同步 VOS 账户，后续同步显示名、管理员角色和语言；默认创建私有仓库。

安装时选择架构和专用数据目录，可使用 VOS 公共目录。裸仓库位于 `git/repositories/`，LFS 与附件位于 `gitea/`；配置与密钥使用应用私有存储；元数据使用 PGV 专用 `gitea` PostgreSQL 数据库和账户。NAS 目录授权独立于 Gitea 仓库权限，应限制数据目录的直接访问。备份前停止应用，同时备份数据、私有配置和 PGV 的 gitea 数据库。

API 前缀为 `/app/com.ictrek.gitea/api/v1`；同机应用使用 `http://gitea:8080/app/com.ictrek.gitea/api/v1`。外部 API 使用 VOS access token，Git HTTPS 将其作为密码。OAuth2 / PKCE 说明见应用内指南。浏览器统一 VOS 登录，原生 PAT、SSH 和 Actions 已开放。默认 Git SSH 端口为 32222；外部 Runner 请配置完整的“Gitea 对外访问地址”，供 checkout / 任务 API 使用。API 指南包含注册、认证、工作流和凭据撤销说明。

默认随应用启动一个 Actions runner（服务 `act-runner`），用全局注册令牌自动注册，无需管理员操作。runner 挂载宿主机 `/var/run/docker.sock`，具备创建容器、等同宿主机 root 的权限。job 容器加入 `vos_default` 网络，通过 `http://gitea:8080/app/com.ictrek.gitea` 访问实例；默认 job 镜像为 `node:22-bookworm`，离线环境需预置到内网 registry 并调整 runner 标签。裸引用 `uses: owner/repo@ref` 解析为“Gitea 对外访问地址”，该地址使用 HTTPS 时必须提供有效证书。

默认同时启动官方 `gitea-mcp` 服务（服务 `gitea-mcp`），在 `/app/com.ictrek.gitea/mcp` 提供无状态 HTTP 端点，供外部 AI Agent 操作仓库。网关强制校验凭据：`Authorization` 必须是 VOS access token 或调用者自己的 Gitea PAT，网关只接受 `Bearer`、`token`、`Basic` 三种写法，前两种等价；无效或无凭据返回 `401`。服务端不保存凭据，权限按该用户生效；只开放 repository、file、branch、pull_request、issue 五类工具，创建仓库需 PAT 含 `write:user`。不匹配的 `Origin` 会被拒绝。

升级保留原路径。本应用不会迁移或删除已安装 GitLab 的账户、仓库或数据。
