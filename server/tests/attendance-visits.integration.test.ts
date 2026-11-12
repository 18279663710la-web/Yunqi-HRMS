import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test('拜访记录按员工隔离，照片必填且管理端可按员工和关键字查询', async (t) => {
  const database = `yunqi_visit_test_${randomBytes(8).toString('hex')}`;
  assert.match(database, /^yunqi_visit_test_[0-9a-f]{16}$/);
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
  });
  let databaseCreated = false;
  let closePool: (() => Promise<void>) | undefined;
  let closeServer: (() => Promise<void>) | undefined;
  try {
    process.env.TENCENT_MAP_KEY = '';
    process.env.VITE_TENCENT_MAP_KEY = '';
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    databaseCreated = true;
    process.env.MYSQL_DATABASE = database;

    const poolModule = await import('../src/shared/db/pool');
    closePool = poolModule.closePool;
    await poolModule.ensureSchema();
    const { seedDatabase } = await import('../src/shared/db/seed');
    await seedDatabase();
    const { ensureDefaultAdmin } = await import('../src/admin/admin-accounts/adminAuthService');
    await ensureDefaultAdmin();
    const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const { config } = await import('../src/config');
    const { createApp } = await import('../src/app');
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });

    async function request(path: string, token: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, payload: await response.json() as { data?: any; message?: string } };
    }

    async function uploadPhoto(token: string, mime = 'image/png', name = 'visit.png', content: Buffer = PNG) {
      const form = new FormData();
      form.append('file', new Blob([content], { type: mime }), name);
      const response = await fetch(base + '/attendance/visits/photos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      return { status: response.status, payload: await response.json() as { data?: any; message?: string } };
    }

    const owner = issueTokens('U010').accessToken;
    const other = issueTokens('U011').accessToken;

    const geocode = await request('/attendance/visits/location?latitude=23.13&longitude=113.26', owner);
    assert.equal(geocode.status, 200);
    assert.equal(geocode.payload.data.name, '当前位置');
    assert.equal(geocode.payload.data.address, '当前位置');
    assert.equal(geocode.payload.data.resolved, false);

    const photo = await uploadPhoto(owner);
    assert.equal(photo.status, 200);
    assert.ok(photo.payload.data.id);

    const createBody = {
      customerName: '测试客户',
      purpose: '方案沟通',
      addressName: '测试大厦',
      address: '测试路 1 号',
      latitude: 23.13,
      longitude: 113.26,
      accuracy: 15,
      remark: '自动化验证',
      photoIds: [photo.payload.data.id],
    };
    const createdVisit = await request('/attendance/visits', owner, 'POST', createBody);
    assert.equal(createdVisit.status, 200);
    assert.equal(createdVisit.payload.data.customerName, '测试客户');
    assert.equal(createdVisit.payload.data.photoCount, 1);
    assert.equal(createdVisit.payload.data.photoIds.length, 1);

    const mine = await request('/attendance/visits', owner);
    assert.equal(mine.status, 200);
    assert.equal(mine.payload.data.list.length, 1);
    assert.equal(mine.payload.data.list[0].employeeId, 'U010');

    const otherMine = await request('/attendance/visits', other);
    assert.equal(otherMine.payload.data.list.length, 0);

    const otherPhoto = await fetch(`${base}/attendance/visits/photos/${photo.payload.data.id}`, {
      headers: { Authorization: `Bearer ${other}` },
    });
    assert.equal(otherPhoto.status, 404);

    const adminList = await request('/admin/attendance/visits?keyword=' + encodeURIComponent('测试客户'), admin);
    assert.equal(adminList.status, 200);
    assert.equal(adminList.payload.data.total, 1);
    assert.equal(adminList.payload.data.list[0].employeeId, 'U010');
    assert.equal(adminList.payload.data.list[0].employeeName, '吴静婷');

    const filteredEmpty = await request('/admin/attendance/visits?employeeId=U011', admin);
    assert.equal(filteredEmpty.payload.data.total, 0);

    const adminPhoto = await fetch(`${base}/admin/attendance/visits/photos/${photo.payload.data.id}`, {
      headers: { Authorization: `Bearer ${admin}` },
    });
    assert.equal(adminPhoto.status, 200);
    assert.equal(adminPhoto.headers.get('content-type'), 'image/png');
    assert.equal((await adminPhoto.arrayBuffer()).byteLength, PNG.length);

    const missingPhoto = await request('/attendance/visits', owner, 'POST', { ...createBody, photoIds: [] });
    assert.equal(missingPhoto.status, 400);

    const wrongType = await uploadPhoto(owner, 'text/plain', 'visit.txt', Buffer.from('not an image'));
    assert.equal(wrongType.status, 400);

    const otherPhotoRef = await uploadPhoto(other);
    assert.equal(otherPhotoRef.status, 200);
    const stolenPhoto = await request('/attendance/visits', owner, 'POST', { ...createBody, photoIds: [otherPhotoRef.payload.data.id] });
    assert.equal(stolenPhoto.status, 400);

    // 快捷入口迁移：旧库的“公告通知”替换为“拜访登记”，公告页面本身保留。
    await connection.query(`DELETE FROM \`${database}\`.quick_actions WHERE \`key\` = 'visit'`);
    await connection.query(
      `INSERT INTO \`${database}\`.quick_actions (\`key\`, name, icon, color, url, is_tab, sort_order)
       VALUES ('notice', '公告通知', 'bell', '#F79009', '/pages/notice/notice', 0, 3)`
    );
    await connection.query(`DELETE FROM \`${database}\`.app_meta WHERE \`k\` = 'visit_quick_action_v1'`);
    const { migrateVisitQuickAction } = await import('../src/shared/db/quickActionMigration');
    await migrateVisitQuickAction();
    const [actions] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT \`key\`, name, url FROM \`${database}\`.quick_actions ORDER BY sort_order`
    );
    assert.equal(actions.some((action) => action.key === 'notice'), false);
    const visitAction = actions.find((action) => action.key === 'visit');
    assert.equal(visitAction?.name, '拜访登记');
    assert.equal(visitAction?.url, '/pages/visit/visit');
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (databaseCreated) await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.end();
  }
});
