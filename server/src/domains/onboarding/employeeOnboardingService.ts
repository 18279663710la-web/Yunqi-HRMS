import { transaction } from '../../shared/db/pool';
import { parse } from '../../shared/middleware/validate';
import { badRequest, notFound } from '../../shared/utils/errors';
import { onboardingDeclaration } from './onboardingDeclaration';
import { formTemplateSchema, validateAnswers, validateOnboardingAttachments } from './onboardingForm';
import { findPendingOnboarding, lockPendingOnboarding, saveOnboardingSubmission } from './employeeOnboardingRepository';

const decode = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;

export async function getPendingOnboarding(employeeId: string) {
  const row = await findPendingOnboarding(employeeId);
  const saved = row?.answers ? decode(row.answers) as Record<string, unknown> : null;
  const previous = saved ? (saved.__onboardingFormat === 2 ? { values: saved.values, photo: saved.photo } : { values: saved }) : null;
  return row ? { id: row.id, template: decode(row.template), expectedDate: row.expectedDate, previous, declaration: onboardingDeclaration } : null;
}

export async function submitOnboarding(employeeId: string, body: unknown): Promise<void> {
  await transaction(async conn => {
    const row = await lockPendingOnboarding(conn, employeeId);
    if (!row) throw notFound('没有待填写的入职申请');
    const payload = body as { __onboardingFormat?: number; values?: unknown; photo?: unknown; signature?: unknown; declarationAccepted?: unknown };
    const isNew = payload?.__onboardingFormat === 2;
    const answers = validateAnswers(parse(formTemplateSchema, decode(row.template_json)), isNew ? payload.values : body);
    const attachments = isNew ? validateOnboardingAttachments(payload.photo, payload.signature) : {};
    if (!isNew || payload.declarationAccepted !== true) throw badRequest('请先阅读并同意声明');
    if (!payload.signature) throw badRequest('请先手写签名');
    const stored = isNew ? { __onboardingFormat: 2, values: answers, ...attachments, declaration: onboardingDeclaration, declarationAccepted: payload.declarationAccepted === true } : answers;
    await saveOnboardingSubmission(conn, row.id, stored);
  });
}
