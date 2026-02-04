/**
 * Filter options derived from services list (app_platform, app_language, app_environment).
 * Language codes are converted to full names for major languages.
 */

/** Two-letter language code to full name (major languages only) */
export const LANGUAGE_CODE_TO_NAME = {
  en: "English",
  fr: "French",
  zh: "Chinese",
  ja: "Japanese",
  vi: "Vietnamese",
  ko: "Korean",
  es: "Spanish",
  pt: "Portuguese",
  de: "German",
  da: "Danish",
  ru: "Russian",
  it: "Italian",
  nl: "Dutch",
  pl: "Polish",
  th: "Thai",
  id: "Indonesian",
  ms: "Malay",
  tr: "Turkish",
  ar: "Arabic",
  hi: "Hindi",
};

const ALL_OPTION = { value: "", label: "ALL" };

/**
 * Get display name for a two-letter language code.
 * Returns full name for major languages, otherwise the original code.
 * @param {string} code - Two-letter language code (e.g. "en", "zh")
 * @returns {string}
 */
export function getLanguageDisplayName(code) {
  if (!code || typeof code !== "string") return "";
  const lower = code.trim().toLowerCase();
  return LANGUAGE_CODE_TO_NAME[lower] ?? code;
}

/**
 * Derive platform, language, and environment filter options from a services array.
 * Values come from app_platform, app_language, app_environment. "ALL" is always first and is the default.
 * If the array has no distinct value for a field, only "ALL" is shown for that filter.
 * @param {Array<{ app_platform?: string, app_language?: string, app_environment?: string }>} services
 * @returns {{ platformOptions: Array<{value:string,label:string}>, languageOptions: Array<{value:string,label:string}>, environmentOptions: Array<{value:string,label:string}> }}
 */
export function getFilterOptionsFromServices(services) {
  if (!Array.isArray(services) || services.length === 0) {
    return {
      platformOptions: [ALL_OPTION],
      languageOptions: [ALL_OPTION],
      environmentOptions: [ALL_OPTION],
    };
  }

  const platformSet = new Set();
  const languageSet = new Set();
  const environmentSet = new Set();

  services.forEach((s) => {
    if (s.app_platform != null && String(s.app_platform).trim() !== "") {
      platformSet.add(String(s.app_platform).trim());
    }
    if (s.app_language != null && String(s.app_language).trim() !== "") {
      languageSet.add(String(s.app_language).trim());
    }
    if (s.app_environment != null && String(s.app_environment).trim() !== "") {
      environmentSet.add(String(s.app_environment).trim());
    }
  });

  const platformOptions = [ALL_OPTION, ...[...platformSet].sort().map((v) => ({ value: v, label: v }))];
  const languageOptions = [
    ALL_OPTION,
    ...[...languageSet]
      .sort()
      .map((code) => ({ value: code, label: getLanguageDisplayName(code) })),
  ];
  const environmentOptions = [ALL_OPTION, ...[...environmentSet].sort().map((v) => ({ value: v, label: v }))];

  return {
    platformOptions: platformOptions.length === 1 ? [ALL_OPTION] : platformOptions,
    languageOptions: languageOptions.length === 1 ? [ALL_OPTION] : languageOptions,
    environmentOptions: environmentOptions.length === 1 ? [ALL_OPTION] : environmentOptions,
  };
}
