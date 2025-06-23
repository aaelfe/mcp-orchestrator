import { spawn, ChildProcess } from 'child_process';
import { BaseTransport, MCPMessage, TransportConfig } from '../base/transport-interface';
import { JSONMessageAdapter } from '../base/message-adapter';

export interface ContainerConfig extends TransportConfig {
  image: string;
  command: string[];
  env?: Record<string, string>;
  volumes?: string[];
  workingDir?: string;
  name?: string;
}

export class ContainerManager extends BaseTransport {
  private process: ChildProcess | null = null;
  private adapter = new JSONMessageAdapter();
  private connected = false;
  private buffer = '';

  constructor(private containerConfig: ContainerConfig) {
    super(containerConfig);
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Container already running');
    }

    try {
      // Build docker run command
      const dockerArgs = this.buildDockerArgs();
      
      this.process = spawn('docker', dockerArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.setupProcessHandlers();
      this.connected = true;
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error('Failed to start container'));
      throw error;
    }
  }

  private buildDockerArgs(): string[] {
    const args = ['run', '--rm', '-i'];
    
    // Add container name if specified
    if (this.containerConfig.name) {
      args.push('--name', this.containerConfig.name);
    }

    // Add environment variables
    if (this.containerConfig.env) {
      Object.entries(this.containerConfig.env).forEach(([key, value]) => {
        args.push('-e', `${key}=${value}`);
      });
    }

    // Add volumes
    if (this.containerConfig.volumes) {
      this.containerConfig.volumes.forEach(volume => {
        args.push('-v', volume);
      });
    }

    // Add working directory
    if (this.containerConfig.workingDir) {
      args.push('-w', this.containerConfig.workingDir);
    }

    // Add image and command
    args.push(this.containerConfig.image);
    args.push(...this.containerConfig.command);

    return args;
  }

  private setupProcessHandlers(): void {
    if (!this.process) return;

    // Handle stdout (MCP messages)
    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Handle stderr (logs)
    this.process.stderr?.on('data', (data: Buffer) => {
      console.error(`Container stderr: ${data.toString()}`);
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.connected = false;
      this.process = null;
      this.handleClose();
      
      if (code !== 0 && code !== null) {
        this.handleError(new Error(`Container exited with code ${code}`));
      }
    });

    // Handle process errors
    this.process.on('error', (error) => {
      this.connected = false;
      this.handleError(error);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep the last incomplete line

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = this.adapter.deserialize(line.trim());
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse MCP message:', line, error);
        }
      }
    }
  }

  async send<T>(message: MCPMessage<T>): Promise<void> {
    if (!this.process || !this.connected) {
      throw new Error('Container not running');
    }

    try {
      const serialized = this.adapter.serialize(message);
      this.process.stdin?.write(serialized + '\n');
      this.incrementSentMessages();
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error('Failed to send message'));
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connected && this.process !== null;
  }

  async close(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      
      // Wait for graceful shutdown or force kill after timeout
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }
    
    this.connected = false;
    this.process = null;
  }
} 