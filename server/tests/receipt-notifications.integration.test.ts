import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import express from 'express';

test('回款通知按业务员留单、去重并隔离', async () => {
  const database = `yunqi_receipt_notify_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
  });
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
    await conn.query(`INSERT INTO \`${database}\`.u9_employee_bindings (employee_id,operator_id,updated_at) VALUES ('U012','101',NOW()),('U013','102',NOW())`);

    const receipt = (transactorId: string, id: string, docNo: string) => ({
      id,
      docNo,
      customerName: '测试客户',
      businessDate: '2026-11-12 00:00:00',
      totalAmount: '36990.42',
      orgName: '江西优科工业材料有限公司',
      transactorId,
      lines: [
        { lineNum: 10, settlementMethod: '票据', noteNo: 'NOTE-1', amount: '4219.00', bankAccount: '中国银行5171' },
        { lineNum: 20, settlementMethod: '票据', noteNo: 'NOTE-2', amount: '10900.00', bankAccount: '中国银行5171' },
      ],
    });
    const receipts = [receipt('101', '9001', 'REC-TEST-0001'), receipt('999', '9002', 'REC-TEST-0002')];
    const fakeU9 = {
      searchOperators: async () => [],
      getOperator: async () => null,
      listDocuments: async () => [],
      getDocument: async () => null,
      getReceiptDocument: async () => null,
      listReceivableDocuments: async () => [],
      getReceivableDocument: async () => null,
      listReceivableCustomers: async () => [],
      listReceiptCustomers: async () => [],
      listReceiptsForNotification: async () => receipts,
      getSummary: async () => [],
    };

    const { syncReceiptNotifications } = await import('../src/domains/u9/receiptNotificationService');
    assert.equal(await syncReceiptNotifications(fakeU9), 1);
    assert.equal(await syncReceiptNotifications(fakeU9), 0);
    const stored = await pool.queryOne<{ count: number }>('SELECT COUNT(*) count FROM receipt_notifications');
    assert.equal(Number(stored?.count), 1);
    const row = await pool.queryOne<{ employee_id: string; doc_no: string; total_amount: string; line_count: number; is_read: number }>(
      'SELECT employee_id,doc_no,total_amount,line_count,is_read FROM receipt_notifications'
    );
    assert.deepEqual(row, { employee_id: 'U012', doc_no: 'REC-TEST-0001', total_amount: '36990.42', line_count: 2, is_read: 0 });

    const { issueTokens } = await import('../src/miniprogram/auth/authService');    const { createU9BusinessRouter } = await import('../src/miniprogram/business/u9Routes');
    const { errorHandler } = await import('../src/shared/middleware/error');
    const app = express();
    app.use(express.json());
    app.use('/api/business', createU9BusinessRouter(fakeU9));
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const salesA = issueTokens('U012').accessToken;
    const salesB = issueTokens('U013').accessToken;
    const staff = issueTokens('U001').accessToken;
    async function call(path: string, token: string, method = 'GET', body?: unknown) {
      const res = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() as { data?: any; message?: string } };
    }

    const list = await call('/business/receipt-notifications', salesA);
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].docNo, 'REC-TEST-0001');
    assert.equal(list.body.data[0].lineCount, 2);
    assert.equal(list.body.data[0].isRead, false);
    const notificationId = list.body.data[0].id;
    assert.equal((await call('/business/receipt-notifications/unread-count', salesA)).body.data.count, 1);
    const detail = await call(`/business/receipt-notifications/${notificationId}`, salesA);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.lines.length, 2);
    assert.equal(detail.body.data.lines[0].noteNo, 'NOTE-1');
    assert.equal(detail.body.data.orgName, '江西优科工业材料有限公司');
    assert.equal((await call(`/business/receipt-notifications/${notificationId}`, salesB)).status, 404);
    assert.deepEqual((await call('/business/receipt-notifications', salesB)).body.data, []);
    assert.equal((await call('/business/receipt-notifications', staff)).status, 403);
    assert.equal((await call(`/business/receipt-notifications/${notificationId}/read`, salesA, 'POST', {})).status, 200);
    assert.equal((await call('/business/receipt-notifications/unread-count', salesA)).body.data.count, 0);
    await pool.execute("UPDATE employees SET position='员工' WHERE id='U012'");
    assert.equal((await call('/business/receipt-notifications', salesA)).status, 403);
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
