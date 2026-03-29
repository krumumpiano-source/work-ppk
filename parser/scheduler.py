# -*- coding: utf-8 -*-
"""
Fair Workload Scheduler.
Auto-assigns staff to proctoring or general tasks using
historical weighted scores (from ALL work groups/order types)
to ensure fairness.

Key fairness principles:
  1. cumulative_ws จากทุกกลุ่มงาน (คุมสอบ, รับมอบตัว, จราจร, ฯลฯ)
     ถูกนำมาพิจารณาร่วมกัน — ไม่ใช่แค่คุมสอบอย่างเดียว
  2. fatigue_index ป้องกันคนถูกมอบหมายถี่เกินไป
  3. ประธาน/รองประธาน ไม่เลือกจาก admin_role อย่างเดียว
     แต่ดูภาระสะสมด้วย (cumulative_ws ต้องไม่เกินค่าเฉลี่ย×1.5)
  4. deterministic seed — config เดียวกันได้ผลเดียวกัน
"""

import hashlib
import json
import math
import random
from collections import defaultdict
from datetime import datetime

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from staff_data import get_staff_dict, get_departments, STAFF_LIST


def _make_seed(config):
    """Create deterministic seed from config so same input = same output."""
    raw = json.dumps(config, sort_keys=True, ensure_ascii=False, default=str)
    return int(hashlib.md5(raw.encode('utf-8')).hexdigest()[:8], 16)


def get_staff_priority_scores(historical_summary=None):
    """
    Build priority scores for all staff from ALL historical orders
    (cross-group: คุมสอบ, รับมอบตัว, จราจร, ฯลฯ ถูกนับรวมหมด).
    Lower cumulative score = higher priority (should get assigned first).
    """
    staff_dict = get_staff_dict()
    scores = {}

    for name, info in staff_dict.items():
        scores[name] = {
            'name': name,
            'department': info['department'],
            'position': info['position'],
            'admin_role': info['admin_role'],
            'cumulative_ws': 0.0,
            'cumulative_count': 0,
            'fatigue_index': 0.0,
        }

    # Enrich with historical data if available
    # historical_summary มาจาก analyze_workload_fairness() ซึ่งรวม
    # ทุกคำสั่งจากทุกกลุ่มงานแล้ว (total_weighted_score = ผลรวมทุกประเภท)
    if historical_summary:
        for person in historical_summary:
            name = person.get('name')
            if name in scores:
                scores[name]['cumulative_ws'] = person.get('total_weighted_score', 0)
                scores[name]['cumulative_count'] = person.get('assignment_count', 0)
                scores[name]['fatigue_index'] = person.get('fatigue_index', 0)

    return scores


