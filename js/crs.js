/* Coordinate systems for grid-to-geographic conversion.
   CA State Plane NAD83 zone parameters from EPSG:
     26941–26946 (metres) and 2225–2230 (US survey feet).
   Verification uses published NGS datasheet values (not fabricated):
     PID GT1811 WHITNEY, NAD 83(1992) 36°34'42.89133"N 118°17'31.18182"W,
     SPC CA 4 N 638,407.861 m, E 2,063,362.492 m
     https://www.ngs.noaa.gov/cgi-bin/ds_mark.prl?PidBox=GT1811
   KML is a WGS84 context; NAD83 geographic is plotted as-is and the
   job CRS/datum/epoch is written into the description. No silent datum shift.
*/
(function (global) {
  "use strict";

  var USFT = 1200 / 3937; /* metres per US survey foot (exact) */
  var GRS80_GEOG = "+proj=longlat +ellps=GRS80 +no_defs";

  /* Lambert conformal conic 2SP, NAD83 / GRS80, false E/N in metres */
  var CA_ZONES = {
    CA_ZONE_1: { label: "CA State Plane Zone 1 (NAD83)", epsgM: 26941, epsgFt: 2225,
      lat0: 39.3333333333333, lon0: -122, sp1: 41.6666666666667, sp2: 40, fe: 2000000, fn: 500000 },
    CA_ZONE_2: { label: "CA State Plane Zone 2 (NAD83)", epsgM: 26942, epsgFt: 2226,
      lat0: 37.6666666666667, lon0: -122, sp1: 39.8333333333333, sp2: 38.3333333333333, fe: 2000000, fn: 500000 },
    CA_ZONE_3: { label: "CA State Plane Zone 3 (NAD83)", epsgM: 26943, epsgFt: 2227,
      lat0: 36.5, lon0: -120.5, sp1: 38.4333333333333, sp2: 37.0666666666667, fe: 2000000, fn: 500000 },
    CA_ZONE_4: { label: "CA State Plane Zone 4 (NAD83)", epsgM: 26944, epsgFt: 2228,
      lat0: 35.3333333333333, lon0: -119, sp1: 37.25, sp2: 36, fe: 2000000, fn: 500000 },
    CA_ZONE_5: { label: "CA State Plane Zone 5 (NAD83)", epsgM: 26945, epsgFt: 2229,
      lat0: 33.5, lon0: -118, sp1: 35.4666666666667, sp2: 34.0333333333333, fe: 2000000, fn: 500000 },
    CA_ZONE_6: { label: "CA State Plane Zone 6 (NAD83)", epsgM: 26946, epsgFt: 2230,
      lat0: 32.1666666666667, lon0: -116.25, sp1: 33.8833333333333, sp2: 32.7833333333333, fe: 2000000, fn: 500000 }
  };

  function lccDef(z, units) {
    var x0 = z.fe, y0 = z.fn, unit = "m";
    if (units === "us-ft") { x0 = z.fe / USFT; y0 = z.fn / USFT; unit = "us-ft"; }
    else if (units === "intl-ft") { x0 = z.fe / 0.3048; y0 = z.fn / 0.3048; unit = "ft"; }
    return "+proj=lcc +lat_1=" + z.sp1 + " +lat_2=" + z.sp2 +
      " +lat_0=" + z.lat0 + " +lon_0=" + z.lon0 +
      " +x_0=" + x0 + " +y_0=" + y0 +
      " +ellps=GRS80 +units=" + unit + " +no_defs";
  }

  function zoneOptions() {
    var out = [];
    Object.keys(CA_ZONES).forEach(function (id) {
      out.push({ id: id, label: CA_ZONES[id].label });
    });
    var z, h;
    for (z = 1; z <= 60; z++) {
      for (h = 0; h < 2; h++) {
        var ns = h ? "S" : "N";
        out.push({ id: "UTM_" + z + ns, label: "UTM Zone " + z + ns + " (NAD83/WGS84 ellipsoid)" });
      }
    }
    out.push({ id: "GEOGRAPHIC", label: "Geographic (lat/long already — no grid conversion)" });
    return out;
  }

  function projDef(zoneId, units) {
    if (!zoneId) return null;
    if (zoneId === "GEOGRAPHIC") return null;
    if (CA_ZONES[zoneId]) return lccDef(CA_ZONES[zoneId], units || "m");
    var m = /^UTM_(\d+)([NS])$/.exec(zoneId);
    if (m) {
      var def = "+proj=utm +zone=" + m[1] + " +ellps=GRS80 +units=m +no_defs";
      if (m[2] === "S") def += " +south";
      return def;
    }
    return null;
  }

  function toMetersEastNorth(e, n, units) {
    /* 1 US survey foot = 1200/3937 m */
    if (units === "us-ft") return { e: e * USFT, n: n * USFT };
    if (units === "intl-ft") return { e: e * 0.3048, n: n * 0.3048 };
    return { e: e, n: n };
  }

  function gridToLonLat(east, north, zoneId, units) {
    if (zoneId === "GEOGRAPHIC") {
      return { lon: east, lat: north, skipped: true };
    }
    if (typeof proj4 !== "function") throw new Error("proj4 is not loaded");
    var def = projDef(zoneId, "m"); /* convert to metres first, then use metre definition */
    if (!def) throw new Error("No projection for " + zoneId);
    var en = toMetersEastNorth(Number(east), Number(north), units || "m");
    /* proj4(from, to, [easting, northing]) → [lon, lat] */
    var ll = proj4(def, GRS80_GEOG, [en.e, en.n]);
    return { lon: ll[0], lat: ll[1] };
  }

  function lonLatToGrid(lon, lat, zoneId, units) {
    if (zoneId === "GEOGRAPHIC") {
      return { e: Number(lon), n: Number(lat), skipped: true };
    }
    if (typeof proj4 !== "function") throw new Error("proj4 is not loaded");
    var def = projDef(zoneId, "m");
    if (!def) throw new Error("No projection for " + zoneId);
    var en = proj4(GRS80_GEOG, def, [Number(lon), Number(lat)]);
    var e = en[0], n = en[1];
    if (units === "us-ft") return { e: e / USFT, n: n / USFT };
    if (units === "intl-ft") return { e: e / 0.3048, n: n / 0.3048 };
    return { e: e, n: n };
  }

  function dmsToDeg(d, m, s, hemi) {
    var sign = 1;
    var H = String(hemi || "").toUpperCase();
    if (H === "S" || H === "W" || Number(d) < 0) sign = -1;
    var deg = Math.abs(Number(d) || 0) + (Number(m) || 0) / 60 + (Number(s) || 0) / 3600;
    return sign * deg;
  }

  function degToDms(deg, kind) {
    if (deg == null || isNaN(Number(deg))) return "";
    var x = Number(deg);
    var hemi = kind === "lon" ? (x >= 0 ? "E" : "W") : (x >= 0 ? "N" : "S");
    x = Math.abs(x);
    var d = Math.floor(x + 1e-12);
    var mFull = (x - d) * 60;
    var m = Math.floor(mFull + 1e-12);
    var s = (mFull - m) * 60;
    if (s >= 59.9995) { s = 0; m += 1; }
    if (m >= 60) { m = 0; d += 1; }
    function pad(n, w) { return String(n).padStart(w, "0"); }
    return d + "° " + pad(m, 2) + "' " + s.toFixed(5) + '" ' + hemi;
  }

  function parseAngle(text) {
    var t = String(text || "").trim();
    if (!t) return null;
    /* decimal degrees, optional hemisphere */
    var dec = t.match(/^\s*([+-]?\d+(?:\.\d+)?)\s*([NSEW])?\s*$/i);
    if (dec) {
      var v = Number(dec[1]);
      var H = (dec[2] || "").toUpperCase();
      if (H === "S" || H === "W") v = -Math.abs(v);
      if (H === "N" || H === "E") v = Math.abs(v);
      return v;
    }
    var dms = t.match(/([NSEW])?\s*([+-]?\d+(?:\.\d+)?)\s*[°d\s]+\s*(\d+(?:\.\d+)?)?\s*['′m]?\s*(\d+(?:\.\d+)?)?\s*[\"″s]?\s*([NSEW])?/i);
    if (dms) {
      return dmsToDeg(dms[2], dms[3], dms[4], dms[1] || dms[5]);
    }
    return null;
  }

  function isComplete(crs) {
    if (!crs) return false;
    return !!(crs.crsZone && crs.crsEpoch && crs.crsEpochConfirmed && crs.crsVertical);
  }

  function missingList(crs) {
    crs = crs || {};
    var miss = [];
    if (!crs.crsZone) miss.push("projection / zone");
    if (!crs.crsEpoch) miss.push("epoch");
    if (!crs.crsEpochConfirmed) miss.push("epoch confirmation");
    if (!crs.crsVertical) miss.push("vertical datum");
    return miss;
  }

  function formatLine(crs) {
    if (!crs) return "Coordinate system not set";
    var parts = [];
    if (crs.crsZone) {
      var opt = zoneOptions().filter(function (z) { return z.id === crs.crsZone; })[0];
      parts.push(opt ? opt.label : crs.crsZone);
    }
    if (crs.crsEpoch) parts.push("epoch " + crs.crsEpoch + (crs.crsEpochConfirmed ? " (confirmed)" : " (unconfirmed)"));
    var units = crs.crsUnits || "us-ft";
    if (units === "intl-ft") parts.push("international ft");
    else if (units === "m") parts.push("metres");
    else parts.push("US survey ft");
    if (crs.crsVertical) parts.push(crs.crsVertical);
    if (crs.crsGeoid) parts.push(crs.crsGeoid);
    if (crs.crsScaleOne) parts.push("scale factor 1 (grid = ground)");
    else if (crs.crsScaleFactor) parts.push("CSF " + crs.crsScaleFactor);
    return parts.length ? parts.join(", ") : "Coordinate system not set";
  }

  /* Published NGS check (GT1811). Call FNCrs.verifyNgsGt1811() in a console or test. */
  function verifyNgsGt1811() {
    var pubLat = 36 + 34 / 60 + 42.89133 / 3600;
    var pubLon = -(118 + 17 / 60 + 31.18182 / 3600);
    var got = gridToLonLat(2063362.492, 638407.861, "CA_ZONE_4", "m");
    var dLatM = (got.lat - pubLat) * (Math.PI / 180) * 6378137;
    var dLonM = (got.lon - pubLon) * (Math.PI / 180) * 6378137 * Math.cos(pubLat * Math.PI / 180);
    return {
      source: "NGS datasheet PID GT1811 WHITNEY, NAD 83(1992), SPC CA 4 metres",
      url: "https://www.ngs.noaa.gov/cgi-bin/ds_mark.prl?PidBox=GT1811",
      published: { lat: pubLat, lon: pubLon, n: 638407.861, e: 2063362.492 },
      computed: got,
      residualMetersApprox: { dN: dLatM, dE: dLonM, horiz: Math.sqrt(dLatM * dLatM + dLonM * dLonM) }
    };
  }

  global.FNCrs = {
    USFT: USFT,
    GRS80_GEOG: GRS80_GEOG,
    zoneOptions: zoneOptions,
    projDef: projDef,
    gridToLonLat: gridToLonLat,
    lonLatToGrid: lonLatToGrid,
    dmsToDeg: dmsToDeg,
    degToDms: degToDms,
    parseAngle: parseAngle,
    isComplete: isComplete,
    missingList: missingList,
    formatLine: formatLine,
    verifyNgsGt1811: verifyNgsGt1811,
    CA_ZONES: CA_ZONES
  };
})(window);
