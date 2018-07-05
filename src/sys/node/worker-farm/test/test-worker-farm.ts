import * as d from '../../../../declarations';
import { WorkerFarm } from '../main';
import * as path from 'path';


export class TestWorkerFarm extends WorkerFarm {
  private pids: number;

  constructor(options: d.WorkerOptions = {}) {
    if (typeof options.maxConcurrentWorkers !== 'number') {
      options.maxConcurrentWorkers = 4;
    }

    const modulePath = path.join(__dirname, '..', '..', '..', '..', '..', 'dist', 'sys', 'node', 'sys-worker.js');
    super(modulePath, options);
  }

  createWorker() {
    if (typeof this.pids !== 'number') {
      this.pids = 0;
    }
    const worker: d.WorkerProcess = {
      childProcess: {
        send: () => true,
        pid: this.pids++
      } as any,
      currentActiveTasks: 0,
      totalTasksAssigned: 0,
      exitCode: null,
      isExisting: false
    };

    return worker;
  }

}
