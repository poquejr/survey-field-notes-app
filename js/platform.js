/* Platform adapter — web APIs today, Capacitor plugins later.
   When wrapping: if (window.Capacitor && Capacitor.isNativePlatform())
   swap getLocation / saveBlob / printHtml to plugin calls. Do not add CDNs. */
(function (global) {
  "use strict";

  function isNative() {
    try {
      return !!(global.Capacitor && typeof global.Capacitor.isNativePlatform === "function" && global.Capacitor.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  function getLocation(options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not available"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: (pos.coords.heading != null && isFinite(pos.coords.heading) && pos.coords.heading >= 0) ? pos.coords.heading : null,
            altitude: pos.coords.altitude,
            ts: pos.timestamp
          });
        },
        function (err) { reject(err); },
        {
          enableHighAccuracy: options.enableHighAccuracy !== false,
          timeout: options.timeout || 15000,
          maximumAge: options.maximumAge || 0
        }
      );
    });
  }

  function saveBlob(blob, filename) {
    return new Promise(function (resolve, reject) {
      try {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(url);
          a.remove();
          resolve();
        }, 500);
      } catch (e) {
        reject(e);
      }
    });
  }

  function printHtml(html) {
    return new Promise(function (resolve, reject) {
      var w = window.open("", "_blank");
      if (!w) {
        reject(new Error("Popup blocked"));
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      resolve(w);
    });
  }

  function watchLocation(onPos, onErr, options) {
    options = options || {};
    if (!navigator.geolocation) {
      if (onErr) onErr(new Error("Geolocation is not available"));
      return function () {};
    }
    var id = navigator.geolocation.watchPosition(
      function (pos) {
        onPos({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: (pos.coords.heading != null && isFinite(pos.coords.heading) && pos.coords.heading >= 0) ? pos.coords.heading : null,
          altitude: pos.coords.altitude,
          ts: pos.timestamp
        });
      },
      function (err) { if (onErr) onErr(err); },
      {
        enableHighAccuracy: options.enableHighAccuracy !== false,
        timeout: options.timeout || 20000,
        maximumAge: options.maximumAge != null ? options.maximumAge : 1000
      }
    );
    return function () { navigator.geolocation.clearWatch(id); };
  }

  global.FNPlatform = {
    isNative: isNative,
    getLocation: getLocation,
    watchLocation: watchLocation,
    saveBlob: saveBlob,
    printHtml: printHtml
  };
})(window);
