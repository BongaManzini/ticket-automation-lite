const selectCategoryFilter = document.getElementById('select-category-filter');
const dispositionChipsContainer = document.getElementById('disposition-chips');
const txtCallNotes = document.getElementById('txt-call-notes');
const btnCopyNotes = document.getElementById('btn-copy-notes');
const btnPasteToDce = document.getElementById('btn-paste-to-dce');
const btnClearNotes = document.getElementById('btn-clear-notes');
const copyFeedback = document.getElementById('copy-feedback');
const statusDot = document.getElementById('status-dot');
const lblEngineState = document.getElementById('lbl-engine-state');
const lblPresetsCount = document.getElementById('lbl-presets-count');
const lblPackageVer = document.getElementById('lbl-package-ver');
const inputImportProfiles = document.getElementById('input-import-profiles');

const rfpCalendarInput = document.getElementById('rfp-calendar-input');
const btnInsertDate = document.getElementById('btn-insert-date');
const btnTodayDate = document.getElementById('btn-today-date');

const lblCharsCount = document.getElementById('lbl-chars-count');
const lblWordsCount = document.getElementById('lbl-words-count');

// Latest Case Scanner Elements
const btnScanLatestOpen = document.getElementById('btn-scan-latest-open');
const btnScanLatestClosed = document.getElementById('btn-scan-latest-closed');
const lblScanStatus = document.getElementById('lbl-scan-status');
const latestCaseCard = document.getElementById('latest-case-card');
const dispTicketRef = document.getElementById('disp-ticket-ref');
const dispCaseTitle = document.getElementById('disp-case-title');
const dispCaseDate = document.getElementById('disp-case-date');
const dispCaseCreator = document.getElementById('disp-case-creator');

let allProfiles = {};

const now = new Date();
const todayFormatted = now.toISOString().split('T')[0];
if (rfpCalendarInput) rfpCalendarInput.value = todayFormatted;

