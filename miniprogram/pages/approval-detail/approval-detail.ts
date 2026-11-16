import * as approvalsApi from '../../services/approvals/api';
import type { ApprovalDetailView, TimelineViewNode } from '../../types/models';
import type { InputEvent, TapEvent } from '../../types/ui';
import { getCustomTabBar } from '../../types/ui';
import { toast } from '../../utils/util';
import { resolveFileUrl } from '../../utils/request';

/** 流程节点状态 -> 样式 */
const NODE_CLASS: Record<string, string> = {
  done: 'node-done',
  current: 'node-current',
  wait: 'node-wait',
  reject: 'node-reject',
  stop: 'node-stop',
};

/** 头部主题 */
const HEAD_CLASS: Record<string, string> = {
  pending: 'head-pending',
  approved: 'head-approved',
  rejected: 'head-rejected',
  cancelled: 'head-cancelled',
};

interface DetailData {
  id: string;
  detail: ApprovalDetailView | null;
  headClass: string;
  showHeadNode: boolean;
  sheetVisible: boolean;
  actionType: 'approve' | 'reject';
  comment: string;
  quickComments: string[];
  submitting: boolean;
  retryingAi: boolean;
}

interface DetailCustom {
  aiTimer: number | undefined;
  aiPolling: boolean;
  active: boolean;
  load(silent?: boolean): Promise<void>;
  openApprove(): void;
  openReject(): void;
  closeSheet(): void;
  noop(): void;
  onCommentInput(e: InputEvent): void;
  onQuickComment(e: TapEvent): void;
  confirmAction(): Promise<void>;
  onCancel(): void;
  retryAi(): Promise<void>;
  onPreviewInvoice(e: TapEvent): void;
  onPreviewAttachment(e: TapEvent): void;
  onPreviewFieldAttachment(e: TapEvent): void;
  copyId(): void;
}

