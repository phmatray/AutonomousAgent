import { invoke } from '@tauri-apps/api/core';

export interface AuthResult {
  success: boolean;
  username?: string;
  avatar_url?: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  description?: string;
  default_branch: string;
  private: boolean;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body?: string;
  state: string;
  labels: string[];
  assignees: string[];
}

export interface GitHubPR {
  number: number;
  html_url: string;
  title: string;
}

export interface GitHubCredential {
  id: string;
  username: string;
  label: string;
  is_default: boolean;
}

export interface CredentialAuditEvent {
  id: string;
  provider: string;
  action: string;
  success: boolean;
  detail?: string;
  timestamp: string;
}

export async function authenticateGitHub(token: string): Promise<AuthResult> {
  return invoke('authenticate_github', { token });
}

export async function listGitHubCredentials(): Promise<GitHubCredential[]> {
  return invoke('list_github_credentials');
}

export async function listRepositories(): Promise<GitHubRepo[]> {
  return invoke('list_repositories');
}

export async function listIssues(owner: string, repo: string): Promise<GitHubIssue[]> {
  return invoke('list_issues', { owner, repo });
}

export async function createPullRequest(params: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}): Promise<GitHubPR> {
  return invoke('create_pull_request', params);
}

export async function getAuthStatus(): Promise<{
  authenticated: boolean;
  username?: string;
}> {
  return invoke('get_auth_status');
}

export async function getSavedGitHubToken(): Promise<string> {
  const response = await invoke<{ token: string | null }>('get_saved_github_token');
  return response.token ?? '';
}

export async function deleteGitHubToken(): Promise<void> {
  return invoke<void>('delete_github_token');
}

export async function verifyGitHubToken(token: string): Promise<{
  valid: boolean;
  username: string;
}> {
  return invoke('verify_github_token', { token });
}

export async function listCredentialAuditEvents(limit = 20): Promise<CredentialAuditEvent[]> {
  return invoke('list_credential_audit_events', { limit });
}
