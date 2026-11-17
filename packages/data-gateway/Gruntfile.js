module.exports = function (grunt) {
	const path = require('path');
	const baseDir = __dirname;
	const repoRoot = path.resolve(baseDir, "../..")
	grunt.loadNpmTasks('grunt-exec');
	grunt.loadNpmTasks('grunt-contrib-clean');
	grunt.loadNpmTasks('grunt-contrib-copy');
	grunt.initConfig({
		exec: {
			lint: { cmd: 'npx eslint -c ../../eslint.config.js "src/**/*.ts" --ignore-pattern "src/lib/repository/domain/queryable.ts"' },
			test: { cmd: 'npx jest --config ./jest-config.json' },
			tsc: { cmd: 'npx tsc ' },
			doc: { cmd: 'npx typedoc --plugin typedoc-plugin-markdown --out doc/source src/lib/index.ts' },
			getOriginalBranch: {
				cmd: 'git branch | sed -n -e \'s/^\\* \\(.*\\)/\\1/p\'',
				callback: function (error, stdout, stderr) {
					if (error) {
						grunt.log.error(stderr)
					} else {
						grunt.config.set('originalBranch', stdout.trim())
					}
				}
			},
			standardVersion: {
				cmd: 'standard-version'
			},
			createRelease: {
				cmd: `git add . && git commit -m "chore(release): <%= packageName %>@<%= version %>" && git push && git push --tags
					&&  git checkout -b release/<%= packageName %>-<%= version %> && git push --set-upstream origin release/<%= packageName %>-<%= version %>
					&&  git checkout <%= originalBranch %>
					&&  git branch -D release/<%= packageName %>-<%= version %>
				`
			},
			publish: {
				cmd: 'cd dist && pnpm publish --access public'
			}
		},
		clean: {
			build: ['build'],
			dist: ['dist']
		},
		copy: {
			lib: { expand: true, cwd: 'build/lib/', src: '**', dest: 'dist/' },
			// tsc doesn't copy it and the server reads it next to infrastructure/server.js (L8)
			swagger: { expand: true, cwd: 'src/lib/infrastructure/', src: 'swagger.yaml', dest: 'build/lib/infrastructure/' },
			readme: { expand: true, src: './README.md', dest: 'dist/' },
			license: { expand: true, src: path.join(repoRoot, "LICENSE"), dest: path.join(baseDir, "dist", "LICENSE") },
			changeLog: { expand: true, src: './CHANGELOG.md', dest: 'dist/' },
			jest: { expand: true, src: './jest-config.json', dest: 'dist/' },
			npmignore: { expand: false, src: path.join(repoRoot, ".npmignore"), dest: path.join(baseDir, "dist", ".npmignore") }
		}
	})
	grunt.registerTask('get-package-name', 'get package name from package.json', function () {
			const pkg = grunt.file.readJSON('./package.json')
			// extrae "base" de "@lambdaorm/base"
			const packageName = pkg.name.split('/').pop()
			grunt.config.set('packageName', packageName)
	})
	grunt.registerTask('get-version', 'get version from package.json', function () {
		const version = grunt.file.readJSON('./package.json').version
		grunt.config.set('version', version)
	})
	grunt.registerTask('create-package', 'create package.json for dist', function () {
		const fs = require('fs')
		const data = require('./package.json')
		// workspace:* → the version of the package in this repo (npm can't install workspace:*) — L8
		for (const dep of Object.keys(data.dependencies || {})) {
			if (String(data.dependencies[dep]).startsWith('workspace:')) {
				const depPkg = require(path.join(repoRoot, 'packages', dep.split('/').pop(), 'package.json'))
				data.dependencies[dep] = `^${depPkg.version}`
			}
		}
		delete data.devDependencies
		delete data.private
		data.scripts = {
			start: 'node index.js',
			test: data.scripts.test
		}
		data.engines = { node: '>=20' }
		data.main = 'index.js'
		data.types = 'index.d.ts'
		fs.writeFileSync('./dist/package.json', JSON.stringify(data, null, 2), 'utf8')
	})
	grunt.registerTask('changelog-format', 'apply format to changelog', function () {
		const changelog = grunt.file.read('CHANGELOG.md')
		let newChangelog = changelog.replace(/https:\/\/github.com\/lambda-orm\/core\/issues\//g, 'https://github.com/lambda-orm/core/issues/')
		newChangelog = newChangelog.replace(/\n### Bug Fixes/g, '**Bug Fixes:**')
		newChangelog = newChangelog.replace(/\n### Features/g, '**Features:**')
		grunt.file.write('CHANGELOG.md', newChangelog)
	})
	grunt.registerTask('exec-release', ['get-package-name','exec:standardVersion', 'changelog-format', 'copy:changeLog', 'create-package', 'get-version', 'exec:createRelease'])
	grunt.registerTask('run-release-if-applicable', 'run release if applicable', function () {
		const originalBranch = grunt.config.get('originalBranch')
		if (originalBranch === 'develop' || originalBranch.startsWith('hotfix')) {
			grunt.task.run('exec-release')
		} else {
			grunt.log.writeln('Current branch ' + originalBranch + ', cannot release from branch different from develop or hotfix.')
		}
	})
	grunt.registerTask('lint', ['exec:lint'])
	grunt.registerTask('build', ['lint', 'clean:build', 'exec:tsc', 'copy:swagger'])
	grunt.registerTask('test', ['build', 'exec:test'])
	grunt.registerTask('docs', ['exec:doc'])
	grunt.registerTask('dist', ['build', 'clean:dist', 'copy:lib', 'copy:jest', 'copy:readme', 'copy:license', 'copy:npmignore', 'create-package',])
	grunt.registerTask('release-manual', ['dist', 'docs', 'exec:standardVersion', 'changelog-format', 'copy:changeLog', 'create-package', 'get-version', 'exec:publish'])
	grunt.registerTask('release', ['dist', 'docs', 'exec:getOriginalBranch', 'run-release-if-applicable'])
	grunt.registerTask('default', [])
}
