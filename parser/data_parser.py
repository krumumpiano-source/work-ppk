# -*- coding: utf-8 -*-
"""
Parse extracted PDF text to find staff assignments.
Matches names against the master staff list.
"""

import re
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from staff_data import get_staff_dict, get_all_names


def normalize_name(name):
    """Normalize Thai name: remove extra spaces, normalize sara am, etc."""
    # Remove zero-width characters and normalize whitespace
    name = re.sub(r'[\u200b\u200c\u200d\ufeff]', '', name)
    # Collapse multiple spaces to one
    name = re.sub(r'\s+', ' ', name).strip()
    # Remove trailing ์ that got separated by space (common PDF artifact)
    name = re.sub(r'\s+์', '์', name)
    # Remove trailing ิ that got separated
    name = re.sub(r'\s+ิ', 'ิ', name)
    # Remove trailing ี that got separated
    name = re.sub(r'\s+ี', 'ี', name)
    # Remove trailing ื that got separated
    name = re.sub(r'\s+ื', 'ื', name)
    # Remove trailing ่ that got separated
    name = re.sub(r'\s+่', '่', name)
    # Remove trailing ้ that got separated
    name = re.sub(r'\s+้', '้', name)
    # Remove trailing ๊ that got separated
    name = re.sub(r'\s+๊', '๊', name)
    # Remove trailing ็ that got separated
    name = re.sub(r'\s+็', '็', name)
    return name


def build_name_lookup(staff_dict):
    """
    Build lookup structures for fuzzy name matching.
    Returns dict mapping normalized_name -> original_name
    """
    lookup = {}
    for name in staff_dict:
        norm = normalize_name(name)
        lookup[norm] = name
        # Also index by last name for partial matching
        parts = name.split()
        if len(parts) >= 2:
            lookup[parts[-1]] = name  # last name only (may collide, but helps)
    return lookup


def find_matching_staff(extracted_name, name_lookup, staff_dict):
    """
    Try to match an extracted name against the staff list.
    Returns the canonical staff name or None.
    """
    norm = normalize_name(extracted_name)

    # Direct match
    if norm in staff_dict:
        return norm

    # Normalized match
    if norm in name_lookup:
        return name_lookup[norm]

    # Fuzzy: try removing all spaces and matching
    no_space = norm.replace(' ', '')
    for staff_name in staff_dict:
        if staff_name.replace(' ', '') == no_space:
            return staff_name

    # Fuzzy: try matching last name + partial first name
    parts = norm.split()
    if len(parts) >= 2:
        last = parts[-1]
        first = parts[0]
        for staff_name in staff_dict:
            sparts = staff_name.split()
            if len(sparts) >= 2:
                # Same last name and first name starts with same chars
                if sparts[-1] == last and (
                    sparts[0].startswith(first[:3]) or first.startswith(sparts[0][:3])
                ):
                    return staff_name

    return None


def extract_order_info(text):
    """Extract order number and subject from the PDF text."""
    order_number = None
    order_subject = None
    order_date = None

    # Match order number: ที่ XXX / 2569 or คำสั่งที่ XXX/2569
    m = re.search(r'(?:ท[ี่ ]+|คำสั่ง(?:ที่)?)\s*(\d+)\s*/\s*(\d{4})', text)
    if m:
        order_number = f"{m.group(1)}/{m.group(2)}"

    # Match subject: เรื่อง ...
    m = re.search(r'เรื่อง\s+(.+?)(?:\n|$)', text)
    if m:
        order_subject = normalize_name(m.group(1).strip())

    # Match date: สั่ง ณ วันที่ ... or วันที่ ...เดือน...พ.ศ. ...
    m = re.search(r'สั่ง\s*ณ\s*วันที่\s*(\d+)\s*เดือน\s*(\S+)\s*พ\.ศ\.\s*(\d+)', text)
    if m:
        order_date = f"{m.group(1)} {m.group(2)} {m.group(3)}"
    else:
        # Try another pattern: วันเสาร์ที่ XX เดือน ...
        m = re.search(r'วัน\S+ที่\s+(\d+)\s+(?:เดือน\s+)?(\S+)\s+(?:พ\.ศ\.\s*)?(\d{4})', text)
        if m:
            order_date = f"{m.group(1)} {m.group(2)} {m.group(3)}"

    return {
        'order_number': order_number,
        'order_subject': order_subject,
        'order_date': order_date,
    }


def extract_section_info(text):
    """Extract section/committee headers and date context."""
    sections = []
    # Match section headers like: ๑. คณะกรรมการอำนวยการ or 4.1 ชั้นมัธยมศึกษาปีที่ 1
    pattern = r'(?:^|\n)\s*(?:[\d๐-๙]+[\.\)]\s*(?:[\d๐-๙]+[\.\)]?\s*)?)(คณะกรรมการ\S+|ฝ่าย\S+|ชั้นมัธยม\S+)'
    for m in re.finditer(pattern, text):
        sections.append(m.group(1))
    return sections


