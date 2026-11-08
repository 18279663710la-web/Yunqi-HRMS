import * as authApi from '../../services/auth/api';
import * as approvalsApi from '../../services/approvals/api';
import * as ocr from '../../services/invoices/ocr';
import type {
  ApprovalField,
  ApprovalType,
  CreateApprovalPayload,
  Invoice,
  InvoiceChangeDetail,
  ExpensePrecheckResult,
} from '../../types/models';
import type { CustomEvent, InputEvent, PickerEvent, SwitchEvent, TapEvent } from '../../types/ui';
import { formatTime, toast } from '../../utils/util';
import { calculateLeaveDays } from '../../utils/leave-duration';
import { upload, resolveFileUrl, STATIC_BASE } from '../../utils/request';

/** OCR 自动填写涉及的字段，用于删除发票时回滚 */
const AUTO_FILL_KEYS = ['amount', 'date', 'expenseType', 'reason'] as const;

interface TypeWithInitial extends ApprovalType {
  initial: string;
}

interface InvoiceSummary {
  count: number;
  totalAmount: number;
  totalAmountText: string;
  taxAmount: string;
  hasMock: boolean;
}

interface ApprovalCreateData {
  types: TypeWithInitial[];
  typeKey: string;
  type: ApprovalType;
  fields: ApprovalField[];
  values: Record<string, string>;
  urgent: boolean;
  leader: { name: string; position: string };
  leaveApproverReady: boolean;
  expenseApproverReady: boolean;
  typeApproverReady: boolean;
  canSubmit: boolean;
  submitting: boolean;

  /* ---- 发票 OCR ---- */
  isExpense: boolean;
  recognized: Invoice[];
  invoiceSummary: InvoiceSummary | null;
  autoFillHint: string;
  recognizingInvoices: boolean;
  invoiceCheckReady: boolean;
  invoiceCheckMessage: string;
  attachments: Array<{ name: string; fileID: string; preview: string }>;
  uploadingAttachments: boolean;
  precheckResult: ExpensePrecheckResult | null;
  precheckRunning: boolean;
  precheckProgress: string;
  precheckStale: boolean;
}

interface ApprovalCreateCustom {
  autoFillSnapshot: Record<string, string> | null;
  lastAutoReason: string;
  defaultLeader: { name: string; position: string };
  precheckGeneration: number;
  precheckTask: { abort(): void } | null;
  approverGeneration: number;
  loadLeaveApprover(): Promise<void>;
  loadExpenseApprover(): Promise<void>;
  loadTypeApprover(type: string): Promise<void>;
  selectType(key: string): void;
  validate(values: Record<string, string>, fields?: ApprovalField[], typeKey?: string): boolean;
  buildTitle(type: ApprovalType, values: Record<string, string>): string;
  buildSummary(type: ApprovalType, values: Record<string, string>): string;
  formatValue(field: ApprovalField, raw: string): string;
  mapExpenseType(categories: string[]): string;
  buildInvoiceReason(recognized: Invoice[], sellers: string[], totalAmount: number): string;
  restoreAutoFill(): void;
  applyAutoFill(detail: InvoiceChangeDetail): void;
  onTypeTap(e: TapEvent): void;
  onInput(e: InputEvent): void;
  onPicker(e: PickerEvent): void;
  onUrgentChange(e: SwitchEvent): void;
  onInvoiceChange(e: CustomEvent<InvoiceChangeDetail>): void;
  addAttachments(): void;
  removeAttachment(e: TapEvent): void;
  onAttachmentName(e: InputEvent): void;
  markPrecheckChanged(): void;
  buildPayload(): CreateApprovalPayload;
  onAiPrecheck(): Promise<void>;
  onSubmit(): Promise<void>;
}

