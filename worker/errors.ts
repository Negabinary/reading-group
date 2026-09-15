/** Only these deliberately written messages may be returned to a browser. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function success(data: unknown): Response {
  return Response.json(
    { apiVersion: 1, ok: true, data },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

export function failure(error: unknown): Response {
  const known = error instanceof ApiError;
  if (!known) console.error('Unexpected reading group API failure.');
  return Response.json(
    {
      apiVersion: 1,
      ok: false,
      error: known
        ? error.message
        : 'The reading group could not complete this request. Refresh to check whether your change was saved before trying again.',
    },
    {
      status: known ? error.status : 500,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
