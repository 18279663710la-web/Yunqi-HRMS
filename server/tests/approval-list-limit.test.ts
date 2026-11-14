import assert from 'node:assert/strict';
import test from 'node:test';
import type { CurrentUser } from '../src/shared/types/models';
import { getApprovalList } from '../src/domains/approvals/approvalService';

test('审批列表条数只接受 1 到 100 的整数', async () => {
  const user = { id: 'U001' } as CurrentUser;
  await assert.rejects(() => getApprovalList('pending', user, 0), /列表条数无效/);
  await assert.rejects(() => getApprovalList('pending', user, 101), /列表条数无效/);
  await assert.rejects(() => getApprovalList('pending', user, 1.5), /列表条数无效/);
});

test('审批列表页码必须是正整数，每页 1 到 100 条', async () => {
  const user = { id: 'U001' } as CurrentUser;
  await assert.rejects(() => getApprovalList('pending', user, { page: 0 }), /列表页码无效/);
  await assert.rejects(() => getApprovalList('pending', user, { page: 1.5 }), /列表页码无效/);
  await assert.rejects(() => getApprovalList('pending', user, { page: 1, pageSize: 0 }), /列表条数无效/);
  await assert.rejects(() => getApprovalList('pending', user, { page: 1, pageSize: 101 }), /列表条数无效/);
  await assert.rejects(() => getApprovalList('pending', user, { pageSize: 20 }), /列表页码无效/);
});
