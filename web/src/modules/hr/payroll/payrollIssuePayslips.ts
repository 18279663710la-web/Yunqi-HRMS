import { issueDisbursement, stagePayrollPayslip, type DisbursementState, type PayrollBatch, type PayrollBatchItem, type SalaryComponentModel } from '../api';
import { buildPayslipExportData } from './payrollDisbursementExport';
import type { PayrollExportData } from './payrollExportData';

export async function generatePayslipPdf(data: PayrollExportData): Promise<string> {
  const pdf = await (await import('./payrollExportPdf')).createPayrollPdf(data);
  const encoded = pdf.output('datauristring').split(',')[1];
  if (!encoded) throw new Error('工资条生成失败');
  return encoded;
}

interface IssueServices {
  generate(data: PayrollExportData): Promise<string>;
  stage(batchId: number, itemId: number, revision: string, pdf: string): Promise<unknown>;
  issue(batchId: number, revision: string): Promise<{ id: number }>;
}

/** 先准备所有单人文件；服务端在发放事务中验证版本并一并发送。 */
export async function prepareAndIssuePayroll(batch: PayrollBatch, items: PayrollBatchItem[], model: SalaryComponentModel, state: DisbursementState, services: IssueServices = { generate: generatePayslipPdf, stage: stagePayrollPayslip, issue: issueDisbursement }, onProgress?: (completed: number, total: number) => void): Promise<{ id: number }> {
  if (!state.revision || !items.length) throw new Error('工资发放数据不完整，请刷新后重试');
  for (const [index, item] of items.entries()) {
    const pdf = await services.generate(buildPayslipExportData(batch, item, model, state));
    await services.stage(batch.id, item.id, state.revision, pdf);
    onProgress?.(index + 1, items.length);
  }
  return services.issue(batch.id, state.revision);
}
