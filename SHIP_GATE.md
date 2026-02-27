# Ship Gate

This checklist must be fully checked before any release is called "done."

## Code

- [ ] `npm run verify` passes (test + build + pack)
- [ ] No TypeScript errors (`npx tsc`)
- [ ] All tests pass (`npx vitest run`)
- [ ] No `npm audit` critical/high vulnerabilities

## Safety

- [ ] SECURITY.md exists with reporting instructions
- [ ] README includes trust model (what data is touched, what is not)
- [ ] README includes dangerous actions statement (no kills, no deletes, no network)
- [ ] No `--allow-kill` or `--allow-restart` flags ship enabled by default
- [ ] MCP tools return structured errors, never stack traces
- [ ] State/budget corruption degrades gracefully (backup + reset)
- [ ] CLI never prints raw stack traces without `--debug`

## Documentation

- [ ] README is current (all commands, all MCP tools, install instructions)
- [ ] CHANGELOG.md updated for this release
- [ ] HANDBOOK.md covers daily ops, warn/critical response, budget, bundles
- [ ] CLI `--help` output is accurate for all commands

## Release Hygiene

- [ ] Version bumped in package.json, cli.ts, mcp-server.ts
- [ ] `npm pack --dry-run` includes: dist/, README.md, CHANGELOG.md, HANDBOOK.md, LICENSE
- [ ] package-lock.json committed
- [ ] `engines.node` is set (>=18)
- [ ] Git tag matches package.json version

## Identity (optional, does not block ship)

- [ ] Logo in README header
- [ ] GitHub social preview set
- [ ] npm package icon configured
