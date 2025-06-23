import { MCPMessage } from '../transports/base/transport-interface';

export interface RouteConfig {
  pattern: string | RegExp;
  destination: string;
  transformers?: MessageTransformer[];
  middleware?: RouteMiddleware[];
}

export interface MessageTransformer {
  name: string;
  transform<T>(message: MCPMessage<T>): MCPMessage<T> | Promise<MCPMessage<T>>;
}

export interface RouteMiddleware {
  name: string;
  execute<T>(message: MCPMessage<T>, next: () => Promise<void>): Promise<void>;
}

export interface RouteMatch {
  route: RouteConfig;
  params: Record<string, string>;
}

export class MessageRouter {
  private routes: RouteConfig[] = [];
  private globalMiddleware: RouteMiddleware[] = [];
  private destinations: Map<string, MessageHandler> = new Map();

  // Add a route configuration
  addRoute(config: RouteConfig): void {
    this.routes.push(config);
  }

  // Add multiple routes
  addRoutes(configs: RouteConfig[]): void {
    configs.forEach(config => this.addRoute(config));
  }

  // Register a destination handler
  registerDestination(name: string, handler: MessageHandler): void {
    this.destinations.set(name, handler);
  }

  // Add global middleware that runs for all routes
  addGlobalMiddleware(middleware: RouteMiddleware): void {
    this.globalMiddleware.push(middleware);
  }

  // Route a message to appropriate destination(s)
  async route<T>(message: MCPMessage<T>): Promise<void> {
    const matches = this.findMatches(message);
    
    if (matches.length === 0) {
      throw new Error(`No route found for message: ${message.method || 'unknown'}`);
    }

    // Process each matching route
    await Promise.all(
      matches.map(match => this.processRoute(message, match))
    );
  }

  private findMatches<T>(message: MCPMessage<T>): RouteMatch[] {
    const method = message.method || '';
    const matches: RouteMatch[] = [];

    for (const route of this.routes) {
      const match = this.matchRoute(method, route);
      if (match) {
        matches.push({ route, params: match });
      }
    }

    return matches;
  }

  private matchRoute(method: string, route: RouteConfig): Record<string, string> | null {
    if (typeof route.pattern === 'string') {
      // Simple string matching with parameter extraction
      return this.matchStringPattern(method, route.pattern);
    } else if (route.pattern instanceof RegExp) {
      // RegExp matching
      const match = method.match(route.pattern);
      return match ? this.extractNamedGroups(match) : null;
    }
    
    return null;
  }

  private matchStringPattern(method: string, pattern: string): Record<string, string> | null {
    // Convert pattern like "tools/{tool}/execute" to regex
    const regexPattern = pattern
      .replace(/\{([^}]+)\}/g, '(?<$1>[^/]+)')
      .replace(/\*/g, '.*');
    
    const regex = new RegExp(`^${regexPattern}$`);
    const match = method.match(regex);
    
