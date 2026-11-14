import type { RowDataPacket } from 'mysql2';
import { transaction } from '../../shared/db/pool';
import { conflict } from '../../shared/utils/errors';
import { getCustomWorkflowApproverCandidates, type ApprovalApproverType } from './expenseApproverService';
import { readCustomWorkflow } from './customWorkflowService';
import { readWorkflowTestCases } from './customWorkflowTestCases';
import { readFixedWorkflowTestFields, validateWorkflowTestCase, normalizeFixedWorkflowTestFields, hashWorkflowTestFields, type WorkflowTestField } from './customWorkflowTestFields';
import { employeeApprovalFields } from './approvalFormFields';
import { runWorkflowTests } from './customWorkflowSimulation';

export async function runSavedWorkflowTests(type: ApprovalApproverType, adminId: number) {
  const [workflow, document, fixedFields, candidates] = await Promise.all([
    readCustomWorkflow(type), readWorkflowTestCases(type), readFixedWorkflowTestFields(type), getCustomWorkflowApproverCandidates(),
  ]);
  const report = await runWorkflowTests(type, workflow, document.cases);
  const fields = [...employeeApprovalFields(type, fixedFields, workflow.formFields ?? []).filter((field): field is WorkflowTestField => field.type !== 'attachment'), ...fixedFields.filter(field => field.key.startsWith('__'))];
  report.cases = report.cases.map((result, index) => {
    const error = validateWorkflowTestCase(type, fields, document.cases[index].values);
    return error ? { ...result, passed: false, error } : result;
  });
  const activeIds = new Set(candidates.candidates.map(item => item.id));
  const invalidApprovers = workflow.nodes.filter(node => node.kind === 'approver').flatMap(node => node.config?.approverIds ?? []).filter(id => !activeIds.has(id));
  if (invalidApprovers.length) report.errors.push('流程中存在不可用的审批人');
  report.passed = report.passed && !report.errors.length && report.cases.every(item => item.passed);
  await transaction(async conn => {
    const [workflowRows] = await conn.query<RowDataPacket[]>('SELECT version FROM custom_approval_workflows WHERE approval_type = ? FOR UPDATE', [type]);
    const [caseRows] = await conn.query<RowDataPacket[]>('SELECT version FROM custom_approval_test_cases WHERE approval_type = ? FOR UPDATE', [type]);
    const [fieldRows] = await conn.query<RowDataPacket[]>('SELECT fields_json FROM approval_types WHERE `key` = ? FOR UPDATE', [type]);
    if (!fieldRows.length || hashWorkflowTestFields(normalizeFixedWorkflowTestFields(type, fieldRows[0].fields_json)) !== hashWorkflowTestFields(fixedFields)) throw conflict('审批表单已发生变化，请重新测试');
    if (Number(workflowRows[0]?.version ?? 0) !== workflow.version || Number(caseRows[0]?.version ?? 0) !== document.version) throw conflict('流程或测试用例已发生变化，请重新测试');
    await conn.execute(`INSERT INTO custom_approval_test_runs (approval_type, workflow_version, case_version, fields_hash, passed, tested_by, tested_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE workflow_version = VALUES(workflow_version), case_version = VALUES(case_version), fields_hash = VALUES(fields_hash), passed = VALUES(passed), tested_by = VALUES(tested_by), tested_at = NOW()`,
    [type, workflow.version, document.version, hashWorkflowTestFields(fixedFields), report.passed ? 1 : 0, adminId]);
  });
  return { ...report, workflowVersion: workflow.version, caseVersion: document.version };
}