def schedule_proctoring(config, historical_summary=None):
    """
    Generate a fair proctoring schedule.

    config = {
        'exam_name': str,
        'sessions': [
            {
                'date': str (YYYY-MM-DD),
                'period': str (ภาคเช้า/ภาคบ่าย),
                'start_time': str (HH:MM),
                'end_time': str (HH:MM),
                'rooms': [str] or int (count),
                'proctors_per_room': int (default 2),
                'exclude_depts': [str],  # departments to exclude (testing their subject)
                'exclude_names': [str],  # specific names to exclude
            }
        ]
    }

    Returns schedule with assignments.
    """
    # Deterministic seed: same config = same schedule
    rng = random.Random(_make_seed(config))

    scores = get_staff_priority_scores(historical_summary)
    exam_name = config.get('exam_name', 'ไม่ระบุชื่อ')
    sessions = config.get('sessions', [])

    schedule = []
    # Track new assignments during scheduling to update running scores
    session_assignments = defaultdict(set)  # session_key -> set of assigned names

    for session in sessions:
        date = session.get('date', '')
        period = session.get('period', '')
        start_time = session.get('start_time', '08:00')
        end_time = session.get('end_time', '12:00')
        exclude_depts = [d.strip() for d in session.get('exclude_depts', []) if d.strip()]
        exclude_names = set(session.get('exclude_names', []))
        proctors_per_room = session.get('proctors_per_room', 2)

        # Calculate duration for this session
        try:
            h1, m1 = map(int, start_time.split(':'))
            h2, m2 = map(int, end_time.split(':'))
            duration_hours = max((h2 * 60 + m2 - h1 * 60 - m1), 0) / 60.0
        except (ValueError, AttributeError):
            duration_hours = 3.0

        # Duration factor normalized to 3-hour baseline
        duration_factor = round(duration_hours / 3.0, 2) if duration_hours > 0 else 1.0
        # Weight for proctoring
        session_weight = round(3.0 * 1.0 * duration_factor, 2)  # task=คุมสอบ(3.0) × role=กรรมการ(1.0) × duration

        # Build room list
        rooms = session.get('rooms', [])
        if isinstance(rooms, int):
            rooms = [f"ห้อง {i+1}" for i in range(rooms)]
        elif isinstance(rooms, str):
            rooms = [r.strip() for r in rooms.split(',') if r.strip()]

        session_key = f"{date}_{period}"

        # Get eligible staff for this session
        eligible = []
        for name, info in scores.items():
            if name in exclude_names:
                continue
            if info['department'] in exclude_depts:
                continue
            if name in session_assignments[session_key]:
                continue
            eligible.append(info)

        # Sort by: cumulative_ws (cross-group total) > fatigue_index > count > random
        # fatigue_index มีผล: คนที่ถูกมอบหมายถี่ (cluster สูง) จะถูกเลื่อนลำดับลง
        eligible.sort(key=lambda x: (
            x['cumulative_ws'] + x['fatigue_index'] * 0.5,  # fatigue penalty
            x['cumulative_count'],
            rng.random()
        ))

        session_schedule = {
            'date': date,
            'period': period,
            'start_time': start_time,
            'end_time': end_time,
            'duration_hours': duration_hours,
            'session_weight': session_weight,
            'rooms': [],
        }

        eligible_idx = 0
        for room in rooms:
            room_proctors = []
            attempts = 0
            while len(room_proctors) < proctors_per_room and eligible_idx < len(eligible) and attempts < len(eligible):
                candidate = eligible[eligible_idx]
                eligible_idx += 1
                attempts += 1

                if candidate['name'] not in session_assignments[session_key]:
                    room_proctors.append({
                        'name': candidate['name'],
                        'department': candidate['department'],
                        'position': candidate['position'],
                        'admin_role': candidate['admin_role'],
                        'cumulative_ws_before': round(candidate['cumulative_ws'], 2),
                        'cumulative_ws_after': round(candidate['cumulative_ws'] + session_weight, 2),
                        'cumulative_count': candidate['cumulative_count'],
                        'fatigue_index': round(candidate['fatigue_index'], 1),
                    })
                    # Mark as assigned for this session
                    session_assignments[session_key].add(candidate['name'])
                    # Update running score
                    scores[candidate['name']]['cumulative_ws'] += session_weight
                    scores[candidate['name']]['cumulative_count'] += 1

            session_schedule['rooms'].append({
                'room_name': room,
                'proctors': room_proctors,
                'proctors_needed': proctors_per_room,
                'proctors_assigned': len(room_proctors),
            })

        schedule.append(session_schedule)

    # Summary statistics
    all_assigned = set()
    total_slots = 0
    total_filled = 0
    for s in schedule:
        for r in s['rooms']:
            total_slots += r['proctors_needed']
            total_filled += r['proctors_assigned']
            for p in r['proctors']:
                all_assigned.add(p['name'])

    # Department distribution
    dept_dist = defaultdict(int)
    for s in schedule:
        for r in s['rooms']:
            for p in r['proctors']:
                dept_dist[p['department']] += 1

    # Fairness check: compute score range of newly assigned
    assigned_scores = [scores[n]['cumulative_ws'] for n in all_assigned]
    score_range = max(assigned_scores) - min(assigned_scores) if assigned_scores else 0

    # Average score for context
    avg_score = sum(assigned_scores) / max(len(assigned_scores), 1) if assigned_scores else 0

    has_history = bool(historical_summary and any(p.get('total_weighted_score', 0) > 0 for p in historical_summary))

    return {
        'exam_name': exam_name,
        'schedule': schedule,
        'summary': {
            'total_sessions': len(schedule),
            'total_rooms': sum(len(s['rooms']) for s in schedule),
            'total_slots': total_slots,
            'total_filled': total_filled,
            'total_staff_used': len(all_assigned),
            'fill_rate': round(total_filled / max(total_slots, 1) * 100, 1),
            'dept_distribution': dict(dept_dist),
            'score_range_after': round(score_range, 2),
            'avg_score_after': round(avg_score, 2),
            'has_historical_data': has_history,
            'cross_group_note': 'คะแนนสะสมรวมทุกประเภทคำสั่ง (คุมสอบ, รับมอบตัว, จราจร ฯลฯ)' if has_history else 'ยังไม่มีข้อมูลย้อนหลัง — กรุณาอัปโหลดและวิเคราะห์ PDF ก่อน เพื่อให้จัดตารางโดยพิจารณาภาระจากทุกกลุ่มงาน',
        },
    }


