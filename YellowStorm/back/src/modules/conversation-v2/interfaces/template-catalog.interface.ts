import type { TemplatePlatformReport } from '@modules/app-runtime/platform-kit/platform-template-report';
import type { ConversationV2TemplateStatus } from '../persistence/conversation-v2-template.store';

export interface ITemplateCategoryResponse {
  id: string;
  name: string;
  slug: string;
  icon: string;
  templateCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITemplateResponse {
  id: string;
  categoryId: string;
  categoryName: string;
  title: string;
  description: string;
  /** Presigned read URL for the Ceph cover object ('' when none). */
  coverImage: string;
  status: ConversationV2TemplateStatus;
  /** `template_<id>` once published, else null. */
  revisionId: string | null;
  /** What the Platform Kit must inject for this template (null before publish). */
  platformReport: TemplatePlatformReport | null;
  createdAt: Date;
  updatedAt: Date;
}
