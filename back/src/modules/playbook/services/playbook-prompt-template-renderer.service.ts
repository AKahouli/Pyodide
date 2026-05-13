import { Injectable } from '@nestjs/common';

@Injectable()
export class PlaybookPromptTemplateRendererService {
  render(template: string, variables: Record<string, unknown>): string {
    if (!template) {
      return '';
    }

    return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}|\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, singleKey, doubleKey) => {
      const key = String(singleKey || doubleKey || '');
      if (!key) {
        return '';
      }

      const value = variables[key];
      if (value === null || value === undefined) {
        return '';
      }

      if (typeof value === 'string') {
        return value;
      }

      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }

      return JSON.stringify(value, null, 2);
    });
  }
}
