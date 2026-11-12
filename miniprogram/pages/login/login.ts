import type { IAppOption } from '../../app';
import * as authApi from '../../services/auth/api';
import type { InputEvent } from '../../types/ui';
import { getToken } from '../../utils/request';
import { getApiOrigin, setApiOriginOverride } from '../../utils/apiOrigin';
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
  onServerSetting(): void;
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

  /** 真机网络切换时，长按登录页底部手动指定后端地址；留空恢复自动探测。 */
  onServerSetting() {
    wx.showModal({
      title: '后端地址',
      content: `当前：${getApiOrigin()}`,
      editable: true,
      placeholderText: '如 10.62.56.146 或 172.20.10.14:3100',
      confirmText: '保存',
      cancelText: '取消',
      success: (result) => {
        if (!result.confirm) return;
        const origin = setApiOriginOverride(result.content || '');
        if (origin === null) {
          toast('地址格式无效');
          return;
        }
        toast(origin ? `已保存：${origin}` : '已恢复自动检测');
      },
    });
  },
});
