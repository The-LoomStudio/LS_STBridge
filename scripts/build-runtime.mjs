import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const assets = resolve(root, 'dist/assets')
await mkdir(assets, { recursive: true })
const quickjsRequire = createRequire(require.resolve('quickjs-emscripten'))
const assetSources = [
  [require.resolve('ejs/ejs.js'), 'ejs.js'],
  [require.resolve('lodash/lodash.js'), 'lodash.js'],
  [quickjsRequire.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'), 'quickjs.wasm'],
]
for (const [source, name] of assetSources) await copyFile(source, resolve(assets, name))
const common = {
  absWorkingDir: root, bundle: true, format: 'esm', target: 'es2022',
  sourcemap: true, legalComments: 'linked', metafile: true,
}
const node = {
  ...common, platform: 'node',
  banner: { js: 'import { createRequire as __nodeRequire } from "node:module"; const require = __nodeRequire(import.meta.url);' },
}
const results = await Promise.all([
  build({ ...node, entryPoints: ['src/index.ts'], outfile: 'dist/index.js',
    // Keep runtime-relative Worker/asset paths anchored in dist/runtime.
    external: ['./runtime/register.js'],
  }),
  build({ ...node, entryPoints: ['src/runtime/register.ts'], outfile: 'dist/runtime/register.js' }),
  build({ ...node, entryPoints: ['src/runtime/mvu-worker.ts'], outfile: 'dist/runtime/mvu-worker.js' }),
  build({ ...common, platform: 'browser', entryPoints: ['src/client/index.ts'], outfile: 'dist/client/index.js' }),
])

// Include dependency licenses in the distributable, including the unbundled guest assets.
const packages = new Set()
for (const path of [...results.flatMap(result => Object.keys(result.metafile.inputs).map(path => resolve(root, path))),
  ...assetSources.map(([path]) => path)]) {
  if (!path.includes('/node_modules/')) continue
  let directory = dirname(path)
  while (directory !== dirname(directory)) {
    try {
      await readFile(resolve(directory, 'package.json'))
      packages.add(directory)
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      directory = dirname(directory)
    }
  }
}
const notices = ['# STBridge 运行依赖许可', await readFile(resolve(root, 'src/runtime/vendor/mvu/LICENSE-MVU'), 'utf8')]
for (const directory of [...packages].sort()) {
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  notices.push(`## ${metadata.name} ${metadata.version} (${metadata.license ?? 'see source'})`)
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'LICENSE-MIT.txt', 'COPYING']) {
    try {
      notices.push(await readFile(resolve(directory, filename), 'utf8'))
      break
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}
await writeFile(resolve(root, 'dist/THIRD_PARTY_NOTICES.md'), `${notices.join('\n\n')}\n`)
