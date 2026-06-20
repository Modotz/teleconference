import mediasoup from 'mediasoup';
import { mediasoupConfig } from './config.js';

const workers = [];
let nextWorkerIdx = 0;

export async function createWorkers() {
  for (let i = 0; i < mediasoupConfig.numWorkers; i++) {
    const worker = await mediasoup.createWorker(mediasoupConfig.worker);

    worker.on('died', () => {
      console.error(`Mediasoup worker ${worker.pid} died, exiting...`);
      setTimeout(() => process.exit(1), 2000);
    });

    workers.push(worker);
    console.log(`Mediasoup worker ${i} created (pid=${worker.pid})`);
  }
}

export function getNextWorker() {
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}

export function getWorkers() {
  return workers;
}
