/* Trimble JobXML (.jxl) parser.
   Element and attribute names are taken from the official JobXML schema
   JobXMLSchema-6.27.xsd:
     https://ww2.trimble.com/schema/JobXML/6_2/JobXMLSchema-6.27.xsd
   Native Trimble .job is proprietary binary and is not parsed.
*/
(function (global) {
  "use strict";

  function text(el, name) {
    if (!el) return "";
    var n = name ? el.getElementsByTagName(name)[0] : el;
    if (!n) return "";
    return (n.textContent || "").trim();
  }
  function attr(el, name) {
    return el && el.getAttribute ? (el.getAttribute(name) || "") : "";
  }
  function kids(parent, name) {
    if (!parent) return [];
    return Array.prototype.slice.call(parent.getElementsByTagName(name));
  }
  function first(parent, name) {
    if (!parent) return null;
    return parent.getElementsByTagName(name)[0] || null;
  }
  function gridOf(el, tag) {
    var g = first(el, tag);
    if (!g) return null;
    var n = text(g, "North"), e = text(g, "East"), z = text(g, "Elevation");
    if (!n && !e && !z) return null;
    return { n: n, e: e, z: z };
  }

  function parse(xmlString, fileName) {
    var doc = new DOMParser().parseFromString(xmlString, "application/xml");
    var err = doc.querySelector("parsererror");
    if (err) throw new Error("This file is not valid XML.");
    var job = doc.getElementsByTagName("JOBFile")[0];
    if (!job) throw new Error("No JOBFile root element. This is not a JobXML (.jxl) file.");

    var header = {
      jobName: attr(job, "jobName"),
      version: attr(job, "version"),
      product: attr(job, "product"),
      productVersion: attr(job, "productVersion"),
      timeStamp: attr(job, "TimeStamp"),
      controllerSerialNumber: attr(job, "controllerSerialNumber"),
      fileName: fileName || ""
    };

    var env = first(job, "Environment");
    var cs = env ? first(env, "CoordinateSystem") : null;
    var coordinateSystem = null;
    if (cs) {
      coordinateSystem = {
        systemName: text(cs, "SystemName"),
        zoneName: text(cs, "ZoneName"),
        datumName: text(cs, "DatumName")
      };
    }

    var instruments = {};
    var atmospheres = {};
    var targets = {};
    var antennas = {};
    var gpsEquip = {};
    var stations = {};
    var events = [];
    var points = [];
    var reductions = [];

    function pushEvent(type, ts, fields, extra) {
      events.push(Object.assign({ type: type, ts: ts || header.timeStamp, fields: fields, importedFrom: "JXL", sourceFile: fileName || "" }, extra || {}));
    }

    var fb = first(job, "FieldBook");
    if (fb) {
      Array.prototype.forEach.call(fb.childNodes, function (node) {
        if (!node || node.nodeType !== 1) return;
        var tag = node.tagName;
        var ts = attr(node, "TimeStamp");
        var id = attr(node, "ID");

        if (tag === "InstrumentRecord") {
          instruments[id] = {
            type: text(node, "Type"),
            model: text(node, "Model"),
            serial: text(node, "Serial"),
            firmware: text(node, "FirmwareVersion")
          };
        } else if (tag === "AtmosphereRecord") {
          atmospheres[id] = {
            pressure: text(node, "Pressure"),
            temperature: text(node, "Temperature"),
            ppm: text(node, "PPM")
          };
        } else if (tag === "TargetRecord") {
          targets[id] = {
            targetHeight: text(node, "TargetHeight"),
            rawTargetHeight: text(node, "RawTargetHeight"),
            prismType: text(node, "PrismType"),
            prismConstant: text(node, "PrismConstant")
          };
        } else if (tag === "GPSEquipmentRecord") {
          gpsEquip[id] = {
            receiverType: text(node, "ReceiverType"),
            receiverSerial: text(node, "ReceiverSerialNumber"),
            antennaType: text(node, "AntennaType"),
            antennaSerial: text(node, "AntennaSerialNumber"),
            antennaMeasurementMethod: text(node, "AntennaMeasurementMethod"),
            antennaMethod: text(node, "AntennaMethod")
          };
        } else if (tag === "AntennaRecord") {
          antennas[id] = {
            measuredHeight: text(node, "MeasuredHeight"),
            measurementType: text(node, "MeasurementType"),
            gpsEquipmentID: text(node, "GPSEquipmentID"),
            reducedHeight: text(node, "ReducedHeight")
          };
        } else if (tag === "StationRecord") {
          var rec = {
            stationName: text(node, "StationName"),
            theodoliteHeight: text(node, "TheodoliteHeight"),
            rawTheodoliteHeight: text(node, "RawTheodoliteHeight"),
            instrumentID: text(node, "InstrumentID"),
            atmosphereID: text(node, "AtmosphereID"),
            method: text(node, "Method"),
            stationType: text(node, "StationType"),
            notes: text(node, "Notes")
          };
          stations[id] = rec;
          var inst = instruments[rec.instrumentID] || {};
          var atmo = atmospheres[rec.atmosphereID] || {};
          pushEvent("ts_setup", ts, {
            occ: rec.stationName,
            hi1: rec.theodoliteHeight,
            hiMethod: rec.rawTheodoliteHeight,
            stationType: rec.stationType,
            instMake: inst.model || inst.type || "",
            instSN: inst.serial || "",
            temp: atmo.temperature,
            pressure: atmo.pressure,
            ppm: atmo.ppm,
            notes: rec.notes,
            unitsNote: "JobXML stores instrument/target heights and distances in metres, temperatures in °C, pressure in hPa.",
            importedFrom: "JXL"
          });
        } else if (tag === "BackBearingRecord") {
          pushEvent("bs_check", ts, {
            occ: text(node, "Station"),
            bs: text(node, "BackSight"),
            face1HA: text(node, "Face1HorizontalCircle"),
            face2HA: text(node, "Face2HorizontalCircle"),
            orientationCorrection: text(node, "OrientationCorrection"),
            notes: text(node, "Notes"),
            importedFrom: "JXL"
          });
        } else if (tag === "ReferenceRecord") {
          var ant = antennas[text(node, "AntennaID")] || {};
          var eq = gpsEquip[ant.gpsEquipmentID] || {};
          pushEvent("gnss_base", ts, {
            basePt: text(node, "PointName"),
            measuredHeight: ant.measuredHeight,
            heightMethod: ant.measurementType,
            reducedHeight: ant.reducedHeight,
            receiver: eq.receiverType,
            receiverSN: eq.receiverSerial,
            antennaType: eq.antennaType,
            antennaSN: eq.antennaSerial,
            antennaMeasurementMethod: eq.antennaMeasurementMethod,
            notes: text(node, "Notes"),
            unitsNote: "JobXML antenna/target/instrument heights are in metres.",
            importedFrom: "JXL"
          });
        } else if (tag === "NTRIPDataSourceRecord") {
          pushEvent("note", ts, {
            kind: "NTRIP",
            text: "NTRIP mount point " + text(node, "MountPoint"),
            mountPoint: text(node, "MountPoint"),
            dataFormat: text(node, "DataFormat"),
            importedFrom: "JXL"
          });
        } else if (tag === "PointRecord") {
          if (text(node, "Deleted") === "true") return;
          var cg = gridOf(node, "ComputedGrid") || gridOf(node, "Grid");
          var circle = first(node, "Circle");
          var wgs = first(node, "WGS84");
          var lat = wgs ? text(wgs, "Latitude") : "";
          var lon = wgs ? text(wgs, "Longitude") : "";
          var pt = {
            pt: text(node, "Name"),
            code: text(node, "Code"),
            desc: [text(node, "Description1"), text(node, "Description2")].filter(Boolean).join(" "),
            method: text(node, "Method"),
            surveyMethod: text(node, "SurveyMethod"),
            classification: text(node, "Classification"),
            n: cg ? cg.n : "",
            e: cg ? cg.e : "",
            z: cg ? cg.z : "",
            ha: circle ? text(circle, "HorizontalCircle") : "",
            va: circle ? text(circle, "VerticalCircle") : "",
            sd: circle ? text(circle, "EDMDistance") : "",
            lat: lat,
            lon: lon,
            importedFrom: "JXL"
          };
          points.push(pt);
          var cls = (pt.classification || "").toLowerCase();
          var type = "point_log";
          if (cls === "backsight" || cls === "check") type = "bs_check";
          pushEvent(type, ts, pt);
        } else if (tag === "NoteRecord") {
          pushEvent("note", ts, { text: text(node, "Note") || text(node) || "", importedFrom: "JXL" });
        } else if (tag === "JobPropertiesRecord") {
          header.operator = header.operator || text(node, "Operator");
          header.description = header.description || text(node, "Description");
          header.jobNote = header.jobNote || text(node, "JobNote");
        }
      });
    }

    var red = first(job, "Reductions");
    if (red) {
      kids(red, "Point").forEach(function (p) {
        var g = gridOf(p, "Grid") || gridOf(p, "ComputedGrid") || gridOf(p, "WGS84") || null;
        /* WGS84 in reductions uses Latitude/Longitude — handle if Grid absent */
        var wgs = first(p, "WGS84");
        reductions.push({
          pt: text(p, "Name") || attr(p, "Name"),
          code: text(p, "Code"),
          n: g ? g.n : "",
          e: g ? g.e : "",
          z: g ? g.z : "",
          lat: wgs ? text(wgs, "Latitude") : "",
          lon: wgs ? text(wgs, "Longitude") : "",
          importedFrom: "JXL"
        });
      });
    }

    return {
      header: header,
      coordinateSystem: coordinateSystem,
      events: events,
      points: points,
      reductions: reductions,
      instruments: instruments,
      notes: "JobXML numeric units per schema: metres, decimal degrees, °C, hPa."
    };
  }

  function isBinaryJobName(name) {
    return /\.job$/i.test(name || "");
  }

  global.FNJxl = {
    parse: parse,
    isBinaryJobName: isBinaryJobName,
    JOB_MESSAGE: "Native Trimble .job files are a proprietary binary format and are not opened in this app. Export JobXML (.jxl) from Trimble Access or Trimble Business Center, then import the .jxl file."
  };
})(window);
