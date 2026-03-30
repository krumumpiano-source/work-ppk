// Parse extracted PDF text to find staff assignments
// Port of parser/data_parser.py

import { getStaffDict, getAllNames } from './staff-data.js';

function normalizeName(name) {
  name = name.replace(/[\u200b\u200c\u200d\ufeff]/g, '');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/\s+์/g, '์');
  name = name.replace(/\s+ิ/g, 'ิ');
  name = name.replace(/\s+ี/g, 'ี');
  name = name.replace(/\s+ื/g, 'ื');
  name = name.replace(/\s+่/g, '่');
  name = name.replace(/\s+้/g, '้');
  name = name.replace(/\s+๊/g, '๊');
  name = name.replace(/\s+็/g, '็');
  return name;
}

function buildNameLookup(staffDict) {
  const lookup = {};
  for (const name of Object.keys(staffDict)) {
    const norm = normalizeName(name);
    lookup[norm] = name;
    const parts = name.split(/\s+/);
    if (parts.length >= 2) lookup[parts[parts.length - 1]] = name;
  }
  return lookup;
}

function findMatchingStaff(extractedName, nameLookup, staffDict) {
  const norm = normalizeName(extractedName);

  if (staffDict[norm]) return norm;
  if (nameLookup[norm]) return nameLookup[norm];

  const noSpace = norm.replace(/\s/g, '');
  for (const staffName of Object.keys(staffDict)) {
    if (staffName.replace(/\s/g, '') === noSpace) return staffName;
  }

  const parts = norm.split(/\s+/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const first = parts[0];
    for (const staffName of Object.keys(staffDict)) {
      const sparts = staffName.split(/\s+/);
      if (sparts.length >= 2) {
        if (sparts[sparts.length - 1] === last &&
            (sparts[0].startsWith(first.substring(0, 3)) || first.startsWith(sparts[0].substring(0, 3)))) {
          return staffName;
        }
      }
    }
  }

  return null;
}

function extractOrderInfo(text) {
  let orderNumber = null, orderSubject = null, orderDate = null;

  let m = text.match(/(?:ท[ี่ ]+|คำสั่ง(?:ที่)?)\s*(\d+)\s*\/\s*(\d{4})/);
  if (m) orderNumber = `${m[1]}/${m[2]}`;

  m = text.match(/เรื่อง\s+(.+?)(?:\n|$)/);
  if (m) orderSubject = normalizeName(m[1].trim());

  m = text.match(/สั่ง\s*ณ\s*วันที่\s*(\d+)\s*เดือน\s*(\S+)\s*พ\.ศ\.\s*(\d+)/);
  if (m) {
    orderDate = `${m[1]} ${m[2]} ${m[3]}`;
  } else {
    m = text.match(/วัน\S+ที่\s+(\d+)\s+(?:เดือน\s+)?(\S+)\s+(?:พ\.ศ\.\s*)?(\d{4})/);
    if (m) orderDate = `${m[1]} ${m[2]} ${m[3]}`;
  }

  return { order_number: orderNumber, order_subject: orderSubject, order_date: orderDate };
}

function extractDateContexts(text) {
  const dates = [];
  const re = /วัน(\S+?)ที่\s*(\d+)\s+(?:เดือน\s*)?(\S+?)\s+(?:พ\.ศ\.\s*)?(\d{4})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    dates.push({
      day_name: m[1], day: m[2], month: m[3], year: m[4],
      full: `วัน${m[1]}ที่ ${m[2]} ${m[3]} ${m[4]}`,
      pos: m.index,
    });
  }
  return dates;
}

function extractTimeContexts(text) {
  const contexts = [];
  const re = /(ภาคเช้า|ภาคบ่าย)?\s*เวลา\s*(\d{1,2})[.:](\d{2})\s*น\.?\s*[-–]\s*(\d{1,2})[.:](\d{2})\s*น\.?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const period = m[1] || '';
    const h1 = parseInt(m[2]), m1 = parseInt(m[3]);
    const h2 = parseInt(m[4]), m2 = parseInt(m[5]);
    const startMin = h1 * 60 + m1;
    const endMin = h2 * 60 + m2;
    const duration = Math.max(endMin - startMin, 0) / 60.0;
    let timeStr = `${String(h1).padStart(2,'0')}:${String(m1).padStart(2,'0')}-${String(h2).padStart(2,'0')}:${String(m2).padStart(2,'0')}`;
    if (period) timeStr = `${period} ${timeStr}`;
    contexts.push({
      period, start_hour: h1, start_min: m1, end_hour: h2, end_min: m2,
      duration_hours: Math.round(duration * 100) / 100,
      time_str: timeStr, pos: m.index,
    });
  }
  return contexts;
}

