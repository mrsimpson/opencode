const GIT_URL_PATTERN = /^https?:\/\/.+\/.+/

export type ValidationErrors = {
  repoUrlRequired: string
  repoUrlInvalid: string
  sourceBranchRequired: string
}

export function buildSessionKey(
  repoUrl: string,
  sourceBranch: string,
  errors: ValidationErrors,
): { valid: true; repoUrl: string; sourceBranch: string } | { valid: false; error: string } {
  const url = repoUrl.trim()
  const br = sourceBranch.trim()
  if (!url) return { valid: false, error: errors.repoUrlRequired }
  if (!GIT_URL_PATTERN.test(url)) return { valid: false, error: errors.repoUrlInvalid }
  if (!br) return { valid: false, error: errors.sourceBranchRequired }
  return { valid: true, repoUrl: url, sourceBranch: br }
}
