# MCP Transport Layer

A comprehensive, type-safe transport layer implementation for the Model Context Protocol (MCP) supporting multiple transport types with advanced features like load balancing, failover, and message correlation.

## Features

🚀 **Multiple Transport Types**
- **STDIO**: Docker container-based MCP servers with process pooling
- **HTTP**: RESTful MCP communication with session management
- **WebSocket**: Real-time bidirectional communication with auto-reconnection
- **SSE**: Server-Sent Events for streaming data

🔧 **Advanced Protocol Features**
- Message routing with pattern matching
- Request-response correlation tracking
- Message transformation and validation
- Middleware support (rate limiting, auth, metrics)
- Automatic reconnection with exponential backoff

🏗️ **Production-Ready**
- Type-safe TypeScript implementation
- Comprehensive error handling
- Health monitoring and metrics
- Graceful shutdown handling
- Load balancing and failover

## Quick Start

### Installation

```bash
npm install ws express cors helmet
npm install --save-dev @types/node @types/ws @types/express @types/cors typescript ts-node
```

### Basic Usage

```typescript
import { 
  TransportFactory, 
  createTransportConfig,
  MessageRouter,
  CorrelationTracker 
} from './src';

// Create transport factory
const factory = new TransportFactory();

// Create a STDIO transport for filesystem MCP server
const transport = await factory.create(
  createTransportConfig.stdio(
    'filesystem-mcp',
    'node:20-alpine',
    ['npx', '@modelcontextprotocol/server-filesystem', '/workspace'],
    {
      env: { NODE_ENV: 'production' },
      volumes: ['${HOME}:/workspace:ro']
    }
  )
);

// Send a message
await transport.transport.send({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {}
});
```

## Transport Types

### STDIO Transport

For Docker container-based MCP servers with optional process pooling:

```typescript
// Single container
const stdioConfig = createTransportConfig.stdio(
  'my-mcp',
  'node:20-alpine',
  ['npx', '@modelcontextprotocol/server-filesystem', '/data'],
  {
    env: { NODE_ENV: 'production' },
    volumes: ['/host/data:/data:ro'],
    workingDir: '/app'
  }
);

// With process pool for load balancing
const pooledConfig = createTransportConfig.stdio(
  'pooled-mcp',
  'node:20-alpine',
  ['npx', '@modelcontextprotocol/server-github'],
  {
    env: { GITHUB_TOKEN: 'your-token' },
    pool: {
      maxInstances: 5,
      minInstances: 2,
      healthCheckInterval: 30000,
      restartOnFailure: true
    }
  }
);
```

### HTTP Transport

For RESTful MCP communication with session management:

```typescript
// Simple HTTP client
const httpConfig = createTransportConfig.http(
  'remote-mcp',
  'https://api.example.com/mcp',
  {
    headers: { 'Authorization': 'Bearer token123' },
    timeout: 10000
  }
);

// With session management
const sessionConfig = createTransportConfig.http(
  'session-mcp',
  'https://api.example.com/mcp',
  {
    session: {
      maxSessions: 50,
      sessionTimeout: 300000,
      cleanupInterval: 60000
    }
  }
);
```

### WebSocket Transport

For real-time bidirectional communication:

```typescript
const wsConfig = createTransportConfig.websocket(
  'realtime-mcp',
  'wss://realtime.example.com/mcp',
  {
    protocols: ['mcp-v1'],
    reconnectInterval: 5000,
    maxReconnectAttempts: 10,
    pingInterval: 30000,
    pongTimeout: 5000
  }
);
```

### SSE Transport

For server-sent events streaming:

```typescript
const sseConfig = createTransportConfig.sse(
  'streaming-mcp',
  'https://stream.example.com/events',
  {
    reconnectInterval: 3000,
    maxReconnectAttempts: 5,
    headers: { 'Authorization': 'Bearer token123' }
  }
);
```

## Message Routing

Set up intelligent message routing with pattern matching:

```typescript
const router = new MessageRouter();

// Add routes with patterns
router.addRoute({
  pattern: 'tools/*',           // Matches tools/list, tools/execute, etc.
  destination: 'filesystem-mcp',
  middleware: [authMiddleware],
  transformers: [addCorrelationId]
});

router.addRoute({
  pattern: 'resources/{type}/*', // Matches resources/file/read, etc.
  destination: 'remote-mcp',
  transformers: [logTransformer]
});

// Register destinations
router.registerDestination('filesystem-mcp', {
  async handle(message) {
    const transport = factory.get('filesystem-mcp');
    await transport.transport.send(message);
  }
});

// Route messages
await router.route({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {}
});
```

## Correlation Tracking

Track request-response pairs with automatic timeout handling:

```typescript
const correlationTracker = new CorrelationTracker({
  defaultTimeout: 30000,
  maxRetries: 3,
  cleanupInterval: 60000,
  enableMetrics: true
});

// Track a request
const responsePromise = correlationTracker.trackRequest({
  jsonrpc: '2.0',
  id: 'req-123',
  method: 'tools/execute',
  params: { name: 'my-tool' }
});

// Send the request through transport
await transport.send(message);

// Wait for response
try {
  const response = await responsePromise;
  console.log('Response received:', response);
} catch (error) {
  console.error('Request failed:', error);
}

// Handle incoming responses
transport.onMessage((response) => {
  correlationTracker.handleResponse(response);
});
```

## Message Translation

Transform messages between different formats:

