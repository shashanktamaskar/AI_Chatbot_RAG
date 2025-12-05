// Extracted from templates/index.html <script> block
// The file expects `marked` to be loaded (CDN) before this script runs.

// Utility: Add message to chat
// Enhanced to support infographic display with text fallback option
function addMessage(message, sender, imageData = null, options = {}) {
  const chatbox = document.getElementById("chatbox");
  if (!chatbox) return; // nothing to render into
  const msgDiv = document.createElement("div");
  msgDiv.className = "msg " + (sender || "bot");

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  let content = "";
  if (sender === "user") {
    content = escapeHtml(message);
    if (imageData) {
      content = `<img src="${imageData}" class="msg-image" style="max-width:300px; display:block;" alt="Attached image"><div style="margin-top:8px;">${content}</div>`;
    }
    bubble.innerHTML = `${content} <span class="msg-time">${formatTime()}</span>`;
  } else if (sender === "bot") {
    // Check if we have an infographic to display
    if (options.infographicUrl) {
      // Create infographic container
      const infographicHtml = `
        <div class="infographic-container">
          <img src="${options.infographicUrl}" class="infographic-image" alt="Infographic" onclick="window.open('${options.infographicUrl}', '_blank')">
          <div class="infographic-actions">
            <button class="text-fallback-btn" onclick="requestTextVersion('${escapeHtml(options.originalQuestion || '')}', this)" title="Show text version instead">
              📝 ${t('showTextVersion') || 'Show Text Version'}
            </button>
            <span class="infographic-lang">${options.infographicLanguage ? '🌐 ' + options.infographicLanguage : ''}</span>
          </div>
        </div>
        <div class="text-response collapsed">
          <button class="expand-text-btn" onclick="toggleTextResponse(this)">📄 ${t('expandText') || 'Show Full Text'}</button>
          <div class="text-content">${marked.parse(message)}</div>
        </div>
      `;
      bubble.innerHTML = `${infographicHtml} <span class="msg-time">${formatTime()}</span>`;
    } else {
      // Regular text response
      bubble.innerHTML = `${marked.parse(message)} <span class="msg-time">${formatTime()}</span>`;
    }
  } else if (sender === "error") {
    bubble.innerHTML = `${escapeHtml(message)} <span class="msg-time">${formatTime()}</span>`;
  }

  msgDiv.appendChild(bubble);
  chatbox.appendChild(msgDiv);

  // Smooth scroll to bottom
  if (chatbox.parentElement) {
    try {
      chatbox.parentElement.scrollTop = chatbox.parentElement.scrollHeight;
    } catch (e) {
      // ignore
    }
  }
}

// Toggle text response visibility
function toggleTextResponse(btn) {
  const container = btn.parentElement;
  container.classList.toggle('collapsed');
  const textContent = container.querySelector('.text-content');
  if (container.classList.contains('collapsed')) {
    btn.textContent = '📄 ' + (t('expandText') || 'Show Full Text');
  } else {
    btn.textContent = '📄 ' + (t('collapseText') || 'Hide Text');
  }
}

// Request text-only version of a response
async function requestTextVersion(question, btn) {
  if (!question) return;

  btn.disabled = true;
  btn.textContent = '⏳ ' + (t('loading') || 'Loading...');

  try {
    const response = await fetch('/get-text-version', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question,
        language: getLanguage()
      })
    });

    const data = await response.json();

    if (response.ok && data.response) {
      // Find the infographic container and replace with text
      const container = btn.closest('.infographic-container');
      if (container) {
        const parentBubble = container.closest('.msg-bubble');
        if (parentBubble) {
          parentBubble.innerHTML = `${marked.parse(data.response)} <span class="msg-time">${formatTime()}</span>`;
        }
      }
    } else {
      btn.textContent = '❌ ' + (t('failed') || 'Failed');
      setTimeout(() => {
        btn.textContent = '📝 ' + (t('showTextVersion') || 'Show Text Version');
        btn.disabled = false;
      }, 2000);
    }
  } catch (error) {
    console.error('Text version request failed:', error);
    btn.textContent = '❌ ' + (t('failed') || 'Failed');
    setTimeout(() => {
      btn.textContent = '📝 ' + (t('showTextVersion') || 'Show Text Version');
      btn.disabled = false;
    }, 2000);
  }
}

