import { parentPort, workerData } from 'node:worker_threads'
import { initializeMvuData, updateMvuData } from './mvu-engine.js'
import type { MvuWork } from './mvu.js'

const input = workerData as MvuWork
try {
  const result = input.kind === 'initialize'
    ? initializeMvuData(input.context)
    : await updateMvuData(input.text, input.value)
  parentPort!.postMessage({ result })
} catch (error) {
  parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) })
}
