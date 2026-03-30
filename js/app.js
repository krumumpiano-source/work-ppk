// ===========================================
// Workload Fairness Analysis — Frontend (Client-Side ES Module)
// ===========================================
import { extractTextFromPdf } from './pdf-extractor.js';
import { parseAssignments } from './data-parser.js';
import { analyzeWorkloadFairness } from './workload-analyzer.js';
import { scheduleProctoring, scheduleAssignment } from './scheduler.js';
import { STAFF_LIST, getDepartments, getStaffDict } from './staff-data.js';

let allSummary = [];
let analysisData = null;
let uploadResults = [];
let lastAnalysisSummary = null;
let chartInstance = null;
let fatigueChartInstance = null;

// ===========================================
// STAFF DATA — localStorage with fallback to default
// ===========================================
const STAFF_STORAGE_KEY = 'ppk_staff_v1';
const ANALYSIS_STORAGE_KEY = 'ppk_analysis_v1';
const UPLOADS_STORAGE_KEY = 'ppk_uploads_v1';

function saveAnalysis() {
    if (!analysisData) return;
    try {
        localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify({ analysisData, savedAt: Date.now() }));
    } catch (e) { /* quota exceeded */ }
}

function loadSavedAnalysis() {
    try {
        const raw = localStorage.getItem(ANALYSIS_STORAGE_KEY);
        if (!raw) return false;
        const payload = JSON.parse(raw);
        if (!payload.analysisData) return false;
        analysisData = payload.analysisData;
        return true;
    } catch (e) { return false; }
}

function saveParsedUploads() {
    try {
        localStorage.setItem(UPLOADS_STORAGE_KEY, JSON.stringify(uploadResults));
    } catch (e) { /* quota exceeded */ }
}

function loadParsedUploads() {
    try {
        const raw = localStorage.getItem(UPLOADS_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) { return null; }
}

function buildAnalysisData(allResults) {
    const personAssignments = {};
    for (const r of allResults) {
        if (!r.success) continue;
        for (const a of r.assignments) {
            if (!personAssignments[a.name]) personAssignments[a.name] = [];
            personAssignments[a.name].push(a);
        }
    }
    const staffDict = getCurrentStaffDict();
    const summaryList = Object.entries(staffDict).map(([name, info]) => ({
        name,
        department: info.department,
        position: info.position,
        admin_role: info.admin_role,
        exclude_from_stats: !!info.exclude_from_stats,
        assignment_count: (personAssignments[name] || []).length,
        assignments: personAssignments[name] || [],
        unique_orders: [...new Set((personAssignments[name] || []).map(a => a.order_number).filter(Boolean))],
    }));
    const activeList = summaryList.filter(s => !s.exclude_from_stats);
    const analysisResult = analyzeWorkloadFairness(activeList);
    const assigned = activeList.filter(s => s.assignment_count > 0);
    const counts = activeList.map(s => s.assignment_count);
    const avgAssign = Math.round(counts.reduce((s, x) => s + x, 0) / Math.max(activeList.length, 1) * 10) / 10;
    const excludedSummary = summaryList.filter(s => s.exclude_from_stats).map(s => ({
        ...s, total_weighted_score: 0, fatigue_index: 0, work_groups: {}, work_group_count: 0, timeline: {},
    }));
    const fullSummary = [
        ...analysisResult.summary.sort((a, b) => (b.total_weighted_score || 0) - (a.total_weighted_score || 0)),
        ...excludedSummary,
    ];
    analysisData = {
        summary: fullSummary,
        total_staff: activeList.length,
        excluded_count: excludedSummary.length,
        total_assigned: assigned.length,
        total_never_assigned: activeList.length - assigned.length,
        never_assigned: activeList.filter(s => s.assignment_count === 0),
        dept_stats: analysisResult.dept_fairness,
        fairness: analysisResult.fairness,
        work_group_distribution: analysisResult.work_group_distribution,
        max_assignments: Math.max(...counts, 0),
        min_assignments: assigned.length ? Math.min(...assigned.map(s => s.assignment_count)) : 0,
        avg_assignments: avgAssign,
    };
    lastAnalysisSummary = analysisData.summary;
    allSummary = analysisData.summary;
    saveParsedUploads();
    saveAnalysis();
    renderSavedOrdersPanel();
}

function renderSavedOrdersPanel() {
    const panel = document.getElementById('savedOrdersPanel');
    if (!panel) return;
    const saved = loadParsedUploads();
    const successFiles = (saved || []).filter(r => r.success);
    if (!successFiles.length) { panel.innerHTML = ''; panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    panel.innerHTML = `<div class="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
        <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-semibold text-blue-700">📋 คำสั่งที่บันทึกไว้ (${successFiles.length} ไฟล์ — อัปโหลดเพิ่มเพื่อรวมข้อมูล)</span>
            <button onclick="clearAllSavedOrders()" class="text-xs text-red-500 hover:text-red-700 underline">🗑️ ล้างทั้งหมด</button>
        </div>
        <div class="flex flex-wrap gap-2">${successFiles.map(r => {
            const meta = (r.academic_year ? ` ${r.academic_year}` : '') + (r.term ? `/เทอม${r.term}` : '');
            const metaBadge = meta ? `<span class="bg-blue-200 text-blue-800 rounded-full px-1.5 py-0.5 text-xs ml-1">${meta.trim()}</span>` : '';
            const safeFilename = r.filename.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `<span class="inline-flex items-center gap-1 bg-white border border-blue-300 rounded-full px-3 py-1 text-xs text-blue-800">📄 ${r.filename}${metaBadge} <button onclick="removeSavedOrder('${safeFilename}')"
            class="text-red-400 hover:text-red-600 ml-1 font-bold">&times;</button></span>`;
        }).join('')}</div>
    </div>`;
}

window.removeSavedOrder = function(filename) {
    const saved = loadParsedUploads();
    if (!saved) return;
    const updated = saved.filter(r => r.filename !== filename);
    uploadResults = updated;
    if (!updated.some(r => r.success)) { window.clearAllSavedOrders(); return; }
    buildAnalysisData(updated);
    renderAllResults();
};

window.clearAllSavedOrders = function() {
    localStorage.removeItem(UPLOADS_STORAGE_KEY);
    localStorage.removeItem(ANALYSIS_STORAGE_KEY);
    uploadResults = [];
    analysisData = null;
    lastAnalysisSummary = null;
    allSummary = [];
    resultsSection.classList.add('hidden');
    btnExport.classList.add('hidden');
    const panel = document.getElementById('savedOrdersPanel');
    if (panel) { panel.innerHTML = ''; panel.classList.add('hidden'); }
    const notice = document.getElementById('restoreNotice');
    if (notice) notice.classList.add('hidden');
};

function loadStaffList() {
    try {
        const saved = localStorage.getItem(STAFF_STORAGE_KEY);
        if (saved) return JSON.parse(saved);
    } catch (e) {}
    return JSON.parse(JSON.stringify(STAFF_LIST)); // deep copy default
}

function saveStaffList(list) {
    localStorage.setItem(STAFF_STORAGE_KEY, JSON.stringify(list));
}

function getCurrentStaffDict() {
    const list = loadStaffList();
    const dict = {};
    for (const s of list) dict[s.name] = s;
    return dict;
}

function getCurrentDepartments() {
    return [...new Set(loadStaffList().map(s => s.department))].sort();
}

// ---- DOM refs ----
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const uploadActions = document.getElementById('uploadActions');
const btnUpload = document.getElementById('btnUpload');
const btnClear = document.getElementById('btnClear');
const uploadProgress = document.getElementById('uploadProgress');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const resultsSection = document.getElementById('resultsSection');
const personModal = document.getElementById('personModal');
const closeModal = document.getElementById('closeModal');
const btnExport = document.getElementById('btnExport');

// ---- File Upload ----
let selectedFiles = [];

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', e => handleFiles(e.target.files));

function handleFiles(files) {
    for (const f of files) if (f.type === 'application/pdf') selectedFiles.push(f);
    renderFileList();
}

function renderFileList() {
    if (!selectedFiles.length) { fileList.classList.add('hidden'); uploadActions.classList.add('hidden'); return; }
    fileList.classList.remove('hidden');
    uploadActions.classList.remove('hidden');
    fileList.innerHTML = selectedFiles.map((f, i) => `
        <div class="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2">
            <span class="text-sm">📄 ${f.name} <span class="text-gray-400">(${(f.size/1024).toFixed(0)} KB)</span></span>
            <button onclick="removeFile(${i})" class="text-red-400 hover:text-red-600 text-lg">&times;</button>
        </div>
    `).join('');
}

function removeFile(i) { selectedFiles.splice(i, 1); renderFileList(); }
window.removeFile = removeFile;

btnClear.addEventListener('click', () => { selectedFiles = []; fileInput.value = ''; renderFileList(); });

// ===========================================
// Upload & Analyze — CLIENT-SIDE (no server)
// ===========================================
btnUpload.addEventListener('click', async () => {
    if (!selectedFiles.length) return;
    btnUpload.disabled = true;
    btnUpload.textContent = '⏳ กำลังวิเคราะห์...';
    uploadProgress.classList.remove('hidden');
    progressBar.style.width = '5%';
    progressText.textContent = 'กำลังเริ่มต้น...';

    uploadResults = [];
    const _batchYear = document.getElementById('uploadYear')?.value.trim() || '';
    const _batchTerm = document.getElementById('uploadTerm')?.value || '';

    try {
        // --- Step 1: Extract + Parse each PDF ---
        for (let idx = 0; idx < selectedFiles.length; idx++) {
            const f = selectedFiles[idx];
            const pct = Math.round(5 + (idx / selectedFiles.length) * 55);
            progressBar.style.width = pct + '%';
            progressText.textContent = `กำลังอ่าน PDF (${idx + 1}/${selectedFiles.length}): ${f.name}`;

            try {
                const extracted = await extractTextFromPdf(f, (msg) => {
                    progressText.textContent = `[${f.name}] ${msg}`;
                });
                const parsed = parseAssignments(extracted.text, f.name, getCurrentStaffDict());

                uploadResults.push({
                    filename: f.name,
                    success: true,
                    academic_year: _batchYear,
                    term: _batchTerm,
                    assignments: parsed.assignments,
                    unique_count: parsed.unique_count,
                    total_assignments: parsed.total_assignments,
                    order_info: parsed.order_info,
                    unique_staff: parsed.unique_staff,
                    page_count: extracted.page_count,
                    method: extracted.method,
                });
            } catch (err) {
                uploadResults.push({
                    filename: f.name,
                    success: false,
                    academic_year: _batchYear,
                    term: _batchTerm,
                    error: err.message,
                    assignments: [],
                    unique_count: 0,
                    total_assignments: 0,
                    method: null,
                });
            }
        }

        // Show per-file status
        let statusHtml = '<div class="mt-3 space-y-1">';
        for (const r of uploadResults) {
            const method = r.method ? ` [${r.method}]` : '';
            if (r.success) statusHtml += `<div class="text-sm text-green-600">✅ ${r.filename}${method} — พบ ${r.unique_count} คน (${r.total_assignments} รายการ)</div>`;
            else statusHtml += `<div class="text-sm text-red-500">❌ ${r.filename}${method} — ${r.error}</div>`;
        }
        statusHtml += '</div>';
        fileList.innerHTML += statusHtml;

        // --- Step 2: Merge with saved uploads, then analyze ---
        progressBar.style.width = '70%';
        progressText.textContent = 'กำลังรวมข้อมูลกับคำสั่งที่บันทึกไว้...';

        const savedUploads = loadParsedUploads() || [];
        const newFilenames = new Set(uploadResults.map(r => r.filename));
        const merged = [...savedUploads.filter(r => !newFilenames.has(r.filename)), ...uploadResults];
        uploadResults = merged;

        progressBar.style.width = '85%';
        progressText.textContent = 'กำลังวิเคราะห์ความเที่ยงธรรม...';
        buildAnalysisData(merged);

        progressBar.style.width = '100%';
        const totalFiles = merged.filter(r => r.success).length;
        progressText.textContent = `เสร็จสิ้น! (รวม ${totalFiles} ไฟล์คำสั่ง)`;
        const notice = document.getElementById('restoreNotice');
        if (notice) notice.classList.add('hidden');
        renderAllResults();
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        btnUpload.disabled = false;
        btnUpload.textContent = '🔍 วิเคราะห์';
    }
});

// ---- Tabs ----
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        btn.classList.add('tab-active');
        document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
        if (btn.dataset.tab === 'chart') renderChart();
        if (btn.dataset.tab === 'fatigue') renderFatigueChart();
        if (btn.dataset.tab === 'top10') renderTop10Panel();
    });
});