```typescript
import { createCommonTranslator, builtInRules } from './src';

const translator = createCommonTranslator('websocket');

// Add custom rules
translator.addRule({
  name: 'addApiKey',
  condition: (message) => message.method?.startsWith('api/'),
  transform: (message) => ({
    ...message,
    params: {
      ...message.params,
      apiKey: process.env.API_KEY
    }
  })
});

// Translate message
const translatedMessage = await translator.translate(originalMessage);
```

## Middleware

Add cross-cutting concerns with middleware:

```typescript
import { builtInMiddleware } from './src';

// Rate limiting
router.addGlobalMiddleware(
  builtInMiddleware.rateLimit(100, 60000) // 100 requests per minute
);

// Authentication
router.addGlobalMiddleware(
  builtInMiddleware.auth((message) => {
    return message.params?.token === 'valid-token';
  })
);

// Metrics collection
router.addGlobalMiddleware(
  builtInMiddleware.metrics((method, duration) => {
    console.log(`${method} took ${duration}ms`);
  })
);

// Custom middleware
router.addGlobalMiddleware({
  name: 'logging',
  async execute(message, next) {
    console.log(`Processing: ${message.method}`);
    await next();
    console.log(`Completed: ${message.method}`);
  }
});
```

## Advanced Patterns

### Load Balancing

```typescript
const loadBalancer = {
  transports: [transport1, transport2, transport3],
  currentIndex: 0,
  
  async send(message) {
    const availableTransports = this.transports.filter(t => 
      t.transport.isConnected()
    );
    
    if (availableTransports.length === 0) {
      throw new Error('No available transports');
    }
    
    const transport = availableTransports[
      this.currentIndex % availableTransports.length
    ];
    this.currentIndex++;
    
    await transport.transport.send(message);
  }
};
```

### Failover

```typescript
async function sendWithFailover(message, primaryTransport, fallbackTransport) {
  try {
    if (primaryTransport.transport.isConnected()) {
      await primaryTransport.transport.send(message);
    } else if (fallbackTransport.transport.isConnected()) {
      await fallbackTransport.transport.send(message);
    } else {
      throw new Error('No transports available');
    }
  } catch (error) {
    console.error('Send failed:', error);
    throw error;
  }
}
```

### Health Monitoring

```typescript
// Monitor transport health
setInterval(() => {
  const stats = factory.getStats();
  console.log('Transport Stats:', stats);
  
  const correlationStats = correlationTracker.getMetrics();
  console.log('Correlation Stats:', correlationStats);
  
  // Check individual transport health
  for (const transport of factory.list()) {
    if (!transport.transport.isConnected()) {
      console.warn(`Transport ${transport.name} is disconnected`);
    }
  }
}, 30000);
```

## Configuration

### Environment Variables

```bash
# Docker configuration
DOCKER_HOST=unix:///var/run/docker.sock

# MCP Server tokens
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
SLACK_TOKEN=xoxb-xxxxxxxxxxxx
NOTION_TOKEN=secret_xxxxxxxxxxxx

# Transport configuration
DEFAULT_TIMEOUT=30000
MAX_RETRIES=3
POOL_SIZE=5
```

### Configuration File

```json
{
  "transports": {
    "filesystem": {
      "type": "stdio",
      "image": "node:20-alpine",
      "command": ["npx", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "env": {
        "NODE_ENV": "production"
      },
      "pool": {
        "maxInstances": 3,
        "minInstances": 1
      }
    },
    "github": {
      "type": "stdio",
      "image": "node:20-alpine",
      "command": ["npx", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

## Integration with MCP Orchestrator

The transport layer integrates seamlessly with your existing MCP Orchestrator:

```typescript
// Add to your Docker Compose setup
const mcpOrchestrator = {
  async start() {
    // Initialize transport factory
    const factory = new TransportFactory();
    
    // Create transports from your mcp-config.json
    const config = JSON.parse(fs.readFileSync('./mcp-config.json', 'utf8'));
    
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      const transport = await factory.create(
        createTransportConfig.stdio(
          name,
          'node:20-alpine',
          serverConfig.command,
          {
            env: serverConfig.env,
            volumes: ['${HOME}:/workspace:ro']
          }
        )
      );
      
      console.log(`Started MCP server: ${name}`);
    }
    
    return factory;
  }
};
```

## API Reference

### TransportFactory

The main factory for creating and managing transport instances.

```typescript
class TransportFactory {
  async create(config: TransportFactoryConfig): Promise<TransportInstance>
  get(id: string): TransportInstance | undefined
  list(): TransportInstance[]
  getByType(type: TransportType): TransportInstance[]
  async remove(id: string): Promise<boolean>
  getStats(): FactoryStats
  async closeAll(): Promise<void>
}
```

### Transport Interface

All transports implement the same interface:

```typescript
interface TransportHandler {
  send<T>(message: MCPMessage<T>): Promise<void>
  onMessage<T>(handler: (message: MCPMessage<T>) => void): void
  onError(handler: (error: Error) => void): void
  onClose(handler: () => void): void
  isConnected(): boolean
  getMetrics(): TransportMetrics
  close(): Promise<void>
}
```

## Examples

See `src/example.ts` for comprehensive examples demonstrating:
- Creating all transport types
- Setting up routing and middleware
- Implementing correlation tracking
- Message transformation
- Error handling and monitoring
- Load balancing and failover patterns

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure TypeScript compilation passes
5. Submit a pull request

## License

MIT License - see LICENSE file for details. 