export function parseAssignments(text, sourceFile = '', staffDictOverride = null) {
  const staffDict = staffDictOverride || getStaffDict();
  const nameLookup = buildNameLookup(staffDict);
  const orderInfo = extractOrderInfo(text);
  const dateContexts = extractDateContexts(text);
  const timeContexts = extractTimeContexts(text);

  const assignments = [];
  const foundNames = new Set();

  // Pattern 1: Thai names with title prefixes
  const namePattern1 = /(?:นาย|นาง(?:สาว)?|น\.ส\.)\s*([\u0E00-\u0E7F\s]+?)(?=\s+(?:ผู้อำนวยการ|รองผู้อำนวยการ|หัวหน้า|ประธาน|รองประธาน|กรรมการ|ครู|พนักงาน|ปฏิบัติ|มีหน้าที่|นาย|นาง|น\.ส\.|$|\d+\.|ห้อง|ม\.\s*\d|ระดับ|ตรวจ|รับ))/gm;
  // Pattern 2: Table-like format
  const namePattern2 = /(?:นาย|นาง(?:สาว)?|น\.ส\.)\s*([\u0E00-\u0E7F]+\s+[\u0E00-\u0E7F]+)/g;

  const allMatches = [];

  let m;
  while ((m = namePattern1.exec(text)) !== null) {
    const raw = m[1].trim();
    if (raw.length > 3) allMatches.push([m.index, raw]);
  }

  while ((m = namePattern2.exec(text)) !== null) {
    const raw = m[1].trim();
    if (raw.length > 3) {
      const pos = m.index;
      if (!allMatches.some(([p]) => Math.abs(pos - p) < 5)) {
        allMatches.push([pos, raw]);
      }
    }
  }

  allMatches.sort((a, b) => a[0] - b[0]);

  for (const [pos, rawName] of allMatches) {
    let name = normalizeName(rawName);
    name = name.replace(/\s*(?:ประธาน|รองประธาน|กรรมการ|เลขานุการ|ผู้ช่วย|หัวหน้า|ครู|ปฏิบัติ|ผู้อำนวยการ|รองผู้|พนักงาน|ช่วยราชการ).*$/, '').trim();

    if (name.length < 4) continue;

    const matched = findMatchingStaff(name, nameLookup, staffDict);
    if (!matched) continue;

    foundNames.add(matched);

    let dutyDate = '';
    for (const dc of dateContexts) {
      if (dc.pos <= pos) dutyDate = dc.full;
    }

    let dutyTime = '', durationHours = 0;
    for (const tc of timeContexts) {
      if (tc.pos <= pos) {
        dutyTime = tc.time_str;
        durationHours = tc.duration_hours;
      }
    }

    let section = '';
    const sectionRe = /(?:คณะกรรมการ\S+|ฝ่าย\S+|ชั้นมัธยมศึกษาปีที่\s*\d|ห้องสอบที่\s*\d+|ม\.\s*\d+\/\d+)/g;
    const textBefore = text.substring(Math.max(0, pos - 500), pos);
    let sm;
    while ((sm = sectionRe.exec(textBefore)) !== null) section = sm[0];

    const staffInfo = staffDict[matched];
    assignments.push({
      name: matched,
      department: staffInfo.department,
      position: staffInfo.position,
      admin_role: staffInfo.admin_role,
      order_number: orderInfo.order_number || '',
      order_subject: orderInfo.order_subject || '',
      order_date: orderInfo.order_date || '',
      duty_date: dutyDate,
      duty_time: dutyTime,
      duration_hours: durationHours,
      duty_section: section,
      source_file: sourceFile,
    });
  }

  return {
    order_info: orderInfo,
    assignments,
    unique_staff: [...foundNames],
    total_assignments: assignments.length,
    unique_count: foundNames.size,
  };
}
