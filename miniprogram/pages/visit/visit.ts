import * as attendanceApi from '../../services/attendance/api';
import type { VisitRecord } from '../../types/models';
import type { InputEvent, TapEvent } from '../../types/ui';
import { toast } from '../../utils/util';

interface VisitPhotoView {
  tempPath: string;
  size: number;
}

interface VisitRecordView extends VisitRecord {
  timeText: string;
  addressText: string;
}

interface VisitData {
  ready: boolean;
  customerName: string;
  purpose: string;
  addressName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  remark: string;
  photos: VisitPhotoView[];
  locating: boolean;
  locationSub: string;
  submitting: boolean;
  records: VisitRecordView[];
  month: string;
}

interface VisitCustom {
  loadRecords(): Promise<void>;
  locateCurrent(): void;
  choosePhotos(): void;
  removePhoto(event: TapEvent): void;
  previewLocalPhoto(event: TapEvent): void;
  previewRecordPhotos(event: TapEvent): Promise<void>;
  onCustomerInput(event: InputEvent): void;
  onPurposeInput(event: InputEvent): void;
  onRemarkInput(event: InputEvent): void;
  submit(): Promise<void>;
}

const MAX_PHOTOS = 3;

Page<VisitData, VisitCustom>({
  data: {
    ready: false,
    customerName: '',
    purpose: '',
    addressName: '',
    address: '',
    latitude: null,
    longitude: null,
    accuracy: null,
    remark: '',
    photos: [],
    locating: false,
    locationSub: '需要获取当前位置',
    submitting: false,
    records: [],
    month: '',
  },

  onLoad() {
    void this.locateCurrent();
  },

  onShow() {
    void this.loadRecords();
  },

  onPullDownRefresh() {
    this.loadRecords().finally(() => wx.stopPullDownRefresh());
  },

  async loadRecords(): Promise<void> {
    try {
      const result = await attendanceApi.getMyVisits();
      const records = result.list.map<VisitRecordView>((item) => ({
        ...item,
        timeText: item.visitTime.slice(5, 16),
        addressText: [item.addressName, item.address].filter((value, index, values) => value && values.indexOf(value) === index).join(' · '),
      }));
      this.setData({ ready: true, records, month: result.month });
    } catch {
      this.setData({ ready: true });
    }
  },

  locateCurrent() {
    if (this.data.locating) return;
    this.setData({
      locating: true,
      locationSub: this.data.address ? this.data.locationSub : '正在获取当前位置…',
    });
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 5000,
      success: (result) => {
        const latitude = result.latitude;
        const longitude = result.longitude;
        const accuracy = Math.round(result.accuracy);
        this.setData({ latitude, longitude, accuracy });
        void attendanceApi.reverseVisitLocation(latitude, longitude).then((location) => {
          const name = (location.name || '当前位置').trim();
          const address = (location.address || name).trim();
          this.setData({
            locating: false,
            addressName: name,
            address,
            locationSub: location.resolved && address !== name ? address : '已获取当前位置',
          });
        }).catch(() => {
          this.setData({
            locating: false,
            addressName: '当前位置',
            address: '当前位置',
            locationSub: '已获取当前位置',
          });
        });
      },
      fail: (error) => {
        const message = (error as { errMsg?: string }).errMsg || '';
        const denied = /auth|deny|privacy/i.test(message);
        this.setData({
          locating: false,
          locationSub: this.data.address
            ? this.data.locationSub
            : denied ? '请允许获取位置后重试' : '定位失败，请检查网络或位置权限',
        });
        toast(denied ? '请允许获取位置后重试' : '定位失败，请检查位置权限');
      },
    });
  },

  choosePhotos() {
    const remaining = MAX_PHOTOS - this.data.photos.length;
    if (remaining <= 0) return;
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (result) => {
        const photos = result.tempFiles.map((file) => ({ tempPath: file.tempFilePath, size: file.size }));
        this.setData({ photos: [...this.data.photos, ...photos].slice(0, MAX_PHOTOS) });
      },
    });
  },

  removePhoto(event: TapEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ photos: this.data.photos.filter((_, itemIndex) => itemIndex !== index) });
  },

  previewLocalPhoto(event: TapEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const photo = this.data.photos[index];
    if (!photo) return;
    wx.previewImage({ current: photo.tempPath, urls: this.data.photos.map((item) => item.tempPath) });
  },

  onCustomerInput(event: InputEvent) {
    this.setData({ customerName: event.detail.value });
  },

  onPurposeInput(event: InputEvent) {
    this.setData({ purpose: event.detail.value });
  },

  onRemarkInput(event: InputEvent) {
    this.setData({ remark: event.detail.value });
  },

  async previewRecordPhotos(event: TapEvent) {
    const id = Number(event.currentTarget.dataset.id);
    const record = this.data.records.find((item) => item.id === id);
    if (!record || !record.photoIds.length) return;
    wx.showLoading({ title: '加载照片', mask: true });
    try {
      const urls = await Promise.all(record.photoIds.map((photoId) => attendanceApi.downloadVisitPhoto(photoId)));
      wx.hideLoading();
      wx.previewImage({ current: urls[0], urls });
    } catch (error) {
      wx.hideLoading();
      toast((error as { message?: string }).message || '照片加载失败');
    }
  },

  async submit(): Promise<void> {
    if (this.data.submitting || this.data.locating) return;
    const customerName = this.data.customerName.trim();
    const purpose = this.data.purpose.trim();
    if (!customerName) { toast('请填写客户名称'); return; }
    if (!purpose) { toast('请填写拜访目的'); return; }
    if (!this.data.address || this.data.latitude === null || this.data.longitude === null) {
      toast('请先获取拜访地点');
      return;
    }
    if (!this.data.photos.length) {
      toast('请拍摄至少 1 张现场照片');
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中', mask: true });
    try {
      const photoIds: string[] = [];
      for (const photo of this.data.photos) {
        const uploaded = await attendanceApi.uploadVisitPhoto(photo.tempPath);
        photoIds.push(uploaded.id);
      }
      await attendanceApi.createVisit({
        customerName,
        purpose,
        addressName: this.data.addressName,
        address: this.data.address,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        accuracy: this.data.accuracy ?? undefined,
        remark: this.data.remark.trim(),
        photoIds,
      });
      wx.hideLoading();
      this.setData({
        customerName: '',
        purpose: '',
        addressName: '',
        address: '',
        latitude: null,
        longitude: null,
        accuracy: null,
        remark: '',
        photos: [],
        locationSub: '需要获取当前位置',
      });
      toast('拜访已登记');
      await this.loadRecords();
    } catch (error) {
      wx.hideLoading();
      toast((error as { message?: string }).message || '拜访登记失败，请重试');
    } finally {
      this.setData({ submitting: false });
    }
  },
});