Page<ApprovalCreateData, ApprovalCreateCustom>({
  data: {
    types: [],
    typeKey: 'leave',
    type: {} as ApprovalType,
    fields: [],
    values: {},
    urgent: false,
    leader: { name: '', position: '' },
    leaveApproverReady: false,
    expenseApproverReady: false,
    typeApproverReady: false,
    canSubmit: false,
    submitting: false,

    /* ---- 发票 OCR ---- */
    isExpense: false,
    recognized: [],
    invoiceSummary: null,
    autoFillHint: '',
    recognizingInvoices: false,
    invoiceCheckReady: true,
    invoiceCheckMessage: '',
    attachments: [],
    uploadingAttachments: false,
    precheckResult: null,
    precheckRunning: false,
    precheckProgress: '',
    precheckStale: false,
  },

  /** 表单自动填写前的原值快照（删除发票后回滚） */
  autoFillSnapshot: null,
  lastAutoReason: '',
  defaultLeader: { name: '', position: '直属上级' },
  precheckGeneration: 0,
  precheckTask: null,
  approverGeneration: 0,

  onUnload() {
    this.precheckGeneration += 1;
    this.approverGeneration += 1;
    this.precheckTask?.abort();
    this.precheckTask = null;
  },

  async onLoad(options: Record<string, string | undefined>) {
    try {
      const [user, rawTypes] = await Promise.all([authApi.getCurrentUser(), approvalsApi.getApprovalTypes()]);
      const types: TypeWithInitial[] = rawTypes.map((t) => ({
        ...t,
        initial: t.name.slice(0, 1),
      }));
      const requested = options.type;
      const typeKey = types.some((t) => t.key === requested) ? (requested as string) : types[0].key;

      this.defaultLeader = { name: user.leaderName, position: '直属上级' };
      this.setData({
        types,
        leader: this.defaultLeader,
      });
      this.selectType(typeKey);
    } catch {
      toast('审批类型加载失败，请稍后重试');
    }
  },

  onShow() {
    if (!this.data.types.length) return;
    this.approverGeneration += 1;
    this.setData({ leader: { name: '正在查找审批人', position: '' }, leaveApproverReady: false, expenseApproverReady: false, typeApproverReady: false });
    if (this.data.typeKey === 'leave') void this.loadLeaveApprover();
    else if (this.data.typeKey === 'expense') void this.loadExpenseApprover();
    else if (this.data.typeKey === 'overtime' || this.data.typeKey === 'travel' || this.data.typeKey === 'purchase') void this.loadTypeApprover(this.data.typeKey);
  },

  /* ---------------- 类型切换 ---------------- */

  selectType(key: string) {
    const { types } = this.data;
    const type = types.find((t) => t.key === key) || types[0];
    if (!type) return;
    const fields = type.key === 'overtime' ? type.fields.filter((field) => field.key !== 'compensation') : type.fields;
    this.approverGeneration += 1;
    this.precheckGeneration += 1;
    this.precheckTask?.abort();
    this.precheckTask = null;
    const today = formatTime(new Date(), 'YYYY-MM-DD');

    const values: Record<string, string> = {};
    fields.forEach((f) => {
      if (f.type === 'date') values[f.key] = today;
      else if (f.type === 'time') values[f.key] = f.default || '';
      else values[f.key] = '';
    });
    if (type.key === 'leave') {
      const days = calculateLeaveDays(values.startDate, values.startClock, values.endDate, values.endClock);
      values.days = days === null ? '' : String(days);
    }

    // 切换类型时清空发票识别状态（组件由 wx:if 销毁重建）
    this.autoFillSnapshot = null;
    this.lastAutoReason = '';

    this.setData({
      typeKey: type.key,
      type,
      fields,
      values,
      urgent: false,
      canSubmit: this.validate(values, fields, type.key),
      isExpense: type.key === 'expense',
      recognized: [],
      invoiceSummary: null,
      autoFillHint: '',
      recognizingInvoices: false,
      invoiceCheckReady: type.key !== 'expense',
      invoiceCheckMessage: type.key === 'expense' ? '请先添加至少一张发票' : '',
      attachments: [],
      precheckResult: null,
      precheckRunning: false,
      precheckProgress: '',
      precheckStale: false,
      leader: { name: '正在查找审批人', position: '' },
      leaveApproverReady: false,
      expenseApproverReady: false,
      typeApproverReady: false,
    });
    if (type.key === 'leave') void this.loadLeaveApprover();
    if (type.key === 'expense') void this.loadExpenseApprover();
    if (type.key === 'overtime' || type.key === 'travel' || type.key === 'purchase') void this.loadTypeApprover(type.key);
  },

  async loadLeaveApprover(): Promise<void> {
    const generation = this.approverGeneration;
    try {
      const approver = await approvalsApi.getLeaveApprover();
      if (this.data.typeKey !== 'leave' || this.approverGeneration !== generation) return;
      this.setData({ leader: { name: approver.name, position: approver.role }, leaveApproverReady: true });
    } catch {
      if (this.data.typeKey === 'leave' && this.approverGeneration === generation) this.setData({ leader: { name: '审批人不可用，请联系管理员', position: '' }, leaveApproverReady: false });
    }
  },

  async loadExpenseApprover(): Promise<void> {
    const generation = this.approverGeneration;
    try {
      const approver = await approvalsApi.getExpenseApprover();
      if (this.data.typeKey !== 'expense' || this.approverGeneration !== generation) return;
      this.setData({ leader: { name: approver.name, position: approver.role }, expenseApproverReady: true });
    } catch (error) {
      if (this.data.typeKey === 'expense' && this.approverGeneration === generation) this.setData({ leader: { name: (error as { message?: string }).message || '审批人不可用，请联系管理员', position: '' }, expenseApproverReady: false });
    }
  },

  async loadTypeApprover(type: string): Promise<void> {
    const generation = this.approverGeneration;
    try {
      const approver = await approvalsApi.getApprovalApprover(type);
      if (this.data.typeKey !== type || this.approverGeneration !== generation) return;
      this.setData({ leader: { name: approver.name, position: approver.role }, typeApproverReady: true });
    } catch (error) {
      if (this.data.typeKey === type && this.approverGeneration === generation) this.setData({ leader: { name: (error as { message?: string }).message || '审批人不可用，请联系管理员', position: '' }, typeApproverReady: false });
    }
  },

  onTypeTap(e: TapEvent) {
    const key = String(e.currentTarget.dataset.key || '');
    if (key === this.data.typeKey) return;
    this.selectType(key);
  },

  /* ---------------- 表单 ---------------- */

  validate(values: Record<string, string>, fields?: ApprovalField[], typeKey?: string): boolean {
    const list = fields || this.data.fields;
    return list.every((f) => !f.required || String(values[f.key] || '').trim() !== '') &&
      ((typeKey || this.data.typeKey) !== 'leave' || calculateLeaveDays(values.startDate, values.startClock, values.endDate, values.endClock) !== null);
  },

  onInput(e: InputEvent) {
    this.markPrecheckChanged();
    const key = String(e.currentTarget.dataset.key || '');
    const values = { ...this.data.values, [key]: e.detail.value };
    this.setData({ values, canSubmit: this.validate(values) });
  },

  onPicker(e: PickerEvent) {
    const key = String(e.currentTarget.dataset.key || '');
    const field = this.data.fields.find((f) => f.key === key);
    if (!field) return;
    this.markPrecheckChanged();

    let value = String(e.detail.value);
    if (field.type === 'picker' && field.options) value = field.options[Number(value)] || '';

    const values = { ...this.data.values, [key]: value };
    if (this.data.typeKey === 'leave') {
      const days = calculateLeaveDays(values.startDate, values.startClock, values.endDate, values.endClock);
      values.days = days === null ? '' : String(days);
    }
    this.setData({ values, canSubmit: this.validate(values) });
  },

  onUrgentChange(e: SwitchEvent) {
    this.setData({ urgent: e.detail.value });
  },

  /* ---------------- 发票 OCR 联动 ---------------- */

  /** 组件在识别完成 / 删除 / 重试时会广播最新状态 */
  onInvoiceChange(e: CustomEvent<InvoiceChangeDetail>) {
    this.markPrecheckChanged();
    const detail = e.detail;
    const recognized = detail.recognized || [];
    this.setData({ invoiceCheckReady: detail.checkReady, invoiceCheckMessage: detail.checkMessage });

    // 发票被全部删除：回滚之前自动填写的字段
    if (!recognized.length) {
      if (detail.removed) this.restoreAutoFill();
      this.setData({
        recognized: [],
        invoiceSummary: null,
        autoFillHint: '',
        recognizingInvoices: !!detail.recognizing,
      });
      return;
    }

    this.applyAutoFill(detail);
  },

  /**
   * 用识别结果自动填表
   * 金额取多张发票价税合计，日期取最早开票日期，报销类型按发票消费类型映射
   */
  applyAutoFill(detail: InvoiceChangeDetail) {
    const { recognized, totalAmount, earliestDate, sellers, categories, count, taxAmount, recognizing } = detail;

    // 首次自动填写前记录原值，便于删除发票后回滚
    if (!this.autoFillSnapshot) {
      const snapshot: Record<string, string> = {};
      AUTO_FILL_KEYS.forEach((k) => {
        snapshot[k] = this.data.values[k] || '';
      });
      this.autoFillSnapshot = snapshot;
    }

    const values = { ...this.data.values };
    const filled: string[] = [];

    // 1) 报销金额 = 发票价税合计
    const amountText = Number(totalAmount).toFixed(2);
    if (values.amount !== amountText) {
      values.amount = amountText;
      filled.push('报销金额');
    }

    // 2) 费用发生日期 = 最早开票日期
    if (earliestDate && values.date !== earliestDate) {
      values.date = earliestDate;
      filled.push('费用发生日期');
    }

    // 3) 报销类型：按出现次数最多的发票消费类型映射，且必须命中表单选项
    const mapped = this.mapExpenseType(categories);
    if (mapped && values.expenseType !== mapped) {
      values.expenseType = mapped;
      filled.push('报销类型');
    }

    // 4) 费用说明：仅当用户没写过、或上次也是自动生成时才覆盖
    const reason = this.buildInvoiceReason(recognized, sellers, totalAmount);
    if ((!values.reason || values.reason === this.lastAutoReason) && values.reason !== reason) {
      values.reason = reason;
      this.lastAutoReason = reason;
      filled.push('费用说明');
    }

    this.setData({
      values,
      recognized,
      invoiceSummary: {
        count,
        totalAmount,
        totalAmountText: Number(totalAmount).toFixed(2),
        taxAmount: Number(taxAmount || 0).toFixed(2),
        hasMock: recognized.some((item) => item.isMock),
      },
      recognizingInvoices: !!recognizing,
      autoFillHint: filled.length ? `已自动填写：${filled.join('、')}（可手动修改）` : '',
      canSubmit: this.validate(values),
    });
  },

  /** 删除全部发票后，把自动填写过的字段还原 */
  restoreAutoFill() {
    const snapshot = this.autoFillSnapshot;
    if (!snapshot) return;

    const values = { ...this.data.values };
    AUTO_FILL_KEYS.forEach((k) => {
      values[k] = snapshot[k];
    });

    this.autoFillSnapshot = null;
    this.lastAutoReason = '';

    this.setData({ values, canSubmit: this.validate(values) });
  },

  mapExpenseType(categories: string[] = []): string {
    const field = this.data.fields.find((f) => f.key === 'expenseType');
    if (!field || !field.options) return '';

    const counter: Record<string, number> = {};
    categories.forEach((c) => {
      counter[c] = (counter[c] || 0) + 1;
    });
    const top = Object.keys(counter).sort((a, b) => counter[b] - counter[a])[0];
    if (!top) return '';

    const mapped = ocr.mapCategoryToExpenseType(top);
    return field.options.indexOf(mapped) > -1 ? mapped : '';
  },

  buildInvoiceReason(recognized: Invoice[], sellers: string[], totalAmount: number): string {
    const names = (sellers || []).slice(0, 2).join('、');
    const suffix = (sellers || []).length > 2 ? ' 等' : '';
    const mock = recognized.some((item) => item.isMock) ? '（发票识别为演示数据）' : '';
    return `${names}${suffix}共 ${recognized.length} 张发票，价税合计 ¥${Number(totalAmount).toFixed(2)}${mock}，发票明细见附件。`;
  },

  /* ---------------- 标题与摘要 ---------------- */

  buildTitle(type: ApprovalType, v: Record<string, string>): string {
    switch (type.key) {
      case 'leave':
        return `请假申请 · ${v.leaveType || '请假'} ${v.days || ''} 天`;
      case 'expense':
        return `报销申请 · ¥${v.amount || '0'}`;
      case 'overtime':
        return `加班申请 · ${v.date || ''} ${v.startTime || ''}-${v.endTime || ''}`;
      case 'travel':
        return `出差申请 · ${v.city || ''}`;
      case 'purchase':
        return `采购申请 · ${v.item || ''}`;
      default:
        return `${type.name}申请`;
    }
  },

  buildSummary(type: ApprovalType, v: Record<string, string>): string {
    switch (type.key) {
      case 'leave':
        return `${v.startDate || ''} 至 ${v.endDate || ''}，共 ${v.days || 0} 天`;
      case 'expense':
        return `${v.expenseType || ''} · 费用日期 ${v.date || ''}`;
      case 'overtime':
        return `${v.date || ''} 加班，补偿方式：加班费`;
      case 'travel':
        return `${v.startDate || ''} 至 ${v.endDate || ''}，目的地：${v.city || ''}`;
      case 'purchase':
        return `${v.item || ''}，预估 ¥${v.amount || '0'}`;
      default:
        return '';
    }
  },

  formatValue(field: ApprovalField, raw: string): string {
    const value = String(raw || '');
    if (!value) return '—';
    if (field.type === 'money') return `¥${value}`;
    return value;
  },

  /* ---------------- 提交 ---------------- */

  addAttachments() {
    if (this.data.uploadingAttachments) return;
    const remaining = 9 - this.data.attachments.length;
    if (remaining <= 0) { toast('最多上传 9 张补充材料'); return; }
    wx.chooseMedia({ count: remaining, mediaType: ['image'], sourceType: ['album', 'camera'], success: (result) => {
      this.markPrecheckChanged();
      void (async () => {
        this.setData({ uploadingAttachments: true });
        try {
          for (const file of result.tempFiles) {
            const uploaded = await upload<{ fileUrl: string }>({ url: '/invoices/image', filePath: file.tempFilePath, name: 'file' });
            this.setData({ attachments: [...this.data.attachments, { name: '', fileID: uploaded.fileUrl, preview: resolveFileUrl(uploaded.fileUrl) }] });
          }
        } finally { this.setData({ uploadingAttachments: false }); }
      })().catch(() => toast('材料上传失败，请重试'));
    } });
  },

  removeAttachment(e: TapEvent) {
    this.markPrecheckChanged();
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ attachments: this.data.attachments.filter((_, i) => i !== index) });
  },

  onAttachmentName(e: InputEvent) {
    this.markPrecheckChanged();
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ attachments: this.data.attachments.map((item, i) => i === index ? { ...item, name: e.detail.value } : item) });
  },

  markPrecheckChanged() {
    if (this.data.precheckResult || this.data.precheckRunning) this.setData({ precheckStale: true });
  },

  buildPayload(): CreateApprovalPayload {
    const { type, fields, values, urgent } = this.data;
    const form = fields.map((f) => ({ label: f.label, value: this.formatValue(f, values[f.key]) }));
    const invoices = type.key === 'expense' ? this.data.recognized.map((item) => ({ ...item, fileID: item.fileID?.startsWith(`${STATIC_BASE}/uploads/`) ? item.fileID.slice(STATIC_BASE.length) : item.fileID })) : [];
    if (invoices.length) form.push({ label: '发票附件', value: `${invoices.length} 张，价税合计 ¥${this.data.invoiceSummary?.totalAmountText || '0.00'}` });
    return { type: type.key, title: this.buildTitle(type, values), summary: this.buildSummary(type, values), form, invoices, attachments: type.key === 'expense' ? this.data.attachments.map(({ name, fileID }) => ({ name: name.trim(), fileID })) : [], urgent };
  },

  async onAiPrecheck(): Promise<void> {
    if (this.data.precheckRunning || this.data.submitting) return;
    if (this.data.uploadingAttachments || this.data.recognizingInvoices) { toast('材料上传或发票识别中，请稍候'); return; }
    if (this.data.attachments.some((item) => !item.name.trim())) { toast('请填写补充材料名称'); return; }
    if (!this.validate(this.data.values)) { toast('请先填写申请内容'); return; }
    if (!this.data.invoiceCheckReady || !this.data.recognized.length) { toast(this.data.invoiceCheckMessage || '请先完成发票查重和真伪查验'); return; }
    const generation = ++this.precheckGeneration;
    this.setData({ precheckRunning: true, precheckResult: null, precheckProgress: '', precheckStale: false });
    const task = approvalsApi.previewExpenseApproval(this.buildPayload(), (event) => {
      if (this.precheckGeneration !== generation) return;
      if (event.type === 'progress') this.setData({ precheckProgress: event.text });
      else this.setData({ precheckResult: { status: event.status, advice: event.advice }, precheckProgress: '' });
    });
    this.precheckTask = task;
    try { await task.promise; }
    catch (error) {
      if (this.precheckGeneration === generation) {
        this.setData({ precheckResult: { status: 'failed', advice: null }, precheckProgress: '' });
        toast((error as { message?: string }).message || 'AI 预审失败，请重试');
      }
    } finally {
      if (this.precheckGeneration === generation) { this.precheckTask = null; this.setData({ precheckRunning: false }); }
    }
  },

  async onSubmit(): Promise<void> {
    const { type, fields, values, urgent, submitting, recognizingInvoices } = this.data;
    if (submitting) return;
    if (this.data.uploadingAttachments) { toast('材料上传中，请稍候'); return; }
    if (type.key === 'expense' && this.data.attachments.some((item) => !item.name.trim())) { toast('请填写补充材料名称'); return; }

    if (type.key === 'leave' && !this.data.leaveApproverReady) {
      toast('请假审批人不可用，请联系管理员');
      return;
    }
    if (type.key === 'expense' && !this.data.expenseApproverReady) {
      toast('报销审批人不可用，请联系超级管理员');
      return;
    }
    if ((type.key === 'overtime' || type.key === 'travel' || type.key === 'purchase') && !this.data.typeApproverReady) {
      toast('审批人不可用，请联系超级管理员');
      return;
    }

    if (recognizingInvoices) {
      toast('发票识别中，请稍候再提交');
      return;
    }
    if (type.key === 'expense' && !this.data.invoiceCheckReady) {
      toast(this.data.invoiceCheckMessage || '请先完成发票查重和真伪查验');
      return;
    }

    if (type.key === 'leave' && calculateLeaveDays(values.startDate, values.startClock, values.endDate, values.endClock) === null) {
      toast('请假结束时间须晚于开始时间');
      return;
    }

    if (!this.validate(values)) {
      const missing = fields.filter((f) => f.required && !String(values[f.key] || '').trim());
      toast(`请填写：${missing[0] ? missing[0].label : '必填项'}`);
      return;
    }

    if (type.key === 'travel' && values.startDate && values.endDate && values.endDate < values.startDate) {
      toast('结束日期不能早于开始日期');
      return;
    }
    if (type.key === 'overtime' && values.startTime && values.endTime && values.endTime <= values.startTime) {
      toast('结束时间需晚于开始时间');
      return;
    }

    const payload = this.buildPayload();
    if (this.data.precheckRunning) {
      this.precheckGeneration += 1;
      this.precheckTask?.abort();
      this.precheckTask = null;
      this.setData({ precheckRunning: false, precheckProgress: '' });
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: type.key === 'expense' ? '查验发票中...' : '提交中...', mask: true });

    try {
      await approvalsApi.createApproval(payload);
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: '提交成功', icon: 'success', duration: 1200 });
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) wx.navigateBack();
        else wx.switchTab({ url: '/pages/approval/approval' });
      }, 1100);
    } catch {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },
});
