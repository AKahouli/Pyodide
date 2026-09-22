import { ToolAttributeType } from '../tool.types';

export interface IToolAttribute {
  id?: string;
  name: string;
  type: ToolAttributeType;
  value: string | number | boolean;
  options?: string[];
}

export interface IToolResponse {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: 'light' | 'dark';
  categoryId: string | null;
  defaultAgentTypes: string[];
  attributes: IToolAttribute[];
  requiredAppKey?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IToolCategoryResponse {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}
