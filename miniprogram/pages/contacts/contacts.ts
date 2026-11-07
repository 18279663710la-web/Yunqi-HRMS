import * as contactsApi from '../../services/contacts/api';
import type { EmployeeGroup } from '../../types/models';
import { getCustomTabBar, type InputEvent, type TapEvent } from '../../types/ui';
import { toast } from '../../utils/util';

interface ContactsData {
  jobTitles: contactsApi.JobTitle[];
  activeJobTitle: string;
  keyword: string;
  groups: EmployeeGroup[];
  letters: string[];
  total: number;
}

interface ContactsCustom {
  loadSeq: number;
  load(): Promise<void>;
  onJobTitle(e: TapEvent): void;
  onSearch(e: InputEvent): void;
  clearSearch(): void;
  onLetterTap(e: TapEvent): void;
  onCall(e: TapEvent): void;
  goDetail(e: TapEvent): void;
}

Page<ContactsData, ContactsCustom>({
  data: {
    jobTitles: [],
    activeJobTitle: '',
    keyword: '',
    groups: [],
    letters: [],
    total: 0,
  },

  loadSeq: 0,

  async onShow() {
    const tabBar = getCustomTabBar(this);
    if (tabBar) {
      tabBar.setData({ selected: 2 });
      tabBar.refreshBadge();
    }
    try {
      const jobTitles = await contactsApi.getJobTitles();
      const activeJobTitle = jobTitles.some(title => title.name === this.data.activeJobTitle) ? this.data.activeJobTitle : '';
      this.setData({ jobTitles, activeJobTitle });
    } catch { /* 请求层已提示 */ }
    void this.load();
  },

  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    try {
      const groups = await contactsApi.getEmployeeGroups({
        jobTitle: this.data.activeJobTitle,
        keyword: this.data.keyword,
      });
      if (seq !== this.loadSeq) return; // 丢弃过期请求（快速输入时）
      this.setData({
        groups,
        letters: groups.map((g) => g.letter),
        total: groups.reduce((n, g) => n + g.list.length, 0),
      });
    } catch {
      // 请求层已提示
    }
  },

  onJobTitle(e: TapEvent) {
    const name = String(e.currentTarget.dataset.name || '');
    this.setData({ activeJobTitle: name });
    void this.load();
  },

  onSearch(e: InputEvent) {
    this.setData({ keyword: e.detail.value });
    void this.load();
  },

  clearSearch() {
    this.setData({ keyword: '' });
    void this.load();
  },

  onLetterTap(e: TapEvent) {
    const letter = String(e.currentTarget.dataset.letter || '');
    wx.pageScrollTo({
      selector: `#letter-${letter}`,
      duration: 220,
      fail: () => toast('定位失败'),
    });
  },

  onCall(e: TapEvent) {
    const phone = String(e.currentTarget.dataset.phone || '');
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => toast('已取消拨号'),
    });
  },

  goDetail(e: TapEvent) {
    wx.navigateTo({ url: `/pages/contact-detail/contact-detail?id=${e.currentTarget.dataset.id}` });
  },
});
