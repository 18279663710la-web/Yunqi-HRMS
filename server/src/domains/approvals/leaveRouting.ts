import type { JobCategoryName } from '../../shared/types/admin';
import { badRequest } from '../../shared/utils/errors';

interface Applicant {
  id: string;
  jobCategory: JobCategoryName;
  isLeader: boolean;
}

interface Approver {
  id: string;
  name: string;
  active: boolean;
}

interface CategoryLeader extends Approver {
  jobCategory: JobCategoryName;
  isLeader: boolean;
}

/** 旧版职位路由保留用于历史逻辑核对；新申请使用后台统一配置。 */
export function resolveLeaveApprover(
  applicant: Applicant,
  leaders: CategoryLeader[],
  chairperson: Approver | null
): Approver {
  if (applicant.isLeader) {
    if (!chairperson || !chairperson.active || chairperson.id === applicant.id) {
      throw badRequest('董事长审批账号未配置或不可用，请联系管理员');
    }
    return chairperson;
  }

  const matches = leaders.filter((leader) => leader.isLeader && leader.jobCategory === applicant.jobCategory && leader.id !== applicant.id);
  if (matches.length !== 1 || !matches[0].active) {
    throw badRequest('本职位负责人未唯一配置或账号不可用，请联系管理员');
  }
  return matches[0];
}
