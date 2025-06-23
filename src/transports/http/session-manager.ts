import { HTTPTransport, HTTPConfig } from './client';
import { MCPMessage } from '../base/transport-interface';

export interface SessionConfig {
  maxSessions: number;
  sessionTimeout: number;
  cleanupInterval: number;
}

export interface Session {
  id: string;
  transport: HTTPTransport;
  lastActivity: Date;
  created: Date;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private httpConfig: HTTPConfig,
    private sessionConfig: SessionConfig
  ) {
    this.startCleanupTimer();
  }

  async createSession(sessionId?: string): Promise<string> {
    // Generate session ID if not provided
    const id = sessionId || this.generateSessionId();
    
    // Check if session already exists
    if (this.sessions.has(id)) {
      throw new Error(`Session ${id} already exists`);
    }

    // Check session limit
    if (this.sessions.size >= this.sessionConfig.maxSessions) {
      throw new Error('Maximum number of sessions reached');
    }

    try {
      // Create new transport instance
      const transport = new HTTPTransport(this.httpConfig);
      await transport.connect();

      // Create session
      const session: Session = {
        id,
        transport,
        lastActivity: new Date(),
        created: new Date()
      };

      this.sessions.set(id, session);
      console.log(`Created HTTP session: ${id}`);
      
      return id;
    } catch (error) {
      console.error(`Failed to create session ${id}:`, error);
      throw error;
    }
  }

  getSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
    return session;
  }

  async sendMessage<T>(sessionId: string, message: MCPMessage<T>): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      await session.transport.send(message);
      session.lastActivity = new Date();
    } catch (error) {
      console.error(`Failed to send message in session ${sessionId}:`, error);
      
      // If transport is disconnected, try to reconnect
      if (!session.transport.isConnected()) {
        try {
          await session.transport.connect();
          await session.transport.send(message);
          session.lastActivity = new Date();
        } catch (reconnectError) {
          // If reconnection fails, remove the session
          await this.removeSession(sessionId);
          throw reconnectError;
        }
      } else {
        throw error;
      }
    }
  }

  onMessage<T>(sessionId: string, handler: (message: MCPMessage<T>) => void): void {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.transport.onMessage(handler);
  }

  onError(sessionId: string, handler: (error: Error) => void): void {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.transport.onError(handler);
  }

  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      await session.transport.close();
    } catch (error) {
      console.error(`Error closing session ${sessionId}:`, error);
    }

    this.sessions.delete(sessionId);
    console.log(`Removed HTTP session: ${sessionId}`);
  }

  private generateSessionId(): string {
    return `http-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.sessionConfig.cleanupInterval);
  }

  private async cleanupExpiredSessions(): Promise<void> {
    const now = new Date();
    const expiredSessions: string[] = [];

    for (const [id, session] of this.sessions) {
      const timeDiff = now.getTime() - session.lastActivity.getTime();
      if (timeDiff > this.sessionConfig.sessionTimeout) {
        expiredSessions.push(id);
      }
    }

    // Remove expired sessions
    for (const sessionId of expiredSessions) {
      console.log(`Cleaning up expired session: ${sessionId}`);
      await this.removeSession(sessionId);
    }

    if (expiredSessions.length > 0) {
      console.log(`Cleaned up ${expiredSessions.length} expired sessions`);
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  getSessionMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};
    
    for (const [id, session] of this.sessions) {
      metrics[id] = {
        created: session.created,
        lastActivity: session.lastActivity,
        connected: session.transport.isConnected(),
        metrics: session.transport.getMetrics()
      };
    }
    
    return metrics;
  }

  async close(): Promise<void> {
    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Close all sessions
    const closePromises = Array.from(this.sessions.keys()).map(sessionId =>
      this.removeSession(sessionId)
    );
    
    await Promise.all(closePromises);
  }
} 