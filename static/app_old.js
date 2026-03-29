// ===========================================
// Workload Analysis App — Frontend Logic
// ===========================================

let allSummary = [];
let analysisData = null;
let uploadResults = [];
let chartInstance = null;
let currentSort = { key: 'count', dir: 'desc' };

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

// ---- File Upload ----
let selectedFiles = [];

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => handleFiles(e.target.files));

function handleFiles(files) {
    for (const f of files) {
        if (f.type === 'application/pdf') {
            selectedFiles.push(f);
        }
    }
    renderFileList();
}

function renderFileList() {
    if (selectedFiles.length === 0) {
        fileList.classList.add('hidden');
        uploadActions.classList.add('hidden');
        return;
    }
    fileList.classList.remove('hidden');
    uploadActions.classList.remove('hidden');
    fileList.innerHTML = selectedFiles.map((f, i) => `
        <div class="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2">
            <span class="text-sm">📄 ${f.name} <span class="text-gray-400">(${(f.size/1024).toFixed(0)} KB)</span></span>
            <button onclick="removeFile(${i})" class="text-red-400 hover:text-red-600 text-lg">&times;</button>
        </div>
    `).join('');
}

function removeFile(idx) {
    selectedFiles.splice(idx, 1);
    renderFileList();
}

btnClear.addEventListener('click', () => {
    selectedFiles = [];
    fileInput.value = '';
    renderFileList();
});

btnUpload.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return;

    btnUpload.disabled = true;
    btnUpload.textContent = '⏳ กำลังวิเคราะห์...';
    uploadProgress.classList.remove('hidden');
    progressBar.style.width = '10%';
    progressText.textContent = 'กำลังอัปโหลดไฟล์...';

    const formData = new FormData();
    for (const f of selectedFiles) formData.append('files', f);

    try {
        progressBar.style.width = '30%';
        progressText.textContent = 'กำลังสกัดข้อมูลจาก PDF...';

        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();

        if (!res.ok) {
            alert(data.error || 'เกิดข้อผิดพลาด');
            return;
        }

        uploadResults = data.results;
        progressBar.style.width = '60%';
        progressText.textContent = 'กำลังวิเคราะห์ข้อมูล...';

        // Show file parsing status
        let statusHtml = '<div class="mt-3 space-y-1">';
        for (const r of uploadResults) {
            if (r.success) {
                statusHtml += `<div class="text-sm text-green-600">✅ ${r.filename} — พบ ${r.unique_count} คน (${r.total_assignments} รายการ)</div>`;
            } else {
                statusHtml += `<div class="text-sm text-red-500">❌ ${r.filename} — ${r.error}</div>`;
            }
        }
        statusHtml += '</div>';
        fileList.innerHTML += statusHtml;

        // Analyze
        progressBar.style.width = '80%';
        const analyzeRes = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ results: uploadResults }),
        });
        analysisData = await analyzeRes.json();

        progressBar.style.width = '100%';
        progressText.textContent = 'เสร็จสิ้น!';

        renderResults();

    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        btnUpload.disabled = false;
        btnUpload.textContent = '🔍 วิเคราะห์ไฟล์';
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
    });
});

// ---- Render Results ----
function renderResults() {
    if (!analysisData) return;

    resultsSection.classList.remove('hidden');
    allSummary = analysisData.summary;

    // Stats
    document.getElementById('statFiles').textContent = uploadResults.filter(r => r.success).length;
    document.getElementById('statAssigned').textContent = analysisData.total_assigned;
    document.getElementById('statNever').textContent = analysisData.total_never_assigned;
    document.getElementById('statMax').textContent = analysisData.max_assignments;
    document.getElementById('statAvg').textContent = analysisData.avg_assignments;

    // Populate department filters
    const depts = [...new Set(allSummary.map(s => s.department))].sort();
    const deptOptions = '<option value="">ทุกกลุ่มสาระ</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
    document.getElementById('filterDept').innerHTML = deptOptions;
    document.getElementById('chartDept').innerHTML = deptOptions;

    renderTable();
    renderNeverAssigned();
    renderDeptStats();
}

