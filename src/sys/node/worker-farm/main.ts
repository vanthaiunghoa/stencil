import * as d from '../../../declarations';
import { createHash } from 'crypto';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';


const filePath = path.join(__dirname, '__main.txt');
fs.writeFileSync(filePath, '');


export class WorkerFarm {
  isExisting = false;
  modulePath: string;
  options: d.WorkerOptions;
  singleThreadRunner: d.WorkerRunner;
  taskIds = 0;
  tasks: d.WorkerTask[] = [];
  workers: d.WorkerProcess[] = [];
  processTaskQueueTmrId: any;


  constructor(modulePath: string, options: d.WorkerOptions = {}) {
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

  run(methodName: string, args?: any[], opts: d.WorkerRunnerOptions = {}) {

    fs.appendFileSync(filePath, `\n\n${Date.now()} - run, methodName: ${methodName}`);

    if (this.isExisting) {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - process exited, methodName: ${methodName}`);
      return Promise.reject(PROCESS_EXITED_MSG);
    }

    if (this.singleThreadRunner) {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - singleThreadRunner, methodName: ${methodName}`);
      return this.singleThreadRunner(methodName, args);
    }

    return new Promise<any>((resolve, reject) => {
      const task: d.WorkerTask = {
        taskId: this.taskIds++,
        assignedWorkerPid: null,
        workerKey: opts.workerKey,
        methodName: methodName,
        args: args,
        isLongRunningTask: !!opts.isLongRunningTask,
        resolve: resolve,
        reject: reject
      };
      this.tasks.push(task);

      this.processTaskQueue();
    });
  }

  startWorkers() {
    if (this.options.maxConcurrentWorkers > 1 && this.workers.length < this.options.maxConcurrentWorkers) {
      while (this.workers.length < this.options.maxConcurrentWorkers) {
        const worker = this.createWorker();
        this.workers.push(worker);
      }
    }
  }

