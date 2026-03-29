# -*- coding: utf-8 -*-
"""
PDF text extraction module.
Handles both text-based and garbled-font PDFs.
Falls back to OCR (Tesseract) when text extraction produces unreadable results.
"""

import pdfplumber
import fitz  # PyMuPDF
import re
import io


def _check_readable(text):
    """Check if extracted text contains sufficient Thai characters."""
    thai_chars = len(re.findall(r'[\u0E00-\u0E7F]', text))
    total_chars = len(text.strip())
    if total_chars <= 50:
        return False
    return (thai_chars / max(total_chars, 1)) > 0.15


def _extract_text_pdfplumber(filepath):
    """Extract text using pdfplumber (fast, for text-based PDFs)."""
    pages_text = []
    with pdfplumber.open(filepath) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            pages_text.append(text)
    return pages_text


def _extract_text_ocr(filepath):
    """Extract text using Tesseract OCR (for garbled-font or scanned PDFs)."""
    import pytesseract
    from PIL import Image

    pages_text = []
    doc = fitz.open(filepath)

    for page_num in range(len(doc)):
        page = doc[page_num]
        # Render at 300 DPI for good OCR quality
        mat = fitz.Matrix(300 / 72, 300 / 72)
        pix = page.get_pixmap(matrix=mat)

        # Convert pixmap to PIL Image
        img_data = pix.tobytes("png")
        img = Image.open(io.BytesIO(img_data))

        # Run Tesseract OCR with Thai + English
        page_text = pytesseract.image_to_string(img, lang='tha+eng')
        pages_text.append(page_text)

    doc.close()
    return pages_text


def extract_text_from_pdf(filepath):
    """
    Extract text from a PDF file.
    First tries pdfplumber (fast). If text is unreadable, falls back to OCR.

    Returns: {
        'text': str (all pages combined),
        'pages': list of str (per-page text),
        'is_readable': bool,
        'page_count': int,
        'method': str ('pdfplumber' or 'ocr')
    }
    """
    # Step 1: Try pdfplumber
    pages_text = _extract_text_pdfplumber(filepath)
    combined = "\n".join(pages_text)
    method = 'pdfplumber'

    if _check_readable(combined):
        return {
            'text': combined,
            'pages': pages_text,
            'is_readable': True,
            'page_count': len(pages_text),
            'method': method,
        }

    # Step 2: Fallback to OCR
    try:
        pages_text = _extract_text_ocr(filepath)
        combined = "\n".join(pages_text)
        method = 'ocr'
        is_readable = _check_readable(combined)

        return {
            'text': combined,
            'pages': pages_text,
            'is_readable': is_readable,
            'page_count': len(pages_text),
            'method': method,
        }
    except Exception as e:
        # OCR failed, return original unreadable result
        return {
            'text': combined,
            'pages': pages_text,
            'is_readable': False,
            'page_count': len(pages_text),
            'method': 'pdfplumber (ocr failed)',
            'ocr_error': str(e),
        }
