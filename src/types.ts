export type Status = "todo" | "progress" | "review" | "done";
export type Priority = "low" | "medium" | "high";
export type Member = {
  orgUnitId?: string;
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  active: boolean;
  mustChangePassword: boolean;
};
export type Field = {
  id: string;
  name: string;
  type: "text" | "number" | "select";
  options: string[];
};
export type Rule = {
  id: string;
  status: Status;
  assigneeId: string;
  dueDays: number | null;
  enabled: boolean;
};
export type Project = {
  orgUnitId?: string;
  memberIds?: string[];
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  status: "ontrack" | "atrisk" | "complete";
  dueDate: string;
  fields: Field[];
  rules: Rule[];
  ownerId: string;
};
export type Task = {
  visibility?: "workspace" | "private";
  createdBy?: string;
  recurrence?: {
    frequency: "daily" | "weekly" | "monthly";
    interval: number;
  } | null;
  recurrenceNextId?: string;
  assigneeIds?: string[];
  accountId?: string;
  minuteId?: string;
  minuteActionIndex?: number | null;
  id: string;
  title: string;
  description: string;
  projectIds: string[];
  status: Status;
  priority: Priority;
  assigneeId: string;
  startDate: string;
  dueDate: string;
  tags: string[];
  dependencies: string[];
  custom: Record<string, string | number>;
  links: { name: string; url: string }[];
  comments: { id: string; userId: string; text: string; createdAt: string }[];
  approval: null | {
    status: "pending" | "approved" | "rejected";
    reviewerId: string;
    requestedBy: string;
  };
  version: number;
  updatedAt: string;
};
export type Activity = {
  id: string;
  userId: string;
  text: string;
  taskId: string;
  createdAt: string;
};
export type Notification = {
  id: string;
  userId: string;
  text: string;
  taskId: string;
  read: boolean;
  createdAt: string;
};
export type Data = {
  orgUnits?: OrgUnit[];
  salesAccounts?: { id: string; name: string; isDemo: boolean }[];
  user: Member;
  members: Member[];
  projects: Project[];
  tasks: Task[];
  activity: Activity[];
  notifications: Notification[];
  workspace: { name: string };
};
export type OrgUnit = {
  id: string;
  name: string;
  parentId: string;
  level: string;
  version: number;
};
export const taskAssignees = (task: Pick<Task, "assigneeId" | "assigneeIds">) =>
  task.assigneeIds || (task.assigneeId ? [task.assigneeId] : []);
export function organizationName(units: OrgUnit[], id?: string): string {
  const unit = units.find((u) => u.id === id);
  return unit
    ? [organizationName(units, unit.parentId), unit.name]
        .filter(Boolean)
        .join(" / ")
    : "";
}
