# -*- coding: utf-8 -*-
"""
Workload fairness analyzer.
Provides weighted scoring, timeline analysis, fatigue index,
cross-department tracking, and fairness metrics.
"""

import re
import math
from collections import defaultdict
from datetime import datetime, timedelta

# ============================================================
# 1. TASK TYPE CLASSIFICATION & WEIGHTED SCORING
# ============================================================

# น้ำหนักงานตามประเภท (ยิ่งหนักยิ่งสูง)
TASK_WEIGHTS = {
    'กำกับห้องสอบ': 3.0,       # คุมสอบทั้งวัน — หนักสุด
    'คุมสอบ': 3.0,
    'กรรมการคุมสอบ': 3.0,
    'ตรวจข้อสอบ': 2.5,
    'ออกข้อสอบ': 2.0,
    'ดำเนินการสอบ': 2.5,       # จัดสอบทั้งวัน
    'รับมอบตัว': 2.0,          # รับมอบตัวนักเรียน
    'ลงทะเบียน': 1.5,
    'รับรายงานตัว': 1.5,
    'รับสมัคร': 1.5,
    'ประชาสัมพันธ์': 1.0,
    'ประชุม': 1.0,
    'พิธีการ': 1.0,
    'อำนวยการ': 1.5,           # คณะกรรมการอำนวยการ
    'ประสานงาน': 1.0,
    'สถานที่': 1.5,
    'อาคาร': 1.5,
    'โสตทัศนศึกษา': 1.5,
    'พยาบาล': 2.0,             # เวรพยาบาล
    'จราจร': 1.5,
    'รักษาความปลอดภัย': 2.0,
    'การเงิน': 1.5,
    'พัสดุ': 1.5,
    'ประเมินผล': 2.0,
    'เลขานุการ': 2.0,         # รับภาระประสานงานเยอะ
    'ทั่วไป': 1.0,             # ค่าเริ่มต้น
}

# น้ำหนักตามบทบาท
ROLE_WEIGHTS = {
    'ประธาน': 1.5,
    'รองประธาน': 1.3,
    'เลขานุการ': 1.4,
    'ผู้ช่วยเลขานุการ': 1.2,
    'กรรมการและเลขานุการ': 1.4,
    'กรรมการ': 1.0,
}

# ฝ่ายงานในโรงเรียน
DEPARTMENT_GROUPS = {
    'วิชาการ': ['สอบ', 'ข้อสอบ', 'วิชาการ', 'ตรวจ', 'ประเมินผล', 'หลักสูตร', 'วัดผล'],
    'กิจการนักเรียน': ['นักเรียน', 'รับสมัคร', 'มอบตัว', 'รายงานตัว', 'ลงทะเบียน', 'ปฐมนิเทศ'],
    'บริหารทั่วไป': ['สถานที่', 'อาคาร', 'จราจร', 'ความปลอดภัย', 'โสต', 'ประชาสัมพันธ์', 'พิธี'],
    'งบประมาณ': ['การเงิน', 'พัสดุ', 'งบ'],
    'บุคคล': ['บุคคล', 'อัตรากำลัง'],
}

# ชื่อเดือนไทย -> เลขเดือน
THAI_MONTHS = {
    'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4,
    'พฤษภาคม': 5, 'มิถุนายน': 6, 'กรกฎาคม': 7, 'สิงหาคม': 8,
    'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12,
}


def classify_task_type(order_subject, duty_section, duration_hours=0):
    """
    Classify a task based on order subject and duty section.
    Returns (task_type, task_weight, role_type, role_weight, work_group, duration_factor).
    duration_hours: hours of duty parsed from PDF time range.
    """
    combined = f"{order_subject or ''} {duty_section or ''}".lower()

    # Determine task type
    task_type = 'ทั่วไป'
    task_weight = TASK_WEIGHTS['ทั่วไป']

    for keyword, weight in sorted(TASK_WEIGHTS.items(), key=lambda x: -x[1]):
        if keyword in combined:
            task_type = keyword
            task_weight = weight
            break

    # Determine role
    role_type = 'กรรมการ'
    role_weight = ROLE_WEIGHTS['กรรมการ']

    for role, rw in sorted(ROLE_WEIGHTS.items(), key=lambda x: -x[1]):
        if role in combined:
            role_type = role
            role_weight = rw
            break

    # Determine work group (ฝ่าย)
    work_group = 'อื่นๆ'
    for group, keywords in DEPARTMENT_GROUPS.items():
        for kw in keywords:
            if kw in combined:
                work_group = group
                break
        if work_group != 'อื่นๆ':
            break

    # Duration factor: normalize to 3 hours as baseline (1.0x)
    # 0 means no time info — use 1.0x default
    if duration_hours > 0:
        duration_factor = round(duration_hours / 3.0, 2)
    else:
        duration_factor = 1.0

    return {
        'task_type': task_type,
        'task_weight': task_weight,
        'role_type': role_type,
        'role_weight': role_weight,
        'work_group': work_group,
        'duration_hours': duration_hours,
        'duration_factor': duration_factor,
        'weighted_score': round(task_weight * role_weight * duration_factor, 2),
    }


