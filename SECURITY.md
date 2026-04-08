# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| 1.0.x   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in OpenKaliClaude, please report it responsibly.

### How to Report

1. **Do NOT** open a public issue
2. Email security@openkaliclaude.com with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

3. Allow 48 hours for initial response
4. We will work with you to verify and fix the issue
5. Credit will be given in the security advisory (if desired)

### Response Timeline

- **48 hours**: Initial acknowledgment
- **7 days**: Assessment and fix plan
- **30 days**: Fix released (depending on severity)

## Security Best Practices

### When Using OpenKaliClaude

1. **Always obtain written authorization** before testing any system
2. **Define clear scope** using the scope configuration
3. **Enable audit logging** for compliance
4. **Use dry-run mode** first to verify commands
5. **Review results** before taking action

### Scope Configuration

Always configure your authorized scope:

```json
{
  "allowedNetworks": ["192.168.1.0/24"],
  "allowedDomains": ["test.example.com"],
  "excludedNetworks": ["192.168.1.1/32"],
  "requireAuthorization": true
}
```

### Permission Levels

Understand the permission levels:

| Level | Risk | Requires Confirmation |
|-------|------|----------------------|
| passive-recon | Low | No |
| active-recon | Medium | No |
| vuln-scanning | Medium | Yes |
| web-scanning | Medium | Yes |
| brute-force | High | Yes |
| exploitation | Critical | Yes |

## Legal Compliance

### Responsible Disclosure

If you find vulnerabilities in:

1. **OpenKaliClaude itself**: Report to us privately
2. **Third-party systems**: Follow responsible disclosure practices
3. **Open source tools**: Report to respective maintainers

### Legal Considerations

- Unauthorized access is illegal in most jurisdictions
- Always have explicit written permission
- Document your authorization
- Respect rate limits and scope boundaries

## Security Features

### Built-in Protections

1. **Scope Validation**: Prevents scanning unauthorized targets
2. **Permission System**: Requires confirmation for high-risk operations
3. **Audit Logging**: Records all actions for compliance
4. **Dry-Run Mode**: Preview commands before execution
5. **Rate Limiting**: Prevents overwhelming targets

### Security Checklist

Before running any scan:

- [ ] I have written authorization
- [ ] Scope is properly configured
- [ ] Target is within authorized scope
- [ ] Audit logging is enabled
- [ ] I understand the tools being used
- [ ] I have a plan for handling findings

## CVE Policy

We follow responsible disclosure for CVEs:

1. Private notification to affected parties
2. 90-day disclosure timeline
3. Coordinated public disclosure
4. Credit to researchers (with permission)

## Contact

- Security Team: security@openkaliclaude.com
- GPG Key: [Download](https://openkaliclaude.com/security.gpg)
- Incident Response: incident@openkaliclaude.com
