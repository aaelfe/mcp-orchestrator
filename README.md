🚀 MCP Orchestrator
Easy self-hosting for Model Context Protocol (MCP) servers with secure remote access.
MCP Orchestrator lets you deploy and manage multiple MCP servers in one place, accessible remotely via Cloudflare tunnels. Perfect for developers who want to use MCP tools like filesystem access, GitHub integration, and more from anywhere.
✨ Features

🐳 Docker-based deployment - One command to get everything running
🔒 Secure remote access - Cloudflare tunnels with zero network configuration
🔧 Easy MCP management - Simple CLI to enable/disable services
📦 Pre-configured MCPs - Filesystem, GitHub, Slack, Notion, and more
🌐 Web terminal - Browser-based terminal access (optional)
💻 Client ready - Works with Cursor, Claude Desktop, and other MCP clients

🚀 Quick Start
Prerequisites

Docker and Docker Compose
Node.js and npm (for MCP server packages)
jq (JSON processor)
Cloudflare account (free tier works)
Domain name (or use Cloudflare's free subdomain)

1. Clone and Setup
bashgit clone https://github.com/yourusername/mcp-orchestrator.git
cd mcp-orchestrator

# Copy environment template
cp .env.example .env

# Make CLI executable
chmod +x scripts/mcp
2. Add MCP Servers
bash# Add some example servers
./scripts/mcp init

# Or add servers manually
./scripts/mcp add github npx @modelcontextprotocol/server-github
./scripts/mcp add filesystem npx @modelcontextprotocol/server-filesystem /workspace
3. Configure Cloudflare Tunnel
bash# Install cloudflared CLI
# macOS: brew install cloudflare/cloudflare/cloudflared
# Linux: see https://github.com/cloudflare/cloudflared

# Create tunnel
cloudflared tunnel create mcp-orchestrator

# Configure DNS (replace with your domain)
cloudflared tunnel route dns mcp-orchestrator mcp.yourdomain.com

# Get tunnel token from Cloudflare dashboard and add to .env:
# TUNNEL_TOKEN=your_tunnel_token_here
4. Start Your MCP Hub
bash./scripts/mcp start
Your MCP hub is now running at https://mcp.yourdomain.com!
🎮 Usage
Manage MCP Services
bash# List configured services
./scripts/mcp list

# Add MCP services
./scripts/mcp add github npx @modelcontextprotocol/server-github
./scripts/mcp add slack npx @modelcontextprotocol/server-slack
./scripts/mcp add postgres npx @modelcontextprotocol/server-postgres

# Apply changes
./scripts/mcp restart
Configure API Tokens
Add required tokens to your .env file:
bash# GitHub (get from https://github.com/settings/tokens)
GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# Slack (get from https://api.slack.com/apps)
SLACK_TOKEN=xoxb-xxxxxxxxxxxx

# Notion (get from https://www.notion.so/my-integrations)
NOTION_TOKEN=secret_xxxxxxxxxxxx
Monitor Services
bash# Check status
./scripts/mcp status

# View logs
./scripts/mcp logs

# View specific service logs
./scripts/mcp logs github-mcp
🔌 Client Integration
Cursor Configuration
Add to your .cursor/mcp.json:
json{
  "mcpServers": {
    "my-mcp-hub": {
      "transport": "sse",
      "url": "https://mcp.yourdomain.com/mcp/"
    }
  }
}
Claude Desktop Configuration
Add to your Claude Desktop config:
json{
  "mcpServers": {
    "my-mcp-hub": {
      "transport": "sse", 
      "url": "https://mcp.yourdomain.com/mcp/"
    }
  }
}
📦 MCP Server Configuration
MCP Orchestrator uses the same configuration format as Claude Desktop and Cursor. Edit mcp-config.json:
json{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/workspace"]
    },
    "github": {
      "command": "npx", 
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    },
    "postgres": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_CONNECTION_STRING": "postgresql://user:pass@host/db"
      }
    }
  }
}
Popular MCP Servers
Add these to your configuration:
bash# File system access
./scripts/mcp add filesystem npx @modelcontextprotocol/server-filesystem /workspace

# GitHub integration  
./scripts/mcp add github npx @modelcontextprotocol/server-github

# PostgreSQL database
./scripts/mcp add postgres npx @modelcontextprotocol/server-postgres

# Brave Search
./scripts/mcp add search npx @modelcontextprotocol/server-brave-search

# Slack integration
./scripts/mcp add slack npx @modelcontextprotocol/server-slack
🛠 CLI Commands
bash./scripts/mcp list                    # List configured MCP servers
./scripts/mcp add <n> <cmd> [args] # Add an MCP server
./scripts/mcp remove <n>           # Remove an MCP server  
./scripts/mcp config                  # Show current configuration
./scripts/mcp init                    # Add example servers
./scripts/mcp start                   # Start all services
./scripts/mcp stop                    # Stop all services  
./scripts/mcp restart                 # Restart all services
./scripts/mcp status                  # Show service status
./scripts/mcp logs [service]          # Show logs
./scripts/mcp setup-tunnel            # Tunnel setup help
🔧 Advanced Configuration
Adding Custom MCPs
You can add any MCP server that follows the standard protocol:
bash# Add using CLI
./scripts/mcp add my-server npx my-custom-mcp-package

# Or edit mcp-config.json directly
{
  "mcpServers": {
    "my-server": {
      "command": "python",
      "args": ["/path/to/my-mcp-server.py"],
      "env": {
        "API_KEY": "your_api_key"
      }
    }
  }
}
Local Development
For local testing without Cloudflare tunnel:
bash# Comment out tunnel service in docker-compose.yml
# Access directly at http://localhost
docker-compose up -d
🐛 Troubleshooting
Tunnel Issues
bash# Check tunnel status
./scripts/mcp logs tunnel

# Verify tunnel token
echo $TUNNEL_TOKEN

# Test local connectivity
curl http://localhost/health
MCP Connection Issues
bash# Check MCP server logs
./scripts/mcp logs filesystem-mcp

# Verify nginx routing
./scripts/mcp logs proxy

# Test MCP endpoint
curl https://mcp.yourdomain.com/mcp/
Environment Variables
bash# Check loaded environment
./scripts/mcp status

# Verify .env file
cat .env
🤝 Contributing

Fork the repository
Create a feature branch
Add your MCP server to mcp-registry.yml
Test the integration
Submit a pull request

📄 License
MIT License - see LICENSE file for details.
🔗 Links

Model Context Protocol
Cloudflare Tunnels
Docker Compose


Need help? Open an issue or join our community discussions!