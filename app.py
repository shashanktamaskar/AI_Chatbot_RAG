"""
Agricultural Advisory Flask Application
========================================

A comprehensive Flask web application providing AI-powered agricultural advisory
services for sugarcane farmers in India. Features include:

- **RAG-based Q&A**: Retrieval-Augmented Generation using Gemini AI with a
  knowledge base of agricultural documents
- **Image Analysis**: Crop disease identification and plant classification
- **Multi-language Support**: 14 Indian languages including Hindi, Tamil, Telugu, etc.
- **Infographic Generation**: Automatic visual response generation for how-to queries
- **Voice Input/Output**: Speech recognition and text-to-speech capabilities

Architecture:
    - Flask serves as the web framework
    - AI functions are delegated to ai_services module for separation of concerns
    - Gemini API provides LLM and vision capabilities
    - File search store enables RAG functionality

Routes:
    - / : Main application UI
    - /ask : RAG-powered Q&A endpoint
    - /upload : Document upload for knowledge base
    - /scan-image : Crop disease analysis
    - /classify-plant : Plant classification (sugarcane/weed)
    - /generate-infographic : Async infographic generation
    - /webhook : Alternative chat endpoint for webhooks

Author: Shashank Tamaskar
Version: 2.0
"""
from __future__ import annotations

# Standard library imports
import json
import logging
import os
import re
from io import BytesIO
from typing import Optional

# Third-party imports
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from PIL import Image
from werkzeug.utils import secure_filename

# Google Gemini AI imports
from google import genai
from google.genai import types

# Local application imports
import ai_services

# Load environment variables from .env file
load_dotenv()

# ============================================================================
# Logging Configuration
# ============================================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('app_debug.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# ============================================================================
# Configuration / Constants
# ============================================================================
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'doc', 'docx', 'jpg', 'jpeg', 'png'}
IMAGE_EXTENSIONS = {'jpg', 'jpeg', 'png'}

AGRICULTURAL_INSTRUCTIONS = {
    'english': (
        'You are an expert agricultural advisor for sugarcane farmers in India. '
        'Your primary role is to provide clear, practical text answers. '
        'Crucially, you also have a special capability: when a user asks you to "generate an image" or "create an infographic", '
        'your specific task is to provide the detailed text that will be used to create that image. '
        'You MUST NOT state that you cannot create images. Instead, you MUST respond by saying "Certainly! Here is the detailed information for the infographic on [topic]:" '
        'and then provide the complete text content for the visual.'
    )
}

api_key = os.getenv('GOOGLE_API_KEY')
client = None

# Initialize Gemini client
if api_key:
    try:
        client = genai.Client(api_key=api_key)
        logger.info('✅ Initialized Gemini client')
        # Initialize ai_services with client and app
        ai_services.set_client_and_app(client, app, app.config['UPLOAD_FOLDER'])
    except Exception as e:  # pragma: no cover
        logger.error(f'❌ Failed to initialize Gemini client: {e}')
else:
    logger.warning('⚠️ GOOGLE_API_KEY missing; AI features degraded.')

# Global flag to track if knowledge base has been initialized
_KB_INITIALIZED = False

# ============================================================================
# Helper Functions
# ============================================================================

