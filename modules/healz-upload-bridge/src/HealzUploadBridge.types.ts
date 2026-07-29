export type SharedFileInput = {
  uri: string;
  mimeType: string;
};

export type ImportedFile = {
  id: string;
  uri: string;
  name: string;
  mimeType: SupportedMimeType;
  size: number;
  kind: 'original' | 'prepared';
};

export type ImportIssueCode =
  | 'too_many_files'
  | 'unsupported_uri'
  | 'unsupported_type'
  | 'file_too_large'
  | 'batch_too_large'
  | 'cache_unavailable'
  | 'read_failed';

export type ImportIssue = {
  code: ImportIssueCode;
  name: string | null;
};

export type ImportBatchResult = {
  files: ImportedFile[];
  issues: ImportIssue[];
};

export type PreparedFileInput = {
  id: string;
  sourceUri: string;
  name: string;
  mimeType: SupportedMimeType;
};

export type StageFileInput = {
  id: string;
  uri: string;
  name: string;
  mimeType: SupportedMimeType;
  size: number;
};

export type StageResult = {
  nonce: string;
  count: number;
};

export type StageStatus = {
  state: 'none' | 'staged' | 'consumed';
  nonce: string | null;
};

export type SupportedMimeType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic';