// ---- Table ----
function renderTable() {
    let data = [...allSummary];

    // Filter
    const search = document.getElementById('searchName').value.trim().toLowerCase();
    const dept = document.getElementById('filterDept').value;
    const status = document.getElementById('filterStatus').value;

    if (search) data = data.filter(s => s.name.toLowerCase().includes(search));
    if (dept) data = data.filter(s => s.department === dept);
    if (status === 'assigned') data = data.filter(s => s.assignment_count > 0);
    else if (status === 'never') data = data.filter(s => s.assignment_count === 0);
    else if (status === 'admin') data = data.filter(s => s.admin_role);

    // Sort
    const { key, dir } = currentSort;
    data.sort((a, b) => {
        let va, vb;
        if (key === 'count') { va = a.assignment_count; vb = b.assignment_count; }
        else if (key === 'name') { va = a.name; vb = b.name; }
        else if (key === 'dept') { va = a.department; vb = b.department; }
        else { va = a.assignment_count; vb = b.assignment_count; }

        if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        return dir === 'asc' ? va - vb : vb - va;
    });

    const tbody = document.getElementById('summaryTable');
    tbody.innerHTML = data.map((s, i) => {
        const badges = [];
        if (s.admin_role) badges.push(`<span class="inline-block text-xs px-2 py-0.5 rounded badge-admin">${s.admin_role}</span>`);
        if (s.assignment_count === 0) badges.push('<span class="inline-block text-xs px-2 py-0.5 rounded badge-never">ไม่เคยได้รับ</span>');

        const barWidth = analysisData.max_assignments > 0
            ? (s.assignment_count / analysisData.max_assignments * 100)
            : 0;
        const barColor = s.assignment_count === 0 ? 'bg-gray-200' :
            s.assignment_count > analysisData.avg_assignments * 1.5 ? 'bg-red-400' :
            s.assignment_count > analysisData.avg_assignments ? 'bg-yellow-400' : 'bg-green-400';

        return `<tr class="border-b hover:bg-blue-50 cursor-pointer" onclick="showPerson('${s.name}')">
            <td class="px-3 py-2 text-gray-400">${i + 1}</td>
            <td class="px-3 py-2 font-medium">${s.name} ${badges.join(' ')}</td>
            <td class="px-3 py-2 text-gray-600">${s.department}</td>
            <td class="px-3 py-2 text-gray-500 text-xs">${s.position}</td>
            <td class="px-3 py-2">
                <div class="flex items-center gap-2">
                    <span class="font-bold ${s.assignment_count === 0 ? 'text-gray-400' : 'text-gray-800'}">${s.assignment_count}</span>
                    <div class="w-24 bg-gray-100 rounded-full h-2">
                        <div class="${barColor} h-2 rounded-full" style="width:${barWidth}%"></div>
                    </div>
                </div>
            </td>
            <td class="px-3 py-2">
                <button class="text-blue-500 hover:text-blue-700 text-xs">ดูรายละเอียด →</button>
            </td>
        </tr>`;
    }).join('');

    document.getElementById('tableInfo').textContent = `แสดง ${data.length} จาก ${allSummary.length} คน`;
}

// Filters
document.getElementById('searchName').addEventListener('input', renderTable);
document.getElementById('filterDept').addEventListener('change', renderTable);
document.getElementById('filterStatus').addEventListener('change', renderTable);

// Sort headers
document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const key = btn.dataset.sort;
        if (currentSort.key === key) {
            currentSort.dir = currentSort.dir === 'desc' ? 'asc' : 'desc';
        } else {
            currentSort = { key, dir: 'desc' };
        }
        renderTable();
    });
});

// ---- Chart ----
function renderChart() {
    let data = [...allSummary].filter(s => s.assignment_count > 0);

    const dept = document.getElementById('chartDept').value;
    if (dept) data = data.filter(s => s.department === dept);

    const sortDir = document.getElementById('chartSort').value;
    data.sort((a, b) => sortDir === 'desc' ? b.assignment_count - a.assignment_count : a.assignment_count - b.assignment_count);

    // Limit to top 60 for readability
    if (data.length > 60) data = data.slice(0, 60);

    const avg = analysisData.avg_assignments;
    const colors = data.map(s =>
        s.assignment_count > avg * 1.5 ? '#ef4444' :
        s.assignment_count > avg ? '#f59e0b' : '#22c55e'
    );

    if (chartInstance) chartInstance.destroy();

    const canvas = document.getElementById('assignmentChart');
    const container = document.getElementById('chartContainer');
    container.style.height = Math.max(400, data.length * 22) + 'px';

    chartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: data.map(s => s.name),
            datasets: [{
                label: 'จำนวนครั้งที่ได้รับมอบหมาย',
                data: data.map(s => s.assignment_count),
                backgroundColor: colors,
                borderRadius: 3,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: (ctx) => {
                            const s = data[ctx.dataIndex];
                            return `กลุ่มสาระ: ${s.department}` + (s.admin_role ? `\nตำแหน่งบริหาร: ${s.admin_role}` : '');
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    title: { display: true, text: 'จำนวนครั้ง' },
                },
                y: {
                    ticks: { font: { size: 11 } },
                }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    showPerson(data[elements[0].index].name);
                }
            }
        }
    });
}

document.getElementById('chartDept').addEventListener('change', renderChart);
document.getElementById('chartSort').addEventListener('change', renderChart);

