import { ContainerManager, ContainerConfig } from './container-manager';
import { MCPMessage } from '../base/transport-interface';

export interface ProcessPoolConfig {
  maxInstances: number;
  minInstances: number;
  healthCheckInterval: number;
  restartOnFailure: boolean;
}

export class ProcessPool {
  private instances: Map<string, ContainerManager> = new Map();
  private activeInstances: Set<string> = new Set();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private roundRobinIndex = 0;

  constructor(
    private containerConfig: ContainerConfig,
    private poolConfig: ProcessPoolConfig
  ) {}

  async start(): Promise<void> {
    // Start minimum number of instances
    for (let i = 0; i < this.poolConfig.minInstances; i++) {
      await this.createInstance(`instance-${i}`);
    }

    // Start health check timer
    this.startHealthCheck();
  }

  private async createInstance(id: string): Promise<void> {
    const config = {
      ...this.containerConfig,
      name: `${this.containerConfig.name || 'mcp'}-${id}`
    };

    const container = new ContainerManager(config);
    
    // Setup error handling
    container.onError((error) => {
      console.error(`Container ${id} error:`, error);
      this.handleInstanceFailure(id);
    });

    container.onClose(() => {
      this.handleInstanceClose(id);
    });

    try {
      await container.start();
      this.instances.set(id, container);
      this.activeInstances.add(id);
      console.log(`Started container instance: ${id}`);
    } catch (error) {
      console.error(`Failed to start container ${id}:`, error);
      throw error;
    }
  }

  private async handleInstanceFailure(id: string): Promise<void> {
    console.log(`Handling failure for instance: ${id}`);
    
    // Remove from active instances
    this.activeInstances.delete(id);
    
    // Clean up the failed instance
    const instance = this.instances.get(id);
    if (instance) {
      await instance.close();
      this.instances.delete(id);
    }

    // Restart if configured to do so
    if (this.poolConfig.restartOnFailure) {
      try {
        await this.createInstance(id);
      } catch (error) {
        console.error(`Failed to restart instance ${id}:`, error);
      }
    }

    // Ensure we have minimum instances
    await this.ensureMinimumInstances();
  }

  private handleInstanceClose(id: string): void {
    console.log(`Instance closed: ${id}`);
    this.activeInstances.delete(id);
    this.instances.delete(id);
  }

  private async ensureMinimumInstances(): Promise<void> {
    const currentCount = this.activeInstances.size;
    const needed = this.poolConfig.minInstances - currentCount;

    for (let i = 0; i < needed; i++) {
      const newId = `instance-${Date.now()}-${i}`;
      try {
        await this.createInstance(newId);
      } catch (error) {
        console.error(`Failed to create replacement instance ${newId}:`, error);
      }
    }
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      const healthyInstances: string[] = [];
      
      for (const [id, instance] of this.instances) {
        if (instance.isConnected()) {
          healthyInstances.push(id);
        } else {
          console.log(`Instance ${id} is unhealthy, removing from pool`);
          this.activeInstances.delete(id);
          await instance.close();
          this.instances.delete(id);
        }
      }

      // Update active instances
      this.activeInstances.clear();
      healthyInstances.forEach(id => this.activeInstances.add(id));

      // Ensure minimum instances
      await this.ensureMinimumInstances();
      
    }, this.poolConfig.healthCheckInterval);
  }

  async send<T>(message: MCPMessage<T>): Promise<void> {
    const activeInstanceIds = Array.from(this.activeInstances);
    
    if (activeInstanceIds.length === 0) {
      throw new Error('No active instances available');
    }

    // Round-robin load balancing
    const instanceId = activeInstanceIds[this.roundRobinIndex % activeInstanceIds.length];
    this.roundRobinIndex++;

    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    try {
      await instance.send(message);
    } catch (error) {
      // If sending fails, try next available instance
      this.handleInstanceFailure(instanceId);
      
      // Retry with next instance if available
      if (activeInstanceIds.length > 1) {
        const nextInstanceId = activeInstanceIds[(this.roundRobinIndex) % activeInstanceIds.length];
        const nextInstance = this.instances.get(nextInstanceId);
        if (nextInstance) {
          await nextInstance.send(message);
        }
      } else {
        throw error;
      }
    }
  }

  onMessage<T>(handler: (message: MCPMessage<T>) => void): void {
    // Register handler for all instances
    for (const instance of this.instances.values()) {
      instance.onMessage(handler);
    }
  }

  onError(handler: (error: Error) => void): void {
    // Register error handler for all instances
    for (const instance of this.instances.values()) {
      instance.onError(handler);
    }
  }

  getActiveInstanceCount(): number {
    return this.activeInstances.size;
  }

  getTotalInstanceCount(): number {
    return this.instances.size;
  }

  getInstanceMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};
    
    for (const [id, instance] of this.instances) {
      metrics[id] = {
        connected: instance.isConnected(),
        metrics: instance.getMetrics()
      };
    }
    
    return metrics;
  }

  async close(): Promise<void> {
    // Stop health check
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Close all instances
    const closePromises = Array.from(this.instances.values()).map(instance => 
      instance.close()
    );
    
    await Promise.all(closePromises);
    
    this.instances.clear();
    this.activeInstances.clear();
  }
} 