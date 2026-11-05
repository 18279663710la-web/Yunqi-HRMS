/** 入职引导、填写和签名均属于提交前允许访问的流程。 */
const onboardingRoutes = new Set([
  'pages/onboarding-required/onboarding-required',
  'pages/onboarding/onboarding',
  'pages/onboarding-signature/onboarding-signature',
]);
export function isOnboardingRoute(route: string): boolean {
  return onboardingRoutes.has(route);
}