# ============================================================
# 2. DATE PARSING & TIMELINE ANALYSIS
# ============================================================

def parse_thai_date(date_str):
    """Parse Thai date string to Python date object."""
    if not date_str:
        return None

    # Clean up
    date_str = re.sub(r'วัน\S+ที่\s*', '', date_str).strip()

    # Try: DD เดือน YYYY
    m = re.search(r'(\d+)\s+(\S+)\s+(\d{4})', date_str)
    if m:
        day = int(m.group(1))
        month_name = m.group(2)
        year_be = int(m.group(3))

        month = THAI_MONTHS.get(month_name)
        if month and day >= 1 and day <= 31:
            year_ce = year_be - 543
            try:
                return datetime(year_ce, month, day).date()
            except ValueError:
                pass

    # Try Thai numerals
    thai_digits = str.maketrans('๐๑๒๓๔๕๖๗๘๙', '0123456789')
    converted = date_str.translate(thai_digits)
    m = re.search(r'(\d+)\s+(\S+)\s+(\d{4})', converted)
    if m:
        day = int(m.group(1))
        month_name = m.group(2)
        year_be = int(m.group(3))

        month = THAI_MONTHS.get(month_name)
        if month and day >= 1 and day <= 31:
            year_ce = year_be - 543
            try:
                return datetime(year_ce, month, day).date()
            except ValueError:
                pass

    return None


def analyze_timeline(assignments_list):
    """
    Analyze timeline for a list of assignments belonging to one person.
    Returns timeline metrics.
    """
    dates = []
    for a in assignments_list:
        # Try duty_date first, then order_date
        d = parse_thai_date(a.get('duty_date', ''))
        if not d:
            d = parse_thai_date(a.get('order_date', ''))
        if d:
            dates.append(d)

    if not dates:
        return {
            'has_dates': False,
            'date_count': 0,
            'unique_dates': 0,
            'first_date': None,
            'last_date': None,
            'span_days': 0,
            'avg_gap_days': None,
            'min_gap_days': None,
            'max_gap_days': None,
            'cluster_count': 0,
            'dates_sorted': [],
        }

    dates.sort()
    unique_dates = sorted(set(dates))

    gaps = []
    for i in range(1, len(unique_dates)):
        gap = (unique_dates[i] - unique_dates[i - 1]).days
        gaps.append(gap)

    # Detect clusters: dates within 3 days of each other
    clusters = []
    current_cluster = [unique_dates[0]]
    for i in range(1, len(unique_dates)):
        if (unique_dates[i] - unique_dates[i - 1]).days <= 3:
            current_cluster.append(unique_dates[i])
        else:
            clusters.append(current_cluster)
            current_cluster = [unique_dates[i]]
    clusters.append(current_cluster)

    return {
        'has_dates': True,
        'date_count': len(dates),
        'unique_dates': len(unique_dates),
        'first_date': str(unique_dates[0]),
        'last_date': str(unique_dates[-1]),
        'span_days': (unique_dates[-1] - unique_dates[0]).days,
        'avg_gap_days': round(sum(gaps) / len(gaps), 1) if gaps else 0,
        'min_gap_days': min(gaps) if gaps else 0,
        'max_gap_days': max(gaps) if gaps else 0,
        'cluster_count': len(clusters),
        'cluster_sizes': [len(c) for c in clusters],
        'dates_sorted': [str(d) for d in unique_dates],
    }


# ============================================================
# 3. FATIGUE INDEX
# ============================================================

