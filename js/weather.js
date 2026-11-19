/* Automatic weather via Open-Meteo (free, no API key).
   https://open-meteo.com/en/docs — current_weather + WMO WW codes.
   Never invent a value if the fetch or GPS fails; leave the field for manual entry.
*/
(function (global) {
  "use strict";

  /* WMO Weather interpretation codes (WW), as documented by Open-Meteo. */
  var WMO = {
    0: "Clear",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Light rain showers",
    81: "Rain showers",
    82: "Heavy rain showers",
    85: "Light snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with heavy hail"
  };

  function codeText(code) {
    if (code === 0) return "Sunny"; /* brief field-book wording for clear sky */
    return WMO[code] || ("Weather code " + code);
  }

  function describe(cw, units) {
    units = units || "F";
    var temp = cw.temperature;
    var unit = units === "C" ? "°C" : "°F";
    var parts = [codeText(cw.weathercode) + ", " + Math.round(Number(temp)) + unit];
    if (cw.windspeed != null && cw.windspeed !== "" && Number(cw.windspeed) >= 1) {
      var wu = units === "C" ? "km/h" : "mph";
      parts.push("wind " + Math.round(Number(cw.windspeed)) + " " + wu);
    }
    return parts.join(", ");
  }

  function fetchCurrent(lat, lon, units) {
    units = units || "F";
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + encodeURIComponent(lat) +
      "&longitude=" + encodeURIComponent(lon) +
      "&current_weather=true" +
      (units === "C"
        ? "&temperature_unit=celsius&windspeed_unit=kmh"
        : "&temperature_unit=fahrenheit&windspeed_unit=mph");
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("Weather request failed (" + res.status + ")");
      return res.json();
    }).then(function (data) {
      if (!data || !data.current_weather) throw new Error("No current weather in the response");
      var cw = data.current_weather;
      return {
        text: describe(cw, units),
        temperature: cw.temperature,
        windspeed: cw.windspeed,
        winddirection: cw.winddirection,
        weathercode: cw.weathercode,
        apiTime: cw.time,
        fetchedAt: new Date().toISOString(),
        source: "Open-Meteo",
        lat: lat,
        lon: lon,
        units: units
      };
    });
  }

  /* Temperature, optional pressure (hPa) and humidity. Never invent values on failure. */
  function fetchConditions(lat, lon, units) {
    units = units || "F";
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + encodeURIComponent(lat) +
      "&longitude=" + encodeURIComponent(lon) +
      "&current=temperature_2m,relative_humidity_2m,pressure_msl,weather_code" +
      (units === "C" ? "&temperature_unit=celsius" : "&temperature_unit=fahrenheit");
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("Weather request failed (" + res.status + ")");
      return res.json();
    }).then(function (data) {
      var cur = data && data.current;
      if (!cur || cur.temperature_2m == null || cur.temperature_2m === "") {
        throw new Error("No current conditions in the response");
      }
      return {
        temperature: cur.temperature_2m,
        humidity: cur.relative_humidity_2m,
        pressure: cur.pressure_msl,
        weathercode: cur.weather_code,
        apiTime: cur.time,
        fetchedAt: new Date().toISOString(),
        source: "Open-Meteo",
        lat: lat,
        lon: lon,
        units: units,
        tempUnit: units === "C" ? "°C" : "°F",
        pressureUnit: "hPa",
        humidityUnit: "%"
      };
    });
  }

  global.FNWeather = {
    codeText: codeText,
    describe: describe,
    fetchCurrent: fetchCurrent,
    fetchConditions: fetchConditions
  };
})(window);
