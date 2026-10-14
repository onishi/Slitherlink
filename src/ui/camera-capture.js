/**
 * パソコンのカメラで問題を撮る画面。
 * スマホはファイル選びの capture 指定でカメラが開くが、パソコンのブラウザはそれを無視して
 * ファイル選びになるので、こちらでカメラの映像を出して 1 枚撮る。
 */

/** capture 指定でカメラが開かない端末か（指で触る画面が無い＝パソコン）。 */
export function needsCameraView() {
  return !!navigator.mediaDevices?.getUserMedia && !matchMedia('(any-pointer: coarse)').matches;
}

export class CameraCapture {
  /**
   * @param {object} parts 画面の部品（index.html の camera-modal の中）
   * @param {(blob:Blob)=>void} onShot 撮った写真を渡す
   */
  constructor(parts, onShot) {
    Object.assign(this, parts);
    this.onShot = onShot;
    this.stream = null;
    this.shootBtn.addEventListener('click', () => this._shoot());
    this.cancelBtn.addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (ev) => { if (ev.target === this.modal) this.close(); });
    this.select.addEventListener('change', () => this._start(this.select.value));
  }

  get isOpen() { return !this.modal.hidden; }

  async open() {
    this.modal.hidden = false;
    this.status.textContent = 'カメラを準備しています…';
    await this._start();
  }

  close() {
    this._stop();
    this.modal.hidden = true;
  }

  /** カメラの映像を出す。deviceId を渡すとそのカメラに切り替える。 */
  async _start(deviceId) {
    this._stop();
    this.shootBtn.disabled = true;
    const video = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: 'environment' };
    try {
      // 細かい字を読むので、出せるなら大きく撮る
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { ...video, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (err) {
      this.status.textContent = err?.name === 'NotAllowedError'
        ? 'カメラを使う許可がありません。ブラウザの設定でカメラを許可するか、「写真から作る」を使ってください。'
        : 'カメラを使えませんでした。「写真から作る」で画像を選んでください。';
      return;
    }
    if (!this.isOpen) { this._stop(); return; } // 準備のあいだに閉じられた
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    this.status.textContent = '盤が枠いっぱいに、まっすぐ写るようにして「撮る」を押してください。';
    this.shootBtn.disabled = false;
    await this._listCameras();
  }

  /** カメラが 2 台以上あるとき（内蔵カメラと iPhone など）だけ、切り替えを出す。 */
  async _listCameras() {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const current = this.stream?.getVideoTracks()[0]?.getSettings().deviceId;
    this.select.textContent = '';
    devices.forEach((d, i) => {
      const option = new Option(d.label || `カメラ ${i + 1}`, d.deviceId);
      option.selected = d.deviceId === current;
      this.select.add(option);
    });
    this.selectRow.hidden = devices.length < 2;
  }

  _stop() {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.video.srcObject = null;
  }

  _shoot() {
    const { videoWidth: w, videoHeight: h } = this.video;
    if (!w || !h) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(this.video, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (!blob) return;
      this.close();
      this.onShot(blob);
    }, 'image/jpeg', 0.92);
  }
}
