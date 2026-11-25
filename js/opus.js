/* OPUS-S / OPUS-RS text reports and NGS OPUS XML (schema 1.0).
   Namespace: https://www.ngs.noaa.gov/OPUS/schema/1.0
   Contributor email, if present in a report, is never shown, stored, or exported. */
(function (global) {
  "use strict";

  var USFT = 1200 / 3937; /* metres per US survey foot (exact) */
  var NS = "https://www.ngs.noaa.gov/OPUS/schema/1.0";

  function num(v) {
    if (v == null || v === "") return null;
    var n = Number(String(v).replace(/,/g, "").trim());
    return isFinite(n) ? n : null;
  }
  function mToUsft(m) { return m == null ? null : m / USFT; }
  function fmtM(m, d) { return m == null ? "" : Number(m).toFixed(d == null ? 3 : d); }
  function fmtFt(m, d) { return m == null ? "" : mToUsft(m).toFixed(d == null ? 3 : d); }
  function dmsToDeg(d, m, s, hemi) {
    var sign = 1;
    var H = String(hemi || "").toUpperCase();
    if (H === "S" || H === "W") sign = -1;
    var dd = Number(d), mm = Number(m) || 0, ss = Number(s) || 0;
    if (!isFinite(dd)) return null;
    if (dd < 0) { sign = -1; dd = Math.abs(dd); }
    return sign * (dd + mm / 60 + ss / 3600);
  }
  function degToDms(deg, kind) {
    if (deg == null || !isFinite(Number(deg))) return "";
    var x = Number(deg);
    var hemi = kind === "lon" ? (x >= 0 ? "E" : "W") : (x >= 0 ? "N" : "S");
    x = Math.abs(x);
    var d = Math.floor(x + 1e-12);
    var mFull = (x - d) * 60;
    var m = Math.floor(mFull + 1e-12);
    var sec = (mFull - m) * 60;
    if (sec >= 59.999995) { sec = 0; m += 1; }
    if (m >= 60) { m = 0; d += 1; }
    function pad(n, w) { return String(n).padStart(w, "0"); }
    return d + "° " + pad(m, 2) + "' " + sec.toFixed(5) + '" ' + hemi;
  }
  function eastLonToSigned(east) {
    if (east == null) return null;
    /* OPUS east longitude is 0–360. West-of-Greenwich values are > 180. */
    if (east > 180) return east - 360;
    return east;
  }
  function signedToWestDms(lon) {
    if (lon == null) return "";
    return degToDms(lon, "lon");
  }

  function redactEmail(s) {
    return String(s || "").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted]");
  }

  function parse(text) {
    text = String(text || "").replace(/^\uFEFF/, "");
    if (/<OPUS_SOLUTION\b/i.test(text) || /ngs\.noaa\.gov\/OPUS\/schema/i.test(text)) {
      return parseXml(text);
    }
    return parseText(text);
  }

  function elNS(root, name) {
    if (!root) return null;
    return root.getElementsByTagNameNS(NS, name)[0] || root.getElementsByTagName(name)[0] || null;
  }
  function allNS(root, name) {
    if (!root) return [];
    var a = root.getElementsByTagNameNS(NS, name);
    if (a && a.length) return Array.prototype.slice.call(a);
    return Array.prototype.slice.call(root.getElementsByTagName(name));
  }
  function tx(el) { return el ? String(el.textContent || "").trim() : ""; }
  function attr(el, name) { return el ? (el.getAttribute(name) || "") : ""; }
  function dmsFrom(el) {
    if (!el) return null;
    var d = tx(elNS(el, "DEGREES")), m = tx(elNS(el, "MINUTES")), s = tx(elNS(el, "SECONDS"));
    if (!d) return null;
    return { d: num(d), m: num(m), s: num(s), deg: dmsToDeg(d, m, s, "") };
  }

  function parseXml(text) {
    var doc;
    try { doc = new DOMParser().parseFromString(text, "application/xml"); }
    catch (e) { return { ok: false, error: "Could not parse that XML." }; }
    var err = doc.querySelector && doc.querySelector("parsererror");
    var root = doc.documentElement;
    if (!root || /parsererror/i.test(root.nodeName) || err) {
      return { ok: false, error: "That file is not readable OPUS XML." };
    }
    var obsTime = elNS(root, "OBSERVATION_TIME");
    var sources = elNS(root, "DATA_SOURCES");
    var eph = elNS(sources, "EPHEMERIS_FILE");
    var ant = elNS(sources, "ANTENNA");
    var dq = elNS(root, "DATA_QUALITY");
    var acc = elNS(dq, "ACCURACY");
    var obsEl = elNS(dq, "PERCENT_OBS_USED");
    var ambEl = elNS(dq, "PERCENT_AMB_FIXED");
    var rmsEl = elNS(dq, "RMS");
    var orthoEl = elNS(root, "ORTHO_HGT");

    function posBlock(pEl) {
      if (!pEl) return null;
      var frame = tx(elNS(pEl, "REF_FRAME"));
      var epoch = tx(elNS(pEl, "EPOCH"));
      var set = elNS(pEl, "COORD_SET");
      var ell = elNS(set, "ELLIP_COORD");
      var rec = elNS(set, "RECT_COORD");
      var lat = dmsFrom(elNS(ell, "LAT"));
      var east = dmsFrom(elNS(ell, "EAST_LONG"));
      var west = dmsFrom(elNS(ell, "WEST_LONG"));
      var eh = elNS(ell, "EL_HEIGHT");
      var xyz = { X: null, Y: null, Z: null, uX: null, uY: null, uZ: null };
      allNS(rec, "COORDINATE").forEach(function (c) {
        var axis = attr(c, "AXIS");
        xyz[axis] = num(tx(c));
        xyz["u" + axis] = num(attr(c, "UNCERTAINTY"));
      });
      var eastDeg = east && east.deg;
      var lon = west && west.deg != null ? dmsToDeg(west.d, west.m, west.s, "W") : eastLonToSigned(eastDeg);
      return {
        frame: frame,
        epoch: epoch,
        lat: lat,
        eastLon: east,
        westLon: west,
        lon: lon,
        ellipHtM: num(tx(eh)),
        xyz: xyz
      };
    }

    var positions = allNS(root, "POSITION").map(posBlock).filter(Boolean);
    var nad = positions.filter(function (p) { return /NAD_?83/i.test(p.frame || ""); })[0] || positions[0] || null;
    var oth = positions.filter(function (p) { return !/NAD_?83/i.test(p.frame || ""); })[0] || null;
    if (oth === nad) oth = positions[1] || null;

    function plane(type) {
      var specs = allNS(root, "PLANE_COORD_SPEC");
      var hit = specs.filter(function (s) { return (attr(s, "TYPE") || "").toUpperCase() === type; })[0];
      if (!hit) return null;
      return {
        zone: attr(hit, "ZONE"),
        n: num(tx(elNS(hit, "NORTHING"))),
        e: num(tx(elNS(hit, "EASTING"))),
        convergence: num(tx(elNS(hit, "CONVERGENCE"))),
        scale: num(tx(elNS(hit, "SCALE"))),
        csf: num(tx(elNS(hit, "CF")))
      };
    }

    var bases = allNS(root, "BASE_STATION_USED").map(function (b) {
      return {
        pid: tx(elNS(b, "PID")),
        id: tx(elNS(b, "STATION_ID")),
        designation: tx(elNS(b, "DESIGNATION")),
        distance: num(tx(elNS(b, "DISTANCE")))
      };
    }).filter(function (b) { return b.id || b.pid; });

    var ephType = attr(eph, "TYPE") || "";
    var ephFile = tx(eph);
    var sol = {
      ok: true,
      kind: "OPUS-S",
      format: "xml",
      sourceNote: "Parsed from NGS OPUS XML (schema 1.0). Only fields found in the report are shown.",
      date: tx(elNS(root, "SOLUTION_TIME")),
      rinex: tx(elNS(sources, "RINEX_FILE")),
      start: attr(obsTime, "START"),
      stop: attr(obsTime, "END"),
      antenna: tx(elNS(ant, "NAME")),
      arpHeight: tx(elNS(ant, "ARP_HEIGHT")),
      arpHeightM: num(tx(elNS(ant, "ARP_HEIGHT"))),
      ephemeris: ephFile,
      ephemerisType: ephType,
      navFile: tx(elNS(sources, "NAV_FILE")),
      software: [attr(elNS(root, "SOFTWARE_VERSION"), "PAGES"), attr(elNS(root, "SOFTWARE_VERSION"), "OPUS")].filter(Boolean).join(" · "),
      refFrame: {
        raw: nad ? (nad.frame + (nad.epoch ? "(EPOCH:" + nad.epoch + ")" : "")) : "",
        nad83Frame: nad ? nad.frame : "",
        nad83Epoch: nad ? nad.epoch : "",
        otherFrame: oth ? oth.frame : "",
        otherEpoch: oth ? oth.epoch : ""
      },
      positions: positions,
      nad83: nad,
      other: oth,
      obsUsed: obsEl ? {
        used: num(attr(obsEl, "USED")),
        total: num(attr(obsEl, "TOTAL")),
        percent: num(tx(obsEl))
      } : null,
      fixedAmb: ambEl ? {
        used: num(attr(ambEl, "FIXED")),
        total: num(attr(ambEl, "TOTAL")),
        percent: num(tx(ambEl))
      } : null,
      qualityInd: null,
      rmsM: rmsEl ? num(tx(rmsEl)) : null,
      rmsRaw: rmsEl ? (tx(rmsEl) + " " + (attr(rmsEl, "UNIT") || "m")) : "",
      lat: nad && nad.lat ? { nad83: { deg: nad.lat.deg, dms: [nad.lat.d, nad.lat.m, nad.lat.s].join(" "), errM: acc ? num(tx(elNS(acc, "LAT"))) : null }, other: oth && oth.lat ? { deg: oth.lat.deg, dms: [oth.lat.d, oth.lat.m, oth.lat.s].join(" "), errM: null } : null } : null,
      westLon: nad && nad.lon != null ? { nad83: { deg: Math.abs(nad.lon), signed: nad.lon, dms: signedToWestDms(nad.lon), errM: acc ? num(tx(elNS(acc, "LONG"))) : null }, other: oth && oth.lon != null ? { deg: Math.abs(oth.lon), signed: oth.lon, dms: signedToWestDms(oth.lon), errM: null } : null } : null,
      eastLon: nad && nad.eastLon ? { nad83: { deg: nad.eastLon.deg, dms: [nad.eastLon.d, nad.eastLon.m, nad.eastLon.s].join(" ") }, other: oth && oth.eastLon ? { deg: oth.eastLon.deg, dms: [oth.eastLon.d, oth.eastLon.m, oth.eastLon.s].join(" ") } : null } : null,
      ellipHt: nad ? { nad83: { valueM: nad.ellipHtM, errM: acc ? num(tx(elNS(acc, "EL_HEIGHT"))) : null }, other: oth ? { valueM: oth.ellipHtM, errM: null } : null } : null,
      ortho: orthoEl ? {
        valueM: num(tx(orthoEl)),
        errM: num(attr(orthoEl, "UNCERTAINTY")),
        rawModel: attr(orthoEl, "SOURCE"),
        datum: (attr(orthoEl, "SOURCE").match(/^[A-Z0-9]+/) || [""])[0],
        geoid: ((attr(orthoEl, "SOURCE").match(/using\s+([^)]+)/i) || [])[1] || "").trim()
      } : null,
      grid: (function () {
        var utm = plane("UTM") || {};
        var spc = plane("SPC") || {};
        return {
          utmZone: utm.zone || "",
          spcZone: spc.zone || "",
          utmN: utm.n, utmE: utm.e, utmConvergence: utm.convergence, utmPointScale: utm.scale, utmCSF: utm.csf,
          spcN: spc.n, spcE: spc.e, spcConvergence: spc.convergence, spcPointScale: spc.scale, spcCSF: spc.csf
        };
      })(),
      usng: tx(elNS(root, "USNG")),
      bases: bases
    };
    sol.quality = flags(sol);
    return sol;
  }

  /* ---------- text report (emailed .txt) ---------- */
  function afterLabel(text, label) {
    var re = new RegExp(label + "\\s*:?\\s*(\\S[^\\n]*)", "i");
    var m = text.match(re);
    if (!m) return "";
    /* Official NGS text reports put two fields on one line, separated by a wide gap. */
    var v = m[1].split(/\s{2,}(?=(?:#\s*)?[A-Z][A-Z0-9]*(?:[ /][A-Z0-9]+)*:)/)[0];
    return v.replace(/\s+/g, " ").trim();
  }
  function parseFrac(text, label) {
    var re = new RegExp(label + "\\s*:?\\s*([0-9,]+)\\s*/\\s*([0-9,]+)\\s*:?\\s*([0-9.]+)\\s*%", "i");
    var m = text.match(re);
    if (!m) return null;
    return { used: num(m[1]), total: num(m[2]), percent: num(m[3]) };
  }
  function parsePairLine(label, text) {
    var re = new RegExp(label + "\\s*:?\\s*(.+)$", "im");
    var m = text.match(re);
    if (!m) return null;
    var rest = m[1], vals = [], pairRe = /([+-]?\d+(?:\.\d+)?)\s*\(\s*m\s*\)\s+([+-]?\d+(?:\.\d+)?)\s*\(\s*m\s*\)/gi, p;
    while ((p = pairRe.exec(rest))) vals.push({ valueM: num(p[1]), errM: num(p[2]) });
    if (!vals.length) {
      var one = rest.match(/([+-]?\d+(?:\.\d+)?)\s*\(\s*m\s*\)(?:\s+([+-]?\d+(?:\.\d+)?)\s*\(\s*m\s*\))?/i);
      if (one) vals.push({ valueM: num(one[1]), errM: one[2] != null ? num(one[2]) : null });
    }
    return vals.length ? { nad83: vals[0] || null, other: vals[1] || null, raw: rest.trim() } : { raw: rest.trim() };
  }
  function parseLatLonLine(label, text, kind) {
    var re = new RegExp(label + "\\s*:?\\s*(.+)$", "im");
    var m = text.match(re);
    if (!m) return null;
    var rest = m[1], recs = [];
    var gRe = /([NSEW])?\s*(\d{1,3})\s+(\d{1,2})\s+(\d+(?:\.\d+)?)\s*([NSEW])?\s+([+-]?\d+(?:\.\d+)?)\s*\(\s*m\s*\)/gi, g;
    while ((g = gRe.exec(rest))) {
      recs.push({
        deg: dmsToDeg(g[2], g[3], g[4], g[1] || g[5] || (kind === "lon" && /W/.test(label) ? "W" : "")),
        dms: [g[2], g[3], g[4]].join(" "),
        errM: num(g[6])
      });
    }
    if (kind === "lon" && recs[0] && recs[0].deg != null && /W/.test(label)) recs.forEach(function (r) { r.signed = -Math.abs(r.deg); });
    return recs.length ? { nad83: recs[0] || null, other: recs[1] || null, raw: rest.trim() } : { raw: rest.trim() };
  }
  function parseRefFrame(text) {
    var m = text.match(/REF\s*FRAME\s*:?\s*([^\n]+)/i);
    if (!m) return { raw: "" };
    var line = m[1].replace(/\s+/g, " ").trim();
    var nad = line.match(/(NAD_?83(?:\([^)]+\))?)\s*\(\s*EPOCH\s*:?\s*([0-9.]+)\s*\)/i);
    var oth = line.match(/((?:ITRF|IGS)[0-9.]+)\s*\(\s*EPOCH\s*:?\s*([0-9.]+)\s*\)/i);
    return {
      raw: line,
      nad83Frame: nad ? nad[1] : "",
      nad83Epoch: nad ? nad[2] : "",
      otherFrame: oth ? oth[1] : "",
      otherEpoch: oth ? oth[2] : ""
    };
  }
  function parseOrtho(text) {
    var m = text.match(/ORTHO\s*HGT\s*:?\s*([+-]?\d+(?:\.\d+)?)\s*\(\s*m\s*\)\s*(?:([+-]?\d+(?:\.\d+)?)\s*\(\s*m\s*\))?\s*(?:\[([^\]]+)\])?/i);
    if (!m) return null;
    var model = (m[3] || "").trim();
    var dm = model.match(/([A-Z0-9]+)\s*(?:\(Computed using\s*([^)]+)\))?/i) || [];
    return { valueM: num(m[1]), errM: m[2] != null ? num(m[2]) : null, rawModel: model, datum: dm[1] || "", geoid: (dm[2] || "").trim() };
  }
  function parseGridBlock(text) {
    var utmZone = (text.match(/UTM\s*\(\s*Zone\s*([^)]+)\)/i) || [])[1] || "";
    var spc = (text.match(/SPC\s*\(\s*([^)]+)\)/i) || [])[1] || "";
    function row(label) {
      var re = new RegExp(label + "[^\\n]*?\\n?[^\\d+-]*([+-]?\\d+(?:\\.\\d+)?)\\s+([+-]?\\d+(?:\\.\\d+)?)", "i");
      var m = text.match(re);
      return m ? { utm: num(m[1]), spc: num(m[2]) } : null;
    }
    var n = row("Northing"), e = row("Easting"), c = row("Convergence"), ps = row("Point Scale"), cf = row("Combined Factor");
    return {
      utmZone: utmZone.trim(), spcZone: String(spc).trim(),
      utmN: n && n.utm, utmE: e && e.utm, utmConvergence: c && c.utm, utmPointScale: ps && ps.utm, utmCSF: cf && cf.utm,
      spcN: n && n.spc, spcE: e && e.spc, spcConvergence: c && c.spc, spcPointScale: ps && ps.spc, spcCSF: cf && cf.spc
    };
  }

  function parseText(text) {
    var kind = /OPUS\s*-?\s*RS|RAPID\s*-?\s*STATIC/i.test(text) ? "OPUS-RS" : (/OPUS/i.test(text) ? "OPUS-S" : "");
    if (!kind && !/REF\s*FRAME|OBS\s*USED|ORTHO\s*HGT/i.test(text)) {
      return { ok: false, error: "That text does not look like an NGS OPUS report." };
    }
    if (!kind) kind = "OPUS";
    var ref = parseRefFrame(text);
    var eph = afterLabel(text, "EPHEMERIS");
    var ephType = "";
    var em = eph.match(/\[([^\]]+)\]/);
    if (em) ephType = em[1];
    if (/ultra\s*-?\s*rapid/i.test(eph)) ephType = ephType || "ultra-rapid";
    var rms = text.match(/OVERALL(?:\s+PHASE)?\s+RMS\s*:?\s*([0-9.]+)\s*(?:\(\s*m\s*\))?/i);
    var qInd = text.match(/QUALITY\s*IND(?:ICATOR|\.)?\s*:?\s*([0-9.]+)\s*(?:\/\s*([0-9.]+))?/i);
    var lat = parseLatLonLine("LAT", text, "lat");
    var wlon = parseLatLonLine("W\\s*LON", text, "lon") || parseLatLonLine("W LON", text, "lon");
    var elon = parseLatLonLine("E\\s*LON", text, "lon") || parseLatLonLine("E LON", text, "lon");
    var elh = parsePairLine("EL\\s*HGT", text) || parsePairLine("EL HGT", text);
    var sol = {
      ok: true, kind: kind, format: "text",
      sourceNote: "Parsed from pasted or loaded OPUS text. Only fields found in the report are shown.",
      date: afterLabel(text, "DATE"), rinex: afterLabel(text, "RINEX FILE"),
      start: afterLabel(text, "START"), stop: afterLabel(text, "STOP"),
      antenna: afterLabel(text, "ANT NAME"), arpHeight: afterLabel(text, "ARP HEIGHT"),
      arpHeightM: num(afterLabel(text, "ARP HEIGHT")),
      ephemeris: eph, ephemerisType: ephType, navFile: afterLabel(text, "NAV FILE"),
      refFrame: ref,
      nad83: null, other: null, positions: [],
      obsUsed: parseFrac(text, "OBS\\s*USED") || parseFrac(text, "OBS USED"),
      fixedAmb: parseFrac(text, "#?\\s*FIXED\\s*AMB") || parseFrac(text, "FIXED AMB"),
      qualityInd: qInd ? { network: num(qInd[1]), rover: qInd[2] != null ? num(qInd[2]) : null } : null,
      rmsM: rms ? num(rms[1]) : null, rmsRaw: rms ? rms[0] : "",
      lat: lat, westLon: wlon, eastLon: elon, ellipHt: elh,
      ortho: parseOrtho(text), grid: parseGridBlock(text),
      usng: afterLabel(text, "US NATIONAL GRID DESIGNATOR"),
      bases: []
    };
    sol.quality = flags(sol);
    return sol;
  }

  /* Quality flags requested for field use:
     obs used < 90%; ambiguities fixed < 50%; peak-to-peak > 5 cm;
     ultra-rapid ephemeris — suggest a rerun with rapid or precise. */
  function flags(sol) {
    var rows = [];
    function add(id, label, value, pass, note) {
      rows.push({ id: id, label: label, value: value, pass: pass, note: note || "" });
    }
    var ephT = String(sol.ephemerisType || sol.ephemeris || "");
    if (/ultra\s*-?\s*rapid/i.test(ephT) || /^igu/i.test(sol.ephemeris || "")) {
      add("eph", "Ephemeris", (sol.ephemerisType || "ultra-rapid") + (sol.ephemeris ? " · " + sol.ephemeris : ""), false,
        "Ultra-rapid orbit was used. Rerun OPUS when a rapid or precise ephemeris is available.");
    } else if (sol.ephemeris || sol.ephemerisType) {
      add("eph", "Ephemeris", [sol.ephemerisType, sol.ephemeris].filter(Boolean).join(" · "), true, "");
    }

    var obs = sol.obsUsed && sol.obsUsed.percent;
    if (obs != null) add("obs", "% observations used", obs.toFixed(0) + "%", obs >= 90, "Flag when under 90%");
    else add("obs", "% observations used", "not in report", null, "");

    if (sol.kind === "OPUS-RS" && sol.qualityInd) {
      add("qind", "OPUS-RS quality indicators",
        [sol.qualityInd.network, sol.qualityInd.rover].filter(function (x) { return x != null; }).join(" / "),
        null, "Rapid-static quality indicators as reported.");
    } else {
      var amb = sol.fixedAmb && sol.fixedAmb.percent;
      if (amb != null) add("amb", "% ambiguities fixed", amb.toFixed(0) + "%", amb >= 50, "Flag when under 50%");
      else add("amb", "% ambiguities fixed", "not in report", null, "");
    }

    if (sol.rmsM != null) {
      add("rms", "Overall RMS", sol.rmsM + " m (" + fmtFt(sol.rmsM, 3) + " US ft)", null, "");
    }

    function pp(id, label, errM) {
      if (errM == null) add(id, label, "not in report", null, "");
      else add(id, label, fmtM(errM, 3) + " m (" + fmtFt(errM, 3) + " US ft)", errM <= 0.05, "Flag when peak-to-peak is over 5 cm");
    }
    var latErr = sol.lat && sol.lat.nad83 && sol.lat.nad83.errM;
    var lonErr = (sol.westLon && sol.westLon.nad83 && sol.westLon.nad83.errM) ||
      (sol.eastLon && sol.eastLon.nad83 && sol.eastLon.nad83.errM);
    var hErr = sol.ellipHt && sol.ellipHt.nad83 && sol.ellipHt.nad83.errM;
    pp("latpp", "Lat peak-to-peak", latErr);
    pp("lonpp", "Lon peak-to-peak", lonErr);
    pp("hpp", "Ellipsoid height peak-to-peak", hErr);

    var failed = rows.filter(function (r) { return r.pass === false; }).length;
    var passed = rows.filter(function (r) { return r.pass === true; }).length;
    var overall = failed ? "flags to review" : (passed ? "no flags" : "incomplete");
    return { rows: rows, failed: failed, passed: passed, overall: overall, source: "Field flags: obs used < 90%, ambiguities fixed < 50%, peak-to-peak > 5 cm; warn on ultra-rapid ephemeris." };
  }

  function nad83LatLon(sol) {
    var lat = sol.lat && sol.lat.nad83 && sol.lat.nad83.deg;
    var lon = null;
    if (sol.westLon && sol.westLon.nad83) {
      lon = sol.westLon.nad83.signed != null ? sol.westLon.nad83.signed : (sol.westLon.nad83.deg != null ? -Math.abs(sol.westLon.nad83.deg) : null);
    }
    if (lon == null && sol.eastLon && sol.eastLon.nad83 && sol.eastLon.nad83.deg != null) {
      lon = eastLonToSigned(sol.eastLon.nad83.deg);
    }
    if (lat == null && sol.nad83 && sol.nad83.lat) lat = sol.nad83.lat.deg;
    if (lon == null && sol.nad83 && sol.nad83.lon != null) lon = sol.nad83.lon;
    if (lat == null || lon == null) return null;
    return { lat: lat, lon: lon };
  }

  function toControlPoint(sol, name) {
    var ll = nad83LatLon(sol);
    var z = "", zKind = "";
    if (sol.ortho && sol.ortho.valueM != null) {
      z = String(sol.ortho.valueM);
      zKind = "ortho m " + [sol.ortho.datum, sol.ortho.geoid].filter(Boolean).join(" ");
    } else if (sol.ellipHt && sol.ellipHt.nad83 && sol.ellipHt.nad83.valueM != null) {
      z = String(sol.ellipHt.nad83.valueM);
      zKind = "ellipsoid m";
    }
    var desc = [sol.kind, sol.refFrame && sol.refFrame.nad83Frame, sol.refFrame && sol.refFrame.nad83Epoch ? "epoch " + sol.refFrame.nad83Epoch : "", zKind, sol.rinex].filter(Boolean).join(" · ");
    return {
      name: name || "",
      n: sol.grid && sol.grid.spcN != null ? String(sol.grid.spcN) : "",
      e: sol.grid && sol.grid.spcE != null ? String(sol.grid.spcE) : "",
      z: z, desc: desc,
      lat: ll ? String(ll.lat) : "", lon: ll ? String(ll.lon) : "",
      sourceFile: "OPUS", importedFrom: sol.kind,
      refFrame: (sol.refFrame && sol.refFrame.nad83Frame) || "",
      epoch: (sol.refFrame && sol.refFrame.nad83Epoch) || "",
      spcZone: (sol.grid && sol.grid.spcZone) || "",
      csf: sol.grid && sol.grid.spcCSF != null ? String(sol.grid.spcCSF) : "",
      units: "m",
      zKind: zKind
    };
  }

  function toCsv(sol) {
    var ll = nad83LatLon(sol) || {};
    var oll = sol.other && sol.other.lat ? { lat: sol.other.lat.deg, lon: sol.other.lon } : {};
    var rows = [
      ["field", "value"],
      ["kind", sol.kind || ""],
      ["format", sol.format || ""],
      ["rinex", sol.rinex || ""],
      ["start", sol.start || ""],
      ["stop", sol.stop || ""],
      ["antenna", sol.antenna || ""],
      ["arp_height_m", sol.arpHeightM != null ? String(sol.arpHeightM) : (sol.arpHeight || "")],
      ["ephemeris", sol.ephemeris || ""],
      ["ephemeris_type", sol.ephemerisType || ""],
      ["ref_frame", (sol.refFrame && sol.refFrame.nad83Frame) || ""],
      ["epoch", (sol.refFrame && sol.refFrame.nad83Epoch) || ""],
      ["other_frame", (sol.refFrame && sol.refFrame.otherFrame) || ""],
      ["other_epoch", (sol.refFrame && sol.refFrame.otherEpoch) || ""],
      ["lat_nad83_deg", ll.lat != null ? String(ll.lat) : ""],
      ["lon_nad83_deg", ll.lon != null ? String(ll.lon) : ""],
      ["lat_err_m", sol.lat && sol.lat.nad83 && sol.lat.nad83.errM != null ? String(sol.lat.nad83.errM) : ""],
      ["lon_err_m", sol.westLon && sol.westLon.nad83 && sol.westLon.nad83.errM != null ? String(sol.westLon.nad83.errM) : ""],
      ["ellip_ht_m", sol.ellipHt && sol.ellipHt.nad83 && sol.ellipHt.nad83.valueM != null ? String(sol.ellipHt.nad83.valueM) : ""],
      ["ellip_ht_usft", sol.ellipHt && sol.ellipHt.nad83 && sol.ellipHt.nad83.valueM != null ? String(mToUsft(sol.ellipHt.nad83.valueM)) : ""],
      ["ellip_ht_err_m", sol.ellipHt && sol.ellipHt.nad83 && sol.ellipHt.nad83.errM != null ? String(sol.ellipHt.nad83.errM) : ""],
      ["ortho_ht_m", sol.ortho && sol.ortho.valueM != null ? String(sol.ortho.valueM) : ""],
      ["ortho_ht_usft", sol.ortho && sol.ortho.valueM != null ? String(mToUsft(sol.ortho.valueM)) : ""],
      ["ortho_err_m", sol.ortho && sol.ortho.errM != null ? String(sol.ortho.errM) : ""],
      ["ortho_datum", (sol.ortho && sol.ortho.datum) || ""],
      ["geoid", (sol.ortho && sol.ortho.geoid) || ""],
      ["spc_zone", (sol.grid && sol.grid.spcZone) || ""],
      ["spc_n_m", sol.grid && sol.grid.spcN != null ? String(sol.grid.spcN) : ""],
      ["spc_e_m", sol.grid && sol.grid.spcE != null ? String(sol.grid.spcE) : ""],
      ["spc_n_usft", sol.grid && sol.grid.spcN != null ? String(mToUsft(sol.grid.spcN)) : ""],
      ["spc_e_usft", sol.grid && sol.grid.spcE != null ? String(mToUsft(sol.grid.spcE)) : ""],
      ["spc_csf", sol.grid && sol.grid.spcCSF != null ? String(sol.grid.spcCSF) : ""],
      ["spc_conv_deg", sol.grid && sol.grid.spcConvergence != null ? String(sol.grid.spcConvergence) : ""],
      ["utm_zone", (sol.grid && sol.grid.utmZone) || ""],
      ["utm_n_m", sol.grid && sol.grid.utmN != null ? String(sol.grid.utmN) : ""],
      ["utm_e_m", sol.grid && sol.grid.utmE != null ? String(sol.grid.utmE) : ""],
      ["obs_used_pct", sol.obsUsed && sol.obsUsed.percent != null ? String(sol.obsUsed.percent) : ""],
      ["fixed_amb_pct", sol.fixedAmb && sol.fixedAmb.percent != null ? String(sol.fixedAmb.percent) : ""],
      ["overall_rms_m", sol.rmsM != null ? String(sol.rmsM) : ""],
      ["bases", (sol.bases || []).map(function (b) { return b.id; }).join(" ")]
    ];
    return rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? "" : c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\n");
  }

  function toText(sol) {
    var ll = nad83LatLon(sol) || {};
    var lines = [];
    function line(lab, val) { if (val) lines.push(lab + ": " + val); }
    line("Kind", sol.kind);
    line("RINEX", sol.rinex);
    line("Session", [sol.start, sol.stop].filter(Boolean).join(" to "));
    line("Antenna", [sol.antenna, sol.arpHeightM != null ? "ARP " + sol.arpHeightM + " m" : sol.arpHeight].filter(Boolean).join(" · "));
    line("Ephemeris", [sol.ephemerisType, sol.ephemeris].filter(Boolean).join(" · "));
    line("REF FRAME", sol.refFrame && [sol.refFrame.nad83Frame, sol.refFrame.nad83Epoch ? "epoch " + sol.refFrame.nad83Epoch : ""].filter(Boolean).join(" "));
    line("Other frame", sol.refFrame && [sol.refFrame.otherFrame, sol.refFrame.otherEpoch ? "epoch " + sol.refFrame.otherEpoch : ""].filter(Boolean).join(" "));
    if (ll.lat != null) line("NAD83 lat", fmtM(ll.lat, 10) + "  " + degToDms(ll.lat, "lat"));
    if (ll.lon != null) line("NAD83 lon", fmtM(ll.lon, 10) + "  " + degToDms(ll.lon, "lon"));
    if (sol.other && sol.other.lat) line("ITRF lat", fmtM(sol.other.lat.deg, 10) + "  " + degToDms(sol.other.lat.deg, "lat"));
    if (sol.other && sol.other.lon != null) line("ITRF lon", fmtM(sol.other.lon, 10) + "  " + degToDms(sol.other.lon, "lon"));
    if (sol.ellipHt && sol.ellipHt.nad83 && sol.ellipHt.nad83.valueM != null) {
      line("Ellipsoid ht", fmtM(sol.ellipHt.nad83.valueM, 3) + " m  (" + fmtFt(sol.ellipHt.nad83.valueM, 3) + " US ft)" + (sol.ellipHt.nad83.errM != null ? "  ± " + sol.ellipHt.nad83.errM + " m" : ""));
    }
    if (sol.ortho && sol.ortho.valueM != null) {
      line("Ortho ht", fmtM(sol.ortho.valueM, 3) + " m  (" + fmtFt(sol.ortho.valueM, 3) + " US ft)  " + (sol.ortho.rawModel || "") + (sol.ortho.errM != null ? "  unc " + sol.ortho.errM + " m" : ""));
    }
    if (sol.grid && sol.grid.spcZone) {
      line("SPC", sol.grid.spcZone + "  N " + sol.grid.spcN + " m (" + fmtFt(sol.grid.spcN, 3) + " US ft)  E " + sol.grid.spcE + " m (" + fmtFt(sol.grid.spcE, 3) + " US ft)  CSF " + sol.grid.spcCSF + "  conv " + sol.grid.spcConvergence);
    }
    if (sol.grid && sol.grid.utmZone) {
      line("UTM", "Zone " + sol.grid.utmZone + "  N " + sol.grid.utmN + " m  E " + sol.grid.utmE + " m");
    }
    if (sol.obsUsed) line("Obs used", sol.obsUsed.percent + "%");
    if (sol.fixedAmb) line("Amb fixed", sol.fixedAmb.percent + "%");
    if (sol.rmsM != null) line("RMS", sol.rmsM + " m");
    if (sol.bases && sol.bases.length) line("Bases", sol.bases.map(function (b) { return b.id; }).join(", "));
    if (sol.quality) {
      lines.push("Flags: " + sol.quality.overall);
      (sol.quality.rows || []).forEach(function (r) {
        if (r.pass === false) lines.push("  FLAG  " + r.label + "  " + r.value + (r.note ? "  — " + r.note : ""));
      });
    }
    return lines.join("\n");
  }

  function mFt(m, d) {
    if (m == null) return "";
    return fmtM(m, d == null ? 3 : d) + " m  (" + fmtFt(m, d == null ? 3 : d) + " US survey ft)";
  }

  function summaryFields(sol) {
    var ll = nad83LatLon(sol) || {};
    var out = [];
    function add(lab, val) { if (val) out.push({ label: lab, value: String(val) }); }
    add("Kind", sol.kind);
    add("REF FRAME", sol.refFrame && [sol.refFrame.nad83Frame, sol.refFrame.nad83Epoch ? "epoch " + sol.refFrame.nad83Epoch : ""].filter(Boolean).join(" "));
    add("Other frame", sol.refFrame && [sol.refFrame.otherFrame, sol.refFrame.otherEpoch ? "epoch " + sol.refFrame.otherEpoch : ""].filter(Boolean).join(" "));
    add("Session", [sol.start, sol.stop].filter(Boolean).join(" → "));
    add("Antenna", [sol.antenna, sol.arpHeightM != null ? "ARP " + sol.arpHeightM + " m (" + fmtFt(sol.arpHeightM, 3) + " US ft)" : sol.arpHeight].filter(Boolean).join(" · "));
    add("Ephemeris", [sol.ephemerisType, sol.ephemeris].filter(Boolean).join(" · "));
    if (ll.lat != null) add("NAD83 latitude", fmtM(ll.lat, 10) + "  ·  " + degToDms(ll.lat, "lat"));
    if (ll.lon != null) add("NAD83 longitude", fmtM(ll.lon, 10) + "  ·  " + degToDms(ll.lon, "lon"));
    if (sol.eastLon && sol.eastLon.nad83 && sol.eastLon.nad83.deg != null) add("NAD83 east longitude", fmtM(sol.eastLon.nad83.deg, 10) + "  ·  " + degToDms(sol.eastLon.nad83.deg, "lon"));
    if (sol.other && sol.other.lat) add((sol.refFrame.otherFrame || "ITRF") + " latitude", fmtM(sol.other.lat.deg, 10) + "  ·  " + degToDms(sol.other.lat.deg, "lat"));
    if (sol.other && sol.other.lon != null) add((sol.refFrame.otherFrame || "ITRF") + " longitude", fmtM(sol.other.lon, 10) + "  ·  " + degToDms(sol.other.lon, "lon"));
    if (sol.ellipHt && sol.ellipHt.nad83 && sol.ellipHt.nad83.valueM != null) {
      add("Ellipsoid height (NAD83)", mFt(sol.ellipHt.nad83.valueM) + (sol.ellipHt.nad83.errM != null ? "  ± " + mFt(sol.ellipHt.nad83.errM) : ""));
    }
    if (sol.other && sol.other.ellipHtM != null) add("Ellipsoid height (other frame)", mFt(sol.other.ellipHtM));
    if (sol.ortho && sol.ortho.valueM != null) {
      add("Ortho height", mFt(sol.ortho.valueM) + (sol.ortho.rawModel ? "  ·  " + sol.ortho.rawModel : "") + (sol.ortho.errM != null ? "  unc " + mFt(sol.ortho.errM) : ""));
    }
    if (sol.grid && sol.grid.spcZone) {
      add("State plane", "SPC " + sol.grid.spcZone +
        (sol.grid.spcN != null ? "  N " + mFt(sol.grid.spcN) : "") +
        (sol.grid.spcE != null ? "  E " + mFt(sol.grid.spcE) : "") +
        (sol.grid.spcCSF != null ? "  CSF " + sol.grid.spcCSF : "") +
        (sol.grid.spcConvergence != null ? "  conv " + sol.grid.spcConvergence + "°" : ""));
    }
    if (sol.grid && sol.grid.utmZone) {
      add("UTM", "Zone " + sol.grid.utmZone +
        (sol.grid.utmN != null ? "  N " + mFt(sol.grid.utmN) : "") +
        (sol.grid.utmE != null ? "  E " + mFt(sol.grid.utmE) : ""));
    }
    if (sol.obsUsed) add("Obs used", (sol.obsUsed.used != null ? sol.obsUsed.used + " / " + sol.obsUsed.total + " · " : "") + sol.obsUsed.percent + "%");
    if (sol.fixedAmb) add("Fixed ambiguities", (sol.fixedAmb.used != null ? sol.fixedAmb.used + " / " + sol.fixedAmb.total + " · " : "") + sol.fixedAmb.percent + "%");
    if (sol.rmsM != null) add("Overall RMS", mFt(sol.rmsM, 3));
    if (sol.bases && sol.bases.length) add("Base stations", sol.bases.map(function (b) { return b.id + (b.distance != null ? " (" + Math.round(b.distance) + " m)" : ""); }).join(", "));
    return out;
  }

  function safeSummary(sol) {
    /* Strip any email that might have been in raw text fields. */
    var copy = JSON.parse(redactEmail(JSON.stringify(sol)));
    if (copy && copy.contributor) delete copy.contributor;
    return copy;
  }

  global.FNOpus = {
    parse: parse,
    flags: flags,
    nad83LatLon: nad83LatLon,
    toControlPoint: toControlPoint,
    toCsv: toCsv,
    toText: toText,
    summaryFields: summaryFields,
    safeSummary: safeSummary,
    mToUsft: mToUsft,
    degToDms: degToDms,
    eastLonToSigned: eastLonToSigned,
    redactEmail: redactEmail
  };
})(window);
