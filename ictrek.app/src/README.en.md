# Gitea __APP_VERSION__

Lightweight Git hosting and code review for VOS with two sibling pages: Code Management and API Integration Guide. Accounts are provisioned on first access; display names, administrator roles and language synchronize from VOS. Repositories are private by default.

Select an architecture and dedicated data directory during installation. VOS public directories are supported. Bare repositories live in `git/repositories/`; LFS and attachments live in `gitea/`. Secrets stay in private application storage; metadata uses a dedicated PGV PostgreSQL database and role named gitea. Restrict direct NAS access independently of Gitea repository permissions. Stop the app and back up data, private configuration and the PGV gitea database together.

API prefix: `/app/com.ictrek.gitea/api/v1`. Same-host applications use `http://gitea:8080/app/com.ictrek.gitea/api/v1`. Use VOS access tokens for API requests and as Git HTTPS passwords. The in-app guide describes OAuth2 / PKCE. Browser login uses VOS. Native PATs, SSH and Actions are enabled. Git SSH defaults to port 2222. Configure the complete Gitea Public URL for external runners and checkout/job APIs. The in-app guide covers registration, workflows and credential revocation.

Keep the same storage paths on upgrades. Existing GitLab accounts, repositories and data are not migrated or removed.
