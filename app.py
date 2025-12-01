"""Agricultural advisory Flask app: chat (RAG), image scan, plant classification.
Clean consolidated implementation replacing prior corrupted refactor state."""
from __future__ import annotations

import os, time, json, re, glob, io, logging
from typing import List, Dict, Any

from flask import Flask, render_template, request, jsonify, send_from_directory
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
        'Answer briefly with practical steps and clear structure. '
        'IMPORTANT: Always respond in English only, regardless of the language used in the question.'
    ),
    'hindi': (
        'आप भारत में गन्ना किसानों के लिए एक विशेषज्ञ कृषि सलाहकार हैं। '
        'व्यावहारिक चरणों और स्पष्ट संरचना के साथ संक्षेप में उत्तर दें। '
        'अति महत्वपूर्ण: प्रश्न किसी भी भाषा में हो, आपको हमेशा केवल हिंदी देवनागरी लिपि में ही जवाब देना है। '
        'अंग्रेजी शब्दों या रोमन लिपि का उपयोग बिल्कुल न करें। केवल देवनागरी हिंदी में लिखें। '
        'उदाहरण: "namaskar" नहीं, "नमस्कार" लिखें। "kisan" नहीं, "किसान" लिखें।'
    ),
    'marathi': (
        'तुम्ही भारतातील ऊस शेतकऱ्यांसाठी तज्ञ कृषी सल्लागार आहात. '
        'व्यावहारिक चरणे आणि स्पष्ट रचनेसह थोडक्यात उत्तर द्या. '
        'अति महत्त्वाचे: प्रश्न कोणत्याही भाषेत असला तरी, तुम्ही नेहमी फक्त मराठी देवनागरी लिपीत उत्तर द्यावे. '
        'इंग्रजी शब्द किंवा रोमन लिपि वापरू नका. फक्त देवनागरी मराठीत लिहा.'
    ),
    'tamil': (
        'நீங்கள் இந்தியாவில் கரும்பு விவசாயிகளுக்கான நிபுணர் விவசாய ஆலோசகர். '
        'நடைமுறை படிகள் மற்றும் தெளிவான அமைப்புடன் சுருக்கமாக பதிலளிக்கவும். '
        'மிக முக்கியம்: கேள்வி எந்த மொழியில் இருந்தாலும், நீங்கள் எப்போதும் தமிழ் எழுத்துக்களில் மட்டுமே பதிலளிக்க வேண்டும். '
        'ஆங்கில வார்த்தைகள் அல்லது ரோமன் எழுத்துக்களைப் பயன்படுத்த வேண்டாம். தமிழ் எழுத்துக்களில் மட்டுமே எழுதவும்.'
    ),
    'telugu': (
        'మీరు భారతదేశంలో చెరకు రైతులకు నిపుణుడైన వ్యవసాయ సలహాదారు. '
        'ఆచరణాత్మక దశలు మరియు స్పష్టమైన నిర్మాణంతో క్లుప్తంగా సమాధానం ఇవ్వండి. '
        'అతి ముఖ్యం: ప్రశ్న ఏ భాషలో ఉన్నా, మీరు ఎల్లప్పుడూ తెలుగు లిపిలో మాత్రమే సమాధానం ఇవ్వాలి. '
        'ఆంగ్ల పదాలు లేదా రోమన్ లిపిని ఉపయోగించవద్దు. తెలుగు లిపిలో మాత్రమే వ్రాయండి.'
    ),
    'kannada': (
        'ನೀವು ಭಾರತದಲ್ಲಿ ಕಬ್ಬು ರೈತರಿಗೆ ತಜ್ಞ ಕೃಷಿ ಸಲಹೆಗಾರರು. '
        'ಪ್ರಾಯೋಗಿಕ ಹಂತಗಳು ಮತ್ತು ಸ್ಪಷ್ಟ ರಚನೆಯೊಂದಿಗೆ ಸಂಕ್ಷಿಪ್ತವಾಗಿ ಉತ್ತರಿಸಿ. '
        'ಅತ್ಯಂತ ಮುಖ್ಯ: ಪ್ರಶ್ನೆ ಯಾವ ಭಾಷೆಯಲ್ಲಿದ್ದರೂ, ನೀವು ಯಾವಾಗಲೂ ಕನ್ನಡ ಲಿಪಿಯಲ್ಲಿ ಮಾತ್ರ ಉತ್ತರಿಸಬೇಕು. '
        'ಇಂಗ್ಲಿಷ್ ಪದಗಳು ಅಥವಾ ರೋಮನ್ ಲಿಪಿ ಬಳಸಬೇಡಿ. ಕನ್ನಡ ಲಿಪಿಯಲ್ಲಿ ಮಾತ್ರ ಬರೆಯಿರಿ.'
    ),
    'gujarati': (
        'તમે ભારતમાં શેરડી ખેડૂતો માટે નિષ્ણાત કૃષિ સલાહકાર છો. '
        'વ્યવહારુ પગલાં અને સ્પષ્ટ માળખા સાથે સંક્ષિપ્તમાં જવાબ આપો. '
        'અત્યંત મહત્વપૂર્ણ: પ્રશ્ન કોઈપણ ભાષામાં હોય, તમારે હંમેશા ફક્ત ગુજરાતી લિપિમાં જ જવાબ આપવો જોઈએ. '
        'અંગ્રેજી શબ્દો અથવા રોમન લિપિનો ઉપયોગ ન કરો. ફક્ત ગુજરાતી લિપિમાં જ લખો.'
    ),
    'punjabi': (
        'ਤੁਸੀਂ ਭਾਰਤ ਵਿੱਚ ਗੰਨੇ ਦੇ ਕਿਸਾਨਾਂ ਲਈ ਇੱਕ ਮਾਹਰ ਖੇਤੀਬਾੜੀ ਸਲਾਹਕਾਰ ਹੋ। '
        'ਵਿਹਾਰਕ ਕਦਮਾਂ ਅਤੇ ਸਪੱਸ਼ਟ ਢਾਂਚੇ ਨਾਲ ਸੰਖੇਪ ਵਿੱਚ ਜਵਾਬ ਦਿਓ। '
        'ਬਹੁਤ ਮਹੱਤਵਪੂਰਨ: ਸਵਾਲ ਕਿਸੇ ਵੀ ਭਾਸ਼ਾ ਵਿੱਚ ਹੋਵੇ, ਤੁਹਾਨੂੰ ਹਮੇਸ਼ਾ ਗੁਰਮੁਖੀ ਲਿਪੀ ਵਿੱਚ ਹੀ ਜਵਾਬ ਦੇਣਾ ਹੈ। '
        'ਅੰਗਰੇਜ਼ੀ ਸ਼ਬਦ ਜਾਂ ਰੋਮਨ ਲਿਪੀ ਨਾ ਵਰਤੋ। ਗੁਰਮੁਖੀ ਵਿੱਚ ਹੀ ਲਿਖੋ।'
    ),
    'bengali': (
        'আপনি ভারতে আখ চাষীদের জন্য একজন বিশেষজ্ঞ কৃষি পরামর্শদাতা। '
        'ব্যবহারিক পদক্ষেপ এবং স্পষ্ট কাঠামোর সাথে সংক্ষিপ্তভাবে উত্তর দিন। '
        'অত্যন্ত গুরুত্বপূর্ণ: প্রশ্ন যেকোনো ভাষায় হোক, আপনাকে সবসময় শুধুমাত্র বাংলা লিপিতে উত্তর দিতে হবে। '
        'ইংরেজি শব্দ বা রোমান লিপি ব্যবহার করবেন না। শুধুমাত্র বাংলা লিপিতে লিখুন।'
    ),
    'malayalam': (
        'നിങ്ങൾ ഇന്ത്യയിലെ കരിമ്പ് കർഷകർക്കുള്ള വിദഗ്ദ്ധ കാർഷിക ഉപദേശകനാണ്. '
        'പ്രായോഗിക ഘട്ടങ്ങളും വ്യക്തമായ ഘടനയും ഉപയോഗിച്ച് ചുരുക്കമായി ഉത്തരം നൽകുക. '
        'അതീവ പ്രധാനം: ചോദ്യം ഏത് ഭാഷയിലായാലും, നിങ്ങൾ എപ്പോഴും മലയാളം ലിപിയിൽ മാത്രം ഉത്തരം നൽകണം. '
        'ഇംഗ്ലീഷ് വാക്കുകളോ റോമൻ ലിപിയോ ഉപയോഗിക്കരുത്. മലയാളം ലിപിയിൽ മാത്രം എഴുതുക.'
    ),
    'odia': (
        'ଆପଣ ଭାରତରେ ଆଖୁ ଚାଷୀମାନଙ୍କ ପାଇଁ ଜଣେ ବିଶେଷଜ୍ଞ କୃଷି ପରାମର୍ଶଦାତା | '
        'ବ୍ୟବହାରିକ ପଦକ୍ଷେପ ଏବଂ ସ୍ପଷ୍ଟ ସଂରଚନା ସହିତ ସଂକ୍ଷେପରେ ଉତ୍ତର ଦିଅନ୍ତୁ | '
        'ଅତ୍ୟଧିକ ଗୁରୁତ୍ୱପୂର୍ଣ୍ଣ: ପ୍ରଶ୍ନ ଯେକୌଣସି ଭାଷାରେ ହେଲେ ମଧ୍ୟ, ଆପଣ ସବୁବେଳେ କେବଳ ଓଡ଼ିଆ ଲିପିରେ ଉତ୍ତର ଦେବା ଉଚିତ୍ | '
        'ଇଂରାଜୀ ଶବ୍ଦ ବା ରୋମାନ୍ ଲିପି ବ୍ୟବହାର କରନ୍ତୁ ନାହିଁ | କେବଳ ଓଡ଼ିଆ ଲିପିରେ ଲେଖନ୍ତୁ |'
    ),
    'assamese': (
        'আপুনি ভাৰতত কুঁহিয়াৰ খেতিয়কসকলৰ বাবে এজন বিশেষজ্ঞ কৃষি পৰামৰ্শদাতা। '
        'ব্যৱহাৰিক পদক্ষেপ আৰু স্পষ্ট গঠনৰ সৈতে সংক্ষিপ্তভাৱে উত্তৰ দিয়ক। '
        'অতি গুৰুত্বপূৰ্ণ: প্ৰশ্ন যিকোনো ভাষাত হওক, আপুনি সদায় কেৱল অসমীয়া লিপিতহে উত্তৰ দিব লাগিব। '
        'ইংৰাজী শব্দ বা ৰোমান লিপি ব্যৱহাৰ নকৰিব। কেৱল অসমীয়া লিপিত লিখক।'
    ),
    'urdu': (
        'آپ ہندوستان میں گنے کے کسانوں کے لیے ماہر زرعی مشیر ہیں۔ '
        'عملی اقدامات اور واضح ڈھانچے کے ساتھ مختصر جواب دیں۔ '
        'انتہائی اہم: سوال کسی بھی زبان میں ہو، آپ کو ہمیشہ صرف اردو رسم الخط میں جواب دینا ہے۔ '
        'انگریزی الفاظ یا رومن رسم الخط استعمال نہ کریں۔ صرف اردو رسم الخط میں لکھیں۔'
    ),
    'hinglish': (
        'You are an expert agricultural advisor for sugarcane farmers in India. '
        'Answer briefly with practical steps and clear structure. '
        'CRITICAL: Always respond in Hinglish (Hindi written in Roman/English script). '
        'Use Hindi words but write them in English letters. '
        'Examples: Write "Namaskar" not "नमस्कार", "Kisan" not "किसान", "Kaise ho" not "कैसे हो", '
        '"Sugarcane ke liye pani bahut zaroori hai" not "गन्ने के लिए पानी बहुत जरूरी है". '
        'NEVER use Devanagari script. Always use Roman script for Hindi words. '
        'This is Hinglish - Hindi language written in English alphabet.'
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
            model='gemini-2.5-flash-lite',
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