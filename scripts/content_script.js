console.log("[AutoCloser-Agent] Content script active on DEL CRM.");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "PLAY_STEPS") {
    sendResponse({ status: "PLAYBACK_STARTED" });
    replayRecordedSteps(message.steps);
    return true;
  }

  if (message.action === "INSERT_INTO_NOTES_LOG") {
    insertStagedNoteIntoDceNotesLog(message.notesText);
    sendResponse({ status: "NOTE_INSERTED" });
    return true;
  }

  // Find latest case by date, open it, and navigate straight to Notes Log
  if (message.action === "FIND_LATEST_AND_OPEN_NOTES") {
    findLatestTicketAndOpenNotesLog(message.tabType);
    sendResponse({ status: "SCANNING_INITIATED" });
    return true;
  }

  return true;
});

// --- LATEST TICKET DETECTOR & NOTES LOG OPENER ---

async function findLatestTicketAndOpenNotesLog(tabType) {
  // 1. Click target tab (Open Cases vs Closed Cases)
  const navTabs = Array.from(document.querySelectorAll('.nav-link, button, [role="tab"], .btn, span'));
  const targetTab = navTabs.find(el => {
    const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
    return tabType === "OPEN" ? txt === "open cases" : txt === "closed cases";
  });

  if (targetTab) {
    targetTab.click();
    targetTab.dispatchEvent(new Event('click', { bubbles: true }));
  }

  await new Promise(r => setTimeout(r, 700));

  // 2. Query all table rows
  const rowElements = Array.from(document.querySelectorAll('ngx-datatable datatable-body-row, .datatable-body-row, tbody tr'));
  
  if (!rowElements || rowElements.length === 0) {
    chrome.runtime.sendMessage({ action: "NO_CASES_FOUND", tabType: tabType });
    return;
  }

  const parsedCases = [];

  rowElements.forEach((row, index) => {
    const rowText = row.innerText || row.textContent || "";
    const cells = Array.from(row.querySelectorAll('.datatable-body-cell, td'));

    // Extract Reference
    const refMatch = rowText.match(/C-\d{8}-\d+|C-\d{4,}/i) || rowText.match(/\b\d{7,}\b/);
    const ticketRef = refMatch ? refMatch[0] : `Ticket #${index + 1}`;

    // Extract Date (e.g. 24 Aug 2026 14:30 or 2026-08-24)
    const dateMatch = rowText.match(/\d{2}\s+[A-Za-z]{3}\s+\d{4}(\s+\d{2}:\d{2})?/) || rowText.match(/\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2})?/);
    let parsedTimestamp = 0;
    let rawDateStr = "";

    if (dateMatch) {
      rawDateStr = dateMatch[0];
      const parsedDate = new Date(rawDateStr);
      parsedTimestamp = !isNaN(parsedDate.getTime()) ? parsedDate.getTime() : 0;
    }

    // Extract Case Title
    let caseTitle = "";
    for (const cell of cells) {
      const txt = cell.innerText.trim();
      if (/PAYMENT|CLAIM|VERIFICATION|LOCKED|RESET|BARRIER|REGISTRATION|CREDIT|NORMAL|ENQUIRY/i.test(txt) && !txt.startsWith("C-202")) {
        caseTitle = txt;
        break;
      }
    }
    if (!caseTitle && cells.length >= 4) {
      caseTitle = cells[3].innerText.trim();
    }

    // Extract Case Creator (Looking for Agent name / Employee pattern or specific column)
    let creator = "";
    for (const cell of cells) {
      const txt = cell.innerText.trim();
      // Agent names typically have a space, no digits, and aren't statuses
      if (/^[A-Za-z]+(\s+[A-Za-z]+)+$/.test(txt) && !/Resolved|Closed|Open|Pending|Medium|Normal|High|Telephone/i.test(txt)) {
        creator = txt;
      }
    }

    parsedCases.push({
      element: row,
      rowIndex: index,
      ticketRef: ticketRef,
      caseTitle: caseTitle || "Customer Query",
      date: rawDateStr,
      timestamp: parsedTimestamp,
      creator: creator || "Agent / System"
    });
  });

  // 3. Sort to find the newest by date
  parsedCases.sort((a, b) => b.timestamp - a.timestamp);
  const latestCase = parsedCases[0];

  // 4. Click to open the latest case
  const clickTarget = latestCase.element.querySelector('a, .datatable-body-cell, span') || latestCase.element;
  clickTarget.scrollIntoView({ block: 'center' });
  clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

  // 5. Poll and click into "Notes Log" tab automatically
  for (let poll = 0; poll < 18; poll++) {
    await new Promise(r => setTimeout(r, 200));
    const allTabs = Array.from(document.querySelectorAll('.nav-link, a, [role="tab"], button, span'));
    const notesLogTab = allTabs.find(el => {
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      return txt === "notes log" || txt.includes("notes log");
    });

    if (notesLogTab) {
      notesLogTab.scrollIntoView({ block: 'center' });
      notesLogTab.click();
      notesLogTab.dispatchEvent(new Event('click', { bubbles: true }));
      break;
    }
  }

  // 6. Notify side panel of the found details
  chrome.runtime.sendMessage({
    action: "LATEST_CASE_FOUND",
    ticketRef: latestCase.ticketRef,
    caseTitle: latestCase.caseTitle,
    date: latestCase.date,
    creator: latestCase.creator
  });
}

