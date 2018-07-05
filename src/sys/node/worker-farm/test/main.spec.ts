import * as d from '../../../../declarations';
import { WorkerFarm, getNextTask, getNextWorker } from '../main';
import { TestWorkerFarm } from './test-worker-farm';


describe('WorkerFarm', () => {

  it('use single instance', async () => {
    const opts: d.WorkerOptions = {
      maxConcurrentWorkers: 0
    };
    const wf = new TestWorkerFarm(opts);
    expect(wf.workers).toHaveLength(0);
    expect(wf.singleThreadRunner).toBeDefined();
  });

  it('run returning async value', async () => {
    const opts: d.WorkerOptions = {
      maxConcurrentWorkers: 2
    };
    const wf = new TestWorkerFarm(opts);

    const p0 = wf.run('runFn');
    const p1 = wf.run('runFn');
    const p2 = wf.run('runFn');
    const p3 = wf.run('runFn');

    expect(wf.workers).toHaveLength(2);

    const w0 = wf.workers[0];
    const w1 = wf.workers[1];

    wf.calcCurrentActiveTasks();

    expect(w0.currentActiveTasks).toBe(2);
    expect(w1.currentActiveTasks).toBe(2);

    setTimeout(() => {
      wf.receiveMessageFromWorker({
        taskId: 0,
        value: 0
      });

      wf.receiveMessageFromWorker({
        taskId: 1,
        value: 1
      });

      wf.receiveMessageFromWorker({
        taskId: 2,
        value: 2
      });

      wf.receiveMessageFromWorker({
        taskId: 3,
        value: 3
      });
    }, 10);

    const rtnVal0 = await p0;
    expect(rtnVal0).toBe(0);

    const rtnVal1 = await p1;
    expect(rtnVal1).toBe(1);

    const rtnVal2 = await p2;
    expect(rtnVal2).toBe(2);

    const rtnVal3 = await p3;
    expect(rtnVal3).toBe(3);

    wf.calcCurrentActiveTasks();

    expect(w0.currentActiveTasks).toBe(0);
    expect(w1.currentActiveTasks).toBe(0);

    expect(w0.totalTasksAssigned).toBe(2);
    expect(w1.totalTasksAssigned).toBe(2);

    expect(wf.tasks).toHaveLength(0);
  });

  it('run returning value', async () => {
    const wf = new TestWorkerFarm();

    expect(wf.workers).toHaveLength(4);

    const p = wf.run('runFn');

    wf.calcCurrentActiveTasks();

    expect(wf.workers).toHaveLength(4);

    const worker = wf.workers[0];
    expect(worker).toBeDefined();
    expect(worker.currentActiveTasks).toBe(1);
    expect(worker.totalTasksAssigned).toBe(1);

    const task = wf.tasks[0];
    expect(task).toBeDefined();
    expect(task.taskId).toBe(0);

    wf.receiveMessageFromWorker({
      taskId: task.taskId,
      value: 88
    });

    const rtnVal = await p;
    expect(rtnVal).toBe(88);

    wf.calcCurrentActiveTasks();
    expect(worker.currentActiveTasks).toBe(0);
    expect(worker.totalTasksAssigned).toBe(1);
    expect(wf.workers).toHaveLength(4);
    expect(wf.tasks).toHaveLength(0);
  });

});


describe('getNextTask', () => {

  it('get first task without worker', () => {
    const tasks: d.WorkerTask[] = [
      { assignedWorkerPid: 0 } as d.WorkerTask,
      { assignedWorkerPid: 1 } as d.WorkerTask,
      {} as d.WorkerTask,
      {} as d.WorkerTask
    ];
    const task = getNextTask(tasks);
    expect(task).toBe(tasks[2]);
  });

  it('get only task without worker', () => {
    const tasks: d.WorkerTask[] = [
      { assignedWorkerPid: 0 } as d.WorkerTask,
      { assignedWorkerPid: 1 } as d.WorkerTask,
      {} as d.WorkerTask
    ];
    const task = getNextTask(tasks);
    expect(task).toBe(tasks[2]);
  });

  it('null for when all tasks w/ workers', () => {
    const tasks: d.WorkerTask[] = [
      { assignedWorkerPid: 0 } as any,
      { assignedWorkerPid: 1 } as any
    ];
    const task = getNextTask(tasks);
    expect(task).toBe(null);
  });

  it('null for no tasks', () => {
    const tasks: d.WorkerTask[] = [];
    const task = getNextTask(tasks);
    expect(task).toBe(null);
  });

});


