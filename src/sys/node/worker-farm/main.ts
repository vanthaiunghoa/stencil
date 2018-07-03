import * as d from '../../../declarations';
import { createHash } from 'crypto';
import { ForkOptions, fork } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';


const filePath = path.join(__dirname, '__main.txt');
fs.writeFileSync(filePath, '');


export class WorkerFarm {
  options: d.WorkerOptions;
  modulePath: string;
  workerModule: any;
  workers: d.WorkerProcess[] = [];
  taskQueue: d.WorkerTask[] = [];
  isExisting = false;
  logger: d.Logger;
  singleThreadRunner: d.WorkerRunner;
  retryTmrId: any;
  workerIds = 0;

  constructor(modulePath: string, options: d.WorkerOptions = {}) {
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);
    this.modulePath = modulePath;
    this.logger = {
      error: function() {
        console.error.apply(console, arguments);
      }
    } as any;

    if (this.options.maxConcurrentWorkers > 1) {
      this.startWorkers();

      process.once('exit', () => {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - process.once exit, destroy`);
        this.destroy();
      });

    } else {
      this.workerModule = require(modulePath);
      this.singleThreadRunner = new this.workerModule.createRunner();
    }
  }

  run(methodName: string, args?: any[], opts: d.WorkerRunnerOptions = {}) {

    fs.appendFileSync(filePath, `${Date.now()} - methodName: ${methodName}`);

    if (this.isExisting) {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - process exited, methodName: ${methodName}`);
      return Promise.reject(`process exited`);
    }

    if (this.singleThreadRunner) {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - singleThreadRunner, methodName: ${methodName}`);
      return this.singleThreadRunner(methodName, args);
    }

    return new Promise<any>((resolve, reject) => {
      const task: d.WorkerTask = {
        methodName: methodName,
        args: args,
        isLongRunningTask: !!opts.isLongRunningTask,
        resolve: resolve,
        reject: reject
      };

      if (typeof opts.workerKey === 'string') {
        // this task has a worker key so that it always uses
        // the same worker, this way it can reuse that worker's cache again
        // let's figure out its worker id which should always be
        // the same id number for the same worker key string
        const workerId = getWorkerIdFromKey(opts.workerKey, this.workers);
        const worker = this.workers.find(w => w.workerId === workerId);
        if (!worker) {
          fs.appendFileSync(filePath, `\n\n${Date.now()} - invalid worker id for task, methodName: ${methodName}`);
          task.reject(`invalid worker id for task: ${task}`);
        } else {
          fs.appendFileSync(filePath, `\n\n${Date.now()} - send task, workerId: ${workerId}, methodName: ${methodName}`);
          this.send(worker, task);
          this.processTaskQueue();
        }

      } else {
        // add this task to the queue to be processed
        // and assigned to the next available worker
        fs.appendFileSync(filePath, `\n\n${Date.now()} - queue to process, methodName: ${methodName}, this.taskQueue.length: ${this.taskQueue}`);
        this.taskQueue.push(task);
        this.processTaskQueue();
      }
    });
  }

  startWorkers() {
    while (this.workers.length < this.options.maxConcurrentWorkers) {
      this.createWorker();
    }
  }

  createWorker() {
    const workerId = this.workerIds++;
    fs.appendFileSync(filePath, `\n\n${Date.now()} - createWorker ${workerId}`);

    const argv = [
      `--start-worker`,
      `--worker-id=${workerId}`
    ];

    const options: ForkOptions = {
      env: process.env,
      cwd: process.cwd()
    };

    const childProcess = fork(this.modulePath, argv, options);

    const worker: d.WorkerProcess = {
      workerId: workerId,
      taskIds: 0,
      tasks: [],
      totalTasksAssigned: 0,
      send: (msg: d.WorkerMessageData) => childProcess.send(msg),
      kill: () => {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - worker SIGKILL exit`);
        childProcess.kill('SIGKILL');
      }
    };

    childProcess.on('message', this.receiveMessageFromWorker.bind(this));

    childProcess.once('exit', code => {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - childProcess exit, ${code}`);
      this.onWorkerExit(workerId, code);
    });

    childProcess.on('error', err => {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - childProcess error, ${err}`);
      this.receiveMessageFromWorker({
        workerId: workerId,
        error: {
          message: `Worker (${workerId}) process error: ${err.message}`,
          stack: err.stack
        }
      });
    });

    this.workers.push(worker);

    return worker;
  }

  onWorkerExit(workerId: number, exitCode: number) {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - onWorkerExit, workerId: ${workerId}, ${exitCode}`);
    const worker = this.workers.find(w => w.workerId === workerId);
    if (!worker) {
      return;
    }

    worker.exitCode = exitCode;

    setTimeout(() => {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - onWorkerExit, setTimeout, workerId: ${workerId}, ${exitCode}`);
      this.stopWorker(workerId);
    }, 10);
  }

  stopWorker(workerId: number) {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - stopWorker ${workerId}`);
    const worker = this.workers.find(w => w.workerId === workerId);
    if (worker && !worker.isExisting) {
      worker.isExisting = true;

      worker.tasks.forEach(task => {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - stopWorker, reject ${workerId}`);
        task.reject(WORKER_EXITED_MSG);
      });
      worker.tasks.length = 0;

      worker.send({
        exitProcess: true
      });

      const tmr = setTimeout(() => {
        if (worker.exitCode == null) {
          fs.appendFileSync(filePath, `\n\n${Date.now()} - stopWorker, kill ${workerId}`);
          worker.kill();
        }
      }, this.options.forcedKillTime);

      tmr.unref && tmr.unref();

      const index = this.workers.indexOf(worker);
      if (index > -1) {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - stopWorker, splice ${workerId}`);
        this.workers.splice(index, 1);
      }
    }
  }

  receiveMessageFromWorker(msg: d.WorkerMessageData) {
    // message sent back from a worker process
    if (this.isExisting) {
      // already exiting, don't bother
      fs.appendFileSync(filePath, `\n\n${Date.now()} - receiveMessageFromWorker, isExisting`);
      return;
    }

    const worker = this.workers.find(w => w.workerId === msg.workerId);
    if (!worker) {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - Received message for unknown worker (${msg.workerId})`);
      this.logger.error(`Received message for unknown worker (${msg.workerId})`);
      return;
    }

    const task = worker.tasks.find(w => w.taskId === msg.taskId);
    if (!task) {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - Worker (${worker.workerId}) received message for unknown taskId (${msg.taskId})`);
      this.logger.error(`Worker (${worker.workerId}) received message for unknown taskId (${msg.taskId})`);
      return;
    }

    if (task.timer) {
      clearTimeout(task.timer);
    }

    const index = worker.tasks.indexOf(task);
    if (index > -1) {
      worker.tasks.splice(index, 1);
    }

    process.nextTick(() => {
      if (msg.error) {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - receiveMessageFromWorker, workerId: ${msg.workerId}, taskId: ${msg.taskId}, msg.error ${msg.error.message}`);
        task.reject(msg.error.message);
      } else {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - receiveMessageFromWorker, workerId: ${msg.workerId}, taskId: ${msg.taskId}, taskId: ${msg.methodName}, msg.value ${JSON.stringify(msg.value, null, 2)}`);
        task.resolve(msg.value);
      }

      // overkill yes, but let's ensure we've cleaned up this task
      task.args = null;
      task.reject = null;
      task.resolve = null;
      task.timer = null;

      // allow any outstanding tasks to be processed
      this.processTaskQueue();
    });
  }

  workerTimeout(workerId: number) {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - workerTimeout ${workerId}`);
    const worker = this.workers.find(w => w.workerId === workerId);
    if (!worker) {
      return;
    }

    worker.tasks.forEach(task => {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - Worker (${workerId}) timed out! Canceled "${task.methodName}" task.`);

      this.receiveMessageFromWorker({
        taskId: task.taskId,
        workerId: workerId,
        error: {
          message: `\n\n${Date.now()} - Worker (${workerId}) timed out! Canceled "${task.methodName}" task.`
        }
      });
    });

    this.stopWorker(workerId);
  }

  processTaskQueue() {
    clearTimeout(this.retryTmrId);

    if (this.options.maxConcurrentWorkers > 1 && this.workers.length < this.options.maxConcurrentWorkers) {
      // start up some more workers if we had some exited
      fs.appendFileSync(filePath, `\n\n${Date.now()} - processTaskQueue, startWorkers, this.workers.length: ${this.workers.length}`);
      this.startWorkers();
    }

    while (this.taskQueue.length > 0) {
      const worker = nextAvailableWorker(this.workers, this.options.maxConcurrentTasksPerWorker);
      if (worker) {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - processTaskQueue ${this.taskQueue.length}, send`);
        // we found a worker to send this task to
        this.send(worker, this.taskQueue.shift());

      } else {
        // no worker available ATM, we'll try again later
        // the timeout is just a fallback
        fs.appendFileSync(filePath, `\n\n${Date.now()} - processTaskQueue ${this.taskQueue.length}, no worker available ATM, we'll try again later. Tasks: ${this.taskQueue.map(q => q.methodName)}`);
        this.retryTmrId = setTimeout(this.processTaskQueue.bind(this), 100);
        break;
      }
    }
  }

  send(worker: d.WorkerProcess, task: d.WorkerTask) {
    if (!worker || !task) {
      return;
    }

    task.taskId = worker.taskIds++;

    worker.tasks.push(task);
    worker.totalTasksAssigned++;

    fs.appendFileSync(filePath, `\n\n${Date.now()} - send, workerId: ${worker.workerId}, taskId: ${task.taskId}, methodName: ${task.methodName}`);
    worker.send({
      workerId: worker.workerId,
      taskId: task.taskId,
      methodName: task.methodName,
      args: task.args
    });

    // no need to keep these args in memory at this point
    // task.args = null;

    if (this.options.maxTaskTime !== Infinity) {
      task.timer = setTimeout(this.workerTimeout.bind(this, worker.workerId), this.options.maxTaskTime);
    }
  }

  destroy() {
    if (!this.isExisting) {
      this.isExisting = true;

      // workers may already be getting removed
      // so doing it this way cuz we don't know if the
      // order of the workers array is consistent
      const workerIds = this.workers.map(worker => worker.workerId);
      workerIds.forEach(workerId => {
        this.stopWorker(workerId);
      });
    }
  }

}


