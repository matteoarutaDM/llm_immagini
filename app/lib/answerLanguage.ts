/** Languages the answers can be written in (codes match backend ANSWER_LANGUAGES). */
export const ANSWER_LANGUAGES = [
  { code: "it", label: "Italiano" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
] as const;

export type AnswerLanguage = (typeof ANSWER_LANGUAGES)[number]["code"];

export const DEFAULT_ANSWER_LANGUAGE: AnswerLanguage = "it";
const STORAGE_KEY = "answerLanguage";

function isAnswerLanguage(value: unknown): value is AnswerLanguage {
  return ANSWER_LANGUAGES.some((language) => language.code === value);
}

/** The choice is a per-browser preference: storage may be unavailable, so it falls back to Italian. */
export function getAnswerLanguage(): AnswerLanguage {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isAnswerLanguage(stored) ? stored : DEFAULT_ANSWER_LANGUAGE;
  } catch {
    return DEFAULT_ANSWER_LANGUAGE;
  }
}

export function setAnswerLanguage(language: AnswerLanguage): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not persisted: answers go back to the default language next time.
  }
}
