import { ONBOARDING_FORM } from '../../services/onboarding/onboardingGate';
import { clearSession } from '../../utils/request';

Page({
  openOnboarding() { wx.redirectTo({ url: ONBOARDING_FORM }); },
  switchAccount() { clearSession(); wx.reLaunch({ url: '/pages/login/login' }); },
});
