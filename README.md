<p align="center">
  <img src="assets/openkaliclaude_logo.png" alt="OpenKaliClaude" width="720" />
</p>

<h1 align="center">OpenKaliClaude</h1>

<p align="center">
  <b>AI-powered cybersecurity CLI that wraps Kali-Linux tools behind a scoped, auditable, MCP-ready interface.</b>
</p>

<p align="center">
  <a href="#installation"><img src="https://img.shields.io/badge/node-%E2%89%A518-green" alt="node"></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <img src="https://img.shields.io/badge/version-2.0.0-blue" alt="version">
  <img src="https://img.shields.io/badge/scope-localhost%2Fprivate%20by%20default-orange" alt="scope">
</p>

---

## 1. Project overview

OpenKaliClaude is a TypeScript framework that lets a human operator — or an AI agent over MCP — drive standard offensive-security tools (Nmap, Nikto, SQLMap, Hashcat, Metasploit, …) through a single, uniform, *guard-railed* interface.

Every tool invocation flows through the same pipeline:

1. **Schema validation** of inputs (via [Zod](https://zod.dev/))
2. **Scope enforcement** — the target must fall inside an allow-list of networks/domains; by default only `127.0.0.0/8`, RFC1918, and `localhost` are reachable.
3. **Argument-injection guards** — string inputs that would otherwise become positional CLI arguments are rejected if they look like flags or contain control characters.
4. **Permission/risk evaluation** — each tool computes a 1–10 risk score and may require explicit confirmation (destructive ops, comprehensive scans, exploitation modules).
5. **Audited execution** — every call is timestamped, attributed to a session ID, and emitted to the audit channel.
6. **Structured reporting** — raw tool output is parsed into a normalized `SecurityReport` of `Finding`s with severity, evidence, and remediation hints.

The point isn't to *replace* the underlying tools — it's to make them safe to expose to an autonomous model and easy to consume programmatically.

---

## 2. Architecture

```
                                   ┌────────────────────────┐
                                   │   Human / AI Agent     │
                                   └────────┬───────────────┘
                                            │
                ┌───────────────────────────┼───────────────────────────┐
                │                           │                           │
        ┌───────▼────────┐         ┌────────▼────────┐         ┌────────▼────────┐
        │  CLI (Ink/TSX) │         │   MCP Server    │         │  Library API    │
        │  bin/okal      │         │  stdio JSON-RPC │         │  import …       │
        └───────┬────────┘         └────────┬────────┘         └────────┬────────┘
                │                           │                           │
                └───────────────┬───────────┴───────────┬───────────────┘
                                │                       │
                       ┌────────▼────────┐     ┌────────▼────────┐
                       │  SecurityTool   │     │ TargetValidator │
                       │   (base class)  │◄────┤   + scope       │
                       └────────┬────────┘     └─────────────────┘
                                │
              ┌─────────────────┼─────────────────┬──────────────────┐
              │                 │                 │                  │
       ┌──────▼─────┐  ┌────────▼──────┐  ┌───────▼────────┐  ┌──────▼──────┐
       │  recon/    │  │   webapp/     │  │   password/    │  │  exploit/   │
       │  NmapTool  │  │  NiktoTool    │  │  HashcatTool   │  │ Metasploit  │
       │            │  │  SqlmapTool   │  │                │  │    Tool     │
       └──────┬─────┘  └────────┬──────┘  └───────┬────────┘  └──────┬──────┘
              │                 │                 │                  │
              └─────────────────┴────────┬────────┴──────────────────┘
                                         │
                                  ┌──────▼───────┐
                                  │   spawn()    │  ← arg-array only,
                                  │   nmap, …    │    no shell, no string
                                  └──────────────┘    interpolation
```

### Repository layout

```
openkalicode/
├── bin/                       # CLI entrypoints (okal, okcli, openkaliclaude)
├── container/                 # Dockerfile.kali + docker-compose.yml
├── docs/USAGE.md              # Long-form usage notes
├── src/
│   ├── cli/                   # Ink/React TUI (LandingPage, WelcomeScreen)
│   ├── mcp/security-server.ts # MCP stdio server (Model Context Protocol)
│   ├── scripts/               # install-security-tools, verify-installation
│   ├── tools/security/
│   │   ├── base/              # SecurityTool, TargetValidator, ReportGenerator
│   │   ├── recon/             # NmapTool
│   │   ├── webapp/            # NiktoTool, SqlmapTool
│   │   ├── password/          # HashcatTool
│   │   └── exploit/           # MetasploitTool
│   ├── types/security.ts      # Shared types: ScopeConstraint, Finding, Report…
│   └── Tool.ts                # BaseTool abstraction
├── install.sh
└── package.json
```

---

## 3. How it works

### 3.1 The CLI

`bin/okal` (and the aliases `okcli`, `openkaliclaude`) launches an [Ink](https://github.com/vadimdemedes/ink)-based React TUI. It walks you through selecting a tool category, configuring inputs, previewing the resolved command in **dry-run** mode, and confirming any operation flagged as destructive or high-risk.

The CLI is a *thin wrapper* — it ultimately calls the same `SecurityTool.call()` pipeline that the MCP server does, so behavior, validation, and audit logs are identical regardless of how a tool was launched.

### 3.2 The MCP server (`src/mcp/security-server.ts`)

OpenKaliClaude exposes every registered security tool to MCP-compatible clients (Claude Desktop, Claude Code, custom agents) over a stdio JSON-RPC transport.

- **Tool discovery** — `ListToolsRequestSchema` enumerates `securityTools`, converting each tool's Zod input schema into a JSON Schema via `zod-to-json-schema`. Legal warnings, category, and required permission level are injected into the description so the model sees them before calling.
- **Tool execution** — `CallToolRequestSchema` resolves the tool by name or alias, builds a `ToolUseContext` carrying the active `ScopeConstraint`, runs `tool.execute()`, and returns the parsed result alongside a generated report.
- **Default scope** — out of the box the server only allows `127.0.0.1/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, and `localhost`. Override via the `OKAL_SCOPE` env var (JSON-encoded `ScopeConstraint`).
- **Audit log** — controlled by `OKAL_AUDIT` (default on); every call and progress event is written to stderr as a single-line JSON record.

### 3.3 Security tools

Each tool extends `SecurityTool<Input, Output, Progress>` and supplies:

| Member | Purpose |
|---|---|
| `inputSchema` | Zod schema — first line of defense, runs before anything else |
| `config` | Category, permission level, destructiveness, legal warnings, version |
| `execute(input, onProgress)` | The actual `spawn()` call against the underlying binary |
| `generateReport(output)` | Parses raw tool output into a `SecurityReport` of `Finding`s |
| `calculateRiskScore(input)` | 1–10 score; >5 forces a confirmation prompt |
| `estimateImpact(input)` | Human-readable impact summary surfaced in the confirmation dialog |

`SecurityTool.call()` (the base class) sequences validation → scope check → permission check → audit → execute → report. None of the subclasses run a shell; every external invocation uses `spawn(binary, [...args])` with an *array* — there is no string interpolation into a shell anywhere in the codebase.

#### Currently shipped tools

| Tool | Category | Wraps | Permission level |
|---|---|---|---|
| **Nmap** | reconnaissance | `nmap` | active-recon |
| **Nikto** | webapp | `nikto` | web-scanning |
| **SQLMap** | webapp | `sqlmap` | exploitation |
| **Hashcat** | crypto | `hashcat` | brute-force |
| **Metasploit** | exploitation | `msfconsole` (stdin resource script) | exploitation |

---

## 4. Security model

OpenKaliClaude is *itself* an attack surface — it executes powerful binaries and exposes them to language models. The framework treats this seriously.

### 4.1 Scope enforcement (`TargetValidator`)

Every target string is checked against a `ScopeConstraint` before execution:

```ts
type ScopeConstraint = {
  allowedNetworks: string[]   // CIDRs
  allowedDomains: string[]    // exact or "*.example.com"
  excludedNetworks: string[]
  excludedDomains: string[]
  maxScope: string
  requireAuthorization: boolean
}
```

- **Excludes are evaluated first** — even if a target appears in `allowedNetworks`, an `excludedNetworks` entry kills it.
- **CIDR matching** uses unsigned 32-bit arithmetic. The `/0` mask correctly matches everything (a previous `-1 << 32` JavaScript shift bug was patched).
- **No allow-list?** Falls back to private/loopback ranges only — the framework refuses public targets unless you explicitly allow them.

### 4.2 Argument-injection guards

All five tool wrappers route user-supplied positional strings (`target`, `ports`, `hashFile`, `wordlist`, `outputFile`, `mask`, `scripts`, `plugins`, `cookie`, headers, …) through `TargetValidator.assertSafeArg()`, which rejects:

- Empty strings
- Values starting with `-` (would be parsed as a flag by the underlying binary)
- Values containing `\r`, `\n`, or `\0`

This prevents a malicious caller — including a confused or jailbroken model — from sneaking `--script=http-shellshock` into a `target` field and turning a benign port scan into something else.

### 4.3 Metasploit resource-script hardening

`MetasploitTool` builds a multi-line script and pipes it to `msfconsole -q -r -`. Every option key, option value, payload name, and module name is validated:

- Module names: `^[A-Za-z0-9_/\-.]+$`
- Option keys: `^[A-Za-z_][A-Za-z0-9_]*$`
- Option values: must not contain `\r`, `\n`, `\0`, or `;`

Without these checks a single newline in any value could inject arbitrary `msfconsole` commands.

### 4.4 Permissions & confirmation

Each tool returns a `PermissionResult` from `validatePermissions()`. The base class will set `requiresConfirmation: true` whenever `config.isDestructive` is set or `riskScore > 5`. The CLI honors this with an interactive prompt; the MCP server surfaces it through the model's tool-confirmation flow.

### 4.5 Audit log

When `auditLog` is on (the default), every tool execution logs a JSON record to stderr containing the timestamp, session ID, tool name, target, and action. In a hardened deployment you should redirect stderr to an append-only sink.

### 4.6 Legal

OpenKaliClaude is for **authorized** security testing only — penetration tests with written scope, CTFs, lab/research, and defensive use. Unauthorized scanning or exploitation is illegal in most jurisdictions. See `SECURITY.md` and the `legalWarnings` array on every tool's `config`.

---

## 5. Installation

### Prerequisites

- **Node.js ≥ 18**
- **Kali-Linux tools** in `$PATH` (or use the Docker image): `nmap`, `nikto`, `sqlmap`, `hashcat`, `msfconsole`
- Linux/macOS recommended; Windows works for the framework itself but most underlying tools assume a POSIX environment

### Option A — From source

```bash
git clone https://github.com/Everaldtah/openkalicode.git
cd openkalicode
npm install
npm run build
./bin/okal --help
```

### Option B — Helper installer

```bash
./install.sh                    # installs Node deps + builds
npm run install:tools           # installs the underlying security binaries
npm run verify:tools            # sanity-checks each binary
```

### Option C — Docker (recommended for isolation)

```bash
npm run docker:build
npm run docker:run
```

The container image (`container/Dockerfile.kali`) ships every supported binary preinstalled.

---

## 6. Usage examples

### CLI

```bash
# Interactive TUI
./bin/okal

# Non-interactive — quick nmap scan against the local network
./bin/okal nmap --target 192.168.1.0/24 --scanType quick

# Dry-run a comprehensive scan to see exactly what would run
./bin/okal nmap --target 10.0.0.5 --scanType comprehensive --dryRun

# Web vulnerability scan
./bin/okal nikto --target http://192.168.56.101 --port 8080
```

### MCP server (Claude Desktop / Claude Code)

Add to your MCP client config:

```json
{
  "mcpServers": {
    "openkaliclaude": {
      "command": "node",
      "args": ["/abs/path/to/openkalicode/dist/mcp/security-server.mjs"],
      "env": {
        "OKAL_SCOPE": "{\"allowedNetworks\":[\"10.10.0.0/16\"],\"allowedDomains\":[\"*.lab.internal\"],\"excludedNetworks\":[],\"excludedDomains\":[],\"maxScope\":\"cidr/16\",\"requireAuthorization\":true}",
        "OKAL_AUDIT": "true"
      }
    }
  }
}
```

The model will see one tool per registered scanner, with the input schema, category, and legal warnings inlined into the description.

### As a library

```ts
import { nmapTool } from '@openkaliclaude/core'

const result = await nmapTool.call(
  {
    target: '192.168.1.10',
    scanType: 'quick',
    serviceDetection: true
  },
  {
    sessionId: 'demo',
    scopeConstraint: {
      allowedNetworks: ['192.168.1.0/24'],
      allowedDomains: [],
      excludedNetworks: [],
      excludedDomains: [],
      maxScope: 'cidr/24',
      requireAuthorization: true
    },
    auditLog: true,
    dryRun: false,
    environment: 'production'
  },
  async () => ({ behavior: 'allow' }),  // canUseTool callback
  null
)

console.log(result.data.hosts)
console.log(result.metadata.executionTime, 'ms')
```

---

## 7. Development guide

### Build & run

```bash
npm install
npm run build         # tsc + chmod bin/*
npm run dev           # build + launch CLI
npm run dev:secure    # same, but OKAL_SECURE_MODE=1
npm run mcp:server    # launch the MCP stdio server
npm test              # vitest
npm run test:security # security-focused tests only
npm run lint
npm run format
```

### Adding a new security tool

1. **Create the tool file** under `src/tools/security/<category>/<Name>Tool.ts`.
2. **Define the input schema** with Zod. Be conservative — prefer `enum` over free-form string for anything that becomes a CLI flag.
3. **Extend `SecurityTool`** and implement:
   - `name`, `aliases`, `description`, `inputSchema`, `config`
   - `execute(input, onProgress)` — *must* use `spawn(binary, [...args])`, never `exec` or `shell: true`
   - `generateReport(output)`
   - `calculateRiskScore(input)`, `estimateImpact(input)`
4. **Apply the argument-injection guards** at the top of `buildArgs()`:
   ```ts
   import { TargetValidator } from '../base/TargetValidator.js'
   TargetValidator.assertSafeArg(input.target, 'target')
   ```
   Repeat for every user-supplied string that lands in a positional slot or as a flag value.
5. **Register the tool** by exporting it from the category's `index.ts` and from `src/tools/security/index.ts`.
6. **Write tests** under `tests/security/` covering:
   - Schema validation
   - Scope rejection (out-of-scope target → throws `UnauthorizedTargetError`)
   - Argument-injection rejection (`target: '--script=evil'` → throws)
   - Output parsing on a captured fixture
   - Report generation

### Coding conventions

- TypeScript strict mode, ES modules (`"type": "module"`).
- No `child_process.exec`. No `spawn(..., { shell: true })`. Ever.
- All user input crosses a Zod schema before reaching `execute()`.
- All positional CLI strings cross `assertSafeArg()` before reaching `spawn()`.
- Errors thrown from `execute()` are converted to `ToolResult { success: false, error }` by the base class — don't swallow them yourself.

### Reporting vulnerabilities

See `SECURITY.md`. If you find a way to make a tool execute outside its declared scope, bypass `assertSafeArg`, or inject into the Metasploit resource script, please report it privately before opening a public issue.

---

## License

MIT — see `LICENSE`.
