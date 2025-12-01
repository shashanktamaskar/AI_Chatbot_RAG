"""Agricultural advisory Flask app: chat (RAG), image scan, plant classification.
Clean consolidated implementation replacing prior corrupted refactor state."""
from __future__ import annotations

import os, time, json, re, glob, io, logging
from typing import List, Dict, Any

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from PIL import Image

from google import genai
from google.genai import types

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# ----------------------------------------------------------------------------
# Configuration / Constants
# ----------------------------------------------------------------------------
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'doc', 'docx', 'jpg', 'jpeg', 'png'}
IMAGE_EXTENSIONS = {'jpg', 'jpeg', 'png'}

AGRICULTURAL_INSTRUCTIONS = {
    'english': (
        'You are an expert agricultural advisor for sugarcane farmers in India. '
        'Answer briefly with practical steps and clear structure.'
    )
}

api_key = os.getenv('GOOGLE_API_KEY')
client = None
FILE_SEARCH_STORE = None
if api_key:
    try:
        client = genai.Client(api_key=api_key)
        FILE_SEARCH_STORE = client.file_search_stores.create()
        logger.info(f'Initialized Gemini file store: {FILE_SEARCH_STORE.name}')
    except Exception as e:  # pragma: no cover
        logger.error(f'Failed to initialize Gemini client: {e}')
else:
    logger.warning('GOOGLE_API_KEY missing; AI features degraded.')

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def ensure_file_search_store():
    global FILE_SEARCH_STORE
    if client is None:
        raise RuntimeError('GOOGLE_API_KEY not configured')
    if FILE_SEARCH_STORE is None:
        FILE_SEARCH_STORE = client.file_search_stores.create()
    return FILE_SEARCH_STORE

def upload_file_to_store(path: str) -> bool:
    try:
        store = ensure_file_search_store()
        op = client.file_search_stores.upload_to_file_search_store(
            file_search_store_name=store.name,
            file=path
        )
        while not getattr(op, 'done', True):
            time.sleep(1)
            op = client.operations.get(op.name)
        return True
    except Exception as e:  # pragma: no cover
        logger.warning(f'Upload to store failed for {path}: {e}')
        return False

def load_reference_images(category: str, max_images: int = 2) -> List[Dict[str, Any]]:
    folder = os.path.join('knowledge_base', 'plant_images', category)
    if not os.path.isdir(folder):
        return []
    paths: List[str] = []
    for ext in ('*.jpg', '*.jpeg', '*.png'):
        paths.extend(glob.glob(os.path.join(folder, ext)))
    paths = paths[:max_images]
    images = []
    for p in paths:
        try:
            with open(p, 'rb') as f:
                images.append({'data': f.read(), 'filename': os.path.basename(p)})
        except Exception as e:  # pragma: no cover
            logger.warning(f'Failed to read reference image {p}: {e}')
    return images

# ----------------------------------------------------------------------------
# Routes
# ----------------------------------------------------------------------------
@app.route('/')
def index():
    # Render the template normally now that `templates/index.html` is the canonical UI.
    # This allows Flask to serve static assets and ensures the full-width template is used.
    return render_template('index.html')