// ---- Helper: is admin/head ----
function isAdmin(s) { return !!s.admin_role; }

function getFatigueColor(v) {
    if (v >= 60) return '#ef4444';
    if (v >= 40) return '#f59e0b';
    if (v >= 20) return '#3b82f6';
    return '#22c55e';
}
function getFatigueLabel(v) {
    if (v >= 60) return 'หนักมาก';
    if (v >= 40) return 'หนัก';
    if (v >= 20) return 'ปานกลาง';
    return 'ปกติ';
}

// ===========================================
// RENDER ALL RESULTS
// ===========================================
function renderAllResults() {
    if (!analysisData) return;
    resultsSection.classList.remove('hidden');
    btnExport.classList.remove('hidden');
    allSummary = analysisData.summary;

    // Fairness banner
    const f = analysisData.fairness || {};
    const cs = f.count_stats || {};
    const dist = f.distribution || {};

    const score = f.fairness_score || 0;
    const el = document.getElementById('fairnessScoreValue');
    el.textContent = score;
    el.className = 'text-5xl font-bold ' + (score >= 70 ? 'text-green-600' : score >= 55 ? 'text-yellow-600' : 'text-red-600');
    document.getElementById('fairnessGrade').textContent = f.fairness_grade || '';
    document.getElementById('giniValue').textContent = f.gini_coefficient ?? '—';
    document.getElementById('sdValue').textContent = cs.std_dev ?? '—';
    document.getElementById('participationRate').textContent = (dist.participation_rate ?? 0) + '%';
    document.getElementById('overworkedCount').textContent = (dist.overworked_count ?? 0) + ' คน';

    // Stats cards
    document.getElementById('statFiles').textContent = uploadResults.filter(r => r.success).length;
    document.getElementById('statAssigned').textContent = analysisData.total_assigned;
    document.getElementById('statNever').textContent = analysisData.total_never_assigned;
    // show excluded note
    const exNote = document.getElementById('excludedNote');
    if (exNote) { exNote.textContent = analysisData.excluded_count > 0 ? `(ยกเว้น ${analysisData.excluded_count} คนจากสถิติ)` : ''; }
    document.getElementById('statMax').textContent = analysisData.max_assignments;
    document.getElementById('statAvg').textContent = analysisData.avg_assignments;
    const maxFatigue = Math.max(...allSummary.map(s => s.fatigue_index || 0), 0);
    document.getElementById('statMaxFatigue').textContent = maxFatigue.toFixed(1);

    // Dept filter options
    const depts = [...new Set(allSummary.map(s => s.department))].sort();
    const deptOpts = '<option value="">ทุกกลุ่มสาระ</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
    ['filterDept', 'chartDept', 'fatigueDept'].forEach(id => document.getElementById(id).innerHTML = deptOpts);

    // Year filter options
    const _uploads = loadParsedUploads() || [];
    const _years = [...new Set(_uploads.filter(r => r.success && r.academic_year).map(r => r.academic_year))].sort();
    const _yearEl = document.getElementById('filterYear');
    if (_yearEl) _yearEl.innerHTML = '<option value="">ทุกปีการศึกษา</option>' + _years.map(y => `<option value="${y}">${y}</option>`).join('');

    renderTable();
    renderNeverAssigned();
    renderDeptStats();
    renderFairnessDetail();
    renderWorkgroupStats();
    renderTop10Panel();
}

