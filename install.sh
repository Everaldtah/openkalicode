#!/bin/bash
#
# OpenKaliClaude Installation Script
# One-line installer for OpenKaliClaude
#
# Usage: curl -fsSL https://openkaliclaude.com/install.sh | bash
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO="openkaliclaude/core"
INSTALL_DIR="/usr/local/bin"
OKAL_HOME="$HOME/.okal"

# Functions
print_banner() {
    echo -e "${BLUE}"
    cat << "EOF"
 ██████  ██████  ███████ ███    ██ ██   ██  █████  ██      ██      
██    ██ ██   ██ ██      ████   ██ ██  ██  ██   ██ ██      ██      
██    ██ ██████  █████   ██ ██  ██ █████   ███████ ██      ██      
██    ██ ██   ██ ██      ██  ██ ██ ██  ██  ██   ██ ██      ██      
 ██████  ██   ██ ███████ ██   ████ ██   ██ ██   ██ ███████ ███████ 
                                                                    
    ██████  ██╗      █████╗ ██╗   ██╗██████╗ ███████╗              
    ██╔══██╗██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝              
    ██████╔╝██║     ███████║██║   ██║██║  ██║█████╗                
    ██╔══██╗██║     ██╔══██║██║   ██║██║  ██║██╔══╝                
    ██║  ██║███████╗██║  ██║╚██████╔╝██████╔╝███████╗              
    ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝              
EOF
    echo -e "${NC}"
    echo -e "${GREEN}AI-Powered Cybersecurity CLI Framework${NC}"
    echo ""
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check OS
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    else
        print_error "Unsupported operating system: $OSTYPE"
        exit 1
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        print_info "Please install Node.js 18+ from https://nodejs.org/"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js version 18+ required (found $(node -v))"
        exit 1
    fi
    
    print_success "Node.js $(node -v) found"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    print_success "npm $(npm -v) found"
}

install_with_npm() {
    print_info "Installing OpenKaliClaude via npm..."
    
    if npm install -g @openkaliclaude/core; then
        print_success "OpenKaliClaude installed successfully"
    else
        print_error "Failed to install via npm"
        return 1
    fi
}

install_from_source() {
    print_info "Installing from source..."
    
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    
    print_info "Cloning repository..."
    if ! git clone --depth 1 "https://github.com/$REPO.git" openkaliclaude; then
        print_error "Failed to clone repository"
        rm -rf "$TEMP_DIR"
        return 1
    fi
    
    cd openkaliclaude
    
    print_info "Installing dependencies..."
    if ! npm install; then
        print_error "Failed to install dependencies"
        rm -rf "$TEMP_DIR"
        return 1
    fi
    
    print_info "Building..."
    if ! npm run build; then
        print_error "Failed to build"
        rm -rf "$TEMP_DIR"
        return 1
    fi
    
    print_info "Linking binary..."
    if ! npm link; then
        print_error "Failed to link binary"
        rm -rf "$TEMP_DIR"
        return 1
    fi
    
    cd "$HOME"
    rm -rf "$TEMP_DIR"
    
    print_success "OpenKaliClaude installed from source"
}

install_security_tools() {
    print_info "Installing security tools..."
    
    if command -v okal &> /dev/null; then
        print_info "Installing core security tools (this may take a while)..."
        okal install core || print_warning "Some tools failed to install"
    else
        print_warning "okal command not found, skipping tool installation"
    fi
}

setup_directories() {
    print_info "Setting up directories..."
    
    mkdir -p "$OKAL_HOME"
    mkdir -p "$OKAL_HOME/reports"
    mkdir -p "$OKAL_HOME/logs"
    mkdir -p "$OKAL_HOME/scopes"
    
    # Create default scope
    if [ ! -f "$OKAL_HOME/scopes/default.json" ]; then
        cat > "$OKAL_HOME/scopes/default.json" << 'EOF'
{
  "allowedNetworks": ["127.0.0.1/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  "allowedDomains": ["localhost"],
  "excludedNetworks": [],
  "excludedDomains": [],
  "maxScope": "cidr/24",
  "requireAuthorization": true
}
EOF
    fi
    
    print_success "Directories created at $OKAL_HOME"
}

verify_installation() {
    print_info "Verifying installation..."
    
    if command -v okal &> /dev/null; then
        print_success "okal command is available"
        okal --version 2>/dev/null || true
    else
        print_error "okal command not found in PATH"
        return 1
    fi
    
    # Verify tools
    if command -v okal &> /dev/null; then
        okal verify || print_warning "Some tools are missing"
    fi
}

print_next_steps() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  Installation Complete!                                      ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Next steps:"
    echo ""
    echo "  1. Start OpenKaliClaude:"
    echo "     okal"
    echo ""
    echo "  2. View available commands:"
    echo "     okal --help"
    echo ""
    echo "  3. Install additional security tools:"
    echo "     okal install all"
    echo ""
    echo "  4. Read the documentation:"
    echo "     https://docs.openkaliclaude.com"
    echo ""
    echo -e "${YELLOW}⚠ Remember: Only use OpenKaliClaude on systems you own or have${NC}"
    echo -e "${YELLOW}  explicit written permission to test!${NC}"
    echo ""
}

# Main installation flow
main() {
    print_banner
    
    print_info "OpenKaliClaude Installer"
    print_info "========================"
    echo ""
    
    # Check prerequisites
    check_prerequisites
    echo ""
    
    # Ask for installation method
    echo "Choose installation method:"
    echo "  1) npm (recommended - fastest)"
    echo "  2) From source (latest development version)"
    echo ""
    read -p "Enter choice [1-2]: " choice
    
    case $choice in
        1)
            install_with_npm
            ;;
        2)
            install_from_source
            ;;
        *)
            print_info "Defaulting to npm installation"
            install_with_npm
            ;;
    esac
    
    echo ""
    
    # Setup directories
    setup_directories
    
    echo ""
    
    # Ask about security tools
    read -p "Install security tools? (y/N): " install_tools
    if [[ $install_tools =~ ^[Yy]$ ]]; then
        install_security_tools
    fi
    
    echo ""
    
    # Verify installation
    verify_installation
    
    echo ""
    
    # Print next steps
    print_next_steps
}

# Run main function
main "$@"
