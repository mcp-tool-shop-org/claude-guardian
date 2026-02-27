import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: 'claude-guardian',
  description: 'Flight computer for Claude Code — log rotation, watchdog, crash bundles, and MCP self-awareness',
  logoBadge: 'CG',
  brandName: 'claude-guardian',
  repoUrl: 'https://github.com/mcp-tool-shop-org/claude-guardian',
  npmUrl: 'https://www.npmjs.com/package/claude-guardian',
  footerText: 'MIT Licensed — built by <a href="https://github.com/mcp-tool-shop-org" style="color:var(--color-muted);text-decoration:underline">mcp-tool-shop-org</a>',

  hero: {
    badge: 'Local reliability',
    headline: 'Your Claude Code',
    headlineAccent: 'flight computer.',
    description: 'Detects hangs, captures evidence, enforces concurrency budgets, and exposes 8 MCP tools so Claude can self-monitor mid-session. Local-only, no network, no telemetry.',
    primaryCta: { href: '#usage', label: 'Get started' },
    secondaryCta: { href: '#features', label: 'How it works' },
    previews: [
      { label: 'Install', code: 'npm install -g claude-guardian' },
      { label: 'Status', code: 'claude-guardian status --banner\n# [guardian] disk=607GB | logs=150MB | risk=ok' },
      { label: 'MCP', code: '// Claude calls guardian_status mid-session\n// "Health looks bad. Running guardian_nudge."' },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'features',
      title: 'How It Works',
      subtitle: 'Signals, incidents, budgets — deterministic reliability with zero heuristics.',
      features: [
        {
          title: 'Composite hang detection',
          desc: 'Three independent signals (log mtime, CPU activity, grace window) vote on whether Claude is stuck. No single false positive can trigger.',
        },
        {
          title: 'Incident state machine',
          desc: 'ok → warn → critical lifecycle with automatic bundle capture, deduplication, and timeline reconstruction.',
        },
        {
          title: 'Concurrency budget',
          desc: 'Deterministic cap transitions (4 → 2 → 1 slots) with lease-based control. Prevents dogpiling when under pressure.',
        },
        {
          title: 'Evidence, not guesses',
          desc: 'Doctor bundles capture process snapshots, log tails, timelines, and journal entries. Attach to issues, not vibes.',
        },
        {
          title: '8 MCP tools',
          desc: 'Claude can check health, fix logs, capture bundles, manage budget, and get step-by-step recovery plans — all mid-session.',
        },
        {
          title: 'Local-only trust model',
          desc: 'No network, no telemetry, no cloud. Reads local logs and process metrics. Writes only to ~/.claude-guardian/.',
        },
      ],
    },
    {
      kind: 'code-cards',
      id: 'usage',
      title: 'Usage',
      cards: [
        {
          title: 'Install & check health',
          code: 'npm install -g claude-guardian\n\nclaude-guardian status\nclaude-guardian status --banner',
        },
        {
          title: 'Fix log bloat',
          code: '# Scan and auto-repair oversized logs\nclaude-guardian preflight --fix\n\n# Aggressive mode when disk is critical\nclaude-guardian preflight --fix --aggressive',
        },
        {
          title: 'Background daemon',
          code: '# Continuous monitoring + budget enforcement\nclaude-guardian watch --verbose\n\n# Check budget\nclaude-guardian budget show',
        },
        {
          title: 'MCP server for Claude',
          code: '// Add to ~/.claude.json:\n{\n  "mcpServers": {\n    "guardian": {\n      "command": "npx",\n      "args": ["claude-guardian", "mcp"]\n    }\n  }\n}',
        },
      ],
    },
    {
      kind: 'data-table',
      id: 'mcp-tools',
      title: 'MCP Tools',
      columns: ['Tool', 'Purpose'],
      rows: [
        ['guardian_status', 'Disk, logs, processes, hang risk, budget, attention level'],
        ['guardian_preflight_fix', 'Rotate/trim oversized logs, returns before/after report'],
        ['guardian_doctor', 'Generate diagnostics bundle with full evidence'],
        ['guardian_nudge', 'Safe auto-remediation: fix logs, capture bundles'],
        ['guardian_budget_get', 'Current concurrency cap and active leases'],
        ['guardian_budget_acquire', 'Request concurrency slots (returns lease ID)'],
        ['guardian_budget_release', 'Release a lease when done with heavy work'],
        ['guardian_recovery_plan', 'Step-by-step recovery naming exact tools to call'],
      ],
    },
  ],
};
