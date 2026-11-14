/**
 * components/invoice-uploader — 发票上传与识别（TypeScript）
 *
 * 两条录入路径，产出的记录结构一致，只是 source 与 qrFrom 不同：
 *
 *   A. 拍照 / 相册选图：读取左上角二维码，保存图片并进行查重和真伪查验。
 *
 *   B. 扫发票二维码（source = 'qr'）
 *      调 wx.scanCode 连续扫码，不落原图，数据直接来自二维码。
 *        qrFrom = 'scan'
 *
 * 对外事件：bind:change
 *   e.detail = {
 *     invoices, recognized, totalAmount, taxAmount, count,
 *     earliestDate, sellers, categories, recognizing, removed,
 *   }
 */

import * as ocr from '../../services/invoices/ocr';
import { uploadInvoiceImage } from '../../services/invoices/invoice-image';
import * as verify from '../../services/invoices/verify';
import * as qrImage from '../../utils/qr-image';
import { invoiceKey } from '../../utils/invoice-identity';
import { getInvoiceCheckState } from '../../utils/invoice-precheck';
import { toast } from '../../utils/util';
import type { Invoice, InvoiceChangeDetail, ParsedInvoiceQR } from '../../types/models';

const STATUS_TEXT = {
  pending: '待识别',
  recognizing: '识别中',
  done: '已识别',
  failed: '识别失败',
};

type UploaderStatus = keyof typeof STATUS_TEXT;

interface UploaderInvoice {
  id: string;
  source: 'image' | 'qr';
  qrFrom: string;
  tempPath: string;
  fileID: string;
  preview: string;
  status: UploaderStatus;
  statusText: string;
  result: Invoice | null;
  qr: ParsedInvoiceQR | null;
  errorMsg: string;
  checkState: 'pending' | 'checking' | 'verifying' | 'clear' | 'blocked' | 'error';
  checkMessage: string;
  batchDuplicate: boolean;
}

interface DetailRow {
  label: string;
  value: string;
}

interface ExpandedDetail {
  id: string;
  isMock: boolean;
  isQR: boolean;
  rows: DetailRow[];
}

interface UploaderData {
  invoices: UploaderInvoice[];
  expandedId: string;
  expanded: ExpandedDetail | null;
  summary: { count: number; totalAmount: number; totalAmountText: string };
  choosing: boolean;
  scanning: boolean;
  scanCount: number;
}

