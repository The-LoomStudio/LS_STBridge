import { Worker } from 'node:worker_threads';
export async function runMvu(input, signal) {
    signal.throwIfAborted();
    // ponytail: bounded single-operation worker; raise limits only with real large-card fixtures.
    if (JSON.stringify(input).length > 2_000_000)
        throw new Error('MVU input exceeds 2 MB');
    const worker = new Worker(new URL('./mvu-worker.js', import.meta.url), {
        workerData: input,
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    let abort;
    let timer;
    try {
        return await new Promise((resolve, reject) => {
            abort = () => reject(signal.reason);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted)
                abort();
            timer = setTimeout(() => reject(new Error('MVU operation exceeded 5 seconds')), 5_000);
            worker.once('error', reject);
            worker.once('exit', code => reject(new Error(`MVU worker exited before returning data (${code})`)));
            worker.once('message', (message) => {
                if (message.error)
                    reject(new Error(message.error));
                else if (message.result && JSON.stringify(message.result).length <= 2_000_000)
                    resolve(message.result);
                else
                    reject(new Error('MVU output is invalid or exceeds 2 MB'));
            });
        });
    }
    finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        await worker.terminate();
    }
}
//# sourceMappingURL=mvu.js.map