describe('getNextWorker', () => {
  let workers: d.WorkerProcess[];
  const maxConcurrentWorkers = 4;

  beforeAll(() => {
    workers = [];
    for (let i = 0; i < maxConcurrentWorkers; i++) {
      workers.push({
        childProcess: { pid: i } as any,
        totalTasksAssigned: 0,
        currentActiveTasks: 0,
        exitCode: null,
        isExisting: false
      });
    }
  });

  it('get worker with fewest total tasks assigned when all the same number of tasks', () => {
    workers[0].currentActiveTasks = 3;
    workers[0].totalTasksAssigned = 50;
    workers[1].currentActiveTasks = 3;
    workers[1].totalTasksAssigned = 40;

    // this one is tied for fewest active tasks (3)
    // but has the fewest total tasks assigned (30)
    workers[2].currentActiveTasks = 3;
    workers[2].totalTasksAssigned = 30;

    workers[3].currentActiveTasks = 5;
    workers[3].totalTasksAssigned = 20;

    const w = getNextWorker([], workers, maxConcurrentWorkers);
    expect(w.childProcess.pid).toBe(2);
  });

  it('get first worker when all the same', () => {
    workers[0].currentActiveTasks = 1;
    workers[0].totalTasksAssigned = 1;
    workers[1].currentActiveTasks = 1;
    workers[1].totalTasksAssigned = 1;
    workers[2].currentActiveTasks = 1;
    workers[2].totalTasksAssigned = 1;
    workers[3].currentActiveTasks = 1;
    workers[3].totalTasksAssigned = 1;

    const w = getNextWorker([], workers, maxConcurrentWorkers);
    expect(w.childProcess.pid).toBe(0);
  });

  it('do not use a worker that has a long running task', () => {
    workers[0].currentActiveTasks = 4;
    workers[1].currentActiveTasks = 4;
    workers[2].currentActiveTasks = 1;
    workers[3].currentActiveTasks = 3;

    const tasks = [
      { taskId: 88, isLongRunningTask: true, assignedWorkerPid: workers[2].childProcess.pid } as d.WorkerTask
    ];
    const w = getNextWorker(tasks, workers, maxConcurrentWorkers);
    expect(w.childProcess.pid).toBe(3);
  });

  it('forth task', () => {
    workers[0].currentActiveTasks = 1;
    workers[1].currentActiveTasks = 1;
    workers[2].currentActiveTasks = 1;
    workers[3].currentActiveTasks = 0;

    const w = getNextWorker([], workers, maxConcurrentWorkers);
    expect(w.childProcess.pid).toBe(3);
  });

  it('third task', () => {
    workers[0].currentActiveTasks = 1;
    workers[1].currentActiveTasks = 1;
    workers[2].currentActiveTasks = 0;
    workers[3].currentActiveTasks = 0;

    const w = getNextWorker([], workers, maxConcurrentWorkers);
    expect(w.childProcess.pid).toBe(2);
  });

  it('second task', () => {
    workers[0].currentActiveTasks = 1;
    workers[1].currentActiveTasks = 0;
    workers[2].currentActiveTasks = 0;
    workers[3].currentActiveTasks = 0;

    const w = getNextWorker([], workers, maxConcurrentWorkers);
    expect(w.childProcess.pid).toBe(1);
  });

  it('first task', () => {
    workers[0].currentActiveTasks = 0;
    workers[1].currentActiveTasks = 0;
    workers[2].currentActiveTasks = 0;
    workers[3].currentActiveTasks = 0;

    const w = getNextWorker([], workers, maxConcurrentWorkers);
    expect(w.childProcess.pid).toBe(0);
  });

  it('get the only available worker', () => {
    workers[0].currentActiveTasks = 4;
    workers[1].currentActiveTasks = 4;

    // this one has the fewest active tasks
    workers[2].currentActiveTasks = 3;

    workers[3].currentActiveTasks = 4;
    const w = getNextWorker([], workers, maxConcurrentWorkers);
    expect(w.childProcess.pid).toBe(2);
  });

  it('no available worker', () => {
    workers[0].currentActiveTasks = 5;
    workers[1].currentActiveTasks = 5;
    workers[2].currentActiveTasks = 5;
    workers[3].currentActiveTasks = 5;
    const w = getNextWorker([], workers, maxConcurrentWorkers);
    expect(w).toBe(null);
  });

});
