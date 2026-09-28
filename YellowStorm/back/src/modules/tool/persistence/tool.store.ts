/** Row shapes for catalog.tool_categories and catalog.tools (plan 1B.4.1). */
export interface ToolCategoryRow {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Subdocument ids preserved inside attributes jsonb. */
export interface ToolAttributeRow {
  id?: string;
  name: string;
  type: string;
  value: string | number | boolean;
  options?: string[];
}

export interface ToolRow {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: string;
  categoryId: string | null;
  defaultAgentTypes: string[];
  attributes: ToolAttributeRow[];
  requiredAppKey: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NewToolRow = Partial<Omit<ToolRow, 'id' | 'name' | 'createdAt' | 'updatedAt'>> & Pick<ToolRow, 'name'>;

export interface ToolListQuery {
  search?: string;
  agentType?: string;
  isActive?: boolean;
  page: number;
  limit: number;
}