    return match ? this.extractNamedGroups(match) : null;
  }

  private extractNamedGroups(match: RegExpMatchArray): Record<string, string> {
    return match.groups || {};
  }

  private async processRoute<T>(
    message: MCPMessage<T>, 
    match: RouteMatch
  ): Promise<void> {
    let processedMessage = message;

    try {
      // Apply route-specific transformers
      if (match.route.transformers) {
        for (const transformer of match.route.transformers) {
          processedMessage = await this.applyTransformer(processedMessage, transformer);
        }
      }

      // Build middleware chain
      const middleware = [...this.globalMiddleware, ...(match.route.middleware || [])];
      
      // Execute middleware chain
      await this.executeMiddlewareChain(processedMessage, middleware, async () => {
        await this.sendToDestination(processedMessage, match.route.destination);
      });

    } catch (error) {
      console.error(`Error processing route for ${message.method}:`, error);
      throw error;
    }
  }

  private async applyTransformer<T>(
    message: MCPMessage<T>, 
    transformer: MessageTransformer
  ): Promise<MCPMessage<T>> {
    try {
      return await transformer.transform(message);
    } catch (error) {
      console.error(`Transformer ${transformer.name} failed:`, error);
      throw error;
    }
  }

  private async executeMiddlewareChain<T>(
    message: MCPMessage<T>,
    middleware: RouteMiddleware[],
    finalHandler: () => Promise<void>
  ): Promise<void> {
    let index = 0;

    const next = async (): Promise<void> => {
      if (index >= middleware.length) {
        return finalHandler();
      }

      const currentMiddleware = middleware[index++];
      await currentMiddleware.execute(message, next);
    };

    await next();
  }

  private async sendToDestination<T>(
    message: MCPMessage<T>, 
    destinationName: string
  ): Promise<void> {
    const handler = this.destinations.get(destinationName);
    
    if (!handler) {
      throw new Error(`Destination '${destinationName}' not found`);
    }

    await handler.handle(message);
  }

  // Get routing statistics
  getStats(): RoutingStats {
    return {
      routeCount: this.routes.length,
      destinationCount: this.destinations.size,
      globalMiddlewareCount: this.globalMiddleware.length
    };
  }

  // Clear all routes and destinations
  clear(): void {
    this.routes = [];
    this.destinations.clear();
    this.globalMiddleware = [];
  }
}

export interface MessageHandler {
  handle<T>(message: MCPMessage<T>): Promise<void>;
}

export interface RoutingStats {
  routeCount: number;
  destinationCount: number;
  globalMiddlewareCount: number;
}

// Built-in transformers
export const builtInTransformers = {
  // Add correlation ID to messages
  addCorrelationId: (): MessageTransformer => ({
    name: 'addCorrelationId',
    transform<T>(message: MCPMessage<T>): MCPMessage<T> {
      return {
        ...message,
        id: message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
    }
  }),

  // Add timestamp to messages
  addTimestamp: (): MessageTransformer => ({
    name: 'addTimestamp',
    transform<T>(message: MCPMessage<T>): MCPMessage<T> {
      return {
        ...message,
        params: {
          ...message.params as any,
          _timestamp: new Date().toISOString()
        }
      };
    }
  }),

  // Log messages
  logger: (prefix = 'MCP'): MessageTransformer => ({
    name: 'logger',
    transform<T>(message: MCPMessage<T>): MCPMessage<T> {
      console.log(`[${prefix}] ${message.method || 'response'} - ID: ${message.id}`);
      return message;
    }
  })
};

// Built-in middleware
export const builtInMiddleware = {
  // Rate limiting middleware
  rateLimit: (maxRequests: number, windowMs: number): RouteMiddleware => {
    const requests = new Map<string, number[]>();
    
    return {
      name: 'rateLimit',
      async execute<T>(message: MCPMessage<T>, next: () => Promise<void>): Promise<void> {
        const key = `${message.method}_${message.id}`;
        const now = Date.now();
        const windowStart = now - windowMs;
        
        // Clean old requests
        const userRequests = requests.get(key) || [];
        const validRequests = userRequests.filter(time => time > windowStart);
        
        if (validRequests.length >= maxRequests) {
          throw new Error('Rate limit exceeded');
        }
        
        validRequests.push(now);
        requests.set(key, validRequests);
        
        await next();
      }
    };
  },

  // Authentication middleware
  auth: (validateFn: (message: MCPMessage<unknown>) => boolean): RouteMiddleware => ({
    name: 'auth',
    async execute<T>(message: MCPMessage<T>, next: () => Promise<void>): Promise<void> {
      if (!validateFn(message)) {
        throw new Error('Authentication failed');
      }
      await next();
    }
  }),

  // Metrics collection middleware
  metrics: (collector: (method: string, duration: number) => void): RouteMiddleware => ({
    name: 'metrics',
    async execute<T>(message: MCPMessage<T>, next: () => Promise<void>): Promise<void> {
      const start = Date.now();
      try {
        await next();
      } finally {
        const duration = Date.now() - start;
        collector(message.method || 'unknown', duration);
      }
    }
  })
}; 