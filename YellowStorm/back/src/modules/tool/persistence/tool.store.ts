/** Store ports for catalog.tool_categories and catalog.tools (plan 1B.4.1). */
export const TOOL_CATEGORY_STORE = Symbol('TOOL_CATEGORY_STORE');
export const TOOL_STORE = Symbol('TOOL_STORE');

export interface ToolCategoryRow {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ToolCategoryStore {
  findAll(): Promise<ToolCategoryRow[]>;
  findById(id: string): Promise<ToolCategoryRow | null>;
  findByName(name: string): Promise<ToolCategoryRow | null>;
  insert(data: { name: string; description: string }): Promise<ToolCategoryRow>;
  update(id: string, patch: { name?: string; description?: string }): Promise<ToolCategoryRow | null>;
  delete(id: string): Promise<boolean>;
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

export interface ToolStore {
  findById(id: string): Promise<ToolRow | null>;
  findByName(name: string): Promise<ToolRow | null>;
  insert(row: NewToolRow): Promise<ToolRow>;
  update(id: string, patch: Partial<Omit<NewToolRow, 'name'>> & { name?: string }): Promise<ToolRow | null>;
  delete(id: string): Promise<ToolRow | null>;
  list(query: ToolListQuery): Promise<{ rows: ToolRow[]; total: number }>;
  /** Active tools carrying `agentType` in default_agent_types, name asc. */
  findByAgentType(agentType: string): Promise<ToolRow[]>;
  findAllActive(): Promise<ToolRow[]>;
  findByIds(ids: string[]): Promise<ToolRow[]>;
}
