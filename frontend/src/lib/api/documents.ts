import { useMutation, useQueryClient } from '@tanstack/react-query';

import { API_URL, apiRequest, getAuthHeaders } from '@/config/api';
import { USE_MOCKS } from '@/config/flags';
import type {
  DealDocument,
  DocumentDownloadResponse,
  DocumentUploadIntentResponse,
} from '@/types/deal';
import type { DocumentCategory } from '@/types/deal';

export interface UploadDocumentInput {
  dealId: string;
  file: File;
  documentName: string;
  category: DocumentCategory;
  subcategory?: string;
  notes?: string;
  visibilityRoles?: string[];
}

function fileExtension(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName) return fromName;
  const fromType = file.type.split('/').pop()?.toLowerCase();
  return fromType ?? 'bin';
}

function isSameOriginUrl(url: string): boolean {
  if (url.startsWith('/')) return true;
  try {
    return new URL(url).origin === new URL(API_URL || window.location.origin).origin;
  } catch {
    return false;
  }
}

async function uploadFileToTarget(
  uploadUrl: string,
  file: File,
  headers: Record<string, string>,
  method: string,
): Promise<void> {
  if (USE_MOCKS) return;

  const requestHeaders: HeadersInit = { ...headers };
  if (isSameOriginUrl(uploadUrl)) {
    Object.assign(requestHeaders, getAuthHeaders());
    (requestHeaders as Record<string, string>)['Content-Type'] =
      headers['Content-Type'] ?? file.type ?? 'application/octet-stream';
  }

  const response = await fetch(uploadUrl.startsWith('/') ? `${API_URL}${uploadUrl}` : uploadUrl, {
    method,
    headers: requestHeaders,
    body: file,
  });

  if (!response.ok) {
    throw new Error(`File upload failed (${response.status}).`);
  }
}

export async function uploadDocument(input: UploadDocumentInput): Promise<DealDocument> {
  const fileType = fileExtension(input.file);
  const intent = await apiRequest<DocumentUploadIntentResponse>('api/documents/upload-intent/', {
    method: 'POST',
    body: JSON.stringify({
      deal: input.dealId,
      document_name: input.documentName,
      category: input.category,
      subcategory: input.subcategory ?? '',
      file_type: fileType,
      content_type: input.file.type || undefined,
      file_size_bytes: input.file.size,
      visibility_roles: input.visibilityRoles ?? ['internal'],
      notes: input.notes ?? '',
    }),
  });

  await uploadFileToTarget(
    intent.upload_url,
    input.file,
    intent.upload_headers,
    intent.upload_method,
  );

  return apiRequest<DealDocument>(`api/documents/${intent.document.id}/complete/`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function downloadDocument(doc: DealDocument): Promise<void> {
  const payload = await apiRequest<DocumentDownloadResponse>(
    `api/documents/${doc.id}/download/`,
  );

  if (USE_MOCKS) {
    const blob = new Blob(
      [`Demo file placeholder for ${doc.document_name}`],
      { type: payload.content_type || 'text/plain' },
    );
    triggerBrowserDownload(blob, payload.filename);
    return;
  }

  const headers: HeadersInit = {};
  if (isSameOriginUrl(payload.download_url)) {
    Object.assign(headers, getAuthHeaders());
    delete (headers as Record<string, string>)['Content-Type'];
  }

  const response = await fetch(
    payload.download_url.startsWith('/')
      ? `${API_URL}${payload.download_url}`
      : payload.download_url,
    { headers },
  );
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}).`);
  }

  const blob = await response.blob();
  triggerBrowserDownload(blob, payload.filename);
}

export function updateDocumentMetadata(
  documentId: string,
  payload: { subcategory?: string; expiry_date?: string | null; notes?: string },
): Promise<DealDocument> {
  return apiRequest<DealDocument>(`api/documents/${documentId}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteDocument(documentId: string): Promise<void> {
  return apiRequest<void>(`api/documents/${documentId}/`, { method: 'DELETE' });
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function useUploadDocument(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UploadDocumentInput, 'dealId'>) =>
      uploadDocument({ ...input, dealId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deal-documents', dealId] });
      void queryClient.invalidateQueries({ queryKey: ['deal-activity', dealId] });
    },
  });
}

export function useDownloadDocument() {
  return useMutation({
    mutationFn: (doc: DealDocument) => downloadDocument(doc),
  });
}

export function useUpdateDocumentMetadata(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, payload }: {
      documentId: string;
      payload: { subcategory?: string; expiry_date?: string | null; notes?: string };
    }) => updateDocumentMetadata(documentId, payload),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['deal-documents', dealId] }),
  });
}

export function useDeleteDocument(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deal-documents', dealId] });
      void queryClient.invalidateQueries({ queryKey: ['deal-activity', dealId] });
    },
  });
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
