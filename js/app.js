/* Field Notes — brand-neutral field book app (v0).
   Company content comes from a swappable profile JSON. */
(function () {
  "use strict";

  var DAY_KEY = "day-v1";
  var PROFILE_KEY = "profile-v1";
  var ACTIVE_KEY = "activeProfileId";
  var SIMPLE = [
    "projectTitle","jobNo","jobName","date","page","partyChief","chainman","crew",
    "startTime","endTime","weather","weatherSky","tempAm","tempPm","wind","pressure",
    "conditionsNotes","instMake","instSN","dcMake","dcSN","target","prismConst",
    "equipNotes","remarks","crsZone","crsDatum","crsEpoch","crsUnits","crsVertical",
    "crsGeoid","crsScaleFactor","pointStart","pointEnd"
  ];
  var EVENT_TYPES = [
    { id: "rover_check", label: "Rover / check shot" },
    { id: "bs_check", label: "Backsight / check" },
    { id: "traverse_leg", label: "Traverse leg" },
    { id: "control", label: "Control found / set" },
    { id: "point_log", label: "Point / code log" },
    { id: "sketch", label: "Sketch" },
    { id: "note", label: "Note / event" }
  ];

  var state, profile, config, bundled = [];
  var currentView = "menu";
  var saveTimer = null;
  var photoDraft = null;

  function $(id) { return document.getElementById(id); }
  function toast(msg) {
    var el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(16).slice(2); }
  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function nowTime() {
    var d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function num(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    if (s === "" || s === ".") return null;
    var n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  function fmt3(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return "";
    return n.toFixed(3);
  }
  function residual(obs, rec) {
    var a = num(obs), b = num(rec);
    return (a === null || b === null) ? null : a - b;
  }
  function fmtRes(r) {
    if (r === null) return "—";
    var t = r.toFixed(3);
    if (r > 0 && t !== "0.000") t = "+" + t;
    return t;
  }
  function checkStatus(ch) {
    var vals = [residual(ch.hdObs, ch.hdRec), residual(ch.elevObs, ch.elevRec), residual(ch.nObs, ch.nRec), residual(ch.eObs, ch.eRec)];
    var filled = vals.filter(function (r) { return r !== null; });
    var tol = num(ch.tol);
    if (!filled.length || tol === null) return "incomplete";
    for (var i = 0; i < filled.length; i++) if (Math.abs(filled[i]) > tol) return "fail";
    return "pass";
  }
  function sanitize(s) { return String(s || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, ""); }

  function emptyHeader() {
    return {
      projectTitle: "", jobNo: "", jobName: "", date: todayISO(), page: "",
      partyChief: "", chainman: "", crew: "", startTime: "", endTime: "",
      weather: "", weatherSky: "", tempAm: "", tempPm: "", wind: "", pressure: "",
      conditionsNotes: "", weatherMeta: "", weatherFetchedAt: "", weatherSource: "",
      instMake: "", instSN: "", dcMake: "", dcSN: "", target: "", prismConst: "",
      equipNotes: "", remarks: "",
      crsZone: "", crsDatum: "", crsEpoch: "", crsEpochConfirmed: false,
      crsUnits: "us-ft", crsVertical: "", crsGeoid: "", crsScaleFactor: "",
      crsScaleOne: false,
      crsFromJxl: "",
      pointStart: "", pointEnd: ""
    };
  }
  function emptyLevel() {
    return { loopName: "", instrument: "", rod: "", showSightDist: false, rows: [emptyLevelRow("BM")] };
  }
  function emptyLevelRow(kind) {
    return { kind: kind || "TP", sta: "", bs: "", fs: "", knownElev: "", notes: "", bsDist: "", fsDist: "" };
  }
  function emptyJsa() { return { task: "", location: "", comments: "", hospitalId: "", hospitalOther: "", hazards: {}, ppe: {}, ppeCustom: {}, signers: [] }; }
  function emptyState() {
    return { header: emptyHeader(), events: [], jsa: null, controlList: [], importedPoints: [], references: [], level: emptyLevel(), dailyReport: emptyDailyReport(), manholes: emptyManholeSheet(), currentPoint: "", opusReports: [] };
  }
  function emptyCheck() {
    return { pt: "", hdObs: "", hdRec: "", elevObs: "", elevRec: "", nObs: "", nRec: "", eObs: "", eRec: "", tol: "" };
  }
  function crsObj() {
    var h = state.header;
    return {
      crsZone: h.crsZone, crsDatum: h.crsDatum, crsEpoch: h.crsEpoch,
      crsEpochConfirmed: !!h.crsEpochConfirmed, crsUnits: h.crsUnits || "us-ft",
      crsVertical: h.crsVertical, crsGeoid: h.crsGeoid,
      crsScaleOne: !!h.crsScaleOne,
      crsScaleFactor: h.crsScaleOne ? "1" : h.crsScaleFactor
    };
  }
  function requireCrs(action) {
    var miss = FNCrs.missingList(crsObj());
    if (!miss.length) return true;
    toast("Set and confirm the coordinate system before " + (action || "export") + ": " + miss.join(", "));
    showView("field");
    var box = $("crsBox");
    if (box) box.scrollIntoView({ behavior: "smooth", block: "start" });
    return false;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  function saveNow() {
    readHeader();
    return FNIdb.kvSet(DAY_KEY, state).catch(function () { toast("Could not save on this device"); });
  }
  function loadDay() {
    return FNIdb.kvGet(DAY_KEY).then(function (saved) {
      var base = emptyState();
      if (saved && typeof saved === "object") {
        Object.keys(base).forEach(function (k) { if (saved[k] !== undefined) base[k] = saved[k]; });
        if (!base.header) base.header = emptyHeader();
        var eh = emptyHeader();
        Object.keys(eh).forEach(function (k) { if (base.header[k] === undefined) base.header[k] = eh[k]; });
        if (!base.header.date) base.header.date = todayISO();
        if (!base.level || !Array.isArray(base.level.rows)) base.level = emptyLevel();
        if (!base.dailyReport) base.dailyReport = emptyDailyReport();
        if (!base.manholes || !Array.isArray(base.manholes.holes)) base.manholes = emptyManholeSheet();
        if (!Array.isArray(base.events)) base.events = [];
        if (!Array.isArray(base.controlList)) base.controlList = [];
        if (base.currentPoint == null) base.currentPoint = "";
        if (!Array.isArray(base.opusReports)) base.opusReports = [];
      }
      state = base;
    });
  }
  function showView(name) {
    currentView = name;
    ["menu", "field", "level", "daily", "manhole", "scan", "reports", "control", "tools"].forEach(function (v) {
      var el = $("view-" + v);
      if (el) el.classList.toggle("hidden", v !== name);
    });
    if ($("btnBack")) $("btnBack").classList.toggle("hidden", name === "menu");
    if (name === "level") renderLevel();
    if (name === "daily") renderDaily();
    if (name === "manhole") renderManholes();
    if (name === "field") { updateCrsStatus(); updatePointRangeDisplay(); fillControlDatalist(); writeCurrentPoint(); }
    if (name === "control") renderControl();
    if (name === "tools") mountTools();
    if (name === "menu") updateMenuLine();
  }
  function updateMenuLine() {
    var h = state.header;
    var parts = [];
    if (h.projectTitle || h.jobName) parts.push(h.projectTitle || h.jobName);
    if (h.date) parts.push(h.date);
    if (h.weather) parts.push(h.weather);
    var line = parts.join(" · ") || "New day";
    if ($("menuJobLine")) $("menuJobLine").textContent = line;
    if ($("headerSummary")) $("headerSummary").textContent = line;
  }
  function syncScaleOneUi() {
    var on = $("crsScaleOne") && $("crsScaleOne").checked;
    if ($("crsScaleFactorWrap")) $("crsScaleFactorWrap").classList.toggle("hidden", !!on);
    if (on && $("crsScaleFactor")) $("crsScaleFactor").value = "1";
  }
  function updateCrsStatus() {
    var ok = FNCrs.isComplete(crsObj());
    var el = $("crsStatus");
    if (el) { el.textContent = ok ? "Complete" : "Required"; el.className = "badge " + (ok ? "pass" : "incomplete"); }
    if ($("crsFromJxl")) $("crsFromJxl").textContent = state.header.crsFromJxl || "";
  }
  function fillCrsOptions() {
    var sel = $("crsZone");
    if (!sel) return;
    var cur = state.header.crsZone || "";
    sel.innerHTML = '<option value="">Select zone or projection…</option>';
    FNCrs.zoneOptions().forEach(function (z) {
      var o = document.createElement("option");
      o.value = z.id; o.textContent = z.label;
      if (z.id === cur) o.selected = true;
      sel.appendChild(o);
    });
  }
  function writeHeader() {
    var h = state.header;
    SIMPLE.forEach(function (k) {
      var el = $(k);
      if (!el) return;
      if (el.type === "checkbox") el.checked = !!h[k];
      else el.value = h[k] || "";
    });
    if ($("crsEpochConfirmed")) $("crsEpochConfirmed").checked = !!h.crsEpochConfirmed;
    if ($("crsScaleOne")) $("crsScaleOne").checked = !!h.crsScaleOne;
    if ($("weatherMeta")) $("weatherMeta").textContent = h.weatherMeta || "";
    fillCrsOptions();
    syncScaleOneUi();
    updateCrsStatus();
    updateMenuLine();
    updatePointRangeDisplay();
  }
  function readHeader() {
    if (!state || !state.header) return;
    SIMPLE.forEach(function (k) {
      var el = $(k);
      if (!el) return;
      state.header[k] = el.type === "checkbox" ? el.checked : el.value;
    });
    if ($("crsEpochConfirmed")) state.header.crsEpochConfirmed = $("crsEpochConfirmed").checked;
    if ($("crsScaleOne")) {
      state.header.crsScaleOne = $("crsScaleOne").checked;
      if (state.header.crsScaleOne) state.header.crsScaleFactor = "1";
    }
    syncScaleOneUi();
    updateCrsStatus();
    updateMenuLine();
  }
  function bindHeader() {
    SIMPLE.concat(["crsEpochConfirmed", "crsScaleOne"]).forEach(function (k) {
      var el = $(k);
      if (!el) return;
      el.addEventListener("input", function () { readHeader(); scheduleSave(); });
      el.addEventListener("change", function () { readHeader(); scheduleSave(); });
    });
    if ($("headerToggle")) {
      if ($("crsToggle")) $("crsToggle").addEventListener("click", function () {
        var open = $("crsBody").classList.toggle("hidden") === false;
        $("crsToggle").setAttribute("aria-expanded", open ? "true" : "false");
        if ($("crsChev")) $("crsChev").textContent = open ? "Hide" : "Show";
      });
      $("headerToggle").addEventListener("click", function () {
        var body = $("headerBody");
        var open = body.classList.contains("hidden");
        body.classList.toggle("hidden", !open);
        $("headerToggle").setAttribute("aria-expanded", open ? "true" : "false");
        if ($("headerChev")) $("headerChev").textContent = open ? "Hide" : "Show";
      });
    }
    if ($("btnWeather")) $("btnWeather").addEventListener("click", fetchWeather);
  }
  function fetchWeather() {
    var units = (profile && profile.units && profile.units.temperature === "C") ? "C" : "F";
    toast("Getting location…");
    FNPlatform.getLocation().then(function (pos) {
      return FNWeather.fetchCurrent(pos.lat, pos.lon, units);
    }).then(function (w) {
      state.header.weather = w.text;
      if (w.windspeed != null) state.header.wind = String(Math.round(Number(w.windspeed)));
      if (w.temperature != null && !state.header.tempAm) state.header.tempAm = String(Math.round(Number(w.temperature)));
      var when = new Date(w.fetchedAt);
      state.header.weatherFetchedAt = w.fetchedAt;
      state.header.weatherSource = w.source;
      state.header.weatherMeta = w.source + " · fetched " + when.toLocaleString() +
        " · " + Number(w.lat).toFixed(4) + ", " + Number(w.lon).toFixed(4);
      writeHeader();
      saveNow();
      toast("Weather updated — you can edit it");
    }).catch(function () {
      toast("Weather unavailable. Enter it manually — nothing was filled in.");
    });
  }

  function genericFallback() {
    return {
      schemaVersion: 1, id: "generic-default", companyName: "", logoDataUrl: "",
      codebook: { note: "No codes shipped.", codes: [] },
      jsa: {
        title: "JOB SAFETY ANALYSIS", signOffTitle: "CREW SIGN-IN",
        printNameLabel: "PRINT NAME", signLabel: "SIGN",
        hospitalTitle: "NEAREST HOSPITAL / EMERGENCY", commentsLabel: "COMMENTS:",
        infoColumn: "ADDITIONAL INFO", mitigateColumn: "MITIGATING FACTORS",
        ppeTitle: "PPE REQUIRED", otherHospitalLabel: "Other",
        hazardSections: [], ppe: { items: [], customCount: 0 }
      },
      hospitals: [], emergencyContacts: [],
      tolerances: { levelClosureFormula: "k*sqrt(km)", levelClosureK: null },
      photo: { watermarkFields: ["jobNo","dateTime","pointNo","code","gps","heading","crew","note"], filenamePattern: "{pointNo}_{n}.jpg", multiSuffix: "_{n}" },
      exportMapping: { csv: {}, smartsheet: { workspaceHint: "", sheetHint: "", columns: {} } }
    };
  }
  function bundledConfig() {
    return (window.FNBundled && window.FNBundled.config) || { productName: "Field Notes", defaultProfile: "generic-default" };
  }
  function loadConfig() {
    return fetch("./config.json").then(function (r) { if (!r.ok) throw new Error("cfg"); return r.json(); })
      .catch(function () { return bundledConfig(); });
  }
  function loadBundled() {
    return fetch("./presets/index.json").then(function (r) { if (!r.ok) throw new Error("idx"); return r.json(); })
      .then(function (idx) { bundled = (idx && idx.bundled) || []; })
      .catch(function () {
        bundled = (window.FNBundled && window.FNBundled.index && window.FNBundled.index.bundled) ||
          [{ id: "generic-default", label: "Generic default" }];
      });
  }
  function fetchPreset(id) {
    return fetch("./presets/" + encodeURIComponent(id) + ".json").then(function (r) {
      if (!r.ok) throw new Error("missing");
      return r.json();
    }).catch(function () {
      var pack = window.FNBundled && window.FNBundled.presets && window.FNBundled.presets[id];
      if (pack) return pack;
      throw new Error("missing");
    });
  }
  function validateProfile(pr) { return !!(pr && pr.schemaVersion); }
  function setProfile(pr) {
    if (!validateProfile(pr)) throw new Error("Invalid company profile");
    profile = pr;
    return FNIdb.kvSet(PROFILE_KEY, pr).then(function () { return FNIdb.kvSet(ACTIVE_KEY, pr.id || ""); });
  }
  function closeOverlay() { $("overlay").classList.add("hidden"); $("ovBody").innerHTML = ""; $("ovFoot").innerHTML = ""; photoDraft = null; }
  function openOverlay(title, step) {
    $("ovTitle").textContent = title || "Entry";
    $("ovStep").textContent = step || "";
    $("overlay").classList.remove("hidden");
  }
  function openSettings() {
    $("ovTitle").textContent = "Company profile";
    $("ovStep").textContent = "";
    var opts = bundled.map(function (b) {
      return '<option value="' + esc(b.id) + '"' + ((profile && profile.id === b.id) ? " selected" : "") + ">" + esc(b.label || b.id) + "</option>";
    }).join("");
    var codesN = (profile && profile.codebook && profile.codebook.codes) ? profile.codebook.codes.length : 0;
    $("ovBody").innerHTML =
      '<p class="hint">The app is generic. Load a company profile for codebook, tolerances, watermark, and export mapping.</p>' +
      '<div class="card"><div class="grid g2">' +
      '<label class="fld span-row"><span>Company name</span><input id="setCompany" type="text" value="' + esc((profile && profile.companyName) || "") + '"></label>' +
      '<label class="fld span-row"><span>Bundled profiles</span><select id="setBundled">' + opts + "</select></label></div>" +
      (profile && profile.logoDataUrl ? '<p style="margin-top:8px"><img alt="Company logo" src="' + esc(profile.logoDataUrl) + '" style="max-height:48px"></p>' : "") +
      '<div class="actions"><button type="button" class="btn" id="setLogo">Upload logo</button><button type="button" class="btn" id="setLogoClear">Clear logo</button></div>' +
      '<p class="hint" style="margin-top:10px">Codebook codes: ' + codesN + " (none are invented by the app).</p></div>" +
      '<div class="actions"><button type="button" class="btn btn-primary" id="setLoad">Load bundled</button>' +
      '<button type="button" class="btn" id="setImport">Import JSON</button><button type="button" class="btn" id="setExport">Export JSON</button></div>';
    $("ovFoot").innerHTML = '<button type="button" class="btn btn-primary" id="setSave">Save name / logo</button>';
    $("overlay").classList.remove("hidden");
    $("setLoad").onclick = function () {
      fetchPreset($("setBundled").value).then(setProfile).then(function () { toast("Loaded profile"); openSettings(); })
        .catch(function () { toast("Could not load that profile"); });
    };
    $("setImport").onclick = function () { $("profileInput").click(); };
    $("setExport").onclick = function () {
      FNPlatform.saveBlob(new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" }), (profile.id || "company-profile") + ".json");
    };
    $("setLogo").onclick = function () { $("logoInput").click(); };
    $("setLogoClear").onclick = function () { profile.logoDataUrl = ""; setProfile(profile).then(openSettings); };
    $("setSave").onclick = function () {
      profile.companyName = $("setCompany").value;
      setProfile(profile).then(function () { toast("Profile saved"); closeOverlay(); });
    };
  }
  function importProfileFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var pr = JSON.parse(String(reader.result || ""));
        if (!validateProfile(pr)) throw new Error("schema");
        setProfile(pr).then(function () { toast("Profile imported"); openSettings(); });
      } catch (e) { toast("That file is not a valid company profile"); }
    };
    reader.readAsText(file);
  }

  function pointKey(v) { return String(v == null ? "" : v).trim(); }
  function pointNumeric(v) {
    var s = pointKey(v);
    if (!s || !/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  function assignedRange() {
    var a = pointNumeric(state.header && state.header.pointStart);
    var b = pointNumeric(state.header && state.header.pointEnd);
    if (a === null || b === null) return null;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }
  function collectPointEntries() {
    var out = [];
    function add(point, source, eventId) {
      var k = pointKey(point);
      if (!k) return;
      out.push({ point: k, source: source || "", eventId: eventId || "" });
    }
    (state.events || []).forEach(function (ev) {
      var f = ev.fields || {};
      add(ev.pointNo || f.pointNo || f.pt || f.point || f.station || f.occupied, ev.type || "event", ev.id);
      add(f.bsPt || f.backsight, (ev.type || "event") + " BS", ev.id);
    });
    (state.importedPoints || []).forEach(function (pt) { add(pt.name || pt.pt || pt.point, "imported"); });
    (state.controlList || []).forEach(function (pt) { add(pt.name || pt.pt || pt.point, "control"); });
    if (state.level && Array.isArray(state.level.rows)) {
      state.level.rows.forEach(function (r) { add(r.sta, "level"); });
    }
    if (state.manholes && Array.isArray(state.manholes.holes)) {
      state.manholes.holes.forEach(function (h) {
        add(h.pointNo, "manhole");
        (h.pipes || []).forEach(function (row) { add(row.pt, "manhole pipe"); });
      });
    }
    return out;
  }
  function usedPointStats() {
    var entries = collectPointEntries();
    var nums = [], seen = {}, dups = [];
    entries.forEach(function (e) {
      var key = e.point.toLowerCase();
      if (seen[key]) dups.push(e);
      else seen[key] = e;
      var n = pointNumeric(e.point);
      if (n !== null) nums.push(n);
    });
    var range = assignedRange();
    var outside = entries.filter(function (e) {
      var n = pointNumeric(e.point);
      return !!(range && n !== null && (n < range.start || n > range.end));
    });
    return {
      count: entries.length,
      usedStart: nums.length ? Math.min.apply(null, nums) : null,
      usedEnd: nums.length ? Math.max.apply(null, nums) : null,
      outside: outside,
      duplicates: dups,
      entries: entries
    };
  }
  function formatPointRangeLine() {
    var h = state.header || {};
    var assigned = (h.pointStart || h.pointEnd)
      ? (pointKey(h.pointStart) || "—") + "–" + (pointKey(h.pointEnd) || "—")
      : "not assigned";
    var st = usedPointStats();
    var used = st.usedStart !== null
      ? st.usedStart + "–" + st.usedEnd + " (" + st.count + " point" + (st.count === 1 ? "" : "s") + ")"
      : (st.count ? st.count + " point" + (st.count === 1 ? "" : "s") + " (non-numeric)" : "none yet");
    return "Assigned " + assigned + " · Used " + used;
  }
  function updatePointRangeDisplay() {
    var usedEl = $("pointRangeUsed");
    var warnEl = $("pointRangeWarn");
    if (!usedEl && !warnEl) return;
    var st = usedPointStats();
    if (usedEl) {
      usedEl.textContent = st.usedStart !== null
        ? (st.usedStart + "–" + st.usedEnd + "  (" + st.count + " logged or imported)")
        : (st.count ? st.count + " logged or imported (no numeric range)" : "None yet — computed from logged and imported points");
    }
    if (!warnEl) return;
    var msgs = [];
    if (st.outside.length) {
      var sample = st.outside.slice(0, 6).map(function (e) { return e.point; }).join(", ");
      msgs.push(st.outside.length + " point" + (st.outside.length === 1 ? "" : "s") + " outside the assigned range: " + sample + (st.outside.length > 6 ? "…" : ""));
    }
    if (st.duplicates.length) {
      var ds = st.duplicates.slice(0, 6).map(function (e) { return e.point; }).join(", ");
      msgs.push("Duplicate point number" + (st.duplicates.length === 1 ? "" : "s") + ": " + ds + (st.duplicates.length > 6 ? "…" : ""));
    }
    if (assignedRange() === null && (state.header.pointStart || state.header.pointEnd)) {
      msgs.push("Assigned start and end are both needed to check the range.");
    }
    warnEl.textContent = msgs.join("  ");
    warnEl.classList.toggle("hidden", !msgs.length);
  }
  function checkPointNumber(pt, skipEventId) {
    var key = pointKey(pt);
    var result = { key: key, outside: false, duplicate: false, messages: [] };
    if (!key) return result;
    var n = pointNumeric(key);
    var range = assignedRange();
    if (range && n !== null && (n < range.start || n > range.end)) {
      result.outside = true;
      result.messages.push("Point " + key + " is outside the assigned range " + range.start + "–" + range.end + ".");
    }
    var skip = skipEventId || "";
    var hits = collectPointEntries().filter(function (e) {
      return e.point.toLowerCase() === key.toLowerCase() && e.eventId !== skip;
    });
    if (hits.length) {
      result.duplicate = true;
      result.messages.push("Point " + key + " already exists (" + hits[0].source + ").");
    }
    return result;
  }
  function warnIfPointIssue(pt, skipEventId) {
    var r = checkPointNumber(pt, skipEventId);
    if (r.messages.length) toast(r.messages.join(" "));
    updatePointRangeDisplay();
    return r;
  }

  function typeLabel(type) {
    var found = EVENT_TYPES.filter(function (t) { return t.id === type; })[0];
    if (found) return found.label;
    if (type === "gnss_base") return "GNSS base setup";
    if (type === "ts_setup") return "Total station setup";
    if (type === "photo") return "Photo";
    if (type === "jxl") return "Imported from JXL";
    return type || "Event";
  }
  function eventPoint(ev) {
    if (!ev) return "";
    var f = ev.fields || {};
    return pointKey(ev.pointNo || f.pointNo || f.pt || f.point || f.station || f.occupied);
  }
  function eventTime(ev) { return ev.time || ev.ts || ""; }

  function renderMoreLog() {
    var root = $("moreLog");
    if (!root) return;
    root.innerHTML = EVENT_TYPES.map(function (t) {
      return '<button type="button" class="btn" data-newtype="' + esc(t.id) + '">' + esc(t.label) + "</button>";
    }).join("");
    root.querySelectorAll("[data-newtype]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = btn.getAttribute("data-newtype");
        if (t === "sketch") openSketch();
        else if (t === "bs_check") openBsCheck();
        else openEventEditor({ type: t });
      });
    });
  }
  function renderTimeline() {
    var root = $("timeline");
    if (!root) return;
    var evs = (state.events || []).slice().sort(function (a, b) {
      return String(eventTime(a)).localeCompare(String(eventTime(b)));
    });
    if (!evs.length) {
      root.innerHTML = '<p class="hint">No entries yet. Use Base Setup, Total Station Setup, Photo, or the buttons above.</p>';
      updatePointRangeDisplay();
      updateImportSummary();
      return;
    }
    root.innerHTML = evs.map(function (ev) {
      var pt = eventPoint(ev);
      var chk = pt ? checkPointNumber(pt, ev.id) : { outside: ev.warnOutside, duplicate: ev.warnDuplicate, messages: [] };
      var warn = (chk.outside || chk.duplicate || ev.warnOutside || ev.warnDuplicate)
        ? '<div class="point-chip-warn">' + esc((chk.messages && chk.messages.join(" ")) || "Point-number warning") + "</div>"
        : "";
      var st = ev.status ? '<span class="badge ' + esc(ev.status) + '">' + esc(ev.status) + "</span>" : "";
      var src = ev.importedFrom ? '<span class="hint">imported from ' + esc(ev.importedFrom) + "</span>" : "";
      var detail = ev.type === "gnss_base" ? gnssSummary(ev) : "";
      return '<article class="event" data-eid="' + esc(ev.id) + '"><header><strong>' + esc(typeLabel(ev.type)) + "</strong>" +
        (pt ? " · pt " + esc(pt) : "") + " " + st +
        '<span class="when">' + esc(ev.time || "") + '</span></header>' +
        (detail ? "<p>" + esc(detail) + "</p>" : "") +
        '<p>' + esc(ev.notes || ev.title || "") + "</p>" + src + warn +
        '<div class="actions"><button type="button" class="btn btn-sm" data-edit>Edit</button><button type="button" class="btn btn-sm" data-del>Delete</button></div></article>';
    }).join("");
    root.querySelectorAll("[data-eid]").forEach(function (art) {
      var ev = state.events.filter(function (e) { return e.id === art.getAttribute("data-eid"); })[0];
      var edit = art.querySelector("[data-edit]");
      var del = art.querySelector("[data-del]");
      if (edit) edit.addEventListener("click", function () {
        if (!ev) return;
        if (ev.type === "gnss_base") openGnss(ev);
        else if (ev.type === "ts_setup") openTs(ev);
        else if (ev.type === "photo") openPhoto(ev);
        else if (ev.type === "sketch") openSketch(ev);
        else if (ev.type === "bs_check") openBsCheck(ev);
        else openEventEditor(ev);
      });
      if (del) del.addEventListener("click", function () {
        if (!ev) return;
        if (!confirm("Delete this entry?")) return;
        var fid = ev.fileId;
        state.events = state.events.filter(function (e) { return e.id !== ev.id; });
        if (fid) FNIdb.fileDelete(fid).catch(function () {});
        saveNow(); renderTimeline();
      });
    });
    updatePointRangeDisplay();
    updateImportSummary();
  }
  function openEventEditor(ev) {
    ev = ev || {};
    var isNew = !ev.id;
    var draft = {
      id: ev.id || uid(),
      type: ev.type || "note",
      time: ev.time || nowTime(),
      ts: ev.ts || new Date().toISOString(),
      pointNo: ev.pointNo || (ev.fields && (ev.fields.pointNo || ev.fields.pt)) || "",
      notes: ev.notes || "",
      fields: Object.assign({}, ev.fields || {}),
      importedFrom: ev.importedFrom || ""
    };
    openOverlay(typeLabel(draft.type), isNew ? "New entry" : "Edit");
    var codeVal = draft.fields.code || "";
    $("ovBody").innerHTML =
      '<div class="grid g2">' +
      '<label class="fld"><span>Time</span><input id="evTime" type="time" value="' + esc(draft.time) + '"></label>' +
      '<label class="fld"><span>Point no.</span><input id="evPoint" type="text" value="' + esc(draft.pointNo) + '" autocomplete="off"></label>' +
      (draft.type === "point_log" ? '<label class="fld span-row"><span>Code</span><input id="evCode" type="text" value="' + esc(codeVal) + '" placeholder="From your codebook — none are shipped" list="evCodeList" autocomplete="off"></label>' +
        '<datalist id="evCodeList"></datalist>' : "") +
      '<label class="fld span-row"><span>Notes</span><textarea id="evNotes">' + esc(draft.notes) + "</textarea></label></div>";
    $("ovFoot").innerHTML = '<button type="button" class="btn btn-primary" id="evSave">Save</button>';
    if ($("evCodeList") && profile && profile.codebook && profile.codebook.codes) {
      $("evCodeList").innerHTML = profile.codebook.codes.map(function (c) {
        var v = c.code || c.id || "";
        return v ? '<option value="' + esc(v) + '">' + esc(c.description || v) + "</option>" : "";
      }).join("");
    }
    $("evSave").onclick = function () {
      draft.time = $("evTime").value;
      draft.pointNo = $("evPoint").value;
      draft.notes = $("evNotes").value;
      if ($("evCode")) draft.fields.code = $("evCode").value;
      var warn = warnIfPointIssue(draft.pointNo, draft.id);
      draft.warnOutside = warn.outside;
      draft.warnDuplicate = warn.duplicate;
      upsertEvent(draft);
      closeOverlay();
    };
  }
  function upsertEvent(ev) {
    var i = state.events.findIndex(function (e) { return e.id === ev.id; });
    if (i >= 0) state.events[i] = ev;
    else state.events.push(ev);
    saveNow();
    renderTimeline();
  }
  function updateImportSummary() {
    var el = $("importSummary");
    if (!el) return;
    var parts = [];
    if ((state.controlList || []).length) parts.push(state.controlList.length + " control points");
    if ((state.importedPoints || []).length) parts.push(state.importedPoints.length + " imported points");
    if ((state.references || []).length) parts.push(state.references.length + " reference file(s)");
    el.textContent = parts.join(" · ");
  }

  var GNSS_RX = ["R10", "R12", "R12i", "R980"];
  function antennaReceiverFrom(f) {
    f = f || {};
    if (f.antennaReceiver) return String(f.antennaReceiver).trim();
    var a = String(f.antenna || "").trim();
    var r = String(f.receiver || "").trim();
    if (a && r && a !== r) return a + " / " + r;
    return a || r || "";
  }
  function antennaReceiverHtml(current) {
    var cur = String(current || "").trim();
    var known = GNSS_RX.indexOf(cur) >= 0;
    var opts = ['<option value="">Select\u2026</option>'];
    GNSS_RX.forEach(function (opt) {
      opts.push('<option value="' + esc(opt) + '"' + (cur === opt ? " selected" : "") + ">" + esc(opt) + "</option>");
    });
    opts.push('<option value="__other__"' + (cur && !known ? " selected" : "") + ">Other</option>");
    return '<label class="fld span-row"><span>Antenna / Receiver</span><select id="gAntRx">' + opts.join("") + "</select></label>" +
      '<label class="fld span-row' + (cur && !known ? "" : " hidden") + '" id="gAntRxOtherWrap"><span>Other antenna / receiver</span>' +
      '<input id="gAntRxOther" type="text" value="' + esc(known ? "" : cur) + '" placeholder="Type the model" autocomplete="off"></label>';
  }
  function bindAntennaReceiver() {
    if (!$("gAntRx")) return;
    $("gAntRx").addEventListener("change", function () {
      var other = $("gAntRx").value === "__other__";
      if ($("gAntRxOtherWrap")) $("gAntRxOtherWrap").classList.toggle("hidden", !other);
      if (other && $("gAntRxOther")) $("gAntRxOther").focus();
    });
  }
  function readAntennaReceiver() {
    var sel = $("gAntRx") ? $("gAntRx").value : "";
    if (sel === "__other__") return ($("gAntRxOther") && $("gAntRxOther").value.trim()) || "";
    return sel || "";
  }
  function fieldHtml(id, label, value, opts) {
    opts = opts || {};
    var typ = opts.type || "text";
    var listId = opts.suggestions && opts.suggestions.length ? (id + "List") : (opts.list || "");
    var extra = (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : "") +
      (listId ? ' list="' + listId + '"' : "") +
      ' autocomplete="off"';
    var control = typ === "textarea"
      ? '<textarea id="' + id + '"' + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : "") + ">" + esc(value || "") + "</textarea>"
      : '<input id="' + id + '" type="' + typ + '" value="' + esc(value || "") + '"' + extra + ">";
    var list = "";
    if (opts.suggestions && opts.suggestions.length) {
      list = '<datalist id="' + listId + '">' + opts.suggestions.map(function (opt) {
        return '<option value="' + esc(opt) + '"></option>';
      }).join("") + "</datalist>";
    }
    return '<label class="fld' + (opts.span ? " span-row" : "") + '"><span>' + esc(label) + "</span>" + control + list + "</label>";
  }
  function openGnss(existing) {
    var ev = existing || { id: uid(), type: "gnss_base", time: nowTime(), ts: new Date().toISOString(), fields: {} };
    var f = ev.fields || {};
    openOverlay("GNSS base setup", existing ? "Edit" : "New");
    $("ovBody").innerHTML = '<div class="grid g2">' +
      fieldHtml("gTime", "Time", ev.time, { type: "time" }) +
      fieldHtml("gPt", "Point / control used", ev.pointNo || f.occupied || f.station, { ph: "Point number", list: "ctrlList" }) +
      antennaReceiverHtml(antennaReceiverFrom(f)) +
      fieldHtml("gHt", "Antenna / instrument height", f.height, { ph: "Leave blank if not measured" }) +
      fieldHtml("gStart", "Session start", f.sessionStart, { type: "time" }) +
      fieldHtml("gEnd", "Session end", f.sessionEnd, { type: "time" }) +
      fieldHtml("gNotes", "Notes", ev.notes, { span: true, type: "textarea" }) +
      "</div>";
    $("ovFoot").innerHTML = '<button type="button" class="btn btn-primary" id="gSave">Save setup</button>';
    bindAntennaReceiver();
    $("gSave").onclick = function () {
      ev.time = $("gTime").value;
      ev.pointNo = $("gPt").value;
      ev.notes = $("gNotes").value;
      var ant = readAntennaReceiver();
      ev.fields = ev.fields || {};
      ev.fields.occupied = ev.pointNo;
      ev.fields.station = ev.pointNo;
      ev.fields.antennaReceiver = ant;
      ev.fields.antenna = ant;
      ev.fields.height = $("gHt").value;
      ev.fields.sessionStart = $("gStart").value;
      ev.fields.sessionEnd = $("gEnd").value;
      ev.type = "gnss_base";
      var warn = warnIfPointIssue(ev.pointNo, ev.id);
      ev.warnOutside = warn.outside; ev.warnDuplicate = warn.duplicate;
      setCurrentPoint(ev.pointNo);
      markControlUsed(ev.pointNo, ev);
      upsertEvent(ev); closeOverlay();
    };
  }
  function gnssSummary(ev) {
    var f = (ev && ev.fields) || {};
    var parts = [];
    var ant = antennaReceiverFrom(f);
    if (ant) parts.push("Antenna / Receiver " + ant);
    if (f.height) parts.push("Height " + f.height + (f.heightMethod ? " (" + f.heightMethod + ")" : ""));
    else if (f.heightMethod) parts.push("Height method " + f.heightMethod);
    if (f.sessionStart || f.sessionEnd) parts.push("Session " + (f.sessionStart || "\u2014") + "\u2013" + (f.sessionEnd || "\u2014"));
    return parts.join(" \u00b7 ");
  }
  var TS_HI_METHODS = ["True height", "Bottom of notch"];
  function tsHiMethodSelect(current) {
    var cur = String(current || "").trim();
    var opts = ['<option value="">Select\u2026</option>'];
    TS_HI_METHODS.forEach(function (opt) {
      opts.push('<option value="' + esc(opt) + '"' + (cur === opt ? " selected" : "") + ">" + esc(opt) + "</option>");
    });
    if (cur && TS_HI_METHODS.indexOf(cur) < 0) {
      opts.push('<option value="' + esc(cur) + '" selected>' + esc(cur) + "</option>");
    }
    return '<label class="fld"><span>HI method</span><select id="tHIMethod">' + opts.join("") + "</select></label>";
  }
  function emptyResiduals() {
    return {
      horizontal: { obs: "", residual: "" },
      vertical: { obs: "", residual: "" },
      distance: { obs: "", residual: "" }
    };
  }
  function residualsFrom(ev) {
    var src = (ev && ev.fields && ev.fields.residuals) || (ev && ev.residuals) || {};
    var out = emptyResiduals();
    ["horizontal", "vertical", "distance"].forEach(function (k) {
      var r = src[k] || {};
      out[k].obs = r.obs || r.observed || "";
      out[k].residual = r.residual || r.res || "";
    });
    return out;
  }
  function residualsHtml(res) {
    function row(key, label) {
      var r = res[key] || {};
      return "<tr><th>" + label + "</th>" +
        '<td><input id="r' + key + 'Res" type="text" inputmode="decimal" value="' + esc(r.residual || "") + '" placeholder="e.g. -0.012" autocomplete="off"></td></tr>';
    }
    return '<h2>Residuals</h2><p class="hint">Signed residuals (for example -0.012). Nothing is calculated or filled in.</p>' +
      '<table class="resid-table"><thead><tr><th></th><th>Residual</th></tr></thead><tbody>' +
      row("horizontal", "Horizontal") + row("vertical", "Vertical") +
      "</tbody></table>";
  }
  function readResiduals(prev) {
    var keep = residualsFrom({ fields: { residuals: prev } });
    function val(id) { return $(id) ? String($(id).value || "").trim() : ""; }
    return {
      horizontal: { obs: keep.horizontal.obs, residual: val("rhorizontalRes") },
      vertical: { obs: keep.vertical.obs, residual: val("rverticalRes") },
      distance: { obs: keep.distance.obs, residual: keep.distance.residual }
    };
  }
  function residualsSummary(res) {
    res = res || {};
    var parts = [];
    [["horizontal", "H"], ["vertical", "V"]].forEach(function (pair) {
      var r = res[pair[0]] || {};
      if (r.residual) parts.push(pair[1] + " " + r.residual);
    });
    var d = (res.distance || {}).residual;
    if (d) parts.push("D " + d);
    return parts.join(" \u00b7 ");
  }
  function tsSummary(ev) {
    var f = (ev && ev.fields) || {};
    var parts = [];
    if (f.hi) parts.push("HI " + f.hi + (f.hiMethod ? " (" + f.hiMethod + ")" : ""));
    else if (f.hiMethod) parts.push("HI method " + f.hiMethod);
    if (f.bsPt) parts.push("BS " + f.bsPt);
    if (f.ht) parts.push("HR " + f.ht + (f.htMethod ? " (" + f.htMethod + ")" : ""));
    else if (f.htMethod) parts.push("HR method " + f.htMethod);
    var rs = residualsSummary(f.residuals || ev.residuals);
    if (rs) parts.push(rs);
    return parts.join(" \u00b7 ");
  }
  function openTs(existing) {
    var ev = existing || { id: uid(), type: "ts_setup", time: nowTime(), ts: new Date().toISOString(), fields: {} };
    var f = ev.fields || {};
    var res = residualsFrom(ev);
    openOverlay("Total station setup", existing ? "Edit" : "New");
    $("ovBody").innerHTML = '<div class="grid g2">' +
      fieldHtml("tOcc", "Occupied point", ev.pointNo || f.occupied, { list: "ctrlList" }) +
      fieldHtml("tBs", "Backsight point", f.bsPt, { list: "ctrlList" }) +
      fieldHtml("tHI", "Instrument height (HI)", f.hi, { ph: "Leave blank if not measured" }) +
      tsHiMethodSelect(f.hiMethod) +
      fieldHtml("tHT", "HR / target height", f.ht) +
      fieldHtml("tHTMethod", "HR / target method", f.htMethod) +
      "</div>" + residualsHtml(res) +
      fieldHtml("tNotes", "Notes", ev.notes, { span: true, type: "textarea" });
    $("ovFoot").innerHTML = '<button type="button" class="btn btn-primary" id="tSave">Save setup</button>';
    $("tSave").onclick = function () {
      ev.pointNo = $("tOcc").value;
      ev.notes = $("tNotes").value;
      ev.fields = ev.fields || {};
      ev.fields.occupied = ev.pointNo;
      ev.fields.hi = $("tHI").value;
      ev.fields.hiMethod = $("tHIMethod").value;
      ev.fields.bsPt = $("tBs").value;
      ev.fields.ht = $("tHT").value;
      ev.fields.htMethod = $("tHTMethod").value;
      ev.fields.residuals = readResiduals(ev.fields.residuals);
      ev.type = "ts_setup";
      var warn = warnIfPointIssue(ev.pointNo, ev.id);
      ev.warnOutside = warn.outside; ev.warnDuplicate = warn.duplicate;
      if ($("tBs").value) warnIfPointIssue($("tBs").value, ev.id);
      setCurrentPoint(ev.pointNo);
      markControlUsed(ev.pointNo, ev);
      markControlUsed($("tBs").value, ev);
      upsertEvent(ev); closeOverlay();
    };
  }

  function photoPattern() {
    return (profile && profile.photo && profile.photo.filenamePattern) || "{pointNo}_{n}.jpg";
  }
  function photoSuffix() {
    return (profile && profile.photo && profile.photo.multiSuffix) || "_{n}";
  }
  function formatStamp(d) {
    function p(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }
  function usedPhotoNames(existingNames) {
    var used = {};
    (existingNames || []).forEach(function (n) { used[String(n).toLowerCase()] = true; });
    (state.events || []).forEach(function (e) { if (e.filename) used[String(e.filename).toLowerCase()] = true; });
    return used;
  }
  function nextPhotoIndex(pointNo, used) {
    var pt = sanitize(pointNo || "pt") || "pt";
    var i = 1, name;
    do {
      name = (pt + "_" + i + ".jpg").toLowerCase();
      i++;
    } while (used[name] && i < 200);
    return i - 1;
  }
  function buildPhotoName(pointNo, when, existingNames) {
    var job = sanitize(state.header.jobNo || "NOJOB") || "NOJOB";
    var pt = sanitize(pointNo || "pt") || "pt";
    var stamp = formatStamp(when || new Date());
    var used = usedPhotoNames(existingNames);
    var pattern = photoPattern();
    var name;
    if (/\{n\}/.test(pattern) && !/yyyyMMdd/i.test(pattern)) {
      var idx = nextPhotoIndex(pt, used);
      name = pattern.replace("{pointNo}", pt).replace("{jobNo}", job).replace("{n}", String(idx));
    } else {
      name = pattern.replace("{pointNo}", pt).replace("{jobNo}", job).replace("{yyyyMMdd-HHmm}", stamp).replace("{n}", "1");
    }
    if (!/\.jpe?g$/i.test(name)) name += ".jpg";
    if (!used[name.toLowerCase()]) return name;
    var suffix = photoSuffix();
    var i = 2, cand;
    do {
      cand = name.replace(/(\.jpe?g)$/i, suffix.replace("{n}", String(i)) + "$1");
      i++;
    } while (used[cand.toLowerCase()] && i < 200);
    return cand;
  }
  function watermarkFields() {
    return (profile && profile.photo && profile.photo.watermarkFields) || ["jobNo","dateTime","pointNo","code","gps","heading","crew","note"];
  }
  function drawWatermark(img, meta) {
    var canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    var lines = [];
    var fields = watermarkFields();
    function want(k) { return !fields.length || fields.indexOf(k) >= 0; }
    if (want("jobNo") && meta.jobNo) lines.push("Job " + meta.jobNo);
    if (want("dateTime") && meta.dateTime) lines.push(meta.dateTime);
    if (want("pointNo") && meta.pointNo) lines.push("Pt " + meta.pointNo);
    if (want("code") && meta.code) lines.push(meta.code);
    if (want("description") && meta.description && meta.description !== meta.code) lines.push(meta.description);
    if (want("gps") && meta.gps) lines.push(meta.gps);
    if (want("heading") && meta.heading) lines.push("Hdg " + meta.heading);
    if (want("crew") && meta.crew) lines.push(meta.crew);
    if (want("note") && meta.note) lines.push(meta.note);
    if (!lines.length) {
      return new Promise(function (resolve) { canvas.toBlob(function (b) { resolve({ blob: b, dataUrl: canvas.toDataURL("image/jpeg", 0.92) }); }, "image/jpeg", 0.92); });
    }
    var pad = Math.max(12, Math.round(canvas.width * 0.012));
    var fontSize = Math.max(16, Math.round(canvas.width * 0.028));
    ctx.font = "bold " + fontSize + "px sans-serif";
    ctx.textBaseline = "bottom";
    var lineH = fontSize + 6;
    var boxH = lineH * lines.length + pad;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, canvas.height - boxH, canvas.width, boxH);
    ctx.fillStyle = "#fff";
    lines.forEach(function (line, i) {
      ctx.fillText(line, pad, canvas.height - boxH + pad / 2 + lineH * (i + 1) - 4, canvas.width - pad * 2);
    });
    return new Promise(function (resolve) {
      canvas.toBlob(function (b) { resolve({ blob: b, dataUrl: canvas.toDataURL("image/jpeg", 0.92) }); }, "image/jpeg", 0.92);
    });
  }
  function openPhoto(existing) {
    if (!existing) {
      openOverlay("Photo", "Point number");
      var last = state.currentPoint || "";
      $("ovBody").innerHTML = '<p class="hint">Enter the point number first. The photo is named from it (1045_1.jpg, 1045_2.jpg, \u2026). The last point used is filled in when there is one \u2014 nothing is invented.</p>' +
        fieldHtml("pPromptPt", "Point number", last, { ph: "e.g. 1045", list: "ctrlList", span: true });
      $("ovFoot").innerHTML = '<button type="button" class="btn btn-primary" id="pPromptGo">Continue</button>';
      if ($("pPromptPt")) { $("pPromptPt").focus(); $("pPromptPt").select && $("pPromptPt").select(); }
      $("pPromptGo").onclick = function () {
        var pt = ($("pPromptPt") && $("pPromptPt").value.trim()) || "";
        if (!pt) { toast("Enter a point number for the photo name"); return; }
        setCurrentPoint(pt);
        var ev = { id: uid(), type: "photo", time: nowTime(), ts: new Date().toISOString(), fields: {}, pointNo: pt };
        openPhotoForm(ev, false);
      };
      return;
    }
    openPhotoForm(existing, true);
  }
  function openPhotoForm(ev, isEdit) {
    photoDraft = ev;
    openOverlay("Photo", isEdit ? "Edit" : "New");
    var gpsLine = ev.lat && ev.lon ? (ev.lat + ", " + ev.lon + (ev.gpsAccuracy ? " \u00b1" + ev.gpsAccuracy + " m" : "") + (ev.heading ? "  Hdg " + ev.heading : "")) : "";
    $("ovBody").innerHTML = '<div class="grid g2">' +
      fieldHtml("pTime", "Time", ev.time, { type: "time" }) +
      fieldHtml("pPt", "Point no.", ev.pointNo, { ph: "File name uses this, e.g. 1045_1.jpg", list: "ctrlList" }) +
      fieldHtml("pCode", "Code / description", ev.code || (ev.fields && ev.fields.code) || "", { ph: "Feature code or short description" }) +
      fieldHtml("pNote", "Short note", ev.notes, { span: true }) +
      '</div><div class="photo-preview" id="pPrev"></div>' +
      '<div class="actions"><button type="button" class="btn btn-primary" id="pCam">Take photo</button>' +
      '<button type="button" class="btn" id="pLib">Choose from library</button>' +
      '<button type="button" class="btn" id="pGps">Add GPS</button></div>' +
      '<p class="hint" id="pGpsLine">' + esc(gpsLine) + "</p>" +
      '<p class="hint">The file is named from the point (1045_1.jpg, 1045_2.jpg, \u2026). The stamp includes job, date/time, point, code, GPS, heading, crew, and note when those are known \u2014 never invented.</p>';
    $("ovFoot").innerHTML = '<button type="button" class="btn btn-primary" id="pSave">Save photo</button>';
    function showPrev(url) {
      $("pPrev").innerHTML = url ? '<img alt="Photo preview" src="' + url + '">' : "";
    }
    if (ev.fileId) {
      FNIdb.fileGet(ev.fileId).then(function (rec) {
        if (rec && rec.blob) showPrev(URL.createObjectURL(rec.blob));
      });
    }
    function applyFix(pos) {
      if (!pos || pos.lat == null || pos.lon == null) return;
      ev.lat = Number(pos.lat).toFixed(6);
      ev.lon = Number(pos.lon).toFixed(6);
      ev.gpsAccuracy = (pos.accuracy != null && isFinite(pos.accuracy)) ? String(Math.round(pos.accuracy * 10) / 10) : "";
      ev.heading = (pos.heading != null && isFinite(pos.heading)) ? String(Math.round(pos.heading)) : "";
      var line = ev.lat + ", " + ev.lon;
      if (ev.gpsAccuracy) line += " \u00b1" + ev.gpsAccuracy + " m";
      if (ev.heading) line += "  Hdg " + ev.heading + "\u00b0";
      if ($("pGpsLine")) $("pGpsLine").textContent = line;
    }
    $("pCam").onclick = function () {
      ev.pointNo = $("pPt") ? $("pPt").value : ev.pointNo;
      if (!String(ev.pointNo || "").trim()) { toast("Enter a point number first"); return; }
      FNPlatform.getLocation().then(applyFix).catch(function () {});
      $("cameraInput").click();
    };
    $("pLib").onclick = function () {
      ev.pointNo = $("pPt") ? $("pPt").value : ev.pointNo;
      if (!String(ev.pointNo || "").trim()) { toast("Enter a point number first"); return; }
      $("libraryInput").click();
    };
    $("pGps").onclick = function () {
      FNPlatform.getLocation().then(applyFix).catch(function () { toast("Location unavailable"); });
    };
    $("pSave").onclick = function () {
      ev.time = $("pTime").value;
      ev.pointNo = $("pPt").value;
      ev.code = $("pCode") ? $("pCode").value : ev.code;
      ev.notes = $("pNote") ? $("pNote").value : ev.notes;
      ev.fields = ev.fields || {};
      ev.fields.code = ev.code || "";
      ev.type = "photo";
      if (!String(ev.pointNo || "").trim()) { toast("Enter a point number for the photo name"); return; }
      if (!ev.fileId) { toast("Take or choose a photo first"); return; }
      var warn = warnIfPointIssue(ev.pointNo, ev.id);
      ev.warnOutside = warn.outside; ev.warnDuplicate = warn.duplicate;
      setCurrentPoint(ev.pointNo);
      upsertEvent(ev); photoDraft = null; closeOverlay();
    };
  }

  function handlePhotoFile(file) {
    if (!file || !photoDraft) return;
    var ev = photoDraft;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var when = new Date();
        ev.time = $("pTime") ? $("pTime").value || nowTime() : nowTime();
        ev.pointNo = $("pPt") ? $("pPt").value : ev.pointNo;
        if (!String(ev.pointNo || "").trim()) { toast("Enter a point number for the photo name"); return; }
        ev.code = $("pCode") ? $("pCode").value : ev.code;
        ev.notes = $("pNote") ? $("pNote").value : ev.notes;
        ev.fields = ev.fields || {};
        ev.fields.code = ev.code || "";
        var gps = "";
        if (ev.lat && ev.lon) {
          gps = ev.lat + ", " + ev.lon;
          if (ev.gpsAccuracy) gps += " \u00b1" + ev.gpsAccuracy + " m";
        }
        var meta = {
          jobNo: state.header.jobNo || "",
          pointNo: ev.pointNo || "",
          dateTime: when.toLocaleString(),
          crew: [state.header.partyChief, state.header.crew].filter(Boolean).join(" \u00b7 "),
          gps: gps,
          heading: ev.heading ? ev.heading + "\u00b0" : "",
          code: ev.code || "",
          note: ev.notes || "",
          description: ev.code || ev.notes || ""
        };
        drawWatermark(img, meta).then(function (out) {
          var name = buildPhotoName(ev.pointNo, when);
          ev.filename = name;
          ev.fileId = ev.fileId || ("photo-" + ev.id);
          ev.ts = when.toISOString();
          return FNIdb.filePut({ id: ev.fileId, kind: "photo", name: name, type: "image/jpeg", blob: out.blob }).then(function () {
            var prev = $("pPrev");
            if (prev) prev.innerHTML = '<img alt="Watermarked preview" src="' + out.dataUrl + '">';
            toast("Watermarked as " + name);
          });
        }).catch(function () { toast("Could not watermark that photo"); });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function parseDelimited(text) {
    var lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
    return lines.map(function (line) {
      if (line.indexOf("\t") >= 0) return line.split("\t");
      var rows = [], cur = "", q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ",") { rows.push(cur); cur = ""; }
        else cur += ch;
      }
      rows.push(cur);
      return rows.map(function (c) { return c.trim(); });
    });
  }
  function looksHeader(row) {
    var s = row.map(function (c) { return c.toLowerCase(); }).join(" ");
    return /point|pt\b|north|east|elev|lat|lon|long|n\b|e\b|z\b|desc|code/.test(s) && !/^\d/.test(row[0] || "");
  }
  function applyOrder(row, order) {
    var m = { p: "", n: "", e: "", z: "", d: "" };
    var map = { P: "p", N: "n", E: "e", Z: "z", D: "d" };
    order.split("").forEach(function (ch, i) {
      var k = map[ch.toUpperCase()];
      if (k) m[k] = row[i] || "";
    });
    return { name: m.p, n: m.n, e: m.e, z: m.z, desc: m.d };
  }
  function openCsvImport(kind, text, fileName) {
    var rows = parseDelimited(text);
    if (!rows.length) { toast("That file has no rows"); return; }
    var hasHeader = looksHeader(rows[0]);
    var startRow = hasHeader ? 1 : 0;
    var headers = hasHeader ? rows[0] : rows[0].map(function (_, i) { return "Column " + (i + 1); });
    var sig = headerSignature(headers);
    var remembered = loadColMap(sig);
    var map = remembered && remembered.length === headers.length ? remembered.slice() : headers.map(function (h, i) {
      var g = guessField(h);
      if (g) return g;
      if (!hasHeader) {
        var sample = rows[startRow] || [];
        if (headers.length >= 5 && i < 5) return ["p", "n", "e", "z", "d"][i];
        if (headers.length >= 3 && i === 0) return "p";
        if (headers.length >= 3 && i === 1 && looksLat(sample[1])) return "lat";
        if (headers.length >= 3 && i === 2 && looksLon(sample[2])) return "lon";
      }
      return "";
    });
    var fieldOpts = [["", "(skip)"], ["p", "Point"], ["n", "North"], ["e", "East"], ["z", "Elev"], ["d", "Desc / code"], ["lat", "Latitude"], ["lon", "Longitude"]];
    var preview = rows.slice(startRow, startRow + 4);
    var html = '<p class="hint">Match each column once. This mapping is remembered for files with the same headers.</p><div class="col-map">';
    headers.forEach(function (h, i) {
      var opts = fieldOpts.map(function (o) {
        return '<option value="' + o[0] + '"' + (map[i] === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
      }).join("");
      var sample = preview.map(function (r) { return r[i] || ""; }).filter(Boolean).slice(0, 2).join("  ·  ");
      if (sample.length > 48) sample = sample.slice(0, 47) + "\u2026";
      html += '<div class="col-map-row"><div><strong>' + esc(h) + '</strong><div class="sample">' + esc(sample) + "</div></div>" +
        '<select data-cmap="' + i + '">' + opts + "</select></div>";
    });
    html += "</div>";
    if (hasHeader) html += '<p class="hint">The first row is treated as a header and will not be imported as a point.</p>';
    openOverlay(kind === "control" ? "Import control" : "Import points", fileName || "");
    $("ovBody").innerHTML = html;
    $("ovFoot").innerHTML = '<button type="button" class="btn btn-primary" id="csvGo">Import</button>';
    $("csvGo").onclick = function () {
      var cmap = [];
      headers.forEach(function (_, i) {
        var sel = document.querySelector('[data-cmap="' + i + '"]');
        cmap[i] = sel ? sel.value : "";
      });
      saveColMap(sig, cmap);
      var list = [];
      for (var r = startRow; r < rows.length; r++) {
        var row = rows[r];
        if (!row || !row.length) continue;
        var rec = { name: "", n: "", e: "", z: "", desc: "", lat: "", lon: "", sourceFile: fileName || "" };
        cmap.forEach(function (f, i) {
          var v = row[i] || "";
          if (f === "p") rec.name = v;
          else if (f === "n") rec.n = v;
          else if (f === "e") rec.e = v;
          else if (f === "z") rec.z = v;
          else if (f === "d") rec.desc = v;
          else if (f === "lat") rec.lat = v;
          else if (f === "lon") rec.lon = v;
        });
        if (!rec.name && !rec.n && !rec.e && !rec.lat) continue;
        list.push(rec);
      }
      if (kind === "control") state.controlList = (state.controlList || []).concat(list);
      else state.importedPoints = (state.importedPoints || []).concat(list);
      saveNow();
      updatePointRangeDisplay();
      updateImportSummary();
      fillControlDatalist();
      closeOverlay();
      if (kind === "control") renderControl();
      toast("Imported " + list.length + " " + (kind === "control" ? "control" : "point") + " rows");
    };
  }
  function importTextFile(kind, file) {
    var reader = new FileReader();
    reader.onload = function () { openCsvImport(kind, String(reader.result || ""), file.name); };
    reader.readAsText(file);
  }
  function importReference(file) {
    var id = "ref-" + uid();
    FNIdb.filePut({ id: id, kind: "reference", name: file.name, type: file.type || "application/octet-stream", blob: file }).then(function () {
      state.references = state.references || [];
      state.references.push({ id: id, name: file.name, type: file.type || "" });
      saveNow(); updateImportSummary();
      toast("Attached " + file.name);
    }).catch(function () { toast("Could not store that file"); });
  }
  function mapJxlCrs(cs) {
    if (!cs) return;
    var bits = ((cs.systemName || "") + " " + (cs.zoneName || "") + " " + (cs.datumName || "")).toLowerCase();
    var zone = "";
    var units = "";
    if (/california|ca\b/.test(bits)) {
      var m = bits.match(/zone\s*([1-6])/);
      if (m) zone = "CA_ZONE_" + m[1];
    }
    if (/utm/.test(bits)) {
      var um = bits.match(/utm[^0-9]*([1-9][0-9]?)/);
      var hemi = /south/.test(bits) ? "S" : "N";
      if (um) zone = "UTM_" + um[1] + hemi;
    }
    if (/us\s*survey|us-ft|usft/.test(bits) || /survey\s*foot/.test(bits)) units = "us-ft";
    else if (/international\s*foot|intl-ft/.test(bits)) units = "intl-ft";
    else if (/meter|metre/.test(bits)) units = "m";
    var h = state.header;
    var note = "From JXL" + (cs.systemName || cs.zoneName ? ": " + [cs.systemName, cs.zoneName, cs.datumName].filter(Boolean).join(" / ") : "");
    if (zone && !h.crsZone) h.crsZone = zone;
    if (units && !h.crsUnits) h.crsUnits = units;
    h.crsFromJxl = note;
    h.crsEpochConfirmed = false;
    writeHeader();
  }
  function timeFromTs(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    if (!isNaN(d.getTime())) {
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    }
    var m = String(ts).match(/(\d{1,2}):(\d{2})/);
    return m ? String(m[1]).padStart(2, "0") + ":" + m[2] : "";
  }
  function mapJxlEvent(raw, fileName, jobTs) {
    var f = raw.fields || {};
    var ev = {
      id: uid(),
      type: raw.type || "note",
      time: timeFromTs(raw.ts || jobTs),
      ts: raw.ts || jobTs || new Date().toISOString(),
      pointNo: "",
      notes: "",
      fields: {},
      importedFrom: "JXL",
      sourceFile: fileName || ""
    };
    if (ev.type === "gnss_base") {
      ev.pointNo = f.basePt || f.pointName || f.Name || "";
      ev.fields = {
        occupied: ev.pointNo, station: ev.pointNo,
        antenna: f.antennaType || "",
        receiver: f.receiver || "",
        antennaReceiver: antennaReceiverFrom({ antenna: f.antennaType || "", receiver: f.receiver || "" }),
        height: f.measuredHeight || "", heightMethod: f.heightMethod || ""
      };
      ev.notes = [f.notes, f.unitsNote].filter(Boolean).join(" ");
    } else if (ev.type === "ts_setup") {
      ev.pointNo = f.occ || f.stationName || "";
      ev.fields = {
        occupied: ev.pointNo, hi: f.hi1 || "", hiMethod: f.hiMethod || "",
        bsPt: f.bs || f.bsPt || "", instMake: f.instMake || "", instSN: f.instSN || ""
      };
      ev.notes = [f.notes, f.unitsNote, f.instMake ? ("Instrument " + f.instMake + (f.instSN ? " SN " + f.instSN : "")) : ""].filter(Boolean).join(" · ");
    } else if (ev.type === "bs_check") {
      ev.pointNo = f.bs || f.pt || f.backsight || "";
      ev.fields = {
        occupied: f.occ || "", bsPt: f.bs || f.pt || ev.pointNo,
        face1HA: f.face1HA || "", face2HA: f.face2HA || "",
        orientationCorrection: f.orientationCorrection || "",
        n: f.n || "", e: f.e || "", z: f.z || ""
      };
      ev.check = emptyCheck();
      ev.check.pt = ev.pointNo;
      ev.check.nRec = f.n || ""; ev.check.eRec = f.e || ""; ev.check.elevRec = f.z || "";
      ev.notes = f.notes || f.desc || [f.occ ? ("Occupied " + f.occ) : "", f.face1HA ? ("HA " + f.face1HA) : ""].filter(Boolean).join(" · ");
    } else if (ev.type === "point_log") {
      ev.pointNo = f.pt || f.name || f.Name || "";
      ev.fields = { code: f.code || "", n: f.n || "", e: f.e || "", z: f.z || "", method: f.method || f.surveyMethod || "" };
      ev.lat = f.lat || ""; ev.lon = f.lon || "";
      ev.notes = [f.desc, f.code, f.method || f.surveyMethod].filter(Boolean).join(" · ");
    } else {
      ev.pointNo = f.pt || f.pointName || f.basePt || f.occ || "";
      ev.notes = f.text || f.notes || "";
      ev.fields = f;
    }
    if (!ev.notes) ev.notes = "Imported from JXL";
    else if (ev.notes.indexOf("Imported from JXL") < 0) ev.notes += " · Imported from JXL";
    if (fileName && ev.notes.indexOf(fileName) < 0) ev.notes += " (" + fileName + ")";
    var warn = checkPointNumber(ev.pointNo, ev.id);
    ev.warnOutside = warn.outside; ev.warnDuplicate = warn.duplicate;
    return ev;
  }
  function importJxlFile(file) {
    if (FNJxl.isBinaryJobName(file.name)) { toast(FNJxl.JOB_MESSAGE); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = FNJxl.parse(String(reader.result || ""), file.name);
        mapJxlCrs(parsed.coordinateSystem);
        if (parsed.header && parsed.header.jobName && !state.header.jobName && !state.header.projectTitle) {
          state.header.jobName = parsed.header.jobName;
        }
        var nSetup = 0, nBs = 0, nPts = 0, nOther = 0;
        (parsed.events || []).forEach(function (raw) {
          var ev = mapJxlEvent(raw, file.name, parsed.header && parsed.header.timeStamp);
          if (ev.type === "gnss_base" || ev.type === "ts_setup") nSetup++;
          else if (ev.type === "bs_check") nBs++;
          else if (ev.type === "point_log") nPts++;
          else nOther++;
          state.events.push(ev);
        });
        var seen = {};
        function addImportedPoint(pt) {
          var name = pt.name || pt.pt || pt.Name || "";
          if (!name || seen[name.toLowerCase()]) return;
          seen[name.toLowerCase()] = true;
          state.importedPoints.push({
            name: name, n: pt.n || "", e: pt.e || "", z: pt.z || "",
            lat: pt.lat || "", lon: pt.lon || "",
            desc: pt.code || pt.desc || "",
            sourceFile: file.name, importedFrom: "JXL"
          });
        }
        (parsed.points || []).forEach(addImportedPoint);
        (parsed.reductions || []).forEach(function (r) {
          var name = r.pt || r.name || "";
          if (!name || seen[name.toLowerCase()]) { addImportedPoint(r); return; }
          addImportedPoint(r);
          var already = (state.events || []).some(function (e) { return eventPoint(e).toLowerCase() === name.toLowerCase() && e.sourceFile === file.name; });
          if (!already) {
            state.events.push(mapJxlEvent({ type: "point_log", ts: parsed.header && parsed.header.timeStamp, fields: r }, file.name, parsed.header && parsed.header.timeStamp));
            nPts++;
          }
        });
        saveNow();
        writeHeader();
        renderTimeline();
        closeOverlay();
        var bits = [];
        if (nSetup) bits.push(nSetup + " setup" + (nSetup === 1 ? "" : "s"));
        if (nBs) bits.push(nBs + " backsight" + (nBs === 1 ? "" : "s"));
        if (nPts || (state.importedPoints || []).length) bits.push((nPts || parsed.points.length) + " point" + ((nPts || parsed.points.length) === 1 ? "" : "s"));
        if (nOther) bits.push(nOther + " other");
        toast("Imported JobXML" + (bits.length ? ": " + bits.join(", ") : "") + ". Confirm the coordinate-system epoch before export.");
      } catch (err) {
        toast(err && err.message ? err.message : "Could not parse that JobXML file");
      }
    };
    reader.readAsText(file);
  }

  function levelCompute() {
    var rows = (state.level && state.level.rows) || [];
    var hi = null, lastElev = null;
    var computed = rows.map(function (r) {
      var out = { hi: null, elev: null };
      var bs = num(r.bs), fs = num(r.fs);
      if (r.kind === "BM" || (r.knownElev !== "" && r.knownElev != null && num(r.knownElev) !== null && !r._fromHi)) {
        var ke = num(r.knownElev);
        if (ke !== null) { out.elev = ke; lastElev = ke; }
      }
      if (out.elev === null && hi !== null && fs !== null) {
        out.elev = hi - fs;
        lastElev = out.elev;
      }
      if (out.elev === null && lastElev !== null && fs === null && bs === null && r.kind !== "BM") {
        out.elev = lastElev;
      }
      if (bs !== null && (out.elev !== null)) {
        out.hi = out.elev + bs;
        hi = out.hi;
      } else if (bs !== null && lastElev !== null && out.elev === null) {
        out.elev = lastElev;
        out.hi = out.elev + bs;
        hi = out.hi;
      } else {
        out.hi = hi;
      }
      return out;
    });
    var sumBS = 0, sumFSTurn = 0, sumFSAll = 0, setups = 0, dist = 0, distN = 0;
    var startElev = null, endKnown = null, endComp = null;
    rows.forEach(function (r, i) {
      var bs = num(r.bs), fs = num(r.fs);
      if (bs !== null) { sumBS += bs; setups += 1; }
      if (fs !== null) {
        sumFSAll += fs;
        if (r.kind !== "IFS") sumFSTurn += fs;
      }
      if (num(r.bsDist) !== null) { dist += num(r.bsDist); distN++; }
      if (num(r.fsDist) !== null) { dist += num(r.fsDist); distN++; }
      if (i === 0 && computed[i].elev !== null) startElev = computed[i].elev;
      if (computed[i].elev !== null) endComp = computed[i].elev;
      if (r.kind === "BM" && i > 0 && num(r.knownElev) !== null) endKnown = num(r.knownElev);
    });
    var delta = (startElev !== null && endComp !== null) ? (endComp - startElev) : null;
    var arith = (delta !== null) ? ((sumBS - sumFSTurn) - delta) : ((sumBS - sumFSTurn));
    var mis = (endKnown !== null && endComp !== null) ? (endComp - endKnown) : null;
    var allow = null, pass = "";
    var formula = (profile && profile.tolerances && profile.tolerances.levelClosureFormula) || "k*sqrt(km)";
    var k = profile && profile.tolerances ? num(profile.tolerances.levelClosureK) : null;
    var km = null;
    if (distN && dist > 0) {
      var units = (state.header.crsUnits || "").toLowerCase();
      km = (units === "m") ? dist / 1000 : (dist * 0.304800609601219) / 1000;
    }
    if (k !== null && /k\s*\*\s*sqrt\s*\(\s*km\s*\)/i.test(formula) && km !== null) {
      allow = k * Math.sqrt(km);
    }
    if (mis === null) pass = "incomplete";
    else if (allow === null) pass = "incomplete";
    else pass = Math.abs(mis) <= allow ? "pass" : "fail";
    return {
      computed: computed, sumBS: sumBS, sumFSTurn: sumFSTurn, sumFSAll: sumFSAll,
      setups: setups, dist: dist, distN: distN, km: km,
      startElev: startElev, endComp: endComp, endKnown: endKnown,
      delta: delta, arith: (sumBS - sumFSTurn), arithCheck: (delta !== null ? (sumBS - sumFSTurn - delta) : null),
      misclosure: mis, allowable: allow, status: pass, formula: formula, k: k
    };
  }
  function renderLevel() {
    var root = $("levelForm");
    if (!root) return;
    if (!state.level) state.level = emptyLevel();
    var L = state.level;
    var calc = levelCompute();
    var ctrlOpts = (state.controlList || []).map(function (p) {
      return '<option value="' + esc(p.name) + '">' + esc(p.name + (p.z ? "  elev " + p.z : "")) + "</option>";
    }).join("");
    var sight = L.showSightDist;
    var html = '<div class="level-meta">' +
      '<label class="fld"><span>Loop / run name</span><input id="lvName" type="text" value="' + esc(L.loopName || "") + '"></label>' +
      '<label class="fld"><span>Instrument</span><input id="lvInst" type="text" value="' + esc(L.instrument || "") + '"></label>' +
      '<label class="fld"><span>Rod</span><input id="lvRod" type="text" value="' + esc(L.rod || "") + '"></label>' +
      '<label class="fld"><span>Show sight distances</span><select id="lvSight"><option value="no"' + (sight ? "" : " selected") + '>No</option><option value="yes"' + (sight ? " selected" : "") + ">Yes</option></select></label></div>";
    html += '<div class="level-wrap"><table class="level-table"><thead><tr>' +
      "<th>Kind</th><th>Sta / Point</th><th>BS (+)</th><th>HI</th><th>FS (−)</th><th>Elev</th>";
    if (sight) html += "<th>BS dist</th><th>FS dist</th>";
    html += "<th>Notes</th><th></th></tr></thead><tbody>";
    L.rows.forEach(function (r, i) {
      var c = calc.computed[i] || {};
      html += '<tr data-li="' + i + '"><td><select data-lk="kind">' +
        ["BM","TP","IFS"].map(function (k) { return '<option value="' + k + '"' + (r.kind === k ? " selected" : "") + ">" + k + "</option>"; }).join("") +
        "</select></td>";
      html += '<td><input data-lk="sta" type="text" value="' + esc(r.sta || "") + '" list="lvCtrl"></td>';
      html += '<td><input class="num" data-lk="bs" type="text" inputmode="decimal" value="' + esc(r.bs || "") + '"></td>';
      html += '<td><div class="level-computed">' + esc(fmt3(c.hi)) + "</div></td>";
      html += '<td><input class="num" data-lk="fs" type="text" inputmode="decimal" value="' + esc(r.fs || "") + '"></td>';
      if (r.kind === "BM") {
        html += '<td><input class="num" data-lk="knownElev" type="text" inputmode="decimal" value="' + esc(r.knownElev || "") + '" placeholder="Known elev"></td>';
      } else {
        html += '<td><div class="level-computed">' + esc(fmt3(c.elev)) + "</div></td>";
      }
      if (sight) {
        html += '<td><input class="num" data-lk="bsDist" type="text" inputmode="decimal" value="' + esc(r.bsDist || "") + '"></td>';
        html += '<td><input class="num" data-lk="fsDist" type="text" inputmode="decimal" value="' + esc(r.fsDist || "") + '"></td>';
      }
      html += '<td><input data-lk="notes" type="text" value="' + esc(r.notes || "") + '"></td>';
      html += '<td><button type="button" class="btn btn-sm" data-ldel>✕</button></td></tr>';
    });
    html += "</tbody></table></div>";
    if (ctrlOpts) html += '<datalist id="lvCtrl">' + ctrlOpts + "</datalist>";
    html += '<div class="actions"><button type="button" class="btn" id="lvAddTP">Add TP</button>' +
      '<button type="button" class="btn" id="lvAddIFS">Add IFS / side shot</button>' +
      '<button type="button" class="btn" id="lvAddBM">Add closing BM</button></div>';
    html += '<div class="level-summary">';
    html += '<div class="row"><span>Σ BS</span><span>' + esc(fmt3(calc.sumBS)) + "</span></div>";
    html += '<div class="row"><span>Σ FS (turns, excluding IFS)</span><span>' + esc(fmt3(calc.sumFSTurn)) + "</span></div>";
    html += '<div class="row"><span>Σ BS − Σ FS (turns)</span><span>' + esc(fmt3(calc.arith)) + "</span></div>";
    html += '<div class="row"><span>Δ elev (computed end − start)</span><span>' + esc(fmt3(calc.delta)) + "</span></div>";
    html += '<div class="row"><span>Arithmetic check (should be 0.000)</span><span>' + esc(fmt3(calc.arithCheck)) + "</span></div>";
    html += '<div class="row"><span>Closing BM (known)</span><span>' + esc(fmt3(calc.endKnown)) + "</span></div>";
    html += '<div class="row"><span>Closing elev (computed)</span><span>' + esc(fmt3(calc.endComp)) + "</span></div>";
    html += '<div class="row"><span>Misclosure (computed − known)</span><span>' + esc(fmt3(calc.misclosure)) + "</span></div>";
    html += '<div class="row"><span>Setups</span><span>' + esc(String(calc.setups)) + "</span></div>";
    html += '<div class="row"><span>Sight distance sum</span><span>' + (calc.distN ? esc(fmt3(calc.dist)) : "—") + "</span></div>";
    html += '<div class="row"><span>Allowable</span><span>' + (calc.allowable !== null ? esc(fmt3(calc.allowable)) + "  (" + esc(calc.formula) + (calc.k !== null ? ", K=" + calc.k : "") + ")" : "Set levelClosureK in the company profile to compute allowable closure") + "</span></div>";
    html += '<div class="row"><span>Closure</span><span class="badge ' + esc(calc.status) + '">' + esc(calc.status) + "</span></div></div>";
    root.innerHTML = html;
    function readMeta() {
      L.loopName = $("lvName").value; L.instrument = $("lvInst").value; L.rod = $("lvRod").value;
      var next = $("lvSight").value === "yes";
      var changed = next !== L.showSightDist;
      L.showSightDist = next;
      return changed;
    }
    ["lvName","lvInst","lvRod"].forEach(function (id) { $(id).addEventListener("input", function () { readMeta(); scheduleSave(); }); });
    $("lvSight").addEventListener("change", function () { readMeta(); scheduleSave(); renderLevel(); });
    root.querySelectorAll("tr[data-li]").forEach(function (tr) {
      var i = Number(tr.getAttribute("data-li"));
      tr.querySelectorAll("[data-lk]").forEach(function (inp) {
        inp.addEventListener("input", function () {
          L.rows[i][inp.getAttribute("data-lk")] = inp.value;
          if (inp.getAttribute("data-lk") === "sta") warnIfPointIssue(inp.value);
          scheduleSave();
          renderLevelKeep(inp);
        });
        inp.addEventListener("change", function () {
          L.rows[i][inp.getAttribute("data-lk")] = inp.value;
          scheduleSave(); renderLevelKeep(inp);
        });
      });
      var del = tr.querySelector("[data-ldel]");
      if (del) del.addEventListener("click", function () {
        if (L.rows.length <= 1) { L.rows[0] = emptyLevelRow("BM"); }
        else L.rows.splice(i, 1);
        scheduleSave(); renderLevel();
      });
    });
    $("lvAddTP").onclick = function () { L.rows.push(emptyLevelRow("TP")); scheduleSave(); renderLevel(); };
    $("lvAddIFS").onclick = function () { L.rows.push(emptyLevelRow("IFS")); scheduleSave(); renderLevel(); };
    $("lvAddBM").onclick = function () { L.rows.push(emptyLevelRow("BM")); scheduleSave(); renderLevel(); };
    updatePointRangeDisplay();
  }
  function renderLevelKeep(el) {
    var key = el.getAttribute("data-lk");
    var tr = el.closest("tr");
    var idx = tr ? tr.getAttribute("data-li") : "";
    var start = el.selectionStart, end = el.selectionEnd;
    renderLevel();
    var again = document.querySelector('tr[data-li="' + idx + '"] [data-lk="' + key + '"]');
    if (again) { again.focus(); try { again.setSelectionRange(start, end); } catch (e) {} }
  }

  function defaultCrewRows() {
    return ["1 Person Crew", "2 Person Crew", "3 Person Crew"].map(function (lab) {
      return { personnel: lab, regHours: "", otHours: "", phase: "", task: "", crew: "" };
    });
  }
  function emptySigner() { return { name: "", sigDataUrl: "", date: "" }; }
  function emptyDailyReport() {
    return {
      projectName: "", client: "", dateReceived: "", jobNumber: "",
      workOrderedBy: "", datePerformed: "", receivedBy: "",
      times: { onSite: defaultCrewRows(), offSite: defaultCrewRows(), travel: defaultCrewRows() },
      detailedWork: "",
      lodging: "", overnight: "", meals: "", otherExpenses: "", repOnSite: "",
      mileage: "", fromOffice: "",
      crewSigner: emptySigner(), clientSigner: emptySigner()
    };
  }
  function dailyLabels() {
    var d = (profile && profile.dailyReport) || {};
    return {
      title: d.title || "DAILY FIELD REPORT",
      projectNameLabel: d.projectNameLabel || "Project Name:",
      clientLabel: d.clientLabel || "Client:",
      dateReceivedLabel: d.dateReceivedLabel || "Date Received:",
      jobNumberLabel: d.jobNumberLabel || "Job Number:",
      workOrderedByLabel: d.workOrderedByLabel || "Work Ordered By:",
      datePerformedLabel: d.datePerformedLabel || "Date Work Performed:",
      receivedByLabel: d.receivedByLabel || "Received By:",
      onSiteTitle: d.onSiteTitle || "On-Site Time",
      offSiteTitle: d.offSiteTitle || "Off-Site Time",
      travelTitle: d.travelTitle || "Travel Time",
      personnelLabel: d.personnelLabel || "Personnel",
      regHoursLabel: d.regHoursLabel || "Reg. Hours",
      otHoursLabel: d.otHoursLabel || "OT Hours",
      phaseLabel: d.phaseLabel || "Phase",
      taskLabel: d.taskLabel || "Task",
      crewLabel: d.crewLabel || "Crew",
      detailedTitle: d.detailedTitle || "Detailed Work Report",
      lodgingLabel: d.lodgingLabel || "Lodging?",
      overnightLabel: d.overnightLabel || "Overnight",
      mealsLabel: d.mealsLabel || "Meals?",
      otherExpensesLabel: d.otherExpensesLabel || "Other Expenses?",
      repOnSiteLabel: d.repOnSiteLabel || "Rep. on site?",
      mileageLabel: d.mileageLabel || "Mileage:",
      fromOfficeLabel: d.fromOfficeLabel || "From what Office:",
      ynHint: d.ynHint || "Y / N",
      authorizationNote: d.authorizationNote || "Signatures authorize on-site work and hours as stated above.",
      crewSignerLabel: d.crewSignerLabel || "Party Chief / Crew",
      clientSignerLabel: d.clientSignerLabel || "Authorized Client / Site Representative",
      nameLabel: d.nameLabel || "Name:",
      signedLabel: d.signedLabel || "Signed:",
      dateLabel: d.dateLabel || "Date:"
    };
  }
  function ensureDaily() {
    if (!state.dailyReport) state.dailyReport = emptyDailyReport();
    var d = state.dailyReport;
    var h = state.header || {};
    if (!d.projectName) d.projectName = h.projectTitle || h.jobName || "";
    if (!d.jobNumber) d.jobNumber = h.jobNo || "";
    if (!d.datePerformed) d.datePerformed = h.date || "";
    ["onSite", "offSite", "travel"].forEach(function (k) {
      if (!d.times[k] || !d.times[k].length) d.times[k] = defaultCrewRows();
    });
    if (!d.crewSigner) d.crewSigner = emptySigner();
    if (!d.clientSigner) d.clientSigner = emptySigner();
    return d;
  }
  function timelineAsWorkReport() {
    return (state.events || []).slice().sort(function (a, b) {
      return String(eventTime(a)).localeCompare(String(eventTime(b)));
    }).map(function (ev) {
      var pt = eventPoint(ev);
      var line = (ev.time ? ev.time + "  " : "") + typeLabel(ev.type);
      if (pt) line += "  pt " + pt;
      if (ev.notes) line += "  — " + ev.notes;
      if (ev.status) line += "  [" + ev.status + "]";
      return line;
    }).join("\n");
  }
  function ynSelect(id, val) {
    return '<select id="' + id + '"><option value=""></option>' +
      '<option value="Y"' + (val === "Y" ? " selected" : "") + ">Y</option>" +
      '<option value="N"' + (val === "N" ? " selected" : "") + ">N</option></select>";
  }
  function renderDaily() {
    var root = $("dailyForm");
    if (!root) return;
    var d = ensureDaily();
    var L = dailyLabels();
    function inp(id, val, typ) {
      typ = typ || "text";
      return '<input id="' + id + '" type="' + typ + '" value="' + esc(val || "") + '">';
    }
    function timeTable(key, title) {
      var html = '<div class="dfr-sec-hd">' + esc(title) + "</div>";
      html += '<div style="overflow-x:auto"><table class="dfr-table"><thead><tr>' +
        "<th>" + esc(L.personnelLabel) + "</th><th>" + esc(L.regHoursLabel) + "</th><th>" + esc(L.otHoursLabel) + "</th>" +
        "<th>" + esc(L.phaseLabel) + "</th><th>" + esc(L.taskLabel) + "</th><th>" + esc(L.crewLabel) + "</th></tr></thead><tbody>";
      d.times[key].forEach(function (row, i) {
        html += "<tr><td class=\"row-lab\">" + esc(row.personnel || "") + "</td>";
        ["regHours","otHours","phase","task","crew"].forEach(function (f) {
          html += '<td><input data-tk="' + key + '" data-ti="' + i + '" data-tf="' + f + '" type="text" value="' + esc(row[f] || "") + '"></td>';
        });
        html += "</tr>";
      });
      return html + "</tbody></table></div>";
    }
    var html = '<div class="dfr" id="dfrBox"><h1 class="dfr-title">' + esc(L.title) + "</h1>";
    html += '<div class="dfr-head">';
    html += '<label class="fld"><span>' + esc(L.projectNameLabel) + "</span>" + inp("drProject", d.projectName) + "</label>";
    html += '<label class="fld"><span>' + esc(L.clientLabel) + "</span>" + inp("drClient", d.client) + "</label>";
    html += '<label class="fld"><span>' + esc(L.dateReceivedLabel) + "</span>" + inp("drRecvDate", d.dateReceived, "date") + "</label>";
    html += '<label class="fld"><span>' + esc(L.jobNumberLabel) + "</span>" + inp("drJob", d.jobNumber) + "</label>";
    html += '<label class="fld"><span>' + esc(L.workOrderedByLabel) + ' <span class="hint">(optional)</span></span>' + inp("drOrdered", d.workOrderedBy) + "</label>";
    html += '<label class="fld"><span>' + esc(L.datePerformedLabel) + "</span>" + inp("drPerformed", d.datePerformed, "date") + "</label>";
    html += '<label class="fld span-row"><span>' + esc(L.receivedByLabel) + ' <span class="hint">(optional)</span></span>' + inp("drReceivedBy", d.receivedBy) + "</label>";
    html += '<div class="fld span-row"><span>Point range</span><div class="hint" id="drPointRange">' + esc(formatPointRangeLine()) + "</div></div>";
    html += "</div>";
    html += timeTable("onSite", L.onSiteTitle) + timeTable("offSite", L.offSiteTitle) + timeTable("travel", L.travelTitle);
    html += '<div class="dfr-sec-hd">' + esc(L.detailedTitle) + "</div><div class=\"dfr-detail\"><textarea id=\"drDetail\">" + esc(d.detailedWork || "") + "</textarea></div>";
    html += '<div class="dfr-exp">';
    html += '<div class="cell"><label>' + esc(L.lodgingLabel) + " " + ynSelect("drLodging", d.lodging) + "</label>" +
      "<label style=\"margin-top:6px\">" + esc(L.overnightLabel) + " " + ynSelect("drOvernight", d.overnight) + "</label>" +
      "<label style=\"margin-top:6px\">" + esc(L.mealsLabel) + " " + ynSelect("drMeals", d.meals) + "</label></div>";
    html += '<div class="cell"><label>' + esc(L.otherExpensesLabel) + " " + ynSelect("drOther", d.otherExpenses) + "</label>" +
      "<label style=\"margin-top:6px\">" + esc(L.repOnSiteLabel) + " " + ynSelect("drRep", d.repOnSite) + "</label></div>";
    html += '<div class="cell"><label>' + esc(L.mileageLabel) + " " + inp("drMiles", d.mileage) + "</label>" +
      "<label style=\"margin-top:6px\">" + esc(L.fromOfficeLabel) + " " + inp("drOffice", d.fromOffice) + "</label></div></div>";
    html += '<div class="dfr-note">' + esc(L.authorizationNote) + "</div>";
    function signerBlock(prefix, signer, label, optional) {
      return '<div class="dfr-sign"><div class="dfr-sign-grid">' +
        '<label class="fld"><span>' + esc(L.nameLabel) + '</span><input id="' + prefix + 'Name" type="text" value="' + esc(signer.name || "") + '"></label>' +
        '<div><span style="font-size:11px;font-weight:700">' + esc(L.signedLabel) + '</span><canvas id="' + prefix + 'Pad" width="400" height="120"></canvas><button type="button" class="btn btn-sm" data-clear="' + prefix + '">Clear</button></div>' +
        '<label class="fld"><span>' + esc(L.dateLabel) + '</span><input id="' + prefix + 'Date" type="date" value="' + esc(signer.date || "") + '"></label></div>' +
        '<div class="who">' + esc(label) + (optional ? ' <span class="opt">(optional)</span>' : "") + "</div></div>";
    }
    html += signerBlock("drCrew", d.crewSigner, L.crewSignerLabel, false);
    html += signerBlock("drClient", d.clientSigner, L.clientSignerLabel, true);
    html += "</div>";
    root.innerHTML = html;
    function readDaily() {
      d.projectName = $("drProject").value; d.client = $("drClient").value;
      d.dateReceived = $("drRecvDate").value; d.jobNumber = $("drJob").value;
      d.workOrderedBy = $("drOrdered").value; d.datePerformed = $("drPerformed").value;
      d.receivedBy = $("drReceivedBy").value; d.detailedWork = $("drDetail").value;
      d.lodging = $("drLodging").value; d.overnight = $("drOvernight").value; d.meals = $("drMeals").value;
      d.otherExpenses = $("drOther").value; d.repOnSite = $("drRep").value;
      d.mileage = $("drMiles").value; d.fromOffice = $("drOffice").value;
      d.crewSigner.name = $("drCrewName").value; d.crewSigner.date = $("drCrewDate").value;
      d.clientSigner.name = $("drClientName").value; d.clientSigner.date = $("drClientDate").value;
      root.querySelectorAll("[data-tk]").forEach(function (inp) {
        d.times[inp.getAttribute("data-tk")][Number(inp.getAttribute("data-ti"))][inp.getAttribute("data-tf")] = inp.value;
      });
      scheduleSave();
    }
    root.querySelectorAll("input, textarea, select").forEach(function (el) {
      el.addEventListener("input", readDaily);
      el.addEventListener("change", readDaily);
    });
    [["drCrew","crewSigner"],["drClient","clientSigner"]].forEach(function (pair) {
      var cv = $(pair[0] + "Pad");
      if (cv) {
        bindPad(cv, d[pair[1]]);
        if (d[pair[1]].sigDataUrl) {
          var img = new Image();
          img.onload = function () { cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); };
          img.src = d[pair[1]].sigDataUrl;
        }
      }
    });
    root.querySelectorAll("[data-clear]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var prefix = btn.getAttribute("data-clear");
        var which = prefix === "drCrew" ? d.crewSigner : d.clientSigner;
        var cv = $(prefix + "Pad");
        if (cv) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
        which.sigDataUrl = ""; which.date = "";
        if ($(prefix + "Date")) $(prefix + "Date").value = "";
        scheduleSave();
      });
    });
  }
  function fillDailyFromLog() {
    var d = ensureDaily();
    var text = timelineAsWorkReport();
    if (!text) { toast("No timeline entries to fill from yet"); return; }
    if (d.detailedWork && d.detailedWork.trim() && d.detailedWork.trim() !== text.trim()) {
      if (!confirm("Replace the detailed work report with today's log?")) return;
    }
    d.detailedWork = text;
    if ($("drDetail")) $("drDetail").value = text;
    scheduleSave();
    toast("Detailed work report filled from today's log — you can edit it");
  }

  var SK_W = 420, SK_H = 300;
  var SK_CIRC = { cx: 168, cy: 138, r: 76 };
  var mhUi = { holeId: "", tool: "draw", flowPts: [], snap: true, link: true, selectedFlow: "", stroke: null };

  function emptyPipeRow() { return { pt: "", dip: "", inout: "", sizeType: "", ie: "", ieComputed: false, notes: "" }; }
  function emptyManhole() {
    return {
      id: uid(), pointNo: "", desc1: "", desc2: "", rimElev: "", rimSource: "",
      pipes: [emptyPipeRow(), emptyPipeRow(), emptyPipeRow(), emptyPipeRow(), emptyPipeRow()],
      sketch: { strokes: [], rays: [], flows: [], history: [] }
    };
  }
  function emptyManholeSheet() {
    return {
      jobName: "", jobNo: "", page: "", pageOf: "", notes: "",
      noteTaker: "", noteTakerDate: "", checkedBy: "", checkedByDate: "",
      holes: [emptyManhole()]
    };
  }
  function ensureManholes() {
    if (!state.manholes || !Array.isArray(state.manholes.holes)) state.manholes = emptyManholeSheet();
    var s = state.manholes;
    var h = state.header || {};
    if (!s.jobName) s.jobName = h.projectTitle || h.jobName || "";
    if (!s.jobNo) s.jobNo = h.jobNo || "";
    if (!s.noteTaker) s.noteTaker = h.partyChief || "";
    if (!s.noteTakerDate) s.noteTakerDate = h.date || "";
    if (!s.pageOf && s.holes.length) s.pageOf = String(Math.ceil(s.holes.length / 4));
    s.holes.forEach(function (hole) {
      if (!hole.sketch) hole.sketch = { strokes: [], rays: [], flows: [], history: [] };
      if (!hole.pipes || !hole.pipes.length) hole.pipes = [emptyPipeRow(), emptyPipeRow(), emptyPipeRow(), emptyPipeRow(), emptyPipeRow()];
    });
    return s;
  }
  function unitsShort() {
    var u = String((state.header && state.header.crsUnits) || "us-ft").toLowerCase();
    if (u === "m") return "m";
    return "ft";
  }
  function lookupElev(pointNo) {
    var key = pointKey(pointNo).toLowerCase();
    if (!key) return null;
    function from(obj) {
      if (!obj) return null;
      var v = obj.z != null && obj.z !== "" ? obj.z : (obj.elev != null && obj.elev !== "" ? obj.elev : (obj.Z != null ? obj.Z : ""));
      if (v === "" && obj.fields) v = obj.fields.z || obj.fields.elev || obj.fields.elevation || "";
      return num(v);
    }
    var lists = [].concat(state.controlList || [], state.importedPoints || []);
    for (var i = 0; i < lists.length; i++) {
      var p = lists[i];
      var name = pointKey(p.name || p.pt || p.point).toLowerCase();
      if (name === key) { var e = from(p); if (e !== null) return e; }
    }
    for (var j = 0; j < (state.events || []).length; j++) {
      var ev = state.events[j];
      if (eventPoint(ev).toLowerCase() === key) {
        var evE = from(ev) || from(ev.fields);
        if (evE !== null) return evE;
      }
    }
    return null;
  }
  function computePipeIE(hole, row) {
    var rim = num(hole.rimElev), dip = num(row.dip);
    if (rim === null || dip === null) return;
    if (row.ieComputed || pointKey(row.ie) === "") {
      var v = rim - dip;
      row.ie = (Math.round(v * 1000) / 1000).toFixed(3);
      row.ieComputed = true;
    }
  }
  function recomputeHoleIEs(hole) {
    (hole.pipes || []).forEach(function (row) { computePipeIE(hole, row); });
  }
  function bearingFromNorth(x, y, c) {
    c = c || SK_CIRC;
    var deg = Math.atan2(x - c.cx, -(y - c.cy)) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  }
  function fmtBrg(deg) {
    if (deg == null || !Number.isFinite(deg)) return "";
    var n = Math.round(deg) % 360;
    if (n < 0) n += 360;
    return String(n).padStart(3, "0") + "\u00b0";
  }
  function snapToRim(pt, enabled) {
    var c = SK_CIRC;
    var brg = bearingFromNorth(pt.x, pt.y, c);
    if (!enabled) return { x: pt.x, y: pt.y, snapped: false, bearing: brg };
    var dx = pt.x - c.cx, dy = pt.y - c.cy;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: c.cx + dx / len * c.r, y: c.cy + dy / len * c.r, snapped: true, bearing: brg };
  }
  function flowControl(p1, p2, p3) {
    return { x: 2 * p2.x - 0.5 * p1.x - 0.5 * p3.x, y: 2 * p2.y - 0.5 * p1.y - 0.5 * p3.y };
  }
  function arrowPoly(ctrl, tip, len) {
    var dx = tip.x - ctrl.x, dy = tip.y - ctrl.y;
    var L = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / L, uy = dy / L;
    return [
      tip,
      { x: tip.x - ux * len - uy * len * 0.55, y: tip.y - uy * len + ux * len * 0.55 },
      { x: tip.x - ux * len + uy * len * 0.55, y: tip.y - uy * len - ux * len * 0.55 }
    ];
  }
  function drawNorthArrow(ctx) {
    var x = 36, y1 = 214, y2 = 36;
    ctx.save();
    ctx.strokeStyle = "#111"; ctx.fillStyle = "#111"; ctx.lineWidth = 3; ctx.lineCap = "butt";
    ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y2); ctx.lineTo(x - 9, y2 + 22); ctx.lineTo(x + 9, y2 + 22); ctx.closePath(); ctx.fill();
    ctx.font = "bold 26px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("N", x - 20, 118);
    ctx.restore();
  }
  function drawMhSketch(ctx, hole, w, h, preview) {
    var sx = w / SK_W, sy = h / SK_H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.scale(sx, sy);
    drawNorthArrow(ctx);
    var c = SK_CIRC;
    ctx.strokeStyle = "#111"; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2); ctx.stroke();
    var sk = hole.sketch || {};
    (sk.strokes || []).forEach(function (st) {
      var pts = st.points || [];
      if (pts.length < 2) return;
      ctx.strokeStyle = "#111"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    });
    (sk.rays || []).forEach(function (ray) {
      ctx.strokeStyle = "#111"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ray.x1, ray.y1); ctx.lineTo(ray.x2, ray.y2); ctx.stroke();
      if (ray.bearing != null) {
        ctx.fillStyle = "#111"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(fmtBrg(ray.bearing), ray.lx, ray.ly);
      }
    });
    (sk.flows || []).forEach(function (fl) {
      var p1 = fl.p1, p2 = fl.p2, p3 = fl.p3;
      if (!p1 || !p2 || !p3) return;
      var ctrl = flowControl(p1, p2, p3);
      var sel = mhUi.selectedFlow === fl.id;
      ctx.strokeStyle = sel ? "#0b5cab" : "#111";
      ctx.lineWidth = sel ? 3 : 2.2;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.quadraticCurveTo(ctrl.x, ctrl.y, p3.x, p3.y); ctx.stroke();
      var arr = arrowPoly(ctrl, p3, 14);
      ctx.fillStyle = sel ? "#0b5cab" : "#111";
      ctx.beginPath(); ctx.moveTo(arr[0].x, arr[0].y); ctx.lineTo(arr[1].x, arr[1].y); ctx.lineTo(arr[2].x, arr[2].y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(p1.x, p1.y, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      if (fl.bearingIn != null) ctx.fillText(fmtBrg(fl.bearingIn), p1.x, p1.y - 6);
      ctx.textBaseline = "top";
      if (fl.bearingOut != null) ctx.fillText(fmtBrg(fl.bearingOut), p3.x, p3.y + 6);
    });
    if (preview && preview.length) {
      ctx.fillStyle = "#0b5cab";
      preview.forEach(function (pt) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); ctx.fill(); });
      if (preview.length >= 2) {
        ctx.strokeStyle = "rgba(11,92,171,0.5)"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(preview[0].x, preview[0].y);
        for (var k = 1; k < preview.length; k++) ctx.lineTo(preview[k].x, preview[k].y);
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }
  function sketchSvg(hole, w, h) {
    function pth(pts) {
      if (!pts || !pts.length) return "";
      return "M" + pts.map(function (pt, i) { return (i ? "L" : "") + pt.x + " " + pt.y; }).join(" ");
    }
    var parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + SK_W + " " + SK_H + '" width="' + (w || SK_W) + '" height="' + (h || SK_H) + '" style="background:#fff">'];
    parts.push('<line x1="36" y1="214" x2="36" y2="36" stroke="#111" stroke-width="3"/>');
    parts.push('<polygon points="36,36 27,58 45,58" fill="#111"/>');
    parts.push('<text x="16" y="126" font-size="26" font-weight="700" font-family="serif" text-anchor="middle">N</text>');
    parts.push('<circle cx="' + SK_CIRC.cx + '" cy="' + SK_CIRC.cy + '" r="' + SK_CIRC.r + '" fill="none" stroke="#111" stroke-width="2.4"/>');
    var sk = hole.sketch || {};
    (sk.strokes || []).forEach(function (st) {
      if (st.points && st.points.length > 1) parts.push('<path d="' + pth(st.points) + '" fill="none" stroke="#111" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
    });
    (sk.rays || []).forEach(function (ray) {
      parts.push('<line x1="' + ray.x1 + '" y1="' + ray.y1 + '" x2="' + ray.x2 + '" y2="' + ray.y2 + '" stroke="#111" stroke-width="2"/>');
      if (ray.bearing != null) parts.push('<text x="' + ray.lx + '" y="' + ray.ly + '" font-size="11" text-anchor="middle" font-family="sans-serif">' + esc(fmtBrg(ray.bearing)) + "</text>");
    });
    (sk.flows || []).forEach(function (fl) {
      if (!fl.p1 || !fl.p3) return;
      var ctrl = flowControl(fl.p1, fl.p2, fl.p3);
      parts.push('<path d="M' + fl.p1.x + " " + fl.p1.y + " Q" + ctrl.x + " " + ctrl.y + " " + fl.p3.x + " " + fl.p3.y + '" fill="none" stroke="#111" stroke-width="2.2"/>');
      var arr = arrowPoly(ctrl, fl.p3, 14);
      parts.push('<polygon points="' + arr.map(function (a) { return a.x + "," + a.y; }).join(" ") + '" fill="#111"/>');
      parts.push('<circle cx="' + fl.p1.x + '" cy="' + fl.p1.y + '" r="3.2" fill="#111"/>');
      if (fl.bearingIn != null) parts.push('<text x="' + fl.p1.x + '" y="' + (fl.p1.y - 7) + '" font-size="11" text-anchor="middle" font-family="sans-serif">' + esc(fmtBrg(fl.bearingIn)) + "</text>");
      if (fl.bearingOut != null) parts.push('<text x="' + fl.p3.x + '" y="' + (fl.p3.y + 14) + '" font-size="11" text-anchor="middle" font-family="sans-serif">' + esc(fmtBrg(fl.bearingOut)) + "</text>");
    });
    parts.push("</svg>");
    return parts.join("");
  }
  function sketchPngBlob(hole, scale) {
    scale = scale || 3;
    var canvas = document.createElement("canvas");
    canvas.width = SK_W * scale; canvas.height = SK_H * scale;
    drawMhSketch(canvas.getContext("2d"), hole, canvas.width, canvas.height);
    return new Promise(function (resolve) { canvas.toBlob(function (b) { resolve(b); }, "image/png"); });
  }
  function mhSketchPush(hole, kind, id) {
    hole.sketch.history = hole.sketch.history || [];
    hole.sketch.history.push({ kind: kind, id: id });
  }
  function findHole(id) {
    return ((state.manholes && state.manholes.holes) || []).filter(function (h) { return h.id === id; })[0];
  }
  function linkFlowToPipes(hole, flow) {
    if (!mhUi.link) return;
    function take(dir, brg) {
      var row = null;
      for (var i = 0; i < hole.pipes.length; i++) {
        if (!pointKey(hole.pipes[i].inout) && !pointKey(hole.pipes[i].pt) && !pointKey(hole.pipes[i].dip)) { row = hole.pipes[i]; break; }
      }
      if (!row) { row = emptyPipeRow(); hole.pipes.push(row); }
      row.inout = dir;
      var tag = "brg " + fmtBrg(brg);
      if (!row.notes) row.notes = tag;
      else if (row.notes.indexOf("brg ") < 0) row.notes = row.notes + "; " + tag;
      return row;
    }
    flow.inletRow = true;
    take("IN", flow.bearingIn);
    take("OUT", flow.bearingOut);
  }
  function completeFlow(hole, pts) {
    var start = snapToRim(pts[0], mhUi.snap);
    var mid = pts[1];
    var end = snapToRim(pts[2], mhUi.snap);
    var fl = {
      id: uid(),
      p1: { x: start.x, y: start.y },
      p2: { x: mid.x, y: mid.y },
      p3: { x: end.x, y: end.y },
      snappedStart: start.snapped,
      snappedEnd: end.snapped,
      bearingIn: start.bearing,
      bearingOut: end.bearing
    };
    hole.sketch.flows.push(fl);
    mhSketchPush(hole, "flow", fl.id);
    mhUi.selectedFlow = fl.id;
    linkFlowToPipes(hole, fl);
    mhUi.flowPts = [];
    scheduleSave();
    renderManholes();
  }
  function undoMhSketch(hole) {
    if (mhUi.flowPts.length) { mhUi.flowPts = []; redrawHoleCanvas(hole); return; }
    var hist = hole.sketch.history || [];
    var last = hist.pop();
    if (!last) { toast("Nothing to undo"); return; }
    if (last.kind === "flow") hole.sketch.flows = (hole.sketch.flows || []).filter(function (f) { return f.id !== last.id; });
    if (last.kind === "stroke") hole.sketch.strokes = (hole.sketch.strokes || []).filter(function (f) { return f.id !== last.id; });
    if (last.kind === "ray") hole.sketch.rays = (hole.sketch.rays || []).filter(function (f) { return f.id !== last.id; });
    if (mhUi.selectedFlow === last.id) mhUi.selectedFlow = "";
    scheduleSave();
    renderManholes();
  }
  function deleteFlow(hole, id) {
    hole.sketch.flows = (hole.sketch.flows || []).filter(function (f) { return f.id !== id; });
    hole.sketch.history = (hole.sketch.history || []).filter(function (h) { return !(h.kind === "flow" && h.id === id); });
    if (mhUi.selectedFlow === id) mhUi.selectedFlow = "";
    scheduleSave();
    renderManholes();
  }
  function addPipeRay(hole, pt) {
    var c = SK_CIRC;
    var brg = bearingFromNorth(pt.x, pt.y, c);
    var rad = brg * Math.PI / 180;
    // 0° is north = -Y
    var ux = Math.sin(rad), uy = -Math.cos(rad);
    var inner = { x: c.cx + ux * (c.r * 0.2), y: c.cy + uy * (c.r * 0.2) };
    var outer = { x: c.cx + ux * (c.r + 36), y: c.cy + uy * (c.r + 36) };
    var lab = { x: c.cx + ux * (c.r + 50), y: c.cy + uy * (c.r + 50) };
    var ray = { id: uid(), x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, lx: lab.x, ly: lab.y, bearing: brg };
    hole.sketch.rays.push(ray);
    mhSketchPush(hole, "ray", ray.id);
    scheduleSave();
    redrawHoleCanvas(hole);
  }
  function canvasOf(hole) { return document.querySelector('canvas[data-mhcv="' + hole.id + '"]'); }
  function redrawHoleCanvas(hole) {
    var cv = canvasOf(hole);
    if (!cv) return;
    drawMhSketch(cv.getContext("2d"), hole, cv.width, cv.height, mhUi.holeId === hole.id ? mhUi.flowPts : null);
  }

  function bindMhCanvas(canvas, hole) {
    function toSketch(e) {
      var r = canvas.getBoundingClientRect();
      var t = e.touches ? e.touches[0] : e;
      return {
        x: (t.clientX - r.left) * (SK_W / r.width),
        y: (t.clientY - r.top) * (SK_H / r.height)
      };
    }
    canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      mhUi.holeId = hole.id;
      var pt = toSketch(e);
      if (mhUi.tool === "flow") {
        mhUi.flowPts.push(pt);
        if (mhUi.flowPts.length >= 3) completeFlow(hole, mhUi.flowPts.slice(0, 3));
        else redrawHoleCanvas(hole);
        var hint = $("mhHint-" + hole.id);
        if (hint) {
          hint.textContent = mhUi.flowPts.length === 1
            ? "Tap a middle point inside the manhole."
            : (mhUi.flowPts.length === 2 ? "Tap where flow exits." : "Tap where flow enters (on or outside the rim).");
        }
        return;
      }
      if (mhUi.tool === "pipe") { addPipeRay(hole, pt); return; }
      canvas.setPointerCapture(e.pointerId);
      mhUi.stroke = { id: uid(), points: [pt] };
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!mhUi.stroke || mhUi.tool !== "draw" || mhUi.holeId !== hole.id) return;
      e.preventDefault();
      mhUi.stroke.points.push(toSketch(e));
      var tmp = { sketch: { strokes: (hole.sketch.strokes || []).concat([mhUi.stroke]), rays: hole.sketch.rays, flows: hole.sketch.flows } };
      var ctx = canvas.getContext("2d");
      drawMhSketch(ctx, tmp, canvas.width, canvas.height);
    });
    function endStroke(e) {
      if (!mhUi.stroke || mhUi.tool !== "draw" || mhUi.holeId !== hole.id) return;
      if (e) e.preventDefault();
      if (mhUi.stroke.points.length > 1) {
        hole.sketch.strokes.push(mhUi.stroke);
        mhSketchPush(hole, "stroke", mhUi.stroke.id);
        scheduleSave();
      }
      mhUi.stroke = null;
      redrawHoleCanvas(hole);
    }
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
  }
  function renderManholes() {
    var root = $("mhForm");
    if (!root) return;
    var sheet = ensureManholes();
    var unit = unitsShort();
    var unitLbl = unit ? " (" + unit + ")" : "";
    var html = '<div class="mh-head">';
    html += '<label class="fld"><span>Job name</span><input id="mhJobName" type="text" value="' + esc(sheet.jobName || "") + '"></label>';
    html += '<label class="fld"><span>Job no.</span><input id="mhJobNo" type="text" value="' + esc(sheet.jobNo || "") + '"></label>';
    html += '<label class="fld"><span>Page</span><div style="display:flex;gap:6px;align-items:center"><input id="mhPage" type="text" value="' + esc(sheet.page || "") + '" style="flex:1"> <span>of</span> <input id="mhPageOf" type="text" value="' + esc(sheet.pageOf || "") + '" style="flex:1"></div></label>';
    html += '<label class="fld"><span>Notes</span><input id="mhNotes" type="text" value="' + esc(sheet.notes || "") + '"></label>';
    html += '<label class="fld"><span>Note taker</span><input id="mhTaker" type="text" value="' + esc(sheet.noteTaker || "") + '"></label>';
    html += '<label class="fld"><span>Note taker date</span><input id="mhTakerDate" type="date" value="' + esc(sheet.noteTakerDate || "") + '"></label>';
    html += '<label class="fld"><span>Checked by</span><input id="mhChecked" type="text" value="' + esc(sheet.checkedBy || "") + '"></label>';
    html += '<label class="fld"><span>Checked date</span><input id="mhCheckedDate" type="date" value="' + esc(sheet.checkedByDate || "") + '"></label></div>';
    html += '<p class="hint">Each card is one manhole (4 print per page). The sketch starts with a plan-view circle and north arrow. Use Draw for pipe ticks, Pipe to drop a bearing line, or Flow to tap enter → inside → exit and store a smooth arrow as vectors.</p>';
    sheet.holes.forEach(function (hole, hi) {
      html += '<article class="mh-card" data-hid="' + esc(hole.id) + '"><div class="mh-card-grid">';
      html += '<div class="mh-sketch-col"><div class="mh-canvas-wrap"><canvas data-mhcv="' + esc(hole.id) + '" width="' + (SK_W * 2) + '" height="' + (SK_H * 2) + '"></canvas></div>';
      html += '<div class="mh-tools">' +
        '<button type="button" class="btn btn-sm' + (mhUi.tool === "draw" ? " on" : "") + '" data-tool="draw">Draw</button>' +
        '<button type="button" class="btn btn-sm' + (mhUi.tool === "flow" ? " on" : "") + '" data-tool="flow">Flow</button>' +
        '<button type="button" class="btn btn-sm' + (mhUi.tool === "pipe" ? " on" : "") + '" data-tool="pipe">Pipe</button>' +
        '<button type="button" class="btn btn-sm" data-mhundo>Undo</button>' +
        '<label class="hint" style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-mhsnap' + (mhUi.snap ? " checked" : "") + "> Snap to rim</label>" +
        '<label class="hint" style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-mhlink' + (mhUi.link ? " checked" : "") + "> Link to pipe table</label></div>";
      html += '<p class="hint" id="mhHint-' + esc(hole.id) + '">' +
        (mhUi.tool === "flow" ? "Tap where flow enters (on or outside the rim)." : "Draw pipe directions from the circle, or switch to Flow.") + "</p>";
      if ((hole.sketch.flows || []).length) {
        html += '<div class="mh-flow-list">';
        hole.sketch.flows.forEach(function (fl, fi) {
          html += "<div" + (mhUi.selectedFlow === fl.id ? " style=\"font-weight:700\"" : "") + "><span>Flow " + (fi + 1) + "  " + esc(fmtBrg(fl.bearingIn)) + " in \u2192 " + esc(fmtBrg(fl.bearingOut)) + " out</span>" +
            '<button type="button" class="btn btn-sm" data-delflow="' + esc(fl.id) + '">Delete</button></div>';
        });
        html += "</div>";
      }
      html += '<label class="fld"><span>Point # <span class="hint">(rim / lid shot)</span></span><input data-hf="pointNo" type="text" value="' + esc(hole.pointNo || "") + '" autocomplete="off"></label>';
      html += '<label class="fld"><span>Rim elevation' + esc(unitLbl) + '</span><div style="display:flex;gap:6px"><input data-hf="rimElev" type="text" inputmode="decimal" value="' + esc(hole.rimElev || "") + '" style="flex:1"><button type="button" class="btn btn-sm" data-rlookup>Look up</button></div>' +
        (hole.rimSource ? '<span class="hint">' + esc(hole.rimSource) + "</span>" : "") + "</label></div>";
      html += '<div><label class="fld mh-desc"><span>Description</span><input data-hf="desc1" type="text" value="' + esc(hole.desc1 || "") + '" placeholder="Line 1"><input data-hf="desc2" type="text" value="' + esc(hole.desc2 || "") + '" placeholder="Line 2" style="margin-top:4px"></label>';
      html += '<div style="overflow-x:auto"><table class="mh-pipes"><thead><tr><th>PT#</th><th>DIP' + esc(unitLbl) + "</th><th>IN/OUT</th><th>SIZE/TYPE</th><th>I.E." + esc(unitLbl) + "</th><th>NOTES</th></tr></thead><tbody>";
      hole.pipes.forEach(function (row, ri) {
        html += '<tr data-ri="' + ri + '">';
        html += '<td><input data-pf="pt" type="text" value="' + esc(row.pt || "") + '"></td>';
        html += '<td><input data-pf="dip" type="text" inputmode="decimal" value="' + esc(row.dip || "") + '"></td>';
        html += '<td><select data-pf="inout"><option value=""></option><option value="IN"' + (row.inout === "IN" ? " selected" : "") + '>IN</option><option value="OUT"' + (row.inout === "OUT" ? " selected" : "") + ">OUT</option></select></td>";
        html += '<td><input data-pf="sizeType" type="text" value="' + esc(row.sizeType || "") + '"></td>';
        html += '<td><input data-pf="ie" type="text" inputmode="decimal" value="' + esc(row.ie || "") + '">' + (row.ieComputed ? '<div class="mh-ie-computed">computed (Rim \u2212 Dip)</div>' : "") + "</td>";
        html += '<td><input data-pf="notes" type="text" value="' + esc(row.notes || "") + '"></td></tr>';
      });
      html += '</tbody></table></div><div class="actions"><button type="button" class="btn btn-sm" data-addpipe>Add pipe row</button>' +
        (sheet.holes.length > 1 ? '<button type="button" class="btn btn-sm" data-delhole>Remove manhole</button>' : "") + "</div></div></div></article>";
    });
    root.innerHTML = html;
    function readSheetHead() {
      sheet.jobName = $("mhJobName").value; sheet.jobNo = $("mhJobNo").value;
      sheet.page = $("mhPage").value; sheet.pageOf = $("mhPageOf").value;
      sheet.notes = $("mhNotes").value; sheet.noteTaker = $("mhTaker").value;
      sheet.noteTakerDate = $("mhTakerDate").value; sheet.checkedBy = $("mhChecked").value;
      sheet.checkedByDate = $("mhCheckedDate").value;
      scheduleSave();
    }
    root.querySelectorAll(".mh-head input").forEach(function (el) {
      el.addEventListener("input", readSheetHead);
      el.addEventListener("change", readSheetHead);
    });
    root.querySelectorAll(".mh-card").forEach(function (card) {
      var hole = findHole(card.getAttribute("data-hid"));
      if (!hole) return;
      var cv = card.querySelector("canvas");
      if (cv) { drawMhSketch(cv.getContext("2d"), hole, cv.width, cv.height, mhUi.holeId === hole.id ? mhUi.flowPts : null); bindMhCanvas(cv, hole); }
      card.querySelectorAll("[data-tool]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          mhUi.tool = btn.getAttribute("data-tool");
          mhUi.flowPts = [];
          mhUi.holeId = hole.id;
          renderManholes();
        });
      });
      var un = card.querySelector("[data-mhundo]");
      if (un) un.addEventListener("click", function () { mhUi.holeId = hole.id; undoMhSketch(hole); });
      var sn = card.querySelector("[data-mhsnap]");
      if (sn) sn.addEventListener("change", function () { mhUi.snap = sn.checked; });
      var lk = card.querySelector("[data-mhlink]");
      if (lk) lk.addEventListener("change", function () { mhUi.link = lk.checked; });
      card.querySelectorAll("[data-delflow]").forEach(function (btn) {
        btn.addEventListener("click", function () { deleteFlow(hole, btn.getAttribute("data-delflow")); });
      });
      card.querySelectorAll("[data-hf]").forEach(function (inp) {
        inp.addEventListener("input", function () {
          hole[inp.getAttribute("data-hf")] = inp.value;
          if (inp.getAttribute("data-hf") === "pointNo") warnIfPointIssue(inp.value);
          if (inp.getAttribute("data-hf") === "rimElev") { hole.rimSource = "manual"; recomputeHoleIEs(hole); refreshPipeIEs(card, hole); }
          scheduleSave();
        });
      });
      var lu = card.querySelector("[data-rlookup]");
      if (lu) lu.addEventListener("click", function () {
        if (!hole.pointNo) { toast("Enter the rim Point # first"); return; }
        var ev = lookupElev(hole.pointNo);
        if (ev === null) { toast("No elevation found for point " + hole.pointNo + " in logged or imported points"); return; }
        hole.rimElev = String(ev);
        hole.rimSource = "looked up from point " + hole.pointNo;
        recomputeHoleIEs(hole);
        scheduleSave();
        renderManholes();
      });
      card.querySelectorAll("tr[data-ri]").forEach(function (tr) {
        var ri = Number(tr.getAttribute("data-ri"));
        tr.querySelectorAll("[data-pf]").forEach(function (inp) {
          inp.addEventListener("input", function () {
            var f = inp.getAttribute("data-pf");
            hole.pipes[ri][f] = inp.value;
            if (f === "ie") hole.pipes[ri].ieComputed = false;
            if (f === "dip") { if (hole.pipes[ri].ieComputed || pointKey(hole.pipes[ri].ie) === "") { hole.pipes[ri].ieComputed = true; computePipeIE(hole, hole.pipes[ri]); } refreshPipeIEs(card, hole); }
            if (f === "pt") warnIfPointIssue(inp.value);
            scheduleSave();
          });
          inp.addEventListener("change", function () {
            var f = inp.getAttribute("data-pf");
            hole.pipes[ri][f] = inp.value;
            scheduleSave();
          });
        });
      });
      var ap = card.querySelector("[data-addpipe]");
      if (ap) ap.addEventListener("click", function () { hole.pipes.push(emptyPipeRow()); scheduleSave(); renderManholes(); });
      var dh = card.querySelector("[data-delhole]");
      if (dh) dh.addEventListener("click", function () {
        if (!confirm("Remove this manhole?")) return;
        sheet.holes = sheet.holes.filter(function (h) { return h.id !== hole.id; });
        if (!sheet.holes.length) sheet.holes = [emptyManhole()];
        scheduleSave(); renderManholes();
      });
    });
    updatePointRangeDisplay();
  }
  function refreshPipeIEs(card, hole) {
    card.querySelectorAll("tr[data-ri]").forEach(function (tr) {
      var ri = Number(tr.getAttribute("data-ri"));
      var row = hole.pipes[ri];
      if (!row) return;
      var ie = tr.querySelector('[data-pf="ie"]');
      if (ie && row.ieComputed) ie.value = row.ie || "";
      var mark = tr.querySelector(".mh-ie-computed");
      if (row.ieComputed && row.ie && !mark) {
        var td = ie && ie.parentNode;
        if (td) { var d = document.createElement("div"); d.className = "mh-ie-computed"; d.textContent = "computed (Rim \u2212 Dip)"; td.appendChild(d); }
      }
      if (!row.ieComputed && mark) mark.remove();
    });
  }

  function printCss() {
    return "body{font-family:Calibri,Arial,sans-serif;color:#111;margin:0;padding:12px;background:#fff}" +
      "h1,h2{margin:0 0 6px} table{border-collapse:collapse;width:100%;font-size:11px}" +
      "th,td{border:1px solid #111;padding:3px 5px;vertical-align:top}" +
      ".hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}" +
      ".hdr img{max-height:48px;max-width:160px}" +
      ".meta{font-size:12px;margin:0 0 10px;line-height:1.45}" +
      ".muted{color:#444} .badge{font-weight:700}" +
      "@page{size:letter;margin:0.45in}" +
      "@media print{body{padding:0}}";
  }
  function printLogoHtml() {
    if (profile && profile.logoDataUrl) return '<img alt="" src="' + profile.logoDataUrl + '">';
    var name = (profile && profile.companyName) || (config && config.productName) || "Field Notes";
    return "<div style=\"font-weight:800;font-size:18px\">" + esc(name) + "</div>";
  }
  function openPrint(title, body, extraCss) {
    var html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + esc(title) + "</title><style>" +
      printCss() + (extraCss || "") + "</style></head><body>" + body +
      "<script>window.onload=function(){try{window.focus();window.print();}catch(e){}<\/script></body></html>";
    FNPlatform.printHtml(html).catch(function () { toast("Allow pop-ups to print"); });
  }
  function headerMetaHtml() {
    var h = state.header || {};
    var crs = FNCrs.formatLine(crsObj());
    var bits = [];
    bits.push("<strong>" + esc(h.projectTitle || h.jobName || "Field notes") + "</strong>");
    if (h.jobNo) bits.push("Job " + esc(h.jobNo));
    if (h.date) bits.push(esc(h.date));
    if (h.weather) bits.push(esc(h.weather));
    if (h.crew || h.partyChief) bits.push("Crew: " + esc([h.partyChief, h.chainman, h.crew].filter(Boolean).join(", ")));
    bits.push(esc(formatPointRangeLine()));
    if (crs) bits.push("CRS: " + esc(crs) + (h.crsEpochConfirmed ? " (epoch confirmed)" : " (epoch not confirmed)"));
    return '<div class="meta">' + bits.join("<br>") + "</div>";
  }
  function printFieldNotes() {
    var evs = (state.events || []).slice().sort(function (a, b) { return String(eventTime(a)).localeCompare(String(eventTime(b))); });
    var body = '<div class="hdr">' + printLogoHtml() + "<div><h1>Field Notes</h1></div></div>" + headerMetaHtml();
    if (!evs.length) body += '<p class="muted">No entries were logged this day.</p>';
    evs.forEach(function (ev) {
      body += '<div style="margin:0 0 8px;border-bottom:1px solid #ddd;padding-bottom:6px">';
      body += "<strong>" + esc(typeLabel(ev.type)) + "</strong> " + esc(ev.time || "");
      var pt = eventPoint(ev);
      if (pt) body += " &middot; Point " + esc(pt);
      if (ev.status) body += " &middot; " + esc(ev.status);
      if (ev.type === "gnss_base") {
        var gsum = gnssSummary(ev);
        if (gsum) body += "<div>" + esc(gsum) + "</div>";
      }
      if (ev.notes) body += "<div>" + esc(ev.notes) + "</div>";
      if (ev.type === "ts_setup") {
        var tsum = tsSummary(ev);
        if (tsum) body += "<div>" + esc(tsum) + "</div>";
        else if (ev.check) {
          var c = ev.check;
          var bits = [];
          if (c.hdObs || c.hdRec) bits.push("HD " + fmtRes(residual(c.hdObs, c.hdRec)));
          if (c.elevObs || c.elevRec) bits.push("dZ " + fmtRes(residual(c.elevObs, c.elevRec)));
          if (c.nObs || c.nRec) bits.push("dN " + fmtRes(residual(c.nObs, c.nRec)));
          if (c.eObs || c.eRec) bits.push("dE " + fmtRes(residual(c.eObs, c.eRec)));
          if (bits.length) body += "<div>Previously saved check: " + esc(bits.join(", ")) + "</div>";
        }
      }
      if (ev.filename) body += "<div>File " + esc(ev.filename) + "</div>";
      if (ev.type === "sketch") body += '<div class="muted">Legend: Control point; Monument found; Monument set; Existing pole; New pole; Tree; Utility box / vault; SD manhole; SS manhole; WT manhole; Miscellaneous; Line and Circle (solid or dashed). The saved PNG includes this legend.</div>';
      if (ev.warnOutside || ev.warnDuplicate) body += '<div class="muted">Point-number warning on this entry.</div>';
      if (ev.importedFrom) body += '<div class="muted">Imported from ' + esc(ev.importedFrom) + "</div>";
      body += "</div>";
    });
    if (state.level && state.level.rows && state.level.rows.some(function (r) { return r.sta || r.bs || r.fs; })) {
      var calc = levelCompute();
      body += "<h2>Level notes</h2><table><thead><tr><th>Kind</th><th>Sta</th><th>BS</th><th>HI</th><th>FS</th><th>Elev</th><th>Notes</th></tr></thead><tbody>";
      state.level.rows.forEach(function (r, i) {
        var c = calc.computed[i] || {};
        body += "<tr><td>" + esc(r.kind) + "</td><td>" + esc(r.sta) + "</td><td>" + esc(r.bs) + "</td><td>" + esc(fmt3(c.hi)) + "</td><td>" + esc(r.fs) + "</td><td>" + esc(r.kind === "BM" ? r.knownElev : fmt3(c.elev)) + "</td><td>" + esc(r.notes) + "</td></tr>";
      });
      body += "</tbody></table><p>Misclosure " + esc(fmt3(calc.misclosure)) + " &middot; Closure " + esc(calc.status) + "</p>";
    }
    openPrint("Field Notes", body);
  }
  function printControl() {
    var rows = [];
    (state.events || []).forEach(function (ev) {
      if (ev.type === "ts_setup" && ev.check && ev.check.pt) rows.push({ ev: ev, ch: ev.check, kind: "TS backsight check" });
      if (ev.type === "ts_setup" && ev.fields && ev.fields.residuals) rows.push({ ev: ev, ch: ev.fields.residuals, kind: "TS residuals", residuals: ev.fields.residuals });
      if (ev.type === "bs_check" || ev.type === "rover_check") {
        var ch = ev.check || ev.fields || {};
        rows.push({ ev: ev, ch: ch, kind: typeLabel(ev.type) });
      }
    });
    var body = '<div class="hdr">' + printLogoHtml() + "<div><h1>Control Check Report</h1></div></div>" + headerMetaHtml();
    body += "<table><thead><tr><th>Kind</th><th>Point</th><th>dN</th><th>dE</th><th>dZ</th><th>HD res</th><th>Tol</th><th>Status</th></tr></thead><tbody>";
    if (!rows.length) body += '<tr><td colspan="8">No measured checks have been logged against control.</td></tr>';
    rows.forEach(function (r) {
      var c = r.ch;
      if (r.residuals) {
        body += "<tr><td>" + esc(r.kind) + "</td><td>" + esc(eventPoint(r.ev)) + "</td><td colspan=\"6\">" +
          esc(residualsSummary(r.residuals) || "No residuals entered") + "</td></tr>";
        return;
      }
      body += "<tr><td>" + esc(r.kind) + "</td><td>" + esc(c.pt || eventPoint(r.ev)) + "</td><td>" +
        esc(fmtRes(residual(c.nObs, c.nRec))) + "</td><td>" + esc(fmtRes(residual(c.eObs, c.eRec))) + "</td><td>" +
        esc(fmtRes(residual(c.elevObs, c.elevRec))) + "</td><td>" + esc(fmtRes(residual(c.hdObs, c.hdRec))) + "</td><td>" +
        esc(c.tol || "") + "</td><td>" + esc(checkStatus(c)) + "</td></tr>";
    });
    body += "</tbody></table>";
    if ((state.controlList || []).length) {
      body += "<h2>Published control</h2><table><thead><tr><th>Point</th><th>N</th><th>E</th><th>Z</th><th>Desc</th></tr></thead><tbody>";
      state.controlList.forEach(function (p) {
        body += "<tr><td>" + esc(p.name) + "</td><td>" + esc(p.n) + "</td><td>" + esc(p.e) + "</td><td>" + esc(p.z) + "</td><td>" + esc(p.desc) + "</td></tr>";
      });
      body += "</tbody></table>";
    }
    openPrint("Control Check Report", body);
  }
  function printDaily() {
    var d = ensureDaily();
    var L = dailyLabels();
    var css = ".dfr{border:2px solid #111}.dfr-title{background:#111;color:#fff;text-align:center;padding:8px;margin:0;letter-spacing:.08em;font-size:16px}" +
      ".dfr-head{display:grid;grid-template-columns:1fr 1fr}.cell{border:1px solid #111;padding:4px 8px;font-size:12px}" +
      ".sec{background:#111;color:#fff;text-align:center;padding:4px;font-weight:800;letter-spacing:.06em}" +
      "table{border-collapse:collapse;width:100%} th,td{border:1px solid #111;padding:4px 6px;font-size:11px}" +
      ".sign{display:grid;grid-template-columns:1.1fr 1.2fr .7fr;gap:8px;padding:8px;border-top:1px solid #111}" +
      ".sign img{max-height:54px;border-bottom:1px solid #111}" +
      ".who{font-size:11px;font-weight:700}";
    function rowPair(a, av, b, bv) {
      return '<div class="cell"><strong>' + esc(a) + "</strong> " + esc(av || "") + "</div>" +
        '<div class="cell"><strong>' + esc(b) + "</strong> " + esc(bv || "") + "</div>";
    }
    function ttab(key, title) {
      var html = '<div class="sec">' + esc(title) + "</div><table><thead><tr><th>" + esc(L.personnelLabel) + "</th><th>" + esc(L.regHoursLabel) + "</th><th>" + esc(L.otHoursLabel) + "</th><th>" + esc(L.phaseLabel) + "</th><th>" + esc(L.taskLabel) + "</th><th>" + esc(L.crewLabel) + "</th></tr></thead><tbody>";
      (d.times[key] || []).forEach(function (r) {
        html += "<tr><td>" + esc(r.personnel) + "</td><td>" + esc(r.regHours) + "</td><td>" + esc(r.otHours) + "</td><td>" + esc(r.phase) + "</td><td>" + esc(r.task) + "</td><td>" + esc(r.crew) + "</td></tr>";
      });
      return html + "</tbody></table>";
    }
    var body = '<div class="dfr"><h1 class="dfr-title">' + esc(L.title) + "</h1><div class=\"dfr-head\">";
    body += rowPair(L.projectNameLabel, d.projectName, L.clientLabel, d.client);
    body += rowPair(L.dateReceivedLabel, d.dateReceived, L.jobNumberLabel, d.jobNumber);
    body += rowPair(L.workOrderedByLabel, d.workOrderedBy, L.datePerformedLabel, d.datePerformed);
    body += '<div class="cell" style="grid-column:1/-1"><strong>' + esc(L.receivedByLabel) + "</strong> " + esc(d.receivedBy || "") + "</div>";
    body += '<div class="cell" style="grid-column:1/-1"><strong>Point range</strong> ' + esc(formatPointRangeLine()) + "</div></div>";
    body += ttab("onSite", L.onSiteTitle) + ttab("offSite", L.offSiteTitle) + ttab("travel", L.travelTitle);
    body += '<div class="sec">' + esc(L.detailedTitle) + "</div><div class=\"cell\" style=\"min-height:80px;white-space:pre-wrap\">" + esc(d.detailedWork || "") + "</div>";
    body += '<div class="dfr-head">';
    body += '<div class="cell">' + esc(L.lodgingLabel) + " " + esc(d.lodging || "Y / N") + "<br>" + esc(L.overnightLabel) + " " + esc(d.overnight || "") + "<br>" + esc(L.mealsLabel) + " " + esc(d.meals || "Y / N") + "</div>";
    body += '<div class="cell">' + esc(L.otherExpensesLabel) + " " + esc(d.otherExpenses || "Y / N") + "<br>" + esc(L.repOnSiteLabel) + " " + esc(d.repOnSite || "Y / N") + "</div>";
    body += '<div class="cell">' + esc(L.mileageLabel) + " " + esc(d.mileage || "") + "<br>" + esc(L.fromOfficeLabel) + " " + esc(d.fromOffice || "") + "</div></div>";
    body += '<div class="cell"><em>' + esc(L.authorizationNote) + "</em></div>";
    function sig(s, lab, optional) {
      return '<div class="sign"><div><strong>' + esc(L.nameLabel) + "</strong> " + esc(s.name || "") + '</div><div><strong>' + esc(L.signedLabel) + "</strong> " +
        (s.sigDataUrl ? '<img alt="signature" src="' + s.sigDataUrl + '">' : "") + "</div><div><strong>" + esc(L.dateLabel) + "</strong> " + esc(s.date || "") +
        '</div><div class="who" style="grid-column:1/-1">' + esc(lab) + (optional ? " (optional)" : "") + "</div></div>";
    }
    body += sig(d.crewSigner, L.crewSignerLabel, false) + sig(d.clientSigner, L.clientSignerLabel, true) + "</div>";
    openPrint(L.title, body, css);
  }

  function printManholes() {
    var sheet = ensureManholes();
    var unit = unitsShort();
    var css = ".page{page-break-after:always;border:2px solid #111;padding:0 0 4px;margin:0 0 16px}" +
      ".page:last-child{page-break-after:auto}" +
      ".mhph{display:grid;grid-template-columns:160px 1fr 1fr;gap:2px 12px;padding:8px 10px 6px;font-size:11px;align-items:end}" +
      ".mhph .logo{grid-row:1/3}.mhph img{max-height:40px;max-width:140px}" +
      ".line{border-bottom:1px solid #111;min-height:16px;font-size:12px}" +
      ".lab{font-size:10px;font-weight:700;letter-spacing:.04em}" +
      ".hole{display:grid;grid-template-columns:1.05fr 1.35fr;border-top:2px solid #111;min-height:2.15in}" +
      ".sk{padding:6px 8px 4px;display:flex;flex-direction:column}" +
      ".sk svg{width:100%;height:auto;max-height:1.55in}" +
      ".ptn{margin-top:auto;font-size:12px;font-weight:700;border-bottom:1px solid #111;padding-top:4px}" +
      ".rt{padding:6px 8px 6px 0} .rt .dlab{font-size:10px;font-weight:700;letter-spacing:.06em}" +
      ".dln{border-bottom:1px solid #111;min-height:16px;font-size:11px;margin-bottom:2px}" +
      "table{width:100%;border-collapse:collapse;margin-top:4px} th,td{border:1px solid #111;padding:2px 3px;font-size:9px;height:16px}" +
      "th{font-weight:700} .iecomp{font-size:7px;color:#333}";
    var pages = [];
    for (var i = 0; i < sheet.holes.length; i += 4) pages.push(sheet.holes.slice(i, i + 4));
    if (!pages.length) pages = [[]];
    var total = pages.length;
    var body = "";
    pages.forEach(function (group, pi) {
      body += '<div class="page"><div class="mhph"><div class="logo">' + printLogoHtml() + "</div>";
      body += '<div><div class="lab">JOB NAME</div><div class="line">' + esc(sheet.jobName || "") + "</div></div>";
      body += '<div><div class="lab">PAGE &nbsp;&nbsp; ' + esc(sheet.page || String(pi + 1)) + " &nbsp; OF &nbsp; " + esc(sheet.pageOf || String(total)) + '</div><div class="lab" style="margin-top:6px">JOB NO.</div><div class="line">' + esc(sheet.jobNo || "") + "</div></div>";
      body += '<div><div class="lab">NOTES:</div><div class="line">' + esc(sheet.notes || "") + "</div></div>";
      body += '<div><div class="lab">NOTE TAKER</div><div class="line">' + esc(sheet.noteTaker || "") + ' &nbsp; DATE ' + esc(sheet.noteTakerDate || "") + "</div>" +
        '<div class="lab" style="margin-top:4px">CHECKED BY</div><div class="line">' + esc(sheet.checkedBy || "") + " &nbsp; DATE " + esc(sheet.checkedByDate || "") + "</div></div></div>";
      for (var k = 0; k < 4; k++) {
        var hole = group[k] || emptyManhole();
        var pipes = (hole.pipes || []).slice();
        while (pipes.length < 5) pipes.push(emptyPipeRow());
        body += '<div class="hole"><div class="sk">' + sketchSvg(hole, 280, 200) +
          '<div class="ptn">POINT # ' + esc(hole.pointNo || "") + (hole.rimElev ? " &nbsp; Rim " + esc(hole.rimElev) + (unit ? " " + unit : "") : "") + "</div></div>";
        body += '<div class="rt"><div class="dlab">DESCRIPTION</div><div class="dln">' + esc(hole.desc1 || "") + '</div><div class="dln">' + esc(hole.desc2 || "") + "</div>";
        body += "<table><thead><tr><th>PT#</th><th>DIP</th><th>IN/<br>OUT</th><th>SIZE/<br>TYPE</th><th>I.E.</th><th>NOTES</th></tr></thead><tbody>";
        pipes.forEach(function (r) {
          body += "<tr><td>" + esc(r.pt || "") + "</td><td>" + esc(r.dip || "") + "</td><td>" + esc(r.inout || "") + "</td><td>" + esc(r.sizeType || "") + "</td><td>" + esc(r.ie || "") +
            (r.ieComputed && r.ie ? '<div class="iecomp">computed</div>' : "") + "</td><td>" + esc(r.notes || "") + "</td></tr>";
        });
        body += "</tbody></table></div></div>";
      }
      body += "</div>";
    });
    openPrint("Manhole Dips", body, css);
  }

  function csvEscape(v) { return /[",\n]/.test(String(v == null ? "" : v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v == null ? "" : v); }
  function toCsv(rows) { return rows.map(function (r) { return r.map(csvEscape).join(","); }).join("\n"); }
  function entriesCsv() {
    var rows = [["time","type","point","notes","status","details","importedFrom","warnOutside","warnDuplicate"]];
    (state.events || []).forEach(function (ev) {
      var details = "";
      if (ev.type === "gnss_base") details = gnssSummary(ev);
      else if (ev.type === "ts_setup") details = tsSummary(ev);
      rows.push([ev.time || "", ev.type || "", eventPoint(ev), ev.notes || "", ev.status || "", details, ev.importedFrom || "", ev.warnOutside ? "Y" : "", ev.warnDuplicate ? "Y" : ""]);
    });
    return toCsv(rows);
  }
  function pointsCsv(list) {
    var rows = [["point","n","e","z","desc","lat","lon","used","source","refFrame","epoch"]];
    (list || []).forEach(function (p) { rows.push([p.name || p.pt || "", p.n || "", p.e || "", p.z || "", p.desc || "", p.lat || "", p.lon || "", p.used ? "Y" : "", p.sourceFile || p.importedFrom || "", p.refFrame || "", p.epoch || ""]); });
    return toCsv(rows);
  }
  function levelCsv() {
    var calc = levelCompute();
    var rows = [["kind","sta","bs","hi","fs","elev","notes","bsDist","fsDist"]];
    ((state.level && state.level.rows) || []).forEach(function (r, i) {
      var c = calc.computed[i] || {};
      rows.push([r.kind, r.sta, r.bs, fmt3(c.hi), r.fs, r.kind === "BM" ? r.knownElev : fmt3(c.elev), r.notes, r.bsDist || "", r.fsDist || ""]);
    });
    return toCsv(rows);
  }
  function downloadCsv() {
    FNPlatform.saveBlob(new Blob([entriesCsv()], { type: "text/csv" }), "field-notes-entries.csv");
  }

  function eventLonLat(ev) {
    var f = ev.fields || {};
    var lat = num(ev.lat || f.lat), lon = num(ev.lon || f.lon);
    if (lat !== null && lon !== null) return { lon: lon, lat: lat, source: "geographic" };
    var e = num(f.e || ev.e), n = num(f.n || ev.n);
    if (e === null || n === null) return null;
    if (!state.header.crsZone) return null;
    try {
      var ll = FNCrs.gridToLonLat(e, n, state.header.crsZone, state.header.crsUnits || "us-ft");
      if (ll && ll.lon != null) return { lon: ll.lon, lat: ll.lat, source: "grid" };
    } catch (err) {}
    return null;
  }
  function pointLonLat(p) {
    var lat = num(p.lat), lon = num(p.lon);
    if (lat !== null && lon !== null) return { lon: lon, lat: lat, source: "geographic" };
    var e = num(p.e), n = num(p.n);
    if (e === null || n === null || !state.header.crsZone) return null;
    try {
      var ll = FNCrs.gridToLonLat(e, n, state.header.crsZone, state.header.crsUnits || "us-ft");
      if (ll && ll.lon != null) return { lon: ll.lon, lat: ll.lat, source: "grid" };
    } catch (err) {}
    return null;
  }
  function kmlFolder(name, placemarks) {
    return "<Folder><name>" + esc(name) + "</name>" + placemarks.join("") + "</Folder>";
  }
  function kmlPlacemark(name, desc, ll, style) {
    if (!ll) return "";
    return "<Placemark><name>" + esc(name) + "</name>" + (style ? "<styleUrl>#" + style + "</styleUrl>" : "") +
      "<description><![CDATA[" + desc + "]]></description>" +
      "<Point><coordinates>" + ll.lon + "," + ll.lat + ",0</coordinates></Point></Placemark>";
  }
  function buildKml(photoHrefs) {
    var crs = FNCrs.formatLine(crsObj());
    var hdr = "CRS: " + esc(crs || "not set") + (state.header.crsEpochConfirmed ? " (epoch confirmed)" : "") +
      "<br/>KML is WGS 84. NAD83 geographic positions are plotted as-is with no silent datum shift.<br/>" +
      esc(formatPointRangeLine());
    var styles = '<Style id="st-control"><IconStyle><color>ff00a0ff</color></IconStyle></Style>' +
      '<Style id="st-setup"><IconStyle><color>ff00c000</color></IconStyle></Style>' +
      '<Style id="st-point"><IconStyle><color>ff3a30c0</color></IconStyle></Style>' +
      '<Style id="st-photo"><IconStyle><color>ffd0a000</color></IconStyle></Style>';
    var control = (state.controlList || []).map(function (p) {
      var ll = pointLonLat(p); var desc = [p.desc, p.z ? "elev " + p.z : "", crs].filter(Boolean).join("<br>");
      return kmlPlacemark(p.name || p.pt, desc, ll, "st-control");
    }).filter(Boolean);
    var setups = [], points = [], photos = [];
    (state.events || []).forEach(function (ev) {
      var ll = eventLonLat(ev);
      var desc = [typeLabel(ev.type), ev.notes || "", ev.time || "", eventPoint(ev) ? "pt " + eventPoint(ev) : "", crs].filter(Boolean).join("<br>");
      if (ev.type === "photo") {
        var href = photoHrefs && ev.filename ? photoHrefs[ev.filename] : "";
        if (href) desc += "<br/><img src=\"" + href + "\" width=\"240\">";
        photos.push(kmlPlacemark(eventPoint(ev) || ev.filename || "Photo", desc, ll, "st-photo"));
      } else if (ev.type === "gnss_base" || ev.type === "ts_setup") {
        setups.push(kmlPlacemark(eventPoint(ev) || typeLabel(ev.type), desc, ll, "st-setup"));
      } else {
        points.push(kmlPlacemark(eventPoint(ev) || typeLabel(ev.type), desc, ll, "st-point"));
      }
    });
    (state.importedPoints || []).forEach(function (p) {
      var ll = pointLonLat(p);
      points.push(kmlPlacemark(p.name || p.pt, [p.desc, p.z ? "elev " + p.z : "", crs].filter(Boolean).join("<br>"), ll, "st-point"));
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Field Notes</name><description><![CDATA[' +
      hdr + "]]></description>" + styles +
      kmlFolder("Control", control) + kmlFolder("Setups", setups) + kmlFolder("Points", points) + kmlFolder("Photos", photos) +
      "</Document></kml>";
  }
  function exportEarth() {
    if (!requireCrs("Google Earth export")) return;
    var hrefs = {};
    var chain = Promise.resolve();
    var zip;
    try { zip = new JSZip(); } catch (e) { toast("JSZip is not available"); return; }
    (state.events || []).forEach(function (ev) {
      if (ev.type !== "photo" || !ev.fileId) return;
      chain = chain.then(function () {
        return FNIdb.fileGet(ev.fileId).then(function (rec) {
          if (!rec || !rec.blob) return;
          var name = ev.filename || (eventPoint(ev) || ev.id) + ".jpg";
          ev.filename = name;
          hrefs[name] = "files/" + name;
          zip.file("files/" + name, rec.blob);
        });
      });
    });
    chain.then(function () {
      zip.file("doc.kml", buildKml(hrefs));
      return zip.generateAsync({ type: "blob" });
    }).then(function (blob) {
      return FNPlatform.saveBlob(blob, "field-notes.kmz");
    }).catch(function () { toast("Could not build the KMZ"); });
  }

  function standalone(title, body, extraCss) {
    return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + esc(title) + "</title><style>" + printCss() + (extraCss || "") + "</style></head><body>" + body + "</body></html>";
  }

  function openBsCheck(existing) {
    var ev = existing || { id: uid(), type: "bs_check", time: nowTime(), ts: new Date().toISOString(), fields: {}, check: emptyCheck() };
    var f = ev.fields || {};
    var ch = ev.check || emptyCheck();
    if (!ch.pt) ch.pt = ev.pointNo || f.bsPt || f.pt || "";
    if (!ch.tol && profile && profile.tolerances && profile.tolerances.backsightCheckFt != null) {
      ch.tol = String(profile.tolerances.backsightCheckFt);
    }
    openOverlay("Backsight / check", existing ? "Edit" : "New");
    var extra = (f.face1HA || f.orientationCorrection)
      ? '<p class="hint">Imported circle data (as recorded): ' +
        [f.face1HA ? "F1 HA " + f.face1HA : "", f.face2HA ? "F2 HA " + f.face2HA : "", f.orientationCorrection ? "orient. " + f.orientationCorrection : ""].filter(Boolean).join(" · ") + "</p>"
      : "";
    $("ovBody").innerHTML = '<div class="grid g2">' +
      fieldHtml("bTime", "Time", ev.time, { type: "time" }) +
      fieldHtml("bOcc", "Occupied point", f.occupied || f.occ || "") +
      fieldHtml("bPt", "Backsight / check point", ch.pt) +
      fieldHtml("bTol", "Tolerance", ch.tol, { ph: "Same units as the observations" }) +
      fieldHtml("bHdO", "HD observed", ch.hdObs) + fieldHtml("bHdR", "HD record", ch.hdRec) +
      fieldHtml("bElO", "Elev observed", ch.elevObs) + fieldHtml("bElR", "Elev record", ch.elevRec) +
      fieldHtml("bNO", "N observed", ch.nObs) + fieldHtml("bNR", "N record", ch.nRec) +
      fieldHtml("bEO", "E observed", ch.eObs) + fieldHtml("bER", "E record", ch.eRec) +
      "</div>" + extra + '<p class="hint" id="bRes"></p>' +
      fieldHtml("bNotes", "Notes", ev.notes, { span: true, type: "textarea" });
    $("ovFoot").innerHTML = '<button type="button" class="btn btn-primary" id="bSave">Save check</button>';
    function readCheck() {
      return {
        pt: $("bPt").value, tol: $("bTol").value,
        hdObs: $("bHdO").value, hdRec: $("bHdR").value,
        elevObs: $("bElO").value, elevRec: $("bElR").value,
        nObs: $("bNO").value, nRec: $("bNR").value,
        eObs: $("bEO").value, eRec: $("bER").value
      };
    }
    function showRes() {
      var c = readCheck();
      $("bRes").textContent = "HD " + fmtRes(residual(c.hdObs, c.hdRec)) +
        " · dZ " + fmtRes(residual(c.elevObs, c.elevRec)) +
        " · dN " + fmtRes(residual(c.nObs, c.nRec)) +
        " · dE " + fmtRes(residual(c.eObs, c.eRec)) + " · " + checkStatus(c);
    }
    ["bHdO","bHdR","bElO","bElR","bNO","bNR","bEO","bER","bTol"].forEach(function (id) {
      $(id).addEventListener("input", showRes);
    });
    showRes();
    $("bSave").onclick = function () {
      ev.time = $("bTime").value;
      ev.pointNo = $("bPt").value;
      ev.notes = $("bNotes").value;
      ev.check = readCheck();
      ev.status = checkStatus(ev.check);
      ev.fields = ev.fields || {};
      ev.fields.occupied = $("bOcc").value;
      ev.fields.bsPt = ev.pointNo;
      ev.type = "bs_check";
      var warn = warnIfPointIssue(ev.pointNo, ev.id);
      ev.warnOutside = warn.outside; ev.warnDuplicate = warn.duplicate;
      upsertEvent(ev); closeOverlay();
    };
  }
  var SKETCH_SYMBOLS = [
    { id: "control", label: "Control point" },
    { id: "monFound", label: "Monument found" },
    { id: "monSet", label: "Monument set" },
    { id: "poleExist", label: "Existing pole" },
    { id: "poleNew", label: "New pole" },
    { id: "tree", label: "Tree" },
    { id: "vault", label: "Utility box / vault" },
    { id: "mhSD", label: "SD manhole" },
    { id: "mhSS", label: "SS manhole" },
    { id: "mhWT", label: "WT manhole" },
    { id: "misc", label: "Miscellaneous" }
  ];
  function sketchSetStroke(ctx, dashed, width) {
    ctx.strokeStyle = "#111";
    ctx.fillStyle = "#111";
    ctx.lineWidth = width || 1.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(dashed ? [6, 5] : []);
  }
  function drawSketchSymbol(ctx, kind, x, y, s, label) {
    s = s || 16;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "#111";
    ctx.fillStyle = "#111";
    ctx.lineWidth = Math.max(0.9, s * 0.08);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([]);
    function tri(fill) {
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.9, s * 0.7);
      ctx.lineTo(-s * 0.9, s * 0.7);
      ctx.closePath();
      if (fill) ctx.fill();
      else ctx.stroke();
    }
    function circ(fill, r) {
      ctx.beginPath();
      ctx.arc(0, 0, r || s, 0, Math.PI * 2);
      if (fill) ctx.fill();
      else ctx.stroke();
    }
    function dot(r) {
      ctx.beginPath();
      ctx.arc(0, 0, r || s * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    if (kind === "control") { tri(false); dot(s * 0.2); }
    else if (kind === "monFound") { circ(false, s); dot(s * 0.22); }
    else if (kind === "monSet") {
      circ(true, s * 0.85);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(1.1, s * 0.14);
      var arm = s * 0.48;
      ctx.beginPath();
      ctx.moveTo(-arm, 0); ctx.lineTo(arm, 0);
      ctx.moveTo(0, -arm); ctx.lineTo(0, arm);
      ctx.stroke();
      ctx.strokeStyle = "#111";
    }
    else if (kind === "benchmark") {
      tri(false);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.55); ctx.lineTo(0, s * 0.45);
      ctx.moveTo(-s * 0.5, 0.1 * s); ctx.lineTo(s * 0.5, 0.1 * s);
      ctx.stroke();
    } else if (kind === "ip") {
      var q = s * 0.75;
      ctx.strokeRect(-q, -q, q * 2, q * 2);
      ctx.beginPath();
      ctx.moveTo(-q, 0); ctx.lineTo(q, 0);
      ctx.moveTo(0, -q); ctx.lineTo(0, q);
      ctx.stroke();
    } else if (kind === "nail") {
      ctx.beginPath();
      ctx.moveTo(-s, 0); ctx.lineTo(s, 0);
      ctx.moveTo(0, -s); ctx.lineTo(0, s);
      ctx.moveTo(-s * 0.7, -s * 0.7); ctx.lineTo(s * 0.7, s * 0.7);
      ctx.moveTo(s * 0.7, -s * 0.7); ctx.lineTo(-s * 0.7, s * 0.7);
      ctx.stroke();
    } else if (kind === "poleExist") { circ(true, s * 0.85); }
    else if (kind === "poleNew") { circ(false, s * 0.85); }
    else if (kind === "mhSD" || kind === "mhSS" || kind === "mhWT") {
      circ(false, s);
      var letters = kind === "mhSD" ? "SD" : (kind === "mhSS" ? "SS" : "WT");
      ctx.font = "bold " + Math.max(7, Math.round(s * 0.72)) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#111";
      ctx.fillText(letters, 0, s * 0.04);
    }
    else if (kind === "tree") {
      circ(false, s * 0.85);
      for (var i = 0; i < 7; i++) {
        var a = (i / 7) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * s * 0.4, Math.sin(a) * s * 0.4);
        ctx.lineTo(Math.cos(a) * s * 1.05, Math.sin(a) * s * 1.05);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, s * 0.85); ctx.lineTo(0, s * 1.45);
      ctx.stroke();
    } else if (kind === "vault") {
      ctx.strokeRect(-s * 0.95, -s * 0.7, s * 1.9, s * 1.4);
      ctx.strokeRect(-s * 0.65, -s * 0.4, s * 1.3, s * 0.8);
    } else {
      /* misc: 5-point star */
      ctx.beginPath();
      for (var k = 0; k < 5; k++) {
        var a1 = -Math.PI / 2 + k * Math.PI * 2 / 5;
        var a2 = a1 + Math.PI / 5;
        var cmd = k === 0 ? "moveTo" : "lineTo";
        ctx[cmd](Math.cos(a1) * s, Math.sin(a1) * s);
        ctx.lineTo(Math.cos(a2) * s * 0.4, Math.sin(a2) * s * 0.4);
      }
      ctx.closePath();
      ctx.stroke();
    }
    if (label) {
      ctx.setLineDash([]);
      ctx.font = "bold " + Math.max(11, Math.round(s * 0.9)) + "px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#111";
      ctx.fillText(label, s + 6, 0);
    }
    ctx.restore();
  }
  function drawSketchObject(ctx, obj) {
    if (!obj) return;
    if (obj.type === "stroke" || obj.type === "erase") {
      var pts = obj.points || [];
      if (pts.length < 1) return;
      ctx.save();
      if (obj.type === "erase") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
        ctx.lineWidth = obj.width || 16;
      } else {
        sketchSetStroke(ctx, false, obj.width || 1.2);
      }
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (obj.type === "line") {
      sketchSetStroke(ctx, !!obj.dashed, 1.3);
      ctx.beginPath();
      ctx.moveTo(obj.x1, obj.y1);
      ctx.lineTo(obj.x2, obj.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    if (obj.type === "circle") {
      var r = Math.max(0, obj.r || 0);
      sketchSetStroke(ctx, !!obj.dashed, 1.3);
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    if (obj.type === "text") {
      ctx.save();
      ctx.setLineDash([]);
      ctx.fillStyle = "#111";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(obj.text || "", obj.x, obj.y);
      ctx.restore();
      return;
    }
    if (obj.type === "symbol") {
      drawSketchSymbol(ctx, obj.kind, obj.x, obj.y, obj.size || 18, obj.label || "");
    }
  }
  function drawSketchLegend(ctx, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, y + 0.5);
    ctx.lineTo(x + w, y + 0.5);
    ctx.stroke();
    ctx.fillStyle = "#111";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Legend", x + 8, y + 6);
    var items = SKETCH_SYMBOLS.slice();
    var styles = [
      { kind: "lineSolid", label: "Line (solid)" },
      { kind: "lineDash", label: "Line (dashed)" },
      { kind: "circSolid", label: "Circle (solid)" },
      { kind: "circDash", label: "Circle (dashed)" }
    ];
    var all = items.concat(styles);
    var cols = 5;
    var cellW = (w - 16) / cols;
    var top = y + 24;
    var rowH = (h - 32) / Math.ceil(all.length / cols);
    all.forEach(function (it, i) {
      var c = i % cols, r = Math.floor(i / cols);
      var cx = x + 8 + c * cellW + 12;
      var cy = top + r * rowH + 10;
      if (it.kind === "lineSolid" || it.kind === "lineDash") {
        sketchSetStroke(ctx, it.kind === "lineDash", 1.2);
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy);
        ctx.lineTo(cx + 10, cy);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (it.kind === "circSolid" || it.kind === "circDash") {
        sketchSetStroke(ctx, it.kind === "circDash", 1.2);
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        drawSketchSymbol(ctx, it.id, cx, cy, 8, "");
      }
      ctx.fillStyle = "#111";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(it.label, cx + 16, cy);
    });
    ctx.restore();
  }
  function renderSketchIcon(kind, size) {
    var c = document.createElement("canvas");
    c.width = size; c.height = size;
    var g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, size, size);
    drawSketchSymbol(g, kind, size / 2, size / 2, size * 0.32, "");
    return c;
  }
  function openSketch(existing) {
    var ev = existing || { id: uid(), type: "sketch", time: nowTime(), ts: new Date().toISOString(), fields: {} };
    ev.fields = ev.fields || {};
    openOverlay("Sketch", existing ? "Edit" : "New");
    var toolBtns = [
      ["freehand", "Freehand"],
      ["line", "Line"],
      ["circle", "Circle"],
      ["text", "Text"],
      ["eraser", "Eraser"]
    ];
    var toolsHtml = '<div class="sk-tools" id="skTools">' +
      toolBtns.map(function (t) {
        return '<button type="button" class="btn sk-tool" data-sktool="' + t[0] + '">' + t[1] + "</button>";
      }).join("") +
      '<button type="button" class="btn sk-tool" id="skUndo">Undo</button>' +
      '<button type="button" class="btn sk-tool" id="skClear">Clear</button>' +
      "</div>";
    toolsHtml += '<div class="sk-style" id="skStyle">' +
      '<button type="button" class="btn sk-tool" data-skstyle="solid">Solid</button>' +
      '<button type="button" class="btn sk-tool" data-skstyle="dashed">Dashed</button>' +
      '<span class="hint" style="margin:0">Applies to Line and Circle</span></div>';
    toolsHtml += '<div class="sk-syms" id="skSyms">';
    SKETCH_SYMBOLS.forEach(function (s) {
      toolsHtml += '<button type="button" class="btn sk-sym" data-sksym="' + s.id + '" title="' + esc(s.label) + '">' +
        '<span class="sk-ico" data-skico="' + s.id + '"></span><span class="sk-lab">' + esc(s.label) + "</span></button>";
    });
    toolsHtml += "</div>";
    $("ovBody").innerHTML = '<div class="grid g2">' +
      fieldHtml("skTime", "Time", ev.time, { type: "time" }) +
      fieldHtml("skPt", "Point no.", ev.pointNo || "", { ph: "Optional — used in the file name" }) +
      fieldHtml("skNotes", "Notes", ev.notes, { span: true, type: "textarea" }) +
      "</div>" + toolsHtml +
      '<div id="skPrompt" class="sk-prompt hidden">' +
      '<label class="fld" style="flex:1;margin:0"><span id="skPromptLab">Point # (optional)</span>' +
      '<input id="skPromptIn" type="text" placeholder="Optional label" autocomplete="off"></label>' +
      '<button type="button" class="btn" id="skPromptOk">Add</button>' +
      '<button type="button" class="btn" id="skPromptSkip">Skip</button></div>' +
      '<canvas id="sketchPad" width="800" height="560"></canvas>' +
      '<p class="hint">Tap or drag with a finger or mouse. A faint preview follows the pointer. Symbols get an optional point number. A legend is added when you save or export.</p>';
    $("ovFoot").innerHTML = '<button type="button" class="btn btn-primary" id="skSave">Save sketch</button>';
    var canvas = $("sketchPad");
    var ctx = canvas.getContext("2d");
    var objects = Array.isArray(ev.fields.sketchObjects) ? ev.fields.sketchObjects.slice() : [];
    var baseImage = null;
    var tool = "freehand";
    var dashed = false;
    var symbolKind = "";
    var drawing = false;
    var placing = false;
    var current = null;
    var hover = null;
    var pending = null;
    document.querySelectorAll("[data-skico]").forEach(function (el) {
      el.appendChild(renderSketchIcon(el.getAttribute("data-skico"), 64));
    });
    function setTool(next, sym) {
      tool = next;
      symbolKind = next === "symbol" ? (sym || symbolKind) : "";
      document.querySelectorAll("[data-sktool]").forEach(function (b) {
        b.classList.toggle("on", b.getAttribute("data-sktool") === tool);
      });
      document.querySelectorAll("[data-sksym]").forEach(function (b) {
        b.classList.toggle("on", tool === "symbol" && b.getAttribute("data-sksym") === symbolKind);
      });
      hover = null;
      placing = false;
      if (tool === "symbol") canvas.style.cursor = "none";
      else if (tool === "text") canvas.style.cursor = "cell";
      else canvas.style.cursor = "crosshair";
      if (typeof redraw === "function") redraw();
    }
    function setDashed(on) {
      dashed = !!on;
      document.querySelectorAll("[data-skstyle]").forEach(function (b) {
        b.classList.toggle("on", (b.getAttribute("data-skstyle") === "dashed") === dashed);
      });
    }
    function redraw() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (baseImage) ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
      objects.forEach(function (o) { drawSketchObject(ctx, o); });
      function ghost(obj) {
        if (!obj) return;
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.globalCompositeOperation = "source-over";
        drawSketchObject(ctx, obj);
        ctx.restore();
      }
      if (current && (current.type === "line" || current.type === "circle" || current.type === "symbol")) ghost(current);
      else if (current) drawSketchObject(ctx, current);
      if (hover) ghost(hover);
      ctx.restore();
    }
    function pos(e) {
      var r = canvas.getBoundingClientRect();
      var x = e.clientX, y = e.clientY;
      if ((x == null || y == null) && e.touches && e.touches[0]) {
        x = e.touches[0].clientX;
        y = e.touches[0].clientY;
      }
      return { x: (x - r.left) * (canvas.width / r.width), y: (y - r.top) * (canvas.height / r.height) };
    }
    function hidePrompt() {
      pending = null;
      if ($("skPrompt")) $("skPrompt").classList.add("hidden");
    }
    function askLabel(obj, title, required) {
      pending = { obj: obj, required: !!required };
      $("skPromptLab").textContent = title;
      $("skPromptIn").value = obj.label || obj.text || "";
      $("skPrompt").classList.remove("hidden");
      $("skPromptIn").focus();
    }
    $("skPromptOk").onclick = function () {
      if (!pending) return;
      var v = ($("skPromptIn").value || "").trim();
      if (pending.required && !v) { toast("Type a label, or skip to cancel"); return; }
      if (pending.obj.type === "text") {
        if (!v) { objects = objects.filter(function (o) { return o !== pending.obj; }); }
        else pending.obj.text = v;
      } else {
        pending.obj.label = v;
      }
      hidePrompt();
      redraw();
    };
    $("skPromptSkip").onclick = function () {
      if (!pending) return;
      if (pending.required) objects = objects.filter(function (o) { return o !== pending.obj; });
      hidePrompt();
      redraw();
    };
    function symbolGhostAt(p) {
      return { type: "symbol", kind: symbolKind, x: p.x, y: p.y, size: 18, label: "" };
    }
    function placeSymbolAt(p) {
      placing = false;
      drawing = false;
      hover = null;
      current = null;
      if (!p || !symbolKind) { redraw(); return; }
      var s = { type: "symbol", kind: symbolKind, x: p.x, y: p.y, size: 18, label: "" };
      objects.push(s);
      redraw();
      askLabel(s, "Point # (optional)", false);
    }
    canvas.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      if (pending) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      var p = pos(e);
      if (tool === "symbol" && symbolKind) {
        placing = true;
        drawing = true;
        current = null;
        hover = symbolGhostAt(p);
        redraw();
        return;
      }
      drawing = true;
      if (tool === "freehand") current = { type: "stroke", points: [p] };
      else if (tool === "eraser") current = { type: "erase", width: 18, points: [p] };
      else if (tool === "line") current = { type: "line", x1: p.x, y1: p.y, x2: p.x, y2: p.y, dashed: dashed };
      else if (tool === "circle") current = { type: "circle", x: p.x, y: p.y, r: 0, dashed: dashed };
      else if (tool === "text") {
        drawing = false;
        current = null;
        var txt = { type: "text", x: p.x, y: p.y, text: "" };
        objects.push(txt);
        askLabel(txt, "Text label", true);
        return;
      }
      redraw();
    });
    canvas.addEventListener("pointermove", function (e) {
      var p = pos(e);
      if (tool === "symbol" && symbolKind && !pending) {
        e.preventDefault();
        hover = symbolGhostAt(p);
        redraw();
        return;
      }
      if (!drawing || !current) {
        if (hover) { hover = null; redraw(); }
        return;
      }
      e.preventDefault();
      if (current.type === "stroke" || current.type === "erase") current.points.push(p);
      else if (current.type === "line") { current.x2 = p.x; current.y2 = p.y; }
      else if (current.type === "circle") {
        var dx = p.x - current.x, dy = p.y - current.y;
        current.r = Math.sqrt(dx * dx + dy * dy);
      }
      redraw();
    });
    function endDraw(e) {
      if (e) e.preventDefault();
      if (placing) {
        var p = e ? pos(e) : (hover ? { x: hover.x, y: hover.y } : null);
        placeSymbolAt(p);
        return;
      }
      if (!drawing) return;
      drawing = false;
      if (!current) return;
      var keep = true;
      if (current.type === "line") {
        var dl = Math.hypot(current.x2 - current.x1, current.y2 - current.y1);
        if (dl < 4) keep = false;
      } else if (current.type === "circle") {
        if (!current.r || current.r < 3) keep = false;
      } else if ((current.type === "stroke" || current.type === "erase") && (!current.points || current.points.length < 1)) {
        keep = false;
      }
      if (keep) objects.push(current);
      current = null;
      hover = null;
      redraw();
    }
    canvas.addEventListener("pointerup", endDraw);
    canvas.addEventListener("pointercancel", function (e) {
      if (e) e.preventDefault();
      if (placing) {
        placing = false;
        drawing = false;
        hover = null;
        current = null;
        redraw();
        return;
      }
      endDraw(e);
    });
    canvas.addEventListener("pointerleave", function (e) {
      if (placing) return;
      if (drawing && (e.buttons === 0 || e.buttons == null)) endDraw(e);
      else if (!drawing && hover) { hover = null; redraw(); }
    });
    document.querySelectorAll("[data-sktool]").forEach(function (b) {
      b.addEventListener("click", function () { hidePrompt(); setTool(b.getAttribute("data-sktool")); });
    });
    document.querySelectorAll("[data-skstyle]").forEach(function (b) {
      b.addEventListener("click", function () { setDashed(b.getAttribute("data-skstyle") === "dashed"); });
    });
    document.querySelectorAll("[data-sksym]").forEach(function (b) {
      b.addEventListener("click", function () { hidePrompt(); setTool("symbol", b.getAttribute("data-sksym")); });
    });
    $("skUndo").onclick = function () {
      hidePrompt();
      hover = null;
      current = null;
      placing = false;
      if (!objects.length) { toast("Nothing to undo"); return; }
      objects.pop();
      redraw();
    };
    $("skClear").onclick = function () {
      hidePrompt();
      hover = null;
      current = null;
      placing = false;
      objects = [];
      baseImage = null;
      redraw();
    };
    function loadBase(blob) {
      var img = new Image();
      img.onload = function () { baseImage = img; redraw(); };
      img.src = URL.createObjectURL(blob);
    }
    if (Array.isArray(ev.fields.sketchObjects)) {
      objects = ev.fields.sketchObjects.slice();
      redraw();
    } else if (ev.fileId) {
      FNIdb.fileGet(ev.fileId).then(function (rec) {
        if (rec && rec.blob) loadBase(rec.blob);
        else redraw();
      });
    } else {
      redraw();
    }
    setTool("freehand");
    setDashed(false);
    function exportWithLegend() {
      return new Promise(function (resolve) {
        current = null;
        hover = null;
        placing = false;
        redraw();
        var legendH = 132;
        var out = document.createElement("canvas");
        out.width = canvas.width;
        out.height = canvas.height + legendH;
        var octx = out.getContext("2d");
        octx.fillStyle = "#fff";
        octx.fillRect(0, 0, out.width, out.height);
        octx.drawImage(canvas, 0, 0);
        drawSketchLegend(octx, 0, canvas.height, out.width, legendH);
        out.toBlob(function (b) { resolve(b); }, "image/png");
      });
    }
    $("skSave").onclick = function () {
      hidePrompt();
      ev.time = $("skTime").value;
      ev.pointNo = $("skPt").value;
      ev.notes = $("skNotes").value;
      ev.type = "sketch";
      ev.fields = ev.fields || {};
      ev.fields.sketchObjects = objects.slice();
      ev.fileId = ev.fileId || ("sketch-" + ev.id);
      ev.filename = ev.filename || ("sketch_" + (sanitize(ev.pointNo) || "page") + "_" + sanitize(state.header.jobNo || "job") + "_" + formatStamp(new Date()) + ".png");
      exportWithLegend().then(function (blob) {
        if (!blob) { toast("Could not save that sketch"); return; }
        return FNIdb.filePut({ id: ev.fileId, kind: "sketch", name: ev.filename, type: "image/png", blob: blob }).then(function () {
          var warn = warnIfPointIssue(ev.pointNo, ev.id);
          ev.warnOutside = warn.outside; ev.warnDuplicate = warn.duplicate;
          upsertEvent(ev); closeOverlay();
          toast("Sketch saved as " + ev.filename);
        });
      }).catch(function () { toast("Could not store the sketch"); });
    };
  }


  var PKG_PREF = "package-toggles-v1:";
  var PKG_ITEMS = [
    { id: "fieldNotes", label: "Field Notes", folder: "01_Field_Notes", hint: "Print-ready HTML (Print → Save as PDF)" },
    { id: "level", label: "Level Notes", folder: "03_Level_Notes", hint: "Print-ready HTML and CSV" },
    { id: "manholes", label: "Manhole Dips", folder: "04_Manhole_Dips", hint: "Sheet layout and sketches" },
    { id: "daily", label: "Daily Field Report", folder: "05_Daily_Report", hint: "Hours, work report, sign-off" },
    { id: "photos", label: "Photos", folder: "06_Photos", hint: "Watermarked field photos" },
    { id: "sketches", label: "Sketches", folder: "07_Sketches", hint: "Field sketches and manhole drawings" },
    { id: "csv", label: "Raw CSVs", folder: "08_Data", hint: "Entries, points, control, level notes" }
  ];
  function pkgHasData(id) {
    if (id === "fieldNotes") return (state.events || []).length > 0 || !!(state.header.jobNo || state.header.projectTitle || state.header.weather || state.header.crew || state.header.remarks);
    if (id === "level") return !!(state.level && (state.level.rows || []).some(function (r) { return r.sta || r.bs || r.fs || r.knownElev; }));
    if (id === "manholes") return !!(state.manholes && (state.manholes.holes || []).some(function (h) {
      var sk = h.sketch || {};
      return h.pointNo || h.desc1 || (h.pipes || []).some(function (r) { return r.pt || r.dip; }) || (sk.flows || []).length || (sk.strokes || []).length;
    }));
    if (id === "daily") {
      var d = state.dailyReport;
      if (!d) return false;
      var hours = ["onSite","offSite","travel"].some(function (k) {
        return (d.times && d.times[k] || []).some(function (r) { return r.regHours || r.otHours || r.phase || r.task || r.crew; });
      });
      return !!(d.client || d.detailedWork || d.mileage || hours || (d.crewSigner && (d.crewSigner.name || d.crewSigner.sigDataUrl)));
    }
    if (id === "photos") return (state.events || []).some(function (e) { return e.type === "photo" && e.fileId; });
    if (id === "sketches") return (state.events || []).some(function (e) { return e.type === "sketch" && e.fileId; }) || pkgHasData("manholes");
    if (id === "csv") return (state.events || []).length > 0 || pkgHasData("level") || (state.controlList || []).length > 0 || (state.importedPoints || []).length > 0;
    return false;
  }
  function pkgRootName() {
    var job = sanitize(state.header.jobNo || "Job") || "Job";
    var title = sanitize(state.header.projectTitle || state.header.jobName || "Project") || "Project";
    var day = (state.header.date || todayISO()).replace(/-/g, "");
    return job + "_" + title + "_" + day;
  }
  function openPackageWizard() { openFinishDay(); }
  function openPackageWizardLegacy() {
    var key = PKG_PREF + (state.header.jobNo || "_");
    FNIdb.kvGet(key).then(function (saved) {
      var remembered = (saved && saved.items) || {};
      openOverlay("Export package", "Choose what to include");
      var html = '<p class="hint">Only items with data for this day can be included. Empty items are dimmed. The ZIP is a single folder named <span class="mono">' + esc(pkgRootName()) + "</span>.</p>";
      html += '<div class="pkg-list">';
      PKG_ITEMS.forEach(function (it) {
        var has = pkgHasData(it.id);
        var checked = has && (remembered[it.id] !== false);
        html += '<label class="pkg-item' + (has ? "" : " unavailable") + '">' +
          '<input type="checkbox" data-pkg="' + it.id + '"' + (checked ? " checked" : "") + (has ? "" : " disabled") + ">" +
          '<span><span class="lab">' + esc(it.label) + "</span>" +
          '<span class="sub">' + esc(it.folder) + " — " + (has ? esc(it.hint) : "No data for this day") + "</span></span></label>";
      });
      html += "</div>";
      $("ovBody").innerHTML = html;
      $("ovFoot").innerHTML = '<button type="button" class="btn btn-primary" id="pkgGo">Build ZIP</button>';
      $("pkgGo").onclick = function () {
        var selected = {};
        PKG_ITEMS.forEach(function (it) {
          var box = document.querySelector('[data-pkg="' + it.id + '"]');
          selected[it.id] = !!(box && box.checked && !box.disabled);
        });
        if (!Object.keys(selected).some(function (k) { return selected[k]; })) { toast("Select at least one item that has data"); return; }
        FNIdb.kvSet(key, { items: selected, savedAt: new Date().toISOString() });
        closeOverlay();
        buildV1Package(selected);
      };
    });
  }
  function buildV1Package(selected) {
    if (typeof JSZip === "undefined") { toast("JSZip is not available"); return; }
    var zip = new JSZip();
    var root = pkgRootName() + "/";
    var files = [];
    function addText(path, text, type) {
      zip.file(root + path, text);
      files.push(path);
    }
    function folder(id) {
      var it = PKG_ITEMS.filter(function (x) { return x.id === id; })[0];
      return it ? it.folder + "/" : "";
    }
    if (selected.fieldNotes) {
      var evs = state.events || [];
      addText(folder("fieldNotes") + "field-notes.html", standalone("Field Notes", '<div class="hdr">' + printLogoHtml() + "<div><h1>Field Notes</h1></div></div>" + headerMetaHtml() + (evs.length ? evs.map(function (ev) {
        return "<div><strong>" + esc(typeLabel(ev.type)) + "</strong> " + esc(ev.time || "") + (eventPoint(ev) ? " · pt " + esc(eventPoint(ev)) : "") + (ev.type === "gnss_base" && gnssSummary(ev) ? "<div>" + esc(gnssSummary(ev)) + "</div>" : "") + (ev.notes ? "<div>" + esc(ev.notes) + "</div>" : "") + "</div>";
      }).join("") : "<p>No entries were logged this day.</p>")), "html");
    }
    if (selected.level) {
      var calc = levelCompute();
      var lbody = "<h1>Level Notes</h1>" + headerMetaHtml() + "<table><thead><tr><th>Kind</th><th>Sta</th><th>BS</th><th>HI</th><th>FS</th><th>Elev</th><th>Notes</th></tr></thead><tbody>";
      (state.level.rows || []).forEach(function (r, i) {
        var c = calc.computed[i] || {};
        lbody += "<tr><td>" + esc(r.kind) + "</td><td>" + esc(r.sta) + "</td><td>" + esc(r.bs) + "</td><td>" + esc(fmt3(c.hi)) + "</td><td>" + esc(r.fs) + "</td><td>" + esc(r.kind === "BM" ? r.knownElev : fmt3(c.elev)) + "</td><td>" + esc(r.notes) + "</td></tr>";
      });
      lbody += "</tbody></table><p>Misclosure " + esc(fmt3(calc.misclosure)) + " · Closure " + esc(calc.status) + "</p>";
      addText(folder("level") + "level-notes.html", standalone("Level Notes", lbody), "html");
      addText(folder("level") + "level-notes.csv", levelCsv(), "csv");
    }
    if (selected.daily) {
      var d = ensureDaily();
      addText(folder("daily") + "daily-field-report.html", standalone(dailyLabels().title, "<h1>" + esc(dailyLabels().title) + "</h1>" + headerMetaHtml() + "<p>Project: " + esc(d.projectName) + " · Job: " + esc(d.jobNumber) + " · Date work performed: " + esc(d.datePerformed) + "</p><p>" + esc(formatPointRangeLine()) + "</p><h2>Detailed work report</h2><pre style=\"white-space:pre-wrap;font:inherit\">" + esc(d.detailedWork || "") + "</pre>"), "html");
    }
    if (selected.csv) {
      addText(folder("csv") + "entries.csv", entriesCsv(), "csv");
      addText(folder("csv") + "points.csv", pointsCsv(state.importedPoints), "csv");
      addText(folder("csv") + "control.csv", pointsCsv(state.controlList), "csv");
    }
    if (selected.manholes) {
      var sheet = ensureManholes();
      var mhBody = "<h1>Manhole Dips</h1><p>Job " + esc(sheet.jobName || "") + " / " + esc(sheet.jobNo || "") + "</p>";
      sheet.holes.forEach(function (hole, i) {
        mhBody += "<h2>Manhole " + (i + 1) + " · Point # " + esc(hole.pointNo || "") + "</h2>" + sketchSvg(hole, 360, 260);
        mhBody += "<p>" + esc([hole.desc1, hole.desc2].filter(Boolean).join(" / ")) + (hole.rimElev ? " · Rim " + esc(hole.rimElev) : "") + "</p>";
      });
      addText(folder("manholes") + "manhole-dips.html", standalone("Manhole Dips", mhBody, "svg{border:1px solid #111}"), "html");
    }
    var chain = Promise.resolve();
    if (selected.photos) {
      (state.events || []).forEach(function (ev) {
        if (ev.type !== "photo" || !ev.fileId) return;
        chain = chain.then(function () {
          return FNIdb.fileGet(ev.fileId).then(function (rec) {
            if (!rec || !rec.blob) return;
            var name = ev.filename || (eventPoint(ev) || ev.id) + ".jpg";
            zip.file(root + folder("photos") + name, rec.blob);
            files.push(folder("photos") + name);
          });
        });
      });
    }
    if (selected.sketches) {
      (state.events || []).forEach(function (ev) {
        if (ev.type !== "sketch" || !ev.fileId) return;
        chain = chain.then(function () {
          return FNIdb.fileGet(ev.fileId).then(function (rec) {
            if (!rec || !rec.blob) return;
            var name = ev.filename || ("sketch-" + ev.id + ".png");
            zip.file(root + folder("sketches") + name, rec.blob);
            files.push(folder("sketches") + name);
          });
        });
      });
      if (state.manholes && state.manholes.holes) {
        state.manholes.holes.forEach(function (hole, i) {
          var sk = hole.sketch || {};
          var hasVec = (sk.flows || []).length || (sk.strokes || []).length || (sk.rays || []).length;
          if (!hasVec && !hole.pointNo) return;
          chain = chain.then(function () {
            return sketchPngBlob(hole, 3).then(function (blob) {
              if (!blob) return;
              var name = "manhole-" + (pointKey(hole.pointNo) || String(i + 1)) + ".png";
              zip.file(root + folder("sketches") + name, blob);
              files.push(folder("sketches") + name);
              zip.file(root + folder("sketches") + name.replace(/\.png$/, ".svg"), sketchSvg(hole));
              files.push(folder("sketches") + name.replace(/\.png$/, ".svg"));
            });
          });
        });
      }
    }
    chain.then(function () {
      var lines = [
        "Field Notes package",
        "Job: " + (state.header.jobNo || ""),
        "Project: " + (state.header.projectTitle || state.header.jobName || ""),
        "Date: " + (state.header.date || ""),
        formatPointRangeLine(),
        "CRS: " + FNCrs.formatLine(crsObj()),
        "Created: " + new Date().toISOString(),
        "",
        "Included files:"
      ].concat(files.map(function (f) { return "  " + f; }));
      addText("manifest.txt", lines.join("\n"), "txt");
      return zip.generateAsync({ type: "blob" });
    }).then(function (blob) {
      return FNPlatform.saveBlob(blob, pkgRootName() + ".zip");
    }).then(function () { toast("Package downloaded"); })
      .catch(function () { toast("Could not build the package"); });
  }
  function downloadPackage() { openPackageWizard(); }

  function newDay() {
    if (!confirm("Start a new day? Today's notes stay on this device only if you already exported them.")) return;
    state = emptyState();
    writeHeader();
    renderTimeline();
    renderMoreLog();
    updateImportSummary();
    saveNow();
    showView("menu");
  }

  function bindFiles() {
    $("cameraInput").addEventListener("change", function () { if (this.files[0]) handlePhotoFile(this.files[0]); this.value = ""; });
    $("libraryInput").addEventListener("change", function () { if (this.files[0]) handlePhotoFile(this.files[0]); this.value = ""; });
    $("controlInput").addEventListener("change", function () { if (this.files[0]) importTextFile("control", this.files[0]); this.value = ""; });
    $("pointsInput").addEventListener("change", function () { if (this.files[0]) importTextFile("points", this.files[0]); this.value = ""; });
    $("refInput").addEventListener("change", function () { if (this.files[0]) importReference(this.files[0]); this.value = ""; });
    $("jxlInput").addEventListener("change", function () { if (this.files[0]) importJxlFile(this.files[0]); this.value = ""; });
    $("profileInput").addEventListener("change", function () { if (this.files[0]) importProfileFile(this.files[0]); this.value = ""; });
    $("logoInput").addEventListener("change", function () {
      var file = this.files[0]; this.value = "";
      if (!file || !profile) return;
      var reader = new FileReader();
      reader.onload = function () { profile.logoDataUrl = String(reader.result || ""); setProfile(profile).then(openSettings); };
      reader.readAsDataURL(file);
    });
  }
  function fillControlDatalist() {
    var el = $("ctrlList");
    if (!el) return;
    el.innerHTML = (state.controlList || []).map(function (p) {
      var name = p.name || p.pt || "";
      return name ? '<option value="' + esc(name) + '"></option>' : "";
    }).join("");
  }
  function writeCurrentPoint() {
    if ($("currentPoint") && $("currentPoint") !== document.activeElement) {
      $("currentPoint").value = state.currentPoint || "";
    }
  }
  function setCurrentPoint(pt) {
    var v = String(pt || "").trim();
    if (v) state.currentPoint = v;
    writeCurrentPoint();
    scheduleSave();
  }
  function markControlUsed(pointNo, ev) {
    var key = pointKey(pointNo);
    if (!key) return;
    (state.controlList || []).forEach(function (p) {
      if (pointKey(p.name || p.pt) !== key) return;
      p.used = true;
      p.usedIn = p.usedIn || [];
      if (ev && ev.id && p.usedIn.indexOf(ev.id) < 0) p.usedIn.push(ev.id);
      p.lastUsed = ev && (ev.ts || ev.time) || "";
      p.lastUsedType = ev && ev.type || "";
    });
  }
  function controlPickerHint() {
    return (state.controlList || []).length
      ? '<p class="hint">Pick from today\u2019s control list or type a point.</p>'
      : "";
  }

  var COLMAP_KEY = "fn-colmap-v1";
  function headerSignature(headers) {
    return (headers || []).map(function (h) { return String(h || "").trim().toLowerCase(); }).join("|");
  }
  function guessField(header) {
    var h = String(header || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!h) return "";
    if (/^(lat|latitude)$/.test(h) || /(^| )lat(itude)?$/.test(h)) return "lat";
    if (/^(lon|long|lng|longitude)$/.test(h) || /longitu|\blon\b|\blng\b/.test(h)) return "lon";
    if (/northing|^n$|^y$|^north$/.test(h)) return "n";
    if (/easting|^e$|^x$|^east$/.test(h)) return "e";
    if (/^(z|elev|elevation|ortho|ht|hgt|height)$/.test(h) || /elev/.test(h)) return "z";
    if (/^(p|pt|pnt|point|name|station|pid|pointno|point number)$/.test(h) || /point/.test(h)) return "p";
    if (/^(d|desc|description)$/.test(h) || /desc|code|comment|feature/.test(h)) return "d";
    return "";
  }
  function loadColMap(sig) {
    try {
      var all = JSON.parse(localStorage.getItem(COLMAP_KEY) || "{}");
      return all[sig] || null;
    } catch (e) { return null; }
  }
  function saveColMap(sig, map) {
    try {
      var all = JSON.parse(localStorage.getItem(COLMAP_KEY) || "{}");
      all[sig] = map;
      localStorage.setItem(COLMAP_KEY, JSON.stringify(all));
    } catch (e) {}
  }
  function looksLat(v) {
    var n = num(v);
    return n != null && Math.abs(n) > 0 && Math.abs(n) <= 90;
  }
  function looksLon(v) {
    var n = num(v);
    return n != null && Math.abs(n) > 0 && Math.abs(n) <= 360;
  }

  function mountTools() {
    if (!window.FNTools || !$("toolsHome")) return;
    FNTools.mount($("toolsHome"), $("toolsScreen"), {
      toast: toast,
      esc: esc,
      getCrs: crsObj,
      addControl: function (pt) {
        state.controlList = state.controlList || [];
        state.controlList.push(pt);
        fillControlDatalist();
        updateImportSummary();
        saveNow();
        if (pt && pt.name) setCurrentPoint(pt.name);
      },
      saveOpus: saveOpusReport,
      saveBlob: function (blob, name) { return FNPlatform.saveBlob(blob, name); },
      levelCalc: function () { try { return levelCompute(); } catch (e) { return null; } }
    });
  }
  function saveOpusReport(sol) {
    if (!sol || !sol.ok || !window.FNOpus) return;
    var safe = FNOpus.safeSummary(sol);
    delete safe.contributor;
    state.opusReports = state.opusReports || [];
    var id = (sol.rinex || "") + "|" + (sol.start || "") + "|" + (sol.date || "");
    state.opusReports = state.opusReports.filter(function (r) { return r._id !== id; });
    safe._id = id;
    safe._savedAt = new Date().toISOString();
    state.opusReports.push(safe);
    saveNow();
  }

  function renderControl() {
    var root = $("controlForm");
    if (!root) return;
    fillControlDatalist();
    var list = state.controlList || [];
    var usedN = list.filter(function (p) { return p.used; }).length;
    var html = '<div class="ctrl-toolbar">' +
      '<button type="button" class="btn btn-primary" id="btnImportControl">Import CSV</button>' +
      '<button type="button" class="btn" id="btnExportCtrlKmz">Export KMZ</button>' +
      '<button type="button" class="btn" id="btnExportCtrlKml">Export KML</button>' +
      '<button type="button" class="btn" id="btnExportCtrlCsv">Export CSV</button>' +
      "</div>";
    html += '<p class="hint">' + (list.length ? (list.length + " points \u00b7 " + usedN + " used in a setup") : "No control loaded yet. Import a P,N,E,Z,D or P,Lat,Lon CSV. Column order is mapped once and remembered.") + "</p>";
    if (!list.length) {
      html += '<p class="hint">For grid files, set the job coordinate system (CA State Plane zone and units) so Google Earth can plot them. Geographic files already have lat/lon.</p>';
    }
    list.forEach(function (p, i) {
      var used = p.used ? '<span class="badge used">Used' + (p.usedIn && p.usedIn.length ? " \u00d7" + p.usedIn.length : "") + "</span>" : '<span class="badge incomplete">Not used</span>';
      var bits = [];
      if (p.n || p.e) bits.push("N " + (p.n || "\u2014") + "  E " + (p.e || "\u2014"));
      if (p.z) bits.push("Z " + p.z);
      if (p.lat || p.lon) bits.push((p.lat || "") + ", " + (p.lon || ""));
      if (p.desc) bits.push(p.desc);
      html += '<div class="ctrl-item" data-ci="' + i + '"><div class="name">' + esc(p.name || p.pt || "(unnamed)") + "</div>" + used +
        '<div class="meta">' + esc(bits.join(" \u00b7 ")) + '</div></div>';
    });
    root.innerHTML = html;
    $("btnImportControl").onclick = function () { $("controlInput").click(); };
    $("btnExportCtrlKmz").onclick = function () { exportControlEarth("kmz"); };
    $("btnExportCtrlKml").onclick = function () { exportControlEarth("kml"); };
    $("btnExportCtrlCsv").onclick = function () {
      FNPlatform.saveBlob(new Blob([pointsCsv(state.controlList)], { type: "text/csv" }), "Control.csv");
    };
  }

  function exportControlEarth(kind) {
    var list = state.controlList || [];
    if (!list.length) { toast("Import control first"); return; }
    var placed = 0, skipped = 0;
    var marks = list.map(function (p) {
      var ll = pointLonLat(p);
      if (!ll) { skipped++; return ""; }
      placed++;
      var desc = [
        p.desc || "",
        p.n || p.e ? ("N " + (p.n || "") + "  E " + (p.e || "")) : "",
        p.z ? ("Z " + p.z) : "",
        p.used ? "Used in a setup" : "",
        "CRS: " + FNCrs.formatLine(crsObj()),
        "KML is WGS 84. NAD83 geographic positions are plotted as-is with no silent datum shift."
      ].filter(Boolean).join("<br>");
      return kmlPlacemark(p.name || p.pt, desc, ll, "st-control");
    }).filter(Boolean);
    if (!placed) {
      toast("Set the job state-plane zone and units so north/east can be converted, or import lat/lon.");
      return;
    }
    var crs = FNCrs.formatLine(crsObj());
    var kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Job control</name><description><![CDATA[' +
      esc("CRS: " + crs) + "<br/>KML is WGS 84. NAD83 geographic positions are plotted as-is with no silent datum shift." +
      "]]></description>" +
      '<Style id="st-control"><IconStyle><color>ff00a0ff</color><scale>1.1</scale></IconStyle></Style>' +
      "<Folder><name>Control</name>" + marks.join("") + "</Folder></Document></kml>";
    var base = (sanitize(state.header.jobNo || "Job") || "Job") + "_control";
    if (kind === "kml") {
      FNPlatform.saveBlob(new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }), base + ".kml");
      if (skipped) toast("Exported " + placed + " points. " + skipped + " skipped (no lat/lon and no job zone).");
      return;
    }
    try {
      var zip = new JSZip();
      zip.file("doc.kml", kml);
      zip.generateAsync({ type: "blob" }).then(function (blob) {
        FNPlatform.saveBlob(blob, base + ".kmz");
        if (skipped) toast("Exported " + placed + " points. " + skipped + " skipped (no lat/lon and no job zone).");
      });
    } catch (e) { toast("Could not build the KMZ"); }
  }

  function photoLogCsv() {
    var rows = [["filename", "pointNo", "code", "note", "jobNo", "dateTime", "crew", "lat", "lon", "accuracy", "heading", "timestamp"]];
    (state.events || []).forEach(function (ev) {
      if (ev.type !== "photo") return;
      var f = ev.fields || {};
      rows.push([
        ev.filename || "", ev.pointNo || "", f.code || ev.code || "", ev.notes || "",
        state.header.jobNo || "", ev.ts || ev.time || "",
        [state.header.partyChief, state.header.crew].filter(Boolean).join(" / "),
        ev.lat || "", ev.lon || "", ev.gpsAccuracy || f.accuracy || "", ev.heading || f.heading || ""
        , ev.ts || ""
      ]);
    });
    return toCsv(rows);
  }

  function finishDayName() {
    var job = sanitize(state.header.jobNo || "JOB") || "JOB";
    var day = (state.header.date || todayISO()).replace(/-/g, "");
    var crew = sanitize(state.header.partyChief || state.header.crew || "Crew") || "Crew";
    return job + "_" + day + "_" + crew;
  }
  var FINISH_ITEMS = [
    { id: "fieldBook", label: "Field book", path: "FieldBook.pdf" },
    { id: "daily", label: "Daily field report", path: "DailyFieldReport.pdf" },
    { id: "points", label: "Points CSV", path: "Points.csv" },
    { id: "control", label: "Control CSV", path: "Control.csv" },
    { id: "kmz", label: "Google Earth KMZ", path: "Job.kmz" },
    { id: "photos", label: "Photos + photo log", path: "Photos/" },
    { id: "sketches", label: "Sketches", path: "Sketches/" },
    { id: "level", label: "Level notes", path: "LevelNotes/" },
    { id: "manholes", label: "Manhole dips", path: "ManholeDips/" },
    { id: "opus", label: "OPUS summaries", path: "OPUS/" }
  ];
  function finishHas(id) {
    if (id === "fieldBook") return (state.events || []).length > 0 || !!(state.header.jobNo || state.header.projectTitle || state.header.weather);
    if (id === "daily") return pkgHasData("daily");
    if (id === "points") return (state.importedPoints || []).length > 0 || (state.events || []).some(function (e) { return e.type === "point_log" || eventPoint(e); });
    if (id === "control") return (state.controlList || []).length > 0;
    if (id === "kmz") return (state.controlList || []).some(function (p) { return pointLonLat(p); }) || (state.events || []).some(function (e) { return eventLonLat(e); }) || (state.importedPoints || []).some(function (p) { return pointLonLat(p); });
    if (id === "photos") return (state.events || []).some(function (e) { return e.type === "photo" && e.fileId; });
    if (id === "sketches") return (state.events || []).some(function (e) { return e.type === "sketch" && e.fileId; });
    if (id === "level") return pkgHasData("level");
    if (id === "manholes") return pkgHasData("manholes");
    if (id === "opus") return (state.opusReports || []).length > 0;
    return false;
  }
  function openFinishDay() {
    var key = "finish-toggles-v1:" + (state.header.jobNo || "_");
    FNIdb.kvGet(key).then(function (saved) {
      var remembered = (saved && saved.items) || {};
      openOverlay("Finish Day", finishDayName() + ".zip");
      var html = '<p class="hint">One folder for the office. Items with data are already checked. Turn any off before you build.</p><div class="pkg-list">';
      FINISH_ITEMS.forEach(function (it) {
        var has = finishHas(it.id);
        var checked = has && remembered[it.id] !== false;
        html += '<label class="pkg-item' + (has ? "" : " unavailable") + '">' +
          '<input type="checkbox" data-fin="' + it.id + '"' + (checked ? " checked" : "") + (has ? "" : " disabled") + ">" +
          '<span><span class="lab">' + esc(it.label) + "</span>" +
          '<span class="sub">' + esc(it.path) + (has ? "" : " \u2014 nothing logged today") + "</span></span></label>";
      });
      html += "</div>";
      $("ovBody").innerHTML = html;
      $("ovFoot").innerHTML = '<button type="button" class="btn btn-primary" id="finGo">Build ' + esc(finishDayName()) + ".zip</button>";
      $("finGo").onclick = function () {
        var selected = {};
        FINISH_ITEMS.forEach(function (it) {
          var box = document.querySelector('[data-fin="' + it.id + '"]');
          selected[it.id] = !!(box && box.checked && !box.disabled);
        });
        if (!Object.keys(selected).some(function (k) { return selected[k]; })) { toast("Select at least one item that has data"); return; }
        FNIdb.kvSet(key, { items: selected, savedAt: new Date().toISOString() });
        closeOverlay();
        buildFinishPackage(selected);
      };
    });
  }

  function blobToU8(blob) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.readAsArrayBuffer(blob);
    });
  }
  function blobToDataUrl(blob) {
    return new Promise(function (resolve) {
      if (!blob) { resolve(""); return; }
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || "")); };
      r.readAsDataURL(blob);
    });
  }
  function dataUrlToJpegU8(dataUrl) {
    return new Promise(function (resolve) {
      if (!dataUrl) { resolve(null); return; }
      if (/^data:image\/jpeg/i.test(dataUrl)) { resolve(FNPdf.fromDataUrl(dataUrl)); return; }
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        c.toBlob(function (b) { if (!b) { resolve(null); return; } blobToU8(b).then(resolve); }, "image/jpeg", 0.92);
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  }

  var SKETCH_LEGEND_LINE = "Legend: Control point; Monument found (circle with a dot); Monument set (filled circle with a cross); Existing pole (filled circle); New pole (open circle); Tree; Utility box / vault; SD manhole (storm drain); SS manhole (sewer); WT manhole (water); Miscellaneous; Line and Circle (solid or dashed).";
  function pdfFieldBook() {
    var doc = new FNPdf.Doc("Field Book");
    var h = state.header || {};
    doc.heading("Field Book");
    doc.para([h.projectTitle || h.jobName || "Field notes", h.jobNo ? "Job " + h.jobNo : "", h.date || "", h.weather || "", formatPointRangeLine(), "CRS: " + FNCrs.formatLine(crsObj())].filter(Boolean).join("  |  "), true);
    doc.gap(6);
    var evs = (state.events || []).slice().sort(function (a, b) { return String(eventTime(a)).localeCompare(String(eventTime(b))); });
    if (!evs.length) doc.para("No entries were logged this day.");
    var chain = Promise.resolve();
    evs.forEach(function (ev) {
      chain = chain.then(function () {
        var line = typeLabel(ev.type) + "  " + (ev.time || "") + (eventPoint(ev) ? "  Pt " + eventPoint(ev) : "") + (ev.status ? "  " + ev.status : "");
        doc.para(line, true);
        if (ev.type === "gnss_base" && gnssSummary(ev)) doc.para(gnssSummary(ev));
        if (ev.type === "ts_setup" && tsSummary(ev)) doc.para(tsSummary(ev));
        if (ev.notes) doc.para(ev.notes);
        if (ev.filename) doc.para("File " + ev.filename);
        if (ev.type === "sketch") doc.para(SKETCH_LEGEND_LINE);
        if (ev.type !== "sketch" || !ev.fileId) return;
        return FNIdb.fileGet(ev.fileId).then(function (rec) {
          if (!rec || !rec.blob) return;
          return blobToDataUrl(rec.blob).then(function (url) {
            return dataUrlToJpegU8(url).then(function (bytes) {
              if (bytes) doc.imageJpeg(bytes, 480);
            });
          });
        });
      });
    });
    return chain.then(function () { return doc.blob(); });
  }
  function pdfDaily() {
    var doc = new FNPdf.Doc("Daily Field Report");
    var d = ensureDaily();
    var L = dailyLabels();
    doc.heading(L.title || "Daily Field Report");
    doc.table([
      ["Project", d.projectName || state.header.projectTitle || "", "Job", d.jobNumber || state.header.jobNo || ""],
      ["Date performed", d.datePerformed || state.header.date || "", "Client", d.client || ""],
      ["Work ordered by", d.workOrderedBy || "", "Received by", d.receivedBy || ""]
    ]);
    doc.gap(4);
    doc.para(formatPointRangeLine());
    doc.heading("Detailed work");
    doc.para(d.detailedWork || "No detailed work was entered.");
    return doc.blob();
  }
  function pdfLevel() {
    var doc = new FNPdf.Doc("Level Notes");
    var calc = levelCompute();
    doc.heading("Level Notes");
    doc.para([state.header.jobNo, state.header.date, state.level && state.level.loopName].filter(Boolean).join("  |  "));
    var rows = [["Kind", "Sta", "BS", "HI", "FS", "Elev", "Notes"]];
    (state.level.rows || []).forEach(function (r, i) {
      var c = calc.computed[i] || {};
      rows.push([r.kind, r.sta, r.bs, fmt3(c.hi), r.fs, r.kind === "BM" ? r.knownElev : fmt3(c.elev), r.notes]);
    });
    doc.table(rows);
    doc.para("Misclosure " + fmt3(calc.misclosure) + "   Closure " + calc.status);
    return doc.blob();
  }
  function pdfOpus(sol) {
    var doc = new FNPdf.Doc("OPUS summary");
    doc.heading("OPUS summary");
    (FNOpus.summaryFields(sol) || []).forEach(function (f) { doc.para(f.label + ": " + f.value); });
    if (sol.quality) {
      doc.gap(4);
      doc.para("Flags: " + sol.quality.overall, true);
      (sol.quality.rows || []).forEach(function (r) {
        doc.para((r.pass === false ? "FLAG  " : "") + r.label + "  " + r.value + (r.note ? " -- " + r.note : ""));
      });
    }
    return doc.blob();
  }

  function buildFinishPackage(selected) {
    if (typeof JSZip === "undefined") { toast("JSZip is not available"); return; }
    if (typeof FNPdf === "undefined") { toast("PDF writer is not available"); return; }
    var zip = new JSZip();
    var root = finishDayName() + "/";
    var files = [];
    function add(path, data) { zip.file(root + path, data); files.push(path); }
    toast("Building " + finishDayName() + ".zip\u2026");
    var chain = Promise.resolve();
    if (selected.fieldBook) {
      chain = chain.then(function () { return Promise.resolve(pdfFieldBook()); }).then(function (blob) { if (blob) add("FieldBook.pdf", blob); });
    }
    if (selected.daily) add("DailyFieldReport.pdf", pdfDaily());
    if (selected.points) {
      var pts = (state.importedPoints || []).slice();
      (state.events || []).forEach(function (ev) {
        if (ev.type === "point_log" || ev.type === "topo") {
          var f = ev.fields || {};
          pts.push({ name: ev.pointNo, n: f.n, e: f.e, z: f.z || f.elev, desc: ev.notes, lat: ev.lat, lon: ev.lon, sourceFile: ev.importedFrom || "log" });
        }
      });
      add("Points.csv", pointsCsv(pts));
    }
    if (selected.control) add("Control.csv", pointsCsv(state.controlList));
    if (selected.level) {
      add("LevelNotes/LevelNotes.pdf", pdfLevel());
      add("LevelNotes/LevelNotes.csv", levelCsv());
    }
    if (selected.opus) {
      (state.opusReports || []).forEach(function (sol, i) {
        var tag = sanitize((sol.rinex || "opus") + "-" + (i + 1)) || ("opus-" + (i + 1));
        add("OPUS/" + tag + ".txt", FNOpus.toText(sol));
        add("OPUS/" + tag + ".csv", FNOpus.toCsv(sol));
        add("OPUS/" + tag + ".pdf", pdfOpus(sol));
      });
    }
    if (selected.kmz) {
      chain = chain.then(function () { return buildJobKmzBlob(); }).then(function (blob) { if (blob) add("Job.kmz", blob); });
    }
    if (selected.photos) {
      add("Photos/PhotoLog.csv", photoLogCsv());
      (state.events || []).forEach(function (ev) {
        if (ev.type !== "photo" || !ev.fileId) return;
        chain = chain.then(function () {
          return FNIdb.fileGet(ev.fileId).then(function (rec) {
            if (!rec || !rec.blob) return;
            add("Photos/" + (ev.filename || (eventPoint(ev) || ev.id) + ".jpg"), rec.blob);
          });
        });
      });
    }
    if (selected.sketches) {
      (state.events || []).forEach(function (ev) {
        if (ev.type !== "sketch" || !ev.fileId) return;
        chain = chain.then(function () {
          return FNIdb.fileGet(ev.fileId).then(function (rec) {
            if (!rec || !rec.blob) return;
            add("Sketches/" + (ev.filename || ev.id + ".png"), rec.blob);
          });
        });
      });
    }
    if (selected.manholes) {
      chain = chain.then(function () { return pdfManholes().then(function (blob) { add("ManholeDips/ManholeDips.pdf", blob); }); });
    }
    chain.then(function () {
      var manifest = "Field Notes package\n" + finishDayName() + "\n" +
        (state.header.date || todayISO()) + "\n" +
        formatPointRangeLine() + "\n" +
        "CRS: " + FNCrs.formatLine(crsObj()) + "\n\nFiles:\n" + files.join("\n") + "\n";
      add("manifest.txt", manifest);
      return zip.generateAsync({ type: "blob" });
    }).then(function (blob) {
      return FNPlatform.saveBlob(blob, finishDayName() + ".zip");
    }).then(function () { toast("Saved " + finishDayName() + ".zip"); })
      .catch(function () { toast("Could not build the package"); });
  }

  function buildJobKmzBlob() {
    var zip;
    try { zip = new JSZip(); } catch (e) { return Promise.resolve(null); }
    var hrefs = {};
    var chain = Promise.resolve();
    (state.events || []).forEach(function (ev) {
      if (ev.type !== "photo" || !ev.fileId) return;
      chain = chain.then(function () {
        return FNIdb.fileGet(ev.fileId).then(function (rec) {
          if (!rec || !rec.blob) return;
          var name = ev.filename || (eventPoint(ev) || ev.id) + ".jpg";
          hrefs[name] = "files/" + name;
          zip.file("files/" + name, rec.blob);
        });
      });
    });
    return chain.then(function () {
      zip.file("doc.kml", buildKml(hrefs));
      return zip.generateAsync({ type: "blob" });
    });
  }

  function pdfManholes() {
    var doc = new FNPdf.Doc("Manhole Dips");
    var sheet = ensureManholes();
    doc.heading("Manhole Dips");
    doc.para([sheet.jobName, sheet.jobNo, state.header.date].filter(Boolean).join("  |  "));
    (sheet.holes || []).forEach(function (hole, i) {
      doc.para("Manhole " + (i + 1) + "  Point " + (hole.pointNo || ""), true);
      doc.para([hole.desc1, hole.desc2, hole.rimElev ? "Rim " + hole.rimElev : ""].filter(Boolean).join("  |  "));
      var rows = [["Dir", "Size", "Inv", "Dip", "Notes"]];
      (hole.pipes || []).forEach(function (r) { rows.push([r.pt || r.dir || "", r.size || "", r.ie || "", r.dip || "", r.notes || ""]); });
      if (rows.length > 1) doc.table(rows);
    });
    return Promise.resolve(doc.blob());
  }


    function bindUi() {
    if ($("btnBack")) $("btnBack").addEventListener("click", function () { showView("menu"); });
    document.querySelectorAll("[data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () { showView(btn.getAttribute("data-view")); });
    });
    if ($("btnSettings")) $("btnSettings").addEventListener("click", openSettings);
    if ($("btnNew")) $("btnNew").addEventListener("click", newDay);
    if ($("btnGnss")) $("btnGnss").addEventListener("click", function () { openGnss(); });
    if ($("btnTs")) $("btnTs").addEventListener("click", function () { openTs(); });
    if ($("btnPhoto")) $("btnPhoto").addEventListener("click", function () { openPhoto(); });
    if ($("btnSketch")) $("btnSketch").addEventListener("click", function () { openSketch(); });
    if ($("ovClose")) $("ovClose").addEventListener("click", closeOverlay);
    if ($("btnEod")) $("btnEod").addEventListener("click", printFieldNotes);
    if ($("btnControlReport")) $("btnControlReport").addEventListener("click", printControl);
    if ($("btnDailyReport")) $("btnDailyReport").addEventListener("click", printDaily);
    if ($("btnMhReport")) $("btnMhReport").addEventListener("click", printManholes);
    if ($("btnDailyPrint")) $("btnDailyPrint").addEventListener("click", printDaily);
    if ($("btnDailyFromLog")) $("btnDailyFromLog").addEventListener("click", fillDailyFromLog);
    if ($("btnMhPrint")) $("btnMhPrint").addEventListener("click", printManholes);
    if ($("btnMhAdd")) $("btnMhAdd").addEventListener("click", function () {
      ensureManholes().holes.push(emptyManhole());
      scheduleSave(); renderManholes();
    });
    if ($("btnEarth")) $("btnEarth").addEventListener("click", exportEarth);
    if ($("btnPackage")) $("btnPackage").addEventListener("click", openFinishDay);
    if ($("btnFinishDay")) $("btnFinishDay").addEventListener("click", openFinishDay);
    if ($("btnCsv")) $("btnCsv").addEventListener("click", downloadCsv);
    if ($("btnImportControl")) $("btnImportControl").addEventListener("click", function () { $("controlInput").click(); });
    if ($("btnImportPoints")) $("btnImportPoints").addEventListener("click", function () { $("pointsInput").click(); });
    if ($("btnImportRef")) $("btnImportRef").addEventListener("click", function () { $("refInput").click(); });
    if ($("btnImportJxl")) $("btnImportJxl").addEventListener("click", function () { $("jxlInput").click(); });
  }
  function installHint() {
    var el = $("installHint");
    if (!el) return;
    if (location.protocol === "file:") {
      el.textContent = "Opened from a file. Logging works here. For install, offline, and automatic weather, serve the app over http (python3 serve.py).";
      return;
    }
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    if (ios) el.textContent = "On iPhone or iPad: Safari → Share → Add to Home Screen. The app must be served over http(s).";
    else el.textContent = "Install as an app from the browser menu when prompted, or use it in the browser. Serve over http(s) so offline works.";
  }
  function loadProfile() {
    return FNIdb.kvGet(PROFILE_KEY).then(function (saved) {
      if (saved && validateProfile(saved)) { profile = saved; return profile; }
      var id = (config && config.defaultProfile) || "generic-default";
      return fetchPreset(id).then(function (pr) { return setProfile(pr).then(function () { return pr; }); })
        .catch(function () { profile = genericFallback(); return profile; });
    });
  }
  function init() {
    bindHeader();
    bindUi();
    bindFiles();
    renderMoreLog();
    installHint();
    if ($("productName") && config && config.productName) $("productName").textContent = config.productName;
    writeHeader();
    renderTimeline();
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    }
  }

  Promise.resolve()
    .then(function () { return FNIdb.open(); })
    .then(loadConfig)
    .then(function (cfg) { config = cfg; return loadBundled(); })
    .then(loadProfile)
    .then(loadDay)
    .then(init)
    .catch(function (err) {
      profile = profile || genericFallback();
      state = state || emptyState();
      init();
      toast("Started with a local session — some storage may be unavailable");
      console.error(err);
    });
})();
