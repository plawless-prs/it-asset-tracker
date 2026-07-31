// Prophet 21 read-only SQL replica client — server-only. Generic and
// app-agnostic (like ./p21.js) so future P21 apps can reuse it. Never import
// into a client component.
//
// Epicor provisions hosted customers a read-only SQL Server replica
// (host/port/db/credentials arrive with the `readonly_*` account). It exposes
// the same p21_view_* views as OData but with none of the API-gateway
// authorization hurdles, so it is the preferred read path; ./p21.js (OData)
// remains as the fallback.
//
// Env: P21_SQL_HOST, P21_SQL_PORT, P21_SQL_DATABASE, P21_SQL_USERNAME,
//      P21_SQL_PASSWORD.

import sql from 'mssql'

export function p21SqlConfigured() {
  return !!(process.env.P21_SQL_HOST && process.env.P21_SQL_DATABASE &&
            process.env.P21_SQL_USERNAME && process.env.P21_SQL_PASSWORD)
}

// One pool per warm serverless instance. Stored as a promise so concurrent
// callers share the same in-flight connect instead of racing new pools.
let _poolPromise = null

export function getP21SqlPool() {
  if (!_poolPromise) {
    _poolPromise = sql.connect({
      server: process.env.P21_SQL_HOST,
      port: Number(process.env.P21_SQL_PORT || 1433),
      database: process.env.P21_SQL_DATABASE,
      user: process.env.P21_SQL_USERNAME,
      password: process.env.P21_SQL_PASSWORD,
      options: { encrypt: true, trustServerCertificate: false },
      connectionTimeout: 30000,
      requestTimeout: 120000,
      pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
    }).catch((e) => { _poolPromise = null; throw e })
  }
  return _poolPromise
}

// Parameterized query. params: { name: value } bound as @name (types inferred).
export async function p21SqlQuery(text, params = {}) {
  const pool = await getP21SqlPool()
  const req = pool.request()
  for (const [k, v] of Object.entries(params)) req.input(k, v)
  const r = await req.query(text)
  return r.recordset || []
}

// View/field names come from env and are interpolated into SQL as identifiers
// (identifiers can't be bound as parameters) — restrict to safe characters.
export function sqlIdent(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`)
  return name
}

export { sql }
