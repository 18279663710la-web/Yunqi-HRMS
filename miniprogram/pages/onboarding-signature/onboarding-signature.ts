interface SignatureData {
  drawn: boolean; saving: boolean; x: number; y: number;
  left: number; top: number; width: number; height: number;
}
interface SignatureMethods {
  cancelSignature(): void; clearSignature(): void; signatureStart(e: WechatMiniprogram.TouchEvent): void;
  signatureMove(e: WechatMiniprogram.TouchEvent): void; saveSignature(): void;
}
Page<SignatureData, SignatureMethods>({
  data: { drawn: false, saving: false, x: 0, y: 0, left: 0, top: 0, width: 0, height: 0 },
  onReady() {
    wx.createSelectorQuery().in(this).select('#signatureCanvas').boundingClientRect(rect => {
      if (rect && !Array.isArray(rect)) this.setData({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }).exec();
  },
  cancelSignature() { if (!this.data.saving) wx.navigateBack(); },
  clearSignature() {
    if (this.data.saving) return;
    const ctx = wx.createCanvasContext('signatureCanvas', this);
    ctx.clearRect(0, 0, this.data.width, this.data.height); ctx.draw(); this.setData({ drawn: false });
  },
  signatureStart(e) {
    const point = e.touches[0]; if (!point || this.data.saving) return;
    this.setData({ x: point.clientX - this.data.left, y: point.clientY - this.data.top });
  },
  signatureMove(e) {
    const point = e.touches[0]; if (!point || this.data.saving) return;
    const x = point.clientX - this.data.left; const y = point.clientY - this.data.top;
    const ctx = wx.createCanvasContext('signatureCanvas', this);
    ctx.setStrokeStyle('#17243b'); ctx.setLineWidth(2.5); ctx.setLineCap('round');
    ctx.beginPath(); ctx.moveTo(this.data.x, this.data.y); ctx.lineTo(x, y); ctx.stroke(); ctx.draw(true);
    this.setData({ x, y, drawn: true });
  },
  saveSignature() {
    if (this.data.saving) return;
    if (!this.data.drawn) { wx.showToast({ title: '请先手写签名', icon: 'none' }); return; }
    this.setData({ saving: true });
    wx.canvasToTempFilePath({ canvasId: 'signatureCanvas', fileType: 'png',
      success: result => wx.getFileSystemManager().readFile({ filePath: result.tempFilePath, encoding: 'base64',
        success: file => {
          const data = String(file.data);
          if (data.length > 1398104) { this.setData({ saving: false }); wx.showToast({ title: '签名图片过大', icon: 'none' }); return; }
          const channel = this.getOpenerEventChannel?.();
          if (!channel || typeof channel.emit !== 'function') { this.setData({ saving: false }); wx.showToast({ title: '无法返回入职表单', icon: 'none' }); return; }
          channel.emit('signatureSaved', { data: `data:image/png;base64,${data}`, preview: result.tempFilePath });
          wx.navigateBack();
        },
        fail: () => { this.setData({ saving: false }); wx.showToast({ title: '无法读取签名', icon: 'none' }); },
      }),
      fail: () => { this.setData({ saving: false }); wx.showToast({ title: '签名保存失败', icon: 'none' }); },
    }, this);
  },
});

