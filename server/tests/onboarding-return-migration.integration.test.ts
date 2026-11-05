import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
test('迁移已打回待填写申请，保留旧模板快照并使用当前模板且可重复执行', async () => {
 const database = `yunqi_return_migration_${randomBytes(6).toString('hex')}`;
 const conn = await mysql.createConnection({host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||''}); let created=false; let closePool:(()=>Promise<void>)|undefined;
 try {
  await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created=true; process.env.MYSQL_DATABASE=database;
  const pool=await import('../src/shared/db/pool');closePool=pool.closePool;await pool.ensureSchema();
  const [col]=await conn.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name='hr_self_onboarding_submissions' AND column_name='template_json'`,[database]);
  if ((col as unknown[]).length) await conn.query(`ALTER TABLE \`${database}\`.hr_self_onboarding_submissions DROP COLUMN template_json`);
  const old=[{name:'性别',type:'text',required:true}]; const current=[{name:'性别',type:'select',required:true,options:['男','女']}];
  await conn.query(`INSERT INTO \`${database}\`.hr_onboarding_form_templates (id,name,fields_json,version,created_at,updated_at) VALUES (1,'现用',?,1,NOW(),NOW())`,[JSON.stringify(current)]);
  await conn.query(`INSERT INTO \`${database}\`.hr_settings (setting_key,value_json,updated_at) VALUES ('self_onboarding_default',?,NOW())`,[JSON.stringify(1)]);
  await conn.query(`INSERT INTO \`${database}\`.hr_self_onboarding (id,employee_id,expected_date,template_json,answers_json,created_at,submitted_at) VALUES (1,'T001','2026-11-10',?,?,NOW(),NULL),(2,'T002','2026-11-10',?,?,NOW(),NULL)`,[JSON.stringify(old),JSON.stringify({性别:'男'}),JSON.stringify(old),null]);
  await conn.query(`INSERT INTO \`${database}\`.hr_self_onboarding_submissions (onboarding_id,answers_json,submitted_at,returned_at,admin_id,admin_name) VALUES (1,?,NOW(),NOW(),1,'管理员')`,[JSON.stringify({性别:'男'})]);
  await pool.ensureSchema(); await pool.ensureSchema();
  const [h]=await conn.query(`SELECT template_json FROM \`${database}\`.hr_self_onboarding_submissions WHERE onboarding_id=1`); const decode=(x:any)=>typeof x==='string'?JSON.parse(x):x;
  assert.deepEqual(decode((h as any[])[0].template_json),old);
  const [rows]=await conn.query(`SELECT id,template_json FROM \`${database}\`.hr_self_onboarding ORDER BY id`);
  assert.deepEqual(decode((rows as any[])[0].template_json),current); assert.deepEqual(decode((rows as any[])[1].template_json),old);
 } finally {if(closePool) await closePool();if(created) await conn.query(`DROP DATABASE \`${database}\``);await conn.end();}
});
