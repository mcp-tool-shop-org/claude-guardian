# claude-guardian: how it works

Mapped at 2026-09-30 from commit b484cb2 by Atlas 1.24.0.

## What this is

7 parts, mostly Markdown (75 files); code in TypeScript (38), CSS (2), Astro (1) and JavaScript (1). Work enters through 5 doors; CI and Release each reach 2 parts, and CI is followed because a pull request goes through it. It publishes to npm. It deploys a site to GitHub Pages. People run claude-guardian.

## What changed since 2026-09-23 (628c46f)

- src no longer imports the repository root.
- CI's pull request trigger now also names `atlas/**` and `codecov.yml`.
- CI's push trigger now also names `atlas/**` and `codecov.yml`.
- Dogfood now also runs src/cli.ts.
- package.json is now also read by src/cli.ts.
- 1 file added and 130 changed content, across 7 parts.

## What comes in

1. **CI.** On a pull request touching 11 paths; on a push to main touching 11 paths; or by hand. Runs tests/; builds src/.
2. **Release.** When a tag matching `v*` is pushed; or by hand. Runs tests/; builds src/.
3. **Deploy site to GitHub Pages.** On a push to main touching 2 paths; or by hand. Runs site/astro.config.mjs and site/src/.
4. **Dogfood.** On a push to main touching 3 paths; or by hand. On main, it runs src/cli.ts; builds src/.
5. **claude-guardian** (a command people run). Runs src/cli.ts.

## What happens through CI

1. The workflow runs tests/ in tests; it builds src/ in src.
2. It uploads coverage to Codecov.

## Who reads the results

CI writes nothing this map can see.

## The other doors

**Release** runs tests/, builds src/, publishes to npm, and creates a GitHub release.

**Deploy site to GitHub Pages** runs site/astro.config.mjs and site/src/, and deploys the site.

**Dogfood** runs src/cli.ts on main and sends a dispatch to dogfood-lab/testing-os on main.

**claude-guardian** (a command people run) runs src/cli.ts.

## What breaks what

- **src** is imported only from tests, by 1 part (tests), and sits on the path of 4 doors.
- **tests** is imported by no other part and sits on the path of 2 doors.

## What tends to change together

No two source files changed together often enough to name.

Window: 180 days; a pair counts from 3 shared commits, since the window holds fewer than 30 qualifying commits.

## What no test touches

Every code part is imported by at least one test.

## Written but never read

No place this map can see is written, so none goes unread.

## Helpers that look duplicated

No two parts export a helper that looks alike.

## Generated, never hand-edited

Nothing in this repository writes to a tracked place this map can see.

## Hand-authored

People write .claude/, .github/, docs/, the repository root and site/; 1 write with a path built at run time may land here.

## Where to start

.github/workflows/ci.yml → src/cli.ts → src/log-manager.ts → src/defaults.ts → src/types.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 1 import could not be resolved: `src/mcp-server.ts` imports `zod`, which is not declared.
- 1 write and 3 reads use paths built at run time and are not named here.
- 14 writes and 17 reads go to the home directory (.claude-guardian/ and .claude/), not to this repository.
- 2 writes and 9 reads go to a path their caller passes, not to this repository.
- 1 write and 3 reads go to the home directory (.claude-guardian/ and .claude/) or a path their caller passes, not to this repository.
- 1 read goes to the directory the command is run in (package.json), not to this repository.
- 6 commands are built at run time and not followed.
- Statistics confidence is low: fewer than 30 qualifying commits in the window, and fewer than 25 source files reach 10 revisions.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
