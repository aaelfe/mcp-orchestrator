import { MCPMessage } from '../transports/base/transport-interface';

export interface TranslationRule<TFrom = unknown, TTo = unknown> {
  name: string;
  description?: string;
  condition: (message: MCPMessage<TFrom>) => boolean;
  transform: (message: MCPMessage<TFrom>) => MCPMessage<TTo> | Promise<MCPMessage<TTo>>;
}

export interface TranslatorConfig {
  enableValidation: boolean;
  throwOnValidationError: boolean;
  logTranslations: boolean;
}

export class MessageTranslator {
  private rules: TranslationRule[] = [];
  private config: TranslatorConfig;

  constructor(config: Partial<TranslatorConfig> = {}) {
    this.config = {
      enableValidation: true,
      throwOnValidationError: false,
      logTranslations: false,
      ...config
    };
  }

  // Add a translation rule
  addRule<TFrom = unknown, TTo = unknown>(rule: TranslationRule<TFrom, TTo>): void {
    this.rules.push(rule as TranslationRule);
  }

  // Add multiple rules
  addRules(rules: TranslationRule[]): void {
    rules.forEach(rule => this.addRule(rule));
  }

  // Remove a rule by name
  removeRule(name: string): boolean {
    const index = this.rules.findIndex(rule => rule.name === name);
    if (index >= 0) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  // Clear all rules
  clearRules(): void {
    this.rules = [];
  }

  // Translate a message using applicable rules
  async translate<TFrom = unknown, TTo = unknown>(
    message: MCPMessage<TFrom>
  ): Promise<MCPMessage<TTo>> {
    let result = message as MCPMessage<unknown>;

    // Find applicable rules
    const applicableRules = this.rules.filter(rule => rule.condition(result));

    if (applicableRules.length === 0) {
      // No transformation needed
      return result as MCPMessage<TTo>;
    }

    // Apply rules in order
    for (const rule of applicableRules) {
      try {
        if (this.config.logTranslations) {
          console.log(`Applying translation rule: ${rule.name}`);
        }

        result = await rule.transform(result);

        if (this.config.enableValidation && !this.isValidMCPMessage(result)) {
          const error = new Error(`Translation rule '${rule.name}' produced invalid message`);
          if (this.config.throwOnValidationError) {
            throw error;
          } else {
            console.error(error.message);
          }
        }
      } catch (error) {
        console.error(`Translation rule '${rule.name}' failed:`, error);
        throw error;
      }
    }

    return result as MCPMessage<TTo>;
  }

  // Check if a rule exists
  hasRule(name: string): boolean {
    return this.rules.some(rule => rule.name === name);
  }

  // Get all rule names
  getRuleNames(): string[] {
    return this.rules.map(rule => rule.name);
  }

  // Get rule count
  getRuleCount(): number {
    return this.rules.length;
  }

  // Basic MCP message validation
  private isValidMCPMessage(message: any): boolean {
    return (
      typeof message === 'object' &&
      message !== null &&
      message.jsonrpc === '2.0' &&
      (
        // Request
        (typeof message.method === 'string' && message.id !== undefined) ||
        // Response
        (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) ||
        // Notification
        (typeof message.method === 'string' && message.id === undefined)
      )
    );
  }
}

// Built-in translation rules
export const builtInRules = {
  // Add missing JSON-RPC version
  addJsonRpcVersion: (): TranslationRule => ({
    name: 'addJsonRpcVersion',
    description: 'Adds JSON-RPC 2.0 version if missing',
    condition: (message) => message.jsonrpc !== '2.0',
    transform: (message) => ({
      ...message,
      jsonrpc: '2.0' as const
    })
  }),

  // Normalize method names to lowercase
  normalizeMethodNames: (): TranslationRule => ({
    name: 'normalizeMethodNames',
    description: 'Converts method names to lowercase',
    condition: (message) => typeof message.method === 'string',
    transform: (message) => ({
      ...message,
      method: message.method?.toLowerCase()
    })
  }),

  // Add request ID if missing for requests
  addRequestId: (): TranslationRule => ({
    name: 'addRequestId',
    description: 'Adds ID to requests that are missing one',
    condition: (message) => 
      typeof message.method === 'string' && 
      message.id === undefined &&
      !message.method.startsWith('notification/'),
    transform: (message) => ({
      ...message,
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    })
  }),

  // Convert legacy error format
  convertLegacyErrors: (): TranslationRule => ({
    name: 'convertLegacyErrors',
    description: 'Converts legacy error formats to JSON-RPC 2.0',
    condition: (message) => 
      Boolean(message.error) && 
      typeof message.error === 'string',
    transform: (message) => ({
      ...message,
      error: {
        code: -32603,
        message: String(message.error)
      }
    })
  }),

  // Add timestamp to all messages
  addTimestamp: (): TranslationRule => ({
    name: 'addTimestamp',
    description: 'Adds timestamp to message parameters',
    condition: () => true,
    transform: (message) => ({
      ...message,
      params: {
        ...message.params as any,
        _timestamp: new Date().toISOString()
      }
    })
  }),

  // Remove internal parameters
  removeInternalParams: (prefix = '_'): TranslationRule => ({
    name: 'removeInternalParams',
    description: `Removes parameters starting with '${prefix}'`,
    condition: (message) => 
      Boolean(message.params) && 
      typeof message.params === 'object' &&
      message.params !== null &&
      Object.keys(message.params).some(key => key.startsWith(prefix)),
    transform: (message) => {
      if (!message.params || typeof message.params !== 'object') {
        return message;
      }

      const cleanParams = Object.fromEntries(
        Object.entries(message.params).filter(([key]) => !key.startsWith(prefix))
      );

      return {
        ...message,
        params: Object.keys(cleanParams).length > 0 ? cleanParams : undefined
      };
    }
  }),

  // Convert method calls to specific transport format
  transportSpecific: (transportType: string): TranslationRule => ({
    name: `transportSpecific_${transportType}`,
    description: `Applies ${transportType}-specific transformations`,
    condition: () => true,
    transform: (message) => {
      switch (transportType) {
        case 'http':
          // HTTP transport might need additional headers in params
          return {
            ...message,
            params: {
              ...message.params as any,
              _transport: 'http'
            }
          };
          
        case 'websocket':
          // WebSocket transport might need frame information
          return {
            ...message,
            params: {
              ...message.params as any,
              _transport: 'websocket'
            }
          };
          
        case 'sse':
          // SSE transport might need event type information
          return {
            ...message,
            params: {
              ...message.params as any,
              _transport: 'sse'
            }
          };
          
        default:
          return message;
      }
    }
  })
};

// Utility function to create a common translator setup
export function createCommonTranslator(
  transportType?: string,
  additionalRules: TranslationRule[] = []
): MessageTranslator {
  const translator = new MessageTranslator({
    enableValidation: true,
    throwOnValidationError: false,
    logTranslations: false
  });

  // Add common rules
  translator.addRule(builtInRules.addJsonRpcVersion());
  translator.addRule(builtInRules.addRequestId());
  translator.addRule(builtInRules.convertLegacyErrors());

  // Add transport-specific rules if specified
  if (transportType) {
    translator.addRule(builtInRules.transportSpecific(transportType));
  }

  // Add any additional rules
  translator.addRules(additionalRules);

  return translator;
} 