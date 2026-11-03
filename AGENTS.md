- Never assume, verify before claiming
- List development targets with `make help`
- Before working on code, read the `docs` guides for every area touched: `guidelines-backend.md` for Go, `guidelines-frontend.md` for TS, CSS and Vue, both for templates, `testing.md` for tests, `development.md` for config options and migrations, `guidelines-refactoring.md` for refactors
- PR descriptions: minimal, only what and why, no task or file listings. Include screenshots for UI changes, before and after when modifying existing UI. Aim for less than 1000 characters
- Reference issues and PRs by full URL, not by number
- Use Conventional Commits for commit messages and PR titles, plus Gitea's `enhance` type for user-facing enhancements
- Add an `Assisted-by: AGENT_NAME:MODEL_VERSION` trailer to commit messages, never `Co-Authored-By` or `Signed-off-by`
- Attribute agent authorship on one trailing line in issue and PR comments, never as a PR description section
- Never rewrite git history unless asked, update PRs with new commits and normal push
- Comments: write almost none, short and preferably same-line, explaining why for a future reader. Never narrate code, the change or the prompt. Preserve existing ones that still apply. If you need to write a paragraph-long comment, rethink your implementation, it is likely too complicated
- Add the current year to copyright headers of new `.go` files
- In `options/locale`, only edit `locale_en-US.json`, other locales are synced automatically
- In TS, use `!` instead of `?.`/`??` when a value always exists
- In Go, prefer to use modern language features wherever possible
- In Go, function-name prefixes in errors like `fmt.Errorf("Foo: %w", err)` must always name the function they are in
- Write sizes as multiplications like `64 * 1024`, not bit shifts like `64 << 10`
- Prefer `tw-*` utilities over inline `style` and `flex-*` helpers over per-child `tw-ml-*`/`tw-mr-*` margins, falling back to `tw-*` where specificity requires `!important`
- Run `make fmt` after `.go` edits, `make tidy` after `go.mod` edits, `make generate-swagger` after API changes, and lint what changed with `make lint-go`, `lint-js`, `lint-css` or `lint-templates`
- Fix the cause rather than disabling a linter or weakening a test. Where unavoidable, use the narrowest scope with a trailing comment giving the reason
- Run single tests with `go test -run '^TestName$' ./modulepath/` for Go, `pnpm exec vitest <path-filter>` for TS and `GITEA_TEST_E2E_FLAGS='<filepath>' make test-e2e` for e2e
- Write the fewest, fastest tests covering the behavior, extending an existing one where possible. Prefer unit tests where logic is testable in isolation
- Aim for sub-2s per integration test and sub-4s per e2e test. Wait on a deterministic condition rather than `sleep`, and prefer semantic locators in e2e tests


## VOS fork maintenance

- Before changing this fork, read `README.md` for the VOS identity, storage and release contract. `UPSTREAM` is the canonical fork source.
- At the start of code-update work, fetch the upstream source locally and review changes since the last merge. During active maintenance, check upstream at least weekly. Add the `upstream` remote from `UPSTREAM` if absent; preserve `origin` as the ICTrek fork.
- Merge applicable upstream updates into the fork's `main` branch with a normal merge. Preserve VOS authentication, user/role synchronization, public-directory mapping, PGV persistence, locale synchronization, native PAT/SSH/Actions and the two sibling VOS pages. Resolve conflicts in source and rerun the focused gateway and image runtime checks before pushing.
- After an upstream version change, verify its version/tag ancestry and update `ictrek.app/UPSTREAM_VERSION` and the VOS version base together. Images use `<upstream>-<short-source-commit>-<architecture>`; VOS revisions use `<upstream>.vos.<revision>`. Keep image source commits distinct from packaging-only release commits.
- All Git operations run locally. Sync source with rsync before remote builds/tests; run them under the build host's `~/dev/build/gitea`. Reuse `build_image.sh` and `ictrek.app/scripts/update_version.sh`; verify registry push, Feishu read-back, GitHub Release and App Store publication separately.