def extract_date_contexts(text):
    """Extract date-duty mappings from the text."""
    dates = []
    # Pattern: วันเสาร์ที่ XX มีนาคม 2569 or วันอาทิตย์ที่ XX เมษายน 2569
    pattern = r'วัน(\S+?)ที่\s*(\d+)\s+(?:เดือน\s*)?(\S+?)\s+(?:พ\.ศ\.\s*)?(\d{4})'
    for m in re.finditer(pattern, text):
        dates.append({
            'day_name': m.group(1),
            'day': m.group(2),
            'month': m.group(3),
            'year': m.group(4),
            'full': f"วัน{m.group(1)}ที่ {m.group(2)} {m.group(3)} {m.group(4)}",
            'pos': m.start(),
        })
    return dates


def parse_assignments(text, source_file=""):
    """
    Main parsing function: extract all staff assignments from PDF text.
    Returns list of dicts with assignment info.
    """
    staff_dict = get_staff_dict()
    name_lookup = build_name_lookup(staff_dict)

    order_info = extract_order_info(text)
    date_contexts = extract_date_contexts(text)

    assignments = []
    found_names = set()

    # Pattern to find Thai names with title prefixes
    name_pattern = re.compile(
        r'(?:นาย|นาง(?:สาว)?|น\.ส\.)\s*'
        r'([\u0E00-\u0E7F\s]+?)(?=\s+(?:'
        r'ผู้อำนวยการ|รองผู้อำนวยการ|หัวหน้า|ประธาน|รองประธาน|กรรมการ|'
        r'ครู|พนักงาน|ปฏิบัติ|มีหน้าที่|'
        r'นาย|นาง|น\.ส\.|$|'
        r'\d+\.|ห้อง|ม\.\s*\d|ระดับ|ตรวจ|รับ'
        r'))',
        re.MULTILINE
    )

    # Also match names in table-like format: น.ส.ชื่อ นามสกุล or นางชื่อ นามสกุล
    name_pattern2 = re.compile(
        r'(?:นาย|นาง(?:สาว)?|น\.ส\.)\s*'
        r'([\u0E00-\u0E7F]+\s+[\u0E00-\u0E7F]+)',
    )

    # Collect all name matches with positions
    all_matches = []
    for m in name_pattern.finditer(text):
        raw = m.group(1).strip()
        if len(raw) > 3:  # minimum reasonable name length
            all_matches.append((m.start(), raw))

    for m in name_pattern2.finditer(text):
        raw = m.group(1).strip()
        if len(raw) > 3:
            # Avoid duplicates at same position
            pos = m.start()
            if not any(abs(pos - p) < 5 for p, _ in all_matches):
                all_matches.append((pos, raw))

    # Sort by position in text
    all_matches.sort(key=lambda x: x[0])

    # Determine date context for each match
    for pos, raw_name in all_matches:
        name = normalize_name(raw_name)

        # Clean up: remove trailing non-name words
        name = re.sub(
            r'\s*(?:ประธาน|รองประธาน|กรรมการ|เลขานุการ|ผู้ช่วย|หัวหน้า|ครู|'
            r'ปฏิบัติ|ผู้อำนวยการ|รองผู้|พนักงาน|ช่วยราชการ).*$',
            '', name
        ).strip()

        if len(name) < 4:
            continue

        matched = find_matching_staff(name, name_lookup, staff_dict)
        if matched:
            found_names.add(matched)

            # Find closest date context
            duty_date = ""
            for dc in date_contexts:
                if dc['pos'] <= pos:
                    duty_date = dc['full']

            # Find section context (look backwards for section header)
            section = ""
            section_pattern = re.compile(
                r'(?:คณะกรรมการ\S+|ฝ่าย\S+|'
                r'ชั้นมัธยมศึกษาปีที่\s*\d|'
                r'ห้องสอบที่\s*\d+|'
                r'ม\.\s*\d+/\d+)',
            )
            text_before = text[max(0, pos - 500):pos]
            section_matches = list(section_pattern.finditer(text_before))
            if section_matches:
                section = section_matches[-1].group(0)

            staff_info = staff_dict[matched]
            assignments.append({
                'name': matched,
                'department': staff_info['department'],
                'position': staff_info['position'],
                'admin_role': staff_info['admin_role'],
                'order_number': order_info['order_number'] or '',
                'order_subject': order_info['order_subject'] or '',
                'order_date': order_info['order_date'] or '',
                'duty_date': duty_date,
                'duty_section': section,
                'source_file': source_file,
            })

    return {
        'order_info': order_info,
        'assignments': assignments,
        'unique_staff': list(found_names),
        'total_assignments': len(assignments),
        'unique_count': len(found_names),
    }
