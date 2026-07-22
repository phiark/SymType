# Third-party notices

SymType source code is licensed under the MIT License in `LICENSE`. The application includes or
depends on open-source packages with their own licenses. Their copyright notices and complete
license texts remain authoritative in each installed package and its upstream repository.

## Runtime packages

| Package or family                | License       |
| -------------------------------- | ------------- |
| Fastify and `@fastify/static`    | MIT           |
| better-sqlite3                   | MIT           |
| SQLite bundled by better-sqlite3 | Public domain |
| Zod                              | MIT           |
| React and React DOM              | MIT           |
| React Router                     | MIT           |
| TanStack Query                   | MIT           |
| Radix UI React primitives        | MIT           |
| Recharts                         | MIT           |
| Lucide / lucide-react icons      | ISC           |

## Build and test packages

| Package or family                                            | License    |
| ------------------------------------------------------------ | ---------- |
| TypeScript                                                   | Apache-2.0 |
| Playwright                                                   | Apache-2.0 |
| `@axe-core/playwright` and axe-core                          | MPL-2.0    |
| `caniuse-lite` browser compatibility data                    | CC-BY-4.0  |
| Vite, Vitest, tsx, tsup, ESLint, Prettier, typescript-eslint | MIT        |
| Testing Library and jsdom                                    | MIT        |
| concurrently                                                 | MIT        |

Transitive dependencies are locked in `package-lock.json`. After installation, their package
metadata and license files are available below `node_modules`; distribution audits should inspect
the exact lockfile-resolved tree rather than treating this concise list as a replacement for those
notices.

## Bundled text content

Most training text, data templates, code snippets, and Pineapple Breach material are original
SymType content released under CC0 1.0 Universal. A short excerpt from L. Frank Baum's _The
Wonderful Wizard of Oz_ (1900) is treated as public domain in the United States. See
`packages/content/CONTENT_NOTICE.md` and `packages/content/THIRD_PARTY_NOTICES.md` for provenance and
jurisdiction caveats.

## Keybr clean-room boundary

Keybr is not a SymType dependency. Keybr's public repository is licensed AGPL-3.0; none of its source
code, icons, wording, bundled assets, or page layout is included here. SymType is an independent
clean-room implementation informed only by publicly described behavior, cited research, and the
user's written functional inventory. The eight screenshots referenced by that inventory were not
present in the workspace, so no screenshot-specific comparison is claimed. Keybr remains the work
of its respective authors and is available at <https://github.com/aradzie/keybr.com> under its own
license.