// ===========================================
// TABLE
// ===========================================
function renderTable() {
    let data = [...allSummary];
    const search = document.getElementById('searchName').value.trim().toLowerCase();
    const dept = document.getElementById('filterDept').value;
    const status = document.getElementById('filterStatus').value;
    const sortKey = document.getElementById('sortBy').value;

    if (search) data = data.filter(s => s.name.includes(search));
    if (dept) data = data.filter(s => s.department === dept);
    if (status === 'assigned') data = data.filter(s => s.assignment_count > 0);
    else if (status === 'never') data = data.filter(s => s.assignment_count === 0);
    else if (status === 'overworked') data = data.filter(s => s.assignment_count > analysisData.avg_assignments * 1.5);
    else if (status === 'admin') data = data.filter(s => isAdmin(s));
    else if (status === 'teacher') data = data.filter(s => !isAdmin(s));

    const filterYearVal = document.getElementById('filterYear')?.value || '';
    if (filterYearVal) {
        const _yearFiles = new Set((loadParsedUploads() || []).filter(r => r.success && r.academic_year === filterYearVal).map(r => r.filename));
        data = data.filter(s => (s.assignments || []).some(a => _yearFiles.has(a.source_file)));
    }

    if (sortKey === 'weighted_score') data.sort((a, b) => (b.total_weighted_score || 0) - (a.total_weighted_score || 0));
    else if (sortKey === 'count') data.sort((a, b) => b.assignment_count - a.assignment_count);
    else if (sortKey === 'fatigue') data.sort((a, b) => (b.fatigue_index || 0) - (a.fatigue_index || 0));
    else if (sortKey === 'name') data.sort((a, b) => a.name.localeCompare(b.name, 'th'));

    const avg = analysisData.avg_assignments || 1;
    const maxWs = Math.max(...allSummary.map(s => s.total_weighted_score || 0), 1);

    const tbody = document.getElementById('summaryTable');
    tbody.innerHTML = data.map((s, i) => {
        const badges = [];
        if (s.exclude_from_stats) badges.push('<span class="inline-block text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">ยกเว้นจากสถิติ</span>');
        else if (isAdmin(s)) badges.push(`<span class="inline-block text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">${s.admin_role}</span>`);
        if (!s.exclude_from_stats && s.assignment_count > avg * 1.5) badges.push('<span class="inline-block text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">ภาระมากเกิน</span>');
        if (!s.exclude_from_stats && s.assignment_count === 0) badges.push('<span class="inline-block text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">ไม่เคยได้รับ</span>');

        const ws = s.total_weighted_score || 0;
        const wsBar = maxWs > 0 ? (ws / maxWs * 100) : 0;
        const fatigue = s.fatigue_index || 0;
        const wgList = s.work_groups ? Object.keys(s.work_groups).join(', ') : '-';

        return `<tr class="border-b ${s.exclude_from_stats ? 'bg-slate-50 opacity-60' : 'hover:bg-blue-50'} cursor-pointer" onclick="showPerson('${s.name.replace(/'/g, "\\'")}')">
            <td class="px-2 py-2 text-gray-400">${i+1}</td>
            <td class="px-2 py-2"><div class="font-medium">${s.name}</div><div class="flex flex-wrap gap-1 mt-0.5">${badges.join('')}</div></td>
            <td class="px-2 py-2 text-gray-600 text-xs">${s.department}</td>
            <td class="px-2 py-2 text-center font-bold">${s.assignment_count}</td>
            <td class="px-2 py-2 text-center">
                <div class="flex items-center gap-1 justify-center">
                    <span class="font-bold">${ws.toFixed(1)}</span>
                    <div class="w-16 bg-gray-100 rounded-full h-2"><div class="h-2 rounded-full" style="width:${wsBar}%;background:${getFatigueColor(fatigue)}"></div></div>
                </div>
            </td>
            <td class="px-2 py-2 text-center"><span class="font-bold" style="color:${getFatigueColor(fatigue)}">${fatigue.toFixed(1)}</span><div class="text-xs text-gray-400">${getFatigueLabel(fatigue)}</div></td>
            <td class="px-2 py-2 text-xs text-gray-500">${wgList}</td>
            <td class="px-2 py-2 no-print"><button class="text-blue-500 hover:text-blue-700 text-xs">ดูเพิ่ม →</button></td>
        </tr>`;
    }).join('');

    document.getElementById('tableInfo').textContent = `แสดง ${data.length} จาก ${allSummary.length} คน`;
}

document.getElementById('searchName').addEventListener('input', renderTable);
document.getElementById('filterDept').addEventListener('change', renderTable);
document.getElementById('filterStatus').addEventListener('change', renderTable);
document.getElementById('sortBy').addEventListener('change', renderTable);
document.getElementById('filterYear').addEventListener('change', renderTable);
document.getElementById('sortBy').addEventListener('change', renderTable);

// ===========================================
// CHART
// ===========================================
function renderChart() {
    let data = [...allSummary].filter(s => s.assignment_count > 0);
    const dept = document.getElementById('chartDept').value;
    const metric = document.getElementById('chartMetric').value;
    const role = document.getElementById('chartRole').value;

    if (dept) data = data.filter(s => s.department === dept);
    if (role === 'teacher') data = data.filter(s => !isAdmin(s));
    else if (role === 'admin') data = data.filter(s => isAdmin(s));

    data.sort((a, b) => {
        const va = metric === 'count' ? a.assignment_count : metric === 'fatigue' ? (a.fatigue_index||0) : (a.total_weighted_score||0);
        const vb = metric === 'count' ? b.assignment_count : metric === 'fatigue' ? (b.fatigue_index||0) : (b.total_weighted_score||0);
        return vb - va;
    });

    if (data.length > 60) data = data.slice(0, 60);
    const avg = analysisData.avg_assignments;
    const labels = { count: 'จำนวนครั้ง', fatigue: 'ดัชนีเหนื่อยล้า', weighted_score: 'คะแนนถ่วงน้ำหนัก' };

    const colors = data.map(s => {
        if (metric === 'fatigue') return getFatigueColor(s.fatigue_index || 0);
        return s.assignment_count > avg * 1.5 ? '#ef4444' : s.assignment_count > avg ? '#f59e0b' : '#22c55e';
    });

    if (chartInstance) chartInstance.destroy();
    const container = document.getElementById('chartContainer');
    container.style.height = Math.max(400, data.length * 22) + 'px';

    chartInstance = new Chart(document.getElementById('assignmentChart'), {
        type: 'bar',
        data: { labels: data.map(s => s.name + (isAdmin(s) ? ' ★' : '')), datasets: [{ label: labels[metric], data: data.map(s => metric === 'count' ? s.assignment_count : metric === 'fatigue' ? (s.fatigue_index||0) : (s.total_weighted_score||0)), backgroundColor: colors, borderRadius: 3 }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: ctx => { const s = data[ctx.dataIndex]; return `กลุ่มสาระ: ${s.department}${s.admin_role ? '\n★ '+s.admin_role : ''}\nดัชนีล้า: ${(s.fatigue_index||0).toFixed(1)}`; }}}},
            scales: { x: { beginAtZero: true, title: { display: true, text: labels[metric] }}, y: { ticks: { font: { size: 11 }}}},
            onClick: (e, el) => { if (el.length) showPerson(data[el[0].index].name); }
        }
    });
}
document.getElementById('chartDept').addEventListener('change', renderChart);
document.getElementById('chartMetric').addEventListener('change', renderChart);
document.getElementById('chartRole').addEventListener('change', renderChart);

// ===========================================
// FATIGUE CHART
// ===========================================
function renderFatigueChart() {
    let data = [...allSummary].filter(s => (s.fatigue_index || 0) > 0);
    const dept = document.getElementById('fatigueDept').value;
    const role = document.getElementById('fatigueRole').value;

    if (dept) data = data.filter(s => s.department === dept);
    if (role === 'teacher') data = data.filter(s => !isAdmin(s));
    else if (role === 'admin') data = data.filter(s => isAdmin(s));

    data.sort((a, b) => (b.fatigue_index || 0) - (a.fatigue_index || 0));
    if (data.length > 50) data = data.slice(0, 50);

    if (fatigueChartInstance) fatigueChartInstance.destroy();
    const container = document.getElementById('fatigueChartContainer');
    container.style.height = Math.max(400, data.length * 26) + 'px';

    fatigueChartInstance = new Chart(document.getElementById('fatigueChart'), {
        type: 'bar',
        data: {
            labels: data.map(s => s.name + (isAdmin(s) ? ' ★' : '')),
            datasets: [{ label: 'ดัชนีเหนื่อยล้า', data: data.map(s => s.fatigue_index || 0), backgroundColor: data.map(s => getFatigueColor(s.fatigue_index || 0)), borderRadius: 3 }]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: ctx => {
                const s = data[ctx.dataIndex];
                const tl = s.timeline || {};
                return `กลุ่มสาระ: ${s.department}\nจำนวนครั้ง: ${s.assignment_count}\nคะแนนถ่วง: ${(s.total_weighted_score||0).toFixed(1)}\nวันที่ห่างน้อยสุด: ${tl.min_gap_days ?? '-'} วัน`;
            }}}},
            scales: { x: { beginAtZero: true, max: 100, title: { display: true, text: 'ดัชนีเหนื่อยล้า (0-100)' }}, y: { ticks: { font: { size: 11 }}}},
            onClick: (e, el) => { if (el.length) showPerson(data[el[0].index].name); }
        }
    });
}
document.getElementById('fatigueDept').addEventListener('change', renderFatigueChart);
document.getElementById('fatigueRole').addEventListener('change', renderFatigueChart);

