export interface MCPMessage<T = unknown> {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: T;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface TransportConfig {
  timeout?: number;
  retries?: number;
  keepAlive?: boolean;
  [key: string]: unknown;
}

export interface TransportMetrics {
  messagesSent: number;
  messagesReceived: number;
  errors: number;
  connectionTime: number;
  lastActivity: Date;
}

export interface TransportHandler {
  /**
   * Send a message through this transport
   */
  send<T>(message: MCPMessage<T>): Promise<void>;
  
  /**
   * Register a message handler
   */
  onMessage<T>(handler: (message: MCPMessage<T>) => void): void;
  
  /**
   * Register an error handler
   */
  onError(handler: (error: Error) => void): void;
  
  /**
   * Register a close handler
   */
  onClose(handler: () => void): void;
  
  /**
   * Check if transport is connected
   */
  isConnected(): boolean;
  
  /**
   * Get transport metrics
   */
  getMetrics(): TransportMetrics;
  
  /**
   * Close the transport connection
   */
  close(): Promise<void>;
}

export abstract class BaseTransport implements TransportHandler {
  protected config: TransportConfig;
  protected metrics: TransportMetrics;
  protected messageHandlers: Array<(message: MCPMessage<unknown>) => void> = [];
  protected errorHandlers: Array<(error: Error) => void> = [];
  protected closeHandlers: Array<() => void> = [];

  constructor(config: TransportConfig = {}) {
    this.config = config;
    this.metrics = {
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      connectionTime: Date.now(),
      lastActivity: new Date()
    };
  }

  abstract send<T>(message: MCPMessage<T>): Promise<void>;
  abstract isConnected(): boolean;
  abstract close(): Promise<void>;

  onMessage<T>(handler: (message: MCPMessage<T>) => void): void {
    this.messageHandlers.push(handler as (message: MCPMessage<unknown>) => void);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  getMetrics(): TransportMetrics {
    return { ...this.metrics };
  }

  protected handleMessage<T>(message: MCPMessage<T>): void {
    this.metrics.messagesReceived++;
    this.metrics.lastActivity = new Date();
    this.messageHandlers.forEach(handler => handler(message));
  }

  protected handleError(error: Error): void {
    this.metrics.errors++;
    this.errorHandlers.forEach(handler => handler(error));
  }

  protected handleClose(): void {
    this.closeHandlers.forEach(handler => handler());
  }

  protected incrementSentMessages(): void {
    this.metrics.messagesSent++;
    this.metrics.lastActivity = new Date();
  }
} 