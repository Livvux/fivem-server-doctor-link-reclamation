export type Severity = "critical" | "high" | "medium" | "low";

export type FindingCategory =
  | "status"
  | "server_cfg"
  | "resource"
  | "manifest"
  | "dependency"
  | "logs"
  | "security";

export type FixOperation =
  | {
      type: "create_file";
      content: string;
    }
  | {
      type: "replace_file";
      content: string;
    };

export type FixCandidate = {
  id: string;
  file: string;
  beforeHash: string | null;
  operation: FixOperation;
  preview: string;
  risk: "low" | "medium" | "high";
  reason: string;
};

export type Finding = {
  id: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  evidence: string[];
  affectedFiles: string[];
  suggestedFixes: FixCandidate[];
};

export type ResourceSummary = {
  name: string;
  path: string;
  manifestPath: string | null;
  manifestKind: "fxmanifest.lua" | "__resource.lua" | null;
};

export type DoctorConfig = {
  txdata?: string;
  serverCfg?: string;
  resources?: string;
  txadminUrl?: string;
  txadminTokenEnv?: string;
  allowWrite: boolean;
};

export type ScanResult = {
  config: {
    txdata?: string;
    serverCfg?: string;
    resources?: string;
    txadminUrl?: string;
    allowWrite: boolean;
  };
  status: unknown;
  resources: ResourceSummary[];
  findings: Finding[];
};