// ===========================================
// FAIRNESS DETAIL
// ===========================================
function renderFairnessDetail() {
    const f = analysisData.fairness || {};
    const cs = f.count_stats || {};
    const ws = f.weighted_stats || {};
    const fs = f.fatigue_stats || {};
    const dist = f.distribution || {};

    const teachers = allSummary.filter(s => !isAdmin(s));
    const admins = allSummary.filter(s => isAdmin(s));

    function calcGroupStats(group) {
        const counts = group.map(s => s.assignment_count);
        const fat = group.map(s => s.fatigue_index || 0);
        const total = counts.reduce((a, b) => a + b, 0);
        const mean = counts.length ? total / counts.length : 0;
        const assigned = counts.filter(c => c > 0).length;
        return { total: group.length, assigned, totalAssignments: total, mean: mean.toFixed(1), maxCount: Math.max(...counts, 0), maxFatigue: Math.max(...fat, 0).toFixed(1), avgFatigue: (fat.reduce((a,b)=>a+b,0)/Math.max(fat.length,1)).toFixed(1) };
    }

    const tStats = calcGroupStats(teachers);
    const aStats = calcGroupStats(admins);

    let html = `
        <h3 class="text-lg font-bold mb-4">⚖️ วิเคราะห์ความเที่ยงธรรมเชิงลึก</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div class="bg-blue-50 rounded-lg p-4">
                <h4 class="font-semibold text-blue-800 mb-2">👨‍🏫 ครูปฏิบัติการ (${tStats.total} คน)</h4>
                <div class="grid grid-cols-2 gap-2 text-sm">
                    <div>ได้รับมอบหมาย: <b>${tStats.assigned}</b> คน</div>
                    <div>ไม่เคยได้: <b>${tStats.total - tStats.assigned}</b> คน</div>
                    <div>รวมทั้งหมด: <b>${tStats.totalAssignments}</b> ครั้ง</div>
                    <div>เฉลี่ย/คน: <b>${tStats.mean}</b> ครั้ง</div>
                    <div>มากสุด: <b>${tStats.maxCount}</b> ครั้ง</div>
                    <div>ดัชนีล้าสูงสุด: <b>${tStats.maxFatigue}</b></div>
                </div>
            </div>
            <div class="bg-amber-50 rounded-lg p-4">
                <h4 class="font-semibold text-amber-800 mb-2">👔 หัวหน้างาน/ผู้บริหาร (${aStats.total} คน)</h4>
                <div class="grid grid-cols-2 gap-2 text-sm">
                    <div>ได้รับมอบหมาย: <b>${aStats.assigned}</b> คน</div>
                    <div>ไม่เคยได้: <b>${aStats.total - aStats.assigned}</b> คน</div>
                    <div>รวมทั้งหมด: <b>${aStats.totalAssignments}</b> ครั้ง</div>
                    <div>เฉลี่ย/คน: <b>${aStats.mean}</b> ครั้ง</div>
                    <div>มากสุด: <b>${aStats.maxCount}</b> ครั้ง</div>
                    <div>ดัชนีล้าสูงสุด: <b>${aStats.maxFatigue}</b></div>
                </div>
            </div>
        </div>

        <div class="mb-6">
            <h4 class="font-semibold text-red-700 mb-2">🚨 บุคลากรที่รับภาระมากเกินค่าเฉลี่ย 1.5 เท่า (${dist.overworked_count || 0} คน)</h4>`;

    if (dist.overworked_names && dist.overworked_names.length) {
        html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-2">';
        const overworked = allSummary.filter(s => dist.overworked_names.includes(s.name)).sort((a,b) => (b.total_weighted_score||0) - (a.total_weighted_score||0));
        for (const s of overworked) {
            const roleTag = isAdmin(s) ? '<span class="text-xs bg-amber-100 text-amber-800 px-1 rounded">หัวหน้า</span>' : '<span class="text-xs bg-blue-100 text-blue-800 px-1 rounded">ครู</span>';
            html += `<div class="bg-red-50 rounded-lg px-3 py-2 text-sm flex justify-between items-center cursor-pointer hover:bg-red-100" onclick="showPerson('${s.name.replace(/'/g,"\\'")}')">
                <div><b>${s.name}</b> ${roleTag} <span class="text-gray-400">${s.department}</span></div>
                <div class="text-right"><span class="font-bold text-red-700">${s.assignment_count} ครั้ง</span> <span class="text-gray-400">/ WS ${(s.total_weighted_score||0).toFixed(1)}</span></div>
            </div>`;
        }
        html += '</div>';
    } else {
        html += '<p class="text-green-600">✅ ไม่พบบุคลากรที่รับภาระมากเกินค่าเฉลี่ย 1.5 เท่า</p>';
    }

    html += `</div>
        <div class="bg-gray-50 rounded-lg p-4">
            <h4 class="font-semibold mb-3">📊 สถิติภาพรวม</h4>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><span class="text-gray-500">ค่าเฉลี่ยจำนวนครั้ง:</span> <b>${cs.mean}</b></div>
                <div><span class="text-gray-500">ค่ามัธยฐาน:</span> <b>${cs.median}</b></div>
                <div><span class="text-gray-500">SD (จำนวนครั้ง):</span> <b>${cs.std_dev}</b></div>
                <div><span class="text-gray-500">CV (%):</span> <b>${cs.cv}%</b></div>
                <div><span class="text-gray-500">Gini (จำนวนครั้ง):</span> <b>${f.gini_coefficient}</b></div>
                <div><span class="text-gray-500">Gini (คะแนนถ่วง):</span> <b>${ws.gini}</b></div>
                <div><span class="text-gray-500">ดัชนีล้าเฉลี่ย:</span> <b>${fs.mean}</b></div>
                <div><span class="text-gray-500">ดัชนีล้าสูงสุด:</span> <b>${fs.max}</b></div>
            </div>
        </div>`;

    document.getElementById('fairnessDetail').innerHTML = html;
}

// ===========================================
// NEVER ASSIGNED
// ===========================================
function renderNeverAssigned() {
    const never = allSummary.filter(s => s.assignment_count === 0);
    const byDept = {};
    never.forEach(s => { (byDept[s.department] = byDept[s.department] || []).push(s); });

    let html = `<p class="text-lg font-semibold mb-4 text-red-600">พบ ${never.length} คน ที่ไม่เคยปรากฏในคำสั่งที่อัปโหลด</p>`;
    if (!never.length) { html = '<p class="text-green-600 font-semibold">✅ ทุกคนได้รับมอบหมายอย่างน้อย 1 ครั้ง</p>'; }
    else {
        for (const [dept, people] of Object.entries(byDept).sort()) {
            html += `<div class="mb-4"><h4 class="font-semibold text-gray-700 mb-2">${dept} (${people.length} คน)</h4>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-2">${people.map(p => `
                    <div class="bg-red-50 rounded-lg px-3 py-2 text-sm flex justify-between">
                        <span>${p.name} ${isAdmin(p) ? '<span class="text-xs bg-amber-100 text-amber-800 px-1 rounded">หัวหน้า</span>' : ''}</span>
                        <span class="text-xs text-gray-400">${p.position}</span>
                    </div>`).join('')}
                </div></div>`;
        }
    }
    document.getElementById('neverList').innerHTML = html;
}

// ===========================================
// DEPT STATS
// ===========================================
function renderDeptStats() {
    const stats = analysisData.dept_stats || {};
    let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">';
    const sorted = Object.entries(stats).sort((a, b) => (b[1].avg_weighted_score || b[1].avg_assignments || 0) - (a[1].avg_weighted_score || a[1].avg_assignments || 0));

    for (const [dept, s] of sorted) {
        const pct = s.total_staff > 0 ? Math.round(s.assigned_count / s.total_staff * 100) : 0;
        const fairColor = (s.fairness_score || 0) >= 70 ? 'text-green-600' : (s.fairness_score || 0) >= 55 ? 'text-yellow-600' : 'text-red-600';
        html += `<div class="bg-gray-50 rounded-lg p-4">
            <div class="flex justify-between items-center mb-2">
                <h4 class="font-semibold text-gray-800">${dept}</h4>
                <span class="text-sm ${fairColor} font-bold">⚖️ ${(s.fairness_score||0).toFixed(0)}</span>
            </div>
            <div class="grid grid-cols-2 gap-2 text-sm">
                <div>บุคลากร: <b>${s.total_staff}</b></div>
                <div>ได้รับ: <b>${s.assigned_count}</b> (${pct}%)</div>
                <div>รวมครั้ง: <b>${s.total_assignments}</b></div>
                <div>เฉลี่ย/คน: <b>${s.avg_assignments}</b></div>
                <div>คะแนนถ่วงรวม: <b>${(s.total_weighted_score||0).toFixed(1)}</b></div>
                <div>ดัชนีล้าเฉลี่ย: <b>${(s.avg_fatigue||0).toFixed(1)}</b></div>
            </div>
            <div class="mt-2 w-full bg-gray-200 rounded-full h-2"><div class="bg-blue-500 h-2 rounded-full" style="width:${pct}%"></div></div>
        </div>`;
    }
    html += '</div>';
    document.getElementById('deptStats').innerHTML = html;
}

