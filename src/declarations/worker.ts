
export interface WorkerOptions {
  maxConcurrentWorkers?: number;
  maxConcurrentTasksPerWorker?: number;
}

export interface WorkerTask {
  // assignedWorkerPid: number;
  // workerKey: string;
  // taskId: number;
  method: string;
  args: any[];
  isLongRunningTask: boolean;
  resolve: (val: any) => any;
  reject: (msg: string) => any;
  retries: number;
}

export interface ChildProcess {
  killed: boolean;
  pid: number;
  kill(signal?: string): void;
  send(message: any, callback?: (error: Error) => void): boolean;
  connected: boolean;
  disconnect(): void;
  unref(): void;
  ref(): void;

  on(event: string, listener: (...args: any[]) => void): this;
  on(event: 'close', listener: (code: number, signal: string) => void): this;
  on(event: 'disconnect', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'exit', listener: (code: number, signal: string) => void): this;
  on(event: 'message', listener: (message: any) => void): this;

  once(event: string, listener: (...args: any[]) => void): this;
  once(event: 'close', listener: (code: number, signal: string) => void): this;
  once(event: 'disconnect', listener: () => void): this;
  once(event: 'error', listener: (err: Error) => void): this;
  once(event: 'exit', listener: (code: number, signal: string) => void): this;
  once(event: 'message', listener: (message: any) => void): this;
}

export interface WorkerMessageData {
  workerId?: number;
  idx?: number;
  type?: 'response' | 'request';
  modulePath?: string;
  method?: string;
  args?: any[];
  retries?: number;
  value?: any;
  exitProcess?: boolean;
  error?: {
    type?: string;
    message?: string;
    stack?: string;
  };
}

export interface WorkerResult {
  idx: number;
}

export type WorkerRunner = (methodName: string, args: any[]) => Promise<any>;

export interface WorkerRunnerOptions {
  isLongRunningTask?: boolean;
  workerKey?: string;
}

export interface WorkerContext {
  tsHost?: any;
  tsProgram?: any;
}
