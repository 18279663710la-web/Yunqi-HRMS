import { get } from '../../utils/request';

export const ONBOARDING_REQUIRED = '/pages/onboarding-required/onboarding-required';
export const ONBOARDING_FORM = '/pages/onboarding/onboarding';
export function destinationFor(isChairperson: boolean, hasPending: boolean): string {
  return isChairperson ? '/pages/approval/approval' : hasPending ? ONBOARDING_REQUIRED : '/pages/index/index';
}
export async function getEntryDestination(isChairperson: boolean): Promise<string> {
  if (isChairperson) return destinationFor(true, false);
  const pending = await get<{ id: number } | null>('/onboarding-form/pending', undefined, { silent: true });
  return destinationFor(false, !!pending);
}
