import { getTool, tools } from './catalog';
export const PDF_ORIGIN = 'https://pdf.rovty.com';
export function pageMetadata(path: string) {
  const slug = path.replace(/^\/+|\/+$/g, ''),
    tool = getTool(slug);
  const known = !slug || slug === 'privacy' || Boolean(tool);
  const title = tool
    ? `${tool.name} Online Free | Rovty PDF`
    : slug === 'privacy'
      ? 'Privacy & Device Storage | Rovty PDF'
      : known
        ? 'Rovty PDF | Free Online PDF Editor & Tools'
        : 'Page not found | Rovty PDF';
  const description = tool
    ? `${tool.detail} Free ${tool.name.toLowerCase()} with Rovty PDF. Files stay on your device; no sign-up required.`
    : slug === 'privacy'
      ? 'Learn how Rovty PDF processes files on your device and gives you control over browser storage, privacy and offline use.'
      : 'Edit, sign, merge, split and compress PDFs for free with Rovty PDF. 23 easy-to-use tools that process files privately in your browser. No account needed.';
  return {
    title,
    description,
    canonical: `${PDF_ORIGIN}${slug ? `/${slug}` : '/'}`,
    robots: known ? 'index, follow, max-image-preview:large' : 'noindex, nofollow',
  };
}
export function pageSchema(path: string) {
  const meta = pageMetadata(path),
    tool = getTool(path.replace(/^\/+|\/+$/g, ''));
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${PDF_ORIGIN}/#website`,
        url: `${PDF_ORIGIN}/`,
        name: 'Rovty PDF',
      },
      {
        '@type': 'WebPage',
        '@id': `${meta.canonical}#webpage`,
        url: meta.canonical,
        name: meta.title,
        description: meta.description,
        isPartOf: { '@id': `${PDF_ORIGIN}/#website` },
        mainEntity: { '@id': `${PDF_ORIGIN}/#application` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${PDF_ORIGIN}/#application`,
        name: 'Rovty PDF',
        url: `${PDF_ORIGIN}/`,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        browserRequirements: 'Requires a modern browser with JavaScript and WebAssembly.',
        description: pageMetadata('/').description,
        featureList: tools.map((item) => item.name),
        image: `${PDF_ORIGIN}/rovty-pdf-og.png`,
        publisher: { '@type': 'Organization', name: 'Rovty', url: 'https://rovty.com/' },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
      ...(path !== '/'
        ? [
            {
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Rovty PDF', item: `${PDF_ORIGIN}/` },
                {
                  '@type': 'ListItem',
                  position: 2,
                  name: tool?.name || 'Privacy & help',
                  item: meta.canonical,
                },
              ],
            },
          ]
        : []),
    ],
  };
}
export function updatePageMetadata(path: string) {
  const meta = pageMetadata(path);
  document.title = meta.title;
  const set = (attribute: 'name' | 'property', key: string, content: string) => {
    let element = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(attribute, key);
      document.head.append(element);
    }
    element.content = content;
  };
  set('name', 'description', meta.description);
  set('name', 'robots', meta.robots);
  set('property', 'og:title', meta.title);
  set('property', 'og:description', meta.description);
  set('property', 'og:url', meta.canonical);
  set('name', 'twitter:title', meta.title);
  set('name', 'twitter:description', meta.description);
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical) canonical.href = meta.canonical;
  let schema = document.getElementById('page-schema');
  if (!schema) {
    schema = document.createElement('script');
    schema.id = 'page-schema';
    schema.setAttribute('type', 'application/ld+json');
    document.head.append(schema);
  }
  schema.textContent = meta.robots.startsWith('noindex') ? '{}' : JSON.stringify(pageSchema(path));
}
