import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next/initReactI18next';
import { DynamicImportBackend } from './DynamicImportBackend';

export const i18nInstance: I18nInstance = i18next.createInstance();
i18nInstance.use(new DynamicImportBackend());
i18nInstance.use(initReactI18next);
