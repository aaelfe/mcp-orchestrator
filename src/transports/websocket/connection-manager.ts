import WebSocket from 'ws';
import { BaseTransport, MCPMessage, TransportConfig } from '../base/transport-interface';
import { JSONMessageAdapter } from '../base/message-adapter';

export interface WebSocketConfig extends TransportConfig {
  url: string;
  protocols?: string[];
  headers?: Record<string, string>;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
}

export class WebSocketTransport extends BaseTransport {
  private ws: WebSocket | null = null;
  private adapter = new JSONMessageAdapter();
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;

  constructor(private wsConfig: WebSocketConfig) {
    super(wsConfig);
  }

  async connect(): Promise<void> {
    if (this.ws) {
      throw new Error('WebSocket transport already connected');
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsConfig.url, this.wsConfig.protocols, {
          headers: this.wsConfig.headers
        });

        this.setupEventHandlers(resolve, reject);
        
        // Timeout for connection
        setTimeout(() => {
          if (!this.connected) {
            reject(new Error('WebSocket connection timeout'));
          }
        }, this.wsConfig.timeout || 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  private setupEventHandlers(resolve: Function, reject: Function): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      console.log('WebSocket connection established');
      this.startPing();
      resolve();
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      this.handleIncomingMessage(data.toString());
    });

    this.ws.on('error', (error: Error) => {
      console.error('WebSocket error:', error);
      this.connected = false;
      this.handleError(error);
      
      if (!this.connected) {
        reject(error);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`WebSocket closed: ${code} ${reason.toString()}`);
      this.connected = false;
      this.stopPing();
      this.handleClose();
      
      // Attempt reconnection for unexpected closures
      if (code !== 1000 && code !== 1001) {
        this.attemptReconnect();
      }
    });

    this.ws.on('pong', () => {
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
      }
    });
  }

  private handleIncomingMessage(data: string): void {
    try {
      const message = this.adapter.deserialize(data);
      this.handleMessage(message);
    } catch (error) {
      console.error('Failed to parse WebSocket message:', data, error);
      this.handleError(error instanceof Error ? error : new Error('Message parse error'));
    }
  }

  private startPing(): void {
    const interval = this.wsConfig.pingInterval || 30000;
    
    this.pingTimer = setInterval(() => {
      if (this.ws && this.connected) {
        this.ws.ping();
        
        // Set pong timeout
        this.pongTimer = setTimeout(() => {
          console.error('WebSocket pong timeout, closing connection');
          this.ws?.terminate();
        }, this.wsConfig.pongTimeout || 5000);
      }
    }, interval);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private attemptReconnect(): void {
    const maxAttempts = this.wsConfig.maxReconnectAttempts || 5;
    
    if (this.reconnectAttempts >= maxAttempts) {
      console.error('Max WebSocket reconnection attempts reached');
      this.handleError(new Error('Max reconnection attempts reached'));
      return;
    }

    const interval = this.wsConfig.reconnectInterval || 5000;
    
    console.log(`Attempting to reconnect WebSocket in ${interval}ms (attempt ${this.reconnectAttempts + 1}/${maxAttempts})`);
    
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      
      try {
        // Close existing connection
        if (this.ws) {
          this.ws.terminate();
          this.ws = null;
        }
        
        // Attempt to reconnect
        await this.connect();
      } catch (error) {
        console.error('WebSocket reconnection failed:', error);
        this.attemptReconnect();
      }
    }, interval);
  }

  async send<T>(message: MCPMessage<T>): Promise<void> {
    if (!this.ws || !this.connected) {
      throw new Error('WebSocket transport not connected');
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not in open state');
    }

    try {
      const serialized = this.adapter.serialize(message);
      this.ws.send(serialized);
      this.incrementSentMessages();
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error('Send failed'));
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  async close(): Promise<void> {
    // Clear timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.stopPing();

    // Close WebSocket
    if (this.ws) {
      this.ws.close(1000, 'Normal closure');
      this.ws = null;
    }

    this.connected = false;
  }
} 