export const CLOUD_LIMITS = {
  fileBytes: 20 * 1024 * 1024,
  accountBytes: 100 * 1024 * 1024,
  files: 50,
  shares: 50,
  comments: 200,
  templates: 20,
  tokens: 5,
  expiryDays: 30,
} as const;
export interface CloudFile {
  id: string;
  name: string;
  bytes: number;
  sha256: string;
  created: number;
  template: boolean;
}
export interface CloudComment {
  id: string;
  fileId: string;
  author: string;
  text: string;
  page: number | null;
  created: number;
  owner: boolean;
  resolved: boolean;
}
export interface SigningReceipt {
  name: string;
  consent: string;
  completed: number;
  originalSha256: string;
  signedSha256: string;
  signedFileId: string;
}
export interface CloudShare {
  id: string;
  fileId: string;
  label: string;
  mode: 'view' | 'review' | 'sign';
  created: number;
  expires: number;
  revoked: boolean;
  passwordProtected: boolean;
  opens: number;
  receipt?: SigningReceipt;
}
export interface CloudToken {
  id: string;
  label: string;
  scope: 'read' | 'write';
  expires: number;
  created: number;
}
export interface CloudPreferences {
  defaultTool: 'edit' | 'sign' | 'merge' | 'compress';
  defaultExpiryDays: number;
}
export interface CloudWorkspace {
  files: CloudFile[];
  shares: CloudShare[];
  comments: CloudComment[];
  tokens: CloudToken[];
  preferences: CloudPreferences;
  usedBytes: number;
  limits: typeof CLOUD_LIMITS;
}
export const SIGNING_CONSENT =
  'I agree to use an electronic signature and to send this signed copy to the document owner.';
