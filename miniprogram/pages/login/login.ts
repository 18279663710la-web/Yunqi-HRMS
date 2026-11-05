import type { IAppOption } from '../../app';
import * as authApi from '../../services/auth/api';
import type { InputEvent } from '../../types/ui';
import { getToken } from '../../utils/request';
import { toast } from '../../utils/util';
import { getEntryDestination, ONBOARDING_REQUIRED } from '../../services/onboarding/onboardingGate';

interface LoginData {
  loginName: string;
  password: string;
  loading: boolean;
  checking: boolean;
}

interface LoginCustom {
  checkSession(): Promise<void>;
  onLoginNameInput(e: InputEvent): void;
  onPasswordInput(e: InputEvent): void;
  onSubmit(): Promise<void>;
}

Page<LoginData, LoginCustom>({
  data: {
    loginName: '',
    password: '',
    loading: false,
    checking: true,
  },

  onLoad() {
    void this.checkSession();
  },

  /** 已有有效登录态时直接进入工作台，否则展示登录表单 */
  async checkSession(): Promise<void> {
    if (!getToken()) {
      this.setData({ checking: false });
      return;
    }
    try {
      const user = await authApi.getCurrentUser();
      getApp<IAppOption>().globalData.userInfo = user;
      const destination = await getEntryDestination(!!user.isChairperson);
      if (destination === ONBOARDING_REQUIRED) wx.reLaunch({ url: destination });
      else wx.switchTab({ url: destination });
    } catch {
      // token 失效 / 网络异常：留在登录页
      this.setData({ checking: false });
    }
  },

  onLoginNameInput(e: InputEvent) {
    this.setData({ loginName: e.detail.value });
  },

  onPasswordInput(e: InputEvent) {
    this.setData({ password: e.detail.value });
  },

  async onSubmit(): Promise<void> {
    const { loginName, password, loading, checking } = this.data;
    if (loading || checking) return;

    if (!loginName.trim()) {
      toast('请输入登录名');
      return;
    }
    if (!password) {
      toast('请输入密码');
      return;
    }

    this.setData({ loading: true });
    try {
      const user = await authApi.login(loginName.trim(), password);
      getApp<IAppOption>().globalData.userInfo = user;
      const destination = await getEntryDestination(!!user.isChairperson);
      if (destination === ONBOARDING_REQUIRED) wx.reLaunch({ url: destination });
      else wx.switchTab({ url: destination });
    } catch (err) {
      this.setData({ loading: false });
      toast((err as { message?: string }).message || '登录失败，请稍后重试');
    }
  },
});