  createWorker() {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - createWorker`);

    const argv = [
      `--start-worker`
    ];

    const options: cp.ForkOptions = {
      env: process.env,
      cwd: process.cwd()
    };

    const worker: d.WorkerProcess = {
      childProcess: cp.fork(this.modulePath, argv, options),
      currentActiveTasks: 0,
      totalTasksAssigned: 0,
      exitCode: null,
      isExisting: false
    };

    worker.childProcess.on('message', this.receiveMessageFromWorker.bind(this));

    worker.childProcess.on('error', err => {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - childProcess error, ${err}`);
      this.receiveMessageFromWorker({
        error: {
          message: `Worker (${worker.childProcess.pid}) process error: ${err.message}`,
          stack: err.stack
        }
      });
    });

    worker.childProcess.once('exit', code => {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - childProcess exit, ${code}`);
      this.onWorkerExit(worker, code);
    });

    return worker;
  }

  onWorkerExit(worker: d.WorkerProcess, exitCode: number) {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - onWorkerExit, pid: ${worker.childProcess.pid}, ${exitCode}`);

    worker.exitCode = exitCode;

    const workerIndex = this.workers.indexOf(worker);
    if (workerIndex > -1) {
      this.workers.splice(workerIndex, 1);
    }

    this.tasks
      .filter(t => t.assignedWorkerPid === worker.childProcess.pid)
      .forEach(t => {
        t.assignedWorkerPid = null;
      });
  }

  receiveMessageFromWorker(msg: d.WorkerMessageData) {
    const task = this.tasks.find(t => t.taskId === msg.taskId);
    if (!task) {
      return;
    }

    // since we've got a response from a worker about this task
    // let's take it out of our list of tasks to process
    removeTask(this.tasks, task);

    // let's throw this in a nextTick() just to cool things down a bit
    process.nextTick(() => {
      if (msg.error) {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - receiveMessageFromWorker, taskId: ${msg.taskId}, pid: ${msg.pid}, msg.error ${msg.error.message}`);
        task.reject(msg.error.message);
      } else {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - receiveMessageFromWorker, taskId: ${msg.taskId}, pid: ${msg.pid}, taskId: ${msg.methodName}`);
        task.resolve(msg.value);
      }
    });

    // allow any outstanding tasks to be processed
    this.processTaskQueue();
  }

  processTaskQueue() {
    clearTimeout(this.processTaskQueueTmrId);

    this.startWorkers();

    let task: d.WorkerTask;

    // keep loooooping through each of the tasks
    // that are ready to be processed
    while ((task = getNextTask(this.tasks))) {
      const successful = this.processTask(task);

      if (!successful) {
        // oh no!!
        // looks like all the workers are already heavily tasked right now
        this.processTaskQueueTmrId = setTimeout(this.processTaskQueue.bind(this), 100);
        break;
      }
    }
  }

  processTask(task: d.WorkerTask) {
    let worker: d.WorkerProcess;

    if (task.workerKey != null) {
      // this task has a worker key so that it always uses
      // the same worker, this way it can reuse that worker's cache again
      worker = getWorkerFromKey(task.workerKey, this.workers);
      if (!worker) {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - invalid worker id for task, pid: ${worker.childProcess.pid}`);
        task.workerKey = null;
        task.assignedWorkerPid = null;
        return false;
      }

    } else {
      // always recalculate
      this.calcCurrentActiveTasks();

      // get the next worker that's available to take on this task
      worker = getNextWorker(this.tasks, this.workers, this.options.maxConcurrentTasksPerWorker);
      if (!worker) {
        // no worker available ATM, we'll try again later
        fs.appendFileSync(filePath, `\n\n${Date.now()} - processTaskQueue ${this.tasks.length}, no worker available ATM, we'll try again later`);
        return false;
      }
    }

    return this.processTaskWithWorker(task, worker);
  }

  processTaskWithWorker(task: d.WorkerTask, worker: d.WorkerProcess) {
    // we found which worker we should use for this task
    // let's set the child process id as this task's active worker pid
    const taskId = task.taskId;
    task.assignedWorkerPid = worker.childProcess.pid;
    worker.totalTasksAssigned++;

    // create the message we'll send to the worker out of the task data
    const msg: d.WorkerMessageData = {
      taskId: task.taskId,
      methodName: task.methodName,
      args: task.args
    };

    const timerId = setTimeout(() => {
      const task = this.tasks.find(t => t.taskId === taskId);
      if (task && task.assignedWorkerPid != null) {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - retry, pid: ${worker.childProcess.pid}, taskId: ${taskId}`);
        task.assignedWorkerPid = null;
        this.processTaskQueue();
      }
    }, 5000);

    fs.appendFileSync(filePath, `\n\n${Date.now()} - send, pid: ${worker.childProcess.pid}, taskId: ${task.taskId}`);

    // attempt to send the message to the worker
    const sendSuccess = worker.childProcess.send(msg, sendError => {
      if (sendError == null) {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - clearTimeout, pid: ${worker.childProcess.pid}, taskId: ${task.taskId}`);
        clearTimeout(timerId);

      } else {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - sendError, pid: ${worker.childProcess.pid}, taskId: ${task.taskId}, sendError: ${sendError}`);
      }
    });

    if (sendSuccess) {
      clearTimeout(timerId);
    }

    // successfully sent the message to the worker
    // now we play the waiting game...
    // •͡˘㇁•͡˘
    return true;
  }

  cancelTasks() {
    this.tasks.forEach(task => {
      task.reject(TASK_CANCELED_MSG);
    });
    this.tasks.length = 0;
  }

  destroy() {
    if (!this.isExisting) {
      this.isExisting = true;

      this.cancelTasks();

      // workers may already be getting removed
      // so doing it this way cuz we don't know if the
      // order of the workers array is consistent
      this.workers.forEach(worker => {
        this.destroyWorker(worker);
      });
    }
  }

  destroyWorker(worker: d.WorkerProcess) {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - destroyWorker ${worker.childProcess.pid}`);

    if (worker && !worker.isExisting) {
      worker.isExisting = true;

      this.tasks
        .filter(t => t.assignedWorkerPid === worker.childProcess.pid)
        .forEach(t => {
          t.assignedWorkerPid = null;
        });

      worker.childProcess.send({
        exitProcess: true
      });

      const tmr = setTimeout(() => {
        if (worker.exitCode == null) {
          fs.appendFileSync(filePath, `\n\n${Date.now()} - destroyWorker, kill ${worker.childProcess.pid}`);
          worker.childProcess.kill();
        }
      }, FORCED_KILL_TIME);

      tmr.unref && tmr.unref();

      const workerIndex = this.workers.indexOf(worker);
      if (workerIndex > -1) {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - destroyWorker, splice ${worker.childProcess.pid}`);
        this.workers.splice(workerIndex, 1);
      }
    }
  }


  calcCurrentActiveTasks() {
    this.workers.forEach(w => {
      w.currentActiveTasks = this.tasks.filter(t => t.assignedWorkerPid === w.childProcess.pid).length;
    });
  }

}


function removeTask(tasks: d.WorkerTask[], task: d.WorkerTask) {
  const taskIndex = tasks.indexOf(task);
  if (taskIndex > -1) {
    tasks.splice(taskIndex, 1);
  }
}


export function getNextTask(tasks: d.WorkerTask[]) {
  const tasksWithoutWorkers = tasks.filter(t => t.assignedWorkerPid == null);

  if (tasksWithoutWorkers.length === 0) {
    return null;
  }

  const sortedTasks = tasksWithoutWorkers.sort((a, b) => {
    if (a.taskId < b.taskId) return -1;
    if (a.taskId > b.taskId) return 1;
    return 0;
  });

  return sortedTasks[0];
}


export function getNextWorker(tasks: d.WorkerTask[], workers: d.WorkerProcess[], maxConcurrentTasksPerWorker: number) {
  const availableWorkers = workers.filter(w => {
    if (w.isExisting) {
      // nope, don't use this worker if it's exiting
      return false;
    }

    if (w.currentActiveTasks >= maxConcurrentTasksPerWorker) {
      // do not use this worker if it's at its max
      return false;
    }

    // get all of the tasks this worker is actively working on
    const activeWorkerTasks = tasks.filter(t => t.assignedWorkerPid === w.childProcess.pid);

    // see if any of the worker's tasks has a long running task
    if (activeWorkerTasks.some(t => t && t.isLongRunningTask)) {
      // one of the tasks for this worker is a long running task
      // so leave this worker alone and let it focus
      // basically so the many little tasks don't have to wait up on the long task
      // (validatingType locks up the thread, so don't use that thread for the time being!)
      return false;
    }

    // this is an available worker up for the job, bring it!
    return true;
  });

  if (availableWorkers.length === 0) {
    // all workers are pretty tasked at the moment
    // Please come back again. Thank you for your business.
    return null;
  }

  const sorted = availableWorkers.sort((a, b) => {
    // worker with the fewest active tasks first
    if (a.currentActiveTasks < b.currentActiveTasks) return -1;
    if (a.currentActiveTasks > b.currentActiveTasks) return 1;

    // all workers have the same number of active tasks, so next sort
    // by worker with the fewest total tasks that have been assigned
    if (a.totalTasksAssigned < b.totalTasksAssigned) return -1;
    if (a.totalTasksAssigned > b.totalTasksAssigned) return 1;

    return 0;
  });

  return sorted[0];
}


function getWorkerFromKey(workerKey: string, workers: d.WorkerProcess[]) {
  const hashChar = createHash('md5')
                     .update(workerKey)
                     .digest('base64')
                     .charAt(0);

  const b64Int = B64_TABLE[hashChar];
  const dv = b64Int / 64;
  const mt = (workers.length - 1) * dv;
  const workerIndex = Math.round(mt);

  return workers[workerIndex];
}

const B64_TABLE: { [char: string]: number } = {
  'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 'I': 8, 'J': 9, 'K': 10, 'L': 11, 'M': 12,
  'N': 13, 'O': 14, 'P': 15, 'Q': 16, 'R': 17, 'S': 18, 'T': 19, 'U': 20, 'V': 21, 'W': 22, 'X': 23,
  'Y': 24, 'Z': 25, 'a': 26, 'b': 27, 'c': 28, 'd': 29, 'e': 30, 'f': 31, 'g': 32, 'h': 33, 'i': 34,
  'j': 35, 'k': 36, 'l': 37, 'm': 38, 'n': 39, 'o': 40, 'p': 41, 'q': 42, 'r': 43, 's': 44, 't': 45,
  'u': 46, 'v': 47, 'w': 48, 'x': 49, 'y': 50, 'z': 51, '0': 52, '1': 53, '2': 54, '3': 55, '4': 56,
  '5': 57, '6': 58, '7': 59, '8': 60, '9': 61, '+': 62, '/': 63,
};


const DEFAULT_MAX_WORKERS = 1;
const DEFAULT_MAX_TASKS_PER_WORKER = 5;

export const PROCESS_EXITED_MSG = `process exited`;
export const TASK_CANCELED_MSG = `task canceled`;
export const TASK_MAX_ATTEMPTS_MSG = `task max attempts`;
const FORCED_KILL_TIME = 100;
