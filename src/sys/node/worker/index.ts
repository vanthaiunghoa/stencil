import * as d from '../../../declarations';
// import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { WorkerMainProcess } from './worker-main';


const filePath = path.join(__dirname, '__main.txt');
fs.writeFileSync(filePath, '');


export class WorkerManager extends EventEmitter {
  ending = false;
  modulePath: string;
  options: d.WorkerOptions;
  singleThreadRunner: d.WorkerRunner;
  taskQueue: d.WorkerTask[] = [];
  workers = new Map<number, WorkerMainProcess>();
  processTaskQueueTmrId: any;


  constructor(modulePath: string, options: d.WorkerOptions = {}) {
    super();

    this.options = {
      maxConcurrentWorkers: DEFAULT_MAX_WORKERS,
      maxConcurrentTasksPerWorker: DEFAULT_MAX_TASKS_PER_WORKER
    };

    if (typeof options.maxConcurrentWorkers === 'number') {
      this.options.maxConcurrentWorkers = options.maxConcurrentWorkers;
    }

    if (typeof options.maxConcurrentTasksPerWorker === 'number') {
      this.options.maxConcurrentTasksPerWorker = options.maxConcurrentTasksPerWorker;
    }

    this.modulePath = modulePath;

    if (this.options.maxConcurrentWorkers > 1) {
      this.startWorkers();

      process.once('exit', () => {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - process.once exit, destroy`);
        this.destroy();
      });

    } else {
      const workerModule = require(modulePath);
      this.singleThreadRunner = new workerModule.createRunner();
    }
  }

  onError(error: NodeJS.ErrnoException, workerId: number) {
    // Handle ipc errors
    fs.appendFileSync(filePath, `\n\n${Date.now()} - workerId: ${workerId}, error ${error}`);
    if (error.code === 'ERR_IPC_CHANNEL_CLOSED') {
      return this.stopWorker(workerId);
    }
  }

  onExit(workerId: number) {
    // delay this to give any sends a chance to finish
    fs.appendFileSync(filePath, `\n\n${Date.now()} - onExit, workerId: ${workerId}`);

    setTimeout(() => {
      let doQueue = false;
      const child = this.workers.get(workerId);

      if (child && child.tasks.size) {
        for (const call of child.tasks.values()) {
          call.retries++;
          this.taskQueue.unshift(call);
          doQueue = true;
        }
      }
      this.stopWorker(workerId);

      if (doQueue) {
        this.processQueue();
      }
    }, 10);
  }

  startWorkers() {
    while (this.workers.size < this.options.maxConcurrentWorkers) {
      this.startWorker();
    }
  }

  startWorker() {
    const worker = new WorkerMainProcess(this.modulePath);

    fs.appendFileSync(filePath, `\n\n${Date.now()} - startWorker, workerId: ${worker.id}`);

    worker.on('request', data => {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - request, workerId: ${worker.id}, data: ${data}`);
      // this.processRequest(data, worker);
    });

    worker.on('response', () => {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - response, workerId: ${worker.id}`);
      this.processQueue();
    });

    worker.once('exit', () => {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - worker.once, exist, workerId: ${worker.id}`);
      this.onExit(worker.id);
    });

    worker.on('error', err => {
      this.onError(err, worker.id);
    });

