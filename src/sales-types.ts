export type MediaValues = {
  budget: number | null;
  spend: number | null;
  cv: number | null;
  cpa: number | null;
  hires: number | null;
  months?: number | null;
};
export type SalesMedia = {
  stanby: MediaValues;
  indeed: MediaValues;
  box: MediaValues;
  acceptableCpa: number | null;
};
export type SalesAccount = {
  id: string;
  name: string;
  status: string;
  ownerId: string;
  ownerName: string;
  group: string;
  category: string;
  agency: string;
  projectId: string;
  customerGoal: string;
  customerIssues: string;
  lastContactAt: string;
  importedAt: string;
  version: number;
};
export type SalesMaster = {
  id: string;
  accountId: string;
  month: string;
  previousActual: number | null;
  previousGTrend: number | null;
  gTrend: number | null;
  target: number | null;
  nextTarget: number | null;
  media: SalesMedia;
  raw: Record<string, unknown>;
  importedAt: string;
  sourceName: string;
};
export type SalesReview = {
  id: string;
  accountId: string;
  month: string;
  weekOf: string;
  forecast: number | null;
  aggressive: number | null;
  probability: number | null;
  reason: string;
  nextAction: string;
  customerGoal: string;
  customerIssues: string;
  funnel: string;
  effectiveProposal: "yes" | "no" | "unknown";
  budgetTrend: string;
  observedAt: string;
  media: SalesMedia;
  version: number;
  updatedAt: string;
  updatedBy: string;
};
export type OpportunityStage =
  "discovery" | "proposal" | "negotiation" | "won" | "lost";
export type SalesOpportunity = {
  id: string;
  accountId: string;
  title: string;
  amount: number | null;
  probability: number | null;
  stage: OpportunityStage;
  expectedCloseDate: string;
  ownerId: string;
  nextAction: string;
  lastActivityAt: string;
  version: number;
  updatedAt: string;
};
export type SalesMinute = {
  id: string;
  accountId: string;
  opportunityId: string;
  title: string;
  meetingDate: string;
  text: string;
  sourceUrl: string;
  createdAt: string;
  createdBy: string;
  status: "saved" | "pending" | "processing" | "completed" | "failed";
  summary: null | {
    overview: string;
    decisions: string[];
    risks: string[];
    actions: {
      title: string;
      ownerName: string;
      dueDate: string;
      evidence: string;
    }[];
    evidence: string[];
  };
  summaryProvider: "gemini" | "local" | null;
  summaryError: string;
  taskLinks: { actionIndex: number; taskId: string }[];
  version: number;
};
export type SalesSource = {
  name: string;
  spreadsheetId: string;
  range: string;
  month: string;
  rollingMonth: boolean;
  enabled: boolean;
  mapping: Record<string, string | number>;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  nextRunAt?: string;
};
export type SalesData = {
  accounts: SalesAccount[];
  masters: SalesMaster[];
  reviews: SalesReview[];
  opportunities: SalesOpportunity[];
  minutes: SalesMinute[];
  activities: {
    id: string;
    accountId: string;
    type: "call" | "meeting" | "proposal";
    date: string;
    notes: string;
    userId: string;
    createdAt: string;
  }[];
  imports: {
    id: string;
    sourceName: string;
    createdAt: string;
    status: string;
    created: number;
    updated: number;
    errors: string[];
    warnings: string[];
  }[];
  connections: {
    sheetsConfigured: boolean;
    geminiConfigured: boolean;
    geminiModel: string;
    autoSummaryEnabled: boolean;
    source: SalesSource | null;
  };
  history: {
    accountId: string;
    month: string;
    weekOf: string;
    forecast: number | null;
    reason: string;
    updatedAt: string;
    updatedBy: string;
  }[];
};
export type ImportPreview = {
  headers: string[];
  mapping: Record<string, string | number>;
  rows: { accountId: string; name: string; [key: string]: unknown }[];
  errors: string[];
  warnings: string[];
  count: number;
};