// ---- Never Assigned ----
function renderNeverAssigned() {
    const never = allSummary.filter(s => s.assignment_count === 0);
    const byDept = {};
    never.forEach(s => {
        if (!byDept[s.department]) byDept[s.department] = [];
        byDept[s.department].push(s);
    });

    let html = `<p class="text-lg font-semibold mb-4 text-red-600">พบ ${never.length} คน ที่ไม่เคยปรากฏในคำสั่งที่อัปโหลด</p>`;

    if (never.length === 0) {
        html = '<p class="text-green-600 font-semibold">✅ ทุกคนได้รับมอบหมายงานอย่างน้อย 1 ครั้ง</p>';
    } else {
        for (const [dept, people] of Object.entries(byDept).sort()) {
            html += `<div class="mb-4">
                <h4 class="font-semibold text-gray-700 mb-2">${dept} (${people.length} คน)</h4>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                    ${people.map(p => `
                        <div class="bg-red-50 rounded-lg px-3 py-2 text-sm flex justify-between items-center">
                            <span>${p.name}</span>
                            <span class="text-xs text-gray-400">${p.position}</span>
                        </div>
                    `).join('')}
                </div>
            </div>`;
        }
    }

    document.getElementById('neverList').innerHTML = html;
}

// ---- Department Stats ----
function renderDeptStats() {
    const stats = analysisData.dept_stats;
    let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">';

    const sorted = Object.entries(stats).sort((a, b) => b[1].avg_assignments - a[1].avg_assignments);

    for (const [dept, s] of sorted) {
        const pct = s.total_staff > 0 ? Math.round(s.assigned_count / s.total_staff * 100) : 0;
        html += `<div class="bg-gray-50 rounded-lg p-4">
            <h4 class="font-semibold text-gray-800 mb-2">${dept}</h4>
            <div class="grid grid-cols-2 gap-2 text-sm">
                <div>บุคลากรทั้งหมด: <b>${s.total_staff}</b></div>
                <div>ได้รับมอบหมาย: <b>${s.assigned_count}</b> (${pct}%)</div>
                <div>รวมทุกรายการ: <b>${s.total_assignments}</b></div>
                <div>เฉลี่ย/คน: <b>${s.avg_assignments}</b></div>
            </div>
            <div class="mt-2 w-full bg-gray-200 rounded-full h-2">
                <div class="bg-blue-500 h-2 rounded-full" style="width:${pct}%"></div>
            </div>
        </div>`;
    }

    html += '</div>';
    document.getElementById('deptStats').innerHTML = html;
}

// ---- Person Detail Modal ----
function showPerson(name) {
    const person = allSummary.find(s => s.name === name);
    if (!person) return;

    document.getElementById('modalName').textContent = person.name;

    let html = `
        <div class="grid grid-cols-2 gap-2 text-sm mb-4">
            <div><b>กลุ่มสาระ:</b> ${person.department}</div>
            <div><b>ตำแหน่ง:</b> ${person.position}</div>
            ${person.admin_role ? `<div class="col-span-2"><b>ตำแหน่งบริหาร:</b> <span class="badge-admin px-2 py-0.5 rounded">${person.admin_role}</span></div>` : ''}
            <div class="col-span-2"><b>จำนวนครั้งที่ได้รับมอบหมาย:</b> <span class="text-xl font-bold">${person.assignment_count}</span></div>
        </div>
    `;

    if (person.assignments && person.assignments.length > 0) {
        // Group by order number
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
                <table class="w-full text-xs">
                    <thead><tr class="text-gray-400"><th class="text-left py-1">วันที่</th><th class="text-left py-1">หน้าที่</th><th class="text-left py-1">ไฟล์</th></tr></thead>
                    <tbody>
                        ${group.entries.map(e => `
                            <tr class="border-t">
                                <td class="py-1">${e.duty_date || '-'}</td>
                                <td class="py-1">${e.duty_section || '-'}</td>
                                <td class="py-1 text-gray-400">${e.source_file || '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`;
        }
        html += '</div>';
    } else {
        html += '<p class="text-gray-400 italic">ไม่พบรายการที่ได้รับมอบหมายในไฟล์ที่อัปโหลด</p>';
    }

    document.getElementById('modalContent').innerHTML = html;
    personModal.classList.remove('hidden');
}

closeModal.addEventListener('click', () => personModal.classList.add('hidden'));
personModal.addEventListener('click', e => {
    if (e.target === personModal) personModal.classList.add('hidden');
});

// ---- Init: Load staff count ----
fetch('/api/staff')
    .then(r => r.json())
    .then(d => {
        document.getElementById('staffCount').innerHTML = `<b>${d.total}</b> บุคลากร | <b>${d.departments.length}</b> กลุ่มสาระ`;
    });
