interface PagesEnv { BACKEND: Fetcher }

// Preserve URL, Origin and the secure visitor cookie across the service binding.
export const onRequest: PagesFunction<PagesEnv> = ({ request, env }) => env.BACKEND.fetch(request);