// ===========================================
// WORKGROUP STATS
// ===========================================
function renderWorkgroupStats() {
    const wg = analysisData.work_group_distribution || {};
    const total = Object.values(wg).reduce((a, b) => a + b, 0) || 1;

    let html = '<h3 class="text-lg font-bold mb-4">🗂️ การกระจายภาระงานตามฝ่าย</h3>';
    html += '<div class="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">ระบบจัดกลุ่มอัตโนมัติจากเนื้อหาคำสั่ง: <b>วิชาการ</b> (สอบ, ตรวจ, ประเมิน), <b>กิจการนักเรียน</b> (รับสมัคร, มอบตัว), <b>บริหารทั่วไป</b> (สถานที่, จราจร, ประชาสัมพันธ์), <b>งบประมาณ</b> (การเงิน, พัสดุ)</div>';
    html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">';

    const sorted = Object.entries(wg).sort((a, b) => b[1] - a[1]);
    const colors = { 'วิชาการ': 'blue', 'กิจการนักเรียน': 'green', 'บริหารทั่วไป': 'purple', 'งบประมาณ': 'orange', 'บุคคล': 'teal', 'อื่นๆ': 'gray' };

    for (const [group, count] of sorted) {
        const pct = Math.round(count / total * 100);
        const c = colors[group] || 'gray';
        html += `<div class="bg-${c}-50 rounded-lg p-4">
            <div class="flex justify-between mb-1">
                <h4 class="font-semibold text-${c}-800">${group}</h4>
                <span class="font-bold text-${c}-600">${count} รายการ (${pct}%)</span>
            </div>
            <div class="w-full bg-${c}-200 rounded-full h-3"><div class="bg-${c}-500 h-3 rounded-full" style="width:${pct}%"></div></div>
        </div>`;
    }

    html += '</div>';

    html += '<h4 class="font-semibold mt-6 mb-3">👤 ครูที่รับงานข้ามฝ่ายมากที่สุด</h4>';
    const crossDept = allSummary.filter(s => (s.work_group_count || 0) > 1).sort((a, b) => (b.work_group_count || 0) - (a.work_group_count || 0)).slice(0, 20);

    if (crossDept.length) {
        html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-2">';
        for (const s of crossDept) {
            const groups = Object.entries(s.work_groups || {}).map(([g, c]) => `${g}(${c})`).join(', ');
            html += `<div class="bg-gray-50 rounded-lg px-3 py-2 text-sm flex justify-between cursor-pointer hover:bg-gray-100" onclick="showPerson('${s.name.replace(/'/g,"\\'")}')">
                <div><b>${s.name}</b> <span class="text-gray-400">${s.department}</span></div>
                <div class="text-xs text-gray-500">${groups}</div>
            </div>`;
        }
        html += '</div>';
    } else {
        html += '<p class="text-gray-400 text-sm">ไม่พบข้อมูล</p>';
    }

    document.getElementById('workgroupStats').innerHTML = html;
}

// ===========================================
// PERSON DETAIL MODAL
// ===========================================
function showPerson(name) {
    const person = allSummary.find(s => s.name === name);
    if (!person) return;
    document.getElementById('modalName').textContent = person.name;

    const fatigue = person.fatigue_index || 0;
    const ws = person.total_weighted_score || 0;
    const tl = person.timeline || {};
    const avg = analysisData.avg_assignments || 1;
    const ratio = person.assignment_count / avg;

    let html = `
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm mb-4">
            <div><b>กลุ่มสาระ:</b> ${person.department}</div>
            <div><b>ตำแหน่ง:</b> ${person.position}</div>
            ${person.admin_role ? `<div><b>ตำแหน่งบริหาร:</b> <span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-xs">${person.admin_role}</span></div>` : '<div></div>'}
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div class="bg-gray-50 rounded-lg p-3 text-center">
                <div class="text-2xl font-bold">${person.assignment_count}</div>
                <div class="text-xs text-gray-500">จำนวนครั้ง</div>
                <div class="text-xs ${ratio > 1.5 ? 'text-red-600 font-bold' : ratio > 1 ? 'text-yellow-600' : 'text-green-600'}">${ratio.toFixed(1)}x ค่าเฉลี่ย</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3 text-center">
                <div class="text-2xl font-bold">${ws.toFixed(1)}</div>
                <div class="text-xs text-gray-500">คะแนนถ่วงน้ำหนัก</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3 text-center">
                <div class="text-2xl font-bold" style="color:${getFatigueColor(fatigue)}">${fatigue.toFixed(1)}</div>
                <div class="text-xs text-gray-500">ดัชนีเหนื่อยล้า</div>
                <div class="text-xs" style="color:${getFatigueColor(fatigue)}">${getFatigueLabel(fatigue)}</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3 text-center">
                <div class="text-2xl font-bold">${person.work_group_count || 0}</div>
                <div class="text-xs text-gray-500">ฝ่ายงานที่รับผิดชอบ</div>
            </div>
        </div>`;

    if (tl.has_dates && tl.unique_dates > 0) {
        html += `<div class="bg-blue-50 rounded-lg p-3 mb-4 text-sm">
            <h4 class="font-semibold text-blue-800 mb-1">🗓️ ไทม์ไลน์</h4>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>วันแรก: <b>${tl.first_date}</b></div>
                <div>วันสุดท้าย: <b>${tl.last_date}</b></div>
                <div>ช่วงเวลา: <b>${tl.span_days}</b> วัน</div>
                <div>วันที่ปฏิบัติ: <b>${tl.unique_dates}</b> วัน</div>
                <div>ห่างเฉลี่ย: <b>${tl.avg_gap_days ?? '-'}</b> วัน</div>
                <div>ห่างน้อยสุด: <b>${tl.min_gap_days ?? '-'}</b> วัน</div>
                <div>ห่างมากสุด: <b>${tl.max_gap_days ?? '-'}</b> วัน</div>
                <div>กลุ่มงานถี่: <b>${tl.cluster_count ?? '-'}</b> ช่วง</div>
            </div>
        </div>`;
    }

    if (person.work_groups && Object.keys(person.work_groups).length) {
        html += `<div class="bg-purple-50 rounded-lg p-3 mb-4 text-sm">
            <h4 class="font-semibold text-purple-800 mb-1">🗂️ ฝ่ายงาน</h4>
            <div class="flex flex-wrap gap-2">
                ${Object.entries(person.work_groups).map(([g, c]) => `<span class="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs">${g}: ${c} ครั้ง</span>`).join('')}
            </div>
        </div>`;
    }

    if (person.assignments && person.assignments.length) {
        const byOrder = {};
        person.assignments.forEach(a => {
            const key = a.order_number || 'ไม่ระบุ';
            if (!byOrder[key]) byOrder[key] = { subject: a.order_subject, entries: [] };
            byOrder[key].entries.push(a);
        });

        html += '<div class="space-y-3">';
        for (const [orderNum, group] of Object.entries(byOrder)) {
            html += `<div class="border rounded-lg p-3">
                <div class="font-semibold text-blue-700 mb-1">📋 คำสั่งที่ ${orderNum}</div>
                <div class="text-xs text-gray-500 mb-2">${group.subject || ''}</div>
                <table class="w-full text-xs"><thead><tr class="text-gray-400"><th class="text-left py-1">วันที่</th><th class="text-left py-1">เวลา</th><th class="text-left py-1">ชม.</th><th class="text-left py-1">หน้าที่/ฝ่าย</th><th class="text-left py-1">น้ำหนัก</th><th class="text-left py-1">ไฟล์</th></tr></thead><tbody>
                    ${group.entries.map(e => {
                        const cl = e.classification || {};
                        const df = cl.duration_factor || 1;
                        const dfLabel = df !== 1 ? ` (×${df})` : '';
                        return `<tr class="border-t">
                            <td class="py-1">${e.duty_date || '-'}</td>
                            <td class="py-1">${e.duty_time || '-'}</td>
                            <td class="py-1">${e.duration_hours ? e.duration_hours + ' ชม.' : '-'}</td>
                            <td class="py-1">${e.duty_section || '-'}</td>
                            <td class="py-1 font-bold">${cl.weighted_score || '-'}${dfLabel}</td>
                            <td class="py-1 text-gray-400">${e.source_file || '-'}</td>
                        </tr>`;
                    }).join('')}
                </tbody></table>
            </div>`;
        }
        html += '</div>';
    } else {
        html += '<p class="text-gray-400 italic mt-3">ไม่พบรายการที่ได้รับมอบหมาย</p>';
    }

    document.getElementById('modalContent').innerHTML = html;
    personModal.classList.remove('hidden');
}
window.showPerson = showPerson;

closeModal.addEventListener('click', () => personModal.classList.add('hidden'));
personModal.addEventListener('click', e => { if (e.target === personModal) personModal.classList.add('hidden'); });

// ===========================================
// EXPORT (print)
// ===========================================
btnExport.addEventListener('click', () => {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('hidden'));
    window.print();
    setTimeout(() => {
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        const activeTab = document.querySelector('.tab-btn.tab-active');
        if (activeTab) document.getElementById('tab-' + activeTab.dataset.tab).classList.remove('hidden');
    }, 500);
});

// ===========================================
// INIT — Load staff info (client-side, from localStorage)
// ===========================================
function initStaffUI() {
    const currentList = loadStaffList();
    const depts = getCurrentDepartments();
    document.getElementById('staffCount').innerHTML = `<b>${currentList.length}</b> บุคลากร | <b>${depts.length}</b> กลุ่มสาระ`;
    const deptOpts = '<option value="">ไม่ยกเว้น</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
    ['schedExcludeDept', 'assignExcludeDept'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = deptOpts;
    });
}
initStaffUI();

// Restore last analysis on page load
const _initUploads = loadParsedUploads();
if (_initUploads && _initUploads.some(r => r.success)) {
    uploadResults = _initUploads;
    renderSavedOrdersPanel();
}
if (loadSavedAnalysis()) {
    allSummary = analysisData.summary;
    lastAnalysisSummary = analysisData.summary;
    resultsSection.classList.remove('hidden');
    renderAllResults();
    const savedAt = (() => { try { const p = JSON.parse(localStorage.getItem(ANALYSIS_STORAGE_KEY)); return p.savedAt ? new Date(p.savedAt).toLocaleString('th-TH') : ''; } catch { return ''; } })();
    const fileCount = (_initUploads || []).filter(r => r.success).length;
    const notice = document.getElementById('restoreNotice');
    if (notice) { notice.textContent = `♻️ โหลดข้อมูล ${fileCount} ไฟล์คำสั่งคืน (บันทึกเมื่อ ${savedAt}) — อัปโหลด PDF เพิ่มเพื่อรวมข้อมูล`; notice.classList.remove('hidden'); }
}

// ===========================================
// SCHEDULER — Sub-tab switching
// ===========================================
document.querySelectorAll('.sched-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.sched-tab-btn').forEach(b => { b.classList.remove('bg-blue-600', 'text-white'); b.classList.add('bg-gray-200', 'text-gray-700'); });
        document.querySelectorAll('.sched-content').forEach(c => c.classList.add('hidden'));
        btn.classList.remove('bg-gray-200', 'text-gray-700');
        btn.classList.add('bg-blue-600', 'text-white');
        document.getElementById('sched-' + btn.dataset.stab).classList.remove('hidden');
    });
});

// ===========================================
// SCHEDULER — Proctoring (client-side)
// ===========================================
let proctorSessions = [];

document.getElementById('btnAddSession').addEventListener('click', () => {
    const date = document.getElementById('schedDate').value;
    const period = document.getElementById('schedPeriod').value;
    const startTime = document.getElementById('schedStartTime').value;
    const endTime = document.getElementById('schedEndTime').value;
    const roomsStr = document.getElementById('schedRooms').value.trim();
    const excludeDept = document.getElementById('schedExcludeDept').value;

    if (!date || !roomsStr) { alert('กรุณาระบุวันที่และห้องสอบ'); return; }

    const rooms = roomsStr.split(',').map(r => r.trim()).filter(r => r);
    proctorSessions.push({
        date, period, start_time: startTime, end_time: endTime,
        rooms, exclude_depts: excludeDept ? [excludeDept] : [],
    });

    renderSessionList();
});

function renderSessionList() {
    const el = document.getElementById('sessionList');
    const btn = document.getElementById('btnGenerateProctor');
    if (!proctorSessions.length) { el.innerHTML = ''; btn.disabled = true; return; }
    btn.disabled = false;

    el.innerHTML = proctorSessions.map((s, i) => {
        const excl = s.exclude_depts.length ? ` <span class="text-red-400">(ยกเว้น: ${s.exclude_depts.join(', ')})</span>` : '';
        return `<div class="flex items-center justify-between bg-blue-50 rounded-lg px-4 py-2">
            <span class="text-sm">📅 ${s.date} ${s.period} ${s.start_time}-${s.end_time} | ${s.rooms.length} ห้อง (${s.rooms.join(', ')})${excl}</span>
            <button onclick="removeSession(${i})" class="text-red-400 hover:text-red-600">&times;</button>
        </div>`;
    }).join('');
}

function removeSession(i) { proctorSessions.splice(i, 1); renderSessionList(); }
window.removeSession = removeSession;

document.getElementById('btnClearSessions').addEventListener('click', () => {
    proctorSessions = [];
    renderSessionList();
    document.getElementById('proctorResult').classList.add('hidden');
});

document.getElementById('btnGenerateProctor').addEventListener('click', () => {
    const btn = document.getElementById('btnGenerateProctor');
    btn.disabled = true;
    btn.textContent = '⏳ กำลังสร้าง...';

    const config = {
        exam_name: document.getElementById('schedExamName').value || 'สอบ',
        proctors_per_room: parseInt(document.getElementById('schedProctorsPerRoom').value) || 2,
        sessions: proctorSessions.map(s => ({
            ...s,
            proctors_per_room: parseInt(document.getElementById('schedProctorsPerRoom').value) || 2,
        })),
    };

    try {
        const data = scheduleProctoring(config, lastAnalysisSummary);
        if (data.error) { alert(data.error); return; }
        renderProctorResult(data);
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '📅 สร้างตารางคุมสอบ';
    }
});

function renderProctorResult(data) {
    const el = document.getElementById('proctorResult');
    el.classList.remove('hidden');

    const s = data.summary;
    let html = `
        <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <h3 class="font-bold text-green-800 text-lg mb-2">📅 ${data.exam_name}</h3>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <div>รอบสอบ: <b>${s.total_sessions}</b></div>
                <div>ห้องสอบ: <b>${s.total_rooms}</b></div>
                <div>ตำแหน่งทั้งหมด: <b>${s.total_slots}</b></div>
                <div>จัดได้: <b>${s.total_filled}</b> (${s.fill_rate}%)</div>
                <div>ใช้บุคลากร: <b>${s.total_staff_used}</b> คน</div>
            </div>
            ${s.cross_group_note ? `<div class="mt-2 text-xs ${s.has_historical_data ? 'text-green-700 bg-green-100' : 'text-amber-700 bg-amber-100'} px-3 py-1.5 rounded">💡 ${s.cross_group_note}</div>` : ''}
        </div>`;

    if (s.dept_distribution && Object.keys(s.dept_distribution).length) {
        html += '<div class="mb-4"><h4 class="font-semibold text-sm mb-2">📊 การกระจายตามกลุ่มสาระ</h4><div class="flex flex-wrap gap-2">';
        for (const [dept, count] of Object.entries(s.dept_distribution).sort((a,b) => b[1]-a[1])) {
            html += `<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">${dept}: ${count}</span>`;
        }
        html += '</div></div>';
    }

    for (const session of data.schedule) {
        html += `<div class="mb-4 border rounded-lg overflow-hidden">
            <div class="bg-gray-100 px-4 py-2 font-semibold text-sm">
                📅 ${session.date} ${session.period} (${session.start_time}-${session.end_time}) — ${session.duration_hours} ชม. | น้ำหนัก: ${session.session_weight}
            </div>
            <table class="w-full text-sm">
                <thead><tr class="bg-gray-50 text-left">
                    <th class="px-3 py-2">ห้องสอบ</th>
                    <th class="px-3 py-2">กรรมการคุมสอบ</th>
                </tr></thead><tbody>`;

        for (const room of session.rooms) {
            const proctorHtml = room.proctors.map(p => {
                const badge = p.admin_role ? ` <span class="text-xs bg-amber-100 text-amber-800 px-1 rounded">${p.admin_role}</span>` : '';
                const fatigueTag = p.fatigue_index > 30 ? ` <span class="text-xs text-red-500">⚠ F:${p.fatigue_index}</span>` : '';
                return `<div class="py-0.5"><b>${p.name}</b>${badge}${fatigueTag} <span class="text-gray-400 text-xs">${p.department} | WS: ${p.cumulative_ws_before}→${p.cumulative_ws_after}</span></div>`;
            }).join('');

            const fillColor = room.proctors_assigned < room.proctors_needed ? 'bg-red-50' : '';
            html += `<tr class="border-t ${fillColor}">
                <td class="px-3 py-2 font-medium">${room.room_name}</td>
                <td class="px-3 py-2">${proctorHtml || '<span class="text-red-400">ไม่สามารถจัดได้</span>'}</td>
            </tr>`;
        }

        html += '</tbody></table></div>';
    }

    html += '<button onclick="window.print()" class="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 mt-2 no-print">🖨️ พิมพ์ตาราง</button>';
    el.innerHTML = html;
}

