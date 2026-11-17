import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('员工编号在事务内分配，工号唯一，改名重算拼音', async () => {
  const database = `yunqi_employee_id_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false;
  let closePool: (() => Promise<void>) | undefined;
  let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool');
    closePool = pool.closePool;
    await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDemoData();
    await (await import('../src/admin/employees/adminEmployeeService')).backfillEmployeeJobCategories();
    await (await import('../src/domains/employees/jobTitleService')).backfillJobTitles();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const call = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as { data?: any; message?: string } };
    };

    const [indexes] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT NON_UNIQUE AS nonUnique FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = 'employees' AND index_name = 'uk_employees_employee_no'`,
      [database]
    );
    assert.equal(indexes.length, 1);
    assert.equal(Number(indexes[0].nonUnique), 0);

    const current = (await call('/admin/employees/U001')).body.data;
    const { account: _account, employmentStatus: _status, deptName: _deptName, leaderName: _leaderName, ...employeeInput } = current;
    const renamed = await call('/admin/employees/U001', 'PUT', { ...employeeInput, name: '王小明', pinyin: current.pinyin });
    assert.equal(renamed.status, 200, renamed.body.message);
    assert.equal(renamed.body.data.pinyin, 'wangxiaoming');

    const duplicate = await call('/admin/employees', 'POST', {
      ...employeeInput,
      name: '另起一名',
      pinyin: 'lingqiyiming',
      employeeNo: current.employeeNo,
      phone: '13900000000',
    });
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.body.message || '', /工号已存在/);

    await conn.query(
      `INSERT INTO \`${database}\`.employees
        (id, name, pinyin, gender, dept_id, position, job_category, level, employee_no, phone, email, join_date, is_leader, seat, leader_id)
       SELECT 'U999999999', name, pinyin, gender, dept_id, position, job_category, level, 'MAX-EMP-NO', phone, email, join_date, 0, seat, NULL
       FROM \`${database}\`.employees WHERE id = 'U001'`
    );
    const exhausted = await call('/admin/employees', 'POST', {
      ...employeeInput,
      name: '编号用尽',
      pinyin: 'bianhaoyongjin',
      employeeNo: 'MAX-PLUS-ONE',
      phone: '13900000001',
    });
    assert.equal(exhausted.status, 400, exhausted.body.message);
    assert.match(exhausted.body.message || '', /员工编号已用完/);
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
