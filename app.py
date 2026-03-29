# -*- coding: utf-8 -*-
"""
Flask backend for the workload analysis system.
"""

import os
import uuid
import json
from flask import Flask, request, jsonify, render_template, send_from_directory
from werkzeug.utils import secure_filename

from parser.pdf_extractor import extract_text_from_pdf
from parser.data_parser import parse_assignments
from parser.workload_analyzer import analyze_workload_fairness
from parser.scheduler import schedule_proctoring, schedule_assignment
from staff_data import get_staff_dict, get_all_names, get_departments, STAFF_LIST

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'uploads')

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)


@app.errorhandler(500)
def handle_500(e):
    return jsonify({'error': f'เซิร์ฟเวอร์ผิดพลาด: {str(e)}'}), 500


@app.errorhandler(413)
def handle_413(e):
    return jsonify({'error': 'ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 50MB)'}), 413


@app.errorhandler(404)
def handle_404(e):
    if request.path.startswith('/api/'):
        return jsonify({'error': 'ไม่พบ endpoint นี้'}), 404
    return e


@app.route('/favicon.ico')
def favicon():
    return '', 204

# In-memory storage for uploaded results
analysis_store = {}

ALLOWED_EXTENSIONS = {'pdf'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/health')
def health():
    return jsonify({'status': 'ok'})


@app.route('/api/staff', methods=['GET'])
def get_staff():
    """Return the full staff list with departments."""
    staff = []
    for name, dept, pos, admin in STAFF_LIST:
        staff.append({
            'name': name,
            'department': dept,
            'position': pos,
            'admin_role': admin,
        })
    return jsonify({
        'staff': staff,
        'total': len(staff),
        'departments': get_departments(),
    })


@app.route('/api/upload', methods=['POST'])
def upload_files():
    """Upload and parse PDF files."""
    if 'files' not in request.files:
        return jsonify({'error': 'ไม่พบไฟล์ที่อัปโหลด'}), 400

    files = request.files.getlist('files')
    if not files or all(f.filename == '' for f in files):
        return jsonify({'error': 'กรุณาเลือกไฟล์ PDF'}), 400

    results = []
    session_id = str(uuid.uuid4())

    for f in files:
        if not f or f.filename == '':
            continue
        if not allowed_file(f.filename):
            results.append({
                'filename': f.filename,
                'error': 'ไฟล์ต้องเป็น PDF เท่านั้น',
                'success': False,
            })
            continue

        # Save file temporarily
        safe_name = secure_filename(f.filename) or f'{uuid.uuid4()}.pdf'
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], f'{uuid.uuid4()}_{safe_name}')
        f.save(filepath)

        try:
            # Extract text
            extracted = extract_text_from_pdf(filepath)

            if not extracted['is_readable']:
                results.append({
                    'filename': f.filename,
                    'error': 'ไม่สามารถอ่านข้อความได้ แม้ใช้ OCR แล้ว (PDF อาจเป็นไฟล์สแกนคุณภาพต่ำหรือเข้ารหัส)',
                    'success': False,
                    'page_count': extracted['page_count'],
                    'method': extracted.get('method', 'unknown'),
                })
                continue

            # Parse assignments
            parsed = parse_assignments(extracted['text'], f.filename)

            results.append({
                'filename': f.filename,
                'success': True,
                'order_info': parsed['order_info'],
                'unique_count': parsed['unique_count'],
                'total_assignments': parsed['total_assignments'],
                'assignments': parsed['assignments'],
                'unique_staff': parsed['unique_staff'],
                'page_count': extracted['page_count'],
                'method': extracted.get('method', 'pdfplumber'),
            })

        except Exception as e:
            results.append({
                'filename': f.filename,
                'error': f'เกิดข้อผิดพลาด: {str(e)}',
                'success': False,
            })
        finally:
            # Clean up uploaded file
            try:
                os.remove(filepath)
            except OSError:
                pass

    # Store results in memory
    analysis_store[session_id] = results

    return jsonify({
        'session_id': session_id,
        'results': results,
        'files_processed': len(results),
    })


