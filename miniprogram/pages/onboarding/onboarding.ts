import { del, get, post, upload } from '../../utils/request';
import type { InputEvent, TapEvent } from '../../types/ui';

interface AttachmentRef { id: string; name: string; size: number }
interface OnboardingField { name: string; type: 'text' | 'number' | 'date' | 'select' | 'attachment' | 'table'; required: boolean; maxLength?: number; min?: number; max?: number; options?: string[]; value: string; valueIndex?: number; files?: AttachmentRef[]; children?: OnboardingField[]; rows?: { id: string; values: Record<string, string>; indexes?: Record<string, number>; files?: Record<string, AttachmentRef[]> }[] }
function previousFiles(value: unknown): AttachmentRef[] {
  return Array.isArray(value) ? value.filter((file): file is AttachmentRef => !!file && typeof file === 'object' && typeof file.id === 'string' && typeof file.name === 'string' && typeof file.size === 'number').slice(0, 5) : [];
}
function numberAllowed(field: { min?: number; max?: number }, value: number): boolean {
  return Number.isFinite(value) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
}
function compatiblePreviousValue(field: OnboardingField, value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value);
  if (field.type === 'select') return (field.options || []).includes(text) ? text : '';
  if (field.type === 'number') {
    if (!text.trim()) return '';
    const number = Number(text);
    return numberAllowed(field, number) ? text : '';
  }
  if (field.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  if (field.type === 'text') return text.length <= (field.maxLength ?? 500) ? text : '';
  return '';
}
interface PendingOnboarding { id: number; expectedDate: string; template: OnboardingField[]; declaration: string; previous?: { values?: Record<string, unknown>; photo?: string } | null }
interface FormData {
  onboarding: PendingOnboarding | null; loading: boolean; loadError: boolean; onboardingSaving: boolean; onboardingUploading: boolean;
  onboardingHasPhoto: boolean; onboardingPhotoPreview: string; onboardingSignature: string; onboardingSignaturePreview: string;
  declarationAccepted: boolean;
}
interface FormMethods {
  onboardingPhotoValue?: string;
  loadOnboarding(): Promise<void>; changeOnboarding(e: InputEvent): void; selectOnboarding(e: InputEvent): void; addOnboardingRow(e: TapEvent): void; removeOnboardingRow(e: TapEvent): void;
  changeOnboardingCell(e: InputEvent): void; selectOnboardingCell(e: InputEvent): void; chooseOnboardingPhoto(): void; openSignature(): void; toggleDeclaration(e: WechatMiniprogram.CustomEvent<{ value: string[] }>): void; submitOnboarding(): Promise<void>;
  chooseAttachment(e: TapEvent): void; removeAttachment(e: TapEvent): void;
}
Page<FormData, FormMethods>({
  data: { onboarding: null, loading: true, loadError: false, onboardingSaving: false, onboardingUploading: false, onboardingHasPhoto: false, onboardingPhotoPreview: '', onboardingSignature: '', onboardingSignaturePreview: '', declarationAccepted: false },
  onLoad() { void this.loadOnboarding(); },
  async loadOnboarding() {
    this.setData({ loading: true, loadError: false });
    try {
      const pending = await get<PendingOnboarding | null>('/onboarding-form/pending');
      if (!pending) { wx.reLaunch({ url: '/pages/index/index' }); return; }
      const values = pending.previous?.values || {};
      const template = pending.template.map(f => {
        const value = values[f.name];
        if (f.type === 'table') {
          const rows = Array.isArray(value) ? value.map((raw, index) => {
            const rowValues: Record<string, string> = {}; const indexes: Record<string, number> = {}; const files: Record<string, AttachmentRef[]> = {};
            for (const child of f.children || []) {
              const item = raw && typeof raw === 'object' ? raw[child.name] : undefined;
              if (child.type === 'attachment') { files[child.name] = previousFiles(item); continue; }
              const compatible = compatiblePreviousValue(child, item);
              if (compatible) rowValues[child.name] = compatible;
              if (child.type === 'select') indexes[child.name] = Math.max(0, (child.options || []).indexOf(rowValues[child.name]));
            }
            return { id: `previous-${index}`, values: rowValues, indexes, files };
          }) : [];
          return { ...f, value: '', rows };
        }
        if (f.type === 'attachment') return { ...f, value: '', files: previousFiles(value) };
        const text = compatiblePreviousValue(f, value);
        return { ...f, value: text, valueIndex: f.type === 'select' ? Math.max(0, (f.options || []).indexOf(text)) : undefined };
      });
      const photo = typeof pending.previous?.photo === 'string' ? pending.previous.photo : '';
      this.onboardingPhotoValue = photo;
      const { previous: _previous, ...pendingInfo } = pending;
      this.setData({ onboarding: { ...pendingInfo, template }, onboardingHasPhoto: !!photo, onboardingPhotoPreview: photo.length <= 600000 ? photo : '' });
    } catch { this.setData({ loadError: true }); }
    finally { this.setData({ loading: false }); }
  },
  changeOnboarding(e: InputEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const onboarding = this.data.onboarding;
    if (!onboarding || !onboarding.template[index]) return;
    onboarding.template[index].value = e.detail.value;
    this.setData({ onboarding });
  },
  selectOnboarding(e: InputEvent) {
    const onboarding = this.data.onboarding; const field = onboarding?.template[Number(e.currentTarget.dataset.index)];
    if (!onboarding || !field || field.type !== 'select') return;
    const optionIndex = Number(e.detail.value); const option = field.options?.[optionIndex];
    if (option === undefined) return;
    field.value = option; field.valueIndex = optionIndex; this.setData({ onboarding });
  },
  addOnboardingRow(e: TapEvent) {
    const onboarding = this.data.onboarding; const field = onboarding?.template[Number(e.currentTarget.dataset.index)];
    if (!onboarding || !field || field.type !== 'table' || (field.rows?.length || 0) >= 50) return;
    field.rows = [...(field.rows || []), { id: `${Date.now()}-${Math.random()}`, values: {}, indexes: {}, files: {} }]; this.setData({ onboarding });
  },
  removeOnboardingRow(e: TapEvent) {
    const onboarding = this.data.onboarding; const field = onboarding?.template[Number(e.currentTarget.dataset.index)];
    if (!onboarding || !field?.rows) return;
    field.rows.splice(Number(e.currentTarget.dataset.row), 1); this.setData({ onboarding });
  },
  changeOnboardingCell(e: InputEvent) {
    const onboarding = this.data.onboarding; const field = onboarding?.template[Number(e.currentTarget.dataset.index)];
    const row = field?.rows?.[Number(e.currentTarget.dataset.row)]; const child = field?.children?.[Number(e.currentTarget.dataset.child)];
    if (!onboarding || !row || !child) return;
    row.values[child.name] = e.detail.value; this.setData({ onboarding });
  },
  selectOnboardingCell(e: InputEvent) {
    const onboarding = this.data.onboarding; const field = onboarding?.template[Number(e.currentTarget.dataset.index)];
    const row = field?.rows?.[Number(e.currentTarget.dataset.row)]; const child = field?.children?.[Number(e.currentTarget.dataset.child)];
    if (!onboarding || !row || !child || child.type !== 'select') return;
    const optionIndex = Number(e.detail.value); const option = child.options?.[optionIndex];
    if (option === undefined) return;
    row.values[child.name] = option; row.indexes = row.indexes || {}; row.indexes[child.name] = optionIndex; this.setData({ onboarding });
  },
  chooseAttachment(e: TapEvent) {
    if (this.data.onboardingUploading || this.data.onboardingSaving) return;
    const fieldIndex = Number(e.currentTarget.dataset.index);
    const rowIndex = e.currentTarget.dataset.row === undefined ? -1 : Number(e.currentTarget.dataset.row);
    const childIndex = e.currentTarget.dataset.child === undefined ? -1 : Number(e.currentTarget.dataset.child);
    const field = this.data.onboarding?.template[fieldIndex];
    const row = rowIndex >= 0 ? field?.rows?.[rowIndex] : undefined;
    const child = childIndex >= 0 ? field?.children?.[childIndex] : undefined;
    if (!field || (rowIndex >= 0 ? !row || child?.type !== 'attachment' : field.type !== 'attachment')) return;
    const current = row && child ? row.files?.[child.name] || [] : field.files || [];
    const remaining = 5 - current.length;
    if (remaining <= 0) { wx.showToast({ title: '每个字段最多上传 5 个附件', icon: 'none' }); return; }
    const rowId = row?.id; const fieldName = field.name; const childName = child?.name;
    const processFiles = async (files: Array<{ path: string; name: string; size: number }>) => {
      this.setData({ onboardingUploading: true });
      try {
        for (const file of files.slice(0, remaining)) {
          if (!file.size || file.size > 10 * 1024 * 1024) { wx.showToast({ title: '单个附件不能超过 10MB', icon: 'none' }); continue; }
          const formData: Record<string, string> = { field: fieldName, filename: file.name };
          if (childName) formData.child = childName;
          const saved = await upload<AttachmentRef>({ url: '/onboarding-form/attachments', filePath: file.path, name: 'file', formData });
          const onboarding = this.data.onboarding; const target = onboarding?.template.find(item => item.name === fieldName);
          if (!onboarding || !target) continue;
          if (rowId && childName) {
            const targetRow = target.rows?.find(item => item.id === rowId);
            if (!targetRow) continue;
            targetRow.files = targetRow.files || {}; targetRow.files[childName] = [...(targetRow.files[childName] || []), saved];
          } else target.files = [...(target.files || []), saved];
          this.setData({ onboarding });
        }
      } catch { /* 请求层负责提示 */ }
      finally { this.setData({ onboardingUploading: false }); }
    };
    wx.showActionSheet({ itemList: ['从相册选择', '拍照', '从聊天记录选择'], success: choice => {
      if (choice.tapIndex === 2) {
        wx.chooseMessageFile({ count: remaining, type: 'all', success: result => {
          void processFiles(result.tempFiles.map(file => ({ path: file.path, name: file.name, size: file.size })));
        } });
      } else {
        wx.chooseMedia({ count: choice.tapIndex === 1 ? 1 : remaining, mediaType: ['image'], sourceType: [choice.tapIndex === 1 ? 'camera' : 'album'], success: result => {
          void processFiles(result.tempFiles.map((file, index) => ({ path: file.tempFilePath, name: `图片-${Date.now()}-${index + 1}.${file.tempFilePath.split('.').pop()?.split('?')[0] || 'jpg'}`, size: file.size })));
        } });
      }
    } });
  },
  async removeAttachment(e: TapEvent) {
    const onboarding = this.data.onboarding; const field = onboarding?.template[Number(e.currentTarget.dataset.index)];
    if (!onboarding || !field || this.data.onboardingUploading) return;
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    try { await del(`/onboarding-form/attachments/${id}`); }
    catch { return; }
    if (e.currentTarget.dataset.row !== undefined) {
      const row = field.rows?.[Number(e.currentTarget.dataset.row)]; const child = field.children?.[Number(e.currentTarget.dataset.child)];
      if (!row || !child || !row.files) return;
      row.files[child.name] = (row.files[child.name] || []).filter(file => file.id !== id);
    } else field.files = (field.files || []).filter(file => file.id !== id);
    this.setData({ onboarding });
  },
  chooseOnboardingPhoto() {
    wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'], success: result => {
      const path = result.tempFilePaths[0]; if (!path) return;
      wx.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: file => {
        const data = String(file.data); const type = data.startsWith('/9j/') ? 'jpeg' : data.startsWith('iVBORw0KGgo') ? 'png' : '';
        if (!type || data.length > 1398104) { wx.showToast({ title: '请选择1MB以内的 JPG 或 PNG 照片', icon: 'none' }); return; }
        this.onboardingPhotoValue = `data:image/${type};base64,${data}`;
        this.setData({ onboardingHasPhoto: true, onboardingPhotoPreview: path });
      }, fail: () => wx.showToast({ title: '无法读取照片', icon: 'none' }) });
    } });
  },
  openSignature() {
    wx.navigateTo({
      url: '/pages/onboarding-signature/onboarding-signature',
      events: { signatureSaved: (result: { data: string; preview: string }) => this.setData({ onboardingSignature: result.data, onboardingSignaturePreview: result.preview }) },
      fail: () => wx.showToast({ title: '无法打开签名页面', icon: 'none' }),
    });
  },
  toggleDeclaration(e) { this.setData({ declarationAccepted: e.detail.value.includes('accepted') }); },
  async submitOnboarding() {
    const onboarding = this.data.onboarding;
    if (!onboarding || this.data.onboardingSaving || this.data.onboardingUploading) return;
    const answers: Record<string, string | number | AttachmentRef[] | Record<string, string | number | AttachmentRef[]>[]> = {};
    for (const field of onboarding.template) {
      if (field.type === 'table') {
        const rows = field.rows || []; if (!rows.length && field.required) { wx.showToast({ title: `请填写${field.name}`, icon: 'none' }); return; }
        const result: Record<string, string | number | AttachmentRef[]>[] = [];
        for (const row of rows) {
          const output: Record<string, string | number | AttachmentRef[]> = {};
          for (const child of field.children || []) {
            if (child.type === 'attachment') { const files = row.files?.[child.name] || []; if (!files.length && child.required) { wx.showToast({ title: `请上传${child.name}`, icon: 'none' }); return; } if (files.length) output[child.name] = files; continue; }
            const cell = (row.values[child.name] || '').trim();
            if (!cell) { if (child.required) { wx.showToast({ title: `请填写${child.name}`, icon: 'none' }); return; } continue; }
            if (child.type === 'number') { const n = Number(cell); if (!Number.isFinite(n)) { wx.showToast({ title: `${child.name}需填写数字`, icon: 'none' }); return; } if (!numberAllowed(child, n)) { wx.showToast({ title: `${child.name}数值不符合要求`, icon: 'none' }); return; } output[child.name] = n; }
            else if (child.type === 'select') { if (!(child.options || []).includes(cell)) { wx.showToast({ title: `${child.name}选项无效`, icon: 'none' }); return; } output[child.name] = cell; }
            else output[child.name] = cell;
          }
          result.push(output);
        }
        if (result.length) answers[field.name] = result;
        continue;
      }
      if (field.type === 'attachment') { const files = field.files || []; if (!files.length && field.required) { wx.showToast({ title: `请上传${field.name}`, icon: 'none' }); return; } if (files.length) answers[field.name] = files; continue; }
      const value = field.value.trim();
      if (!value) { if (field.required) { wx.showToast({ title: `请填写${field.name}`, icon: 'none' }); return; } continue; }
      if (field.type === 'number') { const n = Number(value); if (!Number.isFinite(n)) { wx.showToast({ title: `${field.name}需填写数字`, icon: 'none' }); return; } if (!numberAllowed(field, n)) { wx.showToast({ title: `${field.name}数值不符合要求`, icon: 'none' }); return; } answers[field.name] = n; }
      else if (field.type === 'select') { if (!(field.options || []).includes(value)) { wx.showToast({ title: `${field.name}选项无效`, icon: 'none' }); return; } answers[field.name] = value; }
      else answers[field.name] = value;
    }
    if (!this.data.declarationAccepted) { wx.showToast({ title: '请先阅读并同意声明', icon: 'none' }); return; }
    if (!this.data.onboardingSignature) { wx.showToast({ title: '请先手写签名', icon: 'none' }); return; }
    this.setData({ onboardingSaving: true });
    try { await post('/onboarding-form/submit', { __onboardingFormat: 2, values: answers, photo: this.onboardingPhotoValue || undefined, signature: this.data.onboardingSignature || undefined, declarationAccepted: this.data.declarationAccepted }); wx.showToast({ title: '提交成功' }); wx.reLaunch({ url: '/pages/index/index' }); }
    catch { /* 请求层负责提示 */ }
    finally { this.setData({ onboardingSaving: false }); }
  },

});
