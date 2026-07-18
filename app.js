const STORAGE_KEYS = {
  dreams: 'dreams.items',
  settings: 'dreams.settings',
  chat: 'dreams.chatHistory',
};

const DEFAULT_SETTINGS = {
  apiUrl: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-chat',
  apiKey: '',
  instruction: 'Ты — тёплый и проницательный наставник. Оцени мечту пользователя кратко (2-4 предложения): почему она ценна и какой первый маленький шаг к ней можно сделать.',
};

let dreams = loadJSON(STORAGE_KEYS.dreams, []);
let settings = { ...DEFAULT_SETTINGS, ...loadJSON(STORAGE_KEYS.settings, {}) };
let chatHistory = loadJSON(STORAGE_KEYS.chat, []);
let activeTab = 'all';

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveDreams() { localStorage.setItem(STORAGE_KEYS.dreams, JSON.stringify(dreams)); }
function saveSettings() { localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings)); }
function saveChat() { localStorage.setItem(STORAGE_KEYS.chat, JSON.stringify(chatHistory)); }

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function callAI(messages) {
  if (!settings.apiKey) {
    throw new Error('Добавь API-ключ в настройках, чтобы получить ответ от нейросети.');
  }
  let res;
  try {
    res = await fetch(settings.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({ model: settings.model, messages, stream: false }),
    });
  } catch {
    throw new Error('Не удалось подключиться к API. Проверьте адрес API и подключение к интернету.');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`Ошибка API (${res.status})${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Пустой ответ от API.');
  return content.trim();
}

// ---------- Dreams ----------

function renderDreams() {
  const list = document.getElementById('dreamList');
  const empty = document.getElementById('emptyState');
  const items = activeTab === 'favorites' ? dreams.filter((d) => d.favorited) : dreams;

  list.innerHTML = '';
  empty.classList.toggle('hidden', items.length > 0);
  if (activeTab === 'favorites' && items.length === 0 && dreams.length > 0) {
    empty.classList.remove('hidden');
    empty.querySelector('p').textContent = 'Пока нет избранных оценок. Отметь звёздочкой понравившуюся оценку мечты.';
  } else if (items.length === 0) {
    empty.querySelector('p').textContent = 'Пока пусто. Запиши первую мечту — и получишь оценку от нейросети.';
  }

  for (const dream of [...items].reverse()) {
    list.appendChild(renderDreamCard(dream));
  }
}

function renderDreamCard(dream) {
  const li = document.createElement('li');
  li.className = 'dream-card';

  let evalHtml = '';
  if (dream.loading) {
    evalHtml = `
      <div class="eval-panel">
        <div class="eval-label">Оценка нейросети</div>
        <div class="dots"><span></span><span></span><span></span></div>
      </div>`;
  } else if (dream.evaluation) {
    const isError = dream.evalError;
    evalHtml = `
      <div class="eval-panel ${isError ? 'error' : ''}">
        <div class="eval-label">
          <span>${isError ? 'Не удалось получить оценку' : 'Оценка нейросети'}</span>
          ${!isError ? `<button class="tiny-btn star ${dream.favorited ? 'active' : ''}" data-action="favorite" data-id="${dream.id}" aria-label="В избранное">★</button>` : ''}
        </div>
        <p class="eval-text ${isError ? 'error' : ''}">${escapeHtml(dream.evaluation)}</p>
      </div>`;
  }

  li.innerHTML = `
    <div class="dream-row">
      <div>
        <p class="dream-text">${escapeHtml(dream.text)}</p>
        <div class="dream-meta">${formatDate(dream.ts)}</div>
      </div>
      <div class="dream-actions">
        <button class="tiny-btn danger" data-action="delete" data-id="${dream.id}" aria-label="Удалить">🗑</button>
      </div>
    </div>
    ${evalHtml}
  `;
  return li;
}

async function addDream(text) {
  const dream = {
    id: crypto.randomUUID(),
    text,
    ts: Date.now(),
    evaluation: null,
    evalError: false,
    favorited: false,
    loading: true,
  };
  dreams.push(dream);
  saveDreams();
  renderDreams();

  try {
    const messages = [
      { role: 'system', content: settings.instruction },
      { role: 'user', content: `Мечта: "${text}"` },
    ];
    const evaluation = await callAI(messages);
    dream.evaluation = evaluation;
    dream.evalError = false;
  } catch (err) {
    dream.evaluation = err.message;
    dream.evalError = true;
  } finally {
    dream.loading = false;
    saveDreams();
    renderDreams();
  }
}

function deleteDream(id) {
  dreams = dreams.filter((d) => d.id !== id);
  saveDreams();
  renderDreams();
}

function toggleFavorite(id) {
  const dream = dreams.find((d) => d.id === id);
  if (dream) {
    dream.favorited = !dream.favorited;
    saveDreams();
    renderDreams();
  }
}

document.getElementById('dreamList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === 'delete') deleteDream(id);
  if (action === 'favorite') toggleFavorite(id);
});

document.getElementById('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('dreamInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addDream(text);
});

document.querySelectorAll('.segment').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.segment').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    renderDreams();
  });
});

// ---------- Settings ----------

function openOverlay(id) { document.getElementById(id).classList.remove('hidden'); }
function closeOverlay(id) { document.getElementById(id).classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => closeOverlay(btn.dataset.close));
});
document.querySelectorAll('.overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('apiUrl').value = settings.apiUrl;
  document.getElementById('apiModel').value = settings.model;
  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('instruction').value = settings.instruction;
  document.getElementById('settingsSaved').classList.add('hidden');
  openOverlay('settingsOverlay');
});

document.getElementById('toggleKeyBtn').addEventListener('click', () => {
  const field = document.getElementById('apiKey');
  const showing = field.type === 'text';
  field.type = showing ? 'password' : 'text';
  document.getElementById('toggleKeyBtn').textContent = showing ? 'Показать' : 'Скрыть';
});

document.getElementById('saveSettingsBtn').addEventListener('click', () => {
  settings.apiUrl = document.getElementById('apiUrl').value.trim() || DEFAULT_SETTINGS.apiUrl;
  settings.model = document.getElementById('apiModel').value.trim() || DEFAULT_SETTINGS.model;
  settings.apiKey = document.getElementById('apiKey').value.trim();
  settings.instruction = document.getElementById('instruction').value.trim() || DEFAULT_SETTINGS.instruction;
  saveSettings();
  const saved = document.getElementById('settingsSaved');
  saved.classList.remove('hidden');
  setTimeout(() => saved.classList.add('hidden'), 2000);
});

// ---------- Chat ----------

function renderChat() {
  const box = document.getElementById('chatMessages');
  box.innerHTML = '';
  for (const msg of chatHistory) {
    const div = document.createElement('div');
    div.className = `chat-bubble ${msg.role === 'user' ? 'user' : 'assistant'} ${msg.error ? 'error' : ''}`;
    div.textContent = msg.content;
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}

function addChatBubble(role, content, isError = false) {
  chatHistory.push({ role, content, error: isError });
  saveChat();
  renderChat();
}

document.getElementById('chatBtn').addEventListener('click', () => {
  renderChat();
  openOverlay('chatOverlay');
});

document.getElementById('clearChatBtn').addEventListener('click', () => {
  if (chatHistory.length === 0) return;
  if (!confirm('Очистить историю чата? ИИ забудет весь предыдущий разговор.')) return;
  chatHistory = [];
  saveChat();
  renderChat();
});

document.getElementById('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addChatBubble('user', text);

  const box = document.getElementById('chatMessages');
  const loadingEl = document.createElement('div');
  loadingEl.className = 'chat-bubble assistant';
  loadingEl.innerHTML = '<div class="dots"><span></span><span></span><span></span></div>';
  box.appendChild(loadingEl);
  box.scrollTop = box.scrollHeight;

  try {
    const messages = [
      { role: 'system', content: settings.instruction },
      ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
    ];
    const reply = await callAI(messages);
    loadingEl.remove();
    addChatBubble('assistant', reply);
  } catch (err) {
    loadingEl.remove();
    addChatBubble('assistant', err.message, true);
  }
});

// ---------- Init ----------

renderDreams();
