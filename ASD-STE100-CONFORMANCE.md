# ASD-STE100 Conformance Target

**Target:** ASD-STE100 Issue 9
**Issue date:** 2025-01-15
**State:** Blocked pending the official local PDF

> Target: ASD-STE100 Issue 9. Automated checks cover listed rules. A human review covers semantic rules.

## Scope

The review applies to first-party English technical prose. It includes repository guides, plans,
architecture, API documents, maintenance documents, install procedures, troubleshooting procedures,
release notes, and instructional code comments.

## Exclusions

The review excludes third-party licenses, direct quotations, legal text, code fences, inline code,
commands, paths, identifiers, data keys, generated reports, and generated files.

## Term rules

`docs/ste/terms.yml` records approved project terms. The term base needs a normative and semantic
review before release.

## Automatic review

`npm run docs:ste` does not exist yet. Gate 6 will add a Markdown syntax-tree checker, rule fixtures,
version pins, JSON or SARIF output, and a short human checklist.

## Human review

The human review will cover passive voice, multiple actions, ambiguous pronouns, approved meaning,
part of speech, paragraph topics, long noun groups, and `-ing` forms.

## Normative evidence

The workspace search did not find an official Issue 9 PDF. The user has been asked for a local path.
Do not claim ASD approval, ASD certification, tool certification, or completed conformance.
