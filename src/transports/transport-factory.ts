import { TransportHandler, TransportConfig } from './base/transport-interface';
import { ContainerManager, ContainerConfig } from './stdio/container-manager';
import { ProcessPool, ProcessPoolConfig } from './stdio/process-pool';
import { HTTPTransport, HTTPConfig } from './http/client';
import { SessionManager, SessionConfig } from './http/session-manager';
import { SSETransport, SSEConfig } from './sse/stream-handler';
import { WebSocketTransport, WebSocketConfig } from './websocket/connection-manager';

export type TransportType = 'stdio' | 'http' | 'sse' | 'websocket';

export interface BaseTransportFactoryConfig {
  type: TransportType;
  id: string;
  name?: string;
}

export interface StdioTransportFactoryConfig extends BaseTransportFactoryConfig {
  type: 'stdio';
  container: ContainerConfig;
  pool?: ProcessPoolConfig;
}

export interface HTTPTransportFactoryConfig extends BaseTransportFactoryConfig {
  type: 'http';
  client: HTTPConfig;
  session?: SessionConfig;
}

export interface SSETransportFactoryConfig extends BaseTransportFactoryConfig {
  type: 'sse';
  config: SSEConfig;
}

export interface WebSocketTransportFactoryConfig extends BaseTransportFactoryConfig {
  type: 'websocket';
  config: WebSocketConfig;
}

export type TransportFactoryConfig = 
  | StdioTransportFactoryConfig
  | HTTPTransportFactoryConfig 
  | SSETransportFactoryConfig
  | WebSocketTransportFactoryConfig;

export interface TransportInstance {
  id: string;
  type: TransportType;
  name: string;
  transport: TransportHandler;
  manager?: ProcessPool | SessionManager;
  created: Date;
  status: 'created' | 'connecting' | 'connected' | 'error' | 'closed';
}

export class TransportFactory {
  private instances: Map<string, TransportInstance> = new Map();
  private configs: Map<string, TransportFactoryConfig> = new Map();

  // Create a transport instance
  async create(config: TransportFactoryConfig): Promise<TransportInstance> {
    if (this.instances.has(config.id)) {
      throw new Error(`Transport with ID '${config.id}' already exists`);
    }

    const instance = await this.createTransportInstance(config);
    this.instances.set(config.id, instance);
    this.configs.set(config.id, config);

    return instance;
  }

  private async createTransportInstance(config: TransportFactoryConfig): Promise<TransportInstance> {
    let transport: TransportHandler;
    let manager: ProcessPool | SessionManager | undefined;

    switch (config.type) {
      case 'stdio':
        const stdioConfig = config as StdioTransportFactoryConfig;
        
        if (stdioConfig.pool) {
          // Create process pool
          manager = new ProcessPool(stdioConfig.container, stdioConfig.pool);
          await manager.start();
          
          // Create a wrapper transport that delegates to the pool
          transport = this.createPoolWrapperTransport(manager);
        } else {
          // Create single container
          transport = new ContainerManager(stdioConfig.container);
          await (transport as ContainerManager).start();
        }
        break;

      case 'http':
        const httpConfig = config as HTTPTransportFactoryConfig;
        
        if (httpConfig.session) {
          // Create session manager
          manager = new SessionManager(httpConfig.client, httpConfig.session);
          
          // Create a wrapper transport that delegates to the session manager
          transport = this.createSessionWrapperTransport(manager);
        } else {
          // Create single HTTP client
          transport = new HTTPTransport(httpConfig.client);
          await (transport as HTTPTransport).connect();
        }
        break;

      case 'sse':
        const sseConfig = config as SSETransportFactoryConfig;
        transport = new SSETransport(sseConfig.config);
        await (transport as SSETransport).connect();
        break;

      case 'websocket':
        const wsConfig = config as WebSocketTransportFactoryConfig;
        transport = new WebSocketTransport(wsConfig.config);
        await (transport as WebSocketTransport).connect();
        break;

      default:
        throw new Error(`Unsupported transport type: ${(config as any).type}`);
    }

    const instance: TransportInstance = {
      id: config.id,
      type: config.type,
      name: config.name || config.id,
      transport,
      manager,
      created: new Date(),
      status: 'connected'
    };

    // Setup status monitoring
    this.setupStatusMonitoring(instance);

    return instance;
  }

  private createPoolWrapperTransport(pool: ProcessPool): TransportHandler {
    return {
      async send(message) {
        await pool.send(message);
      },
      
      onMessage(handler) {
        pool.onMessage(handler);
      },
      
      onError(handler) {
        pool.onError(handler);
      },
      
      onClose(handler) {
        // Pool doesn't have close handler, but we can monitor individual instances
      },
      
      isConnected() {
        return pool.getActiveInstanceCount() > 0;
      },
      
      getMetrics() {
        return {
          messagesSent: 0,
          messagesReceived: 0,
          errors: 0,
          connectionTime: Date.now(),
          lastActivity: new Date()
        };
      },
      
      async close() {
        await pool.close();
      }
    };
  }

