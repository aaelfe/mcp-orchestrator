// Base transport interfaces and implementations
export {
  MCPMessage,
  TransportHandler,
  TransportConfig,
  TransportMetrics,
  BaseTransport
} from './transports/base/transport-interface';

export {
  MessageAdapter,
  JSONMessageAdapter,
  BinaryMessageAdapter
} from './transports/base/message-adapter';

// STDIO Transport
export {
  ContainerManager,
  ContainerConfig
} from './transports/stdio/container-manager';

export {
  ProcessPool,
  ProcessPoolConfig
} from './transports/stdio/process-pool';

// HTTP Transport
export {
  HTTPTransport,
  HTTPConfig
} from './transports/http/client';

export {
  SessionManager,
  SessionConfig,
  Session
} from './transports/http/session-manager';

// SSE Transport
export {
  SSETransport,
  SSEConfig,
  SSEServer
} from './transports/sse/stream-handler';

// WebSocket Transport
export {
  WebSocketTransport,
  WebSocketConfig
} from './transports/websocket/connection-manager';

export {
  ReconnectionHandler,
  ReconnectionConfig,
  createReconnectionConfig
} from './transports/websocket/reconnection-handler';

// Transport Factory
export {
  TransportFactory,
  TransportType,
  TransportInstance,
  TransportFactoryConfig,
  StdioTransportFactoryConfig,
  HTTPTransportFactoryConfig,
  SSETransportFactoryConfig,
  WebSocketTransportFactoryConfig,
  FactoryStats,
  createTransportConfig
} from './transports/transport-factory';

// Protocol Layer
export {
  MessageRouter,
  RouteConfig,
  MessageTransformer,
  RouteMiddleware,
  RouteMatch,
  MessageHandler,
  RoutingStats,
  builtInTransformers,
  builtInMiddleware
} from './protocol/message-router';

export {
  CorrelationTracker,
  PendingRequest,
  CorrelationConfig,
  CorrelationMetrics
} from './protocol/correlation-tracker';

export {
  MessageTranslator,
  TranslationRule,
  TranslatorConfig,
  builtInRules,
  createCommonTranslator
} from './protocol/translator';

// Examples (for reference)
export {
  demonstrateTransportLayer,
  advancedUsageExamples
} from './example'; 