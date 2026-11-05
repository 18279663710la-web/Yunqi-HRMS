import { get, post } from '../../utils/request';
import type { InputEvent, TapEvent } from '../../types/ui';

interface OnboardingField { name: string; type: 'text' | 'number' | 'date' | 'select' | 'table'; required: boolean; maxLength?: number; min?: number; max?: number; options?: string[]; value: string; valueIndex?: number; children?: OnboardingField[]; rows?: { id: string; values: Record<string, string>; indexes?: Record<string, number> }[] }
function compatiblePreviousValue(field: OnboardingField, value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value);
  if (field.type === 'select') return (field.options || []).includes(text) ? text : '';
  if (field.type === 'number') {
    if (!text.trim()) return '';
    const number = Number(text);
    return Number.isFinite(number) && (field.min === undefined || number >= field.min) && (field.max === undefined || number <= field.max) ? text : '';
  }
  if (field.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  if (field.type === 'text') return text.length <= (field.maxLength ?? 500) ? text : '';
  return '';
}
interface PendingOnboarding { id: number; expectedDate: string; template: OnboardingField[]; declaration: string; previous?: { values?: Record<string, unknown>; photo?: string } | null }
interface FormData {
  onboarding: PendingOnboarding | null; loading: boolean; loadError: boolean; onboardingSaving: boolean;
  onboardingHasPhoto: boolean; onboardingPhotoPreview: string; onboardingSignature: string; onboardingSignaturePreview: string;
  declarationAccepted: boolean;
}
interface FormMethods {
  onboardingPhotoValue?: string;
  loadOnboarding(): Promise<void>; changeOnboarding(e: InputEvent): void; selectOnboarding(e: InputEvent): void; addOnboardingRow(e: TapEvent): void; removeOnboardingRow(e: TapEvent): void;
  changeOnboardingCell(e: InputEvent): void; selectOnboardingCell(e: InputEvent): void; chooseOnboardingPhoto(): void; openSignature(): void; toggleDeclaration(e: WechatMiniprogram.CustomEvent<{ value: string[] }>): void; submitOnboarding(): Promise<void>;
}
Page<FormData, FormMethods>({
  data: { onboarding: null, loading: true, loadError: false, onboardingSaving: false, onboardingHasPhoto: false, onboardingPhotoPreview: '', onboardingSignature: '', onboardingSignaturePreview: '', declarationAccepted: false },
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
            const rowValues: Record<string, string> = {}; const indexes: Record<string, number> = {};
            for (const child of f.children || []) {
              const item = raw && typeof raw === 'object' ? raw[child.name] : undefined;
              const compatible = compatiblePreviousValue(child, item);
              if (compatible) rowValues[child.name] = compatible;
              if (child.type === 'select') indexes[child.name] = Math.max(0, (child.options || []).indexOf(rowValues[child.name]));
            }
            return { id: `previous-${index}`, values: rowValues, indexes };
          }) : [];
          return { ...f, value: '', rows };
        }
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
    field.rows = [...(field.rows || []), { id: `${Date.now()}-${Math.random()}`, values: {}, indexes: {} }]; this.setData({ onboarding });
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
    if (!onboarding || this.data.onboardingSaving) return;
    const answers: Record<string, string | number | Record<string, string | number>[]> = {};
    for (const field of onboarding.template) {
      if (field.type === 'table') {
        const rows = field.rows || []; if (!rows.length && field.required) { wx.showToast({ title: `请填写${field.name}`, icon: 'none' }); return; }
        const result: Record<string, string | number>[] = [];
        for (const row of rows) {
          const output: Record<string, string | number> = {};
          for (const child of field.children || []) {
            const cell = (row.values[child.name] || '').trim();
            if (!cell) { if (child.required) { wx.showToast({ title: `请填写${child.name}`, icon: 'none' }); return; } continue; }
            if (child.type === 'number') { const n = Number(cell); if (!Number.isFinite(n)) { wx.showToast({ title: `${child.name}需填写数字`, icon: 'none' }); return; } output[child.name] = n; }
            else if (child.type === 'select') { if (!(child.options || []).includes(cell)) { wx.showToast({ title: `${child.name}选项无效`, icon: 'none' }); return; } output[child.name] = cell; }
            else output[child.name] = cell;
          }
          result.push(output);
        }
        if (result.length) answers[field.name] = result;
        continue;
      }
      const value = field.value.trim();
      if (!value) { if (field.required) { wx.showToast({ title: `请填写${field.name}`, icon: 'none' }); return; } continue; }
      if (field.type === 'number') { const n = Number(value); if (!Number.isFinite(n)) { wx.showToast({ title: `${field.name}需填写数字`, icon: 'none' }); return; } answers[field.name] = n; }
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
