// -*- coding: utf-8 -*-
// Workload fairness analyzer — port of parser/workload_analyzer.py

// ============================================================
// 1. WEIGHTS
// ============================================================

export const TASK_WEIGHTS = {
  'กำกับห้องสอบ': 3.0,
  'คุมสอบ': 3.0,
  'กรรมการคุมสอบ': 3.0,
  'ตรวจข้อสอบ': 2.5,
  'ออกข้อสอบ': 2.0,
  'ดำเนินการสอบ': 2.5,
  'รับมอบตัว': 2.0,
  'ลงทะเบียน': 1.5,
  'รับรายงานตัว': 1.5,
  'รับสมัคร': 1.5,
  'ประชาสัมพันธ์': 1.0,
  'ประชุม': 1.0,
  'พิธีการ': 1.0,
  'อำนวยการ': 1.5,
  'ประสานงาน': 1.0,
  'สถานที่': 1.5,
  'อาคาร': 1.5,
  'โสตทัศนศึกษา': 1.5,
  'พยาบาล': 2.0,
  'จราจร': 1.5,
  'รักษาความปลอดภัย': 2.0,
  'การเงิน': 1.5,
  'พัสดุ': 1.5,
  'ประเมินผล': 2.0,
  'เลขานุการ': 2.0,
  'ทั่วไป': 1.0,
};

export const ROLE_WEIGHTS = {
  'ประธาน': 1.5,
  'รองประธาน': 1.3,
  'เลขานุการ': 1.4,
  'ผู้ช่วยเลขานุการ': 1.2,
  'กรรมการและเลขานุการ': 1.4,
  'กรรมการ': 1.0,
};

const DEPARTMENT_GROUPS = {
  'วิชาการ': ['สอบ', 'ข้อสอบ', 'วิชาการ', 'ตรวจ', 'ประเมินผล', 'หลักสูตร', 'วัดผล'],
  'กิจการนักเรียน': ['นักเรียน', 'รับสมัคร', 'มอบตัว', 'รายงานตัว', 'ลงทะเบียน', 'ปฐมนิเทศ'],
  'บริหารทั่วไป': ['สถานที่', 'อาคาร', 'จราจร', 'ความปลอดภัย', 'โสต', 'ประชาสัมพันธ์', 'พิธี'],
  'งบประมาณ': ['การเงิน', 'พัสดุ', 'งบ'],
  'บุคคล': ['บุคคล', 'อัตรากำลัง'],
};

const THAI_MONTHS = {
  'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4,
  'พฤษภาคม': 5, 'มิถุนายน': 6, 'กรกฎาคม': 7, 'สิงหาคม': 8,
  'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12,
};

// ============================================================
// 2. TASK CLASSIFICATION
// ============================================================

export function classifyTaskType(orderSubject, dutySection, durationHours = 0) {
  const combined = `${orderSubject || ''} ${dutySection || ''}`;

  let taskType = 'ทั่วไป';
  let taskWeight = TASK_WEIGHTS['ทั่วไป'];
  const sortedTasks = Object.entries(TASK_WEIGHTS).sort((a, b) => b[1] - a[1]);
  for (const [kw, w] of sortedTasks) {
    if (combined.includes(kw)) { taskType = kw; taskWeight = w; break; }
  }

  let roleType = 'กรรมการ';
  let roleWeight = ROLE_WEIGHTS['กรรมการ'];
  const sortedRoles = Object.entries(ROLE_WEIGHTS).sort((a, b) => b[1] - a[1]);
  for (const [kw, w] of sortedRoles) {
    if (combined.includes(kw)) { roleType = kw; roleWeight = w; break; }
  }

  let workGroup = 'อื่นๆ';
  for (const [group, keywords] of Object.entries(DEPARTMENT_GROUPS)) {
    if (keywords.some(kw => combined.includes(kw))) { workGroup = group; break; }
  }

  const durationFactor = durationHours > 0 ? Math.round(durationHours / 3.0 * 100) / 100 : 1.0;

  return {
    task_type: taskType,
    task_weight: taskWeight,
    role_type: roleType,
    role_weight: roleWeight,
    work_group: workGroup,
    duration_hours: durationHours,
    duration_factor: durationFactor,
    weighted_score: Math.round(taskWeight * roleWeight * durationFactor * 100) / 100,
  };
}

// ============================================================
// 3. DATE PARSING & TIMELINE
// ============================================================

function parseThaiDate(dateStr) {
  if (!dateStr) return null;
  const clean = dateStr.replace(/วัน\S+ที่\s*/, '').trim();
  const m = clean.match(/(\d+)\s+(\S+)\s+(\d{4})/);
  if (!m) return null;
  const day = parseInt(m[1]);
  const month = THAI_MONTHS[m[2]];
  if (!month) return null;
  const yearCe = parseInt(m[3]) - 543;
  try { return new Date(yearCe, month - 1, day); } catch { return null; }
}

