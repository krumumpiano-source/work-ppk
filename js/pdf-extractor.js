// PDF text extraction using pdf.js (client-side)
// Falls back to Tesseract.js OCR for scanned/garbled PDFs

const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

let pdfjsLib = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(PDFJS_CDN);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjsLib;
}

function checkReadable(text) {
  const thaiChars = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  const totalChars = text.trim().length;
  if (totalChars <= 50) return false;
  return (thaiChars / Math.max(totalChars, 1)) > 0.15;
}

async function extractTextPdfJs(file) {
  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pagesText = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Reconstruct text with proper spacing
    let lastY = null;
    let lineText = '';
    const lines = [];

    for (const item of textContent.items) {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
        lines.push(lineText);
        lineText = '';
      }
      lineText += item.str + ' ';
      lastY = item.transform[5];
    }
    if (lineText) lines.push(lineText);
    pagesText.push(lines.join('\n'));
  }

  return pagesText;
}

async function extractTextOcr(file, onProgress) {
  // Dynamically load Tesseract.js
  if (!window.Tesseract) {
    if (onProgress) onProgress('กำลังโหลด OCR engine...');
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pagesText = [];
  const totalPages = Math.min(pdf.numPages, 10); // Limit to 10 pages

  const worker = await Tesseract.createWorker('tha+eng', 1, {
    logger: m => { if (onProgress && m.status === 'recognizing text') onProgress(`OCR หน้า ${m.progress ? Math.round(m.progress * 100) : 0}%`); }
  });

  for (let i = 1; i <= totalPages; i++) {
    if (onProgress) onProgress(`OCR หน้า ${i}/${totalPages}...`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 }); // 200 DPI equivalent

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;
    const { data: { text } } = await worker.recognize(canvas);
    pagesText.push(text);
  }

  await worker.terminate();
  return pagesText;
}

export async function extractTextFromPdf(file, onProgress) {
  // Step 1: Try pdf.js text extraction (fast)
  if (onProgress) onProgress('กำลังอ่านข้อความจาก PDF...');
  const pagesText = await extractTextPdfJs(file);
  const combined = pagesText.join('\n');

  if (checkReadable(combined)) {
    return {
      text: combined,
      pages: pagesText,
      is_readable: true,
      page_count: pagesText.length,
      method: 'pdfjs',
    };
  }

  // Step 2: Fallback to Tesseract.js OCR
  try {
    if (onProgress) onProgress('ข้อความไม่ชัด — กำลังใช้ OCR...');
    const ocrPages = await extractTextOcr(file, onProgress);
    const ocrCombined = ocrPages.join('\n');

    return {
      text: ocrCombined,
      pages: ocrPages,
      is_readable: checkReadable(ocrCombined),
      page_count: ocrPages.length,
      method: 'ocr',
    };
  } catch (e) {
    return {
      text: combined,
      pages: pagesText,
      is_readable: false,
      page_count: pagesText.length,
      method: 'pdfjs (ocr failed)',
      ocr_error: e.message,
    };
  }
}
