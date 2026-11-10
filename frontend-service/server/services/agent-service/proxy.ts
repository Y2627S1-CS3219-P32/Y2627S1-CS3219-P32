import type { H3Event } from 'h3';
export async function agentProxy(event: H3Event, domain: 'agent' | 'mandate') {
  const token = getCookie(event, 'user_access_token');
  if (!token) throw createError({ statusCode: 401, message: 'A login is required.' });
  const path = getRouterParam(event, 'path') ?? '',
    method = getMethod(event),
    url = getRequestURL(event);
  const uuid = '[0-9a-fA-F-]{36}';
  const allowed =
    domain === 'agent'
      ? new RegExp(`^conversations(?:/${uuid}(?:/(?:messages|events))?)?$`)
      : new RegExp(`^mandates(?:/${uuid}(?:/(?:approve|pause|resume|revoke))?)?$`);
  if (!allowed.test(path) || !['GET', 'POST', 'DELETE'].includes(method))
    throw createError({ statusCode: 404, message: 'Route not found' });
  if (method !== 'GET') {
    const origin = getHeader(event, 'origin');
    if (
      (origin && origin !== url.origin) ||
      getHeader(event, 'sec-fetch-site') === 'cross-site' ||
      !getHeader(event, 'content-type')?.startsWith('application/json')
    )
      throw createError({ statusCode: 403, message: 'Same-origin JSON request required' });
  }
  const config = useRuntimeConfig(event),
    base = domain === 'agent' ? config.agentServiceBaseUrl : config.mandateServiceBaseUrl;
  return proxyRequest(event, `${base.replace(/\/$/, '')}/${path}${url.search}`, {
    headers: { authorization: `Bearer ${token}` },
    fetchOptions: { redirect: 'error' },
  });
}
