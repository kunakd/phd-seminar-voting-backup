(function () {
  "use strict";

  const auth = firebase.auth();
  const db = firebase.firestore();
  const form = document.getElementById("voteForm");
  const seminarSelect = document.getElementById("seminar");
  const presentationsDiv = document.getElementById("presentations");
  const message = document.getElementById("message");
  const submitButton = form.querySelector('button[type="submit"]');
  const status = document.getElementById("votingWindowStatus");

  const WINDOWS = {
    "Seminar 1": ["2026-11-12T23:00:00Z", "2026-11-19T23:00:00Z"],
    "Seminar 2": ["2026-12-10T23:00:00Z", "2026-12-17T23:00:00Z"],
    "Seminar 3": ["2027-01-14T23:00:00Z", "2027-01-21T23:00:00Z"],
    "Seminar 4": ["2027-02-11T23:00:00Z", "2027-02-18T23:00:00Z"],
    "Seminar 6": ["2027-04-15T22:00:00Z", "2027-04-22T22:00:00Z"],
    "Seminar 7": ["2027-05-13T22:00:00Z", "2027-05-20T22:00:00Z"]
  };
  const PREFIX = "phd-vote-draft-v3";
  const LEGACY_PREFIX = "phd-voting-draft-2026-2027";
  const DRAFT_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
  const completed = new Set();
  let renderedSeminar = "";
  let renderedUid = "";
  let busy = false;
  let pending = false;
  let storageWarning = false;

  function authorized(user) {
    return Boolean(user && user.emailVerified && typeof user.email === "string" &&
      /^[^@\s]+@(natur\.cuni\.cz|uochb\.cas\.cz)$/i.test(user.email));
  }

  function presenters(seminar) {
    const data = window.SEMINARS && window.SEMINARS[seminar];
    return Object.hasOwn(WINDOWS, seminar) && data &&
      Array.isArray(data.presenters) && data.presenters.length > 0
      ? data.presenters : null;
  }

  function key(prefix, uid, seminar) {
    return [prefix, encodeURIComponent(uid), encodeURIComponent(seminar)].join(":");
  }

  function notify(text, error) {
    message.textContent = text;
    message.className = error ? "error" : "success";
  }

  function draftValues() {
    const names = presenters(renderedSeminar);
    if (!names || presentationsDiv.querySelectorAll("select").length !== names.length) return null;
    return names.map((name, i) => ({
      name,
      score: document.getElementById(`pres${i + 1}`).value,
      comment: document.getElementById(`comment${i + 1}`).value
    }));
  }

  function saveDraft() {
    if (!renderedUid || !renderedSeminar || completed.has(`${renderedUid}:${renderedSeminar}`)) return;
    const values = draftValues();
    if (!values) return;
    try {
      localStorage.setItem(key(PREFIX, renderedUid, renderedSeminar), JSON.stringify({
        savedAt: Date.now(), presentations: values
      }));
      storageWarning = false;
    } catch (error) {
      storageWarning = true;
      console.warn("Draft storage unavailable", error);
      if (!busy) notify("Warning: this browser cannot save your draft. Do not close this page.", true);
    }
  }

  function readDraft(uid, seminar) {
    try {
      const raw = localStorage.getItem(key(PREFIX, uid, seminar)) ||
        localStorage.getItem(key(LEGACY_PREFIX, uid, seminar));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.presentations) ||
          !Number.isFinite(data.savedAt) || data.savedAt > Date.now() + 60000 ||
          Date.now() - data.savedAt > DRAFT_MAX_AGE) return null;
      const names = presenters(seminar);
      if (!names || data.presentations.length !== names.length ||
          !names.every((name, i) => data.presentations[i]?.name === name)) return null;
      return data.presentations;
    } catch (error) {
      console.warn("Cannot restore draft", error);
      return null;
    }
  }

  function clearDraft(uid, seminar) {
    for (const prefix of [PREFIX, LEGACY_PREFIX]) {
      try { localStorage.removeItem(key(prefix, uid, seminar)); }
      catch (error) { console.warn("Cannot clear draft", error); }
    }
  }

  function windowState(seminar) {
    if (!presenters(seminar)) return "unselected";
    const [start, end] = WINDOWS[seminar].map(Date.parse);
    const now = Date.now();
    return now < start ? "upcoming" : now >= end ? "closed" : "open";
  }

  function pragueTime(iso) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Prague", day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).format(new Date(iso));
  }

  function refresh() {
    const user = auth.currentUser;
    const seminar = seminarSelect.value;
    const state = windowState(seminar);
    const finished = user && completed.has(`${user.uid}:${seminar}`);
    const enabled = authorized(user) && state === "open" && !busy && !pending && !finished;
    submitButton.disabled = !enabled;
    seminarSelect.disabled = busy || pending;
    presentationsDiv.querySelectorAll("select, textarea").forEach(el => { el.disabled = !enabled; });

    if (pending) status.textContent = "Submission pending: waiting for server confirmation. Do not submit again.";
    else if (busy) status.textContent = "Submitting evaluation. Please wait.";
    else if (finished) status.textContent = "Your evaluation was submitted successfully.";
    else if (state === "unselected") status.textContent = "Select a seminar.";
    else if (state === "upcoming") status.textContent = `Voting opens ${pragueTime(WINDOWS[seminar][0])} (Prague time).`;
    else if (state === "closed") status.textContent = `Voting closed ${pragueTime(WINDOWS[seminar][1])} (Prague time).`;
    else status.textContent = `Voting closes ${pragueTime(WINDOWS[seminar][1])} (Prague time).`;
    return enabled;
  }

  function render(seminar) {
    presentationsDiv.replaceChildren();
    renderedSeminar = seminar;
    renderedUid = authorized(auth.currentUser) ? auth.currentUser.uid : "";
    const names = presenters(seminar);
    if (!names || !renderedUid) { refresh(); return; }

    names.forEach((name, i) => {
      const block = document.createElement("div");
      block.className = "presentation-block";
      const heading = document.createElement("h3");
      heading.textContent = name;
      block.append(heading);
      const label = document.createElement("label");
      label.htmlFor = `pres${i + 1}`;
      label.textContent = "Score (1 = worst, 10 = best)";
      const select = document.createElement("select");
      select.id = label.htmlFor;
      select.required = true;
      select.add(new Option("-- Select --", ""));
      for (let score = 1; score <= 10; score++) select.add(new Option(String(score), String(score)));
      select.addEventListener("change", saveDraft);
      const commentLabel = document.createElement("label");
      commentLabel.htmlFor = `comment${i + 1}`;
      commentLabel.textContent = "Comment (optional)";
      const textarea = document.createElement("textarea");
      textarea.id = commentLabel.htmlFor;
      textarea.rows = 3;
      textarea.maxLength = 2000;
      textarea.addEventListener("input", saveDraft);
      block.append(label, select, commentLabel, textarea);
      presentationsDiv.append(block);
    });

    const draft = readDraft(renderedUid, seminar);
    if (draft) {
      draft.forEach((item, i) => {
        const score = String(item.score ?? "");
        if (score === "" || /^(?:[1-9]|10)$/.test(score))
          document.getElementById(`pres${i + 1}`).value = score;
        if (typeof item.comment === "string")
          document.getElementById(`comment${i + 1}`).value = item.comment.slice(0, 2000);
      });
      notify("Your saved evaluation draft has been restored.", false);
    }
    refresh();
  }

  function updateVotingAccess() {
    if (busy || pending) return;
    const user = auth.currentUser;
    const allowed = authorized(user);
    const nextUid = allowed ? user.uid : "";
    if (nextUid !== renderedUid) {
      saveDraft();
      renderedUid = "";
      renderedSeminar = "";
      presentationsDiv.replaceChildren();
      seminarSelect.value = "";
      message.textContent = "";
    }
    form.style.display = allowed ? "block" : "none";
    if (allowed && seminarSelect.value && !presentationsDiv.children.length)
      render(seminarSelect.value);
    refresh();
  }

  window.updateVotingAccess = updateVotingAccess;

  seminarSelect.addEventListener("change", () => {
    if (busy || pending) return;
    saveDraft(); // Saves the OLD rendered seminar before replacing its controls.
    message.textContent = "";
    render(seminarSelect.value);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveDraft();
    refresh();
  });
  window.addEventListener("pagehide", saveDraft);
  window.addEventListener("offline", () => {
    saveDraft();
    if (!busy && !pending) notify("You are offline. Your draft remains on this device if browser storage is available.", true);
  });
  setInterval(refresh, 30000);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || pending) return;
    const user = auth.currentUser;
    const seminar = seminarSelect.value;
    if (!authorized(user) || !presenters(seminar) || !refresh()) {
      notify("Voting is not available. Check your account and the voting period.", true);
      return;
    }
    const names = presenters(seminar);
    const values = draftValues();
    if (!values || values.length !== names.length) {
      notify("Could not read the evaluation form. Please reload and restore your draft.", true);
      return;
    }
    const presentations = [];
    for (let i = 0; i < names.length; i++) {
      const scoreText = values[i].score;
      const score = Number(scoreText);
      if (!scoreText || !Number.isInteger(score) || score < 1 || score > 10) {
        notify("Please score every presentation from 1 to 10.", true);
        return;
      }
      presentations.push({ name: names[i], score, comment: values[i].comment.trim() });
    }
    saveDraft();
    if (storageWarning) {
      notify("Your browser could not save the draft. Please fix browser storage before submitting.", true);
      return;
    }
    if (!navigator.onLine) {
      notify("You are offline. Connect to the internet before submitting.", true);
      return;
    }

    const uid = user.uid;
    const docId = `Seminar_${seminar.split(" ")[1]}_${uid}`;
    busy = true;
    refresh();
    notify("Submitting evaluation. Waiting for server confirmation...", false);
    const ref = db.collection("votes_2026_2027").doc(docId);
    try {
      // Firestore may queue this write while offline. Do not start another write.
      pending = true;
      await ref.set({
        participant: user.email, uid, seminar, presentations,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
      completed.add(`${uid}:${seminar}`);
      clearDraft(uid, seminar);
      if (auth.currentUser?.uid === uid && seminarSelect.value === seminar) {
        presentationsDiv.replaceChildren();
        renderedSeminar = "";
      }
      notify("Evaluation submitted successfully. Thank you!", false);
    } catch (error) {
      console.error("Submission error", error.code || error.message);
      if (error.code === "permission-denied" || error.code === "already-exists") {
        notify("The server rejected this submission. You may already have voted, voting may have closed, or your account may be ineligible. Your draft remains saved. Contact the organizer if needed.", true);
      } else {
        notify("Submission could not be confirmed. Your draft remains saved. Do not assume the vote was received; contact the organizer if the problem persists.", true);
      }
    } finally {
      pending = false;
      busy = false;
      updateVotingAccess();
      refresh();
    }
  });
})();
