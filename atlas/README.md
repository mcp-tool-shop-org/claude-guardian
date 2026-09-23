# claude-guardian: how it works

Mapped at 2026-09-23 from commit 628c46f.

## What this is

7 parts, mostly TypeScript (38 files). Work enters through 5 doors; the busiest is CI, which reaches 3 parts. It publishes to npm. People run claude-guardian.

## What changed since the last map

This is the first map.

## What comes in

1. **CI.** On a pull request touching 9 paths; on a push to main touching 9 paths; or by hand. Runs tests/; checks src/.
2. **Release.** When a tag matching `v*` is pushed; or by hand. Runs tests/; checks src/.
3. **Dogfood.** On a push to main touching 3 paths; or by hand. Checks src/.
4. **Deploy site to GitHub Pages.** On a push to main touching 2 paths; or by hand. Runs site/astro.config.mjs and site/src/.
5. **claude-guardian** (a command people run). Runs src/cli.ts.

## What happens through CI

1. The workflow runs tests/ in tests; it checks src/ in src.
2. That reaches the repository root (1 file).

## Who reads the results

CI writes nothing this map can see.

## The other doors

**Release** runs tests/, checks src/, reaches the repository root, publishes to npm, and creates a GitHub release.

**Dogfood** checks src/, reaches the repository root, and sends a dispatch to dogfood-lab/testing-os on main.

**Deploy site to GitHub Pages** runs site/astro.config.mjs and site/src/, and deploys the site.

**claude-guardian** (a command people run) runs src/cli.ts and reaches the repository root.

## What breaks what

- **the repository root** is imported by 1 part (src) and sits on the path of 4 doors.
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

People write .claude/, .github/, docs/, the repository root and site/; 15 writes with paths built at run time may land here.

## Where to start

.github/workflows/ci.yml → tests/budget-mcp.test.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 15 writes and 24 reads use paths built at run time and are not named here.
- 1 command is built at run time and not followed.
- Statistics confidence is low: fewer than 30 qualifying commits in the window, and fewer than 20 source files reach 10 revisions.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
