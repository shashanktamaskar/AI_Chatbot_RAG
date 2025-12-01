// Extracted from templates/index.html <script> block
// The file expects `marked` to be loaded (CDN) before this script runs.

// Utility: Add message to chat
function addMessage(message, sender, imageData = null) {
    const chatbox = document.getElementById('chatbox');
    if (!chatbox) return; // nothing to render into
    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg ' + (sender || 'bot');

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    let content = '';
    if (sender === 'user') {
        content = escapeHtml(message);
        if (imageData) {
            content = `<img src="${imageData}" class="msg-image" style="max-width:300px; display:block;" alt="Attached image"><div style="margin-top:8px;">${content}</div>`;
        }
        bubble.innerHTML = `${content} <span class="msg-time">${formatTime()}</span>`;
    } else if (sender === 'bot') {
        bubble.innerHTML = `${marked.parse(message)} <span class="msg-time">${formatTime()}</span>`;
    } else if (sender === 'error') {
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

function formatTime(d=new Date()) {
    try {
        return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    } catch { return ''; }
}

// Utility: Escape HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Utility: Show loading
function showLoading() {
    const li = document.getElementById('loadingIndicator');
    if (li) li.style.display = '';
}
// Utility: Hide loading
function hideLoading() {
    const li = document.getElementById('loadingIndicator');
    if (li) li.style.display = 'none';
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
    return 'english'; // Always return english
}

// Safe addEvent helper: attach listener only if element exists
function safeAddEvent(idOrEl, event, handler) {
    const el = (typeof idOrEl === 'string') ? document.getElementById(idOrEl) : idOrEl;
    if (!el || typeof el.addEventListener !== 'function') return false;
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
let lastBotMessage = '';
let currentLanguage = localStorage.getItem('appLanguage') || 'english'; // Default to English
let attachedImageFile = null; // Store attached image
// Feature flag: temporarily disable image/camera/file upload features
const IMAGE_ENABLED = false; // set false to disable image functionality temporarily

// Utility: Clear chat
function clearChat() {
    const cb = document.getElementById('chatbox');
    if (cb) cb.innerHTML = '';
}

// Dark Mode Toggle
function toggleDarkMode() {
    const body = document.body;
    body.classList.toggle('dark-mode');
    const darkModeToggle = document.getElementById('darkModeToggle');
    // Update toggle icon
    if (body.classList.contains('dark-mode')) {
        if (darkModeToggle) darkModeToggle.textContent = '☀️';
        localStorage.setItem('darkMode', 'enabled');
    } else {
        if (darkModeToggle) darkModeToggle.textContent = '🌙';
        localStorage.setItem('darkMode', 'disabled');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initSpeechRecognition();
    updateVoiceAvailability();
    window.addEventListener('online', updateVoiceAvailability);
    window.addEventListener('offline', updateVoiceAvailability);

    // Load dark mode preference
    const darkModePreference = localStorage.getItem('darkMode');
    if (darkModePreference === 'enabled') {
        document.body.classList.add('dark-mode');
        const dmt = document.getElementById('darkModeToggle');
        if (dmt) dmt.textContent = '☀️';
    }

    // Show walkthrough on every page load
    showWalkthrough();

    // Render pre-search suggestion chips
    renderPreSearchChips();

    // Auto-expand textarea (guard element existence)
    const textarea = document.getElementById('question');
    if (textarea) {
        textarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        // Submit on Enter (without Shift)
        textarea.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            }
        });
    }
});

// Send Button
safeAddEvent('sendBtn', 'click', handleSendMessage);

// Dark Mode Toggle Button
safeAddEvent('darkModeToggle', 'click', toggleDarkMode);

// Help / Tips Button
safeAddEvent('helpBtn', 'click', () => showWalkthrough(true));

// Image and document uploads handled via buttons in input bar

// Chat Image Input - attach image for analysis
if (IMAGE_ENABLED) {
    safeAddEvent('chatImageInput', 'change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            addMessage('Please select a valid image file (JPG, PNG)', 'bot');
            return;
        }

        attachedImageFile = file;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const imgPreview = document.getElementById('chatImagePreview');
            if (imgPreview) imgPreview.src = ev.target.result;
            const imgBar = document.getElementById('imagePreviewBar');
            if (imgBar) imgBar.style.display = 'inline-block';
            // Focus on question input
            const qEl = document.getElementById('question');
            if (qEl) {
                qEl.focus();
                qEl.placeholder = 'Ask about this image...';
            }
        };
        reader.readAsDataURL(file);
    });
}

