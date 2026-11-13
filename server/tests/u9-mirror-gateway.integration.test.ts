import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';

test('mirrorGateway 从镜像表返回应收与收款口径', async () => {
  const database = `yunqi_u9_mirror_${randomBytes(8).toString('hex')}`;
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
    process.env.U9_QUERY_SOURCE = 'mysql';
    const pool = await import('../src/shared/db/pool');
    closePool = pool.closePool;
    await pool.ensureSchema();
    await pool.execute(
      `INSERT INTO u9_mirror_ar_heads
        (id,doc_no,customer_id,customer_name,business_date,post_period,src_org,invoice_date,invoice_num,
         currency_name,currency_precision,doc_status,synced_at)
       VALUES ('201','AR-201','C1','测试客户','2026-11-10','2026-11','一部','2026-11-10','INV',
         '人民币',2,2,NOW())`
    );
    await pool.execute(
      `INSERT INTO u9_mirror_ar_lines
        (id,doc_id,seller_operator_id,line_num,src_ship_no,src_line_num,item_name,item_code,uom,qty,
         non_tax_price,tax_price,non_tax_amount,tax_amount,tax_included_total,total_amount,total_balance,
         own_amount,biz_org,maturity,line_status,synced_at)
       VALUES ('L1','201','101',10,'SM1',10,'料','YK','KG','1.0000','1.0000','1.1300','1.00','0.13',
         '1.13','1.13','1.13','1.13','一部','2026-12-01','',NOW())`
    );
    await pool.execute(
      `INSERT INTO u9_mirror_rec_heads
        (id,doc_no,customer_id,customer_name,business_date,post_period,org_id,org_code,org_name,
         transactor_id,total_amount,currency_name,currency_precision,doc_status,synced_at)
       VALUES ('301','REC-301','C1','测试客户','2026-11-12','2026-11','1','001','一部',
         '101','100.00','人民币',2,2,NOW())`
    );
    await pool.execute(
      `INSERT INTO u9_mirror_rec_lines
        (id,doc_id,line_num,settlement_method,note_no,amount,bank_account,synced_at)
       VALUES ('RL1','301',10,'票据','N1','100.00','中国银行',NOW())`
    );
    await pool.execute(
      `INSERT INTO u9_mirror_rec_sellers (doc_id,seller_operator_id,own_amount,synced_at)
       VALUES ('301','101','100.00',NOW())`
    );
    await pool.execute(
      `INSERT INTO u9_mirror_operators (id,code,name,org_id,org_name,synced_at)
       VALUES ('101','A','业务员甲','1','一部',NOW())`
    );

    const { mirrorU9 } = await import('../src/domains/u9/mirrorGateway');
    const list = await mirrorU9.listReceivableDocuments('101', 1, { period: '2026-11' });
    assert.equal(list.length, 1);
    assert.equal(list[0].docNo, 'AR-201');
    assert.equal(list[0].lines[0].srcShipNo, 'SM1');

    const other = await mirrorU9.listReceivableDocuments('999', 1, { period: '2026-11' });
    assert.equal(other.length, 0);

    const receipt = await mirrorU9.getReceiptDocument('101', '301');
    assert.ok(receipt);
    assert.equal(receipt!.docNo, 'REC-301');
    assert.equal(receipt!.lines[0].noteNo, 'N1');

    const notices = await mirrorU9.listReceiptsForNotification('2026-11-01', '001');
    assert.equal(notices.length, 1);
    assert.equal(notices[0].transactorId, '101');
  } finally {
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
