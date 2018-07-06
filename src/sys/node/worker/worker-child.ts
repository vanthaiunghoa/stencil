import * as d from '../../../declarations';
import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '__worker.txt');
fs.writeFileSync(filePath, '');


class WorkerChildProcess {

  callQueue: d.WorkerMessageData[] = [];
  responseQueue = new Map<number, d.WorkerMessageData>();
  responseId = 0;
  maxConcurrentCalls = 10;

  constructor(public process: NodeJS.Process, public runner: d.WorkerRunner) {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - constructor, ${process.pid}`);
  }

  messageListener(data: d.WorkerMessageData) {
    if (data.exitProcess) {
      // main thread said to have this worker exit
      fs.appendFileSync(filePath, `\n\n${Date.now()} - messageListener, exitProcess`);
      this.end();
    }

    const type = data.type;
    if (type === 'response') {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - messageListener, response`);
      // return this.handleResponse(data);

    } else if (type === 'request') {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - messageListener, request`);
      this.handleRequest(data);
    } else {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - messageListener, ${JSON.stringify(data)}`);
    }
  }

  async send(msg: d.WorkerMessageData) {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - send`);

    this.process.send(msg, (err: NodeJS.ErrnoException) => {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - send rsp, ${err}`);
      if (err && err.code === 'ERR_IPC_CHANNEL_CLOSED') {
        this.end();
      }
    });
  }

  async handleRequest(data: d.WorkerMessageData) {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - handleRequest`);

    const result: d.WorkerMessageData = {
      idx: data.idx,
      workerId: data.workerId,
      type: 'response'
    };

    try {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - receivedFromMain, data.idx: ${data.idx}, pid: ${data.workerId}, ${data.method}`);

      result.value = await this.runner(data.method, data.args);

    } catch (e) {
      // method call had an error
      fs.appendFileSync(filePath, `\n\n${Date.now()} - e, ${data.method}, ${e}`);
      addErrorToMsg(result, e);
    }

    this.send(result);
  }

  // async handleResponse(data: d.WorkerMessageData) {
  //   const idx = data.idx;
  //   const contentType = data.contentType;
  //   const content = data.content;
  //   const call = this.responseQueue.get(idx);

  //   if (contentType === 'error') {
  //     call.reject(errorUtils.jsonToError(content));
  //   } else {
  //     call.resolve(content);
  //   }

  //   this.responseQueue.delete(idx);

  //   // Process the next call
  //   this.processQueue();
  // }

  // async processQueue() {
  //   if (!this.callQueue.length) {
  //     return;
  //   }

  //   if (this.responseQueue.size < this.maxConcurrentCalls) {
  //     this.sendRequest(this.callQueue.shift());
  //   }
  // }

  end() {
    return this.process.exit(0);
  }
}


export function attachMessageHandler(process: NodeJS.Process, runner: d.WorkerRunner) {
  const w = new WorkerChildProcess(process, runner);
  process.on('message', w.messageListener.bind(w));
}


function addErrorToMsg(result: d.WorkerMessageData, e: any) {
  // parse the error into an object that can go between processes
  result.error = {
    message: 'worker error'
  };

  if (typeof e === 'string') {
    result.error.message = e;

  } else if (e) {
    if (e.message) {
      result.error.message = e.message + '';
    }
    if (e.stack) {
      result.error.stack = e.stack + '';
    }
    if (e.type) {
      result.error.type = e.type + '';
    }
  }

  fs.appendFileSync(filePath, `\n\n${Date.now()} - error ${JSON.stringify(result.error, null, 2)}`);
}
