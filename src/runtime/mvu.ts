import { Worker } from 'node:worker_threads'
import type { JsonObject } from '@loom-studio/shared'
import type { MvuInitialization, MvuResult } from './mvu-engine.js'

export type MvuWork = { kind: 'initialize'; context: MvuInitialization }
  | { kind: 'update'; text: string; value: JsonObject }

export async function runMvu(input: MvuWork, signal: AbortSignal): Promise<MvuResult> {
  signal.throwIfAborted()
  // ponytail: bounded single-operation worker; raise limits only with real large-card fixtures.
  if (JSON.stringify(input).length > 2_000_000) throw new Error('MVU input exceeds 2 MB')
  const worker = new Worker(new URL('./mvu-worker.js', import.meta.url), {
    workerData: input,
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
  })
  let abort!: () => void
  let timer!: ReturnType<typeof setTimeout>
  try {
    return await new Promise<MvuResult>((resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      timer = setTimeout(() => reject(new Error('MVU operation exceeded 5 seconds')), 5_000)
      worker.once('error', reject)
      worker.once('exit', code => reject(new Error(`MVU worker exited before returning data (${code})`)))
      worker.once('message', (message: { error?: string; result?: MvuResult }) => {
        if (message.error) reject(new Error(message.error))
        else if (message.result && JSON.stringify(message.result).length <= 2_000_000) resolve(message.result)
        else reject(new Error('MVU output is invalid or exceeds 2 MB'))
      })
    })
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    await worker.terminate()
  }
}
