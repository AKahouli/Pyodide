export interface IUserGroupMember {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface IUserGroupResponse {
  id: string;
  name: string;
  description: string;
  members: IUserGroupMember[];
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}
