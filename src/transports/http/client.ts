import { BaseTransport, MCPMessage, TransportConfig } from '../base/transport-interface';
import { JSONMessageAdapter } from '../base/message-adapter';

export interface HTTPConfig extends TransportConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
}

export class HTTPTransport extends BaseTransport {
  private adapter = new JSONMessageAdapter();
  private connected = false;

  constructor(private httpConfig: HTTPConfig) {
    super(httpConfig);
  }

  async connect(): Promise<void> {
    try {
      // Test connection with a health check
      await this.healthCheck();
      this.connected = true;
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error('Connection failed'));
      throw error;
    }
  }

  private async healthCheck(): Promise<void> {
    const response = await this.makeRequest('/health', 'GET');
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
  }

  async send<T>(message: MCPMessage<T>): Promise<void> {
    if (!this.connected) {
      throw new Error('HTTP transport not connected');
    }

    try {
      const serialized = this.adapter.serialize(message);
      const response = await this.makeRequest('/mcp', 'POST', serialized);
      
      if (!response.ok) {
        throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`);
      }

      // Handle response if it's a request (has id)
      if (message.id !== undefined) {
        const responseText = await response.text();
        if (responseText) {
          const responseMessage = this.adapter.deserialize(responseText);
          this.handleMessage(responseMessage);
        }
      }

      this.incrementSentMessages();
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error('Send failed'));
      throw error;
    }
  }

  private async makeRequest(
    path: string, 
    method: string, 
    body?: string
  ): Promise<Response> {
    const url = `${this.httpConfig.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...this.httpConfig.headers
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.httpConfig.timeout || 30000);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal
      });

      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async close(): Promise<void> {
    this.connected = false;
  }
} 