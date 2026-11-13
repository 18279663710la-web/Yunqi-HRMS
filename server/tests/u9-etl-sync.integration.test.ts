import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';

test('同步失败不前移水位；成功才更新 last_success_at', async () => {
  const database = `yunqi_u9_sync_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
  });
  let created = false;
  let closePool: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool');
    closePool = pool.closePool;
    await pool.ensureSchema();
    const writer = await import('../src/domains/u9/etl/writer');
    await writer.ensureSyncState();
    const runId = await writer.beginSyncRun('incremental');
    await writer.finishSyncRun(runId, false, 'boom');
    assert.equal(await writer.getSyncWatermark(), null);

    await writer.advanceWatermark('2026-11-13', 'incremental');
    assert.equal(await writer.getSyncWatermark(), '2026-11-13');
    assert.ok(await writer.getLastSuccessAt());
  } finally {
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
