/* Minimal PDF 1.4 writer for field reports: text, tables, and JPEG images. */
(function (global) {
  "use strict";

  var PAGE_W = 612, PAGE_H = 792, MARGIN = 40, LINE = 13, TITLE = 16;

  function esc(s) {
    return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }
  function toWinAnsi(s) {
    return String(s == null ? "" : s)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2013|\u2014/g, "-")
      .replace(/\u00B0/g, " deg ")
      .replace(/\u00B1/g, "+/-")
      .replace(/\u2192/g, "->")
      .replace(/\u00B7/g, " - ")
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
  }
  function jpegSize(u8) {
    var i = 0;
    if (u8[0] !== 0xFF || u8[1] !== 0xD8) return null;
    i = 2;
    while (i < u8.length - 1) {
      if (u8[i] !== 0xFF) { i++; continue; }
      var marker = u8[i + 1];
      if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
        return { h: (u8[i + 5] << 8) | u8[i + 6], w: (u8[i + 7] << 8) | u8[i + 8] };
      }
      if (marker === 0xD9 || marker === 0xDA) break;
      var len = (u8[i + 2] << 8) | u8[i + 3];
      i += 2 + len;
    }
    return null;
  }

  function Doc(title) {
    this.title = title || "Field Notes";
    this.pages = [];
    this._startPage();
  }
  Doc.prototype._startPage = function () {
    this.ops = [];
    this.images = [];
    this.y = PAGE_H - MARGIN;
    this.pages.push({ ops: this.ops, images: this.images });
  };
  Doc.prototype.newPage = function () {
    this._startPage();
    return this;
  };
  Doc.prototype._need = function (h) {
    if (this.y - h < MARGIN) this.newPage();
  };
  Doc.prototype._font = function (bold, size) {
    this.ops.push("BT /F" + (bold ? "B" : "R") + " " + size + " Tf ET");
  };
  Doc.prototype._textAt = function (x, y, text, bold, size) {
    this.ops.push("BT /F" + (bold ? "B" : "R") + " " + size + " Tf 1 0 0 1 " + x.toFixed(2) + " " + y.toFixed(2) + " Tm (" + esc(toWinAnsi(text)) + ") Tj ET");
  };
  Doc.prototype.heading = function (text) {
    this._need(TITLE + 8);
    this.y -= TITLE;
    this._textAt(MARGIN, this.y, text, true, TITLE);
    this.y -= 8;
    return this;
  };
  Doc.prototype.para = function (text, bold) {
    var max = 90;
    var words = toWinAnsi(text).split(/\s+/);
    var line = "";
    var self = this;
    function flush() {
      if (!line) return;
      self._need(LINE);
      self.y -= LINE;
      self._textAt(MARGIN, self.y, line, !!bold, 10);
      line = "";
    }
    words.forEach(function (w) {
      var next = line ? line + " " + w : w;
      if (next.length > max) { flush(); line = w; } else line = next;
    });
    flush();
    return this;
  };
  Doc.prototype.gap = function (n) { this.y -= n || 6; return this; };
  Doc.prototype.table = function (rows) {
    if (!rows || !rows.length) return this;
    var cols = rows[0].length;
    var usable = PAGE_W - MARGIN * 2;
    var cw = usable / cols;
    rows.forEach(function (row, ri) {
      this._need(LINE + 2);
      this.y -= LINE + 1;
      for (var c = 0; c < cols; c++) {
        var cell = toWinAnsi(row[c] == null ? "" : row[c]);
        if (cell.length > Math.floor(cw / 5.4)) cell = cell.slice(0, Math.max(4, Math.floor(cw / 5.4) - 1)) + ".";
        this._textAt(MARGIN + c * cw, this.y, cell, ri === 0, 8);
      }
    }, this);
    this.y -= 4;
    return this;
  };
  Doc.prototype.imageJpeg = function (bytes, maxW) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var dim = jpegSize(u8);
    if (!dim) return this;
    maxW = maxW || (PAGE_W - MARGIN * 2);
    var w = dim.w, h = dim.h;
    var scale = Math.min(maxW / w, 320 / h, 1);
    var dw = w * scale, dh = h * scale;
    this._need(dh + 8);
    this.y -= dh;
    var name = "Im" + (this.images.length + 1);
    this.images.push({ name: name, w: w, h: h, bytes: u8 });
    this.ops.push("q " + dw.toFixed(2) + " 0 0 " + dh.toFixed(2) + " " + MARGIN.toFixed(2) + " " + this.y.toFixed(2) + " cm /" + name + " Do Q");
    this.y -= 8;
    return this;
  };
  Doc.prototype.blob = function () {
    var objs = [];
    function add(str, bin) {
      objs.push({ str: str, bin: bin || null });
      return objs.length;
    }
    var fontR = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    var fontB = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    var pageIds = [];
    var imgIds = [];
    this.pages.forEach(function (pg) {
      pg.images.forEach(function (im) {
        var id = add(
          "<< /Type /XObject /Subtype /Image /Width " + im.w + " /Height " + im.h +
          " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + im.bytes.length + " >>\nstream\n",
          im.bytes
        );
        /* close stream after binary */
        objs[id - 1].after = "\nendstream";
        im._id = id;
        imgIds.push(im);
      });
      var stream = pg.ops.join("\n");
      var content = add("<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream");
      var xobjs = pg.images.map(function (im) { return "/" + im.name + " " + im._id + " 0 R"; }).join(" ");
      var res = "<< /Font << /FR " + fontR + " 0 R /FB " + fontB + " 0 R >>" +
        (xobjs ? " /XObject << " + xobjs + " >>" : "") + " >>";
      var page = add("<< /Type /Page /Parent PAGES 0 R /MediaBox [0 0 " + PAGE_W + " " + PAGE_H + "] /Contents " + content + " 0 R /Resources " + res + " >>");
      pageIds.push(page);
    });
    var kids = pageIds.map(function (id) { return id + " 0 R"; }).join(" ");
    var pagesId = add("<< /Type /Pages /Count " + pageIds.length + " /Kids [" + kids + "] >>");
    objs.forEach(function (o) {
      if (o.str && o.str.indexOf("/Parent PAGES 0 R") >= 0) {
        o.str = o.str.replace("/Parent PAGES 0 R", "/Parent " + pagesId + " 0 R");
      }
    });
    var info = add("<< /Title (" + esc(toWinAnsi(this.title)) + ") /Producer (Field Notes) >>");
    var catalog = add("<< /Type /Catalog /Pages " + pagesId + " 0 R >>");

    var encoder = new TextEncoder();
    var chunks = [];
    var offset = 0;
    function pushStr(s) {
      var b = encoder.encode(s);
      chunks.push(b);
      offset += b.length;
    }
    function pushU8(u8) {
      chunks.push(u8);
      offset += u8.length;
    }
    pushStr("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");
    var xref = [0];
    objs.forEach(function (o, i) {
      xref[i + 1] = offset;
      pushStr((i + 1) + " 0 obj\n");
      pushStr(o.str);
      if (o.bin) pushU8(o.bin);
      if (o.after) pushStr(o.after);
      pushStr("\nendobj\n");
    });
    var xrefStart = offset;
    pushStr("xref\n0 " + (objs.length + 1) + "\n");
    pushStr("0000000000 65535 f \n");
    for (var i = 1; i <= objs.length; i++) {
      pushStr(String(xref[i]).padStart(10, "0") + " 00000 n \n");
    }
    pushStr("trailer << /Size " + (objs.length + 1) + " /Root " + catalog + " 0 R /Info " + info + " 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF");
    var total = chunks.reduce(function (n, c) { return n + c.length; }, 0);
    var out = new Uint8Array(total), p = 0;
    chunks.forEach(function (c) { out.set(c, p); p += c.length; });
    return new Blob([out], { type: "application/pdf" });
  };

  function fromDataUrl(dataUrl) {
    var m = String(dataUrl || "").match(/^data:image\/jpeg;base64,(.+)$/i);
    if (!m) return null;
    var bin = atob(m[1]), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  global.FNPdf = { Doc: Doc, jpegSize: jpegSize, fromDataUrl: fromDataUrl };
})(window);
