// Creates (or updates) the lab's tables with the schema owners (stage ddl).
//   npx tsx setup.ts          # push
//   npx tsx setup.ts --dry    # only print the DDL (what Ilusor saves as a SQL script)
//   npx tsx setup.ts --drop   # drop the lab's tables
import { newOrm } from './tests/helpers'

(async () => {
	const orm = await newOrm()
	try {
		if (process.argv.includes('--drop')) {
			const result = await orm.stage.drop({ stage: 'ddl' }).execute()
			console.log(JSON.stringify(result, null, 2))
		} else if (process.argv.includes('--dry')) {
			const sentences = await orm.stage.push({ stage: 'ddl' }).sentence()
			console.log(JSON.stringify(sentences, null, 2))
		} else {
			const result = await orm.stage.push({ stage: 'ddl' }).execute()
			console.log(JSON.stringify(result, null, 2))
		}
	} catch (error: any) {
		console.error(error.stack)
		process.exitCode = 1
	} finally {
		await orm.end()
	}
})()
