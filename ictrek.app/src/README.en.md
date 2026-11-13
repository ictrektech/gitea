# Gitea __APP_VERSION__

Lightweight Git hosting and code review for VOS with two sibling pages: Code Management and API Integration Guide. Accounts are provisioned on first access; display names, administrator roles and language synchronize from VOS. Repositories are private by default.

Select an architecture and dedicated data directory during installation. VOS public directories are supported. Bare repositories live in `git/repositories/`; LFS and attachments live in `gitea/`. Secrets stay in private application storage; metadata uses a dedicated PGV PostgreSQL database and role named gitea. After a reinstall that loses private configuration, the app adopts the existing PGV database without manual repair; delete that database and role first for a clean instance. Restrict direct NAS access independently of Gitea repository permissions. Stop the app and back up data, private configuration and the PGV gitea database together.

API prefix: `/app/com.ictrek.gitea/api/v1`. Same-host applications use `http://gitea:8080/app/com.ictrek.gitea/api/v1`. Use VOS access tokens for API requests and as Git HTTPS passwords. The in-app guide describes OAuth2 / PKCE. Browser login uses VOS. Native PATs, SSH and Actions are enabled. Git SSH defaults to port 32222. Configure the complete Gitea Public URL for external runners and checkout/job APIs. The in-app guide covers registration, workflows and credential revocation.

The app starts one Actions runner (`act-runner`) by default. It registers with a global registration token, so no administrator action is needed. The runner mounts the host `/var/run/docker.sock`, which grants container creation and root-equivalent host access. Job containers join the `vos_default` network and reach the instance at `http://gitea:8080/app/com.ictrek.gitea`. The default job image is `node:22-bookworm`; mirror it into a local registry and update the runner labels for offline deployments. A bare `uses: owner/repo@ref` resolves against the Gitea Public URL, which must present a valid certificate when it uses HTTPS.

The app also runs the official `gitea-mcp` server (service `gitea-mcp`), exposing a stateless HTTP endpoint at `/app/com.ictrek.gitea/mcp` for external AI agents. The gateway enforces credentials: `Authorization` must hold a VOS access token or the caller's own Gitea PAT, The gateway accepts only `Bearer`, `token` and `Basic`; the first two are equivalent. Missing or invalid credentials return `401`. The server stores no credentials, so permissions follow that user. Only repository, file, branch, pull_request and issue tools are enabled; creating repositories needs `write:user` on the PAT. Mismatching `Origin` headers are rejected.

Keep the same storage paths on upgrades. Existing GitLab accounts, repositories and data are not migrated or removed.

Under Actions → Runners, open the discovered local GARM or enter the full HTTP/HTTPS URL of a GARM instance on another device. The address stays in the current browser. Native runner management remains available when local GARM is absent. Opening GARM does not register a runner.

On VOS with Traefik v3, opening the app root directly in a browser redirects to its VOS page. Embedded pages and API requests use their existing routes.
