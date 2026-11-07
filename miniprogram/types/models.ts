/**
 * 前端领域模型 —— 与 server/src/types/models.ts 对齐。
 * 所有接口字段均来自后端 JSON，页面不再直接接触 Storage / Mock。
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type TimelineState = 'done' | 'current' | 'wait' | 'reject' | 'stop';
export type PunchType = 'in' | 'out';
export interface OvertimePunch { approvalId: string; start: string; checkIn: string | null; canPunch: boolean; nextType: 'in' | 'out' }
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

export interface DepartmentNode {
  id: string;
  parentId: string;
  name: string;
  leaderId: string;
  order: number;
  children: DepartmentNode[];
  count: number;
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
  leaderId: string;
  leaderName: string;
  isChairperson?: boolean;
}

export type ApprovalFieldType = 'text' | 'number' | 'money' | 'picker' | 'date' | 'time' | 'textarea';

export interface ApprovalField {
  key: string;
  label: string;
  type: ApprovalFieldType;
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

export interface TimelineViewNode extends TimelineNode {
  _k: string;
  nodeClass: string;
  isLast: boolean;
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

export interface ApprovalListItem extends ApprovalDecorated {
  typeIcon: string;
}

export interface ExpenseAiAdvice {
  recommendation: 'approve' | 'reject' | null;
  reason: string;
  rule: string;
  missingAttachments: string[];
  attachmentIssues?: Array<{ name: string; issue: string }>;
}

export interface ExpensePrecheckResult {
  status: 'completed' | 'no_rules' | 'unconfigured' | 'failed';
  advice: ExpenseAiAdvice | null;
}

export interface ApprovalDetail extends ApprovalDecorated {
  canCancel: boolean;
  attachments?: Array<{ name: string; fileID: string }>;
  aiAdvice?: {
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'no_rules' | 'unconfigured';
    advice: ExpenseAiAdvice | null;
  } | null;
}

export interface ApprovalDetailView extends Omit<ApprovalDetail, 'timeline'> {
  timeline: TimelineViewNode[];
  invoiceTotal: string;
}

export interface ApprovalTabCounts {
  pending: number;
  mine: number;
  done: number;
}

export interface ApprovalActionResult {
  ok: boolean;
  finished?: boolean;
  message: string;
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
}

export interface AttendanceRecordView extends AttendanceRecord {
  tagClass: string;
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

export interface AttendanceSettings {
  startTime: string;
  inEndTime: string | null;
  endTime: string;
  outEndTime: string | null;
  restDates: string[];
  address: string;
  floor: string;
  latitude: number;
  longitude: number;
  radius: number;
}

export interface NoticeBlock {
  type: 'p' | 'h' | 'list' | 'quote';
  text?: string;
  items?: string[];
}

export interface NoticeBlockView extends NoticeBlock {
  _k: string;
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

export interface NoticeDetailView extends NoticeDetail {
  blocks: NoticeBlockView[];
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

export interface VerifyStatusMeta {
  key: VerifyStatus;
  text: string;
  level: 'ok' | 'warn' | 'fail';
  desc: string;
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
  status: Record<VerifyStatus, VerifyStatusMeta>;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: CurrentUser;
}

export interface CreateApprovalPayload {
  type: string;
  title: string;
  summary: string;
  form: ApprovalFormItem[];
  invoices: Invoice[];
  attachments?: Array<{ name: string; fileID: string }>;
  urgent: boolean;
}

export interface InvoiceChangeDetail {
  invoices: Invoice[];
  recognized: Invoice[];
  totalAmount: number;
  taxAmount: number;
  count: number;
  earliestDate: string;
  sellers: string[];
  categories: string[];
  recognizing: boolean;
  removed: boolean;
  checkReady: boolean;
  checkMessage: string;
}

export interface ParsedInvoiceQR {
  ok: boolean;
  message?: string;
  raw?: string;
  version?: string;
  typeCode?: string;
  typeName?: string;
  invoiceCode?: string;
  invoiceNumber?: string;
  totalAmount?: number;
  invoiceDate?: string;
  checkCode?: string;
  crc?: string;
  crcCalc?: string;
  crcVerified?: boolean;
}
