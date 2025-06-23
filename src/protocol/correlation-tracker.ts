import { MCPMessage } from '../transports/base/transport-interface';

export interface PendingRequest<T = unknown> {
  id: string | number;
  method: string;
  timestamp: number;
  timeout: NodeJS.Timeout;
  resolve: (response: MCPMessage<T>) => void;
  reject: (error: Error) => void;
  retries: number;
  maxRetries: number;
}

export interface CorrelationConfig {
  defaultTimeout: number;
  maxRetries: number;
  cleanupInterval: number;
  enableMetrics: boolean;
}

export interface CorrelationMetrics {
  pendingRequests: number;
  completedRequests: number;
  timedOutRequests: number;
  erroredRequests: number;
  averageResponseTime: number;
  requestCounts: Record<string, number>;
}

export class CorrelationTracker {
  private pendingRequests: Map<string | number, PendingRequest<unknown>> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private metrics: CorrelationMetrics = {
    pendingRequests: 0,
    completedRequests: 0,
    timedOutRequests: 0,
    erroredRequests: 0,
    averageResponseTime: 0,
    requestCounts: {}
  };
  private responseTimes: number[] = [];

  constructor(private config: CorrelationConfig) {
    this.startCleanupTimer();
  }

  // Track a request and return a promise that resolves when response is received
  async trackRequest<T>(
    message: MCPMessage<T>,
    timeout?: number,
    maxRetries?: number
  ): Promise<MCPMessage<T>> {
    if (!message.id) {
      throw new Error('Message must have an ID for correlation tracking');
    }

    if (this.pendingRequests.has(message.id)) {
      throw new Error(`Request with ID ${message.id} is already being tracked`);
    }

    return new Promise<MCPMessage<T>>((resolve, reject) => {
      const requestTimeout = timeout || this.config.defaultTimeout;
      const requestMaxRetries = maxRetries || this.config.maxRetries;

      const pendingRequest: PendingRequest<T> = {
        id: message.id!,
        method: message.method || 'unknown',
        timestamp: Date.now(),
        timeout: setTimeout(() => {
          this.handleTimeout(message.id!);
        }, requestTimeout),
        resolve,
        reject,
        retries: 0,
        maxRetries: requestMaxRetries
      };

      this.pendingRequests.set(message.id!, pendingRequest as PendingRequest<unknown>);
      
      if (this.config.enableMetrics) {
        this.metrics.pendingRequests++;
        this.metrics.requestCounts[pendingRequest.method] = 
          (this.metrics.requestCounts[pendingRequest.method] || 0) + 1;
      }
    });
  }

  // Handle incoming response message
  handleResponse<T>(response: MCPMessage<T>): boolean {
    if (!response.id) {
      return false; // Can't correlate response without ID
    }

    const pendingRequest = this.pendingRequests.get(response.id);
    if (!pendingRequest) {
      return false; // No pending request found
    }

    // Clear timeout
    clearTimeout(pendingRequest.timeout);
    this.pendingRequests.delete(response.id);

    if (this.config.enableMetrics) {
      this.updateMetrics(pendingRequest, false);
    }

    // Check if response contains error
    if (response.error) {
      const error = new Error(response.error.message);
      (error as any).code = response.error.code;
      (error as any).data = response.error.data;
      pendingRequest.reject(error);
    } else {
      pendingRequest.resolve(response);
    }

    return true;
  }

  // Handle timeout for a request
  private handleTimeout(requestId: string | number): void {
    const pendingRequest = this.pendingRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

    this.pendingRequests.delete(requestId);

    if (this.config.enableMetrics) {
      this.metrics.timedOutRequests++;
      this.metrics.pendingRequests--;
    }

    const error = new Error(`Request ${requestId} timed out after ${this.config.defaultTimeout}ms`);
    (error as any).code = -32603; // JSON-RPC internal error
    pendingRequest.reject(error);
  }

