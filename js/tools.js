/* One-screen field calculators. No default survey values are assumed. */
(function (global) {
  "use strict";

  var USFT = 1200 / 3937;
  var INTL = 0.3048;
  var TOOLS = [
    { id: "units", label: "Units", sub: "Feet, chains, metres, DMS, slope" },
    { id: "inverse", label: "Inverse", sub: "Bearing and distance between two points" },
    { id: "traverse", label: "Traverse / COGO", sub: "New point by bearing and distance" },
    { id: "curve", label: "Curve", sub: "Circular curve elements" },
    { id: "level", label: "Level loop", sub: "Closure and simple adjustment" },
    { id: "area", label: "Area", sub: "Area from coordinate list" },
    { id: "csf", label: "Grid ↔ ground", sub: "You enter the combined scale factor" },
    { id: "spc", label: "State plane ↔ lat/lon", sub: "CA Zones 1–6, NAD83" },
    { id: "opus", label: "OPUS solution", sub: "Paste or load an OPUS report" }
  ];

  var api = null;
  var screenEl = null;
  var homeEl = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return api && api.esc ? api.esc(s) : String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function toast(m) { if (api && api.toast) api.toast(m); }
  function n(v) {
    var s = String(v == null ? "" : v).trim().replace(/,/g, "");
    if (!s) return null;
    var x = Number(s);
    return isFinite(x) ? x : null;
  }
  function fld(id, label, opts) {
    opts = opts || {};
    var typ = opts.type || "text";
    return '<label class="fld' + (opts.span ? " span-row" : "") + '"><span>' + esc(label) + "</span>" +
      (typ === "textarea"
        ? '<textarea id="' + id + '" rows="' + (opts.rows || 5) + '" placeholder="' + esc(opts.ph || "") + '">' + esc(opts.value || "") + "</textarea>"
        : typ === "select"
          ? '<select id="' + id + '">' + (opts.options || "") + "</select>"
          : '<input id="' + id + '" type="' + typ + '"' + (typ === "number" || opts.dec ? ' inputmode="decimal"' : "") +
            ' value="' + esc(opts.value || "") + '" placeholder="' + esc(opts.ph || "") + '">') +
      "</label>";
  }
  function resultBox(html, id) { return '<div class="tool-result" id="' + (id || "toolResult") + '">' + html + "</div>"; }

  /* Gunter's chain = 66 US survey feet = 100 links. Rod (pole/perch) = 16.5 US survey feet. */
  var CHAIN_USFT = 66;
  var LINK_USFT = 66 / 100;
  var ROD_USFT = 33 / 2;
  function usFtPerUnit(unit) {
    if (unit === "us-ft") return 1;
    if (unit === "chain") return CHAIN_USFT;
    if (unit === "link") return LINK_USFT;
    if (unit === "rod") return ROD_USFT;
    return null;
  }
  function toMeters(v, unit) {
    if (v == null) return null;
    if (unit === "intl-ft") return v * INTL;
    if (unit === "m") return v;
    var f = usFtPerUnit(unit);
    if (f != null) return v * f * USFT;
    return v;
  }
  function fromMeters(v, unit) {
    if (v == null) return null;
    if (unit === "intl-ft") return v / INTL;
    if (unit === "m") return v;
    var f = usFtPerUnit(unit);
    if (f != null) return v / (f * USFT);
    return v;
  }
  function unitLabel(u) {
    return ({ "us-ft": "US survey ft", "intl-ft": "international ft", "m": "m", "chain": "chains", "link": "links", "rod": "rods" })[u] || u;
  }
  function fmt(v, d) {
    if (v == null || !isFinite(v)) return "—";
    d = d == null ? 4 : d;
    return v.toFixed(d);
  }
  function jobUnits() {
    return (api && api.getCrs && api.getCrs().crsUnits) || "us-ft";
  }
  function lengthUnitOptions(sel) {
    return [
      "us-ft|US survey feet",
      "intl-ft|International feet",
      "m|Metres",
      "chain|Chains (Gunter's, 66 US ft)",
      "link|Links (100 per chain)",
      "rod|Rods (16.5 US ft)"
    ].map(function (p) {
      var a = p.split("|");
      return '<option value="' + a[0] + '"' + (sel === a[0] ? " selected" : "") + ">" + a[1] + "</option>";
    }).join("");
  }
  function unitOptions(sel) {
    return ["us-ft|US survey feet", "intl-ft|International feet", "m|Metres"].map(function (p) {
      var a = p.split("|");
      return '<option value="' + a[0] + '"' + (sel === a[0] ? " selected" : "") + ">" + a[1] + "</option>";
    }).join("");
  }
  function parseAzimuth(text) {
    var t = String(text || "").trim();
    if (!t) return null;
    /* Bearing: N 45d30'00" E, N45d30m00sE, S45-12-30W, etc. */
    var b = t.match(/^\s*([NS])\s*(.+?)\s*([EW])\s*$/i);
    if (b && global.FNCrs && FNCrs.parseAngle) {
      var ang = FNCrs.parseAngle(b[2]);
      if (ang != null && isFinite(ang)) {
        ang = Math.abs(ang);
        var ns = b[1].toUpperCase(), ew = b[3].toUpperCase();
        var az;
        if (ns === "N" && ew === "E") az = ang;
        else if (ns === "N" && ew === "W") az = 360 - ang;
        else if (ns === "S" && ew === "E") az = 180 - ang;
        else az = 180 + ang;
        return ((az % 360) + 360) % 360;
      }
    }
    var deg = (global.FNCrs && FNCrs.parseAngle) ? FNCrs.parseAngle(t) : Number(t);
    if (deg == null || !isFinite(deg)) return null;
    return ((deg % 360) + 360) % 360;
  }
  function parseSlope(text) {
    var t = String(text || "").trim();
    if (!t) return null;
    var ratio = t.match(/^([+-]?\d+(?:\.\d+)?)\s*[:/]\s*([+-]?\d+(?:\.\d+)?)$/);
    if (ratio) {
      var h = Number(ratio[1]), v = Number(ratio[2]);
      if (!isFinite(h) || h === 0) return null;
      return v / h;
    }
    var x = n(t.replace(/%/g, ""));
    if (x == null) return null;
    return x / 100;
  }
  function solveGrade(dist, slope, dElev) {
    var hasD = dist != null, hasS = slope != null, hasE = dElev != null;
    var out = { dist: dist, slope: slope, dElev: dElev, solved: null };
    var known = (hasD ? 1 : 0) + (hasS ? 1 : 0) + (hasE ? 1 : 0);
    if (known < 2) return out;
    if (hasD && hasS && !hasE) { out.dElev = dist * slope; out.solved = "dElev"; }
    else if (hasD && hasE && !hasS) {
      if (dist === 0) return out;
      out.slope = dElev / dist; out.solved = "slope";
    } else if (hasS && hasE && !hasD) {
      if (slope === 0) return out;
      out.dist = dElev / slope; out.solved = "dist";
    }
    return out;
  }
  function angleHint() {
    return '<p class="hint">Use d for ° — 34d14\'44.9", 34d14m44.9s, 34d14 44.9, or decimal degrees.</p>';
  }
  function azToBearing(az) {
    az = ((Number(az) % 360) + 360) % 360;
    var ns, ew, ang;
    if (az <= 90) { ns = "N"; ew = "E"; ang = az; }
    else if (az <= 180) { ns = "S"; ew = "E"; ang = 180 - az; }
    else if (az <= 270) { ns = "S"; ew = "W"; ang = az - 180; }
    else { ns = "N"; ew = "W"; ang = 360 - az; }
    var d = Math.floor(ang + 1e-12);
    var mFull = (ang - d) * 60;
    var m = Math.floor(mFull + 1e-12);
    var s = (mFull - m) * 60;
    if (s >= 59.995) { s = 0; m += 1; }
    if (m >= 60) { m = 0; d += 1; }
    function p(n, w) { return String(n).padStart(w, "0"); }
    return ns + " " + d + "° " + p(m, 2) + "' " + s.toFixed(2) + '" ' + ew;
  }

  function renderHome() {
    if (!homeEl || !screenEl) return;
    homeEl.classList.remove("hidden");
    screenEl.classList.add("hidden");
    homeEl.innerHTML = '<p class="hint">Simple calculators for the field. Each tool is one screen. Nothing is filled in for you.</p>' +
      '<div class="tools-grid">' + TOOLS.map(function (t) {
        return '<button type="button" class="tile tile-tool" data-tool="' + t.id + '">' + esc(t.label) +
          '<span class="sub">' + esc(t.sub) + "</span></button>";
      }).join("") + "</div>";
    homeEl.querySelectorAll("[data-tool]").forEach(function (btn) {
      btn.addEventListener("click", function () { openTool(btn.getAttribute("data-tool")); });
    });
  }

  function openTool(id) {
    homeEl.classList.add("hidden");
    screenEl.classList.remove("hidden");
    var tool = TOOLS.filter(function (t) { return t.id === id; })[0];
    var body = "";
    if (id === "units") body = unitsHtml();
    else if (id === "inverse") body = inverseHtml();
    else if (id === "traverse") body = traverseHtml();
    else if (id === "curve") body = curveHtml();
    else if (id === "level") body = levelHtml();
    else if (id === "area") body = areaHtml();
    else if (id === "csf") body = csfHtml();
    else if (id === "spc") body = spcHtml();
    else if (id === "opus") body = opusHtml();
    screenEl.innerHTML = '<div class="tool-bar"><button type="button" class="btn" id="toolBack">All tools</button><h2 style="margin:0">' + esc(tool ? tool.label : "") + "</h2></div>" + body;
    $("toolBack").onclick = renderHome;
    if (id === "units") bindUnits();
    if (id === "inverse") bindInverse();
    if (id === "traverse") bindTraverse();
    if (id === "curve") bindCurve();
    if (id === "level") bindLevel();
    if (id === "area") bindArea();
    if (id === "csf") bindCsf();
    if (id === "spc") bindSpc();
    if (id === "opus") bindOpus();
  }

  function unitsHtml() {
    return '<div class="card"><h2>Length</h2><div class="grid g2">' +
      fld("uLen", "Value", { dec: true }) +
      fld("uFrom", "From", { type: "select", options: lengthUnitOptions("us-ft") }) +
      "</div>" + resultBox('<p class="hint">Enter a length to convert.</p>', 'uLenBox') + "</div>" +
      '<div class="card"><h2>Angle</h2><div class="grid g2">' +
      fld("uAng", "Decimal degrees or DMS", { ph: "e.g. 117.5 or 34d14'44.9\"" }) +
      "</div>" + angleHint() + resultBox('<p class="hint">Enter an angle.</p>', 'uAngBox') + "</div>" +
      '<div class="card"><h2>Grade / slope</h2><p class="hint">Enter any one field. Ratio is run:rise (H:V), e.g. 2:1.</p><div class="grid g2">' +
      fld("uPct", "Percent (%)", { dec: true }) +
      fld("uRatio", "Ratio (H:V)", { ph: "e.g. 2:1" }) +
      fld("uDeg", "Degrees", { dec: true }) +
      "</div>" + resultBox('<p class="hint">Enter a slope.</p>', 'uGradeBox') +
      "<h3>Distance, slope, and elevation</h3>" +
      '<p class="hint">Enter any two of horizontal distance, slope, and change in elevation to solve the third. Slope is percent (2 or 2%) or a ratio H:V (50:1).</p><div class="grid g2">' +
      fld("uGDist", "Horizontal distance (ft)", { dec: true }) +
      fld("uGSlope", "Slope (% or ratio H:V)", { ph: "e.g. 2, 2%, or 50:1" }) +
      fld("uGStart", "Start elevation (ft, optional)", { dec: true }) +
      fld("uGElev", "Change in elevation (ft)", { dec: true }) +
      "</div>" + resultBox('<p class="hint">Enter any two values.</p>', 'uGSolveBox') + "</div>";
  }
  function bindUnits() {
    function convLen() {
      var v = n($("uLen").value), from = $("uFrom").value;
      var box = $("uLenBox");
      if (v == null) { box.innerHTML = '<p class="hint">Enter a length to convert.</p>'; return; }
      var m = toMeters(v, from);
      box.innerHTML = "<div class=\"row\"><span>Chains (Gunter's)</span><span>" + fmt(fromMeters(m, "chain"), 7) + "</span></div>" +
        "<div class=\"row\"><span>Links</span><span>" + fmt(fromMeters(m, "link"), 7) + "</span></div>" +
        "<div class=\"row\"><span>Rods</span><span>" + fmt(fromMeters(m, "rod"), 7) + "</span></div>" +
        "<div class=\"row\"><span>US survey feet</span><span>" + fmt(fromMeters(m, "us-ft"), 7) + "</span></div>" +
        "<div class=\"row\"><span>International feet</span><span>" + fmt(fromMeters(m, "intl-ft"), 7) + "</span></div>" +
        "<div class=\"row\"><span>Metres</span><span>" + fmt(m, 7) + "</span></div>" +
        '<p class="hint">Gunter’s chain = 66 US survey feet = 100 links. 1 rod = 16.5 US survey feet = 25 links. 1 US survey foot = 1200/3937 m (exact). 1 international foot = 0.3048 m (exact). So 1 chain = 20.1168402 m.</p>';
    }
    function convAng() {
      var deg = FNCrs.parseAngle($("uAng").value);
      var box = $("uAngBox");
      if (!box) return;
      if (deg == null) { box.innerHTML = '<p class="hint">Enter an angle.</p>'; return; }
      box.innerHTML = "<div class=\"row\"><span>Decimal degrees</span><span>" + fmt(deg, 8) + "</span></div>" +
        "<div class=\"row\"><span>DMS</span><span>" + esc(FNCrs.degToDms(deg, "lat").replace(/ [NS]$/, "")) + "</span></div>";
    }
    function convGrade() {
      var pct = n($("uPct").value), deg = n($("uDeg").value), ratio = String($("uRatio").value || "").trim();
      var slope = null;
      if (document.activeElement === $("uPct") && pct != null) slope = pct / 100;
      else if (document.activeElement === $("uDeg") && deg != null) slope = Math.tan(deg * Math.PI / 180);
      else if (ratio) {
        var p = ratio.split(/[:/]/);
        if (p.length === 2 && n(p[0]) && n(p[1])) slope = n(p[1]) / n(p[0]);
      } else if (pct != null) slope = pct / 100;
      else if (deg != null) slope = Math.tan(deg * Math.PI / 180);
      var box = $("uGradeBox");
      if (!box) return;
      if (slope == null) { box.innerHTML = '<p class="hint">Enter a slope.</p>'; return; }
      var run = 1, rise = slope;
      /* present ratio as run:rise with run >= 1 when possible */
      var rRun = slope !== 0 ? Math.abs(1 / slope) : null;
      box.innerHTML = "<div class=\"row\"><span>Percent</span><span>" + fmt(slope * 100, 4) + " %</span></div>" +
        "<div class=\"row\"><span>Degrees</span><span>" + fmt(Math.atan(slope) * 180 / Math.PI, 4) + "°</span></div>" +
        "<div class=\"row\"><span>Ratio (run:rise)</span><span>" + (rRun == null ? "vertical" : fmt(rRun, 4) + ":1") + "</span></div>";
    }
    function convGradeSolve() {
      var dist = n($("uGDist").value), slope = parseSlope($("uGSlope").value), dElev = n($("uGElev").value);
      var start = n($("uGStart").value);
      var box = $("uGSolveBox");
      if (!box) return;
      var filled = (dist != null ? 1 : 0) + (slope != null ? 1 : 0) + (dElev != null ? 1 : 0);
      if (filled < 2) { box.innerHTML = '<p class="hint">Enter any two values.</p>'; return; }
      var s = solveGrade(dist, slope, dElev);
      if (filled === 2 && !s.solved) { box.innerHTML = '<p class="hint">Cannot solve from those two values.</p>'; return; }
      var html = "<div class=\"row\"><span>Horizontal distance</span><span>" + fmt(s.dist, 4) + " ft" + (s.solved === "dist" ? " (solved)" : "") + "</span></div>" +
        "<div class=\"row\"><span>Slope</span><span>" + (s.slope == null ? "—" : fmt(s.slope * 100, 4) + " % · " + (s.slope === 0 ? "level" : (fmt(Math.abs(1 / s.slope), 4) + ":1 H:V"))) + (s.solved === "slope" ? " (solved)" : "") + "</span></div>" +
        "<div class=\"row\"><span>Change in elevation</span><span>" + fmt(s.dElev, 4) + " ft" + (s.solved === "dElev" ? " (solved)" : "") + "</span></div>";
      if (start != null && s.dElev != null) html += "<div class=\"row\"><span>End elevation</span><span>" + fmt(start + s.dElev, 4) + " ft</span></div>";
      box.innerHTML = html;
    }
    ["uLen", "uFrom"].forEach(function (id) { $(id).addEventListener("input", convLen); $(id).addEventListener("change", convLen); });
    $("uAng").addEventListener("input", convAng);
    ["uPct", "uRatio", "uDeg"].forEach(function (id) { $(id).addEventListener("input", convGrade); });
    ["uGDist", "uGSlope", "uGElev", "uGStart"].forEach(function (id) {
      $(id).addEventListener("input", convGradeSolve); $(id).addEventListener("change", convGradeSolve);
    });
  }

  function inverseHtml() {
    return '<p class="hint">Horizontal inverse. Elevations are optional (for slope distance only).</p><div class="card"><div class="grid g2">' +
      fld("invUnits", "Units", { type: "select", options: unitOptions(jobUnits()) }) +
      fld("invN1", "From North", { dec: true }) + fld("invE1", "From East", { dec: true }) +
      fld("invZ1", "From elev (optional)", { dec: true }) +
      fld("invN2", "To North", { dec: true }) + fld("invE2", "To East", { dec: true }) +
      fld("invZ2", "To elev (optional)", { dec: true }) +
      "</div>" + resultBox('<p class="hint">Enter both points.</p>') + "</div>";
  }
  function bindInverse() {
    function run() {
      var N1 = n($("invN1").value), E1 = n($("invE1").value), N2 = n($("invN2").value), E2 = n($("invE2").value);
      var box = $("toolResult");
      if (N1 == null || E1 == null || N2 == null || E2 == null) { box.innerHTML = '<p class="hint">Enter both points.</p>'; return; }
      var dN = N2 - N1, dE = E2 - E1;
      var hd = Math.sqrt(dN * dN + dE * dE);
      var az = ((Math.atan2(dE, dN) * 180 / Math.PI) + 360) % 360;
      var Z1 = n($("invZ1").value), Z2 = n($("invZ2").value);
      var extra = "";
      if (Z1 != null && Z2 != null) {
        var dZ = Z2 - Z1;
        var sd = Math.sqrt(hd * hd + dZ * dZ);
        extra = "<div class=\"row\"><span>ΔZ</span><span>" + fmt(dZ, 4) + "</span></div>" +
          "<div class=\"row\"><span>Slope distance</span><span>" + fmt(sd, 4) + "</span></div>" +
          "<div class=\"row\"><span>Grade</span><span>" + (hd ? fmt((dZ / hd) * 100, 4) + " %" : "—") + "</span></div>";
      }
      box.innerHTML = "<div class=\"row\"><span>ΔN</span><span>" + fmt(dN, 4) + "</span></div>" +
        "<div class=\"row\"><span>ΔE</span><span>" + fmt(dE, 4) + "</span></div>" +
        "<div class=\"row\"><span>Horizontal distance</span><span>" + fmt(hd, 4) + " " + esc(unitLabel($("invUnits").value)) + "</span></div>" +
        "<div class=\"row\"><span>Azimuth</span><span>" + fmt(az, 6) + "°</span></div>" +
        "<div class=\"row\"><span>Bearing</span><span>" + esc(azToBearing(az)) + "</span></div>" + extra;
    }
    ["invN1","invE1","invZ1","invN2","invE2","invZ2","invUnits"].forEach(function (id) {
      $(id).addEventListener("input", run); $(id).addEventListener("change", run);
    });
  }

  function traverseHtml() {
    return '<p class="hint">Azimuth is degrees from north, clockwise. Bearings like N 45d30\'00" E also work.</p>' +
      angleHint() +
      '<div class="card"><div class="grid g2">' +
      fld("trUnits", "Units", { type: "select", options: unitOptions(jobUnits()) }) +
      fld("trN", "Start North", { dec: true }) + fld("trE", "Start East", { dec: true }) +
      fld("trAz", "Azimuth or bearing", { ph: "e.g. 45.21000 or N 45d30'00\" E" }) +
      fld("trDist", "Horizontal distance", { dec: true }) +
      "</div>" + resultBox('<p class="hint">Enter start, direction, and distance.</p>') + "</div>";
  }
  function bindTraverse() {
    function run() {
      var N = n($("trN").value), E = n($("trE").value), d = n($("trDist").value), az = parseAzimuth($("trAz").value);
      var box = $("toolResult");
      if (N == null || E == null || d == null || az == null) { box.innerHTML = '<p class="hint">Enter start, direction, and distance.</p>'; return; }
      var rad = az * Math.PI / 180;
      var n2 = N + d * Math.cos(rad);
      var e2 = E + d * Math.sin(rad);
      box.innerHTML = "<div class=\"row\"><span>Azimuth used</span><span>" + fmt(az, 6) + "° · " + esc(azToBearing(az)) + "</span></div>" +
        "<div class=\"row\"><span>New North</span><span>" + fmt(n2, 4) + "</span></div>" +
        "<div class=\"row\"><span>New East</span><span>" + fmt(e2, 4) + "</span></div>";
    }
    ["trN","trE","trAz","trDist","trUnits"].forEach(function (id) {
      $(id).addEventListener("input", run); $(id).addEventListener("change", run);
    });
  }

  function curveHtml() {
    return '<p class="hint">Circular curve. Enter a radius and either the central angle (delta) or the arc length. Degree of curve uses the 100-unit arc definition: D = 18,000 / (π R).</p><div class="card"><div class="grid g2">' +
      fld("cuUnits", "Units", { type: "select", options: unitOptions(jobUnits()) }) +
      fld("cuR", "Radius R", { dec: true }) +
      fld("cuD", "Delta Δ (degrees or DMS)", { ph: "e.g. 12.5 or 12d30'00\"" }) +
      fld("cuL", "Arc length L (optional)", { dec: true }) +
      "</div>" + angleHint() + resultBox('<p class="hint">Enter R and Δ, or R and L.</p>') + "</div>";
  }
  function bindCurve() {
    function run() {
      var R = n($("cuR").value);
      var L = n($("cuL").value);
      var deltaDeg = FNCrs.parseAngle($("cuD").value);
      var box = $("toolResult");
      if (R == null || R === 0) { box.innerHTML = '<p class="hint">Enter a radius.</p>'; return; }
      if (deltaDeg == null && L != null) deltaDeg = (L / R) * (180 / Math.PI);
      if (deltaDeg == null) { box.innerHTML = '<p class="hint">Enter R and Δ, or R and L.</p>'; return; }
      var dRad = Math.abs(deltaDeg) * Math.PI / 180;
      if (L == null) L = R * dRad;
      var T = R * Math.tan(dRad / 2);
      var C = 2 * R * Math.sin(dRad / 2);
      var M = R * (1 - Math.cos(dRad / 2));
      var E = R * (1 / Math.cos(dRad / 2) - 1);
      var Dc = 18000 / (Math.PI * R);
      var u = unitLabel($("cuUnits").value);
      box.innerHTML = "<div class=\"row\"><span>Delta Δ</span><span>" + fmt(Math.abs(deltaDeg), 6) + "° · " + esc(FNCrs.degToDms(Math.abs(deltaDeg), "lat").replace(/ [NS]$/, "")) + "</span></div>" +
        "<div class=\"row\"><span>Radius R</span><span>" + fmt(R, 4) + " " + esc(u) + "</span></div>" +
        "<div class=\"row\"><span>Arc length L</span><span>" + fmt(L, 4) + "</span></div>" +
        "<div class=\"row\"><span>Tangent T</span><span>" + fmt(T, 4) + "</span></div>" +
        "<div class=\"row\"><span>Chord C</span><span>" + fmt(C, 4) + "</span></div>" +
        "<div class=\"row\"><span>Mid-ordinate M</span><span>" + fmt(M, 4) + "</span></div>" +
        "<div class=\"row\"><span>External E</span><span>" + fmt(E, 4) + "</span></div>" +
        "<div class=\"row\"><span>Degree of curve D (100-unit arc)</span><span>" + fmt(Dc, 6) + "°</span></div>";
    }
    ["cuR","cuD","cuL","cuUnits"].forEach(function (id) {
      $(id).addEventListener("input", run); $(id).addEventListener("change", run);
    });
  }

  function levelHtml() {
    var calc = api && api.levelCalc ? api.levelCalc() : null;
    var fromDay = calc && calc.misclosure != null
      ? '<p class="hint">Today’s level notes have a misclosure of ' + fmt(calc.misclosure, 3) + ' over ' + calc.setups + ' setups. You can use those figures or type your own. Adjustment is a simple equal split to each turning point (or by sight distance if you enter distances).</p>'
      : '<p class="hint">Enter the loop yourself, or fill level notes for the day first. Adjustment is a simple equal split (or by sight distance if entered). This is not a least-squares adjustment.</p>';
    return fromDay + '<div class="card"><div class="grid g2">' +
      fld("lvMis", "Misclosure (computed − known)", { dec: true, value: calc && calc.misclosure != null ? String(calc.misclosure) : "" }) +
      fld("lvSetups", "Number of setups (turns)", { dec: true, value: calc && calc.setups ? String(calc.setups) : "" }) +
      fld("lvDist", "Total sight distance (optional)", { dec: true, value: calc && calc.distN ? String(calc.dist) : "", span: true }) +
      "</div>" + resultBox('<p class="hint">Enter misclosure and setups.</p>') + "</div>";
  }
  function bindLevel() {
    function run() {
      var mis = n($("lvMis").value), k = n($("lvSetups").value), dist = n($("lvDist").value);
      var box = $("toolResult");
      if (mis == null || k == null || k <= 0) { box.innerHTML = '<p class="hint">Enter misclosure and setups.</p>'; return; }
      var per = -mis / k;
      var html = "<div class=\"row\"><span>Correction per setup (equal)</span><span>" + fmt(per, 4) + "</span></div>" +
        "<p class=\"hint\">Sign is opposite the misclosure so that computed + correction → known. Apply one increment after each setup along the loop.</p>";
      if (dist != null && dist > 0) {
        html += "<div class=\"row\"><span>Correction per unit of sight distance</span><span>" + fmt(-mis / dist, 6) + "</span></div>";
      }
      box.innerHTML = html;
    }
    ["lvMis","lvSetups","lvDist"].forEach(function (id) { $(id).addEventListener("input", run); });
    run();
  }

  function areaHtml() {
    return '<p class="hint">One point per line: North, East (comma, space, or tab). The figure is closed back to the first point automatically. Area uses the shoelace formula.</p><div class="card">' +
      fld("arUnits", "Units", { type: "select", options: unitOptions(jobUnits()) }) +
      fld("arPts", "Coordinates", { type: "textarea", rows: 8, ph: "N, E", span: true }) +
      resultBox('<p class="hint">Enter at least three points.</p>') + "</div>";
  }
  function bindArea() {
    function run() {
      var unit = $("arUnits").value;
      var pts = [];
      String($("arPts").value || "").split(/\r?\n/).forEach(function (line) {
        var p = line.trim().split(/[,\s\t]+/).filter(Boolean);
        if (p.length >= 2 && n(p[0]) != null && n(p[1]) != null) pts.push({ n: n(p[0]), e: n(p[1]) });
      });
      var box = $("toolResult");
      if (pts.length < 3) { box.innerHTML = '<p class="hint">Enter at least three points.</p>'; return; }
      var sum = 0;
      for (var i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        sum += a.e * b.n - b.e * a.n;
      }
      var area = Math.abs(sum) / 2;
      var html = "<div class=\"row\"><span>Points</span><span>" + pts.length + "</span></div>" +
        "<div class=\"row\"><span>Area</span><span>" + fmt(area, 4) + " sq " + esc(unitLabel(unit)) + "</span></div>";
      if (unit === "us-ft") html += "<div class=\"row\"><span>Acres (43,560 sq US survey ft)</span><span>" + fmt(area / 43560, 4) + "</span></div>";
      else if (unit === "intl-ft") html += "<div class=\"row\"><span>Acres (43,560 sq international ft)</span><span>" + fmt(area / 43560, 4) + "</span></div>";
      else html += "<div class=\"row\"><span>Hectares</span><span>" + fmt(area / 10000, 4) + "</span></div>" +
        "<div class=\"row\"><span>Acres (1 ac = 4046.8564224 m², international)</span><span>" + fmt(area / 4046.8564224, 4) + "</span></div>";
      box.innerHTML = html;
    }
    $("arPts").addEventListener("input", run);
    $("arUnits").addEventListener("change", run);
  }

  function csfHtml() {
    return '<p class="hint">You enter the combined scale factor (CSF). This app does not assume one. Convention used here: <strong>Grid = Ground × CSF</strong>, so <strong>Ground = Grid ÷ CSF</strong>. That matches the Combined Factor reported by OPUS (typically slightly less than 1).</p><div class="card"><div class="grid g2">' +
      fld("csfVal", "Combined scale factor", { dec: true, ph: "e.g. 0.99993456" }) +
      fld("csfGrid", "Grid distance", { dec: true }) +
      fld("csfGnd", "Ground distance", { dec: true }) +
      "</div>" + resultBox('<p class="hint">Enter a CSF and one distance.</p>') + "</div>";
  }
  function bindCsf() {
    function run(from) {
      var csf = n($("csfVal").value);
      var grid = n($("csfGrid").value), gnd = n($("csfGnd").value);
      var box = $("toolResult");
      if (csf == null || csf === 0) { box.innerHTML = '<p class="hint">Enter a combined scale factor.</p>'; return; }
      if (from === "grid" && grid != null) {
        gnd = grid / csf;
        if (document.activeElement !== $("csfGnd")) $("csfGnd").value = fmt(gnd, 6);
      } else if (from === "gnd" && gnd != null) {
        grid = gnd * csf;
        if (document.activeElement !== $("csfGrid")) $("csfGrid").value = fmt(grid, 6);
      } else if (grid != null) {
        gnd = grid / csf;
      } else if (gnd != null) {
        grid = gnd * csf;
      } else { box.innerHTML = '<p class="hint">Enter a CSF and one distance.</p>'; return; }
      box.innerHTML = "<div class=\"row\"><span>Grid</span><span>" + fmt(grid, 6) + "</span></div>" +
        "<div class=\"row\"><span>Ground</span><span>" + fmt(gnd, 6) + "</span></div>" +
        "<div class=\"row\"><span>Area factor (CSF²)</span><span>" + fmt(csf * csf, 10) + "</span></div>";
    }
    $("csfVal").addEventListener("input", function () { run(); });
    $("csfGrid").addEventListener("input", function () { run("grid"); });
    $("csfGnd").addEventListener("input", function () { run("gnd"); });
  }

  function spcHtml() {
    var zopts = Object.keys(FNCrs.CA_ZONES).map(function (id) {
      var z = FNCrs.CA_ZONES[id];
      var cur = api && api.getCrs && api.getCrs().crsZone;
      return '<option value="' + id + '"' + (cur === id ? " selected" : "") + ">" + esc(z.label) + "</option>";
    }).join("");
    return '<p class="hint">NAD83 Lambert conformal conic, California Zones 1–6, with US survey feet or metres. Positions are on the GRS80 ellipsoid. No silent datum shift to WGS 84. Verified against published NGS datasheet PID GT1811 (WHITNEY, CA Zone 4).</p><div class="card"><div class="grid g2">' +
      fld("spZone", "Zone", { type: "select", options: zopts, span: true }) +
      fld("spUnits", "Grid units", { type: "select", options: unitOptions((api && api.getCrs && api.getCrs().crsUnits) || "m") }) +
      "</div><h3>Grid → lat/lon</h3><div class=\"grid g2\">" +
      fld("spN", "North", { dec: true }) + fld("spE", "East", { dec: true }) +
      "</div><h3>Lat/lon → grid</h3><div class=\"grid g2\">" +
      fld("spLat", "Latitude (decimal or DMS)", { ph: "e.g. 36.57858 or 36d34'42.89133\" N" }) +
      fld("spLon", "Longitude (decimal or DMS)", { ph: "e.g. -118.29199 or 118d17'31.18182\" W" }) +
      "</div>" + angleHint() + resultBox('<p class="hint">Enter either a grid pair or a lat/lon pair.</p>') + "</div>";
  }
  function bindSpc() {
    function fromGrid() {
      var N = n($("spN").value), E = n($("spE").value);
      if (N == null || E == null) return;
      try {
        var ll = FNCrs.gridToLonLat(E, N, $("spZone").value, $("spUnits").value);
        $("spLat").value = fmt(ll.lat, 10);
        $("spLon").value = fmt(ll.lon, 10);
        $("toolResult").innerHTML = "<div class=\"row\"><span>Latitude</span><span>" + fmt(ll.lat, 10) + " · " + esc(FNCrs.degToDms(ll.lat, "lat")) + "</span></div>" +
          "<div class=\"row\"><span>Longitude</span><span>" + fmt(ll.lon, 10) + " · " + esc(FNCrs.degToDms(ll.lon, "lon")) + "</span></div>";
      } catch (err) { $("toolResult").innerHTML = '<p class="hint">Could not convert: ' + esc(err.message || err) + "</p>"; }
    }
    function fromLl() {
      var lat = FNCrs.parseAngle($("spLat").value), lon = FNCrs.parseAngle($("spLon").value);
      if (lat == null || lon == null) return;
      try {
        var en = FNCrs.lonLatToGrid(lon, lat, $("spZone").value, $("spUnits").value);
        $("spN").value = fmt(en.n, 4);
        $("spE").value = fmt(en.e, 4);
        $("toolResult").innerHTML = "<div class=\"row\"><span>North</span><span>" + fmt(en.n, 4) + " " + esc(unitLabel($("spUnits").value)) + "</span></div>" +
          "<div class=\"row\"><span>East</span><span>" + fmt(en.e, 4) + " " + esc(unitLabel($("spUnits").value)) + "</span></div>";
      } catch (err) { $("toolResult").innerHTML = '<p class="hint">Could not convert: ' + esc(err.message || err) + "</p>"; }
    }
    ["spN","spE"].forEach(function (id) { $(id).addEventListener("change", fromGrid); $(id).addEventListener("blur", fromGrid); });
    ["spLat","spLon"].forEach(function (id) { $(id).addEventListener("change", fromLl); $(id).addEventListener("blur", fromLl); });
    $("spZone").addEventListener("change", function () { if (n($("spN").value) != null) fromGrid(); });
    $("spUnits").addEventListener("change", function () { if (n($("spN").value) != null) fromGrid(); });
  }

  var lastOpus = null;
  function opusHtml() {
    return '<p class="hint">Paste or load an NGS OPUS text report or XML (OPUS-S or OPUS-RS). Only fields that appear in the report are shown. Contributor email is removed and is never stored.</p><div class="card">' +
      fld("opusText", "OPUS report", { type: "textarea", rows: 8, span: true, ph: "Paste an NGS OPUS text report or XML…" }) +
      '<div class="actions" style="margin-top:0"><button type="button" class="btn" id="opusFile">Load .txt or .xml</button>' +
      '<button type="button" class="btn btn-primary" id="opusParse">Read report</button></div>' +
      '<input id="opusInput" class="hidden" type="file" accept=".txt,.xml,text/plain,application/xml,text/xml">' +
      '<div id="opusCard"></div></div>';
  }
  function bindOpus() {
    $("opusFile").onclick = function () { $("opusInput").click(); };
    $("opusInput").addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { $("opusText").value = String(r.result || ""); showOpus(); };  /* showOpus redacts email in the box */
      r.readAsText(f);
    });
    $("opusParse").onclick = showOpus;
    $("opusText").addEventListener("change", showOpus);
  }
  function showOpus() {
    if (!global.FNOpus) { toast("OPUS parser is not loaded"); return; }
    var raw = $("opusText").value;
    if (FNOpus.redactEmail) {
      var cleaned = FNOpus.redactEmail(raw);
      if (cleaned !== raw && $("opusText")) $("opusText").value = cleaned;
    }
    var sol = FNOpus.parse(raw);
    lastOpus = sol;
    var box = $("opusCard");
    if (!sol || !sol.ok) {
      box.innerHTML = '<p class="hint">' + esc(sol && sol.error || "Could not read that report.") + "</p>";
      return;
    }
    if (api && api.saveOpus) api.saveOpus(sol);
    var q = sol.quality || { rows: [], overall: "" };
    var flags = q.rows.map(function (r) {
      var cls = r.pass === true ? "pass" : (r.pass === false ? "fail" : "incomplete");
      return '<div class="opus-flag ' + cls + '"><strong>' + esc(r.label) + "</strong> " + esc(r.value) +
        (r.note ? '<span class="sub">' + esc(r.note) + "</span>" : "") + "</div>";
    }).join("");
    var rows = (FNOpus.summaryFields(sol) || []).map(function (f) {
      return "<div class=\"row\"><span>" + esc(f.label) + "</span><span>" + esc(f.value) + "</span></div>";
    }).join("");
    var html = '<div class="opus-summary"><div class="opus-kicker">' + esc(sol.kind) + " · " + esc(q.overall) + "</div>" +
      rows +
      '<div class="opus-flags">' + flags + "</div>" +
      '<p class="hint">' + esc(q.source) + " This is a field checklist, not a pass/fail of the survey.</p>" +
      '<div class="actions"><label class="fld" style="flex:1"><span>Point name for control</span>' +
      '<input id="opusPtName" type="text" placeholder="Point name" value="' + esc((sol.rinex || "").replace(/\.[^.]+$/, "")) + '"></label></div>' +
      '<div class="actions"><button type="button" class="btn btn-primary" id="opusAdd">Add to job control</button>' +
      '<button type="button" class="btn" id="opusCsv">Download CSV</button></div></div>';
    box.innerHTML = html;
    $("opusAdd").onclick = function () {
      if (!api || !api.addControl) { toast("Control list is not available"); return; }
      var name = ($("opusPtName") && $("opusPtName").value.trim()) || "";
      if (!name) { toast("Enter a point name first"); return; }
      var pt = FNOpus.toControlPoint(sol, name);
      if (!pt.lat && !pt.n) { toast("That report has no coordinates to add"); return; }
      api.addControl(pt);
      toast("Added " + name + " to job control");
    };
    $("opusCsv").onclick = function () {
      if (!api || !api.saveBlob) return;
      api.saveBlob(new Blob([FNOpus.toCsv(sol)], { type: "text/csv" }), "opus-solution.csv");
    };
  }

  function mount(home, screen, hooks) {
    homeEl = home;
    screenEl = screen;
    api = hooks || {};
    renderHome();
  }

  global.FNTools = { mount: mount, list: TOOLS, open: function (id) { openTool(id); }, renderHome: renderHome, parseAzimuth: parseAzimuth, parseSlope: parseSlope, solveGrade: solveGrade };
})(window);