function formatDateToStandard(dateStr) {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split('-');
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${monthNames[parseInt(month, 10) - 1]} ${year}`;
}

// Active Tab Messenger
async function sendMessageToActiveTab(msg, callback) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab?.id) {
      dispatch(activeTab.id);
      return;
    }
    const crmTabs = await chrome.tabs.query({
      url: ["https://*.alteram.co.za/*", "https://dcl.crmprod.alteram.co.za/*"],
      currentWindow: true
    });
    if (crmTabs[0]?.id) {
      dispatch(crmTabs[0].id);
      return;
    }
    alert("Please click into the DEL CRM tab first.");

    function dispatch(tabId) {
      chrome.tabs.sendMessage(tabId, msg, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[AutoCloser] Tab communication error:", chrome.runtime.lastError.message);
        } else if (callback) {
          callback(response);
        }
      });
    }
  } catch (err) {
    console.error("[AutoCloser] Dispatch Error:", err);
  }
}

// 1. Boot Loader
function initializeAgentWorkspace() {
  chrome.storage.local.get(["agentMasterPresets", "agentPackageDate", "currentDraftNotes"], (res) => {
    if (res.currentDraftNotes && txtCallNotes) {
      txtCallNotes.value = res.currentDraftNotes;
      updateTextCounters();
    }

    if (res.agentMasterPresets && Object.keys(res.agentMasterPresets).length > 0) {
      allProfiles = res.agentMasterPresets;
      if (lblPackageVer) lblPackageVer.innerText = `Package: Active (${res.agentPackageDate || 'Imported'})`;
      populateCategoryDropdown();
      renderFilteredChips();
    } else {
      fetch(chrome.runtime.getURL('presets.json'))
        .then(r => r.json())
        .then(defaultBundle => {
          allProfiles = defaultBundle.profiles || defaultBundle;
          if (lblPackageVer) lblPackageVer.innerText = `Package: Bundled Master`;
          populateCategoryDropdown();
          renderFilteredChips();
        })
        .catch(() => {
          if (lblPresetsCount) lblPresetsCount.innerText = "0 Loaded";
        });
    }
  });
}

// 2. Populate Category Filter Dropdown
function populateCategoryDropdown() {
  if (!selectCategoryFilter) return;
  selectCategoryFilter.innerHTML = '<option value="ALL">📁 All Presets (Show All)</option>';

  const categorySet = new Set();

  Object.keys(allProfiles).forEach(key => {
    const item = allProfiles[key];
    const cat = item.category || extractCategoryFromSteps(item.steps) || "General Inquiries";
    if (cat) categorySet.add(cat);
  });

  Array.from(categorySet).sort().forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = `📂 ${cat}`;
    selectCategoryFilter.appendChild(opt);
  });
}

function extractCategoryFromSteps(steps) {
  if (!steps) return null;
  const l2Step = steps.find(s => s.target && s.target.includes("classification_l2"));
  return l2Step ? l2Step.savedOptionChoice : null;
}

selectCategoryFilter.addEventListener('change', () => {
  renderFilteredChips();
});

// 3. Render Buttons filtered by the active Dropdown Selection
function renderFilteredChips() {
  if (!dispositionChipsContainer) return;
  dispositionChipsContainer.innerHTML = '';

  const selectedCategory = selectCategoryFilter.value;
  const allKeys = Object.keys(allProfiles);

  const filteredKeys = allKeys.filter(key => {
    if (selectedCategory === "ALL") return true;
    const item = allProfiles[key];
    const cat = item.category || extractCategoryFromSteps(item.steps) || "General Inquiries";
    return cat === selectedCategory;
  });

  if (lblPresetsCount) lblPresetsCount.innerText = `${filteredKeys.length} / ${allKeys.length} Showing`;

  if (filteredKeys.length === 0) {
    dispositionChipsContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--muted); padding: 15px 0;">
        No presets found for this category.
      </div>
    `;
    return;
  }

  filteredKeys.forEach(key => {
    const item = allProfiles[key];
    const chip = document.createElement('button');
    chip.className = 'btn-chip';
    const stepCount = item.steps ? item.steps.length : 0;

    chip.innerHTML = `
      <div style="font-size: 8px; color: var(--accent); font-weight: bold; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${item.caseTitle || "QUERY"}
      </div>
      <div style="font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ⚡ ${key}
      </div>
    `;

    chip.title = `1-Tap Automation: Replays ${stepCount} actions.\nAuto-populates Title, Classifications, Status & Notes.`;

    chip.addEventListener('click', () => {
      document.querySelectorAll('.btn-chip').forEach(c => c.classList.remove('active-running'));
      chip.classList.add('active-running');

      let note = item.notes_template || item.notes || `QUERY: ${key}`;
      const chosenDateFormatted = formatDateToStandard(rfpCalendarInput ? rfpCalendarInput.value : todayFormatted);
      note = note.replace(/\[Insert Date\]|\[DATE\]/gi, chosenDateFormatted);

      if (txtCallNotes) {
        txtCallNotes.value = note;
        updateTextCounters();
        chrome.storage.local.set({ currentDraftNotes: note });
      }

      if (item.steps && item.steps.length > 0) {
        updateUIState("RUNNING");
        sendMessageToActiveTab({ action: "PLAY_STEPS", steps: item.steps });
      } else {
        alert(`No recorded steps found for "${key}".`);
      }
    });

    dispositionChipsContainer.appendChild(chip);
  });
}

// 4. Latest Ticket Scanner Handlers
btnScanLatestOpen.addEventListener('click', () => {
  lblScanStatus.innerText = "Finding Latest Open Case...";
  sendMessageToActiveTab({ action: "FIND_LATEST_AND_OPEN_NOTES", tabType: "OPEN" });
});

btnScanLatestClosed.addEventListener('click', () => {
  lblScanStatus.innerText = "Finding Latest Closed Case...";
  sendMessageToActiveTab({ action: "FIND_LATEST_AND_OPEN_NOTES", tabType: "CLOSED" });
});

// Listener for Scanned Latest Ticket Data
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "LATEST_CASE_FOUND") {
    lblScanStatus.innerText = `Opened ${message.ticketRef}`;
    dispTicketRef.innerText = message.ticketRef;
    dispCaseTitle.innerText = message.caseTitle;
    dispCaseDate.innerText = message.date || "Date unlisted";
    dispCaseCreator.innerText = message.creator || "System / Agent";
    latestCaseCard.style.display = "block";
  }

  if (message.action === "NO_CASES_FOUND") {
    lblScanStatus.innerText = `No ${message.tabType} cases found`;
    alert(`No ${message.tabType} tickets were found on this customer profile.`);
  }

  if (message.action === "PLAYBACK_FINISHED") {
    updateUIState("IDLE");
    document.querySelectorAll('.btn-chip').forEach(c => c.classList.remove('active-running'));
  }
});

