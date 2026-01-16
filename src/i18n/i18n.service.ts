import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export type SupportedLanguage = 'es' | 'en' | 'pt';

export interface TranslationResult {
  title: string;
  message: string;
}

@Injectable()
export class I18nService implements OnModuleInit {
  private readonly logger = new Logger(I18nService.name);
  private translations: Map<SupportedLanguage, any> = new Map();
  private readonly defaultLanguage: SupportedLanguage = 'es';
  private readonly supportedLanguages: SupportedLanguage[] = ['es', 'en', 'pt'];

  onModuleInit() {
    this.loadTranslations();
  }

  private loadTranslations() {
    for (const lang of this.supportedLanguages) {
      try {
        const filePath = path.join(__dirname, `${lang}.json`);
        const content = fs.readFileSync(filePath, 'utf-8');
        this.translations.set(lang, JSON.parse(content));
        this.logger.log(`Loaded translations for language: ${lang}`);
      } catch (error) {
        this.logger.warn(`Failed to load translations for ${lang}: ${error.message}`);
      }
    }
  }

  /**
   * Get a translated notification by key
   * @param key - Dot-notation key like "notifications.welcome"
   * @param variables - Variables to interpolate like { firstName: "John" }
   * @param language - Target language (defaults to 'es')
   */
  getNotification(
    key: string,
    variables: Record<string, string | number> = {},
    language: SupportedLanguage = this.defaultLanguage,
  ): TranslationResult {
    const translation = this.getTranslation(key, language);

    if (!translation || typeof translation !== 'object') {
      this.logger.warn(`Translation not found for key: ${key} in language: ${language}`);
      return {
        title: key,
        message: key,
      };
    }

    return {
      title: this.interpolate(translation.title || key, variables),
      message: this.interpolate(translation.message || key, variables),
    };
  }

  /**
   * Get a single translated string by key
   * @param key - Dot-notation key like "document_types.w2"
   * @param language - Target language
   */
  getString(
    key: string,
    language: SupportedLanguage = this.defaultLanguage,
  ): string {
    const value = this.getTranslation(key, language);
    return typeof value === 'string' ? value : key;
  }

  /**
   * Get translated document type name
   */
  getDocumentType(type: string, language: SupportedLanguage = this.defaultLanguage): string {
    return this.getString(`document_types.${type}`, language);
  }

  /**
   * Get translated track name (federal/state)
   */
  getTrack(track: 'federal' | 'state', language: SupportedLanguage = this.defaultLanguage): string {
    return this.getString(`tracks.${track}`, language);
  }

  /**
   * Check if a language is supported
   */
  isSupported(language: string): language is SupportedLanguage {
    return this.supportedLanguages.includes(language as SupportedLanguage);
  }

  /**
   * Get the default language
   */
  getDefaultLanguage(): SupportedLanguage {
    return this.defaultLanguage;
  }

  /**
   * Get all supported languages
   */
  getSupportedLanguages(): SupportedLanguage[] {
    return [...this.supportedLanguages];
  }

  /**
   * Navigate to a nested translation value using dot notation
   */
  private getTranslation(key: string, language: SupportedLanguage): any {
    let translations = this.translations.get(language);

    // Fallback to default language if not found
    if (!translations) {
      translations = this.translations.get(this.defaultLanguage);
    }

    if (!translations) {
      return null;
    }

    const keys = key.split('.');
    let value = translations;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        // Try fallback to default language
        if (language !== this.defaultLanguage) {
          return this.getTranslation(key, this.defaultLanguage);
        }
        return null;
      }
    }

    return value;
  }

  /**
   * Interpolate variables in a string using {{variable}} syntax
   */
  private interpolate(
    template: string,
    variables: Record<string, string | number>,
  ): string {
    if (!template) return '';

    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (key in variables) {
        return String(variables[key]);
      }
      this.logger.warn(`Missing variable: ${key} in template`);
      return match;
    });
  }
}
