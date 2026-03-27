import { ToolAttributeType } from '../schemas/tool.schema';

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
  defaultAgentTypes: string[];
  attributes: IToolAttribute[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