  // Retry a failed request
  async retryRequest<T>(
    originalMessage: MCPMessage<T>,
    sendFn: (message: MCPMessage<T>) => Promise<void>
  ): Promise<MCPMessage<T>> {
    if (!originalMessage.id) {
      throw new Error('Cannot retry message without ID');
    }

    const pendingRequest = this.pendingRequests.get(originalMessage.id);
    if (!pendingRequest) {
      throw new Error(`No pending request found for ID ${originalMessage.id}`);
    }

    if (pendingRequest.retries >= pendingRequest.maxRetries) {
      this.pendingRequests.delete(originalMessage.id);
      clearTimeout(pendingRequest.timeout);
      
      const error = new Error(`Max retries (${pendingRequest.maxRetries}) exceeded for request ${originalMessage.id}`);
      pendingRequest.reject(error);
      throw error;
    }

    // Increment retry count
    pendingRequest.retries++;
    
    // Reset timeout
    clearTimeout(pendingRequest.timeout);
    pendingRequest.timeout = setTimeout(() => {
      this.handleTimeout(originalMessage.id!);
    }, this.config.defaultTimeout);

    // Update timestamp
    pendingRequest.timestamp = Date.now();

           try {
         await sendFn(originalMessage);
         return new Promise<MCPMessage<T>>((resolve, reject) => {
           pendingRequest.resolve = resolve as (response: MCPMessage<unknown>) => void;
           pendingRequest.reject = reject;
         });
       } catch (error) {
      // If send fails, remove from tracking and reject
      this.pendingRequests.delete(originalMessage.id);
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(error instanceof Error ? error : new Error('Retry failed'));
      throw error;
    }
  }

  // Cancel a pending request
  cancelRequest(requestId: string | number): boolean {
    const pendingRequest = this.pendingRequests.get(requestId);
    if (!pendingRequest) {
      return false;
    }

    clearTimeout(pendingRequest.timeout);
    this.pendingRequests.delete(requestId);

    if (this.config.enableMetrics) {
      this.metrics.pendingRequests--;
    }

    const error = new Error(`Request ${requestId} was cancelled`);
    (error as any).code = -32800; // Custom cancellation code
    pendingRequest.reject(error);

    return true;
  }

  // Cancel all pending requests
  cancelAllRequests(): number {
    const count = this.pendingRequests.size;
    
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      const error = new Error('All requests cancelled');
      (error as any).code = -32800;
      request.reject(error);
    }

    this.pendingRequests.clear();
    
    if (this.config.enableMetrics) {
      this.metrics.pendingRequests = 0;
    }

    return count;
  }

  // Get pending request info
  getPendingRequest(requestId: string | number): PendingRequest | undefined {
    return this.pendingRequests.get(requestId);
  }

  // Get all pending request IDs
  getPendingRequestIds(): (string | number)[] {
    return Array.from(this.pendingRequests.keys());
  }

  // Get pending requests count
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  private updateMetrics(request: PendingRequest, isError: boolean): void {
    const responseTime = Date.now() - request.timestamp;
    
    this.metrics.pendingRequests--;
    
    if (isError) {
      this.metrics.erroredRequests++;
    } else {
      this.metrics.completedRequests++;
      this.responseTimes.push(responseTime);
      
      // Keep only last 1000 response times for average calculation
      if (this.responseTimes.length > 1000) {
        this.responseTimes = this.responseTimes.slice(-1000);
      }
      
      // Update average response time
      this.metrics.averageResponseTime = 
        this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length;
    }
  }

  // Start cleanup timer to remove stale requests
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleRequests();
    }, this.config.cleanupInterval);
  }

  private cleanupStaleRequests(): void {
    const now = Date.now();
    const staleRequests: (string | number)[] = [];

    for (const [id, request] of this.pendingRequests) {
      // Consider request stale if it's been pending for more than 2x the default timeout
      if (now - request.timestamp > this.config.defaultTimeout * 2) {
        staleRequests.push(id);
      }
    }

    // Cancel stale requests
    staleRequests.forEach(id => {
      console.warn(`Cleaning up stale request: ${id}`);
      this.cancelRequest(id);
    });

    if (staleRequests.length > 0) {
      console.log(`Cleaned up ${staleRequests.length} stale requests`);
    }
  }

  // Get current metrics
  getMetrics(): CorrelationMetrics {
    return { ...this.metrics };
  }

  // Reset metrics
  resetMetrics(): void {
    this.metrics = {
      pendingRequests: this.pendingRequests.size,
      completedRequests: 0,
      timedOutRequests: 0,
      erroredRequests: 0,
      averageResponseTime: 0,
      requestCounts: {}
    };
    this.responseTimes = [];
  }

  // Shutdown the tracker
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Cancel all pending requests
    this.cancelAllRequests();
  }
} 