import {
  authenticateGitHub,
  deleteGitHubCredential,
  deleteGitHubToken,
  getAuthStatus,
  getSavedGitHubToken,
  listCredentialAuditEvents,
  listGitHubCredentials,
  verifyGitHubToken,
} from '@/lib/api/github';
import { getClaudeCredentialStatus, saveClaudeCredential } from '@/lib/api/claude';
import type { CredentialAuditEvent, GitHubCredential } from '@/lib/api/github';
import type { ClaudeCredentialStatus } from '@/lib/api/claude';
import { CREDENTIAL_AUDIT_FETCH_LIMIT } from '@/features/credentials/domain/audit';

export interface GitHubAuthStatus {
  authenticated: boolean;
  username?: string;
}

export function fetchGitHubAuthStatus(): Promise<GitHubAuthStatus> {
  return getAuthStatus();
}

export function fetchClaudeStatus(): Promise<ClaudeCredentialStatus> {
  return getClaudeCredentialStatus();
}

export function fetchCredentialAuditEvents(
  limit = CREDENTIAL_AUDIT_FETCH_LIMIT,
): Promise<CredentialAuditEvent[]> {
  return listCredentialAuditEvents(limit);
}

export function fetchGitHubCredentials(): Promise<GitHubCredential[]> {
  return listGitHubCredentials();
}

export function restoreSavedGitHubToken(): Promise<string> {
  return getSavedGitHubToken();
}

export function saveGitHubToken(token: string) {
  return authenticateGitHub(token);
}

export function removeGitHubToken() {
  return deleteGitHubToken();
}

export function removeGitHubCredential(credentialId: string) {
  return deleteGitHubCredential(credentialId);
}

export function verifyGitHubTokenForReveal(token: string) {
  return verifyGitHubToken(token);
}

export function saveClaudeApiCredential(params: {
  apiKey: string;
  accountLabel: string;
}): Promise<ClaudeCredentialStatus> {
  return saveClaudeCredential(params);
}