// Remove attached image
if (IMAGE_ENABLED) {
    safeAddEvent('removeImageBtn', 'click', () => {
        attachedImageFile = null;
        const chatImageInputEl = document.getElementById('chatImageInput');
        if (chatImageInputEl) chatImageInputEl.value = '';
        const imgBar2 = document.getElementById('imagePreviewBar');
        if (imgBar2) imgBar2.style.display = 'none';
        const qEl2 = document.getElementById('question');
        if (qEl2) qEl2.placeholder = 'Ask your question...';
    });
}

// Chat File Input (next to typing box)
if (IMAGE_ENABLED) {
    safeAddEvent('chatFileInput', 'change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const chatFileInputLabel = document.querySelector('label[for="chatFileInput"]');
        if (chatFileInputLabel) {
            chatFileInputLabel.disabled = true;
            chatFileInputLabel.innerHTML = '<span class="spinner"></span>';
        }

        try {
            const formData = new FormData();
            formData.append('files', file);

            const res = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (!res.ok) {
                showAlert(data.error || 'Upload failed', 'error');
            } else {
                showAlert(data.message, 'success');
                // Add file to sidebar list
                addLoadedFile(file.name);
                const cfi = document.getElementById('chatFileInput');
                if (cfi) cfi.value = ''; // Clear input
            }
        } catch (error) {
            showAlert('Network error: ' + error.message, 'error');
        } finally {
            if (chatFileInputLabel) {
                chatFileInputLabel.disabled = false;
                chatFileInputLabel.innerHTML = '�';
            }
        }
    });
}

function addLoadedFile(filename) {
    const loadedFilesList = document.getElementById('loadedFilesList');
    if (!loadedFilesList) return;
    // Remove "No files loaded." if present
    const noFilesMsg = loadedFilesList.querySelector('p');
    if (noFilesMsg) {
        noFilesMsg.remove();
    }
    const fileItem = document.createElement('div');
    fileItem.className = 'loaded-file-item';
    fileItem.textContent = filename;
    loadedFilesList.appendChild(fileItem);
}

// Plant Classification Button Handler - disabled when IMAGE_ENABLED is false
if (IMAGE_ENABLED) {
    const classifyPlantBtn = document.getElementById('classifyPlantBtn');
    const classifyPlantInput = document.getElementById('classifyPlantInput');

    if (classifyPlantBtn && classifyPlantInput) {
        safeAddEvent(classifyPlantBtn, 'click', () => {
            classifyPlantInput.click();
        });

        safeAddEvent(classifyPlantInput, 'change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                addMessage('❌ Please select a valid image file (JPG, PNG)', 'bot');
                return;
            }

            // Show the image in chat as user message
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const imageDataURL = ev.target.result;
                addMessage('🌿 Please identify this plant: Is it sugarcane or weed?', 'user', imageDataURL);

                // Show loading indicator
                showLoading();

                try {
                    const formData = new FormData();
                    formData.append('image', file);
                    formData.append('language', getLanguage());

                    const response = await fetch('/classify-plant', {
                        method: 'POST',
                        body: formData
                    });

                    const data = await response.json();

                    if (!response.ok) {
                        addMessage(`❌ Error: ${data.error || 'Classification failed'}`, 'bot');
                        return;
                    }

                    // Format the classification result
                    const classification = data.classification.toUpperCase();
                    const confidence = (data.confidence * 100).toFixed(1);
                    
                    let emoji = '❓';
                    if (classification === 'SUGARCANE') {
                        emoji = '✅🌾';
                    } else if (classification === 'WEED') {
                        emoji = '⚠️🌿';
                    }

                    let resultMessage = `${emoji} **Classification Result**\n\n`;
                    resultMessage += `**Type:** ${classification}\n`;
                    resultMessage += `**Confidence:** ${confidence}%\n`;
                    
                    if (data.plant_type && data.plant_type !== 'Unknown') {
                        resultMessage += `**Plant Type:** ${data.plant_type}\n`;
                    }
                    
                    resultMessage += `\n**Details:** ${data.details}\n`;
                    
                    if (data.characteristics) {
                        resultMessage += `\n**Characteristics:** ${data.characteristics}\n`;
                    }
                    
                    if (data.recommendation) {
                        resultMessage += `\n**💡 Recommendation:** ${data.recommendation}`;
                    }

                    addMessage(resultMessage, 'bot');

                } catch (error) {
                    addMessage(`❌ Network error: ${error.message}`, 'bot');
                } finally {
                    hideLoading();
                    // Clear the file input for next use
                    classifyPlantInput.value = '';
                }
            };
            reader.readAsDataURL(file);
        });
    }
}

