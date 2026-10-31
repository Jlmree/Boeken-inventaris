/** Barcode scannen via camera of foto. Gebruikt BarcodeDetector (Chrome/Android) of anders ZXing. */
const ZXING = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm';
let zx;
const loadZx = async () => (zx ??= await import(ZXING));

const nativeOk = () => 'BarcodeDetector' in window;

export async function startCamera(video, onCode) {
  let stopped = false, stream, timer, reader;
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    reader?.reset();
    stream?.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  };
  if (nativeOk()) {
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    await video.play();
    timer = setInterval(async () => {
      if (stopped || video.readyState < 2) return;
      try {
        const codes = await det.detect(video);
        if (codes[0]) onCode(codes[0].rawValue);
      } catch { /* frame overslaan */ }
    }, 250);
  } else {
    const Z = await loadZx();
    const hints = new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8]]]);
    reader = new Z.BrowserMultiFormatReader(hints, 300);
    await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video, (res) => {
      if (res && !stopped) onCode(res.getText());
    });
  }
  return stop;
}

export async function decodeImage(file) {
  const url = URL.createObjectURL(file);
  try {
    if (nativeOk()) {
      const bmp = await createImageBitmap(file);
      const codes = await new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] }).detect(bmp);
      if (codes[0]) return codes[0].rawValue;
    }
    const Z = await loadZx();
    const hints = new Map([[Z.DecodeHintType.TRY_HARDER, true]]);
    const res = await new Z.BrowserMultiFormatReader(hints).decodeFromImageUrl(url);
    return res.getText();
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
