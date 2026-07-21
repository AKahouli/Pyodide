import { SetMetadata } from '@nestjs/common';

export const WIDGET_DEPLOYMENT_MODE_KEY = 'widgetDeploymentMode';
export type WidgetDeploymentMode = 'embed' | 'rest';

export const WidgetDeploymentMode = (mode: WidgetDeploymentMode) =>
  SetMetadata(WIDGET_DEPLOYMENT_MODE_KEY, mode);
