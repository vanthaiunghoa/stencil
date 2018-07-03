import * as d from '../../../../declarations';
import { WorkerFarm } from '../main';
import * as path from 'path';


export class TestWorkerFarm extends WorkerFarm {
  constructor(options: d.WorkerOptions = {}) {
    if (typeof options.maxConcurrentWorkers !== 'number') {
      options.maxConcurrentWorkers = 4;
    }

    const modulePath = path.join(__dirname, '..', '..', '..', '..', '..', 'dist', 'sys', 'node', 'sys-worker.js');
    super(modulePath, options);
  }

  createWorker() {
    const worker = super.createWorker();
    worker.send = () => {/**/};
    worker.kill = () => {/**/};
    return worker;
  }
}
