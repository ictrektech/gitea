# Gitea for VOS

基于 [Gitea](https://github.com/go-gitea/gitea) 的轻量 Git 代码托管与评审应用，适配 VOS 身份、语言、公共目录和应用商店。上游介绍保留在 [README-legacy.md](README-legacy.md)，fork 来源见 [UPSTREAM](UPSTREAM)。

## 使用

安装时选择 AMD64 / ARM64 profile，并为“Gitea 数据目录”选择专用 VOS 公共目录或宿主机路径。CPU 镜像不要求 CUDA；ARM64 镜像适用于 L4T / Thor / Spark。

侧栏只有两个同级页面，VOS 自动提供应用层级：

```text
Gitea
├── 代码管理
└── API 接入指南
```

保留原生仓库、Issue、Pull Request、组织和团队权限，仓库默认私有。两页同步 VOS 语言和主题，API 指南提供中英文说明。

## 身份与用户同步

浏览器使用 VOS SDK 的 OAuth2 authorization code + PKCE S256 并校验 state；后端调用固定配置的 `/v1000/oauth2/userinfo` 验证身份，不信任客户端用户名或身份头。

首次访问自动创建账户，优先使用 VOS 用户名；遇到重名时加稳定短后缀，无法使用时保留内部名称。旧版生成的账号下次登录时会原位迁移到可用的用户名，仓库、权限、访问令牌和 SSH 密钥仍归原账号；请按页面显示更新仓库克隆地址。按稳定 `sub` 关联账户，平台改名不改变仓库归属；显示名、语言与系统管理员角色在访问时同步。只有验证结果中的 `role_code=system_admin` 获得管理员权限。邮箱使用稳定的内部占位地址，不以未验证邮箱合并账户。

VOS 令牌请求验证最新 userinfo；原生 PAT 与 SSH 使用平台为应用提供的只读 context 凭据，按绑定的用户 ID 精确查询 `/v1000/user/list`。禁用、删除与角色变化作用于后续用户操作，平台校验不可用时拒绝访问。浏览器会话为 HttpOnly / SameSite，令牌保存在服务端内存，应用重启后重新登录。页面周期性刷新授权，并监听平台语言和主题事件。

Gitea 原生 HTTP 只监听容器内 `127.0.0.1:3000`，VOS HTTP 流量通过 8080 网关；内置 SSH 服务监听 2222。网关清除客户端认证头，注入已验证身份，原生 session 不覆盖当前 VOS 用户。

浏览器统一 VOS 登录；外部 API 可使用原生 PAT（`Authorization: token <PAT>`）或 VOS access token（`Bearer`）。Git HTTPS 支持 PAT / VOS token，SSH 使用原生密钥。PAT 与 SSH 密钥在 Gitea 用户设置中管理；VOS 关联用户名与 subject 绑定不可由本地改名破坏。应用 context 只读挂载，凭据在启动时由 root 读入进程内存，不写入数据目录或镜像。

## 数据与公共目录

| 内容 | 宿主机来源 | 容器路径 |
| --- | --- | --- |
| 裸 Git 仓库 | `GITEA_DATA_PATH/git/repositories` | `/data/git/repositories` |
| LFS、附件、头像 | `GITEA_DATA_PATH/gitea` | `/data/gitea` |
| PGV 独立 PostgreSQL 数据库 | `pgv:5432 / gitea`（专用账户 `gitea`） | 原生数据库连接 |
| 配置、会话、SSH 主机密钥 | `VOS_APP_STORAGE_PATH/config` | `/config` |

`GITEA_DATA_PATH` 是 VOS `type: path` 配置，带 `com.ictrek.gitea.data` hint，可选择公共目录，默认路径为 `/data/vos_workspace/gitea`。入口准备专用目录后以 UID/GID 1000 运行，不递归修改已有数据。

NAS 目录权限独立于 Gitea 仓库权限：能直接读取数据目录的用户也能读取裸仓库和附件，应限制目录授权。已有普通文件夹不会自动导入为仓库。备份前停止应用，同时备份数据、私有配置和 PGV 的 `gitea` 数据库；升级保留原路径。已有 GitLab 的安装与数据不受影响。

## PGV、SSH 与 Actions

应用依赖已发布的 PGV；打包时从其最新 GitHub Release 验证实际版本，并写入 manifest。首次启动通过 VOS 提供的 PGV 管理凭据创建专用 `gitea` 数据库和非超级用户，随机密码保存在私有配置中；Gitea 子进程仅收到专用连接配置。已有数据库或角色的密码不匹配时停止初始化，不自动重置，不修改其他应用数据库。恢复安装时需一起恢复私有配置和数据库。

SSH 默认映射宿主机 `2222` 到容器内置 SSH 服务器，与宿主机管理用 22 端口分离。安装可配置 `GITEA_SSH_PORT`、`GITEA_SSH_DOMAIN`；域名留空时按页面当前访问地址生成 clone URL。公钥在“用户设置 → SSH / GPG 密钥”添加，私钥留在客户端。

Actions 默认开启，Runner 独立安装在构建机。`GITEA_PUBLIC_URL` 决定 Actions checkout、任务 API 和 Webhook 的标准地址：同一 VOS 网络默认使用 `http://gitea:8080/app/com.ictrek.gitea/`，外部 Runner 应配置完整设备地址，例如 `https://<设备IP>:1180/app/com.ictrek.gitea/`，并在任务环境中信任证书。

从仓库、组织、用户或实例的 Actions → Runners 获取对应作用域的注册令牌。使用 Gitea Runner 5.x 注册，持久保存 `.runner`；实例级操作需要管理员。Runner 使用机器凭据，按原生作用域独立运行；浏览器退出不会注销 runner。撤销时在 Runners 页面禁用/删除，注册令牌另行重置。API 指南提供 PAT、SSH、Runner CLI 和 `.gitea/workflows/ci.yml` 示例。

## 构建与验证

Git 操作只在本地执行。先 rsync 当前源码到目标机器的 `~/dev/repos/gitea`，再在机器上执行：

```bash
./build_image.sh --sheet AMD_with_cuda --commit <已推送的本地源码commit>
./build_image.sh --sheet ARM_without_cuda --commit <已推送的本地源码commit>
```

构建上下文、日志和临时验证数据位于 `~/dev/build/gitea`。镜像标签为 `<UPSTREAM_VERSION>-<commit前10位>-amd64/arm64`。支持 `--build-only`；正常流程验证后推送 SWR、更新固定飞书表的 `gitea` 列并读回确认。

构建机上的验证入口：

```bash
node --test docker/vos/gateway.test.mjs
python3 ictrek.app/scripts/verify_runtime.py --image <候选镜像> --postgres-image <已发布PGV镜像>
```

真实镜像验证使用隔离 Docker 网络、PGV 和临时账户，覆盖账户创建、私有仓库隔离、管理员降级、语言、VOS / PAT 撤销与重启持久化。使用 `--keep` 后，在本地运行 `python3 ictrek.app/scripts/verify_ssh_actions.py --host <构建机>` 验证 SSH 克隆/推送、禁用/恢复、Runner 注册和 checkout/任务执行；所有开发源码 Git 操作保留在本地。

## 打包与发布

`ictrek.app/UPSTREAM_VERSION` 记录原始版本，当前为 `29.0.0-dev`。VOS 版本为 `<upstream>.vos.<revision>`，例如 `29.0.0-dev.vos.1`，后续递增 `.2`、`.3`。

1. 提交、推送源码，然后提交、推送 VAI 子模块引用。
2. 分别构建、验证和推送 AMD64 / ARM64 镜像，确认飞书 `AMD_with_cuda` / `ARM_without_cuda` 的 `gitea` 列。
3. 本地运行 `./ictrek.app/scripts/update_version.sh`，仅递增 VOS 修订号并推送 `vos-gitea-v<version>`。
4. GitHub Actions 从飞书读取镜像，验证 pull 包，创建 `v<version>` Release，再通过 SSH tunnel 发布 VOS App Store。打包输出在 `~/dev/build/gitea/ictrek.app`。
5. 检查 workflow、Release 资产与商店记录；在目标 VOS 检查真实页面/API。更新并推送最终 VAI 引用。

Secrets 为 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`APPSTORE_IP`、`APPSTORE_TOKEN`。固定飞书文档 ID `Htotsn3oahO1zxt73YMcaB1zn8e` 不属于 Secret。构建机认证从 `~/.feishu.components.json` 或 `~/.feishu.json` 读取，凭据不进入源码或日志。

## 上游维护

每次代码更新前检查 `UPSTREAM` 指定源的变化，活跃维护期间至少每周检查一次。通过本地 fetch 和普通 merge 合入 `main`，处理冲突并保留 VOS 集成，验证后再推送。上游版本变化时同步更新版本基线。完整规则见 [AGENTS.md](AGENTS.md)。

保留上游 [MIT 许可证](LICENSE)。
