import { BaseTransport, MCPMessage, TransportConfig } from '../base/transport-interface';
import { JSONMessageAdapter } from '../base/message-adapter';
import { Response } from 'express';

export interface SSEConfig extends TransportConfig {
  url: string;
  headers?: Record<string, string>;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class SSETransport extends BaseTransport {
  private eventSource: EventSource | null = null;
  private adapter = new JSONMessageAdapter();
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private sseConfig: SSEConfig) {
    super(sseConfig);
  }

  async connect(): Promise<void> {
    if (this.eventSource) {
      throw new Error('SSE transport already connected');
    }

    return new Promise((resolve, reject) => {
      try {
        this.eventSource = new EventSource(this.sseConfig.url);
        
        // Setup event handlers
        this.eventSource.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          console.log('SSE connection established');
          resolve();
        };

        this.eventSource.onmessage = (event) => {
          this.handleIncomingMessage(event.data);
        };

        this.eventSource.onerror = (event) => {
          console.error('SSE connection error:', event);
          this.connected = false;
          
          if (this.eventSource?.readyState === EventSource.CLOSED) {
            this.handleClose();
            this.attemptReconnect();
          }
        };

        // Add custom event listeners for MCP
        this.eventSource.addEventListener('mcp-message', (event) => {
          this.handleIncomingMessage((event as MessageEvent).data);
        });

        this.eventSource.addEventListener('mcp-error', (event) => {
          const error = new Error((event as MessageEvent).data);
          this.handleError(error);
        });

        // Timeout for connection
        setTimeout(() => {
          if (!this.connected) {
            reject(new Error('SSE connection timeout'));
          }
        }, this.sseConfig.timeout || 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  private handleIncomingMessage(data: string): void {
    try {
      const message = this.adapter.deserialize(data);
      this.handleMessage(message);
    } catch (error) {
      console.error('Failed to parse SSE message:', data, error);
      this.handleError(error instanceof Error ? error : new Error('Message parse error'));
    }
  }

  private attemptReconnect(): void {
    const maxAttempts = this.sseConfig.maxReconnectAttempts || 5;
    
    if (this.reconnectAttempts >= maxAttempts) {
      console.error('Max reconnection attempts reached');
      this.handleError(new Error('Max reconnection attempts reached'));
      return;
    }

    const interval = this.sseConfig.reconnectInterval || 5000;
    
    console.log(`Attempting to reconnect SSE in ${interval}ms (attempt ${this.reconnectAttempts + 1}/${maxAttempts})`);
    
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      
      try {
        // Close existing connection
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
        
        // Attempt to reconnect
        await this.connect();
      } catch (error) {
        console.error('Reconnection failed:', error);
        this.attemptReconnect();
      }
    }, interval);
  }

  async send<T>(message: MCPMessage<T>): Promise<void> {
    if (!this.connected) {
      throw new Error('SSE transport not connected');
    }

    try {
      // For SSE, we need to send messages via HTTP POST to a companion endpoint
      const sendUrl = this.sseConfig.url.replace('/events', '/send');
      const serialized = this.adapter.serialize(message);
      
      const response = await fetch(sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.sseConfig.headers
        },
        body: serialized
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.status} ${response.statusText}`);
      }

      this.incrementSentMessages();
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error('Send failed'));
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connected && this.eventSource?.readyState === EventSource.OPEN;
  }

  async close(): Promise<void> {
    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close EventSource
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.connected = false;
    this.handleClose();
  }
}

// Server-side SSE handler for Express.js
export class SSEServer {
  private clients: Map<string, Response> = new Map();
  private adapter = new JSONMessageAdapter();

  addClient(clientId: string, res: Response): void {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection message
    this.sendToClient(clientId, { type: 'connected', data: 'SSE connection established' });
    
    this.clients.set(clientId, res);

    // Handle client disconnect
    res.on('close', () => {
      this.clients.delete(clientId);
      console.log(`SSE client disconnected: ${clientId}`);
    });
  }

  sendToClient(clientId: string, message: any): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    try {
      const data = typeof message === 'string' ? message : JSON.stringify(message);
      client.write(`data: ${data}\n\n`);
      return true;
    } catch (error) {
      console.error(`Failed to send to SSE client ${clientId}:`, error);
      this.removeClient(clientId);
      return false;
    }
  }

  sendMCPMessage<T>(clientId: string, message: MCPMessage<T>): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    try {
      const serialized = this.adapter.serialize(message);
      client.write(`event: mcp-message\n`);
      client.write(`data: ${serialized}\n\n`);
      return true;
    } catch (error) {
      console.error(`Failed to send MCP message to client ${clientId}:`, error);
      this.removeClient(clientId);
      return false;
    }
  }

  broadcast<T>(message: MCPMessage<T>): number {
    let successCount = 0;
    
    for (const clientId of this.clients.keys()) {
      if (this.sendMCPMessage(clientId, message)) {
        successCount++;
      }
    }
    
    return successCount;
  }

  removeClient(clientId: string): boolean {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.end();
      } catch (error) {
        console.error(`Error closing SSE client ${clientId}:`, error);
      }
      this.clients.delete(clientId);
      return true;
    }
    return false;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getClients(): string[] {
    return Array.from(this.clients.keys());
  }

  close(): void {
    for (const clientId of this.clients.keys()) {
      this.removeClient(clientId);
    }
  }
} 