import * as d from '../../../declarations';
import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '__worker.txt');
fs.writeFileSync(filePath, '');

export function attachMessageHandler(process: NodeJS.Process, runner: d.WorkerRunner) {

  function handleMessageFromMain(receivedFromMain: d.WorkerMessageData) {
    if (receivedFromMain.exitProcess) {
      // main thread said to have this worker exit
      fs.appendFileSync(filePath, `\n\n${Date.now()} - receivedFromMain, exitProcess`);
      process.exit(0);
    }

    // build a message to send back to main
    const sendToMain: d.WorkerMessageData = {
      pid: process.pid,
      taskId: receivedFromMain.taskId
    };

    // call the method on the loaded module
    // using the received task data
    try {
      fs.appendFileSync(filePath, `\n\n${Date.now()} - receivedFromMain, taskId: ${receivedFromMain.taskId}, pid: ${receivedFromMain.pid}, ${receivedFromMain.methodName}`);

      const rtn = runner(receivedFromMain.methodName, receivedFromMain.args);

      rtn.then((value: any) => {
        fs.appendFileSync(filePath, `\n\n${Date.now()} - rtn.then, taskId: ${receivedFromMain.taskId}, pid: ${receivedFromMain.pid}, ${receivedFromMain.methodName}`);
        sendToMain.value = value;
        sendToMain.methodName = receivedFromMain.methodName;
        process.send(sendToMain);

      }).catch((err: any) => {
        // returned a rejected promise
        fs.appendFileSync(filePath, `\n\n${Date.now()} - catch, ${receivedFromMain.methodName}, ${err}`);
        addErrorToMsg(sendToMain, err);
        process.send(sendToMain);
      });

    } catch (e) {
      // method call had an error
      fs.appendFileSync(filePath, `\n\n${Date.now()} - e, ${receivedFromMain.methodName}, ${e}`);
      addErrorToMsg(sendToMain, e);
      process.send(sendToMain);
    }
  }

  // handle receiving a message from main
  process.on('message', handleMessageFromMain);

  process.on('exit', () => {
    fs.appendFileSync(filePath, `\n\n${Date.now()} - process.on exit`);
  });
}


function addErrorToMsg(msg: d.WorkerMessageData, e: any) {
  // parse the error into an object that can go between processes
  msg.error = {
    message: 'worker error'
  };

  if (typeof e === 'string') {
    msg.error.message = e;

  } else if (e) {
    if (e.message) {
      msg.error.message = e.message + '';
    }
    if (e.stack) {
      msg.error.stack = e.stack + '';
    }
    if (e.type) {
      msg.error.type = e.type + '';
    }
  }

  fs.appendFileSync(filePath, `\n\n${Date.now()} - error ${JSON.stringify(msg.error, null, 2)}`);
}