def allowed_file(filename: str) -> bool:
    """Check if file extension is allowed for upload."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ============================================================================
# Routes
# ============================================================================

@app.route('/')
def index():
    """Serve main app."""
    return send_from_directory('templates', 'index.html')

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

@app.before_request
def initialize_on_first_request():
    """Initialize the knowledge base on the first request."""
    global _KB_INITIALIZED
    if not _KB_INITIALIZED and client is not None:
        _KB_INITIALIZED = True
        logger.info("🚀 First request detected - initializing knowledge base...")
        ai_services.initialize_knowledge_base()

@app.route('/health')
def health():
    """Health check endpoint."""
    if not api_key:
        return jsonify({'status': 'unhealthy', 'error': 'GOOGLE_API_KEY missing'}), 500
    return jsonify({'status': 'healthy'}), 200

@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    """Serve uploaded files including generated infographics."""
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/upload', methods=['POST'])
def upload():
    """Upload files to knowledge base."""
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
            ai_services.upload_file_to_store(path)
            uploaded.append(fname)
        except Exception as e:  # pragma: no cover
            errors.append(f'{fname}: {e}')
    if not uploaded:
        return jsonify({'error': 'No files uploaded', 'details': errors}), 400
    return jsonify({'message': f'Uploaded {len(uploaded)} file(s)', 'uploaded': uploaded, 'errors': errors}), 200

@app.route('/ask', methods=['POST'])
def ask():
    """
    Intelligent RAG endpoint using Gemini 3 Pro with automatic response format selection.
    
    The system automatically decides whether to respond with:
    - TEXT: For pleasantries, simple questions, clarifications
    - VISUAL: For how-to processes, schedules, symptoms, comparisons (generates infographic)
    
    Infographics are generated in the user's selected language.
    Response always includes text; visual responses also include infographic_url.
    """
    if not request.json:
        return jsonify({'error': 'JSON body required'}), 400
    question = (request.json.get('question', '') or '').strip()
    lang = request.json.get('language', 'english').lower()
    if not question:
        return jsonify({'error': 'Question cannot be empty'}), 400

    logger.info(f"\n{'='*80}")
    logger.info(f"📝 NEW QUESTION RECEIVED: '{question}'")
    logger.info(f"🌍 Language: {lang}")
    logger.info(f"{'='*80}")

    instruction = AGRICULTURAL_INSTRUCTIONS.get(lang, AGRICULTURAL_INSTRUCTIONS['english'])
    
    try:
        # ========== STEP 1: Classify query type ==========
        logger.info("🔍 [STEP 1] Classifying query type...")
        classification = ai_services.classify_query_type(question)
        response_format = classification.get('format', 'text')
        confidence = classification.get('confidence', 0.5)
        
        logger.info(f"   ✓ Format: {response_format.upper()}")
        logger.info(f"   ✓ Confidence: {confidence:.2f}")
        logger.info(f"   ✓ Reason: {classification.get('reason', 'N/A')}")
        
        # ========== STEP 2: Generate text response with RAG ==========
        logger.info("🤖 [STEP 2] Generating text response with RAG...")
        store = ai_services.ensure_file_search_store()
        
        model_name = 'gemini-2.5-flash-lite'
        resp = client.models.generate_content(
            model=model_name,
            contents=f'{instruction}\n\nUser Question: {question}',
            config=types.GenerateContentConfig(
                tools=[types.Tool(file_search=types.FileSearch(file_search_store_names=[store.name]))]
            )
        )
        
        if not resp.candidates:
            logger.error("❌ No response generated from RAG call")
            return jsonify({'error': 'No response generated'}), 500
        
        raw_text = resp.text or 'No answer'
        logger.info(f"✅ [STEP 2] Text response generated (length: {len(raw_text)} chars)")
        
        # ========== STEP 3: Always return text, allow user to request infographic ==========
        # Users can click a button to generate infographic on demand
        result = {
            'response': raw_text,
            'response_format': 'text',  # Always text first
            'can_generate_infographic': True,  # User can request infographic via button
            'infographic_pending': False  # Never auto-generate
        }
        
        logger.info(f"📝 [STEP 3] Text response ready. User can request infographic via button.")
        logger.info(f"✅ Returning text response")
        return jsonify(result), 200
        
    except Exception as e:
        logger.error(f'/ask error: {e}')
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'error': 'Failed to process question'}), 500


@app.route('/generate-infographic', methods=['POST'])
def generate_infographic():
    """
    Generate an infographic for a given question and content.
    Called asynchronously by the frontend after text response is displayed.
    """
    if not request.json:
        return jsonify({'error': 'JSON body required'}), 400
    
    question = (request.json.get('question', '') or '').strip()
    content = (request.json.get('content', '') or '').strip()
    lang = request.json.get('language', 'english').lower()
    force = bool(request.json.get('force', False))
    
    if not question:
        return jsonify({'error': 'Question cannot be empty'}), 400

    logger.info(f"🎨 Generating infographic for: '{question[:50]}...' in {lang}")
    
    try:
        # If not forced, check cooldown and trigger words to avoid unnecessary API calls
        try:
            on_cooldown = ai_services._infographic_is_on_cooldown(question)
            has_create = bool(re.search(r'\bcreate\b', question or '', re.IGNORECASE))
        except Exception:
            on_cooldown = False
            has_create = False

        if on_cooldown and not force and not has_create:
            logger.info('⏳ Infographic generation skipped: cooldown active')
            return jsonify({'error': 'Infographic generation skipped due to recent similar generation', 'success': False, 'reason': 'cooldown'}), 429

        image_path = ai_services.generate_infographic_image(
            content=content,
            topic=question,
            language=lang,
            force=force
        )
        
        if image_path:
            logger.info(f"✅ Infographic generated: {image_path}")
            return jsonify({
                'infographic_url': f'/uploads/{image_path}',
                'infographic_language': lang,
                'success': True
            }), 200
        else:
            logger.warning("⚠️ Infographic generation returned None")
            return jsonify({
                'error': 'Infographic generation failed',
                'success': False
            }), 500
            
    except Exception as e:
        logger.error(f'/generate-infographic error: {e}')
        return jsonify({'error': str(e), 'success': False}), 500


@app.route('/get-text-version', methods=['POST'])
def get_text_version():
    """
    Return text-only version of a response (for users who prefer text over infographic).
    
    This endpoint re-asks the question but forces text-only response.
    """
    if not request.json:
        return jsonify({'error': 'JSON body required'}), 400
    question = (request.json.get('question', '') or '').strip()
    lang = request.json.get('language', 'english').lower()
    if not question:
        return jsonify({'error': 'Question cannot be empty'}), 400

    logger.info(f"📝 Text version requested for: '{question[:50]}...'")
    
    instruction = AGRICULTURAL_INSTRUCTIONS.get(lang, AGRICULTURAL_INSTRUCTIONS['english'])
    
    try:
        store = ai_services.ensure_file_search_store()
        resp = client.models.generate_content(
            model='gemini-2.5-flash-lite',
            contents=f'{instruction}\n\nUser Question: {question}',
            config=types.GenerateContentConfig(
                tools=[types.Tool(file_search=types.FileSearch(file_search_store_names=[store.name]))]
            )
        )
        
        if not resp.candidates:
            return jsonify({'error': 'No response generated'}), 500
        
        return jsonify({
            'response': resp.text or 'No answer',
            'response_format': 'text',
            'is_fallback': True
        }), 200
        
    except Exception as e:
        logger.error(f'/get-text-version error: {e}')
        return jsonify({'error': 'Failed to get text version'}), 500

@app.route('/scan-image', methods=['POST'])
def scan_image():
    """Analyze agricultural crop images."""
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
        store = ai_services.ensure_file_search_store()
        resp = client.models.generate_content(
            model='gemini-2.5-flash-lite',
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
        parsed = ai_services.parse_json_from_text(candidate)
        if parsed is not None:
            data = parsed
        else:
            raise ValueError('Failed to parse JSON')
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
                model='gemini-2.5-flash-lite',
                contents=[types.Content(parts=[
                    types.Part(text=retry_prompt),
                    types.Part(inline_data=types.Blob(mime_type=image_file.content_type or 'image/jpeg', data=img_bytes))
                ])]
            )
            if retry.text and retry.text != raw_text and len(retry.text) > 50:
                raw_text = retry.text
        except Exception as re_err:  # pragma: no cover
            logger.warning(f'Retry failed: {re_err}')
    out = {**data, 'prompt_used': user_prompt, 'raw_text': raw_text}
    try:
        # Pass user_prompt as original_question to check for showcase triggers
        decision = ai_services.decide_make_infographic(json.dumps(out, ensure_ascii=False), original_question=user_prompt)
        if decision.get('make'):
            image_path = ai_services.generate_infographic_image(json.dumps(out, ensure_ascii=False), decision.get('style', 'simple'))
            if image_path:
                out['infographic_url'] = f'/uploads/{image_path}'
                out['infographic_reason'] = decision.get('reason')
    except Exception as e:
        logger.warning(f'Infographic generation failed in scan-image: {e}')
    return jsonify(out), 200

@app.route('/classify-plant', methods=['POST'])
def classify_plant():
    """Classify plants from images (sugarcane, weed, or unknown)."""
    if client is None:
        return jsonify({'error': 'AI unavailable'}), 503
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400
    image_file = request.files['image']
    if image_file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    image_bytes = image_file.read()
    try:
        img = Image.open(BytesIO(image_bytes))
        img.verify()
    except Exception:
        return jsonify({'error': 'Invalid image file'}), 400
    refs_sugarcane = ai_services.load_reference_images('sugarcane')
    refs_weeds = ai_services.load_reference_images('weeds')
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
    resp = client.models.generate_content(
        model='gemini-2.5-flash-lite',
        contents=[types.Content(parts=parts)],
        config=types.GenerateContentConfig(
            # Use default settings; reasoning-level option removed for compatibility
        )
    )
    raw = (resp.text or '').strip()
    jm = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, re.DOTALL)
    jtxt = jm.group(1) if jm else raw
    try:
        parsed = ai_services.parse_json_from_text(jtxt)
        if parsed is not None:
            data = parsed
        else:
            raise ValueError('Failed to parse JSON')
    except Exception:
        data = {
            'classification': 'unknown',
            'confidence': 0.5,
            'plant_type': 'Unknown',
            'details': raw,
            'characteristics': 'Parsing failed',
            'recommendation': 'Retry with clearer image'
        }
    out = {'success': True, **data, 'raw_response': raw}
    try:
        decision = ai_services.decide_make_infographic(json.dumps(out, ensure_ascii=False))
        if decision.get('make'):
            image_path = ai_services.generate_infographic_image(json.dumps(out, ensure_ascii=False), decision.get('style', 'simple'))
            if image_path:
                out['infographic_url'] = f'/uploads/{image_path}'
                out['infographic_reason'] = decision.get('reason')
    except Exception as e:
        logger.warning(f'Infographic generation failed in classify-plant: {e}')
    return jsonify(out), 200

@app.route('/webhook', methods=['POST'])
def webhook():
    """Alternative chat endpoint for webhooks."""
    data = request.get_json(force=True, silent=True) or {}
    chat_text = data.get('chat') or data.get('message') or ''
    if not chat_text:
        return jsonify({'error': 'Chat text required'}), 400
    lang = data.get('language', 'english').lower()
    instruction = AGRICULTURAL_INSTRUCTIONS.get(lang, AGRICULTURAL_INSTRUCTIONS['english'])
    try:
        store = ai_services.ensure_file_search_store()
        resp = client.models.generate_content(
            model='gemini-2.5-flash-lite',
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

# ============================================================================
# Error Handlers
# ============================================================================

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


# Generic handler to ensure JSON is always returned on unexpected exceptions
@app.errorhandler(Exception)
def handle_uncaught_exception(e):  # pragma: no cover
    # Log full traceback for debugging (server-side only)
    logger.exception('Uncaught exception during request')
    try:
        msg = str(e)
    except Exception:
        msg = 'Internal error'
    # Return a safe JSON error without leaking internal details
    return jsonify({'error': 'internal_server_error', 'message': 'An internal error occurred'}), 500

if __name__ == '__main__':  # pragma: no cover
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
