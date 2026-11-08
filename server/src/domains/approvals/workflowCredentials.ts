import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config';

function masterKey(allowCreate: boolean): Buffer {
  const configured = process.env.WORKFLOW_CREDENTIAL_KEY?.trim();
  if (configured) {
    if (!/^[0-9a-f]{64}$/i.test(configured)) throw new Error('流程凭据加密密钥配置无效');
    return Buffer.from(configured, 'hex');
  }
  const file = process.env.WORKFLOW_CREDENTIAL_KEY_FILE?.trim() ? path.resolve(process.env.WORKFLOW_CREDENTIAL_KEY_FILE.trim()) : path.join(config.serverRoot, '.runtime', 'workflow-credential-key');
  const dir = path.dirname(file);
  if (!fs.existsSync(file)) {
    if (!allowCreate) throw new Error('流程凭据加密密钥丢失，请恢复原密钥');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const key = fs.readFileSync(file);
  if (key.length !== 32) throw new Error('流程凭据加密密钥无效');
  return key;
}

export function encryptWorkflowCredential(apiKey: string, nodeId: string, allowCreate: boolean): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(allowCreate), nonce);
  cipher.setAAD(Buffer.from(`expense:${nodeId}`, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptWorkflowCredential(encryptedKey: string, nodeId: string): string {
  const [version, nonce, tag, data, extra] = encryptedKey.split(':');
  if (version !== 'v1' || !nonce || !tag || !data || extra !== undefined) throw new Error('流程凭据格式无效');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(false), Buffer.from(nonce, 'base64'));
  decipher.setAAD(Buffer.from(`expense:${nodeId}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
