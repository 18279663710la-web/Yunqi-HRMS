import type { RowDataPacket } from 'mysql2';
import { isDeepStrictEqual } from 'node:util';
import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import { badRequest, conflict } from '../../shared/utils/errors';
import type { ApprovalApproverType } from './expenseApproverService';
import { CHAIRPERSON_ID } from '../accounts/chairpersonService';
import { customWorkflowSchema, validateCustomWorkflowGraph, type CustomWorkflow } from './customWorkflowService';
import { validateExecutableWorkflow } from './customWorkflowSimulation';
import { normalizeFixedWorkflowTestFields, hashWorkflowTestFields, type WorkflowTestField } from './customWorkflowTestFields';

interface PublishedRow { publication_version: number; workflow_version: number; case_version: number; graph_json: string | object; fixed_fields_json: string | WorkflowTestField[]; credentials_json: string | Record<string, string> }
export interface PublishedWorkflow { publicationVersion: number; workflowVersion: number; caseVersion: number; workflow: CustomWorkflow; fixedFields: WorkflowTestField[] }

function decodeGraph(row: PublishedRow): CustomWorkflow {
  const graph = typeof row.graph_json === 'string' ? JSON.parse(row.graph_json) as object : row.graph_json;
  const parsed = customWorkflowSchema.safeParse({ ...graph, version: Number(row.workflow_version) });
  if (!parsed.success) throw new Error('已发布流程格式无效');
  return parsed.data;
}

function toPublishedWorkflow(row: PublishedRow): PublishedWorkflow {
  const credentials = typeof row.credentials_json === 'string' ? JSON.parse(row.credentials_json) as Record<string, string> : row.credentials_json;
  const graph = decodeGraph(row);
  const workflow = { ...graph, nodes: graph.nodes.map(node => node.kind === 'ai' ? { ...node, config: { ...node.config, hasApiKey: !!credentials[node.id] } } : node) };
  const fixedFields = typeof row.fixed_fields_json === 'string' ? JSON.parse(row.fixed_fields_json) as WorkflowTestField[] : row.fixed_fields_json;
  return { publicationVersion: Number(row.publication_version), workflowVersion: Number(row.workflow_version), caseVersion: Number(row.case_version), workflow, fixedFields };
}

export async function readPublishedWorkflow(type: ApprovalApproverType): Promise<PublishedWorkflow | null> {
  const row = await queryOne<PublishedRow>('SELECT publication_version, workflow_version, case_version, graph_json, fixed_fields_json, credentials_json FROM custom_approval_publications WHERE approval_type = ?', [type]);
  return row ? toPublishedWorkflow(row) : null;
}

export async function readPublishedWorkflows(): Promise<Map<string, PublishedWorkflow>> {
  const rows = await queryRows<PublishedRow & { approval_type: string }>('SELECT approval_type, publication_version, workflow_version, case_version, graph_json, fixed_fields_json, credentials_json FROM custom_approval_publications');
  return new Map(rows.map(row => [row.approval_type, toPublishedWorkflow(row)]));
}

