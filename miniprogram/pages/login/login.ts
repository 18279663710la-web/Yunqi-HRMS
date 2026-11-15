import type { IAppOption } from '../../app';
import * as authApi from '../../services/auth/api';
import type { InputEvent } from '../../types/ui';
import { getToken, isWechatAutoLoginSuppressed } from '../../utils/request';
import { getApiOrigin, setApiOriginOverride } from '../../utils/apiOrigin';
import { toast } from '../../utils/util';
import { getEntryDestination, ONBOARDING_REQUIRED } from '../../services/onboarding/onboardingGate';

interface LoginData {
  loginName: string;
  password: string;
  loading: boolean;
  checking: boolean;
  /** 服务端是否已配置微信一键登录（未配置时隐藏微信按钮） */
  wxConfigured: boolean;
  wechatLoading: boolean;
}

interface LoginCustom {
  checkSession(): Promise<void>;
  tryWechatLogin(silent: boolean): Promise<boolean>;
  maybeOfferWechatBind(): Promise<void>;
  onLoginNameInput(e: InputEvent): void;
  onPasswordInput(e: InputEvent): void;
  onSubmit(): Promise<void>;
  onWechatLogin(): Promise<void>;
  onServerSetting(): void;
}

Page<LoginData, LoginCustom>({
  data: {
    loginName: '',
    password: '',
    loading: false,
    checking: true,
    wxConfigured: false,
    wechatLoading: false,
  },

  onLoad() {
    void this.checkSession();
  },

  /** 已有有效登录态时直接进入工作台；无登录态时先静默尝试微信一键登录 */
  async checkSession(): Promise<void> {
    const wxConfigured = await authApi
      .wechatStatus()
      .then((r) => !!r.configured)
      .catch(() => false);
    this.setData({ wxConfigured });

    if (!getToken()) {
      // 冷启动静默尝试微信一键登录：仅当服务端已配置、当前微信号已绑定时成功。
      // 用户主动退出登录后（本次运行内）不再自动登录，保留“退出”的意义。
      if (wxConfigured && !isWechatAutoLoginSuppressed()) {
        const ok = await this.tryWechatLogin(true);
        if (ok) return;
      }
      this.setData({ checking: false });
      return;
    }
    try {
      const user = await authApi.getCurrentUser();
      getApp<IAppOption>().globalData.userInfo = user;
      const destination = await getEntryDestination();
      if (destination === ONBOARDING_REQUIRED) wx.reLaunch({ url: destination });
      else wx.switchTab({ url: destination });
    } catch {
      // token 失效 / 网络异常：留在登录页
      this.setData({ checking: false });
    }
  },

  /** 微信一键登录（silent=true 时不弹错误提示），成功后进入工作台 */
  async tryWechatLogin(silent: boolean): Promise<boolean> {
    try {
      const user = await authApi.wechatLogin();
      getApp<IAppOption>().globalData.userInfo = user;
      const destination = await getEntryDestination();
      if (destination === ONBOARDING_REQUIRED) wx.reLaunch({ url: destination });
      else wx.switchTab({ url: destination });
      return true;
    } catch (err) {
      if (!silent) toast((err as { message?: string }).message || '微信一键登录失败，请稍后重试');
      return false;
    }
  },

  async onWechatLogin(): Promise<void> {
    const { wechatLoading, checking } = this.data;
    if (wechatLoading || checking) return;
    this.setData({ wechatLoading: true });
    const ok = await this.tryWechatLogin(false);
    if (!ok) this.setData({ wechatLoading: false });
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
      // 密码登录成功后，若服务端启用微信登录且本账号尚未绑定，引导一次性绑定
      await this.maybeOfferWechatBind();
      const destination = await getEntryDestination();
      if (destination === ONBOARDING_REQUIRED) wx.reLaunch({ url: destination });
      else wx.switchTab({ url: destination });
    } catch (err) {
      this.setData({ loading: false });
      toast((err as { message?: string }).message || '登录失败，请稍后重试');
    }
  },

  /** 服务端启用微信登录且当前账号未绑定时，询问是否绑定（绑定失败不打断登录流程） */
  async maybeOfferWechatBind(): Promise<void> {
    try {
      const binding = await authApi.wechatBinding();
      if (!binding.configured || binding.bound) return;
      const confirmed = await new Promise<boolean>((resolve) => {
        wx.showModal({
          title: '绑定微信',
          content: '绑定后下次可使用当前微信号一键登录，无需输入账号密码。是否绑定？',
          confirmText: '绑定',
          cancelText: '暂不',
          success: (res) => resolve(!!res.confirm),
          fail: () => resolve(false),
        });
      });
      if (!confirmed) return;
      await authApi.wechatBind();
      wx.showToast({ title: '微信绑定成功', icon: 'success' });
    } catch (err) {
      const message = (err as { message?: string })?.message;
      if (message) toast(message);
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
