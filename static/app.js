// ===========================================
// Workload Fairness Analysis — Frontend
// ===========================================

let allSummary = [];
let analysisData = null;
let uploadResults = [];
let chartInstance = null;
let fatigueChartInstance = null;

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
btnClear.addEventListener('click', () => { selectedFiles = []; fileInput.value = ''; renderFileList(); });

// ---- Upload & Analyze ----
btnUpload.addEventListener('click', async () => {
    if (!selectedFiles.length) return;
    btnUpload.disabled = true;
    btnUpload.textContent = '⏳ กำลังวิเคราะห์...';
    uploadProgress.classList.remove('hidden');
    progressBar.style.width = '10%';
    progressText.textContent = 'กำลังอัปโหลด...';

    const formData = new FormData();
    for (const f of selectedFiles) formData.append('files', f);

    try {
        progressBar.style.width = '30%';
        progressText.textContent = 'กำลังสกัดข้อมูลจาก PDF (อาจใช้ OCR)...';
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        let data;
        try {
            data = await res.json();
        } catch (parseErr) {
            alert('เกิดข้อผิดพลาด: เซิร์ฟเวอร์ตอบกลับข้อมูลที่ไม่ถูกต้อง (status ' + res.status + ')');
            return;
        }
        if (!res.ok) { alert(data.error || 'เกิดข้อผิดพลาด'); return; }
        uploadResults = data.results;

        progressBar.style.width = '60%';
        progressText.textContent = 'กำลังวิเคราะห์ความเที่ยงธรรม...';

        let statusHtml = '<div class="mt-3 space-y-1">';
        for (const r of uploadResults) {
            const method = r.method ? ` [${r.method}]` : '';
            if (r.success) statusHtml += `<div class="text-sm text-green-600">✅ ${r.filename}${method} — พบ ${r.unique_count} คน (${r.total_assignments} รายการ)</div>`;
            else statusHtml += `<div class="text-sm text-red-500">❌ ${r.filename}${method} — ${r.error}</div>`;
        }
        statusHtml += '</div>';
        fileList.innerHTML += statusHtml;

        progressBar.style.width = '80%';
        const analyzeRes = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ results: uploadResults }),
        });
        try {
            analysisData = await analyzeRes.json();
        } catch (parseErr) {
            alert('เกิดข้อผิดพลาดในการวิเคราะห์: เซิร์ฟเวอร์ตอบกลับข้อมูลที่ไม่ถูกต้อง (status ' + analyzeRes.status + ')');
            return;
        }
        if (!analyzeRes.ok) { alert(analysisData.error || 'เกิดข้อผิดพลาดในการวิเคราะห์'); return; }

        progressBar.style.width = '100%';
        progressText.textContent = 'เสร็จสิ้น!';
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
    document.getElementById('statMax').textContent = analysisData.max_assignments;
    document.getElementById('statAvg').textContent = analysisData.avg_assignments;
    const maxFatigue = Math.max(...allSummary.map(s => s.fatigue_index || 0), 0);
    document.getElementById('statMaxFatigue').textContent = maxFatigue.toFixed(1);

    // Dept filter options
    const depts = [...new Set(allSummary.map(s => s.department))].sort();
    const deptOpts = '<option value="">ทุกกลุ่มสาระ</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
    ['filterDept', 'chartDept', 'fatigueDept'].forEach(id => document.getElementById(id).innerHTML = deptOpts);

    renderTable();
    renderNeverAssigned();
    renderDeptStats();
    renderFairnessDetail();
    renderWorkgroupStats();
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

    if (sortKey === 'weighted_score') data.sort((a, b) => (b.total_weighted_score || 0) - (a.total_weighted_score || 0));
    else if (sortKey === 'count') data.sort((a, b) => b.assignment_count - a.assignment_count);
    else if (sortKey === 'fatigue') data.sort((a, b) => (b.fatigue_index || 0) - (a.fatigue_index || 0));
    else if (sortKey === 'name') data.sort((a, b) => a.name.localeCompare(b.name, 'th'));

    const avg = analysisData.avg_assignments || 1;
    const maxWs = Math.max(...allSummary.map(s => s.total_weighted_score || 0), 1);

    const tbody = document.getElementById('summaryTable');
    tbody.innerHTML = data.map((s, i) => {
        const badges = [];
        if (isAdmin(s)) badges.push(`<span class="inline-block text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">${s.admin_role}</span>`);
        if (s.assignment_count > avg * 1.5) badges.push('<span class="inline-block text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">ภาระมากเกิน</span>');
        if (s.assignment_count === 0) badges.push('<span class="inline-block text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">ไม่เคยได้รับ</span>');

        const ws = s.total_weighted_score || 0;
        const wsBar = maxWs > 0 ? (ws / maxWs * 100) : 0;
        const fatigue = s.fatigue_index || 0;
        const wgList = s.work_groups ? Object.keys(s.work_groups).join(', ') : '-';

        return `<tr class="border-b hover:bg-blue-50 cursor-pointer" onclick="showPerson('${s.name.replace(/'/g, "\\'")}')">
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
    const values = data.map(s => metric === 'count' ? s.assignment_count : metric === 'fatigue' ? (s.fatigue_index||0) : (s.total_weighted_score||0));
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
        data: { labels: data.map(s => s.name + (isAdmin(s) ? ' ★' : '')), datasets: [{ label: labels[metric], data: values, backgroundColor: colors, borderRadius: 3 }] },
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

    // Separate admin vs teacher stats
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

        <!-- Compare admin vs teacher -->
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

        <!-- Overworked list -->
        <div class="mb-6">
            <h4 class="font-semibold text-red-700 mb-2">🚨 บุคลากรที่รับภาระมากเกินค่าเฉลี่ย 1.5 เท่า (${dist.overworked_count} คน)</h4>`;

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

        <!-- Overall stats -->
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
        </div>
    `;

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

    // Per-person work group breakdown
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

        <!-- Key metrics -->
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

    // Timeline
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

    // Work groups
    if (person.work_groups && Object.keys(person.work_groups).length) {
        html += `<div class="bg-purple-50 rounded-lg p-3 mb-4 text-sm">
            <h4 class="font-semibold text-purple-800 mb-1">🗂️ ฝ่ายงาน</h4>
            <div class="flex flex-wrap gap-2">
                ${Object.entries(person.work_groups).map(([g, c]) => `<span class="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs">${g}: ${c} ครั้ง</span>`).join('')}
            </div>
        </div>`;
    }

    // Assignment details
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

closeModal.addEventListener('click', () => personModal.classList.add('hidden'));
personModal.addEventListener('click', e => { if (e.target === personModal) personModal.classList.add('hidden'); });

// ===========================================
// EXPORT PDF (print)
// ===========================================
btnExport.addEventListener('click', () => {
    // Show all tabs content for printing
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('hidden'));
    window.print();
    // Restore tabs after print
    setTimeout(() => {
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        const activeTab = document.querySelector('.tab-btn.tab-active');
        if (activeTab) document.getElementById('tab-' + activeTab.dataset.tab).classList.remove('hidden');
    }, 500);
});

// ---- Init ----
fetch('/api/staff').then(r => r.json()).then(d => {
    document.getElementById('staffCount').innerHTML = `<b>${d.total}</b> บุคลากร | <b>${d.departments.length}</b> กลุ่มสาระ`;
    // Populate exclude dept dropdowns for scheduler
    const deptOpts = '<option value="">ไม่ยกเว้น</option>' + d.departments.map(dep => `<option value="${dep}">${dep}</option>`).join('');
    ['schedExcludeDept', 'assignExcludeDept'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = deptOpts;
    });
});

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
// SCHEDULER — Proctoring
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

document.getElementById('btnClearSessions').addEventListener('click', () => {
    proctorSessions = [];
    renderSessionList();
    document.getElementById('proctorResult').classList.add('hidden');
});

document.getElementById('btnGenerateProctor').addEventListener('click', async () => {
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
        const res = await fetch('/api/schedule/proctor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        });
        let data;
        try { data = await res.json(); } catch (e) { alert('เกิดข้อผิดพลาด: เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (status ' + res.status + ')'); return; }
        if (!res.ok) { alert(data.error || 'เกิดข้อผิดพลาด'); return; }
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

    // Department distribution
    if (s.dept_distribution && Object.keys(s.dept_distribution).length) {
        html += '<div class="mb-4"><h4 class="font-semibold text-sm mb-2">📊 การกระจายตามกลุ่มสาระ</h4><div class="flex flex-wrap gap-2">';
        for (const [dept, count] of Object.entries(s.dept_distribution).sort((a,b) => b[1]-a[1])) {
            html += `<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">${dept}: ${count}</span>`;
        }
        html += '</div></div>';
    }

    // Schedule tables per session
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

    // Print button
    html += '<button onclick="window.print()" class="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 mt-2 no-print">🖨️ พิมพ์ตาราง</button>';

    el.innerHTML = html;
}

// ===========================================
// SCHEDULER — General Assignment
// ===========================================
document.getElementById('btnGenerateAssign').addEventListener('click', async () => {
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
        const res = await fetch('/api/schedule/assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        });
        let data;
        try { data = await res.json(); } catch (e) { alert('เกิดข้อผิดพลาด: เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (status ' + res.status + ')'); return; }
        if (!res.ok) { alert(data.error || 'เกิดข้อผิดพลาด'); return; }
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

    // Department distribution
    if (s.dept_distribution && Object.keys(s.dept_distribution).length) {
        html += '<div class="mb-4"><h4 class="font-semibold text-sm mb-2">📊 กระจายตามกลุ่มสาระ</h4><div class="flex flex-wrap gap-2">';
        for (const [dept, count] of Object.entries(s.dept_distribution).sort((a,b) => b[1]-a[1])) {
            html += `<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">${dept}: ${count}</span>`;
        }
        html += '</div></div>';
    }

    // Assignment table grouped by role
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

    // Print button
    html += '<button onclick="window.print()" class="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 mt-4 no-print">🖨️ พิมพ์ตาราง</button>';

    el.innerHTML = html;
}
