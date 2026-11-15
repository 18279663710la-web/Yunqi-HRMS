import * as noticesApi from '../../services/notices/api';
import type { NoticeBlockView, NoticeDetailView } from '../../types/models';
import type { TapEvent } from '../../types/ui';
import { toast } from '../../utils/util';
import { getBaseUrl, getToken } from '../../utils/request';

/**
 * 订阅消息模板 ID
 * 使用步骤：小程序后台 → 订阅消息 → 申请「公告通知」类模板 → 把模板 ID 填到数组里；
 * 未替换占位符时详情页自动隐藏订阅入口。
 */
const TMPL_IDS = ['请替换为你的订阅消息模板ID'];
const SUBSCRIBE_ENABLED = TMPL_IDS.some((id) => !!id && !id.includes('替换'));

interface NoticeDetailData {
  id: string;
  notice: NoticeDetailView | null;
  subscribed: boolean;
  subscribeEnabled: boolean;
}

interface NoticeDetailCustom {
  load(): Promise<void>;
  onAttachment(e: TapEvent): void;
  downloadAttachment(fileID: string, name: string): void;
  onSubscribe(): void;
}

Page<NoticeDetailData, NoticeDetailCustom>({
  data: {
    id: '',
    notice: null,
    subscribed: false,
    subscribeEnabled: SUBSCRIBE_ENABLED,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    void this.load();
  },

  async load(): Promise<void> {
    try {
      const notice = await noticesApi.getNoticeDetail(this.data.id);
      // 为内容块补充稳定的 key，避免渲染告警
      const blocks: NoticeBlockView[] = notice.blocks.map((b, i) => ({ ...b, _k: `blk${i}` }));
      this.setData({ notice: { ...notice, blocks } });
    } catch {
      toast('公告不存在或已下线');
      setTimeout(() => wx.navigateBack(), 900);
    }
  },

  /** 附件下载：真实附件经鉴权接口下载后打开；种子演示附件（无 fileID）保持提示 */
  onAttachment(e: TapEvent) {
    const name = String(e.currentTarget.dataset.name || '');
    const fileID = String(e.currentTarget.dataset.fileid || '');
    if (!fileID) {
      wx.showModal({
        title: '附件下载',
        content: `「${name}」为演示附件，暂无可下载文件。`,
        showCancel: false,
        confirmText: '我知道了',
      });
      return;
    }
    void this.downloadAttachment(fileID, name);
  },

  downloadAttachment(fileID: string, name: string) {
    wx.showLoading({ title: '下载中…', mask: true });
    wx.downloadFile({
      url: `${getBaseUrl()}${fileID}`,
      header: { Authorization: `Bearer ${getToken()}` },
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode !== 200) {
          toast('附件下载失败');
          return;
        }
        wx.openDocument({
          filePath: res.tempFilePath,
          showMenu: true,
          fail: () => toast(`「${name}」已下载，但当前设备无法预览该格式`),
        });
      },
      fail: () => {
        wx.hideLoading();
        toast('附件下载失败，请检查网络后重试');
      },
    });
  },

  onSubscribe() {
    if (this.data.subscribed) {
      wx.showToast({ title: '已开启提醒', icon: 'none' });
      return;
    }

    wx.requestSubscribeMessage({
      tmplIds: TMPL_IDS,
      success: (res) => {
        const accepted = TMPL_IDS.some((id) => res[id] === 'accept');
        this.setData({ subscribed: accepted });
        wx.showToast({
          title: accepted ? '已开启公告提醒' : '你拒绝了消息提醒',
          icon: 'none',
        });
      },
      fail: () => {
        wx.showModal({
          title: '请先配置订阅消息模板',
          content:
            '进入「微信公众平台 → 小程序后台 → 功能 → 订阅消息」，申请公告类模板后，把模板 ID 填入 pages/notice-detail/notice-detail.ts 顶部的 TMPL_IDS 即可启用。',
          showCancel: false,
          confirmText: '好的',
        });
      },
    });
  },

  onShareAppMessage() {
    const { notice } = this.data;
    return {
      title: notice ? notice.title : '公司公告',
      path: `/pages/notice-detail/notice-detail?id=${this.data.id}`,
    };
  },

  onShareTimeline() {
    const { notice } = this.data;
    return {
      title: notice ? notice.title : '公司公告',
      query: `id=${this.data.id}`,
    };
  },
});
