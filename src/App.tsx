import { lazy, Suspense, useEffect, useState } from 'react';
import { getTool, tools } from './lib/catalog';
import { Icon } from './components/Icon';
import Home from './components/Home';
import DeviceSettings from './components/DeviceSettings';
import ToolLanding from './components/ToolLanding';
import { updatePageMetadata } from './lib/seo';
import { CloudIntro } from './components/CloudIntro';
import DeveloperGuide from './components/DeveloperGuide';
const Workspace = lazy(() => import('./components/Workspace'));
const CloudWorkspace = lazy(() => import('./components/CloudWorkspace'));
const SharedDocument = lazy(() => import('./components/SharedDocument'));

export default function App({
  initialPath = typeof location === 'undefined' ? '/' : location.pathname,
  prerender = false,
}: { initialPath?: string; prerender?: boolean } = {}) {
  const [path, setPath] = useState(initialPath),
    [mobileMenu, setMobileMenu] = useState(false),
    [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<{ file: File; id: string }>();
  const slug = path.replace(/^\/+|\/+$/g, ''),
    tool = getTool(slug);
  function navigate(next: string) {
    if (next === path) {
      setMobileMenu(false);
      return true;
    }
    if (
      dirty &&
      !window.confirm('Leave this tool? Your unsaved document changes will be discarded.')
    )
      return false;
    history.pushState(null, '', next);
    setPath(next);
    setDirty(false);
    setPending(undefined);
    setMobileMenu(false);
    window.scrollTo(0, 0);
    return true;
  }
  useEffect(() => {
    const pop = () => {
      if (
        dirty &&
        !window.confirm('Leave this tool? Your unsaved document changes will be discarded.')
      ) {
        history.pushState(null, '', path);
        return;
      }
      setPath(location.pathname);
      setDirty(false);
      setPending(undefined);
      setMobileMenu(false);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [dirty, path]);
  useEffect(() => {
    updatePageMetadata(path);
  }, [path]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  const link = (to: string, label: string, icon: string, active = false) => (
    <a
      key={to}
      href={to}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault();
        navigate(to);
      }}
    >
      <Icon name={icon} size={18} />
      <span>{label}</span>
      {active && <span className="nav-dot" />}
    </a>
  );
  return (
    <div className={`app-shell ${tool ? 'tool-open' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {mobileMenu && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside className={`sidebar ${mobileMenu ? 'sidebar-visible' : ''}`}>
        <a
          className="brand"
          href="/"
          aria-label="Rovty PDF home"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          ROVTY<span>PDF</span>
        </a>
        <span className="sidebar-tagline">Less effort. More done.</span>
        <nav className="primary-nav" aria-label="Main navigation">
          {link('/', 'All tools', 'LayoutGrid', !slug)}
          {link('/cloud', 'Cloud workspace', 'Globe', slug === 'cloud')}
          <span className="nav-label">YOUR EVERYDAY TOOLS</span>
          {['edit', 'merge', 'split', 'compress', 'sign', 'organize'].map((id) => {
            const item = getTool(id)!;
            return link(`/${id}`, item.name, item.icon, slug === id);
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="green-light" />
            <div>
              <strong>Private by design.</strong>
              <p>
                Editing stays here.
                <br />
                Cloud is your choice.
              </p>
            </div>
            <Icon name="ShieldCheck" size={18} />
          </div>
          <nav aria-label="More">
            {link('/privacy', 'Privacy & help', 'CircleHelp', slug === 'privacy')}
            <a href="https://dash.rovty.com">
              <Icon name="ArrowLeft" size={16} />
              <span>All Rovty apps</span>
              <Icon name="ArrowUpRight" size={14} />
            </a>
          </nav>
          <div className="sidebar-free">
            FREE TOOLS. ZERO FUSS.<span>✳</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-toggle"
            aria-label="Open navigation"
            aria-expanded={mobileMenu}
            onClick={() => setMobileMenu((v) => !v)}
          >
            <Icon name="Menu" size={23} />
          </button>
          <div className="breadcrumb">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                navigate('/');
              }}
            >
              Rovty PDF
            </a>
            <span>/</span>
            <span>
              {tool
                ? tool.name
                : slug === 'privacy'
                  ? 'Privacy & help'
                  : slug === 'cloud'
                    ? 'Cloud workspace'
                    : slug === 'shared'
                      ? 'Shared document'
                      : slug === 'developers'
                        ? 'Developer guide'
                        : 'Your everyday toolkit'}
            </span>
          </div>
          <span className="topbar-privacy">
            <Icon name="LockKeyhole" size={13} /> Local editing · Optional cloud
          </span>
          <a className="topbar-rovty" href="https://rovty.com">
            Meet Rovty <Icon name="ArrowUpRight" size={14} />
          </a>
        </header>
        <main id="main" tabIndex={-1} className={tool ? 'workspace-main' : 'home-main'}>
          {tool ? (
            <Suspense
              fallback={
                <div className="loading-screen">
                  <span className="spinner" />
                  Opening your tool…
                </div>
              }
            >
              {prerender ? (
                <ToolLanding tool={tool} />
              ) : (
                <Workspace
                  key={`${tool.id}-${pending?.id || 'local'}`}
                  tool={tool}
                  initialFile={pending?.file}
                  onDirty={setDirty}
                  navigate={navigate}
                />
              )}
            </Suspense>
          ) : slug === 'cloud' ? (
            prerender ? (
              <CloudIntro />
            ) : (
              <Suspense fallback={<p role="status">Opening cloud workspace…</p>}>
                <CloudWorkspace
                  onOpen={(file, target = 'edit') => {
                    if (navigate(`/${target}`)) setPending({ file, id: crypto.randomUUID() });
                  }}
                />
              </Suspense>
            )
          ) : slug === 'shared' ? (
            prerender ? (
              <div className="cloud-page">
                <h1>A document for you.</h1>
                <p>Open a shared PDF with the link provided by its owner.</p>
              </div>
            ) : (
              <Suspense fallback={<p role="status">Opening shared document…</p>}>
                <SharedDocument onDirty={setDirty} />
              </Suspense>
            )
          ) : slug === 'developers' ? (
            <DeveloperGuide />
          ) : slug === 'privacy' ? (
            <Privacy navigate={navigate} />
          ) : !slug ? (
            <Home navigate={navigate} />
          ) : (
            <div className="empty-search">
              <h1>That page isn’t here.</h1>
              <button className="button" onClick={() => navigate('/')}>
                Browse PDF tools
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
function Privacy({ navigate }: { navigate: (path: string) => void }) {
  return (
    <article className="privacy-page">
      <span className="eyebrow">A LITTLE PEACE OF MIND.</span>
      <h1>
        Your files.
        <br />
        Your business.
      </h1>
      <p className="lead">
        Edit on your device. Use the cloud only when you choose. Here is exactly what each choice
        shares.
      </p>
      <div className="help-grid">
        <section>
          <Icon name="HardDrive" size={25} />
          <h2>Local editing stays local</h2>
          <p>
            The editing, signing, compression and organization tools process PDFs, images and
            document passwords in your browser. Opening a file or signing in does not upload it.
            Rovty PDF has no analytics, advertising scripts or document training service.
          </p>
        </section>
        <section>
          <Icon name="UserRoundX" size={25} />
          <h2>Cloud saving is a separate choice</h2>
          <p>
            “Upload to cloud” and “Upload this PDF” send the selected PDF and its name to Rovty on
            Cloudflare. Cloudflare R2 stores the file; account metadata, comments and preferences
            use Cloudflare Durable Objects. Copies remain until you delete them. These services
            encrypt transport and storage, but this is not end-to-end encryption: Rovty’s service
            can access files to provide the features you request.
          </p>
        </section>
        <section>
          <Icon name="Trash2" size={25} />
          <h2>You control sharing and deletion</h2>
          <p>
            Cloud files are private until you create a link. Anyone with that link and its optional
            password can use its permissions until expiry or revocation. Links expire within 30
            days. Delete a file or all PDF cloud data in Cloud workspace. Access is removed
            immediately; storage deletion is retried if Cloudflare is temporarily unavailable.
            Copies already downloaded by recipients cannot be recalled. Expiring a link does not
            delete your saved PDF.
          </p>
        </section>
        <section>
          <Icon name="Globe" size={25} />
          <h2>What accounts and reviews store</h2>
          <p>
            Cloud sign-in uses your Rovty account ID and email, with an essential secure, HttpOnly
            cookie for the PDF session. A temporary cookie protects sign-in. Comments store the
            name, text, page number and time you submit. Signature requests store your returned PDF,
            self-declared name, consent, completion time and file hashes. These records do not
            verify identity or provide certificate-based signing.
          </p>
        </section>
      </div>
      <section className="cloud-panel">
        <h2>Hosting, retention and limits</h2>
        <p>
          Cloudflare serves the app and receives ordinary request metadata such as IP addresses. Its
          infrastructure policies apply to operational records and recovery systems; deletion from
          the active app is not a promise that every infrastructure backup is erased instantly.
          Rovty PDF does not log document contents or share-link secrets in application logs. Shared
          pages and cloud APIs are excluded from search indexing.
        </p>
        <p>
          Private tools work without an account or document watermarks. The optional cloud workspace
          is free for now, with limits of 100 MB per account, 20 MB per PDF and 50 files. These
          limits protect the service from abuse. API tokens can be revoked, expire within 30 days,
          and stop working if their Rovty session is revoked. Cloud features require an internet
          connection.
        </p>
        <p>
          Unsaved local documents disappear when you close or refresh the tab. Download work you
          want to keep. Saved browser signatures never sync automatically; an exported PDF may
          contain a placed signature if you explicitly upload that PDF.
        </p>
      </section>
      <DeviceSettings />
      <h2>Good to know</h2>
      <details open>
        <summary>Does this replace a full desktop PDF editor?</summary>
        <p>
          Rovty PDF covers {tools.length} everyday tools. Text editing works with text objects in a
          PDF and reuses their original fonts. Some embedded fonts contain only a subset of letters;
          if an edit needs a missing character, the editor tells you instead of silently changing
          fonts. Longer text may need repositioning. Scanned pages can be annotated, but OCR,
          Office-file conversion, certificate signing, and advanced desktop features are not
          included.
        </p>
      </details>
      <details>
        <summary>Is covering text the same as redacting it?</summary>
        <p>
          No. Cover puts a white shape over visible content, which may remain recoverable. Redact
          permanently removes selected pixels and exports new page images without the original text,
          metadata or attachments.
        </p>
      </details>
      <details>
        <summary>What happens during compression?</summary>
        <p>
          Compression creates optimized page images. This can reduce scanned or image-heavy PDFs,
          but removes selectable text, form interactivity and links. If the result would be larger,
          the original file is returned.
        </p>
      </details>
      <details>
        <summary>What files and browsers are supported?</summary>
        <p>
          Use an up-to-date Chrome, Edge, Firefox or Safari browser. PDFs up to 80 MB per file and
          160 MB combined can be opened, with up to 1,000 pages. Image exports are limited to 100
          pages per run to protect browser memory. JPG, PNG and WebP images are supported.
        </p>
      </details>
      <details>
        <summary>Can I fill and sign a form?</summary>
        <p>
          Yes. Fill existing text fields, checkboxes and choices, or place text on a flat form. Draw
          a signature or upload its image, remove a plain paper background, and adjust the result
          before placing it. A visual signature is not a cryptographic digital signature.
        </p>
      </details>
      <div className="privacy-actions">
        <button className="button" onClick={() => navigate('/')}>
          Back to the tools <Icon name="ArrowRight" size={17} />
        </button>
        <a href="https://rovty.com/contact">
          Get help <Icon name="ArrowUpRight" size={15} />
        </a>
      </div>
    </article>
  );
}