// ===========================================
// SCHEDULER — General Assignment (client-side)
// ===========================================
document.getElementById('btnGenerateAssign').addEventListener('click', () => {
    const btn = document.getElementById('btnGenerateAssign');

    const roles = {
        'ประธาน': parseInt(document.getElementById('roleChair').value) || 0,
        'รองประธาน': parseInt(document.getElementById('roleViceChair').value) || 0,
        'เลขานุการ': parseInt(document.getElementById('roleSecretary').value) || 0,
        'ผู้ช่วยเลขานุการ': parseInt(document.getElementById('roleAsstSec').value) || 0,
        'กรรมการ': parseInt(document.getElementById('roleCommittee').value) || 0,
    };
    const totalRoles = Object.values(roles).reduce((a, b) => a + b, 0);
    if (totalRoles <= 0) { alert('กรุณาระบุจำนวนบุคลากรอย่างน้อย 1 ตำแหน่ง'); return; }

    btn.disabled = true;
    btn.textContent = '⏳ กำลังสร้าง...';

    const config = {
        task_name: document.getElementById('assignTaskName').value || 'งาน',
        task_type: document.getElementById('assignTaskType').value,
        date: document.getElementById('assignDate').value,
        start_time: document.getElementById('assignStartTime').value,
        end_time: document.getElementById('assignEndTime').value,
        exclude_depts: (() => { const v = document.getElementById('assignExcludeDept').value; return v ? [v] : []; })(),
        roles,
    };

    try {
        const data = scheduleAssignment(config, lastAnalysisSummary);
        if (data.error) { alert(data.error); return; }
        renderAssignResult(data);
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '📋 สร้างตารางปฏิบัติงาน';
    }
});

