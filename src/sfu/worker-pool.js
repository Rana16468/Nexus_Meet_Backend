import * as mediasoup from "mediasoup";
import { config } from "../config/index.js";
import { workerSettings, routerOptions } from "../config/mediasoup.config.js";

const workers = [];
let cursor = 0;

/**
 * mediasoup spawns one C++ worker subprocess per CPU core we ask for.
 * On Windows 11 these are prebuilt binaries shipped with the npm package,
 * compiled through the Visual Studio C++ Build Tools during `npm install`.
 */
export async function createWorkers() {
  const count = Math.max(1, config.mediasoup.workers);
  for (let i = 0; i < count; i += 1) {
    const worker = await mediasoup.createWorker(workerSettings);
    worker.on("died", () => {
      console.error(`[sfu] worker ${worker.pid} died — exiting in 2s`);
      setTimeout(() => process.exit(1), 2000);
    });
    workers.push(worker);
    console.log(`[sfu] worker ${worker.pid} ready`);
  }
}

/** Round-robin so rooms spread across cores. */
export function nextWorker() {
  const worker = workers[cursor];
  cursor = (cursor + 1) % workers.length;
  return worker;
}

export async function createRouter() {
  return nextWorker().createRouter(routerOptions);
}

export async function closeWorkers() {
  await Promise.all(workers.map((worker) => worker.close()));
  workers.length = 0;
}