function showWalkthrough(force=false) {
    // If chat already has content and not forced, do nothing
    const chatbox = document.getElementById('chatbox');
    if (chatbox.children.length > 0 && !force) return;

    addMessage('👋 Welcome! Here\'s how to use Sugarcane Advisor:', 'bot');
    addMessage('**Quick Start:**\n- Type your question below and press Send ➤\n- Tap � to attach & analyze crop images (with your question)\n- Tap � to upload documents for better context\n- Use 🌐 to switch language • 🌙 for dark mode • 🎤 for voice input', 'bot');
    addMessage('💡 **Tip:** You can ask in Hindi, Marathi, Tamil, Telugu, Kannada, or English.', 'bot');
}

// Language UI removed from template; no inline dropdown handlers required here.

// Image functionality now integrated into main chat flow

// Render pre-search suggestion chips below the header
function renderPreSearchChips() {
    const suggestions = [
        'Know about your farm',
        'Take a image of your plant',
        'Is this red rot?',
        'Show treatment advice',
        'Upload field documents'
    ];
    const container = document.getElementById('preSearchBar');
    if (!container) return;
    container.innerHTML = '';
    suggestions.forEach(s => {
        const chip = document.createElement('div');
        chip.className = 'presearch-chip';
        chip.textContent = s;
        safeAddEvent(chip, 'click', () => {
            if (/image/i.test(s)) {
                // trigger image picker
                const imgInput = document.getElementById('chatImageInput');
                if (imgInput) imgInput.click();
            } else {
                const q = document.getElementById('question');
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
    const questionInput = document.getElementById('question');
    const sendBtn = document.getElementById('sendBtn');

    if (!questionInput) return; // nothing to send or no UI
    const question = (questionInput.value || '').trim();

    // Check if we have an image attached
    const hasImage = attachedImageFile !== null;

    if (!question && !hasImage) {
        // question and image are empty
        return;
    }

    // Save image data URL for display in chat
    let imageDataURL = null;
    if (hasImage) {
        const previewEl = document.getElementById('chatImagePreview');
        if (previewEl) imageDataURL = previewEl.src;
    }

    // Add user message with image to chat
    addMessage(question || 'Analyze this image', 'user', imageDataURL);
    questionInput.value = '';
    questionInput.style.height = 'auto';

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
                fdClassify.append('image', attachedImageFile);
                fdClassify.append('language', lang);

                const fdScan = new FormData();
                fdScan.append('file', attachedImageFile);
                fdScan.append('language', lang);
                if (question) fdScan.append('prompt', question);

                // Fire both requests in parallel
                const classifyPromise = fetch('/classify-plant', { method: 'POST', body: fdClassify })
                    .then(async r => ({ ok: r.ok, json: await safeJson(r) } ))
                    .catch(e => ({ ok: false, json: { error: e.message } }));

                const scanPromise = fetch('/scan-image', { method: 'POST', body: fdScan })
                    .then(async r => ({ ok: r.ok, json: await safeJson(r) } ))
                    .catch(e => ({ ok: false, json: { error: e.message } }));

                const [classRes, scanRes] = await Promise.all([classifyPromise, scanPromise]);

                // Helper to format classification block
                function formatClassification(cdata) {
                    try {
                        const classification = (cdata.classification || '').toUpperCase();
                        const confidence = (Number(cdata.confidence || 0) * 100).toFixed(1);
                        let emoji = '❓';
                        if (classification === 'SUGARCANE') emoji = '✅🌾';
                        else if (classification === 'WEED') emoji = '⚠️🌿';

                        let txt = `${emoji} **CLASSIFICATION RESULT**\n`;
                        txt += `${'='.repeat(60)}\n`;
                        txt += `**Type:** ${classification || 'UNKNOWN'}\n`;
                        txt += `**Confidence:** ${confidence}%\n`;
                        if (cdata.plant_type && cdata.plant_type !== 'Unknown') txt += `**Plant Type:** ${cdata.plant_type}\n`;
                        if (cdata.details) txt += `\n**Details:**\n${cdata.details}\n`;
                        if (cdata.characteristics) txt += `\n**Characteristics:**\n${cdata.characteristics}\n`;
                        if (cdata.recommendation) txt += `\n**💡 Recommendation:**\n${cdata.recommendation}`;
                        txt += `\n${'='.repeat(60)}\n\n`;
                        return txt;
                    } catch (e) { return '' }
                }

                // Helper to format scan block
                function formatScan(sdata) {
                    try {
                        let txt = `**Image Analysis**\n\n`;
                        if (sdata.summary) txt += `📋 **Summary:** ${sdata.summary}\n\n`;
                        if (sdata.severity) txt += `⚠️ **Severity:** ${sdata.severity}\n\n`;
                        if (sdata.diagnosis && sdata.diagnosis.length > 0) txt += `🔍 **Diagnosis:**\n${sdata.diagnosis.map(d => `- ${d}`).join('\n')}\n\n`;
                        if (sdata.recommendations && sdata.recommendations.length > 0) txt += `💊 **Recommendations:**\n${sdata.recommendations.map(r => `- ${r}`).join('\n')}\n\n`;
                        if (sdata.preventive_measures && sdata.preventive_measures.length > 0) txt += `🛡️ **Preventive Measures:**\n${sdata.preventive_measures.map(p => `- ${p}`).join('\n')}\n\n`;
                        return txt;
                    } catch (e) { return '' }
                }

                // safeJson: parse response or return null
                function safeJsonResponseWrapper(obj) {
                    return (obj && obj.json) ? obj.json : null;
                }

                const classifyData = safeJsonResponseWrapper(classRes) || {};
                const scanData = safeJsonResponseWrapper(scanRes) || {};

                let finalMsg = '';

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
                    const onlyNone = (diag.length === 1 && /^none/i.test(String(diag[0] || '')));
                    const empty = (!recs.length && !prev.length && (!sd.summary || sd.summary.trim() === ''));
                    return onlyNone || empty;
                }

                const classLowConfidence = (classifyData && typeof classifyData.confidence !== 'undefined' && Number(classifyData.confidence) < 0.4) || false;
                const scanBarren = isScanBarren(scanData);

                // If barren or low confidence, retry scan once with an explicit guidance prompt
                if (scanBarren || classLowConfidence) {
                    // retrying scan due to barren/low-confidence results
                    const retryFd = new FormData();
                    retryFd.append('file', attachedImageFile);
                    retryFd.append('language', lang);
                    // guidance to elicit more thorough analysis without inventing
                    retryFd.append('prompt', 'Re-analyze the image carefully for subtle early-stage disease or pest signs. If healthy, provide at least one preventive measure and confidence level. Do NOT invent conditions.');
                    try {
                        const retryResp = await fetch('/scan-image', { method: 'POST', body: retryFd });
                        const retryJson = await safeJson(retryResp);
                        if (retryResp.ok && retryJson) {
                            // update finalMsg with retry details (append)
                            finalMsg += '\n**Retry Analysis**\n\n' + formatScan(retryJson);
                            // incorporate any new recommendations
                            if (retryJson.recommendations && retryJson.recommendations.length > 0) {
                                finalMsg += '✅ Added recommendations from retry.\n';
                            }
                        }
                    } catch (e) {
                        // retry scan failed
                    }
                }

                if (!finalMsg) finalMsg = '⚠️ No useful analysis returned. Try a clearer close-up photo, good lighting, or add a short prompt (e.g., "Is this red rot?").';

                addMessage(finalMsg, 'bot');
                lastBotMessage = finalMsg;

            } catch (err) {
                // image analysis error
                addMessage('❌ Image analysis failed: ' + (err.message || err), 'error');
                    } finally {
                        // Clear attached image (guard DOM accesses)
                        attachedImageFile = null;
                        const _cInput = document.getElementById('chatImageInput');
                        if (_cInput) _cInput.value = '';
                        const _imgBar = document.getElementById('imagePreviewBar');
                        if (_imgBar) _imgBar.style.display = 'none';
                        const _qEl = document.getElementById('question');
                        if (_qEl) _qEl.placeholder = 'Ask your question...';
                    }

        } else {
            // Regular text question
            // sending question to /ask endpoint
            const res = await fetch('/ask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    question: question,
                    language: lang
                })
            });

            const data = await res.json();
            // response from /ask endpoint

            if (!res.ok) {
                addMessage(data.error || 'Failed to get response', 'error');
            } else {
                addMessage(data.response, 'bot');
                lastBotMessage = data.response;
            }
        }
        } catch (error) {
        // fetch error
        addMessage('Network error: ' + error.message, 'error');
    } finally {
        hideLoading();
        if (sendBtn) sendBtn.disabled = false;
    }
}

