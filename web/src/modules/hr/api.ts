import { downloadFile, request } from '../../api/client';

export interface HrEmployee { id: string; name: string; employeeNo: string; position: string; employmentStatus: 'active' | 'departed' }
export interface OnboardingRecord { id: number; fields: Record<string, string>; createdAt: string; employeeId: string | null; taskStatus: 'pending' | 'in_progress' | 'completed'; taskCount: number; completedCount: number }
export interface OnboardingTask { id: number; title: string; description: string; startDate: string | null; endDate: string | null; required: boolean; completed: boolean }
export interface OnboardingEmployeeInput { name: string; pinyin: string; employeeNo: string; phone: string; joinDate: string; jobCategory: string }
export interface TaskTemplateItem { title: string; required: boolean; description?: string; beginOn?: number | null; duration?: number | null }
export interface HrEvent { id: number; employeeId: string; type: string; effectiveDate: string; note: string }
export interface HrTransition { id: number; type: 'promotion' | 'transfer'; effectiveDate: string; before: Record<string, string | null>; after: Record<string, string | null>; note: string; status: 'submitted' | 'cancelled'; createdAt: string }
export interface HrHistory { id: number; data: Record<string, unknown>; createdAt: string }
export interface PayrollBatch { id: number; month: string; status: 'draft' | 'reviewed'; createdAt: string; reviewedAt: string | null }
export interface PayrollFieldValue { name: string; value: number | string; type?: 'number' | 'text'; category?: 'income' | 'deduction' | 'info'; interfaceSource?: 'attendance'; attendanceMetric?: 'presentDays' | 'overtimeHours' | 'overtimePay'; calculationRule?: SalaryCalculationRule; attendancePeriod?: string; manualAdjustment?: { originalValue: number | string; updatedAt: string; updatedBy: number } }
export interface PayrollModelSnapshot { version: number; revision: number; position?: string; fixedTotal: number; manualDeduction?: number; fixed: PayrollFieldValue[]; extended: (PayrollFieldValue & { category: 'income' | 'deduction' | 'info' })[] }
export interface PayrollBatchItem { id: number; employeeId: string; name: string; employeeNo: string; position: string; gross: number; baseGross: number | null; attendanceRate: number | null; attendanceAdjustment: number; overtimeSeconds: number; overtimePay: number; deductions: number; net: number; note: string; modelSnapshot: PayrollModelSnapshot | null }
export interface DisbursementField { id: number; name: string; category: 'income' | 'deduction' | 'info'; required: boolean; displaySetting: 'none' | 'display' | 'output' }
export interface DisbursementState { fields: DisbursementField[]; rows: { itemId: number; net: number; values: { fieldId: number; value: number; revision: number }[] }[]; revision?: string; issued?: boolean; recordId?: number; sentItemIds?: number[]; snapshot?: { items: PayrollBatchItem[]; model: SalaryComponentModel } }
export interface PayrollDisbursementSnapshot { batch: PayrollBatch; items: PayrollBatchItem[]; model: SalaryComponentModel; disbursement: DisbursementState }
export interface PayrollDisbursementRecord { id: number; batchId: number; month: string; grossTotal: number; netTotal: number; note: string; createdAt: string }
export type DisbursementFieldInput = Omit<DisbursementField, 'id'>;
export interface AutoPayrollCandidate { employeeId: string; name: string; employeeNo: string; position: string; baseGross: number; gross: number; deductions: number; net: number; modelSnapshot: PayrollModelSnapshot }
export interface AutoPayrollTotals { baseGross: number; gross: number; deductions: number; net: number }
export interface AutoPayrollPreview { month: string; candidates: AutoPayrollCandidate[]; existingCount: number; reviewedCount: number; totals: AutoPayrollTotals }
export interface AutoPayrollAddResult { addedCount: number; skippedExisting: number; totals: AutoPayrollTotals }
export interface OffboardingRecord { id: number; employeeId: string; name: string; employeeNo: string; lastDate: string; note: string; status: 'open' | 'completed'; departureStatus: 'departed' | 'cancelled' | null; taskStatus: 'pending' | 'in_progress' | 'completed'; taskCount: number; completedCount: number }
export type HrSection = 'profile' | 'contract' | 'salary';
export const getHrEmployees = () => request<HrEmployee[]>('/admin/hr/employees');
export const getOnboardingFields = () => request<string[]>('/admin/hr/onboarding/fields');
export const saveOnboardingFields = (fields: string[]) => request<string[]>('/admin/hr/onboarding/fields', { method: 'PUT', body: fields });
export const getOnboardingRecords = () => request<OnboardingRecord[]>('/admin/hr/onboarding');
export const addOnboardingRecord = (fields: Record<string, string>) => request<{ id: number }>('/admin/hr/onboarding', { method: 'POST', body: fields });
export const getOnboardingTasks = (id: number) => request<OnboardingTask[]>(`/admin/hr/onboarding/${id}/tasks`);
export const addOnboardingTask = (id: number, title: string, required: boolean) => request(`/admin/hr/onboarding/${id}/tasks`, { method: 'POST', body: { title, required } });
export const updateOnboardingTask = (id: number, taskId: number, completed: boolean) => request(`/admin/hr/onboarding/${id}/tasks/${taskId}`, { method: 'PATCH', body: { completed } });
export const confirmOnboarding = (id: number, input: OnboardingEmployeeInput) => request<{ employeeId: string }>(`/admin/hr/onboarding/${id}/confirm`, { method: 'POST', body: input });
export const getTaskTemplate = () => request<TaskTemplateItem[]>('/admin/hr/onboarding/task-template');
export const saveTaskTemplate = (tasks: TaskTemplateItem[]) => request<TaskTemplateItem[]>('/admin/hr/onboarding/task-template', { method: 'PUT', body: tasks });
export const applyTaskTemplate = (id: number, startDate?: string) => request(`/admin/hr/onboarding/${id}/apply-template`, { method: 'POST', body: { startDate } });
export const getHrEvents = (id: string) => request<HrEvent[]>(`/admin/hr/events?employeeId=${encodeURIComponent(id)}`);
export const addHrEvent = (body: unknown) => request('/admin/hr/events', { method: 'POST', body });
export const getHrTransitions = (id: string) => request<HrTransition[]>(`/admin/hr/employee-transitions?employeeId=${encodeURIComponent(id)}`);
export const submitHrTransition = (body: unknown) => request<{ id: number }>('/admin/hr/employee-transitions', { method: 'POST', body });
export const cancelHrTransition = (id: number) => request(`/admin/hr/employee-transitions/${id}/cancel`, { method: 'POST', body: {} });
export const getHrHistory = (id: string, section: 'contract' | 'salary') => request<HrHistory[]>(`/admin/hr/employees/${encodeURIComponent(id)}/${section}/history`);
export interface AttendancePayrollRule { minRate: number; maxRate: number; adjustment: number }
export type AttendanceRuleMode = 'rate_attendance' | 'rate_absence' | 'days_attendance' | 'days_absence';
export interface AttendanceRange { minRate: number; maxRate: number | null; adjustment: number }
export type AttendanceRuleConfig = { mode: AttendanceRuleMode; calculation?: 'range'; rules: AttendanceRange[] } | { mode: AttendanceRuleMode; calculation: 'unit'; unitAdjustment: number };
export const getAttendanceRuleConfig = () => request<AttendanceRuleConfig>('/admin/hr/attendance-payroll-rule-config-v2');
export const saveAttendanceRuleConfig = (config: AttendanceRuleConfig) => request<AttendanceRuleConfig>('/admin/hr/attendance-payroll-rule-config-v2', { method: 'PUT', body: config });
export const getAttendancePayrollRules = () => request<AttendancePayrollRule[]>('/admin/hr/attendance-payroll-rules');
export const saveAttendancePayrollRules = (rules: AttendancePayrollRule[]) => request<AttendancePayrollRule[]>('/admin/hr/attendance-payroll-rules', { method: 'PUT', body: rules });
export interface OvertimePayrollRule { minHours: number; maxHours: number | null; hourlyRate: number }
export type OvertimePayrollConfig = { calculation: 'range'; rules: OvertimePayrollRule[] } | { calculation: 'unit'; hourlyRate: number };
export const getOvertimePayrollConfig = () => request<OvertimePayrollConfig>('/admin/hr/overtime-payroll-rule-config');
export const saveOvertimePayrollConfig = (config: OvertimePayrollConfig) => request<OvertimePayrollConfig>('/admin/hr/overtime-payroll-rule-config', { method: 'PUT', body: config });
export const getOvertimePayrollRules = () => request<OvertimePayrollRule[]>('/admin/hr/overtime-payroll-rules');
export const saveOvertimePayrollRules = (rules: OvertimePayrollRule[]) => request<OvertimePayrollRule[]>('/admin/hr/overtime-payroll-rules', { method: 'PUT', body: rules });
export type SalaryFieldRole = 'name' | 'employeeNo' | 'position' | 'base' | 'allowance' | 'performance';
export type SalaryCalculationRule = 'direct' | 'attendance' | 'overtime';
export interface SalaryModelField { name: string; type: 'number' | 'text'; required: boolean; role?: SalaryFieldRole; category?: 'income' | 'deduction' | 'info'; interfaceSource?: 'none' | 'attendance'; attendanceMetric?: 'presentDays' | 'overtimeHours' | 'overtimePay'; calculationRule?: SalaryCalculationRule; displaySetting?: 'none' | 'display' | 'output' }
export interface SalaryComponentModel { version: number; fixedFields: SalaryModelField[]; extendedFields: SalaryModelField[]; fieldOrder?: string[] }
export interface SalaryComponentModelInput { version: number; fixedFields: SalaryModelField[]; extendedFields: SalaryModelField[]; fieldOrder?: string[] }
export const getSalaryComponentModel = () => request<SalaryComponentModel>('/admin/hr/salary-model');
export const saveSalaryComponentModel = (input: SalaryComponentModelInput) => request<SalaryComponentModel>('/admin/hr/salary-model', { method: 'PUT', body: input });
export type PayrollWorkflowNodeKind = 'system-calc' | 'manual-adjust' | 'review' | 'payslip' | 'send-miniprogram' | 'import-fields';
export interface PayrollWorkflowNodeSnapshot { id: string; type: 'payroll'; position: { x: number; y: number }; data: { kind: PayrollWorkflowNodeKind } }
export interface PayrollWorkflowEdgeSnapshot { id: string; source: string; target: string }
export interface PayrollWorkflow { version: number; nodes: PayrollWorkflowNodeSnapshot[]; edges: PayrollWorkflowEdgeSnapshot[] }
export const getPayrollWorkflow = () => request<PayrollWorkflow>('/admin/hr/payroll-workflow');
export const savePayrollWorkflow = (input: PayrollWorkflow) => request<PayrollWorkflow>('/admin/hr/payroll-workflow', { method: 'PUT', body: input });
export const deletePayrollBatch = (id: number) => request(`/admin/hr/payroll-batches/${id}`, { method: 'DELETE' });
export const getPayrollBatches = (month?: string) => request<PayrollBatch[]>(`/admin/hr/payroll-batches${month ? `?month=${encodeURIComponent(month)}` : ''}`);
export const createPayrollBatch = (month: string) => request<{ id: number }>('/admin/hr/payroll-batches', { method: 'POST', body: { month } });
export const getPayrollBatchItems = (id: number) => request<PayrollBatchItem[]>(`/admin/hr/payroll-batches/${id}/items`);
export const getDisbursement = (id: number) => request<DisbursementState>(`/admin/hr/payroll-batches/${id}/disbursement`);
export const stagePayrollPayslip = (batchId: number, itemId: number, revision: string, pdf: string) => request(`/admin/hr/payroll-batches/${batchId}/disbursement/items/${itemId}/payslip-stage`, { method: 'POST', body: { revision, pdf } });
export const issueDisbursement = (id: number, revision: string) => request<{ id: number }>(`/admin/hr/payroll-batches/${id}/disbursement/issue`, { method: 'POST', body: { revision } });
export const sendPayrollPayslip = (batchId: number, itemId: number, pdf?: string) => request<{ id: number; revision: number }>(`/admin/hr/payroll-batches/${batchId}/disbursement/items/${itemId}/payslip`, { method: 'POST', body: pdf ? { pdf } : {} });
export const getDisbursementRecords = () => request<PayrollDisbursementRecord[]>('/admin/hr/payroll-disbursement-records');
export const getDisbursementRecord = (id: number) => request<PayrollDisbursementSnapshot>(`/admin/hr/payroll-disbursement-records/${id}`);
export const addDisbursementField = (id: number, body: DisbursementFieldInput) => request<{ id: number }>(`/admin/hr/payroll-batches/${id}/disbursement/fields`, { method: 'POST', body });
export const saveDisbursementValue = (batchId: number, itemId: number, fieldId: number, value: number, revision: number) => request<DisbursementState>(`/admin/hr/payroll-batches/${batchId}/disbursement/items/${itemId}/fields/${fieldId}`, { method: 'PUT', body: { value, revision } });
export const addPayrollBatchItem = (id: number, body: unknown) => request(`/admin/hr/payroll-batches/${id}/items`, { method: 'POST', body });
export const getPayrollEmployeeAvailability = (id: number) => request<{ reviewedEmployeeIds: string[] }>(`/admin/hr/payroll-batches/${id}/employee-availability`);
export const previewAutoPayrollItems = (id: number) => request<AutoPayrollPreview>(`/admin/hr/payroll-batches/${id}/auto-preview`);
export const addAutoPayrollItems = (id: number) => request<AutoPayrollAddResult>(`/admin/hr/payroll-batches/${id}/auto-items`, { method: 'POST', body: {} });
export const removePayrollBatchItem = (id: number, itemId: number) => request(`/admin/hr/payroll-batches/${id}/items/${itemId}`, { method: 'DELETE' });
export const reviewPayrollBatch = (id: number) => request(`/admin/hr/payroll-batches/${id}/review`, { method: 'POST', body: {} });
export const updatePayrollExtended = (id: number, itemId: number, body: { revision: number; values: { name: string; value: number | string }[] }) => request<{ modelSnapshot: PayrollModelSnapshot; gross: number; deductions: number; net: number }>(`/admin/hr/payroll-batches/${id}/items/${itemId}/extended`, { method: 'PUT', body });
export const updatePayrollFixed = (id: number, itemId: number, body: { revision: number; name: string; value: number | string }) => request<{ modelSnapshot: PayrollModelSnapshot; gross: number; deductions: number; net: number }>(`/admin/hr/payroll-batches/${id}/items/${itemId}/fixed`, { method: 'PUT', body });
export const updatePayrollDeduction = (id: number, itemId: number, body: { revision: number; deduction: number }) => request<{ modelSnapshot: PayrollModelSnapshot; gross: number; deductions: number; net: number }>(`/admin/hr/payroll-batches/${id}/items/${itemId}/deduction`, { method: 'PUT', body });
export const getOffboarding = () => request<OffboardingRecord[]>('/admin/hr/offboarding');
export const createOffboarding = (body: unknown) => request<{ id: number }>('/admin/hr/offboarding', { method: 'POST', body });
export const getOffboardingTasks = (id: number) => request<OnboardingTask[]>(`/admin/hr/offboarding/${id}/tasks`);
export const addOffboardingTask = (id: number, title: string, required: boolean) => request(`/admin/hr/offboarding/${id}/tasks`, { method: 'POST', body: { title, required } });
export const updateOffboardingTask = (id: number, taskId: number, completed: boolean) => request(`/admin/hr/offboarding/${id}/tasks/${taskId}`, { method: 'PATCH', body: { completed } });
export const completeOffboarding = (id: number) => request(`/admin/hr/offboarding/${id}/complete`, { method: 'POST', body: {} });
export const finalizeOffboarding = (id: number) => request(`/admin/hr/offboarding/${id}/finalize`, { method: 'POST', body: {} });
export const cancelDeparture = (id: number) => request(`/admin/hr/offboarding/${id}/cancel-departure`, { method: 'POST', body: {} });
export const getHrRecord = (employeeId: string, section: HrSection) => request<Record<string, unknown>>(`/admin/hr/employees/${encodeURIComponent(employeeId)}/${section}`);
export const saveHrRecord = (employeeId: string, section: HrSection, data: unknown) => request(`/admin/hr/employees/${encodeURIComponent(employeeId)}/${section}`, { method: 'PUT', body: data });

export interface HrContractFile { id: number; name: string; size: number; mimeType: string; createdAt: string }
const contractFilesPath = (id: string) => `/admin/hr/employees/${encodeURIComponent(id)}/contract-files`;
export const getHrContractFiles = (id: string) => request<HrContractFile[]>(contractFilesPath(id));
export const uploadHrContractFile = (id: string, file: File) => { const body = new FormData(); body.append('file', file); return request<{ id: number }>(contractFilesPath(id), { method: 'POST', body }); };
export const downloadHrContractFile = (id: string, file: HrContractFile) => downloadFile(`${contractFilesPath(id)}/${file.id}`, file.name);