@app.route('/_template_info')
def _template_info():
    """Debug helper: return which templates/index.html path is being read and its mtime."""
    try:
        tpl_path = os.path.join(app.root_path, 'templates', 'index.html')
        stat = os.stat(tpl_path)
        with open(tpl_path, 'r', encoding='utf-8') as f:
            head = f.read(512)
        return jsonify({'tpl_path': tpl_path, 'size': stat.st_size, 'mtime': stat.st_mtime, 'head': head}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health')
def health():
    if not api_key:
        return jsonify({'status': 'unhealthy', 'error': 'GOOGLE_API_KEY missing'}), 500
    return jsonify({'status': 'healthy', 'file_search_store_initialized': bool(FILE_SEARCH_STORE)}), 200

@app.route('/upload', methods=['POST'])
def upload():
    if 'files' not in request.files:
        return jsonify({'error': 'No files provided'}), 400
    files = request.files.getlist('files')
    if not files or files[0].filename == '':
        return jsonify({'error': 'No files selected'}), 400
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    uploaded, errors = [], []
    for f in files:
        if not allowed_file(f.filename):
            errors.append(f'{f.filename}: type not allowed')
            continue
        fname = secure_filename(f.filename)
        path = os.path.join(app.config['UPLOAD_FOLDER'], fname)
        try:
            f.save(path)
            upload_file_to_store(path)
            uploaded.append(fname)
        except Exception as e:  # pragma: no cover
            errors.append(f'{fname}: {e}')
    if not uploaded:
        return jsonify({'error': 'No files uploaded', 'details': errors}), 400
    return jsonify({'message': f'Uploaded {len(uploaded)} file(s)', 'uploaded': uploaded, 'errors': errors}), 200

@app.route('/ask', methods=['POST'])
def ask():
    if not request.json:
        return jsonify({'error': 'JSON body required'}), 400
    question = (request.json.get('question', '') or '').strip()
    lang = request.json.get('language', 'english').lower()
    if not question:
        return jsonify({'error': 'Question cannot be empty'}), 400
    instruction = AGRICULTURAL_INSTRUCTIONS.get(lang, AGRICULTURAL_INSTRUCTIONS['english'])
    try:
        store = ensure_file_search_store()
        resp = client.models.generate_content(
            model='gemini-3-pro-preview',
            contents=f'{instruction}\n\nUser Question: {question}',
            config=types.GenerateContentConfig(
                tools=[types.Tool(file_search=types.FileSearch(file_search_store_names=[store.name]))]
            )
        )
        if not resp.candidates:
            return jsonify({'error': 'No response generated'}), 500
        return jsonify({'response': resp.text or 'No answer'}), 200
    except Exception as e:  # pragma: no cover
        logger.error(f'/ask error: {e}')
        return jsonify({'error': 'Failed to process question'}), 500

@app.route('/scan-image', methods=['POST'])
def scan_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400
    image_file = request.files['file']
    if image_file.filename == '':
        return jsonify({'error': 'Empty filename'}), 400
    ext = image_file.filename.rsplit('.', 1)[-1].lower()
    if ext not in IMAGE_EXTENSIONS:
        return jsonify({'error': f'Unsupported type {ext}'}), 400
    lang = request.form.get('language', 'english').lower()
    user_prompt = (request.form.get('prompt', '') or '').strip()
    instruction = AGRICULTURAL_INSTRUCTIONS.get(lang, AGRICULTURAL_INSTRUCTIONS['english'])
    img_bytes = image_file.read()
    if not img_bytes:
        return jsonify({'error': 'Empty image data'}), 400
    guidance = f"User focus: '{user_prompt}'\n" if user_prompt else ''
    prompt = (
        f"{instruction}\n\n"
        "Analyze the agricultural crop image and output ONLY JSON.\n"
        f"{guidance}"
        "Schema: {\n"
        "  \"summary\": \"1-2 sentence overview\",\n"
        "  \"diagnosis\": [\"diseases/pests or 'None detected'\"],\n"
        "  \"severity\": \"mild|moderate|severe|unknown\",\n"
        "  \"recommendations\": [\"actionable treatment steps\"],\n"
        "  \"preventive_measures\": [\"future prevention\"],\n"
        "  \"confidence\": \"high|medium|low\",\n"
        "  \"uncertainty_notes\": \"explain uncertainty\"\n"
        "}\nRules: no markdown, target language, use 'None detected' if healthy."
    )
    try:
        store = ensure_file_search_store()
        resp = client.models.generate_content(
            model='gemini-3-pro-preview',
            contents=[types.Content(parts=[
                types.Part(text=prompt),
                types.Part(inline_data=types.Blob(mime_type=image_file.content_type or 'image/jpeg', data=img_bytes))
            ])],
            config=types.GenerateContentConfig(
                tools=[types.Tool(file_search=types.FileSearch(file_search_store_names=[store.name]))]
            )
        )
    except Exception as e:  # pragma: no cover
        logger.error(f'Vision call failed: {e}')
        return jsonify({'error': 'Model call failed'}), 500
    if not resp.candidates:
        return jsonify({'error': 'No model candidates'}), 500
    raw_text = resp.text or ''
    m = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw_text, re.DOTALL)
    candidate = m.group(1) if m else raw_text.strip()
    try:
        data = json.loads(candidate)
    except Exception:
        first_line = raw_text.split('\n')[0][:180]
        data = { "severity": "unknown",
            'summary': first_line or 'Analysis unavailable',
            'diagnosis': ['None detected'],
            'severity': 'unknown',
            'recommendations': [],
            'preventive_measures': [],
            'confidence': 'medium',
            'uncertainty_notes': ''
        }
    def to_list(v):
        if isinstance(v, list): return v
        if isinstance(v, str) and v.strip(): return [v.strip()]
        return []
    data['diagnosis'] = to_list(data.get('diagnosis')) or ['None detected']
    data['recommendations'] = to_list(data.get('recommendations'))
    data['preventive_measures'] = to_list(data.get('preventive_measures'))
    for k, default in {'summary': 'Analysis unavailable', 'severity': 'unknown', 'confidence': 'medium', 'uncertainty_notes': ''}.items():
        data.setdefault(k, default)
    barren = (len(data['diagnosis']) == 1 and data['diagnosis'][0].lower().startswith('none') and not data['recommendations'] and not data['preventive_measures'])
    if barren and user_prompt:
        logger.info('Retrying barren analysis once due to user-specific prompt')
        retry_prompt = prompt + '\nRe-check subtle early-stage issues; add at least one recommendation if appropriate. Do NOT invent diseases.'
        try:
            retry = client.models.generate_content(
                model='gemini-3-pro-preview',
                contents=[types.Content(parts=[
                    types.Part(text=retry_prompt),
                    types.Part(inline_data=types.Blob(mime_type=image_file.content_type or 'image/jpeg', data=img_bytes))
                ])]
            )
            if retry.text and retry.text != raw_text and len(retry.text) > 50:
                raw_text = retry.text
        except Exception as re_err:  # pragma: no cover
            logger.warning(f'Retry failed: {re_err}')
    return jsonify({**data, 'prompt_used': user_prompt, 'raw_text': raw_text}), 200

