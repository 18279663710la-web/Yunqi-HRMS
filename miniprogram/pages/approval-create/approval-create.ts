import * as approvalsApi from '../../services/approvals/api';
import * as ocr from '../../services/invoices/ocr';
import type {
  ApprovalField,
  ApprovalType,
  CreateApprovalPayload,
  Invoice,
  InvoiceChangeDetail,
} from '../../types/models';
import type { CustomEvent, InputEvent, PickerEvent, SwitchEvent, TapEvent } from '../../types/ui';
import { formatTime, toast } from '../../utils/util';
import { calculateLeaveDays } from '../../utils/leave-duration';
import { upload, resolveFileUrl, getStaticBase } from '../../utils/request';

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

interface FormSegment {
  kind: 'fields' | 'invoice' | 'materials';
  key: string;
  fields: ApprovalField[];
}

/** 连续填写项合成一张卡片。发票附件和补充材料按设计顺序插入；未发布报销仍排在表单末尾。 */
function formSegments(typeKey: string, fields: ApprovalField[]): FormSegment[] {
  const segments: FormSegment[] = [];
  for (const field of fields) {
    if (field.type === 'attachment') {
      const kind: FormSegment['kind'] = field.key === 'invoiceFiles' ? 'invoice' : 'materials';
      segments.push({ kind, key: kind, fields: [] });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last?.kind === 'fields') last.fields.push(field);
    else segments.push({ kind: 'fields', key: `fields-${field.key}`, fields: [field] });
  }
  if (typeKey === 'expense') {
    if (!segments.some((segment) => segment.kind === 'invoice')) segments.push({ kind: 'invoice', key: 'invoice', fields: [] });
    if (!segments.some((segment) => segment.kind === 'materials')) segments.push({ kind: 'materials', key: 'materials', fields: [] });
  }
  return segments;
}

interface ApprovalCreateData {
  types: TypeWithInitial[];
  typeKey: string;
  type: ApprovalType;
  fields: ApprovalField[];
  segments: FormSegment[];
  values: Record<string, string>;
  urgent: boolean;
  approvers: Array<{ id: string; name: string; role: string }>;
  approverReady: boolean;
  approverHint: string;
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
}

interface ApprovalCreateCustom {
  autoFillSnapshot: Record<string, string> | null;
  lastAutoReason: string;
  approverGeneration: number;
  approverTimer: number;
  scheduleApprovers(values?: Record<string, string>, recognized?: Invoice[]): void;
  loadApprovers(generation: number, values: Record<string, string>, recognized: Invoice[]): Promise<void>;
  selectType(key: string): void;
  validate(values: Record<string, string>, fields?: ApprovalField[], typeKey?: string): boolean;
  buildTitle(type: ApprovalType, values: Record<string, string>): string;
  buildSummary(type: ApprovalType, values: Record<string, string>): string;
  formatValue(field: ApprovalField, raw: string): string;
  mapExpenseType(categories: string[]): string;
  buildInvoiceReason(recognized: Invoice[], sellers: string[], totalAmount: number): string;
  applyAutoFill(detail: InvoiceChangeDetail): void;
  onTypeTap(e: TapEvent): void;
  onInput(e: InputEvent): void;
  onPicker(e: PickerEvent): void;
  onUrgentChange(e: SwitchEvent): void;
  onInvoiceChange(e: CustomEvent<InvoiceChangeDetail>): void;
  addAttachments(): void;
  removeAttachment(e: TapEvent): void;
  onAttachmentName(e: InputEvent): void;
  buildPayload(): CreateApprovalPayload;
  onSubmit(): Promise<void>;
}

