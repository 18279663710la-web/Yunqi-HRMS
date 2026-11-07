/**
 * 领域模型 —— 与小程序端 `miniprogram/types/models.ts` 保持同名同结构。
 * 后端返回的 JSON 字段一律 camelCase，页面无需再做字段转换。
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type TimelineState = 'done' | 'current' | 'wait' | 'reject' | 'stop';
export type PunchType = 'in' | 'out';
export type VerifyStatus =
  | 'valid'
  | 'abnormal'
  | 'notFound'
  | 'mismatch'
  | 'duplicated'
  | 'limitExceeded'
  | 'invalid'
  | 'error';

export interface Company {
  name: string;
  shortName: string;
  logoText: string;
  address: string;
  workTime: string;
  flexible: string;
}

export interface Department {
  id: string;
  parentId: string;
  name: string;
  leaderId: string;
  order: number;
}

export interface DepartmentNode extends Department {
  children: DepartmentNode[];
  /** 本部门直属人数 */
  count: number;
  /** 含子部门的总人数 */
  total: number;
}

export interface DepartmentFlat {
  id: string;
  name: string;
  depth: number;
  total: number;
  leaderId: string;
}

export interface Employee {
  id: string;
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
  jobCategory: string;
  seat: string;
  leaderId?: string;
}

export interface EmployeeListItem extends Employee {
  initial: string;
}

export interface EmployeeGroup {
  letter: string;
  list: EmployeeListItem[];
}

export interface EmployeeBrief {
  id: string;
  name: string;
  position: string;
}

export interface EmployeeDetail extends EmployeeListItem {
  deptFullName: string;
  leader: EmployeeBrief | null;
  leaderInitial: string;
  subordinates: EmployeeListItem[];
}

export interface CurrentUser extends Employee {
  deptName: string;
  leaderId: string;
  leaderName: string;
  isChairperson?: boolean;
}

export interface ApprovalField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'money' | 'picker' | 'date' | 'time' | 'textarea';
  required: boolean;
  options?: string[];
  default?: string;
  placeholder?: string;
  maxlength?: number;
}

export interface ApprovalType {
  key: string;
  name: string;
  color: string;
  desc: string;
  fields: ApprovalField[];
}

export interface QuickAction {
  key: string;
  name: string;
  icon: string;
  color: string;
  url: string;
  tab?: boolean;
}

export interface ApprovalFormItem {
  label: string;
  value: string;
}

export interface Invoice {
  id: string;
  source?: string;
  fileID?: string;
  invoiceType: string;
  invoiceCode: string;
  invoiceNumber: string;
  invoiceDate: string;
  sellerName?: string;
  sellerTaxNo?: string;
  buyerName?: string;
  category?: string;
  itemName?: string;
  amount: number;
  taxRate?: string;
  taxAmount: number;
  totalAmount: number;
  checkCode?: string;
  remark?: string;
  /** 演示数据标记（OCR mock 驱动生成） */
  demo?: boolean;
  isMock?: boolean;
  isQR?: boolean;
  qrFrom?: string;
  qrCrcVerified?: boolean;
}

export interface TimelineNode {
  name: string;
  role: string;
  action: string;
  comment?: string;
  time: string;
  state: TimelineState;
  approverId?: string;
}

export interface Approval {
  id: string;
  type: string;
  typeName: string;
  title: string;
  status: ApprovalStatus;
  urgent: boolean;
  applicantId: string;
  applicantName: string;
  applicantDept: string;
  applicantPosition: string;
  createdAt: string;
  updatedAt?: string;
  node: string;
  summary: string;
  form: ApprovalFormItem[];
  invoices: Invoice[];
  timeline: TimelineNode[];
}

export interface ApprovalDecorated extends Approval {
  statusText: string;
  statusClass: string;
  initial: string;
  timeText: string;
  canApprove: boolean;
  isMine: boolean;
}

export interface ApprovalDetail extends ApprovalDecorated {
  canCancel: boolean;
  attachments?: Array<{ name: string; fileID: string }>;
  aiAdvice?: { status: string; advice: import('../../domains/approvals/expenseAiPolicy').AiAdvice | null } | null;
}

export interface ApprovalTabCounts {
  pending: number;
  mine: number;
  done: number;
}

export interface ApprovalTypeOption {
  key: string;
  name: string;
}

export interface TodayAttendance {
  date: string;
  weekday: string;
  time: string;
  checkIn: string;
  checkOut: string;
  status: 'normal' | 'missing_in' | 'missing_out' | 'absent' | 'leave' | 'rest';
  statusText: string;
  nextType: 'in' | 'out' | 'done' | 'wait';
  nextText: string;
  workday: boolean;
  workTime: string;
  flexible: string;
  address: string;
  inEndTime: string | null;
  outEndTime: string | null;
}

export interface AttendanceRecord {
  date: string;
  day: number;
  month: number;
  weekdayText: string;
  checkIn: string;
  checkOut: string;
  status: 'normal' | 'missing_in' | 'missing_out' | 'absent' | 'leave' | 'rest';
  statusText: string;
  duration: string;
  isToday?: boolean;
  note?: string;
  source?: string;
  statusOverride?: 'leave' | 'absent' | 'rest' | null;
  isLate?: boolean;
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
  overtime: number;
  workdays: number;
}

export interface AttendanceStats {
  week: AttendanceSummary;
  month: AttendanceSummary;
  avgHours: string;
  totalDays: number;
}

export interface PunchResult {
  ok: boolean;
  time?: string;
  message: string;
}

export interface NoticeBlock {
  type: 'p' | 'h' | 'list' | 'quote';
  text?: string;
  items?: string[];
}

export interface NoticeAttachment {
  name: string;
  size: string;
  ext: string;
}

export interface Notice {
  id: string;
  title: string;
  category: string;
  categoryName: string;
  isTop: boolean;
  isRead: boolean;
  publishTime: string;
  publisher: string;
  publisherDept: string;
  banner: string;
  summary: string;
  readCount: number;
  totalCount: number;
  blocks: NoticeBlock[];
  attachments: NoticeAttachment[];
  timeText: string;
  readPercent: number;
}

export interface NoticeDetail extends Notice {
  dateText: string;
}

export interface NoticeCategory {
  key: string;
  name: string;
}

export interface TodoStats extends ApprovalTabCounts {
  unreadNotice: number;
  attendance: TodayAttendance;
}

export interface DuplicateHit {
  approvalId: string;
  title: string;
  applicantName: string;
  createdAt: string;
  status: ApprovalStatus;
  statusText: string;
  blocking: boolean;
}

export interface DuplicateResult {
  duplicated: boolean;
  blocking: boolean;
  hits: DuplicateHit[];
  key: string;
  message?: string;
}

export interface VerifyParamSet {
  invoiceCode: string;
  invoiceNo: string;
  invoiceDate: string;
  additional: string;
  additionalType: string;
}

export interface VerifyResult {
  status: VerifyStatus;
  statusText: string;
  level: 'ok' | 'warn' | 'fail';
  desc: string;
  message: string;
  invoice: Invoice | null;
  duplicate: DuplicateResult | null;
  params: VerifyParamSet | null;
  mock: boolean;
  fromSample: boolean;
}

export interface InvoiceMeta {
  ocrDriver: string;
  verifyDriver: string;
  mockRules: string[];
  status: Record<VerifyStatus, { key: VerifyStatus; text: string; level: 'ok' | 'warn' | 'fail'; desc: string }>;
}

export interface OcrResponse {
  invoice: Invoice & { __mock?: boolean; __fromQR?: boolean };
  fileUrl: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: CurrentUser;
}
