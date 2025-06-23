import { TransportFactory, createTransportConfig } from './transports/transport-factory';
import { MessageRouter, builtInMiddleware, builtInTransformers } from './protocol/message-router';
import { CorrelationTracker } from './protocol/correlation-tracker';
import { MessageTranslator, createCommonTranslator } from './protocol/translator';
import { MCPMessage } from './transports/base/transport-interface';

// Example demonstrating the complete transport layer usage
async function demonstrateTransportLayer() {
  console.log('🚀 Starting MCP Transport Layer Demonstration');

  // 1. Create Transport Factory
  const factory = new TransportFactory();

  // 2. Create different transport configurations
  const configs = [
    // STDIO transport for filesystem MCP server
    createTransportConfig.stdio(
      'filesystem-mcp',
      'node:20-alpine',
      ['npx', '@modelcontextprotocol/server-filesystem', '/workspace'],
      {
        env: { NODE_ENV: 'production' },
        volumes: ['${HOME}:/workspace:ro'],
        pool: {
          maxInstances: 3,
          minInstances: 1,
          healthCheckInterval: 30000,
          restartOnFailure: true
        }
      }
    ),

    // HTTP transport for remote MCP server
    createTransportConfig.http(
      'remote-mcp',
      'https://api.example.com',
      {
        headers: { 'Authorization': 'Bearer token123' },
        timeout: 10000,
        session: {
          maxSessions: 50,
          sessionTimeout: 300000,
          cleanupInterval: 60000
        }
      }
    ),

    // WebSocket transport for real-time MCP server
    createTransportConfig.websocket(
      'realtime-mcp',
      'wss://realtime.example.com/mcp',
      {
        protocols: ['mcp-v1'],
        reconnectInterval: 5000,
        maxReconnectAttempts: 10,
        pingInterval: 30000
      }
    ),

    // SSE transport for streaming MCP server
    createTransportConfig.sse(
      'streaming-mcp',
      'https://stream.example.com/events',
      {
        reconnectInterval: 3000,
        maxReconnectAttempts: 5
      }
    )
  ];

  // 3. Create transport instances
  const transports = [];
  for (const config of configs) {
    try {
      console.log(`Creating transport: ${config.id}`);
      const transport = await factory.create(config);
      transports.push(transport);
      console.log(`✅ Created ${config.type} transport: ${transport.name}`);
    } catch (error) {
      console.error(`❌ Failed to create transport ${config.id}:`, error);
    }
  }

  // 4. Setup Message Router
  const router = new MessageRouter();

  // Add global middleware
  router.addGlobalMiddleware(builtInMiddleware.metrics((method, duration) => {
    console.log(`📊 Method ${method} took ${duration}ms`);
  }));

  router.addGlobalMiddleware(builtInMiddleware.rateLimit(100, 60000)); // 100 requests per minute

  // Add routes
  router.addRoute({
    pattern: 'tools/*',
    destination: 'filesystem-mcp',
    transformers: [builtInTransformers.addCorrelationId()],
    middleware: [builtInMiddleware.auth((msg) => Boolean(msg.id))]
  });

  router.addRoute({
    pattern: 'resources/*',
    destination: 'remote-mcp',
    transformers: [builtInTransformers.logger('RESOURCES')]
  });

  router.addRoute({
    pattern: 'notifications/*',
    destination: 'realtime-mcp'
  });

  router.addRoute({
    pattern: 'streaming/*',
    destination: 'streaming-mcp'
  });

  // Register destinations
  for (const transport of transports) {
    router.registerDestination(transport.id, {
      async handle(message) {
        await transport.transport.send(message);
        console.log(`📤 Sent message to ${transport.name}: ${message.method}`);
      }
    });
  }

  // 5. Setup Correlation Tracker
  const correlationTracker = new CorrelationTracker({
    defaultTimeout: 30000,
    maxRetries: 3,
    cleanupInterval: 60000,
    enableMetrics: true
  });

  // 6. Setup Message Translator
  const translator = createCommonTranslator('websocket');

  // 7. Example message processing flow
  async function processMessage(message: MCPMessage) {
    try {
      console.log(`🔄 Processing message: ${message.method}`);

      // Step 1: Translate message
      const translatedMessage = await translator.translate(message);
      console.log('✅ Message translated');

      // Step 2: Track request if it has an ID
      let responsePromise: Promise<MCPMessage> | null = null;
      if (translatedMessage.id) {
        responsePromise = correlationTracker.trackRequest(translatedMessage);
        console.log(`🔍 Tracking request: ${translatedMessage.id}`);
      }

      // Step 3: Route message
      await router.route(translatedMessage);
      console.log('✅ Message routed');

      // Step 4: Wait for response if tracking
      if (responsePromise) {
        try {
          const response = await responsePromise;
          console.log(`📥 Received response for ${translatedMessage.id}`);
          return response;
        } catch (error) {
          console.error(`❌ Request ${translatedMessage.id} failed:`, error);
          throw error;
        }
      }

    } catch (error) {
      console.error('❌ Message processing failed:', error);
      throw error;
    }
  }

  // 8. Simulate incoming messages
  const testMessages: MCPMessage[] = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/read',
      params: { uri: 'file:///example.txt' }
    },
    {
      jsonrpc: '2.0',
      method: 'notifications/log',
      params: { level: 'info', message: 'Test notification' }
    },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'streaming/data',
      params: { channel: 'updates' }
    }
  ];

  console.log('\n📨 Processing test messages...');
  for (const message of testMessages) {
    try {
      await processMessage(message);
      console.log(`✅ Successfully processed: ${message.method}\n`);
    } catch (error) {
      console.error(`❌ Failed to process ${message.method}:`, error, '\n');
    }
  }

  // 9. Setup response handling
  for (const transport of transports) {
    transport.transport.onMessage((response) => {
      console.log(`📥 Received response from ${transport.name}`);
      correlationTracker.handleResponse(response);
    });

    transport.transport.onError((error) => {
      console.error(`❌ Transport ${transport.name} error:`, error);
    });

    transport.transport.onClose(() => {
      console.log(`🔌 Transport ${transport.name} closed`);
    });
  }

  // 10. Display statistics
  console.log('\n📊 System Statistics:');
  console.log('Factory Stats:', factory.getStats());
  console.log('Router Stats:', router.getStats());
  console.log('Correlation Stats:', correlationTracker.getMetrics());

  // 11. Cleanup function
  const cleanup = async () => {
    console.log('\n🧹 Cleaning up...');
    
    // Cancel pending requests
    const cancelledCount = correlationTracker.cancelAllRequests();
    console.log(`Cancelled ${cancelledCount} pending requests`);
    
    // Shutdown correlation tracker
    correlationTracker.shutdown();
    
    // Close all transports
    await factory.closeAll();
    
    // Clear router
    router.clear();
    
    console.log('✅ Cleanup completed');
  };

  // Handle process termination
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await cleanup();
    process.exit(0);
  });

  console.log('\n🎉 Transport layer demonstration setup complete!');
  console.log('Press Ctrl+C to shutdown gracefully');

  return { factory, router, correlationTracker, translator, cleanup };
}