export function nextAvailableWorker(workers: d.WorkerProcess[], maxConcurrentTasksPerWorker: number) {
  const availableWorkers = workers.filter(w => {
    if (w.tasks.length >= maxConcurrentTasksPerWorker) {
      // do not use this worker if it's at its max
      return false;
    }

    if (w.tasks.some(t => t && t.isLongRunningTask)) {
      // one of the tasks for this worker is a long running task
      // so leave this worker alone and let it focus
      // basically so the many little tasks don't have to wait up on the long task
      return false;
    }

    // let's use this worker for this task
    return true;
  });

  if (availableWorkers.length === 0) {
    // all workers are pretty tasked at the moment, please come back later. Thank you.
    return null;
  }

  const sorted = availableWorkers.sort((a, b) => {
    // worker with the fewest active tasks first
    if (a.tasks.length < b.tasks.length) return -1;
    if (a.tasks.length > b.tasks.length) return 1;

    // all workers have the same number of active tasks, so next sort
    // by worker with the fewest total tasks that have been assigned
    if (a.totalTasksAssigned < b.totalTasksAssigned) return -1;
    if (a.totalTasksAssigned > b.totalTasksAssigned) return 1;

    return 0;
  });

  return sorted[0];
}


function getWorkerIdFromKey(workerKey: string, workers: d.WorkerProcess[]) {
  const hashChar = createHash('md5')
                     .update(workerKey)
                     .digest('base64')
                     .charAt(0);

  const workerIds = workers.map(w => w.workerId);

  const b64Int = B64_TABLE[hashChar];
  const dv = b64Int / 64;
  const mt = (workerIds.length - 1) * dv;
  const workerIndex = Math.round(mt);

  return workerIds[workerIndex];
}