    this.workers.set(worker.id, worker);
  }

  stopWorker(workerId: number) {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - stopWorker, workerId: ${workerId}`);
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.stop();
      this.workers.delete(workerId);
    }
  }

  async processQueue() {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - processQueue`);

    if (this.ending || !this.taskQueue.length) {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - processQueue, empty`);
      return;
    }

    if (this.workers.size < this.options.maxConcurrentWorkers) {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - processQueue, startWorker`);
      this.startWorker();
    }

    for (const worker of this.workers.values()) {
      if (!this.taskQueue.length) {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - processQueue, no taskQueue length`);
        break;
      }

      if (worker.tasks.size < this.options.maxConcurrentTasksPerWorker) {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - processQueue, call`);
        worker.call(this.taskQueue.shift());
      }
    }
  }

  // async processRequest(data: d.WorkerMessageData, worker: WorkerMainProcess) {
  //   const result: d.WorkerMessageData = {
  //     idx: data.idx,
  //     type: 'response'
  //   };

  //   const method = data.method;
  //   const args = data.args;
  //   const location = data.location;
  //   const awaitResponse = data.awaitResponse;

  //   if (!location) {
  //     throw new Error('Unknown request');
  //   }

  //   const mod = require(location);
  //   try {
  //     let func;
  //     if (method) {
  //       func = mod[method];
  //     } else {
  //       func = mod;
  //     }
  //     result.contentType = 'data';
  //     result.content = await func(...args);

  //   } catch (e) {
  //     result.contentType = 'error';
  //     result.content = errorUtils.errorToJson(e);
  //   }

  //   if (awaitResponse) {
  //     if (worker) {
  //       worker.send(result);

  //     } else {
  //       return result;
  //     }
  //   }
  // }

  run(method: string, args?: any[], opts: d.WorkerRunnerOptions = {}) {

    fs.appendFileSync(filePath, `\n\n${Date.now()} - run, method: ${method}`);

    if (this.ending) {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - process exited, method: ${method}`);
      return Promise.reject(PROCESS_EXITED_MSG);
    }

    if (this.singleThreadRunner) {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - singleThreadRunner, method: ${method}`);
      return this.singleThreadRunner(method, args);
    }

    return new Promise<any>((resolve, reject) => {
      const task: d.WorkerTask = {
        method: method,
        args: args,
        retries: 0,
        isLongRunningTask: !!opts.isLongRunningTask,
        resolve: resolve,
        reject: reject
      };
      this.taskQueue.push(task);

      this.processQueue();
    });
  }

  cancelTasks() {
    // fs.appendFileSync(filePath, `\n\n${Date.now()} - cancelTasks`);

    // for (const worker of this.workers.values()) {
    //   for (const task of worker.tasks.values()) {
    //     task.reject(TASK_CANCELED_MSG);
    //   }
    //   worker.tasks.clear();
    // }
  }

  async destroy() {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - destroy`);

    this.ending = true;

    for (const task of this.taskQueue) {
      task.reject(TASK_CANCELED_MSG);
    }

    this.taskQueue.length = 0;

    for (const workerId of this.workers.keys()) {
      this.stopWorker(workerId);
    }

    this.ending = false;
  }

}


// export function getNextTask(tasks: d.WorkerTask[]) {
//   const tasksWithoutWorkers = tasks.filter(t => t.assignedWorkerPid == null);

//   if (tasksWithoutWorkers.length === 0) {
//     return null;
//   }

//   const sortedTasks = tasksWithoutWorkers.sort((a, b) => {
//     if (a.taskId < b.taskId) return -1;
//     if (a.taskId > b.taskId) return 1;
//     return 0;
//   });

//   return sortedTasks[0];
// }


// export function getNextWorker(tasks: d.WorkerTask[], workers: d.WorkerProcess[], maxConcurrentTasksPerWorker: number) {
//   const availableWorkers = workers.filter(w => {
//     if (w.isExisting) {
//       // nope, don't use this worker if it's exiting
//       return false;
//     }

//     if (w.currentActiveTasks >= maxConcurrentTasksPerWorker) {
//       // do not use this worker if it's at its max
//       return false;
//     }

//     // get all of the tasks this worker is actively working on
//     const activeWorkerTasks = tasks.filter(t => t.assignedWorkerPid === w.childProcess.pid);

//     // see if any of the worker's tasks has a long running task
//     if (activeWorkerTasks.some(t => t && t.isLongRunningTask)) {
//       // one of the tasks for this worker is a long running task
//       // so leave this worker alone and let it focus
//       // basically so the many little tasks don't have to wait up on the long task
//       // (validatingType locks up the thread, so don't use that thread for the time being!)
//       return false;
//     }

//     // this is an available worker up for the job, bring it!
//     return true;
//   });

//   if (availableWorkers.length === 0) {
//     // all workers are pretty tasked at the moment
//     // Please come back again. Thank you for your business.
//     return null;
//   }

//   const sorted = availableWorkers.sort((a, b) => {
//     // worker with the fewest active tasks first
//     if (a.currentActiveTasks < b.currentActiveTasks) return -1;
//     if (a.currentActiveTasks > b.currentActiveTasks) return 1;

//     // all workers have the same number of active tasks, so next sort
//     // by worker with the fewest total tasks that have been assigned
//     if (a.totalTasksAssigned < b.totalTasksAssigned) return -1;
//     if (a.totalTasksAssigned > b.totalTasksAssigned) return 1;

//     return 0;
//   });

//   return sorted[0];
// }


// function getWorkerFromKey(workerKey: string, workers: d.WorkerProcess[]) {
//   const hashChar = createHash('md5')
//                      .update(workerKey)
//                      .digest('base64')
//                      .charAt(0);

//   const b64Int = B64_TABLE[hashChar];
//   const dv = b64Int / 64;
//   const mt = (workers.length - 1) * dv;
//   const workerIndex = Math.round(mt);

//   return workers[workerIndex];
// }

// const B64_TABLE: { [char: string]: number } = {
//   'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 'I': 8, 'J': 9, 'K': 10, 'L': 11, 'M': 12,
//   'N': 13, 'O': 14, 'P': 15, 'Q': 16, 'R': 17, 'S': 18, 'T': 19, 'U': 20, 'V': 21, 'W': 22, 'X': 23,
//   'Y': 24, 'Z': 25, 'a': 26, 'b': 27, 'c': 28, 'd': 29, 'e': 30, 'f': 31, 'g': 32, 'h': 33, 'i': 34,
//   'j': 35, 'k': 36, 'l': 37, 'm': 38, 'n': 39, 'o': 40, 'p': 41, 'q': 42, 'r': 43, 's': 44, 't': 45,
//   'u': 46, 'v': 47, 'w': 48, 'x': 49, 'y': 50, 'z': 51, '0': 52, '1': 53, '2': 54, '3': 55, '4': 56,
//   '5': 57, '6': 58, '7': 59, '8': 60, '9': 61, '+': 62, '/': 63,
// };


const DEFAULT_MAX_WORKERS = 1;
const DEFAULT_MAX_TASKS_PER_WORKER = 5;

export const PROCESS_EXITED_MSG = `process exited`;
export const TASK_CANCELED_MSG = `task canceled`;
// export const TASK_MAX_ATTEMPTS_MSG = `task max attempts`;
// const FORCED_KILL_TIME = 100;