@app.route('/classify-plant', methods=['POST'])
def classify_plant():
    if client is None:
        return jsonify({'error': 'AI unavailable'}), 503
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400
    image_file = request.files['image']
    if image_file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    image_bytes = image_file.read()
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.verify()
    except Exception:
        return jsonify({'error': 'Invalid image file'}), 400
    refs_sugarcane = load_reference_images('sugarcane')
    refs_weeds = load_reference_images('weeds')
    prompt = (
        'Classify the query image strictly as ONE of: sugarcane, weed, unknown.\n'
        'Return JSON ONLY: {\n'
        '  "classification": "sugarcane|weed|unknown",\n'
        '  "confidence": <float 0-1>,\n'
        '  "plant_type": "specific name if identifiable",\n'
        '  "details": "brief classification reasoning",\n'
        '  "characteristics": "key visual traits",\n'
        '  "recommendation": "weed removal or sugarcane care advice"\n'
        '}\nBe precise; stalk with segmented joints + long leaves -> sugarcane; any other plant growth among cane -> weed; unclear -> unknown.'
    )
    parts = [types.Part(text=prompt)]
    for r in refs_sugarcane:
        parts.append(types.Part(inline_data=types.Blob(mime_type='image/jpeg', data=r['data'])))
        parts.append(types.Part(text=f'[Reference Sugarcane {r["filename"]}]'))
    for r in refs_weeds:
        parts.append(types.Part(inline_data=types.Blob(mime_type='image/jpeg', data=r['data'])))
        parts.append(types.Part(text=f'[Reference Weed {r["filename"]}]'))
    parts.append(types.Part(text='[QUERY IMAGE]'))
    parts.append(types.Part(inline_data=types.Blob(mime_type=image_file.content_type or 'image/jpeg', data=image_bytes)))
    resp = client.models.generate_content(model='gemini-2.0-flash-exp', contents=[types.Content(parts=parts)])
    raw = (resp.text or '').strip()
    jm = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, re.DOTALL)
    jtxt = jm.group(1) if jm else raw
    try:
        data = json.loads(jtxt)
    except Exception:
        data = {
            'classification': 'unknown',
            'confidence': 0.5,
            'plant_type': 'Unknown',
            'details': raw,
            'characteristics': 'Parsing failed',
            'recommendation': 'Retry with clearer image'
        }
    return jsonify({'success': True, **data, 'raw_response': raw}), 200

@app.route('/webhook', methods=['POST'])
def webhook():
    data = request.get_json(force=True, silent=True) or {}
    chat_text = data.get('chat') or data.get('message') or ''
    if not chat_text:
        return jsonify({'error': 'Chat text required'}), 400
    lang = data.get('language', 'english').lower()
    instruction = AGRICULTURAL_INSTRUCTIONS.get(lang, AGRICULTURAL_INSTRUCTIONS['english'])
    try:
        store = ensure_file_search_store()
        resp = client.models.generate_content(
            model='gemini-3-pro-preview',
            contents=f'{instruction}\n\nUser Chat: {chat_text}',
            config=types.GenerateContentConfig(
                tools=[types.Tool(file_search=types.FileSearch(file_search_store_names=[store.name]))]
            )
        )
        if not resp.candidates:
            return jsonify({'error': 'No response'}), 500
        return jsonify({'response': resp.text or 'No answer', 'status': 'success'}), 200
    except Exception as e:  # pragma: no cover
        logger.error(f'Webhook error: {e}')
        return jsonify({'error': 'Failed'}), 500

# ----------------------------------------------------------------------------
# Error Handlers
# ----------------------------------------------------------------------------
@app.errorhandler(413)
def too_large(e):  # pragma: no cover
    return jsonify({'error': 'File too large (max 50MB)'}), 413

@app.errorhandler(404)
def not_found(e):  # pragma: no cover
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(e):  # pragma: no cover
    logger.error(f'Internal server error: {e}')
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':  # pragma: no cover
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)