Page<ApprovalCreateData, ApprovalCreateCustom>({
  data: {
    types: [],
    typeKey: 'leave',
    type: {} as ApprovalType,
    fields: [],
    segments: [],
    values: {},
    urgent: false,
    approvers: [],
    approverReady: false,
    approverHint: '',
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
  },

  /** 表单自动填写前的原值快照（删除发票后回滚） */
  autoFillSnapshot: null,
  lastAutoReason: '',
  approverGeneration: 0,
  approverTimer: 0,

  onUnload() {
    this.approverGeneration += 1;
    if (this.approverTimer) clearTimeout(this.approverTimer);
  },

  async onLoad(options: Record<string, string | undefined>) {
    try {
      const rawTypes = await approvalsApi.getApprovalTypes();
      const types: TypeWithInitial[] = rawTypes.map((t) => ({
        ...t,
        initial: t.name.slice(0, 1),
      }));
      const requested = options.type;
      const typeKey = types.some((t) => t.key === requested) ? (requested as string) : types[0].key;

      this.setData({ types });
      this.selectType(typeKey);
    } catch {
      toast('审批类型加载失败，请稍后重试');
    }
  },

  onShow() {
    if (!this.data.types.length) return;
    this.scheduleApprovers();
  },

  /* ---------------- 类型切换 ---------------- */

  selectType(key: string) {
    const { types } = this.data;
    const type = types.find((t) => t.key === key) || types[0];
    if (!type) return;
    const source = type.fields.filter((field) => field.key !== 'compensation' && !field.key.startsWith('__'));
    const fields = source.filter((field) => field.type !== 'attachment');
    const segments = formSegments(type.key, source);
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
      segments,
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
      approvers: [],
      approverReady: false,
      approverHint: '',
    });
    this.scheduleApprovers(values, []);
  },

  scheduleApprovers(values?: Record<string, string>, recognized?: Invoice[]) {
    const nextValues = values ?? this.data.values;
    const nextRecognized = recognized ?? this.data.recognized;
    if (this.approverTimer) clearTimeout(this.approverTimer);
    const generation = ++this.approverGeneration;
    this.approverTimer = setTimeout(() => { void this.loadApprovers(generation, nextValues, nextRecognized); }, 200) as unknown as number;
  },

  async loadApprovers(generation: number, values: Record<string, string>, recognized: Invoice[]): Promise<void> {
    const type = this.data.type;
    if (!type?.key || generation !== this.approverGeneration) return;
    try {
      const result = await approvalsApi.previewApprovalAssignees({
        type: type.key,
        ...(type.workflowPublicationVersion ? { workflowValues: { ...values } } : {}),
        ...(type.key === 'expense' ? { invoices: recognized.map((item) => ({ totalAmount: Number(item.totalAmount) || 0 })) } : {}),
      });
      if (generation !== this.approverGeneration) return;
      const approvers = result.approvers || [];
      this.setData({ approvers, approverReady: approvers.length > 0, approverHint: approvers.length ? '' : '未匹配到审批人，请联系管理员' });
    } catch (error) {
      if (generation !== this.approverGeneration) return;
      this.setData({ approvers: [], approverReady: false, approverHint: (error as { message?: string }).message || '审批人不可用，请联系管理员' });
    }
  },

  onTypeTap(e: TapEvent) {
    const key = String(e.currentTarget.dataset.key || '');
    if (key === this.data.typeKey) return;
    this.selectType(key);
  },

  /* ---------------- 表单 ---------------- */

  validate(values: Record<string, string>, fields?: ApprovalField[], typeKey?: string): boolean {
    const list = (fields || this.data.fields).filter((field) => field.type !== 'attachment');
    return list.every((f) => !f.required || String(values[f.key] || '').trim() !== '') &&
      ((typeKey || this.data.typeKey) !== 'leave' || calculateLeaveDays(values.startDate, values.startClock, values.endDate, values.endClock) !== null);
  },

  onInput(e: InputEvent) {
    const key = String(e.currentTarget.dataset.key || '');
    const values = { ...this.data.values, [key]: e.detail.value };
    this.setData({ values, canSubmit: this.validate(values) });
    this.scheduleApprovers(values);
  },

  onPicker(e: PickerEvent) {
    const key = String(e.currentTarget.dataset.key || '');
    const field = this.data.fields.find((f) => f.key === key);
    if (!field) return;

    let value = String(e.detail.value);
    if (field.type === 'picker' && field.options) value = field.options[Number(value)] || '';

    const values = { ...this.data.values, [key]: value };
    if (this.data.typeKey === 'leave') {
      const days = calculateLeaveDays(values.startDate, values.startClock, values.endDate, values.endClock);
      values.days = days === null ? '' : String(days);
    }
    this.setData({ values, canSubmit: this.validate(values) });
    this.scheduleApprovers(values);
  },

  onUrgentChange(e: SwitchEvent) {
    this.setData({ urgent: e.detail.value });
  },

  /* ---------------- 发票 OCR 联动 ---------------- */

  /** 组件在识别完成 / 删除 / 重试时会广播最新状态 */
  onInvoiceChange(e: CustomEvent<InvoiceChangeDetail>) {
    const detail = e.detail;
    const recognized = detail.recognized || [];
    this.setData({ invoiceCheckReady: detail.checkReady, invoiceCheckMessage: detail.checkMessage });

    if (!recognized.length) {
      const values = { ...this.data.values };
      if (detail.removed && this.autoFillSnapshot) {
        AUTO_FILL_KEYS.forEach((key) => { values[key] = this.autoFillSnapshot?.[key] || ''; });
        this.autoFillSnapshot = null;
        this.lastAutoReason = '';
      }
      this.setData({
        values,
        recognized: [],
        invoiceSummary: null,
        autoFillHint: '',
        recognizingInvoices: !!detail.recognizing,
        canSubmit: this.validate(values),
      });
      this.scheduleApprovers(values, []);
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

    const amountText = Number(totalAmount).toFixed(2);
    if (values.amount !== amountText) values.amount = amountText;
    if (earliestDate && values.date !== earliestDate) values.date = earliestDate;
    const mapped = this.mapExpenseType(categories);
    if (mapped && values.expenseType !== mapped) values.expenseType = mapped;
    const reason = this.buildInvoiceReason(recognized, sellers, totalAmount);
    if ((!values.reason || values.reason === this.lastAutoReason) && values.reason !== reason) {
      values.reason = reason;
      this.lastAutoReason = reason;
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
      autoFillHint: '',
      canSubmit: this.validate(values),
    });
    this.scheduleApprovers(values, recognized);
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
        return `${v.date || ''} ${v.startTime || ''}-${v.endTime || ''}`;
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
      void (async () => {
        this.setData({ uploadingAttachments: true });
        try {
          for (const file of result.tempFiles) {
            const uploaded = await upload<{ fileUrl: string; previewUrl: string }>({ url: '/invoices/image', filePath: file.tempFilePath, name: 'file' });
            this.setData({ attachments: [...this.data.attachments, { name: '', fileID: uploaded.fileUrl, preview: resolveFileUrl(uploaded.previewUrl) }] });
          }
        } finally { this.setData({ uploadingAttachments: false }); }
      })().catch(() => toast('材料上传失败，请重试'));
    } });
  },

  removeAttachment(e: TapEvent) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ attachments: this.data.attachments.filter((_, i) => i !== index) });
  },

  onAttachmentName(e: InputEvent) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ attachments: this.data.attachments.map((item, i) => i === index ? { ...item, name: e.detail.value } : item) });
  },

  buildPayload(): CreateApprovalPayload {
    const { type, fields, values } = this.data;
    const form = fields.filter((field) => field.type !== 'attachment').map((f) => ({ label: f.label, value: this.formatValue(f, values[f.key]) }));
    const staticBase = getStaticBase();
    const invoices = type.key === 'expense' ? this.data.recognized.map((item) => ({ ...item, fileID: item.fileID?.startsWith(`${staticBase}/uploads/`) ? item.fileID.slice(staticBase.length) : item.fileID })) : [];
    if (invoices.length) form.push({ label: '发票附件', value: `${invoices.length} 张，价税合计 ¥${this.data.invoiceSummary?.totalAmountText || '0.00'}` });
    return { type: type.key, title: this.buildTitle(type, values), summary: this.buildSummary(type, values), form, invoices, urgent: this.data.urgent, attachments: type.key === 'expense' ? this.data.attachments.map(({ name, fileID }) => ({ name: name.trim(), fileID })) : [], ...(type.workflowPublicationVersion ? { workflowPublicationVersion: type.workflowPublicationVersion, workflowValues: { ...values } } : {}) };
  },

  async onSubmit(): Promise<void> {
    const { type, fields, values, submitting, recognizingInvoices } = this.data;
    if (submitting) return;
    if (this.data.uploadingAttachments) { toast('材料上传中，请稍候'); return; }
    if (type.key === 'expense' && this.data.attachments.some((item) => !item.name.trim())) { toast('请填写补充材料名称'); return; }

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
    if (!this.data.approverReady) {
      toast(this.data.approverHint || '审批人不可用，请联系管理员');
      return;
    }

    const payload = this.buildPayload();

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
