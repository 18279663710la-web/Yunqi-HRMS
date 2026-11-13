import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('u9RawQueries 源码不含 JOIN（硬性抽取约束）', () => {
  const file = path.join(__dirname, '../src/domains/u9/etl/u9RawQueries.ts');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  // 匹配 SQL 关联关键字，避免误伤 Array.prototype.join
  assert.equal(
    /(?:\s|^)(?:LEFT|RIGHT|INNER|OUTER|CROSS|FULL)?\s*JOIN\s+/i.test(source),
    false,
    'u9RawQueries.ts 的可执行 SQL 不得包含表关联'
  );
});
