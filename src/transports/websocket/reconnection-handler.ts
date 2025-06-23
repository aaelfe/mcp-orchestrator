export interface ReconnectionConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
  jitter: boolean;
  onReconnect?: () => void;
  onReconnectFailed?: (error: Error) => void;
  onMaxAttemptsReached?: () => void;
}

export class ReconnectionHandler {
  private attempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnecting = false;

  constructor(private config: ReconnectionConfig) {}

  async attemptReconnection(reconnectFn: () => Promise<void>): Promise<void> {
    if (this.isReconnecting) {
      return;
    }

    if (this.attempts >= this.config.maxAttempts) {
      console.error(`Max reconnection attempts (${this.config.maxAttempts}) reached`);
      this.config.onMaxAttemptsReached?.();
      return;
    }

    this.isReconnecting = true;
    this.attempts++;

    const delay = this.calculateDelay();
    console.log(`Attempting reconnection ${this.attempts}/${this.config.maxAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await reconnectFn();
        this.onSuccessfulReconnect();
      } catch (error) {
        console.error(`Reconnection attempt ${this.attempts} failed:`, error);
        this.config.onReconnectFailed?.(error instanceof Error ? error : new Error('Reconnection failed'));
        this.isReconnecting = false;
        
        // Schedule next attempt
        this.attemptReconnection(reconnectFn);
      }
    }, delay);
  }

  private calculateDelay(): number {
    // Exponential backoff: delay = initialDelay * (backoffFactor ^ (attempts - 1))
    let delay = this.config.initialDelay * Math.pow(this.config.backoffFactor, this.attempts - 1);
    
    // Cap at max delay
    delay = Math.min(delay, this.config.maxDelay);
    
    // Add jitter if enabled
    if (this.config.jitter) {
      // Add random jitter up to 25% of the delay
      const jitterRange = delay * 0.25;
      delay += Math.random() * jitterRange;
    }
    
    return Math.floor(delay);
  }

  private onSuccessfulReconnect(): void {
    console.log(`Successfully reconnected after ${this.attempts} attempts`);
    this.reset();
    this.config.onReconnect?.();
  }

  reset(): void {
    this.attempts = 0;
    this.isReconnecting = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  stop(): void {
    this.reset();
  }

  getAttempts(): number {
    return this.attempts;
  }

  isAttempting(): boolean {
    return this.isReconnecting;
  }
}

// Utility function to create common reconnection configurations
export const createReconnectionConfig = {
  // Fast reconnection for development
  fast: (): ReconnectionConfig => ({
    maxAttempts: 10,
    initialDelay: 1000,
    maxDelay: 5000,
    backoffFactor: 1.5,
    jitter: true
  }),

  // Aggressive reconnection for critical connections
  aggressive: (): ReconnectionConfig => ({
    maxAttempts: 20,
    initialDelay: 500,
    maxDelay: 10000,
    backoffFactor: 2,
    jitter: true
  }),

  // Conservative reconnection for production
  conservative: (): ReconnectionConfig => ({
    maxAttempts: 5,
    initialDelay: 2000,
    maxDelay: 30000,
    backoffFactor: 2,
    jitter: true
  }),

  // Custom configuration builder
  custom: (config: Partial<ReconnectionConfig>): ReconnectionConfig => ({
    maxAttempts: 5,
    initialDelay: 2000,
    maxDelay: 30000,
    backoffFactor: 2,
    jitter: true,
    ...config
  })
}; 