// Voice Recognition Setup
let isListening = false;
function initSpeechRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

                recognition.onstart = () => {
                    isListening = true;
                    const voiceBtn = document.getElementById('voiceBtn');
                    if (voiceBtn) {
                        voiceBtn.textContent = '🔴';
                        voiceBtn.title = 'Listening... (tap to stop)';
                    }
                    // voice recognition started
                };

                recognition.onend = () => {
                    isListening = false;
                    const voiceBtn = document.getElementById('voiceBtn');
                    if (voiceBtn) {
                        voiceBtn.textContent = '🎤';
                        voiceBtn.title = 'Voice Input';
                    }
                    // voice recognition ended
                };

                recognition.onresult = (event) => {
                    const transcript = event.results[0][0].transcript;
                    // voice transcript captured
                    const qEl = document.getElementById('question');
                    if (qEl) {
                        qEl.value = transcript;
                        // Auto-focus and expand textarea
                        qEl.focus();
                        qEl.style.height = 'auto';
                        qEl.style.height = Math.min(qEl.scrollHeight, 120) + 'px';
                    }
                };

                recognition.onerror = (event) => {
                    // voice recognition error
                    isListening = false;
                    const voiceBtn = document.getElementById('voiceBtn');
                    if (voiceBtn) {
                        voiceBtn.textContent = '🎤';
                        voiceBtn.title = 'Voice Input';
                    }
                    const friendly = getFriendlyVoiceError(event.error);
                    addMessage(friendly, 'error');
                };

                // Voice Button
                const vb = document.getElementById('voiceBtn');
                if (vb) vb.addEventListener('click', () => {
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
                addMessage('Voice needs internet connection. You appear to be offline.', 'error');
                return;
            }

            // Check if browser supports speech recognition
            if (!recognition) {
                addMessage('Voice input not supported in this browser. Try Chrome or Edge.', 'error');
                return;
            }

            // Set language and start
            const lang = 'en-US'; // Always use English
            recognition.lang = lang;
            // starting voice recognition with language
            
            try {
                recognition.start();
            } catch (e) {
                // recognition start failed
                if (e.name === 'InvalidStateError') {
                    // Already running, try to stop and restart
                    recognition.stop();
                    setTimeout(() => {
                        try { recognition.start(); } catch (e2) { 
                            addMessage('Voice recognition failed to start. Please try again.', 'error');
                        }
                    }, 100);
                } else {
                    addMessage('Could not start voice recognition: ' + e.message, 'error');
                }
            }
        });
    } else {
        // speech recognition not supported in this browser
        // Disable voice button
        const voiceBtn = document.getElementById('voiceBtn');
        if (voiceBtn) {
            voiceBtn.disabled = true;
            voiceBtn.title = 'Voice input not supported in this browser';
        }
    }
}

