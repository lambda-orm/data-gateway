const { Orm } = require('@lambdaorm/lib')
const [dir, dialect, conn] = [process.argv[2], process.argv[3], JSON.parse(process.argv[4])]
const schema = {
  domain: { entities: [
    { name: 'Approvals', primaryKey: ['id'], properties: [
      { name: 'id', type: 'string', length: 64, required: true },
      { name: 'schemaPath', type: 'string', length: 200, required: true },
      { name: 'status', type: 'string', length: 20, required: true },
      { name: 'body', type: 'text' },
      { name: 'createdAt', type: 'string', length: 30, required: true } ],
      indexes: [{ name: 'byStatus', fields: ['schemaPath', 'status', 'createdAt'] }] } ], enums: [] },
  infrastructure: { paths: { state: dir }, mappings: [{ name: 'default', entities: [{ name: 'Approvals', mapping: 'dg_approvals' }] }], sources: [{ name: 'main', dialect, mapping: 'default', connection: conn }], stages: [{ name: 'default', sources: [{ name: 'main' }] }] },
  application: { start: [], listeners: [] }
}
;(async () => {
  const orm = new Orm()
  await orm.init(schema, true)
  const t0 = Date.now()
  try { console.log('push', JSON.stringify(await orm.stage.push({ stage: 'default' }).execute()).slice(0, 200)) } catch (e) { console.log('push error', e.name, e.message.slice(0, 200)) }
  const id = 'a' + Math.random()
  console.log('ins', JSON.stringify(await orm.execute('Approvals.insert()', { id, schemaPath: 's', status: 'pending', body: 'x'.repeat(20000), createdAt: new Date().toISOString() })).slice(0, 80))
  console.log('upd1', JSON.stringify(await orm.execute('Approvals.update(p => ({ status: to })).filter(p => p.id == id && p.status == from)', { id, to: 'done', from: 'pending' })))
  console.log('upd2', JSON.stringify(await orm.execute('Approvals.update(p => ({ status: to })).filter(p => p.id == id && p.status == from)', { id, to: 'done', from: 'pending' })))
  const rows = await orm.execute('Approvals.filter(p => p.id == id)', { id })
  console.log('get', rows.length, Object.keys(rows[0]), rows[0].body.length)
  console.log('list', JSON.stringify(await orm.execute('Approvals.filter(p => p.schemaPath == s).sort(p => desc(p.createdAt)).page(1, 2).map(p => p.id)', { s: 's' })).slice(0, 120))
  console.log('del', JSON.stringify(await orm.execute('Approvals.delete().filter(p => p.id == id)', { id })))
  await orm.end()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
