export interface Project {
  id: string;
  name: string;
  createdBy: string;
  conversationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectData {
  name: string;
}

export interface UpdateProjectData {
  name?: string;
}
