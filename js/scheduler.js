// -*- coding: utf-8 -*-
// Fair Workload Scheduler — port of parser/scheduler.py

import { TASK_WEIGHTS, ROLE_WEIGHTS } from './workload-analyzer.js';
import { getStaffDict } from './staff-data.js';

// ============================================================
// 1. DETERMINISTIC SEED
// ============================================================

function makeSeed(config) {
  const raw = JSON.stringify(config, Object.keys(config).sort());
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// Simple seeded pseudo-random number generator (mulberry32)
function seededRng(seed) {
  let s = seed;
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ============================================================
// 2. STAFF PRIORITY SCORES
// ============================================================

export function getStaffPriorityScores(historicalSummary = null) {
  const staffDict = getStaffDict();
  const scores = {};

  for (const [name, info] of Object.entries(staffDict)) {
    scores[name] = {
      name,
      department: info.department,
      position: info.position,
      admin_role: info.admin_role,
      cumulative_ws: 0.0,
      cumulative_count: 0,
      fatigue_index: 0.0,
    };
  }

  if (historicalSummary) {
    for (const person of historicalSummary) {
      if (person.name in scores) {
        scores[person.name].cumulative_ws = person.total_weighted_score || 0;
        scores[person.name].cumulative_count = person.assignment_count || 0;
        scores[person.name].fatigue_index = person.fatigue_index || 0;
      }
    }
  }

  return scores;
}

// ============================================================
// 3. PROCTOR SCHEDULE
// ============================================================

export function scheduleProctoring(config, historicalSummary = null) {
  const rng = seededRng(makeSeed(config));
  const scores = getStaffPriorityScores(historicalSummary);
  const examName = config.exam_name || 'ไม่ระบุชื่อ';
  const sessions = config.sessions || [];

  const schedule = [];
  const sessionAssignments = {};

  for (const session of sessions) {
    const date = session.date || '';
    const period = session.period || '';
    const startTime = session.start_time || '08:00';
    const endTime = session.end_time || '12:00';
    const excludeDepts = (session.exclude_depts || []).map(d => d.trim()).filter(Boolean);
    const excludeNames = new Set(session.exclude_names || []);
    const proctorsPerRoom = session.proctors_per_room || 2;

    let durationHours = 3.0;
    try {
      const [h1, m1] = startTime.split(':').map(Number);
      const [h2, m2] = endTime.split(':').map(Number);
      durationHours = Math.max((h2 * 60 + m2 - h1 * 60 - m1), 0) / 60.0;
    } catch {}

    const durationFactor = durationHours > 0 ? Math.round(durationHours / 3.0 * 100) / 100 : 1.0;
    const sessionWeight = Math.round(3.0 * 1.0 * durationFactor * 100) / 100;

    let rooms = session.rooms || [];
    if (typeof rooms === 'number') {
      rooms = Array.from({ length: rooms }, (_, i) => `ห้อง ${i + 1}`);
    } else if (typeof rooms === 'string') {
      rooms = rooms.split(',').map(r => r.trim()).filter(Boolean);
    }

    const sessionKey = `${date}_${period}`;
    if (!sessionAssignments[sessionKey]) sessionAssignments[sessionKey] = new Set();

    let eligible = Object.values(scores).filter(info =>
      !excludeNames.has(info.name) &&
      !excludeDepts.includes(info.department) &&
      !sessionAssignments[sessionKey].has(info.name)
    );

    eligible.sort((a, b) =>
      (a.cumulative_ws + a.fatigue_index * 0.5) - (b.cumulative_ws + b.fatigue_index * 0.5) ||
      a.cumulative_count - b.cumulative_count ||
      rng() - rng()
    );

    const sessionData = { date, period, start_time: startTime, end_time: endTime, duration_hours: durationHours, session_weight: sessionWeight, rooms: [] };
    let eligIdx = 0;

    for (const room of rooms) {
      const roomProctors = [];
      while (roomProctors.length < proctorsPerRoom && eligIdx < eligible.length) {
        const c = eligible[eligIdx++];
        if (!sessionAssignments[sessionKey].has(c.name)) {
          roomProctors.push({
            name: c.name, department: c.department, position: c.position, admin_role: c.admin_role,
            cumulative_ws_before: Math.round(c.cumulative_ws * 100) / 100,
            cumulative_ws_after: Math.round((c.cumulative_ws + sessionWeight) * 100) / 100,
            cumulative_count: c.cumulative_count,
            fatigue_index: Math.round(c.fatigue_index * 10) / 10,
          });
          sessionAssignments[sessionKey].add(c.name);
          scores[c.name].cumulative_ws += sessionWeight;
          scores[c.name].cumulative_count += 1;
        }
      }
      sessionData.rooms.push({ room_name: room, proctors: roomProctors, proctors_needed: proctorsPerRoom, proctors_assigned: roomProctors.length });
    }

    schedule.push(sessionData);
  }

  // Summary
  const allAssigned = new Set();
  let totalSlots = 0, totalFilled = 0;
  const deptDist = {};

  for (const s of schedule) {
    for (const r of s.rooms) {
      totalSlots += r.proctors_needed;
      totalFilled += r.proctors_assigned;
      for (const p of r.proctors) {
        allAssigned.add(p.name);
        deptDist[p.department] = (deptDist[p.department] || 0) + 1;
      }
    }
  }

  const assignedScores = [...allAssigned].map(n => scores[n].cumulative_ws);
  const hasHistory = !!(historicalSummary && historicalSummary.some(p => (p.total_weighted_score || 0) > 0));

  return {
    exam_name: examName,
    schedule,
    summary: {
      total_sessions: schedule.length,
      total_rooms: schedule.reduce((s, x) => s + x.rooms.length, 0),
      total_slots: totalSlots,
      total_filled: totalFilled,
      total_staff_used: allAssigned.size,
      fill_rate: Math.round(totalFilled / Math.max(totalSlots, 1) * 1000) / 10,
      dept_distribution: deptDist,
      score_range_after: assignedScores.length ? Math.round((Math.max(...assignedScores) - Math.min(...assignedScores)) * 100) / 100 : 0,
      avg_score_after: assignedScores.length ? Math.round(assignedScores.reduce((a, b) => a + b, 0) / assignedScores.length * 100) / 100 : 0,
      has_historical_data: hasHistory,
      cross_group_note: hasHistory
        ? 'คะแนนสะสมรวมทุกประเภทคำสั่ง (คุมสอบ, รับมอบตัว, จราจร ฯลฯ)'
        : 'ยังไม่มีข้อมูลย้อนหลัง — กรุณาอัปโหลดและวิเคราะห์ PDF ก่อน',
    },
  };
}

// ============================================================
// 4. GENERAL ASSIGNMENT
// ============================================================

export function scheduleAssignment(config, historicalSummary = null) {
  const roles = config.roles || { 'กรรมการ': 10 };
  const totalRequested = Object.values(roles).reduce((s, v) => s + Math.max(0, v), 0);
  if (totalRequested <= 0) {
    return { error: 'กรุณาระบุจำนวนบุคลากรอย่างน้อย 1 ตำแหน่ง', task_name: config.task_name || '', assignments: [], summary: { total_assigned: 0, total_requested: 0 } };
  }

  const rng = seededRng(makeSeed(config));
  const scores = getStaffPriorityScores(historicalSummary);
  const taskName = config.task_name || 'ไม่ระบุ';
  const taskType = config.task_type || 'ทั่วไป';
  const date = config.date || '';
  const startTime = config.start_time || '08:00';
  const endTime = config.end_time || '16:00';
  const excludeDepts = new Set(config.exclude_depts || []);
  const excludeNames = new Set(config.exclude_names || []);
  const preferDepts = new Set(config.prefer_depts || []);

  let durationHours = 3.0;
  try {
    const [h1, m1] = startTime.split(':').map(Number);
    const [h2, m2] = endTime.split(':').map(Number);
    durationHours = Math.max((h2 * 60 + m2 - h1 * 60 - m1), 0) / 60.0;
  } catch {}

  const durationFactor = durationHours > 0 ? Math.round(durationHours / 3.0 * 100) / 100 : 1.0;
  const taskWeight = TASK_WEIGHTS[taskType] || TASK_WEIGHTS['ทั่วไป'];

  const eligible = Object.values(scores).filter(info =>
    !excludeNames.has(info.name) && !excludeDepts.has(info.department)
  );

  const avgWs = eligible.reduce((s, x) => s + x.cumulative_ws, 0) / Math.max(eligible.length, 1);
  const overloadThreshold = avgWs * 1.5;

  const assigned = [];
  const assignedNames = new Set();
  const roleOrder = ['ประธาน', 'รองประธาน', 'เลขานุการ', 'ผู้ช่วยเลขานุการ', 'กรรมการ'];

  for (const role of roleOrder) {
    const count = roles[role] || 0;
    if (count <= 0) continue;

    const roleWeight = ROLE_WEIGHTS[role] || 1.0;
    const assignmentScore = Math.round(taskWeight * roleWeight * durationFactor * 100) / 100;

    let candidates = eligible.filter(s => !assignedNames.has(s.name));

    if (role === 'ประธาน' || role === 'รองประธาน') {
      const sortFn = (a, b) => (a.cumulative_ws + a.fatigue_index * 0.5) - (b.cumulative_ws + b.fatigue_index * 0.5) || rng() - rng();
      const adminUnder = candidates.filter(c => c.admin_role && c.cumulative_ws <= overloadThreshold).sort(sortFn);
      const nonAdminUnder = candidates.filter(c => !c.admin_role && c.cumulative_ws <= overloadThreshold).sort(sortFn);
      const adminOver = candidates.filter(c => c.admin_role && c.cumulative_ws > overloadThreshold).sort(sortFn);
      const nonAdminOver = candidates.filter(c => !c.admin_role && c.cumulative_ws > overloadThreshold).sort(sortFn);
      candidates = [...adminUnder, ...nonAdminUnder, ...adminOver, ...nonAdminOver];
    } else {
      candidates.sort((a, b) => {
        const deptPri = (preferDepts.size ? (preferDepts.has(a.department) ? 0 : 1) : 0) - (preferDepts.size ? (preferDepts.has(b.department) ? 0 : 1) : 0);
        return deptPri || (a.cumulative_ws + a.fatigue_index * 0.5) - (b.cumulative_ws + b.fatigue_index * 0.5) || rng() - rng();
      });
    }

    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      const c = candidates[i];
      assigned.push({
        name: c.name, department: c.department, position: c.position, admin_role: c.admin_role,
        role, role_weight: roleWeight, task_weight: taskWeight,
        duration_factor: durationFactor, assignment_score: assignmentScore,
        cumulative_ws_before: Math.round(c.cumulative_ws * 100) / 100,
        cumulative_ws_after: Math.round((c.cumulative_ws + assignmentScore) * 100) / 100,
        fatigue_index: Math.round(c.fatigue_index * 10) / 10,
      });
      assignedNames.add(c.name);
      scores[c.name].cumulative_ws += assignmentScore;
      scores[c.name].cumulative_count += 1;
    }
  }

  const deptDist = {};
  for (const a of assigned) deptDist[a.department] = (deptDist[a.department] || 0) + 1;

  const hasHistory = !!(historicalSummary && historicalSummary.some(p => (p.total_weighted_score || 0) > 0));
  const rolesFilled = {};
  for (const role of Object.keys(roles)) rolesFilled[role] = assigned.filter(a => a.role === role).length;

  return {
    task_name: taskName, task_type: taskType, date, start_time: startTime, end_time: endTime,
    duration_hours: durationHours, assignments: assigned,
    summary: {
      total_assigned: assigned.length, total_requested: totalRequested,
      dept_distribution: deptDist, roles_filled: rolesFilled,
      has_historical_data: hasHistory,
      cross_group_note: hasHistory
        ? 'คะแนนสะสมรวมทุกประเภทคำสั่ง (คุมสอบ, รับมอบตัว, จราจร ฯลฯ)'
        : 'ยังไม่มีข้อมูลย้อนหลัง — กรุณาอัปโหลดและวิเคราะห์ PDF ก่อน',
    },
  };
}