@app.route('/api/analyze', methods=['POST'])
def analyze():
    """Analyze all uploaded files and produce comprehensive fairness summary."""
    data = request.get_json()
    if not data or 'results' not in data:
        return jsonify({'error': 'ไม่พบข้อมูลสำหรับวิเคราะห์'}), 400

    results = data['results']
    staff_dict = get_staff_dict()
    all_names = get_all_names()

    # Aggregate assignments per person
    person_assignments = {}  # name -> list of assignments
    all_assignments = []  # flat list
    for file_result in results:
        if not file_result.get('success'):
            continue
        for assignment in file_result.get('assignments', []):
            name = assignment['name']
            if name not in person_assignments:
                person_assignments[name] = []
            entry = {
                'order_number': assignment.get('order_number', ''),
                'order_subject': assignment.get('order_subject', ''),
                'order_date': assignment.get('order_date', ''),
                'duty_date': assignment.get('duty_date', ''),
                'duty_time': assignment.get('duty_time', ''),
                'duration_hours': assignment.get('duration_hours', 0),
                'duty_section': assignment.get('duty_section', ''),
                'source_file': assignment.get('source_file', ''),
            }
            person_assignments[name].append(entry)
            all_assignments.append(entry)

    # Build summary per person
    summary = []
    for name, dept_info in staff_dict.items():
        assignments = person_assignments.get(name, [])
        summary.append({
            'name': name,
            'department': dept_info['department'],
            'position': dept_info['position'],
            'admin_role': dept_info['admin_role'],
            'assignment_count': len(assignments),
            'assignments': assignments,
            'unique_orders': list(set(a['order_number'] for a in assignments if a['order_number'])),
        })

    # Run comprehensive fairness analysis
    analysis = analyze_workload_fairness(summary, all_assignments)

    # Sort by weighted score (high to low)
    analysis['summary'].sort(key=lambda x: x.get('total_weighted_score', 0), reverse=True)

    # People never assigned
    never_assigned = [s for s in analysis['summary'] if s['assignment_count'] == 0]
    assigned = [s for s in analysis['summary'] if s['assignment_count'] > 0]

    # Store for scheduler
    global last_analysis_summary
    last_analysis_summary = analysis['summary']

    return jsonify({
        'summary': analysis['summary'],
        'total_staff': len(analysis['summary']),
        'total_assigned': len(assigned),
        'total_never_assigned': len(never_assigned),
        'never_assigned': never_assigned,
        'dept_stats': analysis['dept_fairness'],
        'fairness': analysis['fairness'],
        'work_group_distribution': analysis['work_group_distribution'],
        'max_assignments': max((s['assignment_count'] for s in analysis['summary']), default=0),
        'min_assignments': min((s['assignment_count'] for s in assigned), default=0),
        'avg_assignments': round(
            sum(s['assignment_count'] for s in analysis['summary']) / max(len(analysis['summary']), 1), 1
        ),
    })


# In-memory: store last analysis summary for scheduling
last_analysis_summary = []


@app.route('/api/schedule/proctor', methods=['POST'])
def schedule_proctor():
    """Generate a fair proctoring schedule."""
    config = request.get_json()
    if not config:
        return jsonify({'error': 'ไม่พบข้อมูลการตั้งค่า'}), 400

    result = schedule_proctoring(config, last_analysis_summary or None)
    return jsonify(result)


@app.route('/api/schedule/assign', methods=['POST'])
def schedule_assign():
    """Generate a fair general task assignment."""
    config = request.get_json()
    if not config:
        return jsonify({'error': 'ไม่พบข้อมูลการตั้งค่า'}), 400

    result = schedule_assignment(config, last_analysis_summary or None)
    if 'error' in result:
        return jsonify(result), 400
    return jsonify(result)


if __name__ == '__main__':
    import sys
    debug = '--debug' in sys.argv or os.environ.get('FLASK_DEBUG', '0') == '1'
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=debug, host='0.0.0.0', port=port)
