export type Seed = number | string;

export type ContentProvenance = "original" | "public-domain";

export interface ContentLicense {
  readonly id: string;
  readonly name: string;
  readonly spdxIdentifier: string | null;
  readonly rightsStatement: string;
  readonly attribution: string;
}

export interface ContentSource {
  readonly id: string;
  readonly title: string;
  readonly creator: string;
  readonly provenance: ContentProvenance;
  readonly license: ContentLicense;
  readonly bibliographicCitation: string;
  readonly notes: string;
}

export type CodeLanguage = "plain-text" | "javascript" | "typescript" | "json" | "html" | "css";

export type DataEntryCategory =
  "integer" | "decimal" | "percentage" | "date" | "time" | "currency" | "fictional-phone" | "table";

export type GameDifficulty = "standard" | "hard" | "adaptive";

export type PineappleLevelId =
  | "signal-sync"
  | "firewall-routing"
  | "credential-forge"
  | "packet-repair"
  | "trace-countdown"
  | "vault-phrase";

export type PracticeContentModeId =
  | "smart"
  | "traditional"
  | "weakness"
  | "common-english"
  | "pseudowords"
  | "data-entry"
  | "punctuation"
  | "shift"
  | "source-code"
  | "long-form"
  | "typing-test"
  | "mixed";
