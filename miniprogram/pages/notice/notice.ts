import * as noticesApi from '../../services/notices/api';
import type { Notice, NoticeCategory } from '../../types/models';
import type { InputEvent, TapEvent } from '../../types/ui';

const PAGE_SIZE = 10;

interface NoticeData {
  categories: NoticeCategory[];
  activeCategory: string;
  keyword: string;
  list: Notice[];
  unread: number;
  loading: boolean;
  page: number;
  hasMore: boolean;
  loadingMore: boolean;
}

interface NoticeCustom {
  loadSeq: number;
  load(reset?: boolean): Promise<void>;
  loadMore(): Promise<void>;
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
    page: 1,
    hasMore: false,
    loadingMore: false,
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
    void this.load(true);
  },

  onPullDownRefresh() {
    return this.load(true).then(() => { wx.stopPullDownRefresh(); });
  },

  /** reset=true 重置到第一页（进入页面/切换分类/搜索）；否则按当前页追加 */
  async load(reset = false): Promise<void> {
    const seq = ++this.loadSeq;
    if (!reset && this.data.loadingMore) return;
    try {
      const page = reset ? 1 : this.data.page + 1;
      const [res, unread] = await Promise.all([
        noticesApi.getNoticePage({
          category: this.data.activeCategory,
          keyword: this.data.keyword,
          page,
          pageSize: PAGE_SIZE,
        }),
        reset ? noticesApi.getUnreadNoticeCount() : Promise.resolve(this.data.unread),
      ]);
      if (seq !== this.loadSeq) return;
      const list = reset ? res.items : this.data.list.concat(res.items);
      this.setData({ list, unread, page, hasMore: res.hasMore, loading: false, loadingMore: false });
    } catch {
      if (seq !== this.loadSeq) return;
      this.setData({ loading: false, loadingMore: false });
    }
  },

  async loadMore(): Promise<void> {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return;
    this.setData({ loadingMore: true });
    await this.load(false);
  },

  onReachBottom() {
    void this.loadMore();
  },

  onCategory(e: TapEvent) {
    const key = String(e.currentTarget.dataset.key || '');
    if (key === this.data.activeCategory) return;
    this.setData({ activeCategory: key });
    void this.load(true);
  },

  onSearch(e: InputEvent) {
    this.setData({ keyword: e.detail.value });
    void this.load(true);
  },

  clearSearch() {
    this.setData({ keyword: '' });
    void this.load(true);
  },

  goDetail(e: TapEvent) {
    wx.navigateTo({ url: `/pages/notice-detail/notice-detail?id=${e.currentTarget.dataset.id}` });
  },
});