  private createSessionWrapperTransport(sessionManager: SessionManager): TransportHandler {
    let defaultSessionId: string | null = null;

    return {
      async send(message) {
        // Create default session if needed
        if (!defaultSessionId) {
          defaultSessionId = await sessionManager.createSession();
        }
        await sessionManager.sendMessage(defaultSessionId, message);
      },
      
      onMessage(handler) {
        if (defaultSessionId) {
          sessionManager.onMessage(defaultSessionId, handler);
        }
      },
      
      onError(handler) {
        if (defaultSessionId) {
          sessionManager.onError(defaultSessionId, handler);
        }
      },
      
      onClose(handler) {
        // Session manager doesn't have close handler
      },
      
      isConnected() {
        return sessionManager.getSessionCount() > 0;
      },
      
      getMetrics() {
        return {
          messagesSent: 0,
          messagesReceived: 0,
          errors: 0,
          connectionTime: Date.now(),
          lastActivity: new Date()
        };
      },
      
      async close() {
        await sessionManager.close();
      }
    };
  }

  private setupStatusMonitoring(instance: TransportInstance): void {
    instance.transport.onError(() => {
      instance.status = 'error';
    });

    instance.transport.onClose(() => {
      instance.status = 'closed';
    });

    // Monitor connection status
    setInterval(() => {
      if (instance.status !== 'closed' && instance.status !== 'error') {
        instance.status = instance.transport.isConnected() ? 'connected' : 'connecting';
      }
    }, 5000);
  }

  // Get a transport instance
  get(id: string): TransportInstance | undefined {
    return this.instances.get(id);
  }

  // List all transport instances
  list(): TransportInstance[] {
    return Array.from(this.instances.values());
  }

  // Get instances by type
  getByType(type: TransportType): TransportInstance[] {
    return this.list().filter(instance => instance.type === type);
  }

  // Remove a transport instance
  async remove(id: string): Promise<boolean> {
    const instance = this.instances.get(id);
    if (!instance) {
      return false;
    }

    try {
      await instance.transport.close();
      if (instance.manager) {
        await instance.manager.close();
      }
    } catch (error) {
      console.error(`Error closing transport ${id}:`, error);
    }

    this.instances.delete(id);
    this.configs.delete(id);
    return true;
  }

  // Get transport configuration
  getConfig(id: string): TransportFactoryConfig | undefined {
    return this.configs.get(id);
  }

  // Update transport configuration (recreates the transport)
  async updateConfig(id: string, config: TransportFactoryConfig): Promise<TransportInstance> {
    await this.remove(id);
    return this.create(config);
  }

  // Get factory statistics
  getStats(): FactoryStats {
    const instances = this.list();
    const typeStats: Record<TransportType, number> = {
      stdio: 0,
      http: 0,
      sse: 0,
      websocket: 0
    };

    const statusStats: Record<string, number> = {
      created: 0,
      connecting: 0,
      connected: 0,
      error: 0,
      closed: 0
    };

    instances.forEach(instance => {
      typeStats[instance.type]++;
      statusStats[instance.status]++;
    });

    return {
      totalInstances: instances.length,
      typeStats,
      statusStats
    };
  }

  // Close all transports
  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.instances.keys()).map(id => 
      this.remove(id)
    );
    
    await Promise.all(closePromises);
  }
}

export interface FactoryStats {
  totalInstances: number;
  typeStats: Record<TransportType, number>;
  statusStats: Record<string, number>;
}

// Utility functions for creating common configurations
export const createTransportConfig = {
  stdio: (
    id: string,
    image: string,
    command: string[],
    options: Partial<ContainerConfig & { pool?: ProcessPoolConfig }> = {}
  ): StdioTransportFactoryConfig => ({
    type: 'stdio',
    id,
    name: options.name || id,
    container: {
      image,
      command,
      env: options.env,
      volumes: options.volumes,
      workingDir: options.workingDir,
      name: options.name,
      timeout: options.timeout,
      retries: options.retries,
      keepAlive: options.keepAlive
    },
    pool: options.pool
  }),

  http: (
    id: string,
    baseUrl: string,
    options: Partial<HTTPConfig & { session?: SessionConfig }> = {}
  ): HTTPTransportFactoryConfig => ({
    type: 'http',
    id,
    client: {
      baseUrl,
      headers: options.headers,
      timeout: options.timeout,
      retries: options.retries,
      keepAlive: options.keepAlive
    },
    session: options.session
  }),

  sse: (
    id: string,
    url: string,
    options: Partial<SSEConfig> = {}
  ): SSETransportFactoryConfig => ({
    type: 'sse',
    id,
    config: {
      url,
      headers: options.headers,
      reconnectInterval: options.reconnectInterval,
      maxReconnectAttempts: options.maxReconnectAttempts,
      timeout: options.timeout,
      retries: options.retries,
      keepAlive: options.keepAlive
    }
  }),

  websocket: (
    id: string,
    url: string,
    options: Partial<WebSocketConfig> = {}
  ): WebSocketTransportFactoryConfig => ({
    type: 'websocket',
    id,
    config: {
      url,
      protocols: options.protocols,
      headers: options.headers,
      reconnectInterval: options.reconnectInterval,
      maxReconnectAttempts: options.maxReconnectAttempts,
      pingInterval: options.pingInterval,
      pongTimeout: options.pongTimeout,
      timeout: options.timeout,
      retries: options.retries,
      keepAlive: options.keepAlive
    }
  })
}; 