/** 仅发布通过测试的版本，并在事务中固定流程和凭据快照。 */
export async function publishCustomWorkflow(type: ApprovalApproverType, workflowVersion: number, caseVersion: number, adminId: number): Promise<PublishedWorkflow> {
  return transaction(async conn => {
    const [workflows] = await conn.query<RowDataPacket[]>('SELECT version, graph_json FROM custom_approval_workflows WHERE approval_type = ? FOR UPDATE', [type]);
    const [cases] = await conn.query<RowDataPacket[]>('SELECT version FROM custom_approval_test_cases WHERE approval_type = ? FOR UPDATE', [type]);
    const [tests] = await conn.query<RowDataPacket[]>('SELECT workflow_version, case_version, fields_hash, passed FROM custom_approval_test_runs WHERE approval_type = ? FOR UPDATE', [type]);
    if (!workflows.length || !cases.length || Number(workflows[0].version) !== workflowVersion || Number(cases[0].version) !== caseVersion) throw conflict('流程或测试用例已发生变化，请刷新后重新测试');
    if (!tests.length || !tests[0].passed || Number(tests[0].workflow_version) !== workflowVersion || Number(tests[0].case_version) !== caseVersion) throw badRequest('当前流程和测试用例尚未通过测试');
    const [fieldRows] = await conn.query<RowDataPacket[]>('SELECT fields_json FROM approval_types WHERE `key` = ? FOR UPDATE', [type]);
    if (!fieldRows.length) throw badRequest('审批表单不存在');
    const fixedFields = normalizeFixedWorkflowTestFields(type, fieldRows[0].fields_json);
    if (tests[0].fields_hash !== hashWorkflowTestFields(fixedFields)) throw conflict('审批表单已发生变化，请重新测试');
    const graph = typeof workflows[0].graph_json === 'string' ? JSON.parse(workflows[0].graph_json) as object : workflows[0].graph_json;
    const workflow = customWorkflowSchema.parse({ ...graph, version: workflowVersion });
    validateCustomWorkflowGraph(type, workflow);
    const [credentialRows] = await conn.query<RowDataPacket[]>('SELECT node_id, encrypted_key FROM custom_approval_credentials WHERE approval_type = ?', [type]);
    const credentials = Object.fromEntries(credentialRows.map(row => [String(row.node_id), String(row.encrypted_key)]));
    const validated = { ...workflow, nodes: workflow.nodes.map(node => node.kind === 'ai' ? { ...node, config: { ...node.config, hasApiKey: !!credentials[node.id] } } : node) };
    const errors = validateExecutableWorkflow(type, validated);
    if (errors.length) throw badRequest(errors[0]);
    const approverIds = [...new Set(workflow.nodes.filter(node => node.kind === 'approver').flatMap(node => node.config?.approverIds ?? []))].sort();
    for (const id of approverIds.filter(id => id !== CHAIRPERSON_ID)) {
      const [employees] = await conn.query<RowDataPacket[]>('SELECT id FROM employees WHERE id = ? FOR UPDATE', [id]);
      const [accounts] = await conn.query<RowDataPacket[]>('SELECT status FROM employee_accounts WHERE employee_id = ? FOR UPDATE', [id]);
      const [departures] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_departures WHERE employee_id = ? AND status = 'departed' LIMIT 1 FOR UPDATE", [id]);
      if (!employees.length || !accounts.length || accounts[0].status !== 'active' || departures.length) throw badRequest('流程中存在不可用的审批人，请重新配置并测试');
    }
    if (approverIds.includes(CHAIRPERSON_ID)) {
      const [chair] = await conn.query<RowDataPacket[]>('SELECT status FROM chairperson_account WHERE id = 1 FOR UPDATE');
      if (!chair.length || chair[0].status !== 'active') throw badRequest('流程中存在不可用的审批人，请重新配置并测试');
    }
    const [previous] = await conn.query<RowDataPacket[]>('SELECT publication_version, workflow_version, case_version, fixed_fields_json FROM custom_approval_publications WHERE approval_type = ? FOR UPDATE', [type]);
    const publishedFields = previous.length && (typeof previous[0].fixed_fields_json === 'string' ? JSON.parse(previous[0].fixed_fields_json) : previous[0].fixed_fields_json);
    if (previous.length && Number(previous[0].workflow_version) === workflowVersion && Number(previous[0].case_version) === caseVersion && isDeepStrictEqual(publishedFields, fixedFields.filter(field => !field.key.startsWith('__')))) {
      return { publicationVersion: Number(previous[0].publication_version), workflowVersion, caseVersion, workflow: validated, fixedFields: fixedFields.filter(field => !field.key.startsWith('__')) };
    }
    const publicationVersion = Number(previous[0]?.publication_version ?? 0) + 1;
    const savedGraph = { nodes: workflow.nodes, edges: workflow.edges, formFields: workflow.formFields ?? [], ...(workflow.fieldsInitialized ? { fieldsInitialized: true } : {}) };
    await conn.execute(`INSERT INTO custom_approval_publications (approval_type, publication_version, workflow_version, case_version, graph_json, fixed_fields_json, credentials_json, published_by, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE publication_version = VALUES(publication_version), workflow_version = VALUES(workflow_version), case_version = VALUES(case_version), graph_json = VALUES(graph_json), fixed_fields_json = VALUES(fixed_fields_json), credentials_json = VALUES(credentials_json), published_by = VALUES(published_by), published_at = NOW()`,
    [type, publicationVersion, workflowVersion, caseVersion, JSON.stringify(savedGraph), JSON.stringify(fixedFields.filter(field => !field.key.startsWith('__'))), JSON.stringify(credentials), adminId]);
    return { publicationVersion, workflowVersion, caseVersion, workflow, fixedFields: fixedFields.filter(field => !field.key.startsWith('__')) };
  });
}
