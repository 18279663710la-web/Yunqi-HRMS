import { queryRows } from '../../shared/db/pool';
import { CHAIRPERSON_ID, getChairpersonUser } from '../accounts/chairpersonService';
import type {
  Company,
  CurrentUser,
  DepartmentFlat,
  DepartmentNode,
  Employee,
  EmployeeDetail,
  EmployeeGroup,
  EmployeeListItem,
} from '../../shared/types/models';

interface CompanyRow {
  name: string;
  short_name: string;
  logo_text: string;
  address: string;
  work_time: string;
  flexible: string;
}

interface DepartmentRow {
  id: string;
  parent_id: string | null;
  name: string;
  leader_id: string | null;
  sort_order: number;
}

interface EmployeeRow {
  id: string;
  name: string;
  pinyin: string;
  gender: string | null;
  dept_id: string;
  position: string;
  level: string;
  employee_no: string;
  phone: string;
  email: string;
  join_date: string;
  is_leader: number;
  seat: string;
  leader_id: string | null;
  departed: number;
}

export async function getCompany(): Promise<Company> {
  const [row] = await queryRows<CompanyRow>('SELECT * FROM companies ORDER BY id LIMIT 1');
  if (!row) throw new Error('公司信息未初始化，请先执行 npm run db:setup');
  return {
    name: row.name,
    shortName: row.short_name,
    logoText: row.logo_text,
    address: row.address,
    workTime: row.work_time,
    flexible: row.flexible,
  };
}

async function loadDepartments(): Promise<DepartmentRow[]> {
  return queryRows<DepartmentRow>('SELECT * FROM departments ORDER BY sort_order, id');
}

async function loadEmployees(jobTitle?: string): Promise<EmployeeRow[]> {
  return queryRows<EmployeeRow>(`SELECT e.*, EXISTS(SELECT 1 FROM hr_employee_departures d WHERE d.employee_id = e.id AND d.status = 'departed') AS departed FROM employees e ${jobTitle ? 'WHERE TRIM(e.position) = ?' : ''} ORDER BY e.pinyin`, jobTitle ? [jobTitle] : []);
}

function deptMapOf(rows: DepartmentRow[]): Map<string, DepartmentRow> {
  return new Map(rows.map((d) => [d.id, d]));
}

function employeeMapOf(rows: EmployeeRow[]): Map<string, EmployeeRow> {
  return new Map(rows.map((e) => [e.id, e]));
}

function deptFullName(dept: DepartmentRow | undefined, map: Map<string, DepartmentRow>): string {
  if (!dept) return '';
  const parent = dept.parent_id ? map.get(dept.parent_id) : undefined;
  if (parent && parent.id !== 'D00') return `${parent.name} · ${dept.name}`;
  return dept.name;
}

/**
 * 直属上级解析：
 *   1) employees.leader_id 显式指定
 *   2) 本部门负责人（不能是自己）
 *   3) 逐级向上找部门负责人（不能是自己）
 * 与原前端「切换演示账号」的兜底逻辑一致，并补齐了跨级兜底。
 */
function resolveLeader(
  employee: EmployeeRow,
  depts: Map<string, DepartmentRow>,
  employees: Map<string, EmployeeRow>
): EmployeeRow | null {
  if (employee.leader_id) {
    const explicit = employees.get(employee.leader_id);
    if (explicit && explicit.id !== employee.id) return explicit;
  }

  let dept = depts.get(employee.dept_id);
  const visited = new Set<string>();
  while (dept && !visited.has(dept.id)) {
    visited.add(dept.id);
    if (dept.leader_id && dept.leader_id !== employee.id) {
      const leader = employees.get(dept.leader_id);
      if (leader) return leader;
    }
    dept = dept.parent_id ? depts.get(dept.parent_id) : undefined;
  }
  return null;
}

function toEmployee(row: EmployeeRow, depts: Map<string, DepartmentRow>): Employee {
  const dept = depts.get(row.dept_id);
  return {
    id: row.id,
    name: row.name,
    pinyin: row.pinyin,
    gender: row.gender || undefined,
    deptId: row.dept_id,
    deptName: dept ? dept.name : '',
    position: row.position,
    level: row.level,
    employeeNo: row.employee_no,
    phone: row.phone,
    email: row.email,
    joinDate: row.join_date,
    isLeader: !!row.is_leader,
    jobCategory: row.position,
    seat: row.seat,
    leaderId: row.leader_id || undefined,
  };
}

function toListItem(row: EmployeeRow, depts: Map<string, DepartmentRow>): EmployeeListItem {
  return { ...toEmployee(row, depts), initial: row.name.slice(0, 1) };
}

export async function getCurrentUserById(employeeId: string): Promise<CurrentUser | null> {
  if (employeeId === CHAIRPERSON_ID) return getChairpersonUser();
  const [deptRows, empRows] = await Promise.all([loadDepartments(), loadEmployees()]);
  const depts = deptMapOf(deptRows);
  const employees = employeeMapOf(empRows.filter((employee) => !employee.departed));
  const row = employees.get(employeeId);
  if (!row) return null;

  const dept = depts.get(row.dept_id);
  const leader = resolveLeader(row, depts, employees);

  return {
    ...toEmployee(row, depts),
    deptName: deptFullName(dept, depts),
    leaderId: leader ? leader.id : '',
    leaderName: leader ? leader.name : '—',
  };
}

