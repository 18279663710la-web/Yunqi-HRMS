import { get } from '../../utils/request';

export const ONBOARDING_REQUIRED = '/pages/onboarding-required/onboarding-required';
export const ONBOARDING_FORM = '/pages/onboarding/onboarding';
export function destinationFor(hasPending: boolean): string {
  return hasPending ? ONBOARDING_REQUIRED : '/pages/index/index';
}
export async function getEntryDestination(): Promise<string> {
  const pending = await get<{ id: number } | null>('/onboarding-form/pending', undefined, { silent: true });
  return destinationFor(!!pending);
}