def calculate_fatigue_index(person_summary):
    """
    Calculate fatigue index (0-100) based on multiple factors:
    - Weighted score total
    - Frequency (number of assignments)
    - Clustering (assignments bunched together)
    - Short gaps between tasks

    Higher = more fatigued/overworked.
    """
    ws = person_summary.get('total_weighted_score', 0)
    count = person_summary.get('assignment_count', 0)
    timeline = person_summary.get('timeline', {})

    if count == 0:
        return 0.0

    # Factor 1: Raw workload (weighted score) — max contribution 30
    # Assume avg person gets ~5 weighted score
    f1 = min(ws / 15.0 * 30, 30)

    # Factor 2: Frequency — max contribution 25
    f2 = min(count / 8.0 * 25, 25)

    # Factor 3: Clustering penalty — max contribution 25
    cluster_sizes = timeline.get('cluster_sizes', [])
    max_cluster = max(cluster_sizes) if cluster_sizes else 0
    f3 = min(max_cluster / 4.0 * 25, 25)

    # Factor 4: Short gap penalty — max contribution 20
    min_gap = timeline.get('min_gap_days')
    if min_gap is not None and min_gap >= 0:
        if min_gap == 0:
            f4 = 20
        elif min_gap <= 2:
            f4 = 15
        elif min_gap <= 7:
            f4 = 10
        elif min_gap <= 14:
            f4 = 5
        else:
            f4 = 0
    else:
        f4 = 0

    fatigue = round(f1 + f2 + f3 + f4, 1)
    return min(fatigue, 100.0)


# ============================================================
# 4. FAIRNESS METRICS
# ============================================================

def calculate_gini_coefficient(values):
    """
    Calculate Gini coefficient (0 = perfect equality, 1 = max inequality).
    """
    if not values or len(values) < 2:
        return 0.0

    values = sorted(values)
    n = len(values)
    total = sum(values)

    if total == 0:
        return 0.0

    cumsum = 0
    gini_sum = 0
    for i, v in enumerate(values):
        cumsum += v
        gini_sum += (2 * (i + 1) - n - 1) * v

    return round(abs(gini_sum) / (n * total), 4)


