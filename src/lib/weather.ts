export type WeatherData = {
  temp: number;
  condition: string;
  conditionCode: number;
  windSpeed: number;
  humidity: number;
  isOutdoorSafe: boolean;
  courtRecommendation: string;
  source: "Open-Meteo API (Live)" | "Cached" | "Fallback";
};

/**
 * WMO Weather interpretation codes (WW)
 */
function interpretWeatherCode(code: number): { condition: string; outdoorSafe: boolean } {
  if (code === 0) return { condition: "Clear sky", outdoorSafe: true };
  if (code === 1 || code === 2 || code === 3)
    return { condition: "Partly cloudy", outdoorSafe: true };
  if (code >= 45 && code <= 48) return { condition: "Foggy", outdoorSafe: true };
  if (code >= 51 && code <= 55) return { condition: "Light drizzle", outdoorSafe: false };
  if (code >= 61 && code <= 65) return { condition: "Rain", outdoorSafe: false };
  if (code >= 71 && code <= 77) return { condition: "Snow / Sleet", outdoorSafe: false };
  if (code >= 80 && code <= 82) return { condition: "Rain showers", outdoorSafe: false };
  if (code >= 95 && code <= 99) return { condition: "Thunderstorm", outdoorSafe: false };
  return { condition: "Overcast", outdoorSafe: true };
}

/**
 * Fetches real-time weather and outdoor pitch safety recommendations from Open-Meteo.
 * Free, non-commercial, zero-API-key open science weather API.
 */
export async function fetchCourtWeather(lat: number, lng: number): Promise<WeatherData> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Weather service returned ${res.status}`);
    }
    const data = await res.json();
    const current = data.current;
    const temp = Math.round(current.temperature_2m);
    const humidity = Math.round(current.relative_humidity_2m);
    const windSpeed = Math.round(current.wind_speed_10m);
    const code = current.weather_code;
    const { condition, outdoorSafe } = interpretWeatherCode(code);

    const isHighWind = windSpeed > 40;
    const isExtremeHeat = temp > 38;
    const isExtremeCold = temp < 2;

    const safe = outdoorSafe && !isHighWind && !isExtremeHeat && !isExtremeCold;

    let recommendation = "Pitch conditions optimal for training";
    if (!outdoorSafe) recommendation = "Wet surface alert: Move to indoor court";
    else if (isHighWind) recommendation = "High wind gusts: Ball trajectories affected";
    else if (isExtremeHeat) recommendation = "Extreme heat: Mandatory hydration breaks every 15m";
    else if (isExtremeCold) recommendation = "Cold weather: Ensure prolonged active warm-up";

    return {
      temp,
      condition,
      conditionCode: code,
      windSpeed,
      humidity,
      isOutdoorSafe: safe,
      courtRecommendation: recommendation,
      source: "Open-Meteo API (Live)",
    };
  } catch (err) {
    console.warn("Using baseline weather fallback:", err);
    return {
      temp: 22,
      condition: "Clear sky",
      conditionCode: 0,
      windSpeed: 12,
      humidity: 55,
      isOutdoorSafe: true,
      courtRecommendation: "Pitch conditions suitable for outdoor and indoor training",
      source: "Fallback",
    };
  }
}
