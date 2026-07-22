import type { ContentLicense, ContentSource } from "./types.js";

export const ORIGINAL_CONTENT_LICENSE: ContentLicense = Object.freeze({
  id: "symtype-original-content-cc0",
  name: "CC0 1.0 Universal",
  spdxIdentifier: "CC0-1.0",
  rightsStatement:
    "The original practice content in this package is dedicated to the public under CC0 1.0.",
  attribution: "SymType contributors"
});

export const PUBLIC_DOMAIN_US_LICENSE: ContentLicense = Object.freeze({
  id: "public-domain-united-states",
  name: "Public domain in the United States",
  spdxIdentifier: null,
  rightsStatement:
    "This historical source was published in 1900 and is treated as public domain in the United States. Users distributing elsewhere should check local law.",
  attribution: "L. Frank Baum, 1900"
});

export const contentSources: readonly ContentSource[] = Object.freeze([
  {
    id: "symtype-curated-common-words-v1",
    title: "SymType curated common-English vocabulary",
    creator: "SymType contributors",
    provenance: "original",
    license: ORIGINAL_CONTENT_LICENSE,
    bibliographicCitation: "SymType content package, version 1",
    notes:
      "Independently curated from ordinary modern English; ordering is a teaching aid and is not represented as an exact corpus frequency rank."
  },
  {
    id: "symtype-original-practice-v1",
    title: "SymType original practice passages and snippets",
    creator: "SymType contributors",
    provenance: "original",
    license: ORIGINAL_CONTENT_LICENSE,
    bibliographicCitation: "SymType content package, version 1",
    notes:
      "Original local-only teaching material, including sentence templates, code samples, and fictional game copy."
  },
  {
    id: "baum-wizard-oz-1900-chapter-1",
    title: "The Wonderful Wizard of Oz, Chapter I",
    creator: "L. Frank Baum",
    provenance: "public-domain",
    license: PUBLIC_DOMAIN_US_LICENSE,
    bibliographicCitation: "Baum, L. Frank. The Wonderful Wizard of Oz. 1900. Chapter I.",
    notes:
      "A short historical excerpt is bundled for local typing practice; spelling and punctuation follow the cited edition in substance."
  }
]);

export function getContentSource(sourceId: string): ContentSource | undefined {
  return contentSources.find((source) => source.id === sourceId);
}
