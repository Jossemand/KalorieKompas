import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import zxingWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { showError } from "./lib/ui.js";

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
let barcodeDetector = null; // oprettes første gang der scannes, så WASM-filen kun hentes når den skal bruges
let cameraStream = null;    // aktiv kamerastrøm, mens scanneren er åben
let scanSession = 0;        // øges når scanneren åbnes/lukkes, så et forældet forløb kan se, at det skal stoppe
let onDetected = () => {};

let dialog;
let video;

// Stregkode-dekoderen er zxing-cpp som WASM. Hent filen fra vores eget site i stedet for en CDN
prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => (path.endsWith(".wasm") ? zxingWasmUrl : prefix + path),
  },
});

export function setupScanner(callbacks){
  dialog = document.getElementById("scanner");
  video = document.getElementById("scanner-video");
  onDetected = callbacks.onDetected;

  document.getElementById("scanner-close").addEventListener("click", closeScanner);
  document.getElementById("scanner-manual").addEventListener("click", () => {
    closeScanner();
    callbacks.onManual();
  });
  // Dialogen kan også lukkes med Escape – sluk kameraet uanset hvordan
  dialog.addEventListener("close", stopCamera);
}

export async function startScanner(){
  const session = ++scanSession;
  dialog.showModal();
  barcodeDetector ??= new BarcodeDetector({ formats: BARCODE_FORMATS });

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "environment", // bagkameraet
        // Høj opløsning er afgørende for at kunne skelne de tynde streger i en stregkode
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  } catch (err) {
    if (session === scanSession) {
      closeScanner();
      showError(new Error(`Kunne ikke starte kameraet: ${err.message || err}`));
    }
    return;
  }

  // Brugeren kan have lukket scanneren, mens kameraet startede
  if (session !== scanSession) {
    stream.getTracks().forEach(track => track.stop());
    return;
  }

  cameraStream = stream;
  enableContinuousFocus(stream);
  video.srcObject = stream;
  video.play().catch(() => {}); // afvises kun, hvis scanneren lukkes, før videoen når at starte
  scanLoop(session);
}

export function closeScanner(){
  stopCamera();
  if (dialog.open) dialog.close();
}

function stopCamera(){
  scanSession++;
  video.srcObject = null;
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
}

// Afkoder hele videobilledet i fuld opløsning, indtil der findes en stregkode eller scanneren lukkes
async function scanLoop(session){
  while (session === scanSession) {
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      let barcodes;
      try {
        barcodes = await barcodeDetector.detect(video);
      } catch (err) {
        if (session === scanSession) {
          closeScanner();
          showError(new Error(`Stregkodelæseren kunne ikke starte: ${err.message || err}`));
        }
        return;
      }
      if (barcodes.length > 0 && session === scanSession) {
        closeScanner();
        onDetected(barcodes[0].rawValue);
        return;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100)); // ca. 10 forsøg i sekundet
  }
}

// Bed om kontinuerlig autofokus, hvor browseren understøtter det (fx Chrome på Android)
function enableContinuousFocus(stream){
  const [track] = stream.getVideoTracks();
  const focusModes = track?.getCapabilities?.().focusMode ?? [];
  if (focusModes.includes("continuous")) {
    track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
  }
}
