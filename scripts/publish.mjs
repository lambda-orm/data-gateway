#!/usr/bin/env node
/**
 * Publishes each package from its dist/ directory in dependency order.
 * Only publishes packages whose version is not yet on npm.
 */
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Dependency-ordered list of package directories under packages/
const packages = ['client-node', 'ui']

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: 'inherit' })
}

function isPublished(name, version) {
  try {
    execSync(`npm view ${name}@${version} version`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// Build every workspace package first (tsc -b, project references): a package's dist resolves its workspace
// dependencies from their build/ (lib needs base's), also when only some packages have a new version to publish.
console.log('→ Building the workspace')
run('pnpm run build', root)

for (const dir of packages) {
  const pkgDir = join(root, 'packages', dir)
  const { name, version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

  if (isPublished(name, version)) {
    console.log(`✓ ${name}@${version} already on npm — skipping`)
    continue
  }

  console.log(`\n→ Building ${name}@${version}`)
  run('pnpm run dist', pkgDir)

  console.log(`→ Publishing ${name}@${version} from dist/`)
  run('npm publish --access public', join(pkgDir, 'dist'))

  console.log(`✓ ${name}@${version} published`)
}

console.log('\nDone.')
