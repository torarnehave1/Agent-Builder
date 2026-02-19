export type Language = 'en' | 'no';

type TranslationValue = string | TranslationTree;
interface TranslationTree {
  [key: string]: TranslationValue;
}

const DEFAULT_LANGUAGE: Language = 'en';

export const translations: Record<Language, TranslationTree> = {
  en: {
    app: {
      title: 'Agent Builder',
      badge: 'Early access'
    }
  },
  no: {
    app: {
      title: 'Agent Builder',
      badge: 'Tidlig tilgang'
    }
  }
};

const walk = (tree: TranslationTree, parts: string[]): TranslationValue | undefined => {
  let current: TranslationValue = tree;
  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as TranslationTree)[part];
  }
  return current;
};

export const getTranslation = (language: Language, key: string) => {
  const parts = key.split('.');
  const langTree = translations[language] || translations[DEFAULT_LANGUAGE];
  const value = walk(langTree, parts);
  if (typeof value === 'string') {
    return value;
  }
  const fallbackValue = walk(translations[DEFAULT_LANGUAGE], parts);
  if (typeof fallbackValue === 'string') {
    return fallbackValue;
  }
  return key;
};
