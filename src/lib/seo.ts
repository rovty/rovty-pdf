import { getTool, tools } from './catalog';
const descriptions: Record<string, string> = {
  edit: 'Edit PDF text, add images, highlight and draw online for free. Make changes privately in your browser and download a new copy with Rovty PDF.',
  merge:
    'Merge PDF files online for free. Arrange documents and pages in the order you need, then download one PDF. Private browser processing with Rovty PDF.',
  split:
    'Split a PDF into separate pages or custom page ranges for free. Process files privately in your browser and download the results with Rovty PDF.',
  compress:
    'Compress PDF files online for free with Rovty PDF. Choose image quality to reduce file size. Compression flattens text, forms and links into images.',
  sign: 'Sign a PDF online for free. Draw a signature or add a signature image, place it on the page and download your PDF. Private editing with Rovty PDF.',
  fill: 'Fill PDF form fields, checkboxes and choices online for free. Add text to flat forms and download your completed document with Rovty PDF.',
  organize:
    'Organize PDF pages online for free. Drag to reorder, rotate, duplicate or delete pages and save a new copy. Files stay on your device with Rovty PDF.',
  extract:
    'Extract selected PDF pages into a new document for free. Choose page ranges and their order, then download privately in your browser with Rovty PDF.',
  delete:
    'Delete unwanted PDF pages online for free. Choose the pages to remove and download a new copy. Your original stays unchanged with Rovty PDF.',
  rotate:
    'Rotate PDF pages online for free. Fix a single page or the whole document and download a new copy. Private browser processing with Rovty PDF.',
  'images-to-pdf':
    'Convert JPG, PNG and WebP images to PDF for free. Arrange your photos, choose a page size and download with Rovty PDF. No account needed.',
  'pdf-to-images':
    'Convert PDF pages to JPG or PNG images online for free. Choose pages and quality, then download a ZIP file. Private processing with Rovty PDF.',
  text: 'Extract selectable text from a PDF into a plain-text file for free with Rovty PDF. Files stay on your device. Image-only scans require OCR elsewhere.',
  watermark:
    'Add a text watermark to PDF pages online for free. Adjust size, color, placement and opacity, preview the result and download with Rovty PDF.',
  'page-numbers':
    'Add page numbers to a PDF online for free. Choose the pages, starting number, text size and position. Preview and download with Rovty PDF.',
  crop: 'Crop PDF page margins online for free with Rovty PDF. Preview the new boundaries and download a copy. Cropping hides content; it does not redact it.',
  protect:
    'Protect a PDF with an opening password for free. Encrypt locally in your browser and download the protected copy. Rovty PDF never stores the password.',
  unlock:
    'Remove PDF password protection using a password you know. Open the document privately and download an unlocked copy for free with Rovty PDF.',
  redact:
    'Redact sensitive PDF content for free with Rovty PDF. Mark areas and download a flattened image-based copy with original text, forms and links removed.',
  grayscale:
    'Convert a PDF to grayscale online for free with Rovty PDF. Preview and download an image-based copy. Selectable text, forms and links are flattened.',
  flatten:
    'Flatten PDF form fields into page content for free. Keep selectable document text and download a copy with Rovty PDF. Private browser processing.',
  metadata:
    'Edit PDF title and author and clear standard metadata for free with Rovty PDF. Process privately in your browser. Visible page content stays unchanged.',
  repair:
    'Try repairing a PDF online for free with Rovty PDF. Rebuild a document your browser can open. Severely damaged or incomplete files may not be recoverable.',
};
export const PDF_ORIGIN = 'https://pdf.rovty.com';
export function pageMetadata(path: string) {
  const slug = path.replace(/^\/+|\/+$/g, ''),
    tool = getTool(slug);
  const known =
    !slug || ['privacy', 'cloud', 'shared', 'developers'].includes(slug) || Boolean(tool);
  const privatePage = ['cloud', 'shared'].includes(slug);
  const title = tool
    ? `${tool.name} Online Free | Rovty PDF`
    : slug === 'cloud'
      ? 'Rovty Cloud Workspace | Rovty PDF'
      : slug === 'shared'
        ? 'Shared Document | Rovty PDF'
        : slug === 'developers'
          ? 'Document API & Integrations | Rovty PDF'
          : slug === 'privacy'
            ? 'Privacy & Cloud Controls | Rovty PDF'
            : known
              ? 'Rovty PDF | Free Online PDF Editor & Tools'
              : 'Page not found | Rovty PDF';
  const description = tool
    ? descriptions[tool.id]
    : slug === 'privacy'
      ? 'Learn what stays on your device, what optional cloud actions upload, and how to control storage, sharing, deletion and offline use in Rovty PDF.'
      : slug === 'developers'
        ? 'Connect applications to Rovty PDF with the document API. Manage cloud files, expiring links and reviews with scoped, revocable API tokens.'
        : slug === 'cloud'
          ? 'Your optional Rovty PDF workspace for saved documents, reusable templates, expiring links, reviews and signature requests.'
          : slug === 'shared'
            ? 'Open a PDF shared with you through Rovty PDF.'
            : `Edit, sign, merge, split and compress PDFs for free with Rovty PDF. ${tools.length} private browser tools, no account needed. Optional cloud saving and sharing.`;
  return {
    title,
    description,
    canonical: `${PDF_ORIGIN}${slug ? `/${slug}` : '/'}`,
    robots: known && !privatePage ? 'index, follow, max-image-preview:large' : 'noindex, nofollow',
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
        browserRequirements: 'Requires an up-to-date web browser.',
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
                  name:
                    tool?.name || (path === '/developers' ? 'Developer guide' : 'Privacy & help'),
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
  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (meta.robots.startsWith('noindex')) canonical?.remove();
  else {
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.append(canonical);
    }
    canonical.href = meta.canonical;
  }
  let schema = document.getElementById('page-schema');
  if (!schema) {
    schema = document.createElement('script');
    schema.id = 'page-schema';
    schema.setAttribute('type', 'application/ld+json');
    document.head.append(schema);
  }
  schema.textContent = meta.robots.startsWith('noindex') ? '{}' : JSON.stringify(pageSchema(path));
}
