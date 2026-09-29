import { lazy, Suspense, useEffect, useState } from 'react';
import { getTool, tools } from './lib/catalog';
import { Icon } from './components/Icon';
import Home from './components/Home';
import DeviceSettings from './components/DeviceSettings';
import ToolLanding from './components/ToolLanding';
import { updatePageMetadata } from './lib/seo';
const Workspace = lazy(() => import('./components/Workspace'));

export default function App({
  initialPath = typeof location === 'undefined' ? '/' : location.pathname,
  prerender = false,
}: { initialPath?: string; prerender?: boolean } = {}) {
  const [path, setPath] = useState(initialPath),
    [mobileMenu, setMobileMenu] = useState(false),
    [dirty, setDirty] = useState(false);
  const slug = path.replace(/^\/+|\/+$/g, ''),
    tool = getTool(slug);
  function navigate(next: string) {
    if (next === path) {
      setMobileMenu(false);
      return;
    }
    if (
      dirty &&
      !window.confirm('Leave this tool? Your unsaved document changes will be discarded.')
    )
      return;
    history.pushState(null, '', next);
    setPath(next);
    setDirty(false);
    setMobileMenu(false);
    window.scrollTo(0, 0);
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
                Your PDFs never leave
                <br />
                this device.
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
              {tool ? tool.name : slug === 'privacy' ? 'Privacy & help' : 'Your everyday toolkit'}
            </span>
          </div>
          <span className="topbar-privacy">
            <Icon name="LockKeyhole" size={13} /> Files stay on your device
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
                <Workspace key={tool.id} tool={tool} onDirty={setDirty} navigate={navigate} />
              )}
            </Suspense>
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
      <p className="lead">Rovty PDF is a free set of PDF tools that works on your device.</p>
      <div className="help-grid">
        <section>
          <Icon name="HardDrive" size={25} />
          <h2>No document uploads</h2>
          <p>
            PDFs, images, passwords and signatures are processed on your device. They are never sent
            to Rovty or another processing service.
          </p>
        </section>
        <section>
          <Icon name="UserRoundX" size={25} />
          <h2>No account needed</h2>
          <p>
            There are no subscriptions, daily task quotas, document watermarks, trackers or
            advertising scripts. Browser memory limits still apply to very large documents.
          </p>
        </section>
        <section>
          <Icon name="Trash2" size={25} />
          <h2>No saved document history</h2>
          <p>
            Closing or refreshing this tab discards PDFs and unsaved edits. Download the result to
            keep it. Signatures are saved in this browser only when you choose to save them.
          </p>
        </section>
        <section>
          <Icon name="Globe" size={25} />
          <h2>What the website receives</h2>
          <p>
            Your browser downloads the app, fonts and PDF engines from this website. Cloudflare
            serves these assets and may receive ordinary request information such as your IP
            address. Document contents are not part of those requests.
          </p>
        </section>
      </div>
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