Page<DetailData, DetailCustom>({
  aiTimer: undefined,
  aiPolling: false,
  active: false,
  data: {
    id: '',
    detail: null,
    headClass: 'head-pending',
    showHeadNode: false,
    sheetVisible: false,
    actionType: 'approve',
    comment: '',
    quickComments: ['同意', '情况属实，同意', '方案已确认，同意', '请补充相关材料'],
    submitting: false,
    retryingAi: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    this.active = true;
    void this.load();
  },

  onHide() {
    this.active = false;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = undefined;
  },

  onUnload() {
    this.active = false;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = undefined;
  },

  async load(silent = false): Promise<void> {
    try {
      const raw = await approvalsApi.getApprovalDetail(this.data.id);
      raw.invoices = (raw.invoices || []).map((item) => ({ ...item, fileID: item.fileID ? resolveFileUrl(item.fileID) : '' }));
      raw.attachments = (raw.attachments || []).map((item) => ({ ...item, fileID: resolveFileUrl(item.fileID) }));
      raw.fieldAttachments = (raw.fieldAttachments || []).map((group) => ({ ...group, files: group.files.map((file) => ({ ...file, fileID: resolveFileUrl(file.fileID) })) }));
      const visibleTimeline = raw.timeline.filter((node) => node.role !== '系统查验' && node.role !== 'AI 审批');
      const timeline: TimelineViewNode[] = visibleTimeline.map((n, i) => ({
        ...n,
        _k: `node${i}`,
        nodeClass: NODE_CLASS[n.state] || 'node-wait',
        isLast: i === visibleTimeline.length - 1,
      }));

      // 发票附件合计
      const invoices = raw.invoices || [];
      const invoiceTotal = invoices
        .reduce((sum, item) => sum + (Number(item.totalAmount) || 0), 0)
        .toFixed(2);

      const nodeText = raw.node || '';
      this.setData({
        detail: { ...raw, timeline, invoiceTotal },
        headClass: HEAD_CLASS[raw.status] || 'head-pending',
        showHeadNode: Boolean(nodeText) && !nodeText.includes('AI') && !nodeText.includes('系统'),
      });
      if (this.aiTimer) clearTimeout(this.aiTimer);
      const polling = this.active && (raw.aiAdvice?.status === 'queued' || raw.aiAdvice?.status === 'processing' || raw.workflowAiStatus === 'queued' || raw.workflowAiStatus === 'processing');
      this.aiPolling = polling;
      if (polling) {
        this.aiTimer = setTimeout(() => { void this.load(true); }, 5000);
      }
    } catch {
      // 轮询期间的临时失败（弱网/重启）不终止轮询，延迟后重试；非轮询态的失败仍按单据不存在处理。
      if (silent && this.active && this.aiPolling) {
        this.aiTimer = setTimeout(() => { void this.load(true); }, 10000);
      } else if (!silent) {
        toast('审批单不存在或已被删除');
        setTimeout(() => wx.navigateBack(), 900);
      }
    }
  },

  async retryAi(): Promise<void> {
    if (this.data.retryingAi) return;
    this.setData({ retryingAi: true });
    try {
      await approvalsApi.retryWorkflowAi(this.data.id);
      toast('已重新提交');
      await this.load();
    } catch {
      // 请求层已提示。
    } finally { this.setData({ retryingAi: false }); }
  },

  /* ---------------- 审批操作 ---------------- */

  openApprove() {
    this.setData({ sheetVisible: true, actionType: 'approve', comment: '' });
  },

  openReject() {
    this.setData({ sheetVisible: true, actionType: 'reject', comment: '' });
  },

  closeSheet() {
    this.setData({ sheetVisible: false });
  },

  noop() {
    /* 阻止冒泡 */
  },

  onCommentInput(e: InputEvent) {
    this.setData({ comment: e.detail.value });
  },

  onQuickComment(e: TapEvent) {
    this.setData({ comment: String(e.currentTarget.dataset.text || '') });
  },

  async confirmAction(): Promise<void> {
    const { id, actionType, comment, submitting } = this.data;
    if (submitting) return;
    if (actionType === 'reject' && !comment.trim()) {
      toast('驳回时请填写审批意见');
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '处理中...', mask: true });

    try {
      const res = await approvalsApi.submitApprovalAction(id, actionType, comment.trim());
      wx.hideLoading();
      this.setData({ submitting: false, sheetVisible: false });
      wx.showToast({ title: res.message || '操作成功', icon: 'none', duration: 1800 });

      // 同步更新自定义 tabBar 角标
      const tabBar = getCustomTabBar(this);
      if (tabBar) tabBar.refreshBadge();

      await this.load();
    } catch {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },

  onCancel() {
    wx.showModal({
      title: '撤销申请',
      content: '撤销后该审批单将终止流转，确定要撤销吗？',
      confirmText: '确定撤销',
      confirmColor: '#F04438',
      success: (res) => {
        if (!res.confirm) return;
        void (async () => {
          try {
            const result = await approvalsApi.cancelApproval(this.data.id);
            toast(result.message);
            await this.load();
          } catch {
            // 请求层已提示
          }
        })();
      },
    });
  },

  /** 放大查看发票原图 */
  onPreviewAttachment(e: TapEvent) {
    const list = this.data.detail?.attachments || [];
    const index = Number(e.currentTarget.dataset.index) || 0;
    if (list[index]) wx.previewImage({ current: list[index].fileID, urls: list.map((item) => item.fileID) });
  },

  onPreviewFieldAttachment(e: TapEvent) {
    const groupIndex = Number(e.currentTarget.dataset.groupIndex) || 0;
    const index = Number(e.currentTarget.dataset.index) || 0;
    const files = this.data.detail?.fieldAttachments?.[groupIndex]?.files || [];
    if (files[index]) wx.previewImage({ current: files[index].fileID, urls: files.map((item) => item.fileID) });
  },

  onPreviewInvoice(e: TapEvent) {
    const list = (this.data.detail && this.data.detail.invoices) || [];
    const index = Number(e.currentTarget.dataset.index) || 0;
    const item = list[index];
    if (!item) return;

    // 有原图：直接全屏预览
    if (item.fileID) {
      const urls = list.map((inv) => inv.fileID || '').filter(Boolean);
      wx.previewImage({ current: item.fileID, urls });
      return;
    }

    // 无原图（扫码录入或演示数据）：改为展示结构化票面信息
    const money = (n: unknown) => `¥${(Number(n) || 0).toFixed(2)}`;
    const fromText =
      item.qrFrom === 'scan'
        ? '来源：扫发票二维码录入'
        : item.qrFrom === 'image'
          ? '来源：从发票图片中直读二维码'
          : '';
    const lines = [
      `发票类型：${item.invoiceType || '—'}`,
      item.invoiceCode ? `发票代码：${item.invoiceCode}` : '',
      `发票号码：${item.invoiceNumber || '—'}`,
      `开票日期：${item.invoiceDate || '—'}`,
      item.sellerName ? `销售方：${item.sellerName}` : '',
      `金额（不含税）：${money(item.amount)}`,
      `税额：${money(item.taxAmount)}`,
      `价税合计：${money(item.totalAmount)}`,
      item.checkCode ? `校验码：${item.checkCode}` : '',
      fromText,
    ].filter(Boolean);

    wx.showModal({
      title: item.qrFrom === 'scan' ? '扫码录入的发票' : item.isQR ? '二维码直读的发票' : '发票信息',
      content: lines.join('\n'),
      showCancel: false,
      confirmText: '关闭',
    });
  },

  copyId() {
    wx.setClipboardData({ data: this.data.id });
  },
});
