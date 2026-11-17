import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('劳动合同必填校验与受权限保护的文件入库下载', async () => {
  const database = `yunqi_contract_files_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDemoData(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config'); const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const call = async (path: string, token: string, method = 'GET', body?: unknown) => { const r = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() as { data?: any; message?: string } }; };

    const contract = { number: 'HT-001', startDate: '2026-01-01', endDate: '2026-12-31', note: '测试' };
    for (const input of [{}, { ...contract, number: '  ' }, { ...contract, startDate: '' }, { ...contract, endDate: '' }, { ...contract, startDate: '2026-02-30' }, { ...contract, endDate: '2025-12-31' }]) {
      assert.equal((await call('/admin/hr/employees/U001/contract', admin, 'PUT', input)).status, 400);
    }
    assert.equal((await call('/admin/hr/employees/U001/contract', admin, 'PUT', contract)).status, 200);
    assert.deepEqual((await call('/admin/hr/employees/U001/contract', admin)).body.data, contract);
    const endpoint = `/api/admin/hr/employees/U001/contract-files`; const base = `http://127.0.0.1:${addr.port}`;
    const upload = async (name: string, type: string, bytes: Uint8Array, token = admin) => { const body = new FormData(); body.append('file', new Blob([bytes as BlobPart], { type }), name); return fetch(base + endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body }); };
    const bytes = new TextEncoder().encode('%PDF-1.4\ncontract\n%%EOF');
    const createdFile = await upload('劳动合同.pdf', 'application/pdf', bytes); assert.equal(createdFile.status, 200); const { data } = await createdFile.json() as any; assert.ok(data.id);
    const list = await call('/admin/hr/employees/U001/contract-files', admin); assert.equal(list.status, 200); assert.equal(list.body.data.length, 1); assert.equal(list.body.data[0].name, '劳动合同.pdf'); assert.equal(list.body.data[0].size, bytes.length);
    const downloaded = await fetch(`${base}${endpoint}/${data.id}`, { headers: { Authorization: `Bearer ${admin}` } }); assert.equal(downloaded.status, 200); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), Buffer.from(bytes)); assert.match(downloaded.headers.get('content-disposition') || '', /attachment/);
    assert.equal((await fetch(`${base}/api/admin/hr/employees/U005/contract-files/${data.id}`, { headers: { Authorization: `Bearer ${admin}` } })).status, 404);
    assert.equal((await fetch(`${base}${endpoint}/${data.id}`)).status, 401);
    assert.equal((await upload('malware.pdf', 'application/pdf', new TextEncoder().encode('not a pdf'))).status, 400);
    assert.equal((await upload('x.exe', 'application/octet-stream', bytes)).status, 400);
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1); oversized.set(bytes); assert.equal((await upload('big.pdf', 'application/pdf', oversized)).status, 400);
    assert.equal((await call('/admin/hr/employees/U001/contract-files', admin)).body.data.length, 1);
    await conn.query(`INSERT INTO \`${database}\`.admins (id,username,password_hash,name,role,status,created_at) VALUES (2,'hrtest','x','HR','hr_admin',1,NOW())`);
    const hrAdmin = jwt.sign({ typ: 'admin', role: 'hr_admin' }, config.jwt.secret, { subject: '2' });
    assert.equal((await upload('拒绝.pdf', 'application/pdf', bytes, hrAdmin)).status, 403);
    assert.equal((await call('/admin/hr/employees/U001/contract-files', hrAdmin)).status, 403);
    assert.equal((await fetch(`${base}${endpoint}/${data.id}`, { headers: { Authorization: `Bearer ${hrAdmin}` } })).status, 403);
    for (const [name, header] of [['合同.doc','d0cf11e0a1b11ae1'], ['合同.docx','504b0304'], ['合同.jpg','ffd8ff'], ['合同.png','89504e470d0a1a0a']]) {
      const result = await upload(name, 'application/octet-stream', Buffer.from(header, 'hex')); assert.equal(result.status, 200, name);
    }
    assert.equal((await call('/admin/hr/employees/U001/contract-files', admin)).body.data.length, 5);

  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
