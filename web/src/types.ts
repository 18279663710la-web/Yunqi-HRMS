export type AdminRole = 'super_admin' | 'hr_admin';
export type AccountStatus = 'active' | 'disabled';
export type JobCategoryName = string;
export type JobCategoryKey = string;

export interface AdminUser {
  id: number;
  username: string;
  name: string;
  role: AdminRole;
  status: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminAccountItem extends AdminUser {
  canDisable: boolean;
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

export interface JobCategoryEmployee {
  id: string;
  name: string;
  employeeNo: string;
  phone: string;
  joinDate: string;
  isLeader: boolean;
  accountStatus: AccountStatus | 'none';
  loginName: string;
}

export interface JobCategoryGroup {
  key: JobCategoryKey;
  name: JobCategoryName;
  count: number;
  employees: JobCategoryEmployee[];
}

export interface EmployeeListResponse {
  list: AdminEmployee[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EmployeeOption {
  id: string;
  name: string;
  deptName: string;
  position: string;
  employeeNo: string;
}

export interface DepartmentNode {
  id: string;
  parentId: string;
  name: string;
  leaderId: string;
  leaderName: string;
  order: number;
  count: number;
  total: number;
  children: DepartmentNode[];
}

export interface AttendanceRecord {
  date: string;
  day: number;
  month: number;
  weekdayText: string;
  checkIn: string;
  checkOut: string;
  status: 'normal' | 'missing_in' | 'missing_out' | 'absent' | 'leave' | 'rest' | 'travel';
  statusText: string;
  duration: string;
  isToday?: boolean;
  note?: string;
  source?: string;
  statusOverride?: 'leave' | 'absent' | 'rest' | null;
}

export interface AdminAttendanceRecord extends AttendanceRecord {
  overtimeMinutes: number;
  overtimeCount: number;
  overtimeSeconds: number;
  overtimePeriods: { checkIn: string; checkOut: string | null }[];
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  deptId: string;
  deptName: string;
  jobCategory: JobCategoryName;
  position: string;
}

export interface AttendanceSummary {
  normal: number;
  missingIn: number;
  missingOut: number;
  rest: number;
  presentDays: number;
  late: number;
  absent: number;
  leave: number;
  travel: number;
  overtime: number;
  workdays: number;
}

export interface EmployeeAttendanceSummary extends AttendanceSummary {
  overtimeSeconds: number;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  deptName: string;
  jobCategory: JobCategoryName;
  presentDays: number;
  totalHours: number;
}

export interface AttendanceResponse {
  month: string;
  startDate: string;
  endDate: string;
  list: AdminAttendanceRecord[];
  summary: AttendanceSummary;
  employeeSummary: EmployeeAttendanceSummary[];
}

export interface DashboardData {
  employeeCount: number;
  activeAccountCount: number;
  departmentCount: number;
  pendingApprovalCount: number;
  jobCategoryCounts: Array<{ name: JobCategoryName; count: number }>;
  today: {
    total: number;
    checkedIn: number;
    late: number;
    notChecked: number;
    rest: number;
    overtime: number;
    onLeave: number;
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

export interface OperationLog {
  id: number;
  adminId: number;
  adminName: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface EmployeeInput {
  name: string;
  pinyin: string;
  gender?: string;
  deptId: string;
  position: string;
  jobCategory?: JobCategoryName;
  level: string;
  employeeNo: string;
  phone: string;
  email?: string;
  joinDate: string;
  isLeader?: boolean;
  seat?: string;
  leaderId?: string;
}

export interface EmployeeAccountInput {
  loginName: string;
  password: string;
  status?: AccountStatus;
}

export interface CreateEmployeeInput extends EmployeeInput {
  jobCategory: JobCategoryName;
  account?: EmployeeAccountInput;
}

export interface LoginResponse {
  token: string;
  admin: AdminUser;
}

export interface AttendanceQuery {
  month?: string;
  date?: string;
  jobCategory?: JobCategoryName;
  employeeId?: string;
  status?: string;
}

export interface AttendanceSettings {
  startTime: string;
  inEndTime: string | null;
  endTime: string;
  outEndTime: string | null;
  restDates: string[];
  latitude: number;
  longitude: number;
  radius: number;
}

export interface AttendanceGroup extends AttendanceSettings {
  id: number;
  name: string;
  calendarRuleId: number | null;
  calendarRuleName: string;
  employeeIds: string[];
  employeeCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AttendanceGroupsResponse {
  groups: AttendanceGroup[];
  initialSettings: AttendanceSettings | null;
}

export interface AttendanceGroupInput extends AttendanceSettings {
  name: string;
  calendarRuleId: number;
  employeeIds: string[];
}

export type CompanyCalendarMode = 'none' | 'weekly' | 'cycle';

export interface CompanyCalendarRule {
  id: number;
  name: string;
  mode: CompanyCalendarMode;
  weeklyRestDays: number[];
  cycleWeeks: number | null;
  cycleRestDays: number[][];
  anchorDate: string | null;
  restDates: string[];
  workDates: string[];
  usageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CompanyCalendarRuleInput {
  name: string;
  mode: CompanyCalendarMode;
  weeklyRestDays: number[];
  cycleWeeks: number | null;
  cycleRestDays: number[][];
  anchorDate: string | null;
  restDates: string[];
  workDates: string[];
}

export interface ManualPunchInput {
  employeeId: string;
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  statusOverride?: 'leave' | 'absent' | 'rest' | null;
  note?: string;
}