function renderAssignResult(data) {
    const el = document.getElementById('assignResult');
    el.classList.remove('hidden');

    const s = data.summary;
    let html = `
        <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <h3 class="font-bold text-green-800 text-lg mb-2">📋 ${data.task_name}</h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>ประเภท: <b>${data.task_type}</b></div>
                <div>วันที่: <b>${data.date || '-'}</b></div>
                <div>เวลา: <b>${data.start_time}-${data.end_time}</b> (${data.duration_hours} ชม.)</div>
                <div>จัดได้: <b>${s.total_assigned}/${s.total_requested}</b> คน</div>
            </div>
            ${s.cross_group_note ? `<div class="mt-2 text-xs ${s.has_historical_data ? 'text-green-700 bg-green-100' : 'text-amber-700 bg-amber-100'} px-3 py-1.5 rounded">💡 ${s.cross_group_note}</div>` : ''}
        </div>`;

    if (s.dept_distribution && Object.keys(s.dept_distribution).length) {
        html += '<div class="mb-4"><h4 class="font-semibold text-sm mb-2">📊 กระจายตามกลุ่มสาระ</h4><div class="flex flex-wrap gap-2">';
        for (const [dept, count] of Object.entries(s.dept_distribution).sort((a,b) => b[1]-a[1])) {
            html += `<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">${dept}: ${count}</span>`;
        }
        html += '</div></div>';
    }

    const roleOrder = ['ประธาน', 'รองประธาน', 'เลขานุการ', 'ผู้ช่วยเลขานุการ', 'กรรมการ'];
    html += '<table class="w-full text-sm border rounded-lg overflow-hidden"><thead><tr class="bg-gray-50">';
    html += '<th class="px-3 py-2 text-left">#</th><th class="px-3 py-2 text-left">บทบาท</th><th class="px-3 py-2 text-left">ชื่อ-นามสกุล</th><th class="px-3 py-2 text-left">กลุ่มสาระ</th><th class="px-3 py-2 text-center">น้ำหนัก</th><th class="px-3 py-2 text-center">WS ก่อน→หลัง</th><th class="px-3 py-2 text-center">Fatigue</th>';
    html += '</tr></thead><tbody>';

    let row = 1;
    for (const role of roleOrder) {
        const people = data.assignments.filter(a => a.role === role);
        if (!people.length) continue;

        for (const p of people) {
            const badge = p.admin_role ? ` <span class="text-xs bg-amber-100 text-amber-800 px-1 rounded">${p.admin_role}</span>` : '';
            const roleColor = role === 'ประธาน' ? 'text-purple-700 font-bold' : role === 'เลขานุการ' ? 'text-blue-700 font-bold' : 'text-gray-600';
            const fatigueColor = (p.fatigue_index || 0) > 30 ? 'text-red-600 font-bold' : 'text-gray-400';
            html += `<tr class="border-t">
                <td class="px-3 py-2 text-gray-400">${row++}</td>
                <td class="px-3 py-2 ${roleColor}">${role}</td>
                <td class="px-3 py-2"><b>${p.name}</b>${badge}</td>
                <td class="px-3 py-2 text-gray-500 text-xs">${p.department}</td>
                <td class="px-3 py-2 text-center">${p.assignment_score}</td>
                <td class="px-3 py-2 text-center text-xs">${p.cumulative_ws_before} → ${p.cumulative_ws_after}</td>
                <td class="px-3 py-2 text-center text-xs ${fatigueColor}">${p.fatigue_index || 0}</td>
            </tr>`;
        }
    }

    html += '</tbody></table>';
    html += '<button onclick="window.print()" class="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 mt-4 no-print">🖨️ พิมพ์ตาราง</button>';
    el.innerHTML = html;
}

// ===========================================
// STAFF MANAGEMENT
// ===========================================
let staffEditIndex = null; // null = add, number = edit index

function renderStaffTable() {
    const list = loadStaffList();
    const search = (document.getElementById('staffSearch')?.value || '').trim().toLowerCase();
    const deptFilter = document.getElementById('staffFilterDept')?.value || '';

    let filtered = list;
    if (search) filtered = filtered.filter(s => s.name.toLowerCase().includes(search));
    if (deptFilter) filtered = filtered.filter(s => s.department === deptFilter);

    // populate dept filter dropdown
    const depts = [...new Set(list.map(s => s.department))].sort();
    const deptSelect = document.getElementById('staffFilterDept');
    if (deptSelect) {
        const cur = deptSelect.value;
        deptSelect.innerHTML = '<option value="">ทุกกลุ่มสาระ</option>' + depts.map(d => `<option value="${d}" ${d === cur ? 'selected' : ''}>${d}</option>`).join('');
    }

    const tbody = document.getElementById('staffTable');
    if (!tbody) return;

    tbody.innerHTML = filtered.map((s, i) => {
        const realIdx = list.indexOf(s);
        const adminBadge = s.admin_role ? `<span class="inline-block text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">${s.admin_role}</span>` : '';
        const excludeBadge = s.exclude_from_stats ? '<span class="inline-block text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">ยกเว้นจากสถิติ</span>' : '';
        const rowBg = s.exclude_from_stats ? 'bg-slate-50 opacity-70' : 'hover:bg-gray-50';
        return `<tr class="border-b ${rowBg}">
            <td class="px-2 py-2 text-gray-400">${i + 1}</td>
            <td class="px-2 py-2 font-medium">${s.name} ${excludeBadge}</td>
            <td class="px-2 py-2 text-sm text-gray-600">${s.department}</td>
            <td class="px-2 py-2 text-sm text-gray-500">${s.position || '-'}</td>
            <td class="px-2 py-2">${adminBadge}</td>
            <td class="px-2 py-2 text-center">
                <button onclick="toggleExclude(${realIdx})" class="text-xs mr-2 ${s.exclude_from_stats ? 'text-green-600 hover:text-green-800' : 'text-slate-400 hover:text-slate-600'}" title="${s.exclude_from_stats ? 'รวมในสถิติ' : 'ยกเว้นจากสถิติ'}">${s.exclude_from_stats ? '✓ รวมอีกครั้ง' : '✕ ยกเว้น'}</button>
        </tr>`;
    }).join('');

    const badge = document.getElementById('staffCountBadge');
    if (badge) badge.textContent = `${list.length} คน | ${depts.length} กลุ่มสาระ`;
    document.getElementById('staffTableInfo').textContent = `แสดง ${filtered.length} จาก ${list.length} คน`;
}
window.renderStaffTable = renderStaffTable;

function openAddStaffModal() {
    staffEditIndex = null;
    document.getElementById('staffModalTitle').textContent = 'เพิ่มบุคลากร';
    document.getElementById('sfName').value = '';
    document.getElementById('sfDept').value = '';
    document.getElementById('sfPosition').value = 'ครู';
    document.getElementById('sfAdminRole').value = '';
    document.getElementById('sfExcludeStats').checked = false;
    document.getElementById('staffModalError').classList.add('hidden');

    // populate dept select
    const depts = getCurrentDepartments();
    document.getElementById('sfDeptSelect').innerHTML = '<option value="">-- เลือกจากรายการ --</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
    document.getElementById('staffModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('sfName').focus(), 100);
}
window.openAddStaffModal = openAddStaffModal;

function editStaff(idx) {
    const list = loadStaffList();
    const s = list[idx];
    if (!s) return;
    staffEditIndex = idx;

    document.getElementById('staffModalTitle').textContent = 'แก้ไขบุคลากร';
    document.getElementById('sfName').value = s.name;
    document.getElementById('sfDept').value = s.department;
    document.getElementById('sfPosition').value = s.position || 'ครู';
    document.getElementById('sfAdminRole').value = s.admin_role || '';
    document.getElementById('sfExcludeStats').checked = !!s.exclude_from_stats;
    document.getElementById('staffModalError').classList.add('hidden');

    const depts = getCurrentDepartments();
    document.getElementById('sfDeptSelect').innerHTML = '<option value="">-- เลือกจากรายการ --</option>' + depts.map(d => `<option value="${d}" ${d === s.department ? 'selected' : ''}>${d}</option>`).join('');
    document.getElementById('staffModal').classList.remove('hidden');
}
window.editStaff = editStaff;

function syncDeptInput() {
    const sel = document.getElementById('sfDeptSelect').value;
    if (sel) document.getElementById('sfDept').value = sel;
}
window.syncDeptInput = syncDeptInput;

function saveStaff() {
    const name = document.getElementById('sfName').value.trim();
    const dept = document.getElementById('sfDept').value.trim() || document.getElementById('sfDeptSelect').value;
    const position = document.getElementById('sfPosition').value;
    const adminRole = document.getElementById('sfAdminRole').value;
    const excludeFromStats = document.getElementById('sfExcludeStats').checked;
    const errEl = document.getElementById('staffModalError');

    if (!name) { errEl.textContent = 'กรุณาระบุชื่อ-นามสกุล'; errEl.classList.remove('hidden'); return; }
    if (!dept) { errEl.textContent = 'กรุณาระบุกลุ่มสาระ/ฝ่าย'; errEl.classList.remove('hidden'); return; }

    const list = loadStaffList();

    if (staffEditIndex === null) {
        // Add — check duplicate
        if (list.some(s => s.name === name)) {
            errEl.textContent = `มีชื่อ "${name}" อยู่แล้วในระบบ`; errEl.classList.remove('hidden'); return;
        }
        list.push({ name, department: dept, position, admin_role: adminRole, exclude_from_stats: excludeFromStats });
    } else {
        // Edit
        list[staffEditIndex] = { name, department: dept, position, admin_role: adminRole, exclude_from_stats: excludeFromStats };
    }

    saveStaffList(list);
    closeStaffModal();
    renderStaffTable();
    initStaffUI();
}
window.saveStaff = saveStaff;

function deleteStaff(idx) {
    const list = loadStaffList();
    if (!confirm(`ลบ "${list[idx]?.name}" ออกจากระบบ?`)) return;
    list.splice(idx, 1);
    saveStaffList(list);
    renderStaffTable();
    initStaffUI();
}
window.deleteStaff = deleteStaff;

function toggleExclude(idx) {
    const list = loadStaffList();
    if (!list[idx]) return;
    list[idx].exclude_from_stats = !list[idx].exclude_from_stats;
    saveStaffList(list);
    renderStaffTable();
    initStaffUI();
}
window.toggleExclude = toggleExclude;

function closeStaffModal() {
    document.getElementById('staffModal').classList.add('hidden');
}
window.closeStaffModal = closeStaffModal;
document.getElementById('staffModal').addEventListener('click', e => { if (e.target === document.getElementById('staffModal')) closeStaffModal(); });

function exportStaffJson() {
    const list = loadStaffList();
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ppk_staff.json';
    a.click();
}
window.exportStaffJson = exportStaffJson;

function importStaffJson(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) throw new Error('ไฟล์ต้องมีรูปแบบ Array');
            const valid = data.filter(s => s.name && s.department);
            if (!valid.length) throw new Error('ไม่พบข้อมูลที่ถูกต้อง');
            if (!confirm(`นำเข้า ${valid.length} คน?\nจะเขียนทับข้อมูลบุคลากรปัจจุบัน`)) return;
            saveStaffList(valid);
            renderStaffTable();
            initStaffUI();
            alert(`นำเข้าสำเร็จ ${valid.length} คน`);
        } catch (err) {
            alert('ไฟล์ JSON ไม่ถูกต้อง: ' + err.message);
        }
    };
    reader.readAsText(file, 'utf-8');
    event.target.value = '';
}
window.importStaffJson = importStaffJson;

