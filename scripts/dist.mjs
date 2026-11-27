#!/usr/bin/env node
/**
 * Builds a package's dist/ directory: lint, compile, test, copy the
 * build output + metadata files, and write a publish-ready package.json
 * (workspace:* deps resolved to real semver, devDependencies stripped).
 *
 * Run from the package directory (invoked as each package's "dist" script).
 */
import { execSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, mkdtempSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

const pkgDir = process.cwd()
const repoRoot = join(pkgDir, '..', '..')
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

function run(cmd) {
  execSync(cmd, { cwd: pkgDir, stdio: 'inherit' })
}

// 1. Clean
rmSync(join(pkgDir, 'build'), { recursive: true, force: true })
rmSync(join(pkgDir, 'dist'), { recursive: true, force: true })
rmSync(join(pkgDir, 'build', '.tsbuildinfo'), { force: true })

// 2. Lint, compile, test — delegate to the package's own scripts so this
// stays generic across packages with different eslint --ignore-pattern flags.
run('npm run lint')
run('npm run build')
run('npm run test')

// 3. Copy build output into dist/
// "main" points at the compiled entry point (e.g. "./build/lib/index.js");
// copy that same subfolder of build/ into dist/.
mkdirSync(join(pkgDir, 'dist'), { recursive: true })
const buildMatch = /^\.\/build\/(.+)\/[^/]+$/.exec(pkg.main || '')
const buildSubdir = buildMatch ? join(pkgDir, 'build', buildMatch[1]) : join(pkgDir, 'build')
cpSync(buildSubdir, join(pkgDir, 'dist'), { recursive: true })

// 4. Copy metadata files
for (const file of ['README.md', 'CHANGELOG.md', 'jest-config.json']) {
  const src = join(pkgDir, file)
  if (existsSync(src)) cpSync(src, join(pkgDir, 'dist', file))
}
// not the repo's .npmrc: it is auth configuration, and inside dist/ it overrides the publishing token (${NPM_TOKEN})
for (const file of ['LICENSE', '.npmignore']) {
  const src = join(repoRoot, file)
  if (existsSync(src)) cpSync(src, join(pkgDir, 'dist', file))
}

// 5. Write dist/package.json: resolve workspace:* deps, strip dev-only fields
if (pkg.dependencies) {
  for (const dep of Object.keys(pkg.dependencies)) {
    if (pkg.dependencies[dep] === 'workspace:*') {
      const depName = dep.split('/').pop()
      const depPkgPath = join(repoRoot, 'packages', depName, 'package.json')
      if (existsSync(depPkgPath)) {
        const depPkg = JSON.parse(readFileSync(depPkgPath, 'utf8'))
        pkg.dependencies[dep] = `^${depPkg.version}`
      } else {
        throw new Error(`Cannot resolve workspace dependency: ${dep}`)
      }
    }
  }
}
delete pkg.devDependencies
delete pkg.private
pkg.scripts = { test: pkg.scripts.test }
// bin and exports point into build/<subdir>/ like main: make them relative to dist/ (the published exports pointed
// to ./build/lib/index.js, so require('@lambdaorm/lib') failed for everyone)
const toDist = (path) => path.replace(/^\.?\/?build\/[^/]+\//, './')
const mapPaths = (value) => typeof value === 'string' ? toDist(value)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapPaths(v)])) : value
if (pkg.bin) pkg.bin = mapPaths(pkg.bin)
if (pkg.exports) pkg.exports = mapPaths(pkg.exports)
// main / module / types point into build/<subdir>/ too (./build/lib/index.js → index.js)
pkg.main = pkg.main ? toDist(pkg.main).replace(/^\.\//, '') : 'index.js'
if (pkg.module) pkg.module = toDist(pkg.module).replace(/^\.\//, '')
pkg.types = pkg.types ? toDist(pkg.types).replace(/^\.\//, '') : 'index.d.ts'
writeFileSync(join(pkgDir, 'dist', 'package.json'), JSON.stringify(pkg, null, 2), 'utf8')

// 6. Smoke test of what would be published: required by its name (so "exports" applies, as for a user) and, for a
// CLI, its bin answers --help — a package that can't load is not released
const distDir = join(pkgDir, 'dist')
for (const bin of !pkg.bin ? [] : typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin)) {
  if (!existsSync(join(distDir, bin))) throw new Error(`bin ${bin} not found in dist/`)
  execSync(`node ${JSON.stringify(join(distDir, bin))} --help`, { cwd: pkgDir, stdio: 'pipe' })
}
if (!pkg.bin) {
  const smoke = mkdtempSync(join(tmpdir(), 'dist-smoke-'))
  try {
    const link = join(smoke, 'node_modules', ...pkg.name.split('/'))
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(distDir, link, 'dir')
    // dependencies resolve from the package's own node_modules (NODE_PATH), the package itself through its name
    execSync(`node -e "require('${pkg.name}')"`, { cwd: smoke, stdio: 'pipe', env: { ...process.env, NODE_PATH: join(pkgDir, 'node_modules') } })
    // and imported, as from an ES module (an "exports" with only "require" can't be imported)
    execSync(`node --input-type=module -e "await import('${pkg.name}')"`, { cwd: smoke, stdio: 'pipe' })
  } finally {
    rmSync(smoke, { recursive: true, force: true })
  }
}
console.log(`✓ ${pkg.name}@${pkg.version}: dist/ loads by its name (require and import)`)
