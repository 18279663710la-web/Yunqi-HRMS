import * as contactsApi from '../../services/contacts/api';
import type { EmployeeDetail } from '../../types/models';
import type { TapEvent } from '../../types/ui';
import { formatPhone, toast } from '../../utils/util';

interface ContactDetailData {
  id: string;
  emp: (EmployeeDetail & { phoneText: string }) | null;
}

interface ContactDetailCustom {
  load(): Promise<void>;
  onCall(): void;
  onCopy(e: TapEvent): void;
  onChat(): void;
  goColleague(e: TapEvent): void;
}

Page<ContactDetailData, ContactDetailCustom>({
  data: {
    id: '',
    emp: null,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    void this.load();
  },

  async load(): Promise<void> {
    try {
      const emp = await contactsApi.getEmployeeDetail(this.data.id);
      this.setData({ emp: { ...emp, phoneText: formatPhone(emp.phone) } });
    } catch {
      toast('未找到该同事的信息');
      setTimeout(() => wx.navigateBack(), 900);
    }
  },

  onCall() {
    const emp = this.data.emp;
    if (!emp) return;
    wx.makePhoneCall({
      phoneNumber: emp.phone,
      fail: () => toast('已取消拨号'),
    });
  },

  onCopy(e: TapEvent) {
    const value = String(e.currentTarget.dataset.value || '');
    wx.setClipboardData({
      data: value,
      success: () => toast('已复制'),
    });
  },

  onChat() {
    wx.showModal({
      title: '发起会话',
      content: '将跳转至企业微信与同事发起会话。需在「企业微信」后台完成应用绑定后启用。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  goColleague(e: TapEvent) {
    const id = String(e.currentTarget.dataset.id || '');
    wx.redirectTo({ url: `/pages/contact-detail/contact-detail?id=${id}` });
  },

  onShareAppMessage() {
    const { emp } = this.data;
    return {
      title: emp ? `${emp.name} · ${emp.position}` : '员工名片',
      path: `/pages/contact-detail/contact-detail?id=${this.data.id}`,
    };
  },
});