const B64_TABLE: { [char: string]: number } = {
  'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 'I': 8, 'J': 9, 'K': 10, 'L': 11, 'M': 12,
  'N': 13, 'O': 14, 'P': 15, 'Q': 16, 'R': 17, 'S': 18, 'T': 19, 'U': 20, 'V': 21, 'W': 22, 'X': 23,
  'Y': 24, 'Z': 25, 'a': 26, 'b': 27, 'c': 28, 'd': 29, 'e': 30, 'f': 31, 'g': 32, 'h': 33, 'i': 34,
  'j': 35, 'k': 36, 'l': 37, 'm': 38, 'n': 39, 'o': 40, 'p': 41, 'q': 42, 'r': 43, 's': 44, 't': 45,
  'u': 46, 'v': 47, 'w': 48, 'x': 49, 'y': 50, 'z': 51, '0': 52, '1': 53, '2': 54, '3': 55, '4': 56,
  '5': 57, '6': 58, '7': 59, '8': 60, '9': 61, '+': 62, '/': 63,
};


const DEFAULT_OPTIONS: d.WorkerOptions = {
  maxConcurrentWorkers: 1,
  maxConcurrentTasksPerWorker: 5,
  maxTaskTime: 120000,
  forcedKillTime: 100
};

export const WORKER_EXITED_MSG = `worker has exited`;
