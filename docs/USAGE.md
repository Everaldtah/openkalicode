# OpenKaliClaude Usage Guide

## Table of Contents

1. [Getting Started](#getting-started)
2. [Command Reference](#command-reference)
3. [Tool Usage Examples](#tool-usage-examples)
4. [Scope Configuration](#scope-configuration)
5. [MCP Integration](#mcp-integration)
6. [Troubleshooting](#troubleshooting)

---

## Getting Started

### First Run

When you first start OpenKaliClaude, you'll see the welcome screen:

```bash
okal
```

This displays:
- ASCII art logo
- Security notes and warnings
- Legal disclaimer

Press **Enter** to continue to the main interface.

### Quick Commands

```bash
# Skip welcome screen
okal --skip-welcome

# Execute a command directly
okal scan 192.168.1.1 --type nmap

# List all available tools
okal tools

# Verify installation
okal verify

# Install security tools
okal install core
```

---

## Command Reference

### Global Options

| Option | Description |
|--------|-------------|
| `--version` | Show version information |
| `--help` | Show help message |
| `--skip-welcome` | Skip welcome screen |
| `--dry-run` | Show commands without executing |
| `--scope <file>` | Load scope from file |
| `--audit` | Enable audit logging |
| `--mcp-server` | Start MCP server mode |

### Main Commands

#### `okal scan`

Run a security scan on a target.

```bash
okal scan <target> [options]

Options:
  -t, --type <type>     Scan type (nmap, nikto, sqlmap, full)
  -p, --ports <ports>   Port range (e.g., "1-1000,8080")
  --dry-run            Show command without executing
```

Examples:
```bash
# Nmap scan
okal scan 192.168.1.1 --type nmap

# Web vulnerability scan
okal scan http://example.com --type nikto

# SQL injection test
okal scan "http://example.com/page.php?id=1" --type sqlmap

# Full assessment
okal scan 192.168.1.1 --type full
```

#### `okal tools`

List all available security tools.

```bash
okal tools [category]

Categories:
  recon       Reconnaissance tools
  webapp      Web application tools
  password    Password/cryptographic tools
  exploit     Exploitation tools
  wireless    Wireless tools
  osint       OSINT tools
  cloud       Cloud security tools
```

#### `okal install`

Install security tools.

```bash
okal install [tools...]

Options:
  core        Install core tools only
  all         Install all available tools
  cloud       Install cloud security tools
```

Examples:
```bash
# Install core tools
okal install core

# Install specific tools
okal install nmap nikto sqlmap

# Install all tools
okal install all
```

#### `okal verify`

Verify that all tools are installed correctly.

```bash
okal verify
```

#### `okal config`

Manage configuration.

```bash
okal config [options]

Options:
  --set-scope <file>   Set scope configuration
  --show               Show current configuration
```

---

## Tool Usage Examples

### Nmap

```bash
# Quick scan of top 100 ports
okal scan 192.168.1.1 --type nmap

# Full port scan
okal scan 192.168.1.1 --type nmap --ports "1-65535"

# Service detection
okal scan 192.168.1.1 --type nmap -p "80,443,8080"
```

### Nikto

```bash
# Basic web scan
okal scan http://example.com --type nikto

# SSL/HTTPS scan
okal scan https://example.com --type nikto --ssl
```

### SQLMap

```bash
# Test for SQL injection
okal scan "http://example.com/page.php?id=1" --type sqlmap

# Enumerate databases
okal scan "http://example.com/page.php?id=1" --type sqlmap --dbs
```

### Hashcat

```bash
# Crack MD5 hashes
okal hashcat -h hashes.txt -m 0

# Crack SHA256 with wordlist
okal hashcat -h hashes.txt -m 1400 -w /usr/share/wordlists/rockyou.txt
```

---

## Scope Configuration

### Creating a Scope File

Create a `.okal-scope.json` file:

```json
{
  "allowedNetworks": [
    "192.168.1.0/24",
    "10.0.0.0/8"
  ],
  "allowedDomains": [
    "*.example.com",
    "test.example.org"
  ],
  "excludedNetworks": [
    "192.168.1.1/32"
  ],
  "excludedDomains": [
    "prod.example.com"
  ],
  "maxScope": "cidr/24",
  "requireAuthorization": true
}
```

### Loading Scope

```bash
# Load from file
okal --scope .okal-scope.json

# Set via environment
export OKAL_SCOPE='{"allowedNetworks":["127.0.0.1/8"]}'
okal
```

### Scope Levels

| Level | Description |
|-------|-------------|
| `host` | Single host only |
| `cidr/24` | Class C network (256 hosts) |
| `cidr/16` | Class B network (65,536 hosts) |
| `domain` | Entire domain |
| `unlimited` | No restrictions (not recommended) |

---

## MCP Integration

### Starting MCP Server

```bash
okal --mcp-server
```

### Hermes Configuration

Add to your Hermes config:

```json
{
  "mcpServers": {
    "security": {
      "command": "okal",
      "args": ["--mcp-server"],
      "env": {
        "OKAL_SCOPE": "pentest-lab",
        "OKAL_AUDIT": "true"
      }
    }
  }
}
```

### Using from AI Agents

```typescript
// Example: Using from an AI agent
const result = await mcp.security.callTool('nmap_scan', {
  target: '192.168.1.1',
  scanType: 'quick'
})

console.log(result.data)
```

---

## Troubleshooting

### Common Issues

#### "Command not found"

```bash
# Make sure npm global bin is in PATH
export PATH="$PATH:$(npm bin -g)"

# Or reinstall
npm install -g @openkaliclaude/core
```

#### "Permission denied"

```bash
# Run with sudo for tool installation
sudo okal install core

# Or add user to appropriate groups
sudo usermod -aG docker $USER
```

#### "Tool not found"

```bash
# Verify installation
okal verify

# Install missing tools
okal install <tool-name>
```

### Debug Mode

```bash
# Enable debug logging
DEBUG=okal* okal

# Enable verbose output
okal --verbose
```

### Getting Help

```bash
# General help
okal --help

# Command-specific help
okal scan --help
okal install --help
```

---

## Best Practices

1. **Always define scope** before scanning
2. **Use dry-run mode** to preview commands
3. **Enable audit logging** for compliance
4. **Start with passive reconnaissance**
5. **Document your findings**
6. **Report vulnerabilities responsibly**

---

## Additional Resources

- [Full Documentation](https://docs.openkaliclaude.com)
- [API Reference](https://docs.openkaliclaude.com/api)
- [Security Policy](../SECURITY.md)
- [GitHub Issues](https://github.com/openkaliclaude/core/issues)
