import type { ApprovalStatus, AttendanceRecord, AttendanceSummary } from './models';

export type AdminRole = 'super_admin' | 'hr_admin';
export type AccountStatus = 'active' | 'disabled';
export type JobCategoryName = string;

export interface AdminUser {
  id: number;
  username: string;
  name: string;
  role: AdminRole;
  status: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface EmployeeAccount {
  employeeId: string;
  loginName: string;
  status: AccountStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminEmployee {
  id: string;
  employmentStatus: 'active' | 'departed';
  name: string;
  pinyin: string;
  gender?: string;
  deptId: string;
  deptName: string;
  position: string;
  level: string;
  employeeNo: string;
  phone: string;
  email: string;
  joinDate: string;
  isLeader: boolean;
  seat: string;
  leaderId: string;
  leaderName: string;
  jobCategory: JobCategoryName;
  account: EmployeeAccount | null;
}

export interface AdminEmployeeListResponse {
  list: AdminEmployee[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminDepartmentNode {
  id: string;
  parentId: string;
  name: string;
  leaderId: string;
  leaderName: string;
  order: number;
  count: number;
  total: number;
  children: AdminDepartmentNode[];
}

export interface AdminAttendanceRecord extends AttendanceRecord {
  overtimeMinutes?: number;
  overtimeCount?: number;
  overtimeSeconds?: number;
  overtimePeriods?: { checkIn: string; checkOut: string | null }[];
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  deptId: string;
  deptName: string;
  jobCategory: JobCategoryName;
  position: string;
  note?: string;
  source?: string;
  statusOverride?: 'leave' | 'absent' | 'rest' | null;
}

export interface AdminAttendanceEmployeeSummary extends AttendanceSummary {
  overtimeSeconds: number;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  deptName: string;
  jobCategory: JobCategoryName;
  presentDays: number;
  totalHours: number;
}

export interface AdminAttendanceResponse {
  month: string;
  startDate: string;
  endDate: string;
  list: AdminAttendanceRecord[];
  summary: AttendanceSummary;
  employeeSummary: AdminAttendanceEmployeeSummary[];
}

export interface AdminDashboard {
  employeeCount: number;
  activeAccountCount: number;
  departmentCount: number;
  pendingApprovalCount: number;
  monthApprovalCount: number;
  jobCategoryCounts: Array<{ name: JobCategoryName; count: number }>;
  today: {
    total: number;
    checkedIn: number;
    late: number;
    notChecked: number;
    rest: number;
    overtime: number;
    onLeave: number;
    onTravel: number;
  };
  recentEmployees: Array<{
    id: string;
    name: string;
    deptName: string;
    position: string;
    joinDate: string;
    accountStatus: AccountStatus | 'none';
  }>;
  recentNotices: Array<{
    id: string;
    title: string;
    categoryName: string;
    publisher: string;
    publishTime: string;
    summary: string;
    isTop: boolean;
    readCount: number;
    totalCount: number;
  }>;
}

export interface AdminOperationLog {
  id: number;
  adminId: number;
  adminName: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminLoginResponse {
  token: string;
  admin: AdminUser;
}

export interface AdminAccountItem extends AdminUser {
  canDisable: boolean;
}

export interface ApprovalCountsForAdmin {
  pending: number;
  mine: number;
  done: number;
}

export type AdminApprovalStatus = ApprovalStatus;
