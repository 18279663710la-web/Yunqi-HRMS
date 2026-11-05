/**
 * 后端接口冒烟测试（Node 18+ 内置 fetch）
 * 用法：先 npm run dev，再另开终端 npm run smoke
 * 只检查现有审批数据，不创建或重置审批单。其他接口可能写入已读记录和查验缓存。
 */
const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3100';
let token = '';
let failed = 0;

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.code !== 0) {
    throw new Error(`${options.method || 'GET'} ${path} -> ${res.status} ${JSON.stringify(body)}`);
  }
  return body.data;
}

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);
  if (!cond) failed += 1;
}

const login = await api('/api/auth/password-login', {
  method: 'POST',
  body: JSON.stringify({ loginName: 'chenyiran', password: 'Yunqi@123456' }),
});
token = login.accessToken;
check('员工账号登录', !!token && login.user.name === '陈亦然', login.user.deptName);

const [me, company, actions, types, tree, flat, groups, emp, today, records, stats] = await Promise.all([
  api('/api/me'),
  api('/api/company'),
  api('/api/quick-actions'),
  api('/api/approval-types'),
  api('/api/departments/tree'),
  api('/api/departments'),
  api('/api/employees/groups?deptId=D02'),
  api('/api/employees/U001'),
  api('/api/attendance/today'),
  api('/api/attendance/records?days=14'),
  api('/api/attendance/stats'),
]);
check('当前用户', me.id === 'U001');
check('公司信息', company.name === '云启科技有限公司');
check('快捷入口', actions.length === 8);
check('审批类型', types.length === 5);
check('部门树', tree.length === 1 && tree[0].total >= 1);
check('部门扁平列表', flat.length === 13);
check('通讯录分组', groups.length > 0);
check('员工详情/汇报关系', emp.leader && emp.leader.id === 'U005');
check('今日考勤', !!today.nextType);
check('考勤记录', records.length === 14);
check('考勤统计', typeof stats.avgHours === 'string');

const counts = await api('/api/approvals/counts');
const pending = await api('/api/approvals?tab=pending');
const mine = await api('/api/approvals?tab=mine');
const done = await api('/api/approvals?tab=done');
check('审批数量', pending.length === counts.pending && mine.length === counts.mine && done.length === counts.done);
if (pending.length) check('审批详情', !!(await api('/api/approvals/' + pending[0].id)).timeline.length);

const notices = await api('/api/notices');
const unreadBefore = await api('/api/notices/unread-count');
const notice = await api('/api/notices/N002');
const unreadAfter = await api('/api/notices/unread-count');
check('公告列表', notices.length === 6);
check('公告详情 + 已读回执', notice.isRead === true);
check('未读数变化', unreadAfter <= unreadBefore);
check('待办汇总', typeof (await api('/api/todo-stats')).pending === 'number');

const dup = await api('/api/invoices/duplicate', {
  method: 'POST',
  body: JSON.stringify({ invoice: { invoiceCode: '031001900111', invoiceNumber: '24318871' } }),
});
check('发票查重', typeof dup.duplicated === 'boolean' && typeof dup.blocking === 'boolean');
const verify = await api('/api/invoices/verify', {
  method: 'POST',
  body: JSON.stringify({
    invoice: {
      invoiceType: '增值税电子普通发票',
      invoiceNumber: '08812459',
      invoiceDate: '2026-10-08',
      checkCode: '0718223100458812',
    },
  }),
});
check('发票查验（尾号 9 查无此票）', verify.status === 'notFound');
check('发票驱动信息', (await api('/api/invoices/meta')).ocrDriver === 'mock');

const back = await api('/api/auth/password-login', {
  method: 'POST',
  body: JSON.stringify({ loginName: 'chenyiran', password: 'Yunqi@123456' }),
});
token = back.accessToken;
const refresh = await api('/api/auth/refresh', {
  method: 'POST',
  body: JSON.stringify({ refreshToken: back.refreshToken }),
});
check('刷新 Token', !!refresh.accessToken && refresh.user.id === 'U001');

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