function getFriendlyVoiceError(code) {
    const map = {
        'network': '🌐 Voice service needs internet. Check your connection and try again. (Tip: Voice recognition requires an active internet connection)',
        'no-speech': '🤫 No speech detected. Speak clearly into your microphone and try again.',
        'audio-capture': '🎤 No microphone found. Please connect a microphone or enable microphone access.',
        'not-allowed': '🚫 Microphone blocked. Allow microphone access in your browser settings (usually a 🎤 icon in the address bar).',
        'service-not-allowed': '⛔ Voice service blocked by browser. Check site permissions in your browser settings.',
        'aborted': '⏹️ Voice input cancelled. Tap the mic button to try again.',
        'language-not-supported': '🌍 Voice recognition doesn\'t support this language. Try switching to English, Hindi, or another supported language.'
    };
    return map[code] || ('⚠️ Voice recognition error: ' + code + '. Please try again.');
}

function updateVoiceAvailability() {
    const btn = document.getElementById('voiceBtn');
    if (!btn) return;
    const supported = ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
    const online = navigator.onLine;
    btn.disabled = !(supported && online);
    btn.setAttribute('aria-disabled', String(btn.disabled));
    btn.title = btn.disabled ? (supported ? 'Voice needs internet connection' : 'Voice input not supported on this browser') : 'Voice Input';
}

// Text-to-Speech
safeAddEvent('speakBtn', 'click', () => {
    if (!lastBotMessage) {
        alert('No message to read');
        return;
    }

    if (synthesis.speaking) {
        synthesis.cancel();
    }

    const lang = 'en-US'; // Always use English
    currentUtterance = new SpeechSynthesisUtterance(lastBotMessage);
    currentUtterance.lang = lang;
    synthesis.speak(currentUtterance);

    const sp = document.getElementById('speakBtn');
    const st = document.getElementById('stopSpeakBtn');
    if (sp) sp.style.display = 'none';
    if (st) st.style.display = 'inline-block';
});

safeAddEvent('stopSpeakBtn', 'click', () => {
    if (synthesis.speaking) {
        synthesis.cancel();
    }
    const sp = document.getElementById('speakBtn');
    const st = document.getElementById('stopSpeakBtn');
    if (sp) sp.style.display = 'inline-block';
    if (st) st.style.display = 'none';
});
