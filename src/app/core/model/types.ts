export type UUID = string;

export interface GedcomNode {
  level: number;
  tag: string;
  xref?: string;
  pointer?: string;
  value?: string;
  children: GedcomNode[];
}

export interface GedcomEvent {
  type: string;
  date?: string;
  place?: string;
  citations: string[];
  notes: string[];
  raw?: GedcomNode;
}

export type Pedigree = 'birth' | 'adopted' | 'foster' | 'sealing' | 'step' | string;

export interface ChildLink {
  childId: UUID;
  pedi?: Pedigree;
  status?: string;
  citations: string[];
  notes: string[];
}

export interface UnionRef {
  unionId: UUID;
}

export interface Union {
  id: UUID;
  sourceXref?: string;
  spouseIds: UUID[];
  events: GedcomEvent[];
  childLinks: ChildLink[];
  rawRef?: GedcomNode;
}

export interface MediaLink {
  targetId: UUID;
  isPrimary: boolean;
}

export interface MediaObject {
  id: UUID;
  sourceXref?: string;
  form?: string;
  title?: string;
  file?: string;
  links: MediaLink[];
  rawRef?: GedcomNode;
}

export interface PersonName {
  full: string;
  given?: string;
  surname?: string;
  prefix?: string;
  suffix?: string;
  type?: string;
}

export interface Individual {
  id: UUID;
  sourceXref?: string;
  names: PersonName[];
  sex?: 'M' | 'F' | 'U' | string;
  events: GedcomEvent[];
  unions: UnionRef[];
  mediaIds: UUID[];
  notes: string[];
  rawRef?: GedcomNode;
}

export interface TreeMeta {
  gedcomVersion?: string;
  charset?: string;
  submitterName?: string;
  source?: string;
}

export interface TreeModel {
  id: UUID;
  meta: TreeMeta;
  individuals: Map<UUID, Individual>;
  unions: Map<UUID, Union>;
  media: Map<UUID, MediaObject>;
  documentAst: GedcomNode[];
}