def schedule_assignment(config, historical_summary=None):
    """
    Generate fair staff assignment for general tasks.
    
    ความเที่ยงธรรม:
    - cumulative_ws รวมทุกกลุ่มงาน (ไม่ใช่แค่ประเภทเดียว)
    - ประธาน/รองฯ: เลือกจากคนที่มี admin_role แต่ต้องไม่เกินค่าเฉลี่ย×1.5
      ถ้าหัวหน้าทุกคนภาระเกิน → เลือกจากคนทั่วไปที่ภาระน้อยสุด
    - fatigue_index ถูกใช้ลดลำดับคนที่ทำงานถี่
    - ป้องกัน role conflict: คนเดียวกันไม่ซ้ำหลาย role
    """
    from parser.workload_analyzer import TASK_WEIGHTS, ROLE_WEIGHTS

    # Validation
    roles = config.get('roles', {'กรรมการ': 10})
    total_requested = sum(max(0, v) for v in roles.values())
    if total_requested <= 0:
        return {
            'error': 'กรุณาระบุจำนวนบุคลากรอย่างน้อย 1 ตำแหน่ง',
            'task_name': config.get('task_name', ''),
            'assignments': [],
            'summary': {'total_assigned': 0, 'total_requested': 0},
        }

    # Deterministic seed
    rng = random.Random(_make_seed(config))

    scores = get_staff_priority_scores(historical_summary)
    task_name = config.get('task_name', 'ไม่ระบุ')
    task_type = config.get('task_type', 'ทั่วไป')
    date = config.get('date', '')
    start_time = config.get('start_time', '08:00')
    end_time = config.get('end_time', '16:00')
    exclude_depts = set(config.get('exclude_depts', []))
    exclude_names = set(config.get('exclude_names', []))
    prefer_depts = set(config.get('prefer_depts', []))

    # Calculate duration
    try:
        h1, m1 = map(int, start_time.split(':'))
        h2, m2 = map(int, end_time.split(':'))
        duration_hours = max((h2 * 60 + m2 - h1 * 60 - m1), 0) / 60.0
    except (ValueError, AttributeError):
        duration_hours = 3.0

    duration_factor = round(duration_hours / 3.0, 2) if duration_hours > 0 else 1.0
    task_weight = TASK_WEIGHTS.get(task_type, TASK_WEIGHTS.get('ทั่วไป', 1.0))

    # Eligible staff (cross-group: cumulative_ws มาจากทุกประเภทคำสั่ง)
    eligible = []
    for name, info in scores.items():
        if name in exclude_names:
            continue
        if info['department'] in exclude_depts:
            continue
        eligible.append(info)

    # Calculate average ws for fairness threshold
    avg_ws = sum(s['cumulative_ws'] for s in eligible) / max(len(eligible), 1)
    overload_threshold = avg_ws * 1.5  # ห้ามเลือกคนที่ภาระเกิน 1.5 เท่าของค่าเฉลี่ย

    # Sort: prefer_depts first (if any), then by cumulative_ws + fatigue ascending
    def sort_key_regular(x):
        dept_priority = 0 if x['department'] in prefer_depts else 1 if prefer_depts else 0
        fatigue_penalty = x['fatigue_index'] * 0.5
        return (dept_priority, x['cumulative_ws'] + fatigue_penalty, x['cumulative_count'], rng.random())

    # Assign roles — track assigned names to prevent role conflict
    assigned = []
    assigned_names = set()

    role_order = ['ประธาน', 'รองประธาน', 'เลขานุการ', 'ผู้ช่วยเลขานุการ', 'กรรมการ']

    for role in role_order:
        count = roles.get(role, 0)
        if count <= 0:
            continue

        role_weight = ROLE_WEIGHTS.get(role, 1.0)
        assignment_score = round(task_weight * role_weight * duration_factor, 2)

        # Filter out already-assigned names (role conflict prevention)
        candidates = [s for s in eligible if s['name'] not in assigned_names]

        if role in ('ประธาน', 'รองประธาน'):
            # Leadership: prefer admin_role holders BUT only if not overloaded
            # Step 1: admin_role holders under threshold → sorted by least loaded
            admin_under = [c for c in candidates if c['admin_role'] and c['cumulative_ws'] <= overload_threshold]
            admin_under.sort(key=lambda x: (x['cumulative_ws'] + x['fatigue_index'] * 0.5, rng.random()))

            # Step 2: non-admin under threshold (give them a chance before overloaded admins)
            non_admin_under = [c for c in candidates if not c['admin_role'] and c['cumulative_ws'] <= overload_threshold]
            non_admin_under.sort(key=lambda x: (x['cumulative_ws'] + x['fatigue_index'] * 0.5, rng.random()))

            # Step 3: admin over threshold (ยังมีประสบการณ์ แต่ภาระเกิน)
            admin_over = [c for c in candidates if c['admin_role'] and c['cumulative_ws'] > overload_threshold]
            admin_over.sort(key=lambda x: (x['cumulative_ws'] + x['fatigue_index'] * 0.5, rng.random()))

            # Step 4: non-admin over threshold (last resort)
            non_admin_over = [c for c in candidates if not c['admin_role'] and c['cumulative_ws'] > overload_threshold]
            non_admin_over.sort(key=lambda x: (x['cumulative_ws'] + x['fatigue_index'] * 0.5, rng.random()))

            # Combined: admin under → non-admin under → admin over → non-admin over
            # ถ้า admin ไม่เกิน threshold → ได้เลย
            # ถ้า admin เกินหมด → เปิดให้ non-admin ที่ภาระน้อย
            candidates = admin_under + non_admin_under + admin_over + non_admin_over
        else:
            # Regular roles: pick least loaded with fatigue penalty
            candidates.sort(key=sort_key_regular)

        for i in range(min(count, len(candidates))):
            c = candidates[i]
            assigned.append({
                'name': c['name'],
                'department': c['department'],
                'position': c['position'],
                'admin_role': c['admin_role'],
                'role': role,
                'role_weight': role_weight,
                'task_weight': task_weight,
                'duration_factor': duration_factor,
                'assignment_score': assignment_score,
                'cumulative_ws_before': round(c['cumulative_ws'], 2),
                'cumulative_ws_after': round(c['cumulative_ws'] + assignment_score, 2),
                'fatigue_index': round(c['fatigue_index'], 1),
            })
            assigned_names.add(c['name'])
            scores[c['name']]['cumulative_ws'] += assignment_score
            scores[c['name']]['cumulative_count'] += 1

    # Department distribution
    dept_dist = defaultdict(int)
    for a in assigned:
        dept_dist[a['department']] += 1

    has_history = bool(historical_summary and any(p.get('total_weighted_score', 0) > 0 for p in historical_summary))

    return {
        'task_name': task_name,
        'task_type': task_type,
        'date': date,
        'start_time': start_time,
        'end_time': end_time,
        'duration_hours': duration_hours,
        'assignments': assigned,
        'summary': {
            'total_assigned': len(assigned),
            'total_requested': total_requested,
            'dept_distribution': dict(dept_dist),
            'roles_filled': {role: len([a for a in assigned if a['role'] == role]) for role in roles},
            'has_historical_data': has_history,
            'cross_group_note': 'คะแนนสะสมรวมทุกประเภทคำสั่ง (คุมสอบ, รับมอบตัว, จราจร ฯลฯ)' if has_history else 'ยังไม่มีข้อมูลย้อนหลัง — กรุณาอัปโหลดและวิเคราะห์ PDF ก่อน เพื่อให้จัดตารางโดยพิจารณาภาระจากทุกกลุ่มงาน',
        },
    }