// Generate infographic asynchronously and add to last message
async function generateInfographicAsync(question, content, lang) {
  // Find the last bot message bubble to update
  const chatbox = document.getElementById("chatbox");
  if (!chatbox) return;

  const botMessages = chatbox.querySelectorAll('.msg.bot');
  if (botMessages.length === 0) return;

  const lastBotMsg = botMessages[botMessages.length - 1];
  const bubble = lastBotMsg.querySelector('.msg-bubble');
  if (!bubble) return;

  // Add loading indicator for infographic
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'infographic-loading';
  loadingDiv.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; padding: 12px; background: rgba(0,128,0,0.1); border-radius: 8px; margin-top: 12px;">
      <div class="spinner" style="width: 16px; height: 16px;"></div>
      <span>🎨 ${t('generatingInfographic') || 'Generating infographic...'}</span>
    </div>
  `;
  bubble.appendChild(loadingDiv);

  try {
    const response = await fetch('/generate-infographic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question,
        content: content,
        language: lang
      })
    });

    const data = await response.json();

    // Remove loading indicator
    loadingDiv.remove();

    if (response.ok && data.infographic_url) {
      // Add infographic to the message
      const infographicHtml = `
        <div class="infographic-container" style="margin-top: 12px;">
          <img src="${data.infographic_url}" class="infographic-image" alt="Infographic" onclick="window.open('${data.infographic_url}', '_blank')">
          <div class="infographic-actions">
            <button class="text-fallback-btn" onclick="requestTextVersion('${escapeHtml(question)}', this)" title="Show text version instead">
              📝 ${t('showTextVersion') || 'Show Text Version'}
            </button>
            <span class="infographic-lang">${data.infographic_language ? '🌐 ' + data.infographic_language : ''}</span>
          </div>
        </div>
      `;
      bubble.insertAdjacentHTML('beforeend', infographicHtml);

      // Scroll to show the infographic
      if (chatbox.parentElement) {
        chatbox.parentElement.scrollTop = chatbox.parentElement.scrollHeight;
      }

      console.log('Infographic added successfully:', data.infographic_url);
    } else {
      // Show error but don't disrupt the text response
      console.error('Infographic generation failed:', data.error);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'infographic-error';
      errorDiv.innerHTML = `
        <div style="padding: 8px; background: rgba(255,0,0,0.1); border-radius: 8px; margin-top: 12px; font-size: 12px; color: #666;">
          ⚠️ ${t('infographicFailed') || 'Infographic generation failed. Text response shown above.'}
        </div>
      `;
      bubble.appendChild(errorDiv);
    }
  } catch (error) {
    console.error('Infographic request failed:', error);
    loadingDiv.remove();
  }
}

function formatTime(d = new Date()) {
  try {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Utility: Escape HTML
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, function (m) {
    return map[m];
  });
}

// Utility: Show loading
function showLoading() {
  const li = document.getElementById("loadingIndicator");
  if (li) {
    li.style.display = "";
    const thinkingSpan = li.querySelector("span:last-child");
    if (thinkingSpan) thinkingSpan.textContent = t("thinking");
  }
}
// Utility: Hide loading
function hideLoading() {
  const li = document.getElementById("loadingIndicator");
  if (li) li.style.display = "none";
}
// Safe JSON parse helper for responses that may not be JSON
async function safeJson(response) {
  try {
    return await response.json();
  } catch (e) {
    return null;
  }
}
// Utility: Get language
function getLanguage() {
  const langSelect = document.getElementById("languageSelect");
  return langSelect ? langSelect.value : "english";
}

// Language codes for speech recognition and synthesis
const languageCodes = {
  english: "en-US",
  hinglish: "hi-IN",
  hindi: "hi-IN",
  marathi: "mr-IN",
  tamil: "ta-IN",
  telugu: "te-IN",
  kannada: "kn-IN",
  gujarati: "gu-IN",
  punjabi: "pa-IN",
  bengali: "bn-IN",
  malayalam: "ml-IN",
  odia: "or-IN",
  assamese: "as-IN",
  urdu: "ur-PK",
};

// UI translations for common messages
const translations = {
  english: {
    listening: "Listening...",
    thinking: "Thinking...",
    askQuestion: "Ask your question...",
    askAboutImage: "Ask about this image...",
    noMicrophone: "No microphone found",
    microphoneBlocked: "Microphone access blocked",
    voiceNotSupported: "Voice input not supported",
    networkError: "Network error",
    uploadFailed: "Upload failed",
    selectValidImage: "Please select a valid image file",
    appTitle: "Sugarcane Advisor",
    appSubtitle: "Expert help for sugarcane farming",
    quickActions: "Quick Actions",
    uploadDoc: "Upload Doc",
    attachImage: "Attach Image",
    newChat: "New Chat",
    loadedFiles: "Loaded Files",
    noFilesLoaded: "No files loaded.",
    help: "Help",
    identifyPlant: "Identify plant",
    darkMode: "Toggle dark mode",
    voice: "Voice",
    send: "Send",
    listen: "🔊 Listen",
    stop: "⏹️ Stop",
    remove: "Remove",
    showTextVersion: "Show Text Version",
    expandText: "Show Full Text",
    collapseText: "Hide Text",
    loading: "Loading...",
    failed: "Failed",
    generatingInfographic: "Generating infographic...",
    infographicFailed: "Infographic generation failed. Text response shown above.",
  },
  hinglish: {
    listening: "Sun raha hai...",
    thinking: "Soch raha hai...",
    askQuestion: "Apna sawal poochiye...",
    askAboutImage: "Is tasveer ke baare mein poochiye...",
    noMicrophone: "Microphone nahi mila",
    microphoneBlocked: "Microphone access block hai",
    voiceNotSupported: "Voice input support nahi hai",
    networkError: "Network error",
    uploadFailed: "Upload fail ho gaya",
    selectValidImage: "Kripya ek valid image file select karein",
    appTitle: "Ganna Salahkar",
    appSubtitle: "Ganne ki kheti ke liye expert madad",
    quickActions: "Jaldi Actions",
    uploadDoc: "Document Upload Karein",
    attachImage: "Image Attach Karein",
    newChat: "Nayi Chat",
    loadedFiles: "Load Ki Gayi Files",
    noFilesLoaded: "Koi file load nahi hui.",
    help: "Madad",
    identifyPlant: "Plant pehchano",
    darkMode: "Dark mode toggle karein",
    voice: "Awaaz",
    send: "Bhejein",
    listen: "🔊 Suniye",
    stop: "⏹️ Rokein",
    remove: "Hatayen",
  },
  hindi: {
    listening: "सुन रहा है...",
    thinking: "सोच रहा है...",
    askQuestion: "अपना सवाल पूछें...",
    askAboutImage: "इस छवि के बारे में पूछें...",
    noMicrophone: "कोई माइक्रोफ़ोन नहीं मिला",
    microphoneBlocked: "माइक्रोफ़ोन एक्सेस अवरुद्ध",
    voiceNotSupported: "वॉइस इनपुट समर्थित नहीं",
    networkError: "नेटवर्क त्रुटि",
    uploadFailed: "अपलोड विफल",
    selectValidImage: "कृपया एक वैध छवि फ़ाइल चुनें",
    appTitle: "गन्ना सलाहकार",
    appSubtitle: "गन्ने की खेती के लिए विशेषज्ञ सहायता",
    quickActions: "त्वरित कार्य",
    uploadDoc: "दस्तावेज़ अपलोड करें",
    attachImage: "छवि संलग्न करें",
    newChat: "नई चैट",
    loadedFiles: "लोड की गई फ़ाइलें",
    noFilesLoaded: "कोई फ़ाइल लोड नहीं की गई।",
    help: "सहायता",
    identifyPlant: "पौधे की पहचान करें",
    darkMode: "डार्क मोड टॉगल करें",
    voice: "आवाज़",
    send: "भेजें",
    listen: "🔊 सुनें",
    stop: "⏹️ रोकें",
    remove: "हटाएं",
  },
  marathi: {
    listening: "ऐकत आहे...",
    thinking: "विचार करत आहे...",
    askQuestion: "तुमचा प्रश्न विचारा...",
    askAboutImage: "या प्रतिमेबद्दल विचारा...",
    noMicrophone: "मायक्रोफोन सापडला नाही",
    microphoneBlocked: "मायक्रोफोन प्रवेश अवरोधित",
    voiceNotSupported: "व्हॉइस इनपुट समर्थित नाही",
    networkError: "नेटवर्क त्रुटी",
    uploadFailed: "अपलोड अयशस्वी",
    selectValidImage: "कृपया वैध प्रतिमा फाइल निवडा",
  },
  tamil: {
    listening: "கேட்கிறது...",
    thinking: "யோசிக்கிறது...",
    askQuestion: "உங்கள் கேள்வியைக் கேளுங்கள்...",
    askAboutImage: "இந்த படத்தைப் பற்றி கேளுங்கள்...",
    noMicrophone: "மைக்ரோஃபோன் கிடைக்கவில்லை",
    microphoneBlocked: "மைக்ரோஃபோன் அணுகல் தடுக்கப்பட்டது",
    voiceNotSupported: "குரல் உள்ளீடு ஆதரிக்கப்படவில்லை",
    networkError: "நெட்வொர்க் பிழை",
    uploadFailed: "பதிவேற்றம் தோல்வியடைந்தது",
    selectValidImage: "சரியான படக் கோப்பைத் தேர்ந்தெடுக்கவும்",
  },
  telugu: {
    listening: "వింటోంది...",
    thinking: "ఆలోచిస్తోంది...",
    askQuestion: "మీ ప్రశ్న అడగండి...",
    askAboutImage: "ఈ చిత్రం గురించి అడగండి...",
    noMicrophone: "మైక్రోఫోన్ కనుగొనబడలేదు",
    microphoneBlocked: "మైక్రోఫోన్ యాక్సెస్ బ్లాక్ చేయబడింది",
    voiceNotSupported: "వాయిస్ ఇన్‌పుట్ మద్దతు లేదు",
    networkError: "నెట్‌వర్క్ లోపం",
    uploadFailed: "అప్‌లోడ్ విఫలమైంది",
    selectValidImage: "దయచేసి చెల్లుబాటు అయ్యే చిత్ర ఫైల్‌ను ఎంచుకోండి",
  },
  kannada: {
    listening: "ಕೇಳುತ್ತಿದೆ...",
    thinking: "ಯೋಚಿಸುತ್ತಿದೆ...",
    askQuestion: "ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಕೇಳಿ...",
    askAboutImage: "ಈ ಚಿತ್ರದ ಬಗ್ಗೆ ಕೇಳಿ...",
    noMicrophone: "ಮೈಕ್ರೊಫೋನ್ ಸಿಗಲಿಲ್ಲ",
    microphoneBlocked: "ಮೈಕ್ರೊಫೋನ್ ಪ್ರವೇಶ ನಿರ್ಬಂಧಿತ",
    voiceNotSupported: "ಧ್ವನಿ ಇನ್‌ಪುಟ್ ಬೆಂಬಲಿತವಾಗಿಲ್ಲ",
    networkError: "ನೆಟ್‌ವರ್ಕ್ ದೋಷ",
    uploadFailed: "ಅಪ್‌ಲೋಡ್ ವಿಫಲವಾಗಿದೆ",
    selectValidImage: "ದಯವಿಟ್ಟು ಮಾನ್ಯ ಚಿತ್ರ ಫೈಲ್ ಆಯ್ಕೆಮಾಡಿ",
  },
  gujarati: {
    listening: "સાંભળી રહ્યું છે...",
    thinking: "વિચારી રહ્યું છે...",
    askQuestion: "તમારો પ્રશ્ન પૂછો...",
    askAboutImage: "આ છબી વિશે પૂછો...",
    noMicrophone: "માઇક્રોફોન મળ્યું નહીં",
    microphoneBlocked: "માઇક્રોફોન ઍક્સેસ અવરોધિત",
    voiceNotSupported: "વૉઇસ ઇનપુટ સપોર્ટેડ નથી",
    networkError: "નેટવર્ક ભૂલ",
    uploadFailed: "અપલોડ નિષ્ફળ",
    selectValidImage: "કૃપા કરીને માન્ય છબી ફાઇલ પસંદ કરો",
  },
  punjabi: {
    listening: "ਸੁਣ ਰਿਹਾ ਹੈ...",
    thinking: "ਸੋਚ ਰਿਹਾ ਹੈ...",
    askQuestion: "ਆਪਣਾ ਸਵਾਲ ਪੁੱਛੋ...",
    askAboutImage: "ਇਸ ਤਸਵੀਰ ਬਾਰੇ ਪੁੱਛੋ...",
    noMicrophone: "ਮਾਈਕ੍ਰੋਫੋਨ ਨਹੀਂ ਮਿਲਿਆ",
    microphoneBlocked: "ਮਾਈਕ੍ਰੋਫੋਨ ਪਹੁੰਚ ਬਲੌਕ ਕੀਤੀ",
    voiceNotSupported: "ਵੌਇਸ ਇਨਪੁੱਟ ਸਮਰਥਿਤ ਨਹੀਂ",
    networkError: "ਨੈੱਟਵਰਕ ਗਲਤੀ",
    uploadFailed: "ਅੱਪਲੋਡ ਅਸਫਲ",
    selectValidImage: "ਕਿਰਪਾ ਕਰਕੇ ਇੱਕ ਵੈਧ ਚਿੱਤਰ ਫਾਈਲ ਚੁਣੋ",
  },
  bengali: {
    listening: "শুনছে...",
    thinking: "ভাবছে...",
    askQuestion: "আপনার প্রশ্ন জিজ্ঞাসা করুন...",
    askAboutImage: "এই ছবি সম্পর্কে জিজ্ঞাসা করুন...",
    noMicrophone: "মাইক্রোফোন পাওয়া যায়নি",
    microphoneBlocked: "মাইক্রোফোন অ্যাক্সেস ব্লক করা হয়েছে",
    voiceNotSupported: "ভয়েস ইনপুট সমর্থিত নয়",
    networkError: "নেটওয়ার্ক ত্রুটি",
    uploadFailed: "আপলোড ব্যর্থ",
    selectValidImage: "অনুগ্রহ করে একটি বৈধ ছবি ফাইল নির্বাচন করুন",
  },
  malayalam: {
    listening: "കേൾക്കുന്നു...",
    thinking: "ചിന്തിക്കുന്നു...",
    askQuestion: "നിങ്ങളുടെ ചോദ്യം ചോദിക്കുക...",
    askAboutImage: "ഈ ചിത്രത്തെക്കുറിച്ച് ചോദിക്കുക...",
    noMicrophone: "മൈക്രോഫോൺ കണ്ടെത്തിയില്ല",
    microphoneBlocked: "മൈക്രോഫോൺ ആക്‌സസ് തടഞ്ഞു",
    voiceNotSupported: "വോയ്‌സ് ഇൻപുട്ട് പിന്തുണയ്ക്കുന്നില്ല",
    networkError: "നെറ്റ്‌വർക്ക് പിശക്",
    uploadFailed: "അപ്‌ലോഡ് പരാജയപ്പെട്ടു",
    selectValidImage: "സാധുവായ ഒരു ചിത്ര ഫയൽ തിരഞ്ഞെടുക്കുക",
  },
  odia: {
    listening: "ଶୁଣୁଛି...",
    thinking: "ଚିନ୍ତା କରୁଛି...",
    askQuestion: "ଆପଣଙ୍କ ପ୍ରଶ୍ନ ପଚାରନ୍ତୁ...",
    askAboutImage: "ଏହି ଚିତ୍ର ବିଷୟରେ ପଚାରନ୍ତୁ...",
    noMicrophone: "ମାଇକ୍ରୋଫୋନ୍ ମିଳିଲା ନାହିଁ",
    microphoneBlocked: "ମାଇକ୍ରୋଫୋନ୍ ଆକ୍ସେସ୍ ଅବରୋଧିତ",
    voiceNotSupported: "ଭଏସ୍ ଇନପୁଟ୍ ସମର୍ଥିତ ନୁହେଁ",
    networkError: "ନେଟୱାର୍କ ତ୍ରୁଟି",
    uploadFailed: "ଅପଲୋଡ୍ ବିଫଳ",
    selectValidImage: "ଦୟାକରି ଏକ ବୈଧ ଚିତ୍ର ଫାଇଲ୍ ବାଛନ୍ତୁ",
  },
  assamese: {
    listening: "শুনি আছে...",
    thinking: "চিন্তা কৰি আছে...",
    askQuestion: "আপোনাৰ প্ৰশ্ন সুধিব...",
    askAboutImage: "এই ছবিৰ বিষয়ে সুধিব...",
    noMicrophone: "মাইক্ৰফন পোৱা নগল",
    microphoneBlocked: "মাইক্ৰফন প্ৰৱেশ অৱৰোধ কৰা হৈছে",
    voiceNotSupported: "ভইচ ইনপুট সমৰ্থিত নহয়",
    networkError: "নেটৱৰ্ক ত্ৰুটি",
    uploadFailed: "আপলোড বিফল",
    selectValidImage: "অনুগ্ৰহ কৰি এটা বৈধ চিত্ৰ ফাইল বাছনি কৰক",
  },
  urdu: {
    listening: "سن رہا ہے...",
    thinking: "سوچ رہا ہے...",
    askQuestion: "اپنا سوال پوچھیں...",
    askAboutImage: "اس تصویر کے بارے میں پوچھیں...",
    noMicrophone: "مائیکروفون نہیں ملا",
    microphoneBlocked: "مائیکروفون رسائی مسدود",
    voiceNotSupported: "آواز ان پٹ تعاون یافتہ نہیں",
    networkError: "نیٹ ورک کی خرابی",
    uploadFailed: "اپ لوڈ ناکام",
    selectValidImage: "براہ کرم ایک درست تصویری فائل منتخب کریں",
  },
};

// Get translated text
function t(key) {
  const lang = getLanguage();
  const langTranslations = translations[lang] || translations["english"];
  return langTranslations[key] || translations["english"][key] || key;
}

// Safe addEvent helper: attach listener only if element exists
function safeAddEvent(idOrEl, event, handler) {
  const el =
    typeof idOrEl === "string" ? document.getElementById(idOrEl) : idOrEl;
  if (!el || typeof el.addEventListener !== "function") return false;
  try {
    el.addEventListener(event, handler);
    return true;
  } catch (e) {
    return false;
  }
}

// Variables
let recognition;
let synthesis = window.speechSynthesis;
let currentUtterance = null;
let lastBotMessage = "";
let attachedImageFile = null; // Store attached image
// Feature flag: temporarily disable image/camera/file upload features
const IMAGE_ENABLED = false; // set false to disable image functionality temporarily

// Utility: Clear chat
function clearChat() {
  const cb = document.getElementById("chatbox");
  if (cb) cb.innerHTML = "";
}

// Dark Mode Toggle
function toggleDarkMode() {
  const body = document.body;
  body.classList.toggle("dark-mode");
  const darkModeToggle = document.getElementById("darkModeToggle");
  // Update toggle icon
  if (body.classList.contains("dark-mode")) {
    if (darkModeToggle) darkModeToggle.textContent = "☀️";
    localStorage.setItem("darkMode", "enabled");
  } else {
    if (darkModeToggle) darkModeToggle.textContent = "🌙";
    localStorage.setItem("darkMode", "disabled");
  }
}

// Update all UI text elements based on selected language
function updateUILanguage() {
  // Update title and subtitle
  const titleEl = document.querySelector(".title");
  const subtitleEl = document.querySelector(".subtitle");
  if (titleEl) titleEl.textContent = t("appTitle");
  if (subtitleEl) subtitleEl.textContent = t("appSubtitle");

  // Update Quick Actions section
  const sectionTitles = document.querySelectorAll(".section-title");
  if (sectionTitles[0]) sectionTitles[0].textContent = t("quickActions");
  if (sectionTitles[1]) sectionTitles[1].textContent = t("loadedFiles");

  // Update Quick Action buttons
  const quickActionBtns = document.querySelectorAll(".quick-actions .chip");
  if (quickActionBtns[0]) quickActionBtns[0].textContent = t("uploadDoc");
  if (quickActionBtns[1]) quickActionBtns[1].textContent = t("attachImage");
  if (quickActionBtns[2]) quickActionBtns[2].textContent = t("newChat");

  // Update no files loaded text
  const loadedFilesList = document.getElementById("loadedFilesList");
  if (loadedFilesList && loadedFilesList.querySelector("p")) {
    const noFilesP = loadedFilesList.querySelector("p");
    if (
      (noFilesP && noFilesP.textContent.includes("No files")) ||
      noFilesP.textContent.includes("फ़ाइल")
    ) {
      noFilesP.textContent = t("noFilesLoaded");
    }
  }

  // Update button titles/tooltips
  const helpBtn = document.getElementById("helpBtn");
  const classifyBtn = document.getElementById("classifyPlantBtn");
  const darkModeBtn = document.getElementById("darkModeToggle");
  const voiceBtn = document.getElementById("voiceBtn");
  const sendBtn = document.getElementById("sendBtn");

  if (helpBtn) helpBtn.title = t("help");
  if (classifyBtn) classifyBtn.title = t("identifyPlant");
  if (darkModeBtn) darkModeBtn.title = t("darkMode");
  if (voiceBtn) voiceBtn.title = t("voice");
  if (sendBtn) sendBtn.title = t("send");

  // Update textarea placeholder
  const questionInput = document.getElementById("question");
  if (questionInput && !attachedImageFile) {
    questionInput.placeholder = t("askQuestion");
  }

  // Update voice control buttons
  const speakBtn = document.getElementById("speakBtn");
  const stopSpeakBtn = document.getElementById("stopSpeakBtn");
  if (speakBtn) speakBtn.textContent = t("listen");
  if (stopSpeakBtn) stopSpeakBtn.textContent = t("stop");

  // Update remove button
  const removeBtn = document.getElementById("removeImageBtn");
  if (removeBtn) removeBtn.title = t("remove");

  // Update loading indicator if visible
  const loadingIndicator = document.getElementById("loadingIndicator");
  if (loadingIndicator && loadingIndicator.style.display !== "none") {
    const thinkingSpan = loadingIndicator.querySelector("span:last-child");
    if (thinkingSpan) thinkingSpan.textContent = t("thinking");
  }
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  initSpeechRecognition();
  updateVoiceAvailability();
  window.addEventListener("online", updateVoiceAvailability);
  window.addEventListener("offline", updateVoiceAvailability);

  // Load dark mode preference
  const darkModePreference = localStorage.getItem("darkMode");
  if (darkModePreference === "enabled") {
    document.body.classList.add("dark-mode");
    const dmt = document.getElementById("darkModeToggle");
    if (dmt) dmt.textContent = "☀️";
  }

  // Initialize UI language
  updateUILanguage();

  // Add language change listener
  const langSelect = document.getElementById("languageSelect");
  if (langSelect) {
    langSelect.addEventListener("change", updateUILanguage);
  }

  // Mobile menu toggle
  const menuToggle = document.getElementById("menuToggle");
  const leftPanel = document.querySelector(".left-panel");
  const overlay = document.getElementById("menuOverlay");

  if (menuToggle && leftPanel && overlay) {
    menuToggle.addEventListener("click", () => {
      leftPanel.classList.toggle("active");
      overlay.classList.toggle("active");
    });

    overlay.addEventListener("click", () => {
      leftPanel.classList.remove("active");
      overlay.classList.remove("active");
    });
  }

  // Render pre-search suggestion chips
  renderPreSearchChips();

  // Auto-expand textarea (guard element existence)
  const textarea = document.getElementById("question");
  if (textarea) {
    textarea.addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 120) + "px";
    });

    // Submit on Enter (without Shift)
    textarea.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });
  }
});

// Send Button
safeAddEvent("sendBtn", "click", handleSendMessage);

// Dark Mode Toggle Button
safeAddEvent("darkModeToggle", "click", toggleDarkMode);

// Help / Tips Button
safeAddEvent("helpBtn", "click", () => showWalkthrough(true));

// Image and document uploads handled via buttons in input bar

// Chat Image Input - attach image for analysis
if (IMAGE_ENABLED) {
  safeAddEvent("chatImageInput", "change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      addMessage(t("selectValidImage"), "bot");
      return;
    }

    attachedImageFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const imgPreview = document.getElementById("chatImagePreview");
      if (imgPreview) imgPreview.src = ev.target.result;
      const imgBar = document.getElementById("imagePreviewBar");
      if (imgBar) imgBar.style.display = "inline-block";
      // Focus on question input
      const qEl = document.getElementById("question");
      if (qEl) {
        qEl.focus();
        qEl.placeholder = t("askAboutImage");
      }
    };
    reader.readAsDataURL(file);
  });
}

// Remove attached image
if (IMAGE_ENABLED) {
  safeAddEvent("removeImageBtn", "click", () => {
    attachedImageFile = null;
    const chatImageInputEl = document.getElementById("chatImageInput");
    if (chatImageInputEl) chatImageInputEl.value = "";
    const imgBar2 = document.getElementById("imagePreviewBar");
    if (imgBar2) imgBar2.style.display = "none";
    const qEl2 = document.getElementById("question");
    if (qEl2) qEl2.placeholder = t("askQuestion");
  });
}

// Chat File Input (next to typing box)
if (IMAGE_ENABLED) {
  safeAddEvent("chatFileInput", "change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const chatFileInputLabel = document.querySelector(
      'label[for="chatFileInput"]'
    );
    if (chatFileInputLabel) {
      chatFileInputLabel.disabled = true;
      chatFileInputLabel.innerHTML = '<span class="spinner"></span>';
    }

    try {
      const formData = new FormData();
      formData.append("files", file);

      const res = await fetch("/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        showAlert(data.error || "Upload failed", "error");
      } else {
        showAlert(data.message, "success");
        // Add file to sidebar list
        addLoadedFile(file.name);
        const cfi = document.getElementById("chatFileInput");
        if (cfi) cfi.value = ""; // Clear input
      }
    } catch (error) {
      showAlert("Network error: " + error.message, "error");
    } finally {
      if (chatFileInputLabel) {
        chatFileInputLabel.disabled = false;
        chatFileInputLabel.innerHTML = "�";
      }
    }
  });
}

function addLoadedFile(filename) {
  const loadedFilesList = document.getElementById("loadedFilesList");
  if (!loadedFilesList) return;
  // Remove "No files loaded." if present
  const noFilesMsg = loadedFilesList.querySelector("p");
  if (noFilesMsg) {
    noFilesMsg.remove();
  }
  const fileItem = document.createElement("div");
  fileItem.className = "loaded-file-item";
  fileItem.textContent = filename;
  loadedFilesList.appendChild(fileItem);
}

// Plant Classification Button Handler - disabled when IMAGE_ENABLED is false
if (IMAGE_ENABLED) {
  const classifyPlantBtn = document.getElementById("classifyPlantBtn");
  const classifyPlantInput = document.getElementById("classifyPlantInput");

  if (classifyPlantBtn && classifyPlantInput) {
    safeAddEvent(classifyPlantBtn, "click", () => {
      classifyPlantInput.click();
    });

    safeAddEvent(classifyPlantInput, "change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        addMessage("❌ Please select a valid image file (JPG, PNG)", "bot");
        return;
      }

      // Show the image in chat as user message
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const imageDataURL = ev.target.result;
        addMessage(
          "🌿 Please identify this plant: Is it sugarcane or weed?",
          "user",
          imageDataURL
        );

        // Show loading indicator
        showLoading();

        try {
          const formData = new FormData();
          formData.append("image", file);
          formData.append("language", getLanguage());

          const response = await fetch("/classify-plant", {
            method: "POST",
            body: formData,
          });

          const data = await response.json();

          if (!response.ok) {
            addMessage(
              `❌ Error: ${data.error || "Classification failed"}`,
              "bot"
            );
            return;
          }

          // Format the classification result
          const classification = data.classification.toUpperCase();
          const confidence = (data.confidence * 100).toFixed(1);

          let emoji = "❓";
          if (classification === "SUGARCANE") {
            emoji = "✅🌾";
          } else if (classification === "WEED") {
            emoji = "⚠️🌿";
          }

          let resultMessage = `${emoji} **Classification Result**\n\n`;
          resultMessage += `**Type:** ${classification}\n`;
          resultMessage += `**Confidence:** ${confidence}%\n`;

          if (data.plant_type && data.plant_type !== "Unknown") {
            resultMessage += `**Plant Type:** ${data.plant_type}\n`;
          }

          resultMessage += `\n**Details:** ${data.details}\n`;

          if (data.characteristics) {
            resultMessage += `\n**Characteristics:** ${data.characteristics}\n`;
          }

          if (data.recommendation) {
            resultMessage += `\n**💡 Recommendation:** ${data.recommendation}`;
          }

          addMessage(resultMessage, "bot");
        } catch (error) {
          addMessage(`❌ Network error: ${error.message}`, "bot");
        } finally {
          hideLoading();
          // Clear the file input for next use
          classifyPlantInput.value = "";
        }
      };
      reader.readAsDataURL(file);
    });
  }
}

function showWalkthrough(force = false) {
  // If chat already has content and not forced, do nothing
  const chatbox = document.getElementById("chatbox");
  if (chatbox.children.length > 0 && !force) return;

  // Only show the walkthrough on the very first visit
  if (localStorage.getItem("hasVisited")) {
    return;
  }

  addMessage("👋 Welcome! Here's how to use Sugarcane Advisor:", "bot");
  addMessage(
    "**Quick Start:**\n- Type your question below and press Send ➤\n- Tap 📷 to attach & analyze crop images (with your question)\n- Tap 📎 to upload documents for better context\n- Use 🌙 for dark mode • 🎤 for voice input",
    "bot"
  );

  localStorage.setItem("hasVisited", "true");
}

// Language UI removed from template; no inline dropdown handlers required here.

// Image functionality now integrated into main chat flow

// Render pre-search suggestion chips below the header
function renderPreSearchChips() {
  const suggestions = [
    "Know about your farm",
    "Take a image of your plant",
    "Is this red rot?",
    "Show treatment advice",
    "Upload field documents",
  ];
  const container = document.getElementById("preSearchBar");
  if (!container) return;
  container.innerHTML = "";
  suggestions.forEach((s) => {
    const chip = document.createElement("div");
    chip.className = "presearch-chip";
    chip.textContent = s;
    safeAddEvent(chip, "click", () => {
      if (/image/i.test(s)) {
        // trigger image picker
        const imgInput = document.getElementById("chatImageInput");
        if (imgInput) imgInput.click();
      } else {
        const q = document.getElementById("question");
        if (q) {
          q.value = s;
          q.focus();
        }
      }
    });
    container.appendChild(chip);
  });
}

// Chat handler - trigger from Enter key or send button
async function handleSendMessage() {
  // send triggered
  const questionInput = document.getElementById("question");
  const sendBtn = document.getElementById("sendBtn");

  if (!questionInput) return; // nothing to send or no UI
  const question = (questionInput.value || "").trim();

  // Check if we have an image attached
  const hasImage = attachedImageFile !== null;

  if (!question && !hasImage) {
    // question and image are empty
    return;
  }

  // Save image data URL for display in chat
  let imageDataURL = null;
  if (hasImage) {
    const previewEl = document.getElementById("chatImagePreview");
    if (previewEl) imageDataURL = previewEl.src;
  }

  // Add user message with image to chat
  addMessage(question || "Analyze this image", "user", imageDataURL);
  questionInput.value = "";
  questionInput.style.height = "auto";

  // Disable send button while processing
  if (sendBtn) sendBtn.disabled = true;
  showLoading();

  try {
    const lang = getLanguage();

    // If image is attached, call both classification and scan endpoints in parallel,
    // merge results and retry scan once if results are barren or low-confidence.
    if (hasImage) {
      try {
        const fdClassify = new FormData();
        fdClassify.append("image", attachedImageFile);
        fdClassify.append("language", lang);

        const fdScan = new FormData();
        fdScan.append("file", attachedImageFile);
        fdScan.append("language", lang);
        if (question) fdScan.append("prompt", question);

        // Fire both requests in parallel
        const classifyPromise = fetch("/classify-plant", {
          method: "POST",
          body: fdClassify,
        })
          .then(async (r) => ({ ok: r.ok, json: await safeJson(r) }))
          .catch((e) => ({ ok: false, json: { error: e.message } }));

        const scanPromise = fetch("/scan-image", {
          method: "POST",
          body: fdScan,
        })
          .then(async (r) => ({ ok: r.ok, json: await safeJson(r) }))
          .catch((e) => ({ ok: false, json: { error: e.message } }));

        const [classRes, scanRes] = await Promise.all([
          classifyPromise,
          scanPromise,
        ]);

        // Helper to format classification block
        function formatClassification(cdata) {
          try {
            const classification = (cdata.classification || "").toUpperCase();
            const confidence = (Number(cdata.confidence || 0) * 100).toFixed(1);
            let emoji = "❓";
            if (classification === "SUGARCANE") emoji = "✅🌾";
            else if (classification === "WEED") emoji = "⚠️🌿";

            let txt = `${emoji} **CLASSIFICATION RESULT**\n`;
            txt += `${"=".repeat(60)}\n`;
            txt += `**Type:** ${classification || "UNKNOWN"}\n`;
            txt += `**Confidence:** ${confidence}%\n`;
            if (cdata.plant_type && cdata.plant_type !== "Unknown")
              txt += `**Plant Type:** ${cdata.plant_type}\n`;
            if (cdata.details) txt += `\n**Details:**\n${cdata.details}\n`;
            if (cdata.characteristics)
              txt += `\n**Characteristics:**\n${cdata.characteristics}\n`;
            if (cdata.recommendation)
              txt += `\n**💡 Recommendation:**\n${cdata.recommendation}`;
            txt += `\n${"=".repeat(60)}\n\n`;
            return txt;
          } catch (e) {
            return "";
          }
        }

        // Helper to format scan block
        function formatScan(sdata) {
          try {
            let txt = `**Image Analysis**\n\n`;
            if (sdata.summary) txt += `📋 **Summary:** ${sdata.summary}\n\n`;
            if (sdata.severity) txt += `⚠️ **Severity:** ${sdata.severity}\n\n`;
            if (sdata.diagnosis && sdata.diagnosis.length > 0)
              txt += `🔍 **Diagnosis:**\n${sdata.diagnosis
                .map((d) => `- ${d}`)
                .join("\n")}\n\n`;
            if (sdata.recommendations && sdata.recommendations.length > 0)
              txt += `💊 **Recommendations:**\n${sdata.recommendations
                .map((r) => `- ${r}`)
                .join("\n")}\n\n`;
            if (
              sdata.preventive_measures &&
              sdata.preventive_measures.length > 0
            )
              txt += `🛡️ **Preventive Measures:**\n${sdata.preventive_measures
                .map((p) => `- ${p}`)
                .join("\n")}\n\n`;
            return txt;
          } catch (e) {
            return "";
          }
        }

        // safeJson: parse response or return null
        function safeJsonResponseWrapper(obj) {
          return obj && obj.json ? obj.json : null;
        }

        const classifyData = safeJsonResponseWrapper(classRes) || {};
        const scanData = safeJsonResponseWrapper(scanRes) || {};

        let finalMsg = "";

        if (classifyData && classifyData.classification) {
          finalMsg += formatClassification(classifyData);
        }

        if (scanData) {
          finalMsg += formatScan(scanData);
        }

        // Decide if scan result is barren (no useful info)
        function isScanBarren(sd) {
          if (!sd) return true;
          const diag = sd.diagnosis || [];
          const recs = sd.recommendations || [];
          const prev = sd.preventive_measures || [];
          const onlyNone =
            diag.length === 1 && /^none/i.test(String(diag[0] || ""));
          const empty =
            !recs.length &&
            !prev.length &&
            (!sd.summary || sd.summary.trim() === "");
          return onlyNone || empty;
        }

        const classLowConfidence =
          (classifyData &&
            typeof classifyData.confidence !== "undefined" &&
            Number(classifyData.confidence) < 0.4) ||
          false;
        const scanBarren = isScanBarren(scanData);

        // If barren or low confidence, retry scan once with an explicit guidance prompt
        if (scanBarren || classLowConfidence) {
          // retrying scan due to barren/low-confidence results
          const retryFd = new FormData();
          retryFd.append("file", attachedImageFile);
          retryFd.append("language", lang);
          // guidance to elicit more thorough analysis without inventing
          retryFd.append(
            "prompt",
            "Re-analyze the image carefully for subtle early-stage disease or pest signs. If healthy, provide at least one preventive measure and confidence level. Do NOT invent conditions."
          );
          try {
            const retryResp = await fetch("/scan-image", {
              method: "POST",
              body: retryFd,
            });
            const retryJson = await safeJson(retryResp);
            if (retryResp.ok && retryJson) {
              // update finalMsg with retry details (append)
              finalMsg += "\n**Retry Analysis**\n\n" + formatScan(retryJson);
              // incorporate any new recommendations
              if (
                retryJson.recommendations &&
                retryJson.recommendations.length > 0
              ) {
                finalMsg += "✅ Added recommendations from retry.\n";
              }
            }
          } catch (e) {
            // retry scan failed
          }
        }

        if (!finalMsg)
          finalMsg =
            '⚠️ No useful analysis returned. Try a clearer close-up photo, good lighting, or add a short prompt (e.g., "Is this red rot?").';

        addMessage(finalMsg, "bot");
        lastBotMessage = finalMsg;
      } catch (err) {
        // image analysis error
        addMessage(
          "❌ Image analysis failed: " + (err.message || err),
          "error"
        );
      } finally {
        // Clear attached image (guard DOM accesses)
        attachedImageFile = null;
        const _cInput = document.getElementById("chatImageInput");
        if (_cInput) _cInput.value = "";
        const _imgBar = document.getElementById("imagePreviewBar");
        if (_imgBar) _imgBar.style.display = "none";
        const _qEl = document.getElementById("question");
        if (_qEl) _qEl.placeholder = t("askQuestion");
      }
    } else {
      // Regular text question
      // sending question to /ask endpoint
      const res = await fetch("/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: question,
          language: lang,
        }),
      });

      const data = await res.json();
      // response from /ask endpoint

      if (!res.ok) {
        addMessage(data.error || "Failed to get response", "error");
      } else {
        // Show text response immediately
        const messageOptions = {
          originalQuestion: question
        };

        // If infographic is already included (shouldn't happen with new flow, but just in case)
        if (data.infographic_url) {
          messageOptions.infographicUrl = data.infographic_url;
          messageOptions.infographicLanguage = data.infographic_language || lang;
        }

        // Add the message with text
        addMessage(data.response, "bot", null, messageOptions);
        lastBotMessage = data.response;

        // Log classification info for debugging
        if (data.response_format) {
          console.log(`Response format: ${data.response_format}, confidence: ${data.classification_confidence}`);
        }

        // If infographic is pending, generate it asynchronously
        if (data.infographic_pending) {
          console.log("Infographic pending, generating in background...");
          generateInfographicAsync(question, data.response, lang);
        }
      }
    }
  } catch (error) {
    // fetch error
    addMessage("Network error: " + error.message, "error");
  } finally {
    hideLoading();
    if (sendBtn) sendBtn.disabled = false;
  }
}

// Voice Recognition Setup
let isListening = false;
function initSpeechRecognition() {
  if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isListening = true;
      const voiceBtn = document.getElementById("voiceBtn");
      if (voiceBtn) {
        voiceBtn.textContent = "🔴";
        voiceBtn.title = t("listening");
      }
      // voice recognition started
    };

    recognition.onend = () => {
      isListening = false;
      const voiceBtn = document.getElementById("voiceBtn");
      if (voiceBtn) {
        voiceBtn.textContent = "🎤";
        voiceBtn.title = "Voice Input";
      }
      // voice recognition ended
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      // voice transcript captured
      const qEl = document.getElementById("question");
      if (qEl) {
        qEl.value = transcript;
        // Auto-focus and expand textarea
        qEl.focus();
        qEl.style.height = "auto";
        qEl.style.height = Math.min(qEl.scrollHeight, 120) + "px";
      }
    };

    recognition.onerror = (event) => {
      // voice recognition error
      isListening = false;
      const voiceBtn = document.getElementById("voiceBtn");
      if (voiceBtn) {
        voiceBtn.textContent = "🎤";
        voiceBtn.title = "Voice Input";
      }
      const friendly = getFriendlyVoiceError(event.error);
      addMessage(friendly, "error");
    };

    // Voice Button
    const vb = document.getElementById("voiceBtn");
    if (vb)
      vb.addEventListener("click", () => {
        // Stop if already listening
        if (isListening) {
          try {
            recognition.stop();
          } catch (e) {
            // stop failed
          }
          return;
        }

        // Check online status
        if (!navigator.onLine) {
          addMessage(
            "Voice needs internet connection. You appear to be offline.",
            "error"
          );
          return;
        }

        // Check if browser supports speech recognition
        if (!recognition) {
          addMessage(
            "Voice input not supported in this browser. Try Chrome or Edge.",
            "error"
          );
          return;
        }

        // Set language and start
        const selectedLang = getLanguage();
        const langCode = languageCodes[selectedLang] || "en-US";
        recognition.lang = langCode;
        // starting voice recognition with language

        try {
          recognition.start();
        } catch (e) {
          // recognition start failed
          if (e.name === "InvalidStateError") {
            // Already running, try to stop and restart
            recognition.stop();
            setTimeout(() => {
              try {
                recognition.start();
              } catch (e2) {
                addMessage(
                  "Voice recognition failed to start. Please try again.",
                  "error"
                );
              }
            }, 100);
          } else {
            addMessage(
              "Could not start voice recognition: " + e.message,
              "error"
            );
          }
        }
      });
  } else {
    // speech recognition not supported in this browser
    // Disable voice button
    const voiceBtn = document.getElementById("voiceBtn");
    if (voiceBtn) {
      voiceBtn.disabled = true;
      voiceBtn.title = "Voice input not supported in this browser";
    }
  }
}

function getFriendlyVoiceError(code) {
  const map = {
    network:
      "🌐 Voice service needs internet. Check your connection and try again. (Tip: Voice recognition requires an active internet connection)",
    "no-speech":
      "🤫 No speech detected. Speak clearly into your microphone and try again.",
    "audio-capture":
      "🎤 No microphone found. Please connect a microphone or enable microphone access.",
    "not-allowed":
      "🚫 Microphone blocked. Allow microphone access in your browser settings (usually a 🎤 icon in the address bar).",
    "service-not-allowed":
      "⛔ Voice service blocked by browser. Check site permissions in your browser settings.",
    aborted: "⏹️ Voice input cancelled. Tap the mic button to try again.",
    "language-not-supported":
      "🌍 Voice recognition doesn't support this language. Try switching to English, Hindi, or another supported language.",
  };
  return (
    map[code] || "⚠️ Voice recognition error: " + code + ". Please try again."
  );
}

function updateVoiceAvailability() {
  const btn = document.getElementById("voiceBtn");
  if (!btn) return;
  const supported =
    "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
  const online = navigator.onLine;
  btn.disabled = !(supported && online);
  btn.setAttribute("aria-disabled", String(btn.disabled));
  btn.title = btn.disabled
    ? supported
      ? "Voice needs internet connection"
      : "Voice input not supported on this browser"
    : "Voice Input";
}

// Text-to-Speech
safeAddEvent("speakBtn", "click", () => {
  if (!lastBotMessage) {
    alert("No message to read");
    return;
  }

  if (synthesis.speaking) {
    synthesis.cancel();
  }

  const selectedLang = getLanguage();
  const langCode = languageCodes[selectedLang] || "en-US";
  currentUtterance = new SpeechSynthesisUtterance(lastBotMessage);
  currentUtterance.lang = langCode;
  synthesis.speak(currentUtterance);

  const sp = document.getElementById("speakBtn");
  const st = document.getElementById("stopSpeakBtn");
  if (sp) sp.style.display = "none";
  if (st) st.style.display = "inline-block";
});

safeAddEvent("stopSpeakBtn", "click", () => {
  if (synthesis.speaking) {
    synthesis.cancel();
  }
  const sp = document.getElementById("speakBtn");
  const st = document.getElementById("stopSpeakBtn");
  if (sp) sp.style.display = "inline-block";
  if (st) st.style.display = "none";
});

// ====== WALKTHROUGH & WELCOME SCREEN FUNCTIONALITY ======

const walkthroughSteps = [
  {
    target: '.composer-center textarea',
    title: '💬 Ask Your Questions',
    text: 'Type your farming questions here. Ask about diseases, pests, fertilizers, irrigation, or any sugarcane farming topic!',
    position: 'top'
  },
  {
    target: '.attach:first-child',
    title: '📷 Attach Images',
    text: 'Click here to attach images of diseased plants, pests, or your farm. Our AI can analyze images and provide specific advice.',
    position: 'top'
  },
  {
    target: '.attach:last-of-type',
    title: '📎 Upload Documents',
    text: 'Upload PDF or text documents about your farm, soil reports, or reference materials. The AI will use this information to give personalized advice.',
    position: 'top'
  },
  {
    target: '#languageSelect',
    title: '🌍 Choose Your Language',
    text: 'Select your preferred language. We support 14+ Indian languages including Hindi, Marathi, Tamil, Telugu, and more!',
    position: 'bottom'
  },
  {
    target: '#classifyPlantBtn',
    title: '🌿 Identify Plants',
    text: 'Use this feature to identify sugarcane varieties or analyze plant health. Just click and upload a photo!',
    position: 'bottom'
  }
];

let currentStep = 0;
let walkthroughActive = false;

function startWalkthrough() {
  const overlay = document.getElementById('walkthroughOverlay');
  if (!overlay) return;

  walkthroughActive = true;
  currentStep = 0;
  overlay.style.display = 'block';
  showWalkthroughStep(currentStep);
}

function showWalkthroughStep(stepIndex) {
  if (stepIndex >= walkthroughSteps.length) {
    endWalkthrough();
    return;
  }

  const step = walkthroughSteps[stepIndex];
  const targetElement = document.querySelector(step.target);

  if (!targetElement) {
    // Skip to next if element not found
    currentStep++;
    showWalkthroughStep(currentStep);
    return;
  }

  const spotlight = document.getElementById('walkthroughSpotlight');
  const tooltip = document.getElementById('walkthroughTooltip');

  // Position spotlight
  const rect = targetElement.getBoundingClientRect();
  spotlight.style.left = (rect.left - 10) + 'px';
  spotlight.style.top = (rect.top - 10) + 'px';
  spotlight.style.width = (rect.width + 20) + 'px';
  spotlight.style.height = (rect.height + 20) + 'px';

  // Update tooltip content
  document.getElementById('tooltipTitle').textContent = step.title;
  document.getElementById('tooltipText').textContent = step.text;
  document.getElementById('walkthroughProgress').textContent = `${stepIndex + 1}/${walkthroughSteps.length}`;

  // Position tooltip
  tooltip.className = 'walkthrough-tooltip';
  const tooltipRect = tooltip.getBoundingClientRect();

  switch (step.position) {
    case 'top':
      tooltip.style.left = (rect.left + rect.width / 2 - tooltipRect.width / 2) + 'px';
      tooltip.style.top = (rect.top - tooltipRect.height - 20) + 'px';
      tooltip.classList.add('arrow-bottom');
      break;
    case 'bottom':
      tooltip.style.left = (rect.left + rect.width / 2 - tooltipRect.width / 2) + 'px';
      tooltip.style.top = (rect.bottom + 20) + 'px';
      tooltip.classList.add('arrow-top');
      break;
    case 'left':
      tooltip.style.left = (rect.left - tooltipRect.width - 20) + 'px';
      tooltip.style.top = (rect.top + rect.height / 2 - tooltipRect.height / 2) + 'px';
      tooltip.classList.add('arrow-right');
      break;
    case 'right':
      tooltip.style.left = (rect.right + 20) + 'px';
      tooltip.style.top = (rect.top + rect.height / 2 - tooltipRect.height / 2) + 'px';
      tooltip.classList.add('arrow-left');
      break;
  }

  // Make sure tooltip stays in viewport
  const finalRect = tooltip.getBoundingClientRect();
  if (finalRect.left < 10) {
    tooltip.style.left = '10px';
  }
  if (finalRect.right > window.innerWidth - 10) {
    tooltip.style.left = (window.innerWidth - finalRect.width - 10) + 'px';
  }
  if (finalRect.top < 10) {
    tooltip.style.top = '10px';
  }
}

function endWalkthrough() {
  walkthroughActive = false;
  const overlay = document.getElementById('walkthroughOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }

  // Store that user has seen walkthrough
  try {
    localStorage.setItem('walkthroughCompleted', 'true');
  } catch (e) {
    // Ignore localStorage errors
  }
}

function showWelcomeScreen() {
  // Check if user has seen welcome screen before
  try {
    const seen = localStorage.getItem('walkthroughCompleted');
    if (seen === 'true') {
      return; // Don't show again
    }
  } catch (e) {
    // Ignore localStorage errors
  }

  const welcomeScreen = document.getElementById('welcomeScreen');
  if (welcomeScreen) {
    welcomeScreen.style.display = 'flex';
  }
}

// Event listeners for walkthrough
safeAddEvent('nextWalkthrough', 'click', () => {
  currentStep++;
  showWalkthroughStep(currentStep);
});

safeAddEvent('skipWalkthrough', 'click', () => {
  endWalkthrough();
});

safeAddEvent('startWalkthroughBtn', 'click', () => {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (welcomeScreen) {
    welcomeScreen.style.display = 'none';
  }
  startWalkthrough();
});

safeAddEvent('skipWelcomeBtn', 'click', () => {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (welcomeScreen) {
    welcomeScreen.style.display = 'none';
  }
  try {
    localStorage.setItem('walkthroughCompleted', 'true');
  } catch (e) {
    // Ignore
  }
});

safeAddEvent('restartTourBtn', 'click', () => {
  startWalkthrough();
});

// Handle suggestion card clicks
document.addEventListener('click', (e) => {
  const card = e.target.closest('.suggestion-card');
  if (card) {
    const question = card.getAttribute('data-question');
    if (question) {
      // Close welcome screen
      const welcomeScreen = document.getElementById('welcomeScreen');
      if (welcomeScreen) {
        welcomeScreen.style.display = 'none';
      }

      // Set question in textarea
      const textarea = document.getElementById('question');
      if (textarea) {
        textarea.value = question;
        textarea.focus();
      }

      // Optionally auto-send
      setTimeout(() => {
        const sendBtn = document.getElementById('sendBtn');
        if (sendBtn) {
          sendBtn.click();
        }
      }, 300);

      try {
        localStorage.setItem('walkthroughCompleted', 'true');
      } catch (e) {
        // Ignore
      }
    }
  }
});

// Show welcome screen on page load
window.addEventListener('load', () => {
  setTimeout(() => {
    showWelcomeScreen();
  }, 500);
});
