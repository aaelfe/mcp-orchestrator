import { MCPMessage } from './transport-interface';

export interface MessageAdapter {
  serialize<T>(message: MCPMessage<T>): string | Buffer;
  deserialize<T = unknown>(data: string | Buffer): MCPMessage<T>;
  validate<T>(message: MCPMessage<T>): boolean;
}

export class JSONMessageAdapter implements MessageAdapter {
  serialize<T>(message: MCPMessage<T>): string {
    try {
      return JSON.stringify(message);
    } catch (error) {
      throw new Error(`Failed to serialize message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  deserialize<T = unknown>(data: string | Buffer): MCPMessage<T> {
    try {
      const str = data instanceof Buffer ? data.toString('utf8') : data;
      const parsed = JSON.parse(str as string);
      
      if (!this.validate(parsed)) {
        throw new Error('Invalid MCP message format');
      }
      
      return parsed as MCPMessage<T>;
    } catch (error) {
      throw new Error(`Failed to deserialize message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  validate<T>(message: MCPMessage<T>): boolean {
    // Basic MCP message validation
    if (typeof message !== 'object' || message === null) {
      return false;
    }

    // Must have jsonrpc version
    if (message.jsonrpc !== '2.0') {
      return false;
    }

    // Must be either a request, response, or notification
    const isRequest = typeof message.method === 'string' && message.id !== undefined;
    const isResponse = (message.result !== undefined || message.error !== undefined) && message.id !== undefined;
    const isNotification = typeof message.method === 'string' && message.id === undefined;

    return isRequest || isResponse || isNotification;
  }
}

export class BinaryMessageAdapter implements MessageAdapter {
  private jsonAdapter = new JSONMessageAdapter();
  
  serialize<T>(message: MCPMessage<T>): Buffer {
    const jsonString = this.jsonAdapter.serialize(message);
    return Buffer.from(jsonString, 'utf8');
  }

  deserialize<T = unknown>(data: string | Buffer): MCPMessage<T> {
    return this.jsonAdapter.deserialize<T>(data);
  }

  validate<T>(message: MCPMessage<T>): boolean {
    return this.jsonAdapter.validate(message);
  }
} 