import * as noticesApi from '../../services/notices/api';
import type { Notice, NoticeCategory } from '../../types/models';
import type { InputEvent, TapEvent } from '../../types/ui';

interface NoticeData {
  categories: NoticeCategory[];
  activeCategory: string;
  keyword: string;
  list: Notice[];
  unread: number;
  loading: boolean;
}

interface NoticeCustom {
  loadSeq: number;
  load(): Promise<void>;
  onCategory(e: TapEvent): void;
  onSearch(e: InputEvent): void;
  clearSearch(): void;
  goDetail(e: TapEvent): void;
}

Page<NoticeData, NoticeCustom>({
  data: {
    categories: [],
    activeCategory: 'all',
    keyword: '',
    list: [],
    unread: 0,
    loading: true,
  },

  loadSeq: 0,

  async onLoad() {
    try {
      this.setData({ categories: await noticesApi.getNoticeCategories() });
    } catch {
      // 请求层已提示
    }
  },

  onShow() {
    void this.load();
  },

  onPullDownRefresh() {
    return this.load().then(() => { wx.stopPullDownRefresh(); });
  },

  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    try {
      const [list, unread] = await Promise.all([
        noticesApi.getNotices({
          category: this.data.activeCategory,
          keyword: this.data.keyword,
        }),
        noticesApi.getUnreadNoticeCount(),
      ]);
      if (seq !== this.loadSeq) return;
      this.setData({ list, loading: false, unread });
    } catch {
      this.setData({ loading: false });
    }
  },

  onCategory(e: TapEvent) {
    const key = String(e.currentTarget.dataset.key || '');
    if (key === this.data.activeCategory) return;
    this.setData({ activeCategory: key });
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

  goDetail(e: TapEvent) {
    wx.navigateTo({ url: `/pages/notice-detail/notice-detail?id=${e.currentTarget.dataset.id}` });
  },
});