function exportCsv() {
    if (!allSummary.length) return;
    const headers = ['ลำดับ', 'ชื่อ-นามสกุล', 'กลุ่มสาระ/ฝ่าย', 'ตำแหน่ง', 'ตำแหน่งบริหาร', 'จำนวนครั้ง', 'คะแนนถ่วงน้ำหนัก', 'ดัชนีเหนื่อยล้า', 'ฝ่ายงาน', 'คำสั่งที่พบ', 'ยกเว้นจากสถิติ'];
    const rows = allSummary.map((s, i) => [
        i + 1,
        s.name,
        s.department,
        s.position || '',
        s.admin_role || '',
        s.assignment_count,
        (s.total_weighted_score || 0).toFixed(1),
        (s.fatigue_index || 0).toFixed(1),
        Object.keys(s.work_groups || {}).join(' / '),
        (s.unique_orders || []).join(' / '),
        s.exclude_from_stats ? 'ยกเว้น' : '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ppk_workload.csv';
    a.click();
}
window.exportCsv = exportCsv;

function resetStaffToDefault() {
    if (!confirm(`รีเซ็ตกลับเป็นฐานข้อมูลเริ่มต้น (${STAFF_LIST.length} คน)?\nข้อมูลที่แก้ไขจะหายหมด`)) return;
    localStorage.removeItem(STAFF_STORAGE_KEY);
    renderStaffTable();
    initStaffUI();
}
window.resetStaffToDefault = resetStaffToDefault;

// ===========================================
// TOP 10 PANEL
// ===========================================
function renderTop10Panel() {
    const panel = document.getElementById('top10Panel');
    if (!panel || !analysisData) return;

    const active = allSummary.filter(s => !s.exclude_from_stats);
    const withWork = active.filter(s => s.assignment_count > 0);
    const top10 = [...withWork].sort((a, b) => (b.total_weighted_score || 0) - (a.total_weighted_score || 0)).slice(0, 10);
    const bottom10 = [...active].sort((a, b) => a.assignment_count - b.assignment_count).slice(0, 10);
    const avg = analysisData.avg_assignments;
    const maxCount = analysisData.max_assignments || 1;

    function personRow(s, rank, bg) {
        const roleTag = s.admin_role ? ` <span class="text-xs bg-amber-100 text-amber-800 px-1 rounded">${s.admin_role}</span>` : '';
        const cntColor = s.assignment_count > avg * 1.5 ? 'text-red-600' : s.assignment_count === 0 ? 'text-gray-400' : 'text-gray-700';
        return `<div class="flex items-center gap-3 py-2 border-b last:border-0 cursor-pointer hover:opacity-80 rounded px-1" onclick="showPerson('${s.name.replace(/'/g, "\\'")}')">
            <span class="w-7 h-7 rounded-full ${bg} flex items-center justify-center text-white font-bold text-xs shrink-0">${rank}</span>
            <div class="flex-1 min-w-0"><div class="font-medium text-sm truncate">${s.name}${roleTag}</div><div class="text-xs text-gray-400">${s.department}</div></div>
            <div class="text-right shrink-0"><div class="font-bold text-sm ${cntColor}">${s.assignment_count} ครั้ง</div><div class="text-xs text-gray-400">WS: ${(s.total_weighted_score || 0).toFixed(1)}</div></div>
        </div>`;
    }

    const top5 = top10.slice(0, 5);
    const bot5 = bottom10.slice(0, 5);
    let topBars = '';
    let botBars = '';
    for (const s of top5) {
        const h = Math.max(4, Math.round((s.assignment_count / maxCount) * 96));
        const label = s.name.replace(/^(นาย|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.) ?/, '').slice(0, 5);
        topBars += `<div class="flex-1 flex flex-col items-center justify-end gap-0.5"><span class="text-xs font-bold text-red-600">${s.assignment_count}</span><div class="w-full bg-red-400 rounded-t" style="height:${h}px"></div><span class="text-xs text-gray-500 truncate w-full text-center" title="${s.name}">${label}</span></div>`;
    }
    for (const s of bot5) {
        const h = Math.max(4, Math.round((s.assignment_count / maxCount) * 96));
        const label = s.name.replace(/^(นาย|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.) ?/, '').slice(0, 5);
        botBars += `<div class="flex-1 flex flex-col items-center justify-end gap-0.5"><span class="text-xs font-bold text-green-600">${s.assignment_count}</span><div class="w-full bg-green-400 rounded-t" style="height:${h}px"></div><span class="text-xs text-gray-500 truncate w-full text-center" title="${s.name}">${label}</span></div>`;
    }

    const maxVal = top10[0]?.assignment_count || 0;
    const minVal = bottom10[0]?.assignment_count || 0;
    const ratio = minVal > 0 ? (maxVal / minVal).toFixed(1) : '∞';

    panel.innerHTML = `
        <h3 class="text-lg font-bold mb-3">🏆 เปรียบเทียบภาระงาน Top/Bottom 10</h3>
        <div class="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            ⚠️ ผู้รับภาระมากสุด <b>${maxVal} ครั้ง</b> มากกว่าผู้รับน้อยสุด <b>${minVal} ครั้ง</b> ถึง <b>${ratio} เท่า</b>
            <span class="text-amber-600 ml-2">(ค่าเฉลี่ย ${avg} ครั้ง)</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div class="bg-red-50 border border-red-200 rounded-xl p-4">
                <h4 class="font-semibold text-red-700 mb-2">🔴 รับภาระมากที่สุด 10 คน (เรียงตามคะแนนถ่วงน้ำหนัก)</h4>
                ${top10.map((s, i) => personRow(s, i + 1, 'bg-red-500')).join('')}
            </div>
            <div class="bg-green-50 border border-green-200 rounded-xl p-4">
                <h4 class="font-semibold text-green-700 mb-2">🟢 รับภาระน้อยที่สุด 10 คน (รวมผู้ยังไม่เคยได้รับ)</h4>
                ${bottom10.map((s, i) => personRow(s, i + 1, 'bg-green-500')).join('')}
            </div>
        </div>
        <div class="bg-gray-50 rounded-xl p-4">
            <h4 class="font-semibold text-gray-700 mb-3">📊 เปรียบเทียบภาพ — 5 สูงสุด vs 5 ต่ำสุด (คลิกชื่อเพื่อดูรายละเอียด)</h4>
            <div class="flex items-end gap-1 h-28 mb-2">
                ${topBars}
                <div class="w-px bg-gray-300 mx-2 self-stretch shrink-0"></div>
                ${botBars}
            </div>
            <div class="flex justify-between text-xs text-gray-400">
                <span>← รับงานมากสุด 5 คน</span>
                <span>รับงานน้อยสุด 5 คน →</span>
            </div>
        </div>`;
}

// init staff tab when clicked
document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === 'staff') {
        btn.addEventListener('click', renderStaffTable);
    }
});
