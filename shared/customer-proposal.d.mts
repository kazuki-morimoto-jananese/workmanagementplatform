import type { KwReport } from "../src/kw-analysis";
export type ProposalOptions = {
  title: string;
  recipient: string;
  issuer: string;
  presenter: string;
  issuedOn: string;
  overview: string;
  cvDefinition: string;
  conditions: string;
  nextSteps: string;
  rowIndices: number[];
  findings: { index: number; proposal: string }[];
  includeCompetition: boolean;
  includeCompetitorNames: boolean;
  includeSourceNames: boolean;
};
export type ProposalSlide =
  | { kind: "text"; title: string; lines: string[] }
  | { kind: "cover"; title: string; lines: string[] }
  | {
      kind: "table";
      title: string;
      headers: string[];
      rows: string[][];
      caption: string;
    }
  | {
      kind: "bars";
      title: string;
      series: {
        label: string;
        values: (number | null)[];
        formatted: string[];
      }[];
      caption: string;
    };
export type CustomerProposal = {
  schemaVersion: 1;
  templateVersion: "proposal-v1";
  title: string;
  recipient: string;
  issuedOn: string;
  options: ProposalOptions;
  slides: ProposalSlide[];
};
export function proposalDefaults(
  report: KwReport,
  recipient?: string,
  presenter?: string,
): ProposalOptions;
export function validateProposalOptions(
  input: unknown,
  report: KwReport,
): ProposalOptions;
export function wrapProposalText(value: string, units?: number): string[];
export function buildCustomerProposal(
  report: KwReport,
  input: ProposalOptions,
): CustomerProposal;
