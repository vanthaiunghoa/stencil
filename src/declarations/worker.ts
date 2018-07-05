
export interface WorkerOptions {
  maxConcurrentWorkers?: number;
  maxConcurrentTasksPerWorker?: number;
}

export interface WorkerTask {
  assignedWorkerPid: number;
  workerKey: string;
  taskId: number;
  methodName: string;
  args: any[];
  isLongRunningTask: boolean;
  resolve: (val: any) => any;
  reject: (msg: string) => any;
}

export interface WorkerProcess {
  childProcess: ChildProcess;
  currentActiveTasks: number;
  exitCode: number;
  isExisting: boolean;
  totalTasksAssigned: number;
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
  pid?: number;
  taskId?: number;
  modulePath?: string;
  methodName?: string;
  args?: any[];
  value?: any;
  exitProcess?: boolean;
  error?: {
    type?: string;
    message?: string;
    stack?: string;
  };
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