Component<UploaderData, Record<string, any>, Record<string, any>, never[]>({
  properties: {
    /** 最多可上传张数 */
    max: { type: Number, value: 9 },
    /** 禁用（如审批单已提交） */
    disabled: { type: Boolean, value: false },
    /** 底部提示文案 */
    tip: { type: String, value: '' },
  },

  data: {
    invoices: [],
    expandedId: '',
    expanded: null,
    summary: { count: 0, totalAmount: 0, totalAmountText: '0.00' },
    choosing: false,
    scanning: false,
    scanCount: 0,
  },

  methods: {
    /* ---------------- 选图 ---------------- */

    onChoose() {
      if ((this.data as any).disabled || this.data.choosing) return;

      const max = Number((this.data as any).max) || 9;
      const remain = max - this.data.invoices.length;
      if (remain <= 0) {
        toast(`最多上传 ${max} 张发票`);
        return;
      }

      this.setData({ choosing: true });
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        // 压缩后长边约 1280px，足以解出票面二维码
        sizeType: ['compressed'],
        camera: 'back',
        success: (res) => {
          const files = (res && res.tempFiles) || [];
          if (files.length) this.addFiles(files);
        },
        complete: () => this.setData({ choosing: false }),
      });
    },

    addFiles(files: Array<{ tempFilePath: string }>) {
      const base = Date.now();
      const placeholders: UploaderInvoice[] = files.map((f, i) => ({
        id: `inv_${base}_${i}`,
        source: 'image',
        qrFrom: '',
        tempPath: f.tempFilePath,
        fileID: '',
        preview: '',
        status: 'pending',
        statusText: STATUS_TEXT.pending,
        result: null,
        qr: null,
        errorMsg: '',
        checkState: 'pending',
        checkMessage: '',
        batchDuplicate: false,
      }));

      this.setData({ invoices: this.data.invoices.concat(placeholders) });
      this.syncState();

      // 串行识别，避免一次性并发过多请求
      const instance = this as unknown as { queue?: Promise<void> };
      const queue = (instance.queue || Promise.resolve())
        .then(() =>
          placeholders.reduce(
            (chain, item) => chain.then(() => this.processOne(item.id)),
            Promise.resolve()
          )
        )
        .then(() => this.reportBatch(placeholders.map((x) => x.id)));

      instance.queue = queue.then(() => undefined);
    },

    /**
     * 一批图片处理完后的收口提示
     * 有多少张是直接从图片里读出的二维码
     */
    reportBatch(ids: string[]) {
      const batch = this.data.invoices.filter((x) => ids.indexOf(x.id) > -1);
      const qrCount = batch.filter((x) => x.qrFrom === 'image').length;
      if (qrCount > 0) {
        toast(`已从图片中读出 ${qrCount} 张发票的二维码`);
      }
    },

    /* ---------------- 扫码录入 ---------------- */

    /**
     * 连续扫码录入
     * 每扫成功一张就自动接着唤起下一张，直到用户退出 / 达到张数上限。
     */
    async onScan() {
      if ((this.data as any).disabled || this.data.choosing || this.data.scanning) return;

      const max = Number((this.data as any).max) || 9;
      if (this.data.invoices.length >= max) {
        toast(`最多上传 ${max} 张发票`);
        return;
      }

      this.setData({ scanning: true, scanCount: 0 });
      this.syncState();

      let added = 0;
      let guard = 0;

      try {
        while (this.data.invoices.length < max && guard < 50) {
          guard += 1;
          let parsed: ParsedInvoiceQR;
          try {
            parsed = await ocr.scanInvoiceQR();
          } catch (err) {
            const e = err as { cancelled?: boolean; code?: number; message?: string };
            if (e && e.cancelled) break;
            if (e && e.code === -3) {
              toast(e.message || '不是发票二维码');
              continue;
            }
            toast(e.message || '扫码失败，请重试');
            break;
          }

          const result = ocr.buildFromQR(parsed);
          if (!result) {
            toast('二维码内容无法解析');
            continue;
          }

          // 同一张票重复扫码不再添加
          const existed = this.data.invoices.find(
            (x) => x.status === 'done' && x.result && invoiceKey(x.result) && invoiceKey(x.result) === invoiceKey(result)
          );
          if (existed) {
            toast('该发票已在列表中');
            continue;
          }

          const item: UploaderInvoice = {
            id: `invqr_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            source: 'qr',
            qrFrom: 'scan',
            tempPath: '',
            fileID: '',
            preview: '',
            status: 'done',
            statusText: STATUS_TEXT.done,
            result: result,
            qr: parsed,
            errorMsg: '',
            checkState: 'pending',
            checkMessage: '',
            batchDuplicate: false,
          };

          this.setData({ invoices: this.data.invoices.concat(item), expandedId: item.id });
          this.syncState();

          added += 1;
          this.setData({ scanCount: added });

          await this.checkInvoice(item.id);
        }
      } finally {
        this.setData({ scanning: false });
        this.syncState();
      }

      // 退出扫码后的收口提示
      if (added > 1) {
        toast(`本轮共录入 ${added} 张发票`);
      }
    },

    /* ---------------- 识别流程 ---------------- */

    /**
     * 从已选图片里解二维码（纯本地）
     */
    async decodeQR(_id: string, filePath: string): Promise<ParsedInvoiceQR | null> {
      if (!filePath) return null;

      let text = '';
      try {
        const res = await qrImage.decodeFromImage(this, '#qrCanvas', filePath);
        if (res && res.ok) text = res.text;
      } catch {
        return null;
      }
      if (!text) return null;

      const parsed = ocr.parseInvoiceQR(text);
      if (!parsed || !parsed.ok) throw { message: '暂不支持此发票二维码格式，请使用可识别的发票' };
      return parsed;
    },

    async processOne(id: string) {
      const item = this.data.invoices.find((x) => x.id === id);
      if (!item) return;

      this.patch(id, { status: 'recognizing', statusText: STATUS_TEXT.recognizing });

      try {
        // 1) 本地只识别图片左上角的发票二维码。
        const parsed = await this.decodeQR(id, item.tempPath || item.fileID);
        if (!this.data.invoices.some((entry) => entry.id === id)) return;
        if (!parsed) throw { message: '未识别到左上角发票二维码，请重新拍摄或使用扫码录入' };
        const qrResult = ocr.buildFromQR(parsed);
        if (!qrResult || !invoiceKey(qrResult)) throw { message: '二维码发票号码不完整，无法查重' };
        qrResult.qrFrom = 'image';

        // 2) 保存图片附件，不调用 OCR。上传失败时不能提交临时文件路径。
        const uploaded = await uploadInvoiceImage(item.tempPath || item.fileID);

        this.patch(id, {
          status: 'done',
          statusText: STATUS_TEXT.done,
          fileID: uploaded.fileUrl,
          preview: uploaded.previewUrl,
          result: { ...qrResult, fileID: uploaded.fileUrl },
          qr: parsed,
          qrFrom: 'image',
          errorMsg: '',
        });
        await this.checkInvoice(id);
      } catch (err) {
        const message = (err as { message?: string }).message || '识别失败，请重试';
        this.patch(id, { status: 'failed', statusText: STATUS_TEXT.failed, errorMsg: message });
        toast(message);
      }
    },

    /** 识别后先查重，再查验真伪；任何阶段失败均不得提交。 */
    async checkInvoice(id: string): Promise<void> {
      const item = this.data.invoices.find((entry) => entry.id === id);
      if (!item || !item.result) return;
      if (item.checkState === 'checking' || item.checkState === 'verifying') return;
      if (!invoiceKey(item.result)) {
        this.patch(id, { checkState: 'error', checkMessage: '发票号码或代码不完整，无法查重' });
        return;
      }
      this.patch(id, { checkState: 'checking', checkMessage: '正在查重' });
      try {
        const dup = await verify.checkDuplicate(item.result);
        if (!this.data.invoices.some((entry) => entry.id === id)) return;
        if (dup.blocking) {
          this.patch(id, { checkState: 'blocked', checkMessage: '已在审批中或已通过的单据中使用，请移除' });
          return;
        }
        const key = invoiceKey(item.result);
        if (this.data.invoices.some((entry) => entry.id !== id && entry.result && invoiceKey(entry.result) === key)) {
          this.patch(id, { checkState: 'blocked', checkMessage: '本单重复，请移除重复发票' });
          return;
        }
        this.patch(id, { checkState: 'verifying', checkMessage: '查重通过，正在查验真伪' });
        const result = await verify.verifyInvoice(item.result);
        if (!this.data.invoices.some((entry) => entry.id === id)) return;
        if (result.status === 'valid' && result.mock === false) {
          this.patch(id, { checkState: 'clear', checkMessage: dup.duplicated ? '查验通过；历史单据已退回或撤销' : '查重及真伪查验通过' });
        } else {
          this.patch(id, { checkState: result.status === 'duplicated' ? 'blocked' : 'error', checkMessage: result.mock ? '模拟结果不能用于报销' : (result.message || '发票查验未通过，请重试') });
        }
      } catch {
        const current = this.data.invoices.find((entry) => entry.id === id);
        if (current) this.patch(id, { checkState: 'error', checkMessage: current.checkState === 'verifying' ? '真伪查验失败，请检查网络后重试' : '查重失败，请检查网络后重试' });
      }
    },

    onRetryCheck(e: WechatMiniprogram.BaseEvent) {
      const id = String(e.currentTarget.dataset.id || '');
      void this.checkInvoice(id);
    },

    /* ---------------- 交互 ---------------- */

    onRemove(e: WechatMiniprogram.BaseEvent) {
      const id = String(e.currentTarget.dataset.id || '');
      const invoices = this.data.invoices.filter((x) => x.id !== id);
      const expandedId = this.data.expandedId === id ? '' : this.data.expandedId;
      this.setData({ invoices, expandedId });
      this.syncState(true);
    },

    onRetry(e: WechatMiniprogram.BaseEvent) {
      const id = String(e.currentTarget.dataset.id || '');
      if ((this.data as any).disabled) return;
      void this.processOne(id);
    },

    onToggle(e: WechatMiniprogram.BaseEvent) {
      const id = String(e.currentTarget.dataset.id || '');
      this.setData({ expandedId: this.data.expandedId === id ? '' : id });
      this.syncState();
    },

    closeDetail() {
      this.setData({ expandedId: '' });
      this.syncState();
    },

    onPreview(e: WechatMiniprogram.BaseEvent) {
      const id = String(e.currentTarget.dataset.id || '');
      const item = this.data.invoices.find((x) => x.id === id);

      // 扫码录入的发票没有原图，点击改为展开字段明细
      if (item && item.source === 'qr') {
        this.setData({ expandedId: this.data.expandedId === id ? '' : id });
        this.syncState();
        return;
      }

      const urls = this.data.invoices.map((x) => x.preview || x.tempPath).filter(Boolean);
      const current = item ? item.preview || item.tempPath : '';
      if (!urls.length || !current) return;
      wx.previewImage({ current, urls });
    },

    /* ---------------- 状态同步 ---------------- */

    patch(id: string, data: Partial<UploaderInvoice>) {
      const invoices = this.data.invoices.map((x) => (x.id === id ? { ...x, ...data } : x));
      this.setData({ invoices });
      this.syncState();
    },

    /** 重新计算汇总、展开面板，并向父组件广播 */
    syncState(removed = false) {
      const { invoices, expandedId } = this.data;
      const check = getInvoiceCheckState(invoices, this.data.scanning);
      const done = invoices.filter((x) => x.status === 'done' && x.result);
      const sum = ocr.sumInvoices(done.map((x) => x.result as Invoice));

      // 展开面板
      let expanded: ExpandedDetail | null = null;
      const target = invoices.find((x) => x.id === expandedId);
      if (target && target.status === 'done' && target.result) {
        expanded = this.buildRows(target);
      }

      const dates = done.map((x) => (x.result as Invoice).invoiceDate).filter(Boolean).sort();
      const sellers: string[] = [];
      const categories: string[] = [];
      done.forEach((x) => {
        const r = x.result as Invoice;
        if (r.sellerName && sellers.indexOf(r.sellerName) < 0) sellers.push(r.sellerName);
        if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
      });

      this.setData({
        invoices: invoices.map((item) => ({ ...item, batchDuplicate: check.duplicateIds.includes(item.id) })),
        expanded,
        summary: {
          count: sum.count,
          totalAmount: sum.totalAmount,
          totalAmountText: sum.totalAmount.toFixed(2),
        },
      });

      const detail: InvoiceChangeDetail = {
        invoices: invoices.map((x) => this.toPlain(x)),
        recognized: done.map((x) => this.toPlain(x)),
        totalAmount: sum.totalAmount,
        taxAmount: sum.taxAmount,
        count: sum.count,
        earliestDate: dates[0] || '',
        sellers,
        categories,
        recognizing: invoices.some((x) => x.status === 'pending' || x.status === 'recognizing'),
        removed,
        checkReady: check.ready,
        checkMessage: check.message,
      };
      this.triggerEvent('change', detail);
    },

    /** 扁平化，便于随审批单持久化 */
    toPlain(item: UploaderInvoice): Invoice {
      const r = item.result || ocr.emptyInvoice();
      return {
        ...r,
        id: item.id,
        source: item.source,
        fileID: item.fileID || item.tempPath || '',
        isMock: !!r.isMock,
        isQR: !!r.isQR,
        qrFrom: item.qrFrom || '',
        qrCrcVerified: item.qr ? !!item.qr.crcVerified : false,
      };
    },

    /** 生成可展开的字段明细 */
    buildRows(item: UploaderInvoice): ExpandedDetail {
      const r = item.result || ocr.emptyInvoice();
      const money = (n: unknown) => `¥${(Number(n) || 0).toFixed(2)}`;
      const rows: DetailRow[] = [
        { label: '发票类型', value: r.invoiceType || '—' },
        { label: '发票代码', value: r.invoiceCode || '—' },
        { label: '发票号码', value: r.invoiceNumber || '—' },
        { label: '开票日期', value: r.invoiceDate || '—' },
        { label: '销售方', value: r.sellerName || '—' },
        { label: '销售方税号', value: r.sellerTaxNo || '—' },
        { label: '项目名称', value: r.itemName || '—' },
        { label: '消费类型', value: r.category || '—' },
        { label: '金额（不含税）', value: money(r.amount) },
        { label: '税率', value: r.taxRate || '—' },
        { label: '税额', value: money(r.taxAmount) },
        { label: '价税合计', value: money(r.totalAmount) },
      ];
      // 数据来自二维码：补上来源说明与 CRC 自检结果
      if (item.qr) {
        const fromText =
          item.qrFrom === 'image'
            ? '图片内二维码（国标字段，免 OCR 直读）'
            : '发票二维码（国标字段，无需 OCR）';
        rows.splice(1, 0, { label: '数据来源', value: fromText });
        if (item.qr.crc) {
          rows.push({
            label: '二维码 CRC',
            value: ocr.formatInvoiceCrc(item.qr),
          });
        }
      }

      return { id: item.id, isMock: !!r.isMock, isQR: !!item.qr, rows };
    },
  },
});
