import type {
  ImportedFile,
  ImportIssue,
  StageFileInput,
} from '../../modules/healz-upload-bridge';

export type QueueState = 'preparing' | 'ready' | 'fallback';

export type QueuedFile = {
  id: string;
  original: ImportedFile;
  prepared: ImportedFile | null;
  useOriginal: boolean;
  state: QueueState;
  note: string | null;
};

export type PreparationResult = {
  prepared: ImportedFile | null;
  note: string | null;
};

export function selectedFile(item: QueuedFile): ImportedFile {
  if (!item.useOriginal && item.prepared) return item.prepared;
  return item.original;
}

export function toStageInput(item: QueuedFile): StageFileInput {
  const selected = selectedFile(item);
  return {
    id: selected.id,
    uri: selected.uri,
    name: selected.name,
    mimeType: selected.mimeType,
    size: selected.size,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}

const ISSUE_TEXT: Record<ImportIssue['code'], string> = {
  too_many_files: 'За один раз можно подготовить не больше 10 файлов.',
  unsupported_uri: 'Одно из приложений не предоставило доступ к файлу.',
  unsupported_type: 'Поддерживаются PDF, JPEG, PNG, WebP и HEIC.',
  file_too_large: 'Файл больше безопасного лимита 50 МБ.',
  batch_too_large: 'Пакет файлов больше лимита 100 МБ.',
  cache_unavailable: 'Не удалось создать защищённую временную копию.',
  read_failed: 'Не удалось прочитать один из выбранных файлов.',
};

export function describeIssue(issue: ImportIssue): string {
  const prefix = issue.name ? `${issue.name}: ` : '';
  return `${prefix}${ISSUE_TEXT[issue.code]}`;
}