// Example of advanced usage patterns
async function advancedUsageExamples() {
  console.log('\n🚀 Advanced Usage Examples');

  const factory = new TransportFactory();

  // 1. Dynamic transport creation based on configuration
  const dynamicConfig = {
    transports: [
      {
        type: 'stdio' as const,
        id: 'dynamic-stdio',
        image: 'node:20-alpine',
        command: ['npx', '@modelcontextprotocol/server-filesystem', '/data'],
        pool: { maxInstances: 2, minInstances: 1, healthCheckInterval: 15000, restartOnFailure: true }
      },
      {
        type: 'websocket' as const,
        id: 'dynamic-ws',
        url: 'wss://dynamic.example.com/mcp',
        reconnectInterval: 3000
      }
    ]
  };

  for (const config of dynamicConfig.transports) {
    try {
      let transportConfig;
      
      if (config.type === 'stdio') {
        transportConfig = createTransportConfig.stdio(
          config.id,
          config.image,
          config.command,
          { pool: config.pool }
        );
      } else if (config.type === 'websocket') {
        transportConfig = createTransportConfig.websocket(
          config.id,
          config.url,
          { reconnectInterval: config.reconnectInterval }
        );
      }
      
      if (transportConfig) {
        const transport = await factory.create(transportConfig);
        console.log(`✅ Created dynamic transport: ${transport.name}`);
      }
    } catch (error) {
      console.error(`❌ Failed to create dynamic transport ${config.id}:`, error);
    }
  }

  // 2. Transport failover example
  const primaryTransport = factory.get('dynamic-stdio');
  const fallbackTransport = factory.get('dynamic-ws');

  const sendWithFailover = async (message: MCPMessage) => {
    try {
      if (primaryTransport?.transport.isConnected()) {
        await primaryTransport.transport.send(message);
        console.log('✅ Sent via primary transport');
      } else if (fallbackTransport?.transport.isConnected()) {
        await fallbackTransport.transport.send(message);
        console.log('✅ Sent via fallback transport');
      } else {
        throw new Error('No transports available');
      }
    } catch (error) {
      console.error('❌ Failover send failed:', error);
      throw error;
    }
  };

  // 3. Load balancing across multiple transports
  const loadBalancer = {
    transports: [primaryTransport, fallbackTransport].filter(Boolean),
    currentIndex: 0,
    
    async send(message: MCPMessage) {
      const availableTransports = this.transports.filter(t => 
        t?.transport.isConnected()
      );
      
      if (availableTransports.length === 0) {
        throw new Error('No available transports for load balancing');
      }
      
      const transport = availableTransports[this.currentIndex % availableTransports.length];
      this.currentIndex++;
      
      await transport!.transport.send(message);
      console.log(`✅ Load balanced to: ${transport!.name}`);
    }
  };

  console.log('📊 Advanced examples setup complete');
  return { factory, sendWithFailover, loadBalancer };
}

// Run the demonstration
if (require.main === module) {
  demonstrateTransportLayer()
    .then(() => advancedUsageExamples())
    .catch(error => {
      console.error('❌ Demonstration failed:', error);
      process.exit(1);
    });
}

export { demonstrateTransportLayer, advancedUsageExamples }; 