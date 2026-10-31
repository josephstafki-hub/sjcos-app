/** AI responses sometimes wrap publication copy in JSON. Only known copy fields
 * are accepted; never turn arbitrary metadata into client-facing prose. */
export function normalizeMarketingCopy(raw: string): { title?: string; body: string } {
  const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  const source = (fence?.[1] ?? raw).trim();
  if (!/^[{[]/.test(source)) return { body: source };
  let value: unknown;
  try { value = JSON.parse(source); } catch { return { body: '' }; }
  const prose = (x: unknown): string => {
    if (typeof x === 'string') return x.trim();
    if (Array.isArray(x)) return x.map(prose).filter(Boolean).join('\n\n');
    if (!x || typeof x !== 'object') return '';
    const r = x as Record<string, unknown>;
    return [prose(r.heading ?? r.subheading), prose(r.paragraph ?? r.text ?? r.content ?? r.body ?? r.paragraphs)].filter(Boolean).join('\n\n');
  };
  if (Array.isArray(value)) return { body: prose(value) };
  if (!value || typeof value !== 'object') return { body: '' };
  const envelope = value as Record<string, unknown>;
  const post = envelope.blogPost ?? envelope.blog_post ?? envelope.socialPost ?? envelope.social_post ?? envelope;
  if (typeof post === 'string') return {body: post.trim()};
  if (!post || typeof post !== 'object') return {body: ''};
  const r = post as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim() : undefined;
  const body = prose(r.content ?? r.body ?? r.paragraphs ?? r.sections ?? r.post ?? r.caption ?? r.text);
  const tags = Array.isArray(r.hashtags) ? r.hashtags.filter((t): t is string => typeof t === 'string').map(t => `#${t.trim().replace(/^#/, '')}`).join(' ') : '';
  return { ...(title ? {title} : {}), body: [body, tags].filter(Boolean).join('\n\n') };
}