function collectDeptIds(deptId: string, rows: DepartmentRow[]): Set<string> {
  const ids = new Set<string>([deptId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of rows) {
      if (d.parent_id && ids.has(d.parent_id) && !ids.has(d.id)) {
        ids.add(d.id);
        changed = true;
      }
    }
  }
  return ids;
}

export async function getEmployeeList(params: { deptId?: string; keyword?: string; jobTitle?: string } = {}): Promise<EmployeeListItem[]> {
  const [deptRows, empRows] = await Promise.all([loadDepartments(), loadEmployees(params.jobTitle)]);
  const depts = deptMapOf(deptRows);
  let rows = empRows.filter((employee) => !employee.departed);

  const deptId = params.deptId || '';
  if (deptId) {
    const ids = collectDeptIds(deptId, deptRows);
    rows = rows.filter((e) => ids.has(e.dept_id));
  }

  const keyword = String(params.keyword || '').trim().toLowerCase();
  if (keyword) {
    rows = rows.filter(
      (e) =>
        e.name.toLowerCase().includes(keyword) ||
        e.pinyin.includes(keyword) ||
        e.position.toLowerCase().includes(keyword) ||
        e.phone.includes(keyword)
    );
  }

  return rows
    .slice()
    .sort((a, b) => {
      if (a.is_leader !== b.is_leader) return a.is_leader ? -1 : 1;
      return a.pinyin.localeCompare(b.pinyin);
    })
    .map((row) => toListItem(row, depts));
}

export async function getEmployeeGroups(params: { deptId?: string; keyword?: string; jobTitle?: string } = {}): Promise<EmployeeGroup[]> {
  const list = await getEmployeeList(params);
  const groups = new Map<string, EmployeeListItem[]>();
  for (const emp of list) {
    const letter = (emp.pinyin[0] || '#').toUpperCase();
    const bucket = groups.get(letter);
    if (bucket) bucket.push(emp);
    else groups.set(letter, [emp]);
  }
  return Array.from(groups.keys())
    .sort()
    .map((letter) => ({ letter, list: groups.get(letter) as EmployeeListItem[] }));
}

export async function getEmployeeDetail(id: string): Promise<EmployeeDetail | null> {
  const [deptRows, empRows] = await Promise.all([loadDepartments(), loadEmployees()]);
  const depts = deptMapOf(deptRows);
  const employees = employeeMapOf(empRows.filter((employee) => !employee.departed));
  const row = employees.get(id);
  if (!row) return null;

  const dept = depts.get(row.dept_id);
  const leader = resolveLeader(row, depts, employees);
  const subordinates = empRows.filter((employee) => !employee.departed)
    .filter((e) => e.id !== row.id)
    .map((e) => ({ row: e, leader: resolveLeader(e, depts, employees) }))
    .filter((x) => x.leader && x.leader.id === row.id)
    .map((x) => toListItem(x.row, depts));

  return {
    ...toListItem(row, depts),
    deptFullName: deptFullName(dept, depts),
    leader: leader ? { id: leader.id, name: leader.name, position: leader.position } : null,
    leaderInitial: leader ? leader.name.slice(0, 1) : '',
    subordinates,
  };
}

export async function getDepartmentTree(): Promise<DepartmentNode[]> {
  const [deptRows, empRows] = await Promise.all([loadDepartments(), loadEmployees()]);
  const map = deptMapOf(deptRows);
  const nodes = new Map<string, DepartmentNode>();

  for (const d of deptRows) {
    nodes.set(d.id, {
      id: d.id,
      parentId: d.parent_id || '',
      name: d.name,
      leaderId: d.leader_id || '',
      order: d.sort_order,
      children: [],
      count: 0,
      total: 0,
    });
  }

  for (const e of empRows.filter((employee) => !employee.departed)) {
    const node = nodes.get(e.dept_id);
    if (node) node.count += 1;
  }

  const roots: DepartmentNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? map.get(node.parentId) : undefined;
    if (parent && nodes.has(parent.id)) nodes.get(parent.id)?.children.push(node);
    else roots.push(node);
  }

  const sortRec = (list: DepartmentNode[]): void => {
    list.sort((a, b) => a.order - b.order);
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);

  const rollup = (node: DepartmentNode): number => {
    let total = node.count;
    node.children.forEach((child) => {
      total += rollup(child);
    });
    node.total = total;
    return total;
  };
  roots.forEach(rollup);

  return roots;
}

export async function getDepartmentList(): Promise<DepartmentFlat[]> {
  const roots = await getDepartmentTree();
  const flat: DepartmentFlat[] = [];
  const walk = (list: DepartmentNode[], depth: number): void => {
    list.forEach((n) => {
      flat.push({ id: n.id, name: n.name, depth, total: n.total, leaderId: n.leaderId });
      walk(n.children, depth + 1);
    });
  };
  walk(roots, 0);
  return flat;
}