function analyzeTimeline(assignmentsList) {
  const dates = [];
  for (const a of assignmentsList) {
    const d = parseThaiDate(a.duty_date) || parseThaiDate(a.order_date);
    if (d && !isNaN(d)) dates.push(d);
  }
  if (!dates.length) return { has_dates: false, date_count: 0, unique_dates: 0, cluster_count: 0, cluster_sizes: [], dates_sorted: [], span_days: 0, avg_gap_days: null, min_gap_days: null, max_gap_days: null };

  dates.sort((a, b) => a - b);
  const uniq = [...new Set(dates.map(d => d.toISOString().slice(0, 10)))].map(s => new Date(s));

  const gaps = [];
  for (let i = 1; i < uniq.length; i++) gaps.push((uniq[i] - uniq[i - 1]) / 86400000);

  const clusters = [];
  let cur = [uniq[0]];
  for (let i = 1; i < uniq.length; i++) {
    if ((uniq[i] - uniq[i - 1]) / 86400000 <= 3) cur.push(uniq[i]);
    else { clusters.push(cur); cur = [uniq[i]]; }
  }
  clusters.push(cur);

  return {
    has_dates: true,
    date_count: dates.length,
    unique_dates: uniq.length,
    first_date: uniq[0].toISOString().slice(0, 10),
    last_date: uniq[uniq.length - 1].toISOString().slice(0, 10),
    span_days: Math.round((uniq[uniq.length - 1] - uniq[0]) / 86400000),
    avg_gap_days: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length * 10) / 10 : 0,
    min_gap_days: gaps.length ? Math.min(...gaps) : 0,
    max_gap_days: gaps.length ? Math.max(...gaps) : 0,
    cluster_count: clusters.length,
    cluster_sizes: clusters.map(c => c.length),
    dates_sorted: uniq.map(d => d.toISOString().slice(0, 10)),
  };
}

// ============================================================
// 4. FATIGUE INDEX
// ============================================================

export function calculateFatigueIndex(person) {
  const ws = person.total_weighted_score || 0;
  const count = person.assignment_count || 0;
  const timeline = person.timeline || {};
  if (count === 0) return 0.0;

  const f1 = Math.min(ws / 15.0 * 30, 30);
  const f2 = Math.min(count / 8.0 * 25, 25);
  const maxCluster = Math.max(...(timeline.cluster_sizes || [0]));
  const f3 = Math.min(maxCluster / 4.0 * 25, 25);
  const minGap = timeline.min_gap_days;
  let f4 = 0;
  if (minGap !== null && minGap !== undefined) {
    if (minGap === 0) f4 = 20;
    else if (minGap <= 2) f4 = 15;
    else if (minGap <= 7) f4 = 10;
    else if (minGap <= 14) f4 = 5;
  }
  return Math.min(Math.round((f1 + f2 + f3 + f4) * 10) / 10, 100.0);
}

// ============================================================
// 5. FAIRNESS METRICS
// ============================================================

function stdDev(vals) {
  if (vals.length < 2) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) * 100) / 100;
}

function cv(vals) {
  if (!vals.length) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (mean === 0) return 0;
  return Math.round(stdDev(vals) / mean * 1000) / 10;
}

