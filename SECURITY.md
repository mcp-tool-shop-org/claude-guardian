# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.2.x   | Yes       |
| < 1.2   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in Claude Guardian, please report it responsibly.

**Email:** 64996768+mcp-tool-shop@users.noreply.github.com

**What to include:**
- Description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Potential impact

**Response timeline:**
- Acknowledgement within 48 hours
- Assessment within 7 days
- Fix or mitigation within 30 days for confirmed issues

**Please do NOT:**
- Open a public GitHub issue for security vulnerabilities
- Exploit the vulnerability against other users

## Scope

Claude Guardian is a **local-only** tool. Its attack surface is limited to the machine it runs on. There is no network listener, no remote API, and no cloud telemetry.

Relevant security considerations:
- **File system access**: Reads/writes to `~/.claude-guardian/` and `~/.claude/projects/`. All paths are under the user's home directory.
- **Process inspection**: Uses `pidusage` to read CPU/memory for processes owned by the current user. Does not elevate privileges.
- **No secrets handling**: Guardian never reads, stores, or transmits API keys, tokens, or credentials.
- **MCP transport**: Uses stdio (stdin/stdout), not network sockets. Only the parent process (Claude Code) can communicate with the MCP server.
