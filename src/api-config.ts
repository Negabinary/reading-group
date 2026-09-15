export function validateApiUrl(value: string): string {
  const url = value.trim();
  if (
    !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(
      url,
    )
  ) {
    throw new Error(
      'Set VITE_APPS_SCRIPT_URL to the Apps Script web app URL: https://script.google.com/macros/s/DEPLOYMENT_ID/exec',
    );
  }
  return url;
}