export function calculateGiniCoefficient(values) {
  if (!values || values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let giniSum = 0;
  for (let i = 0; i < n; i++) giniSum += (2 * (i + 1) - n - 1) * sorted[i];
  return Math.round(Math.abs(giniSum) / (n * total) * 10000) / 10000;
}

export function calculateFairnessMetrics(summaryList) {
  const counts = summaryList.map(s => s.assignment_count);
  const scores = summaryList.map(s => s.total_weighted_score || 0);
  const fatigues = summaryList.map(s => s.fatigue_index || 0);
  const assignedCounts = counts.filter(c => c > 0);

  const total = counts.reduce((a, b) => a + b, 0);
  const avgCount = Math.round(total / Math.max(summaryList.length, 1) * 100) / 100;

  const overworked = summaryList.filter(s => s.assignment_count > avgCount * 1.5);
  const underworked = summaryList.filter(s => s.assignment_count > 0 && s.assignment_count < avgCount * 0.5);
  const never = summaryList.filter(s => s.assignment_count === 0);

  const gini = calculateGiniCoefficient(counts);
  const fairnessScore = Math.round((1 - gini) * 1000) / 10;

  return {
    gini_coefficient: gini,
    fairness_score: fairnessScore,
    fairness_grade: (
      fairnessScore >= 85 ? 'A (เท่าเทียมดีมาก)' :
      fairnessScore >= 70 ? 'B (ค่อนข้างเท่าเทียม)' :
      fairnessScore >= 55 ? 'C (ไม่ค่อยเท่าเทียม)' :
      fairnessScore >= 40 ? 'D (ไม่เท่าเทียม)' : 'F (ไม่เท่าเทียมอย่างมาก)'
    ),
    count_stats: {
      total, mean: avgCount, std_dev: stdDev(counts), cv: cv(counts),
      min: Math.min(...counts), max: Math.max(...counts),
      median: [...counts].sort((a, b) => a - b)[Math.floor(counts.length / 2)],
    },
    weighted_stats: {
      total: Math.round(scores.reduce((a, b) => a + b, 0) * 100) / 100,
      mean: Math.round(scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1) * 100) / 100,
      std_dev: stdDev(scores), cv: cv(scores),
      gini: calculateGiniCoefficient(scores),
    },
    fatigue_stats: {
      mean: Math.round(fatigues.reduce((a, b) => a + b, 0) / Math.max(fatigues.length, 1) * 10) / 10,
      max: fatigues.length ? Math.max(...fatigues) : 0,
      std_dev: stdDev(fatigues),
    },
    distribution: {
      overworked_count: overworked.length,
      overworked_names: overworked.map(s => s.name),
      underworked_count: underworked.length,
      underworked_names: underworked.map(s => s.name),
      never_assigned_count: never.length,
      never_assigned_names: never.map(s => s.name),
      participation_rate: Math.round(assignedCounts.length / Math.max(summaryList.length, 1) * 1000) / 10,
    },
  };
}

// ============================================================
// 6. DEPT FAIRNESS
// ============================================================

export function calculateDeptFairness(summaryList) {
  const groups = {};
  for (const s of summaryList) {
    if (!groups[s.department]) groups[s.department] = [];
    groups[s.department].push(s);
  }
  const result = {};
  for (const [dept, members] of Object.entries(groups)) {
    const counts = members.map(m => m.assignment_count);
    const scores = members.map(m => m.total_weighted_score || 0);
    const fatigues = members.map(m => m.fatigue_index || 0);
    const assigned = counts.filter(c => c > 0).length;
    result[dept] = {
      total_staff: members.length,
      assigned_count: assigned,
      participation_rate: Math.round(assigned / Math.max(members.length, 1) * 1000) / 10,
      total_assignments: counts.reduce((a, b) => a + b, 0),
      total_weighted_score: Math.round(scores.reduce((a, b) => a + b, 0) * 100) / 100,
      avg_assignments: Math.round(counts.reduce((a, b) => a + b, 0) / Math.max(counts.length, 1) * 10) / 10,
      avg_weighted_score: Math.round(scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1) * 100) / 100,
      avg_fatigue: Math.round(fatigues.reduce((a, b) => a + b, 0) / Math.max(fatigues.length, 1) * 10) / 10,
      max_assignments: Math.max(...counts),
      min_assignments: Math.min(...counts),
      gini: calculateGiniCoefficient(counts),
      fairness_score: Math.round((1 - calculateGiniCoefficient(counts)) * 1000) / 10,
    };
  }
  return result;
}

// ============================================================
// 7. WORK GROUP TRACKING
// ============================================================

export function classifyWorkGroup(orderSubject, dutySection) {
  const combined = `${orderSubject || ''} ${dutySection || ''}`;
  for (const [group, keywords] of Object.entries(DEPARTMENT_GROUPS)) {
    if (keywords.some(kw => combined.includes(kw))) return group;
  }
  return 'อื่นๆ';
}

// ============================================================
// 8. MAIN ANALYZE FUNCTION
// ============================================================

export function analyzeWorkloadFairness(summaryList) {
  const workGroupDist = {};

  for (const person of summaryList) {
    const assignments = person.assignments || [];
    let totalWs = 0;
    const wg = {};
    const tt = {};

    for (const a of assignments) {
      const cls = classifyTaskType(a.order_subject || '', a.duty_section || '', a.duration_hours || 0);
      a.classification = cls;
      totalWs += cls.weighted_score;
      wg[cls.work_group] = (wg[cls.work_group] || 0) + 1;
      tt[cls.task_type] = (tt[cls.task_type] || 0) + 1;
      // global work group distribution
      workGroupDist[cls.work_group] = (workGroupDist[cls.work_group] || 0) + 1;
    }

    person.total_weighted_score = Math.round(totalWs * 100) / 100;
    person.work_groups = wg;
    person.task_types = tt;
    person.work_group_count = Object.keys(wg).length;
    person.timeline = analyzeTimeline(assignments);
    person.fatigue_index = calculateFatigueIndex(person);
  }

  return {
    summary: summaryList,
    fairness: calculateFairnessMetrics(summaryList),
    dept_fairness: calculateDeptFairness(summaryList),
    work_group_distribution: workGroupDist,
  };
}
