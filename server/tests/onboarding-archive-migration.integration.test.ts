import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
test('旧入职申请表增量增加封存字段并保留已有申请', async () => {
 const database=`yunqi_archive_migration_${randomBytes(6).toString('hex')}`;
 const conn=await mysql.createConnection({host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||''}); let created=false; let closePool:(()=>Promise<void>)|undefined;
 try {
  await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);created=true;
  await conn.query(`CREATE TABLE \`${database}\`.hr_self_onboarding (id BIGINT PRIMARY KEY AUTO_INCREMENT,employee_id VARCHAR(10) NOT NULL,expected_date DATE NOT NULL,template_json JSON NOT NULL,answers_json JSON NULL,created_at DATETIME NOT NULL,submitted_at DATETIME NULL, UNIQUE KEY uk_self_onboarding_employee (employee_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const fields=[{name:'姓名',type:'text',required:true}], answers={姓名:'历史员工'};
  await conn.query(`INSERT INTO \`${database}\`.hr_self_onboarding (employee_id,expected_date,template_json,answers_json,created_at,submitted_at) VALUES ('U001','2026-11-01',?,?,NOW(),NOW())`,[JSON.stringify(fields),JSON.stringify(answers)]);
  process.env.MYSQL_DATABASE=database;const pool=await import('../src/shared/db/pool');closePool=pool.closePool;await pool.ensureSchema();await pool.ensureSchema();
  const [rows]=await conn.query(`SELECT template_json,answers_json,submitted_at,archived_at,archived_by FROM \`${database}\`.hr_self_onboarding WHERE employee_id='U001'`);const row=(rows as any[])[0];const decode=(x:any)=>typeof x==='string'?JSON.parse(x):x;
  assert.deepEqual(decode(row.template_json),fields);assert.deepEqual(decode(row.answers_json),answers);assert.ok(row.submitted_at);assert.equal(row.archived_at,null);assert.equal(row.archived_by,null);
 } finally {if(closePool) await closePool();if(created) await conn.query(`DROP DATABASE \`${database}\``);await conn.end();}
});
