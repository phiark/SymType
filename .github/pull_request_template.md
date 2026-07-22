## Purpose

Closes #<!-- required issue number -->

<!-- Why is this change needed? -->

## Changes

<!-- Summarize the smallest complete behavior change. -->

## Out of scope

<!-- List adjacent work intentionally excluded from this PR. -->

## Verification

| Command or check                      | Result and evidence |
| ------------------------------------- | ------------------- |
| `npm run format:check`                |                     |
| `npm run check`                       |                     |
| Targeted tests                        |                     |
| Chromium/WebKit E2E, if required      |                     |
| Visual/manual acceptance, if required |                     |

## Impact

- API:
- Database or migration:
- Settings or configuration:
- Dependencies:
- Security and privacy:
- V1 fixed outputs and user data:

## Risk and rollback

<!-- Describe credible failure modes, detection, and a safe rollback. Never rely on deleting user data. -->

## Screenshots or logs

<!-- Add sanitized evidence when useful; never include private typing content, databases, or secrets. -->

## Acceptance checklist

- [ ] The linked Issue has clear acceptance criteria and this diff stays within them.
- [ ] Relevant behavior has unit, integration, browser, visual, or data-safety coverage.
- [ ] Formatting, lint, type checking, tests, and production build pass.
- [ ] No secret, `.env`, local database, user content, generated artifact, or unrelated change is included.
- [ ] Documentation and the applicable requirement matrix are current.
- [ ] API, database, migration, dependency, security, compatibility, and rollback effects are documented above.
- [ ] The branch contains current `main`, has no unresolved conflict, and is ready for review.
- [ ] CI is green, review conversations are resolved, and at least one approving review exists before merge.
