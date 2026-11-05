import * as noticesApi from '../../services/notices/api';
import type { NoticeBlockView, NoticeDetailView } from '../../types/models';
import type { TapEvent } from '../../types/ui';
import { toast } from '../../utils/util';

/**
 * 订阅消息模板 ID
 * 使用步骤：小程序后台 → 订阅消息 → 申请「公告通知」类模板 → 把模板 ID 填到数组里
 */
const TMPL_IDS = ['请替换为你的订阅消息模板ID'];

interface NoticeDetailData {
  id: string;
  notice: NoticeDetailView | null;
  subscribed: boolean;
}

interface NoticeDetailCustom {
  load(): Promise<void>;
  onAttachment(e: TapEvent): void;
  onSubscribe(): void;
}

Page<NoticeDetailData, NoticeDetailCustom>({
  data: {
    id: '',
    notice: null,
    subscribed: false,
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

  onAttachment(e: TapEvent) {
    const name = String(e.currentTarget.dataset.name || '');
    wx.showModal({
      title: '附件下载',
      content: `「${name}」将以文件消息形式发送到你的微信，请在小程序后台配置下载域名后启用。`,
      showCancel: false,
      confirmText: '我知道了',
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