// 5. Update Master JSON Package
if (inputImportProfiles) {
  inputImportProfiles.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        const incoming = data.profiles || data;
        allProfiles = incoming;

        const packageDate = data.createdAt ? new Date(data.createdAt).toLocaleDateString() : new Date().toLocaleDateString();

        chrome.storage.local.set({
          agentMasterPresets: allProfiles,
          agentPackageDate: packageDate
        }, () => {
          if (lblPackageVer) lblPackageVer.innerText = `Package: Active (${packageDate})`;
          populateCategoryDropdown();
          renderFilteredChips();
          alert(`Master configuration updated! Loaded ${Object.keys(allProfiles).length} profiles.`);
        });
      } catch (err) {
        alert("Invalid master preset JSON file.");
      }
    };
    reader.readAsText(file);
  });
}

function updateUIState(state) {
  if (!statusDot || !lblEngineState) return;
  if (state === "RUNNING") {
    statusDot.style.backgroundColor = "#38bdf8";
    statusDot.style.boxShadow = "0 0 8px #38bdf8";
    lblEngineState.innerText = "Executing...";
    lblEngineState.style.color = "#38bdf8";
  } else {
    statusDot.style.backgroundColor = "#107c41";
    statusDot.style.boxShadow = "0 0 6px rgba(16, 124, 65, 0.5)";
    lblEngineState.innerText = "Ready";
    lblEngineState.style.color = "var(--muted)";
  }
}

function updateTextCounters() {
  if (!txtCallNotes) return;
  const text = txtCallNotes.value || "";
  if (lblCharsCount) lblCharsCount.innerText = `${text.length} chars`;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (lblWordsCount) lblWordsCount.innerText = `${words} words`;
}

if (txtCallNotes) {
  txtCallNotes.addEventListener('input', () => {
    updateTextCounters();
    chrome.storage.local.set({ currentDraftNotes: txtCallNotes.value });
  });
}

if (btnCopyNotes) {
  btnCopyNotes.addEventListener('click', () => {
    if (!txtCallNotes || !txtCallNotes.value) return;
    navigator.clipboard.writeText(txtCallNotes.value);
    if (copyFeedback) {
      copyFeedback.style.display = 'inline';
      setTimeout(() => { copyFeedback.style.display = 'none'; }, 1500);
    }
  });
}

if (btnPasteToDce) {
  btnPasteToDce.addEventListener('click', () => {
    if (!txtCallNotes) return;
    sendMessageToActiveTab({
      action: "INSERT_INTO_NOTES_LOG",
      notesText: txtCallNotes.value
    });
  });
}

if (btnClearNotes) {
  btnClearNotes.addEventListener('click', () => {
    if (txtCallNotes) txtCallNotes.value = '';
    updateTextCounters();
    chrome.storage.local.remove(["currentDraftNotes"]);
  });
}

if (btnTodayDate) {
  btnTodayDate.addEventListener('click', () => {
    if (rfpCalendarInput) rfpCalendarInput.value = todayFormatted;
  });
}

if (btnInsertDate) {
  btnInsertDate.addEventListener('click', () => {
    const selectedDate = rfpCalendarInput ? rfpCalendarInput.value : "";
    if (!selectedDate) return;
    const formatted = formatDateToStandard(selectedDate);
    const currentText = txtCallNotes ? txtCallNotes.value : "";

    if (/DATE OF SUBMISSION\s*:\s*(\[.*?\]|[\d\w\s]+)/i.test(currentText)) {
      txtCallNotes.value = currentText.replace(/DATE OF SUBMISSION\s*:\s*(\[.*?\]|[\d\w\s]+)/i, `DATE OF SUBMISSION : ${formatted}`);
    } else if (/\[Insert Date\]|\[DATE\]/gi.test(currentText)) {
      txtCallNotes.value = currentText.replace(/\[Insert Date\]|\[DATE\]/gi, formatted);
    } else {
      txtCallNotes.value += `\nDATE OF SUBMISSION : ${formatted}`;
    }
    updateTextCounters();
    chrome.storage.local.set({ currentDraftNotes: txtCallNotes.value });
  });
}

initializeAgentWorkspace();