def calculate_fairness_metrics(summary_list):
    """
    Calculate comprehensive fairness metrics.
    """
    counts = [s['assignment_count'] for s in summary_list]
    scores = [s.get('total_weighted_score', 0) for s in summary_list]
    fatigues = [s.get('fatigue_index', 0) for s in summary_list]

    assigned_counts = [c for c in counts if c > 0]

    def std_dev(vals):
        if len(vals) < 2:
            return 0
        mean = sum(vals) / len(vals)
        return round(math.sqrt(sum((v - mean) ** 2 for v in vals) / len(vals)), 2)

    def cv(vals):
        """Coefficient of variation (SD/mean * 100)"""
        if not vals:
            return 0
        mean = sum(vals) / len(vals)
        if mean == 0:
            return 0
        return round(std_dev(vals) / mean * 100, 1)

    total_count = sum(counts)
    total_staff = len(counts)
    avg_count = round(total_count / max(total_staff, 1), 2)

    # People significantly above average (> 1.5x avg)
    overworked = [s for s in summary_list if s['assignment_count'] > avg_count * 1.5]
    # People significantly below average (< 0.5x avg) but not zero
    underworked = [s for s in summary_list if 0 < s['assignment_count'] < avg_count * 0.5]
    # Never assigned
    never = [s for s in summary_list if s['assignment_count'] == 0]

    # Fairness score (100 = perfectly fair)
    gini = calculate_gini_coefficient(counts)
    fairness_score = round((1 - gini) * 100, 1)

    return {
        'gini_coefficient': gini,
        'fairness_score': fairness_score,
        'fairness_grade': (
            'A (เท่าเทียมดีมาก)' if fairness_score >= 85 else
            'B (ค่อนข้างเท่าเทียม)' if fairness_score >= 70 else
            'C (ไม่ค่อยเท่าเทียม)' if fairness_score >= 55 else
            'D (ไม่เท่าเทียม)' if fairness_score >= 40 else
            'F (ไม่เท่าเทียมอย่างมาก)'
        ),
        'count_stats': {
            'total': total_count,
            'mean': avg_count,
            'std_dev': std_dev(counts),
            'cv': cv(counts),
            'min': min(counts) if counts else 0,
            'max': max(counts) if counts else 0,
            'median': sorted(counts)[len(counts) // 2] if counts else 0,
        },
        'weighted_stats': {
            'total': round(sum(scores), 2),
            'mean': round(sum(scores) / max(len(scores), 1), 2),
            'std_dev': std_dev(scores),
            'cv': cv(scores),
            'gini': calculate_gini_coefficient(scores),
        },
        'fatigue_stats': {
            'mean': round(sum(fatigues) / max(len(fatigues), 1), 1),
            'max': round(max(fatigues), 1) if fatigues else 0,
            'std_dev': std_dev(fatigues),
        },
        'distribution': {
            'overworked_count': len(overworked),
            'overworked_names': [s['name'] for s in overworked],
            'underworked_count': len(underworked),
            'underworked_names': [s['name'] for s in underworked],
            'never_assigned_count': len(never),
            'never_assigned_names': [s['name'] for s in never],
            'participation_rate': round(len(assigned_counts) / max(total_staff, 1) * 100, 1),
        },
    }


def calculate_dept_fairness(summary_list):
    """Calculate fairness metrics per department."""
    dept_groups = defaultdict(list)
    for s in summary_list:
        dept_groups[s['department']].append(s)

    dept_fairness = {}
    for dept, members in dept_groups.items():
        counts = [m['assignment_count'] for m in members]
        scores = [m.get('total_weighted_score', 0) for m in members]
        fatigues = [m.get('fatigue_index', 0) for m in members]

        avg_count = sum(counts) / max(len(counts), 1)
        avg_score = sum(scores) / max(len(scores), 1)
        assigned = sum(1 for c in counts if c > 0)

        dept_fairness[dept] = {
            'total_staff': len(members),
            'assigned_count': assigned,
            'participation_rate': round(assigned / max(len(members), 1) * 100, 1),
            'total_assignments': sum(counts),
            'total_weighted_score': round(sum(scores), 2),
            'avg_assignments': round(avg_count, 1),
            'avg_weighted_score': round(avg_score, 2),
            'avg_fatigue': round(sum(fatigues) / max(len(fatigues), 1), 1),
            'max_assignments': max(counts) if counts else 0,
            'min_assignments': min(counts) if counts else 0,
            'gini': calculate_gini_coefficient(counts),
            'fairness_score': round((1 - calculate_gini_coefficient(counts)) * 100, 1),
        }

    return dept_fairness


# ============================================================
# 5. WORK GROUP (ฝ่ายงาน) TRACKING
# ============================================================

def classify_work_group(order_subject, duty_section):
    """Classify which work group (ฝ่ายงาน) an assignment belongs to."""
    combined = f"{order_subject or ''} {duty_section or ''}"

    for group, keywords in DEPARTMENT_GROUPS.items():
        for kw in keywords:
            if kw in combined:
                return group

    return 'อื่นๆ'


# ============================================================
# 6. MAIN ANALYSIS FUNCTION
# ============================================================

def analyze_workload_fairness(summary_list, all_assignments):
    """
    Main analysis function. Takes the summary from app.py and enriches it
    with weighted scores, timeline, fatigue index, and fairness metrics.

    Args:
        summary_list: list of person summaries (from /api/analyze)
        all_assignments: flat list of all assignments

    Returns: enriched analysis dict
    """
    # Enrich each person's summary
    for person in summary_list:
        assignments = person.get('assignments', [])

        # Weighted scoring
        total_ws = 0
        work_groups = defaultdict(int)
        task_types = defaultdict(int)

        for a in assignments:
            classification = classify_task_type(
                a.get('order_subject', ''),
                a.get('duty_section', ''),
                a.get('duration_hours', 0),
            )
            a['classification'] = classification
            total_ws += classification['weighted_score']
            work_groups[classification['work_group']] += 1
            task_types[classification['task_type']] += 1

        person['total_weighted_score'] = round(total_ws, 2)
        person['work_groups'] = dict(work_groups)
        person['task_types'] = dict(task_types)
        person['work_group_count'] = len(work_groups)

        # Timeline analysis
        person['timeline'] = analyze_timeline(assignments)

        # Fatigue index
        person['fatigue_index'] = calculate_fatigue_index(person)

    # Overall fairness metrics
    fairness = calculate_fairness_metrics(summary_list)

    # Per-department fairness
    dept_fairness = calculate_dept_fairness(summary_list)

    # Work group distribution (how many assignments per ฝ่าย)
    overall_work_groups = defaultdict(int)
    for a in all_assignments:
        wg = classify_work_group(
            a.get('order_subject', ''),
            a.get('duty_section', '')
        )
        overall_work_groups[wg] += 1

    return {
        'summary': summary_list,
        'fairness': fairness,
        'dept_fairness': dept_fairness,
        'work_group_distribution': dict(overall_work_groups),
    }
