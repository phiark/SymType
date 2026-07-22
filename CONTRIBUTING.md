# Contributing to SymType

SymType is a private, local-first product. Contributions must preserve the V1 user experience,
SQLite history, deterministic training results, and the security boundary described in `AGENTS.md`.
Read `AGENTS.md` before starting any task. For V2 work, also read `docs/v2/V2-SCOPE.md`,
`docs/v2/V2-PLAN.md`, and `docs/v2/REQUIREMENTS-MATRIX.md`.

## Stable branch and bootstrap

`main` is the only stable branch. Do not develop on it, commit product files directly to it,
force-push it, or merge incomplete work.

The only exception applies when the remote repository has no commits: an administrator may create
one file-free initialization commit on `main`, for example:

```sh
git commit --allow-empty -m "chore: initialize repository"
```

That commit must contain no source, documentation, workflow, or configuration files. Protect
`main` immediately afterward; all repository files, including the initial import, must then enter
through an Issue-linked branch and Pull Request.

## Issue first

Create or confirm one GitHub Issue before changing files. The Issue must make the work independently
verifiable and include:

- background, current behavior, expected behavior, and user impact;
- reproducible steps or the evidence still needed to reproduce;
- initial cause or implementation analysis without presenting guesses as facts;
- proposed scope and explicit non-goals;
- acceptance criteria, required tests, risks, and compatibility or data implications;
- relevant logs or screenshots with secrets and personal data removed.

Do not patch an unstable or unexplained failure by guesswork. Gather a minimal reproduction first.

## Branches

Fetch the remote, fast-forward local `main`, and create exactly one issue-scoped branch:

```sh
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c fix/123-short-description
```

Use one of these forms:

- `feature/<issue>-<short-description>`
- `fix/<issue>-<short-description>`
- `hotfix/<issue>-<short-description>`
- `refactor/<issue>-<short-description>`
- `docs/<issue>-<short-description>`
- `test/<issue>-<short-description>`
- `chore/<issue>-<short-description>`

Use lowercase words separated by hyphens. One branch solves one Issue; split unrelated work instead
of hiding it in a broad PR. Synchronize with current `main` before final review.

## Implementation and commits

Make the smallest complete change that satisfies the Issue. Preserve unrelated work in a dirty
worktree. Database migrations are append-only, SQL is parameterized, imported content stays plain
text, and local databases, logs, credentials, tokens, `.env`, and user data must never be committed.

Prefer Conventional Commits and keep each commit to one coherent intent:

```text
feat(training): add focused symbol filter
fix(storage): make event batch retry idempotent
test(game): cover hardcore campaign reset
docs(contributing): document review gate
```

Explain why the change is needed. Reference the Issue in the commit or PR with `Refs #123`; use
`Fixes #123` or `Closes #123` only when merging the PR should close it. Inspect both `git diff` and
the staged diff before every commit. Never commit temporary diagnostics or use vague messages such
as `update files` or `fix stuff`.

## Verification

During implementation, run the smallest relevant unit/integration tests plus type checking. Before
opening or updating a PR, run from the repository root:

```sh
npm ci
npm run format:check
npm run check
```

`npm run check` runs lint, strict TypeScript checking, unit/integration and V1 fixed-output
regressions, then all production builds. Do not delete tests, weaken valid thresholds, swallow
errors, or skip a failing requirement to make the gate pass.

Changes to browser behavior or a release candidate additionally require:

```sh
npm run test:e2e
```

Record the actual Chromium and WebKit result in the PR. Visual changes need focused screenshots at
the affected viewport. Database, restore, migration, or event-pipeline changes need a targeted data
safety test. If a check cannot run, state the exact reason, impact, and remaining action; it is not a
pass.

## Pull Requests and review

Push only the issue branch and open a Pull Request into `main`. Complete the repository PR template,
link the Issue, keep the diff in scope, and include test commands with observed results. Document API,
database, configuration, dependency, migration, security, and rollback implications explicitly.

A PR may merge only when all of the following are true:

- its linked Issue and acceptance criteria are clear and satisfied;
- required tests, formatting, lint, type checking, build, and CI pass;
- new or changed behavior has appropriate regression coverage;
- no unresolved review conversation, merge conflict, secret, or unexplained destructive change remains;
- the branch contains current `main`, documentation is accurate, and final acceptance is recorded;
- at least one reviewer has approved the PR.

Prefer squash merge so one PR produces one clear commit on `main`. Delete the merged branch, verify
`main` again, and close or update the Issue. Never merge with failed CI or bypass review because a
change looks small.

## Releases

Prepare a release through its own Issue and closing PR. Confirm the target Issues, migrations,
upgrade and rollback steps, quality gates, E2E evidence, documentation, version, `CHANGELOG.md`, and
release notes before merging. Create a tag and GitHub Release only after the release PR is accepted
and `main` is verified. Do not label an unaccepted build as a formal release.

## Security and sensitive data

Before pushing, inspect staged files for API keys, tokens, passwords, private keys, `.env` files,
SQLite databases, application-data directories, logs, and imported user content. If a secret has
entered Git history, stop distribution, open a private security report, revoke and rotate it, and
coordinate history cleanup; deleting the current file is not sufficient. See `.env.example` for
safe configuration names and never place real values there.
