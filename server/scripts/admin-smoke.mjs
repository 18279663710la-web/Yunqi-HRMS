/**
 * Web 管理后台接口冒烟测试。
 * 用法：先 npm run dev，再 npm run smoke:admin
 * 会创建测试员工/测试管理员；跑完建议执行 npm run db:reset 清理。
 */
const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3100';
let token = '';
let failed = 0;

async function raw(path, options = {}, useToken = true) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(useToken && token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function api(path, options = {}) {
  const res = await raw(path, options);
  if (res.status < 200 || res.status >= 300 || !res.body || res.body.code !== 0) {
    throw new Error(`${options.method || 'GET'} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);
  if (!cond) failed += 1;
}

function pastWorkday() {
  const d = new Date();
  for (let i = 1; i <= 14; i += 1) {
    const x = new Date(d.getTime() - i * 86400000);
    const w = x.getDay();
    if (w !== 0 && w !== 6) {
      const p = (n) => String(n).padStart(2, '0');
      return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
    }
  }
  return '';
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const login = await api('/api/admin/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
});
token = login.token;
check('管理员登录', !!token && login.admin.role === 'super_admin', login.admin.name);

const adminAsEmployee = await raw('/api/me');
check('管理员 token 不能访问员工接口', adminAsEmployee.status === 401, String(adminAsEmployee.status));

const dashboard = await api('/api/admin/dashboard');
check('仪表盘', dashboard.employeeCount >= 26 && typeof dashboard.today.checkedIn === 'number', JSON.stringify(dashboard.today));

const tree = await api('/api/admin/departments');
check('部门树', tree.length === 1 && tree[0].total >= 26);
check('员工下拉', (await api('/api/admin/employees/options')).length >= 26);
check('员工列表', (await api('/api/admin/employees?page=1&pageSize=5')).list.length === 5);

const jobCategories = await api('/api/admin/job-categories');
const categoryTotal = jobCategories.reduce((sum, group) => sum + group.count, 0);
check('职位分类', jobCategories.length === 3 && categoryTotal === dashboard.employeeCount, JSON.stringify(jobCategories.map((g) => `${g.name}:${g.count}`)));

const created = await api('/api/admin/employees', {
  method: 'POST',
  body: JSON.stringify({
    name: '测试员工',
    pinyin: 'ceshiyuangong',
    gender: '男',
    deptId: 'D02',
    position: '测试工程师',
    jobCategory: '研发员',
    level: 'P5',
    employeeNo: 'TEST001',
    phone: '13900001111',
    email: 'test@yunqi-tech.com',
    joinDate: today(),
    isLeader: false,
    seat: '12F-Z-001',
    leaderId: 'U005',
    account: { loginName: 'test.user', password: 'Test123456', status: 'active' },
  }),
});
check('创建员工+账号', created.id.startsWith('U') && created.account.loginName === 'test.user', created.id);

const found = await api('/api/admin/employees?keyword=TEST001');
check('搜索新员工', found.total === 1 && found.list[0].name === '测试员工');

const empLogin = await api('/api/auth/password-login', {
  method: 'POST',
  body: JSON.stringify({ loginName: 'test.user', password: 'Test123456' }),
});
check('员工账号密码登录', !!empLogin.accessToken && empLogin.user.id === created.id);

const adminWithEmpToken = await raw('/api/admin/dashboard', {}, true);
// 用员工 token 覆盖调用：raw 默认带当前 token（管理员），这里手动验证
const employeeTokenRes = await fetch(BASE + '/api/admin/dashboard', {
  headers: { Authorization: `Bearer ${empLogin.accessToken}` },
});
check('员工 token 不能访问后台', employeeTokenRes.status === 401, String(employeeTokenRes.status));

const updated = await api(`/api/admin/employees/${created.id}`, {
  method: 'PUT',
  body: JSON.stringify({
    name: '测试员工',
    pinyin: 'ceshiyuangong',
    gender: '男',
    deptId: 'D02',
    position: '高级测试工程师',
    level: 'P6',
    employeeNo: 'TEST001',
    phone: '13900001111',
    email: 'test@yunqi-tech.com',
    joinDate: today(),
    isLeader: false,
    seat: '12F-Z-001',
    leaderId: 'U005',
  }),
});
check('修改员工', updated.position === '高级测试工程师');

let res = await api(`/api/admin/employees/${created.id}/account/status`, {
  method: 'PATCH',
  body: JSON.stringify({ status: 'disabled' }),
});
check('禁用员工账号', res.account.status === 'disabled');
const disabledLogin = await raw('/api/auth/password-login', {
  method: 'POST',
  body: JSON.stringify({ loginName: 'test.user', password: 'Test123456' }),
}, false);
check('禁用后无法登录', disabledLogin.status === 403);

await api(`/api/admin/employees/${created.id}/account/status`, {
  method: 'PATCH',
  body: JSON.stringify({ status: 'active' }),
});
await api(`/api/admin/employees/${created.id}/account/reset-password`, {
  method: 'POST',
  body: JSON.stringify({ password: 'Test654321' }),
});
const newLogin = await api('/api/auth/password-login', {
  method: 'POST',
  body: JSON.stringify({ loginName: 'test.user', password: 'Test654321' }),
});
check('重置密码后可登录', newLogin.user.id === created.id);

const month = today().slice(0, 7);
let attendance = await api(`/api/admin/attendance?month=${month}&employeeId=${created.id}`);
check('新员工考勤列表', attendance.list.length > 0 && attendance.list.every((r) => ['absent', 'none', 'rest'].includes(r.status)));

const corrected = await api('/api/admin/attendance/punch', {
  method: 'POST',
  body: JSON.stringify({
    employeeId: created.id,
    date: today(),
    checkIn: '09:10',
    checkOut: '18:20',
    note: '后台补卡',
  }),
});
check('今日补卡', corrected.checkIn === '09:10' && corrected.checkOut === '18:20' && corrected.status === 'normal');

const workday = pastWorkday();
const leave = await api('/api/admin/attendance/punch', {
  method: 'POST',
  body: JSON.stringify({ employeeId: created.id, date: workday, statusOverride: 'leave', note: '年假' }),
});
check('历史请假', leave.status === 'leave' && leave.statusText === '请假');

attendance = await api(`/api/admin/attendance?month=${month}&employeeId=${created.id}`);
check('考勤数据已更新', attendance.list.some((r) => r.date === today() && r.checkIn === '09:10') && attendance.list.some((r) => r.date === workday && r.status === 'leave'));

const hr = await api('/api/admin/admins', {
  method: 'POST',
  body: JSON.stringify({ username: 'hr_test', password: 'Hr123456', name: '测试HR', role: 'hr_admin' }),
});
check('创建管理员', hr.username === 'hr_test' && hr.role === 'hr_admin');
check('管理员列表', (await api('/api/admin/admins')).some((a) => a.username === 'hr_test'));

const hrLogin = await api('/api/admin/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'hr_test', password: 'Hr123456' }),
});
const hrToken = hrLogin.token;
const hrDashboard = await fetch(BASE + '/api/admin/dashboard', { headers: { Authorization: `Bearer ${hrToken}` } });
check('HR 管理员可访问仪表盘', hrDashboard.status === 200);
const hrAdmins = await fetch(BASE + '/api/admin/admins', { headers: { Authorization: `Bearer ${hrToken}` } });
check('HR 不能管理管理员', hrAdmins.status === 403, String(hrAdmins.status));

token = hrToken;
await api('/api/admin/auth/change-password', {
  method: 'POST',
  body: JSON.stringify({ oldPassword: 'Hr123456', newPassword: 'Hr654321' }),
});
const hrNewLogin = await api('/api/admin/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'hr_test', password: 'Hr654321' }),
});
check('管理员修改密码', !!hrNewLogin.admin && hrNewLogin.admin.username === 'hr_test');

token = login.token;
await api(`/api/admin/admins/${hr.id}/status`, {
  method: 'PATCH',
  body: JSON.stringify({ status: false }),
});
const disabledAdminLogin = await raw('/api/admin/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'hr_test', password: 'Hr654321' }),
}, false);
check('禁用管理员后无法登录', disabledAdminLogin.status === 403);

const logs = await api('/api/admin/logs?limit=50');
check('操作日志', Array.isArray(logs) && logs.some((l) => l.action === '创建员工'));

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
