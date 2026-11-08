import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decryptWorkflowCredential, encryptWorkflowCredential } from '../src/domains/approvals/workflowCredentials';

test('本地加密密钥跨调用保留，密文绑定节点且丢失密钥时不自动重建', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-credential-test-'));
  const file = path.join(dir, 'key');
  const previousKey = process.env.WORKFLOW_CREDENTIAL_KEY;
  const previousFile = process.env.WORKFLOW_CREDENTIAL_KEY_FILE;
  delete process.env.WORKFLOW_CREDENTIAL_KEY;
  process.env.WORKFLOW_CREDENTIAL_KEY_FILE = file;
  try {
    const first = encryptWorkflowCredential('test-only-key', 'node-1', true);
    assert.ok(!first.includes('test-only-key'));
    assert.equal(decryptWorkflowCredential(first, 'node-1'), 'test-only-key');
    assert.throws(() => decryptWorkflowCredential(first, 'node-2'));
    const second = encryptWorkflowCredential('test-only-key', 'node-1', false);
    assert.notEqual(first, second);
    fs.unlinkSync(file);
    assert.throws(() => encryptWorkflowCredential('replacement', 'node-1', false), /丢失/);
    assert.equal(fs.existsSync(file), false);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
    if (previousKey === undefined) delete process.env.WORKFLOW_CREDENTIAL_KEY; else process.env.WORKFLOW_CREDENTIAL_KEY = previousKey;
    if (previousFile === undefined) delete process.env.WORKFLOW_CREDENTIAL_KEY_FILE; else process.env.WORKFLOW_CREDENTIAL_KEY_FILE = previousFile;
  }
});
