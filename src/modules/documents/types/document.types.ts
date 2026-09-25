export interface DocumentMetadata {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

export interface UploadResult {
  document: DocumentMetadata;
}
