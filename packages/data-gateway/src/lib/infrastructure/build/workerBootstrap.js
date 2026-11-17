// Entry of every worker (thread or process): loads the composition root it is given. The compiled .js in production;
// the .ts source through tsx when the gateway runs from source (tests, development).
const { isMainThread, workerData } = require('worker_threads')
const entry = isMainThread ? process.argv[2] : workerData.entry
if (entry.endsWith('.ts')) require('tsx/cjs/api').register()
require(entry)
