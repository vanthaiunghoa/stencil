import * as d from '../../../declarations';
import * as cp from 'child_process';
import { EventEmitter } from 'events';

import * as fs from 'fs';
import * as path from 'path';
const filePath = path.join(__dirname, '__main.txt');


export class WorkerMainProcess extends EventEmitter {
  callId: number;
  tasks: Map<number, d.WorkerTask>;
  child: cp.ChildProcess;
  exitCode: number;
  processQueue: boolean;
  sendQueue: d.WorkerMessageData[];
  stopped: boolean;

  constructor(workerModule: string) {
    super();

    this.sendQueue = [];
    this.processQueue = true;

    this.tasks = new Map();
    this.exitCode = null;
    this.callId = 0;
    this.stopped = false;

    this.fork(workerModule);
  }

  get id() {
    return this.child.pid;
  }

  fork(workerModule: string) {
    const filteredArgs = process.execArgv.filter(
      v => !/^--(debug|inspect)/.test(v)
    );

    const options: cp.ForkOptions = {
      execArgv: filteredArgs,
      env: process.env,
      cwd: process.cwd()
    };

    const args = ['--start-worker'];

    fs.appendFileSync(filePath, `\n\n${Date.now()} - fork, workerModule: ${workerModule}`);
    this.child = cp.fork(workerModule, args, options);

    this.child.on('message', this.receive.bind(this));

    this.child.once('exit', code => {
      this.exitCode = code;
      this.emit('exit', code);
    });

    this.child.on('error', err => {
      this.emit('error', err);
    });
  }

  send(data: d.WorkerMessageData) {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - send, ${JSON.stringify(data)}`);

    if (!this.processQueue) {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - send, this.sendQueue.push(data)`);
      this.sendQueue.push(data);
      return;
    }

    const result = this.child.send(data, error => {
      if (error && error instanceof Error) {
        // Ignore this, the workerfarm handles child errors
        fs.appendFileSync(filePath, `\n\n${Date.now()} - send, error: ${error}`);
        return;
      }

      this.processQueue = true;

      if (this.sendQueue.length > 0) {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - send, this.sendQueue.length: ${this.sendQueue.length}`);
        const queueCopy = this.sendQueue.slice(0);
        this.sendQueue = [];
        queueCopy.forEach(d => this.send(d));
      }
    });

    if (!result || /^win/.test(process.platform)) {
      // Queue is handling too much messages throttle it
      fs.appendFileSync(filePath, `\n\n${Date.now()} - send, result: ${result}, /^win/.test(process.platform): ${/^win/.test(process.platform)}`);
      this.processQueue = false;
    }
  }

  call(call: d.WorkerTask) {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - call: ${call}`);
    const idx = this.callId++;
    this.tasks.set(idx, call);

    this.send({
      type: 'request',
      idx: idx,
      workerId: this.id,
      method: call.method,
      args: call.args
    });
  }

  receive(data: d.WorkerMessageData) {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - worker main, receive: ${JSON.stringify(data)}`);

    if (this.stopped) {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - stopped`);
      return;
    }

    if (data.type === 'request') {
      this.emit('request', data);

    } else if (data.type === 'response') {
      const call = this.tasks.get(data.idx);
      if (!call) {
        // Return for unknown calls, these might accur if a third party process uses workers
        return;
      }

      if (data.error) {
        call.reject(data.error.message);
      } else {
        call.resolve(data.value);
      }

      this.tasks.delete(data.idx);

      this.emit('response', data);
    }
  }

  stop() {
    this.stopped = true;

    this.send({
      exitProcess: true
    });

    setTimeout(() => {
      if (this.exitCode === null) {
        this.child.kill('SIGKILL');
      }
    }, 100);
  }
}