// Target locator
function locateTargetElement(targetSelector) {
  let el = document.querySelector(targetSelector);
  if (el) return el;

  const fcnMatch = targetSelector.match(/formcontrolname=["']([^"']+)["']/i);
  if (fcnMatch) {
    const fcn = fcnMatch[1];
    el = document.querySelector(`[formcontrolname="${fcn}"]`) || 
         document.getElementById(`sc_cases-${fcn}`) ||
         document.getElementById(fcn);
    if (el) return el;
  }

  const idMatch = targetSelector.match(/#([\w\-]+)/);
  if (idMatch) {
    el = document.getElementById(idMatch[1]);
    if (el) return el;
  }
  return null;
}

// Precise Replay Engine
async function replayRecordedSteps(steps) {
  if (!steps || steps.length === 0) {
    chrome.runtime.sendMessage({ action: "PLAYBACK_FINISHED" });
    return;
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let element = locateTargetElement(step.target);

    if (!element) {
      for (let retry = 0; retry < 18; retry++) {
        await new Promise(r => setTimeout(r, 200));
        element = locateTargetElement(step.target);
        if (element) break;
      }
    }

    if (!element) continue;

    if (step.action === "input") {
      element.focus();
      element.value = step.inputValue || "";
      try {
        const proto = element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (nativeSetter) nativeSetter.call(element, step.inputValue || "");
      } catch (e) {}

      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (step.action === "select" || element.tagName === "SELECT") {
      let matchedOpt = null;
      const targetChoice = (step.savedOptionChoice || "").toLowerCase().trim();
      const targetVal = (step.savedOptionValue || "").toString().toLowerCase().trim();

      for (let optRetry = 0; optRetry < 20; optRetry++) {
        matchedOpt = Array.from(element.options).find(o => {
          const optText = o.text.toLowerCase().trim();
          const optVal = o.value.toString().toLowerCase().trim();
          return (
            optText === targetChoice ||
            optVal === targetVal ||
            (targetChoice.includes("normal") && optText.includes("normal")) ||
            (targetChoice.length > 3 && optText.includes(targetChoice))
          );
        });

        if (matchedOpt) break;
        await new Promise(r => setTimeout(r, 150));
      }

      if (matchedOpt) {
        element.selectedIndex = matchedOpt.index;
        element.value = matchedOpt.value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      element.scrollIntoView({ block: 'center' });
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }

    await new Promise(r => setTimeout(r, step.delay || 700));
  }

  chrome.runtime.sendMessage({ action: "PLAYBACK_FINISHED" });
}

function insertStagedNoteIntoDceNotesLog(notesText) {
  const noteSelectors = [
    'textarea[formcontrolname="note_text"]',
    'textarea[formcontrolname="notes"]',
    '#notes-log-textarea',
    'textarea[name*="note" i]',
    '.notes-log textarea',
    'textarea'
  ];

  let targetBox = null;
  for (const selector of noteSelectors) {
    const el = document.querySelector(selector);
    if (el && el.offsetParent !== null) {
      targetBox = el;
      break;
    }
  }

  if (!targetBox) {
    alert("Please ensure the Notes Log tab is selected and the note entry field is visible.");
    return;
  }

  targetBox.focus();
  targetBox.value = notesText;
  targetBox.dispatchEvent(new Event('input', { bubbles: true }));
  targetBox.dispatchEvent(new Event('change', { bubbles: true }));
}