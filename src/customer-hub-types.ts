export const customerRecordLabels: Record<string, string> = {
  salesMinutes: "議事録",
  salesOpportunities: "商談",
  salesActivities: "活動",
  tasks: "タスク",
  kwAnalyses: "分析",
  salesInitiatives: "施策",
  salesReviews: "週次ヨミ",
  crmContacts: "関係者",
};
export const relationshipRoles: Record<string, string> = {
  unknown: "未確認",
  decision: "決裁者",
  champion: "推進者",
  operator: "実務担当",
  procurement: "購買・契約",
  other: "その他",
};
export type CustomerProfile = {
  id: string;
  accountId: string;
  company: string;
  brand: string;
  branch: string;
  website: string;
  handover: string;
  nextStep: string;
  renewalDate: string;
  relatedAccountIds: string[];
  version: number;
};
export type CustomerContact = {
  id: string;
  name: string;
  email: string;
  department?: string;
  jobTitle?: string;
  relationshipRole?: string;
  consent: string;
  nextContact: string;
  notes: string;
};
export type TimelineItem = {
  id: string;
  kind: string;
  stamp: string;
  eventDate: string;
  title: string;
  excerpt: string;
  status: string;
};
export type PrepCheck = {
  id: string;
  label: string;
  done: boolean;
  note: string;
};
export type PrepTemplate = {
  id: string;
  name: string;
  agenda: string;
  orgUnitId: string;
  items: string[];
  version: number;
  archived?: boolean;
  builtin?: boolean;
};
export type PrepTemplateSource = {
  key: string;
  name: string;
  version: number;
  appliedAt: string;
};
