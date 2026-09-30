import { useState } from 'react';
import { tools, categories, popularIds } from '../lib/catalog';
import type { Category } from '../lib/types';
import { followLink } from '../lib/navigation';
import { Icon } from './Icon';

export default function Home({ navigate }: { navigate: (path: string) => void }) {
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState<Category>('All tools');
  const filtered = tools.filter(
    (tool) =>
      (category === 'All tools' || tool.category === category) &&
      query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .every((word) =>
          `${tool.name} ${tool.description} ${tool.detail} ${tool.id} ${tool.category}`
            .toLowerCase()
            .includes(word),
        ),
  );
  return (
    <>
      <section className="home-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="tiny-square" /> PAPERWORK, WITHOUT THE WORK.
          </span>
          <h1>
            A little less
            <br />
            <span>paperwork.</span>
          </h1>
          <p>
            Good tools make everyday things easier.
            <br />
            Edit, sign, and sort your PDFs. Freely.
          </p>
          <div className="hero-promises">
            <span>
              <Icon name="Check" size={14} /> Free for everyone
            </span>
            <span>
              <Icon name="Check" size={14} /> No account to edit
            </span>
            <span>
              <Icon name="Check" size={14} /> No watermarks
            </span>
          </div>
        </div>
        <a
          className="featured-tool"
          href="/edit"
          aria-labelledby="featured-edit-title"
          aria-describedby="featured-edit-description"
          onClick={(event) => followLink(event, navigate)}
        >
          <img
            className="featured-banner"
            src="/images/pdf-editor-banner-v1-1120.webp"
            srcSet="/images/pdf-editor-banner-v1-640.webp 640w, /images/pdf-editor-banner-v1-1120.webp 1120w, /images/pdf-editor-banner-v1-1747.webp 1747w"
            sizes="(max-width: 700px) 100vw, (max-width: 1000px) 75vw, 45vw"
            width={1747}
            height={900}
            alt=""
            fetchPriority="high"
          />
          <h2 id="featured-edit-title" className="sr-only">
            Edit a PDF
          </h2>
          <p id="featured-edit-description" className="sr-only">
            Make changes, add text, highlight, insert images and more — right in your browser.
          </p>
        </a>
      </section>
      <section className="tools-section" id="tools" aria-labelledby="tools-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow muted">YOUR DOCUMENT TOOLKIT</span>
            <h2 id="tools-heading">What’s on your to-do list?</h2>
          </div>
          <label className="tool-search">
            <Icon name="Search" size={17} />
            <input
              aria-label="Search PDF tools"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a tool…"
            />
            {query && (
              <button aria-label="Clear search" onClick={() => setQuery('')}>
                <Icon name="X" size={16} />
              </button>
            )}
          </label>
        </div>
        <div className="category-tabs" role="group" aria-label="Filter tools">
          {categories.map((item) => (
            <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>
              {item}
              {category === item && (
                <span>
                  {tools.filter((t) => item === 'All tools' || t.category === item).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="sr-only" role="status">
          {filtered.length} {filtered.length === 1 ? 'tool' : 'tools'} found
          {query ? ` for ${query}` : ''}.
        </p>
        <div className="tool-grid">
          {filtered.map((tool) => (
            <a
              className="tool-card"
              href={`/${tool.id}`}
              key={tool.id}
              onClick={(event) => followLink(event, navigate)}
            >
              <div className={`tool-icon ${tool.accent}`}>
                <Icon name={tool.icon} size={24} />
              </div>
              {popularIds.includes(tool.id) && <span className="tool-popular">POPULAR</span>}
              <h3>
                {tool.name}
                <Icon name="ArrowUpRight" size={17} />
              </h3>
              <p>{tool.description}</p>
            </a>
          ))}
        </div>
        {!filtered.length && (
          <div className="empty-search">
            <Icon name="SearchX" size={32} />
            <h3>No tools found</h3>
            <p>Try another search or browse all tools.</p>
            <button
              className="button secondary"
              onClick={() => {
                setQuery('');
                setCategory('All tools');
              }}
            >
              Show all tools
            </button>
          </div>
        )}
      </section>
      <section className="privacy-banner">
        <span className="privacy-illustration">
          <Icon name="ShieldCheck" size={34} />
        </span>
        <div>
          <span className="eyebrow">YOUR FILES STAY YOURS.</span>
          <h2>Private editing. Cloud by choice.</h2>
          <p>
            Every edit happens in your browser. Saving a cloud copy, sharing a document or sending a
            signed copy uploads only what you choose. Local tools need no account.
          </p>
        </div>
        <a href="/privacy" onClick={(event) => followLink(event, navigate)}>
          How privacy works <Icon name="ArrowUpRight" size={17} />
        </a>
      </section>
      <section className="cloud-home">
        <div>
          <span className="eyebrow">WHEN YOUR WORK NEEDS COMPANY.</span>
          <h2>A place for the next step.</h2>
          <p>
            Save PDFs and templates, share expiring links, collect comments and request signatures
            in Rovty Cloud. Your documents stay local until you choose a cloud action.
          </p>
        </div>
        <a className="button" href="/cloud" onClick={(event) => followLink(event, navigate)}>
          Explore Rovty Cloud <Icon name="ArrowUpRight" size={17} />
        </a>
      </section>
      <footer className="home-footer">
        <span>Small tools. More possibilities.</span>
        <span>
          Made by{' '}
          <a href="https://rovty.com">
            Rovty <Icon name="ArrowUpRight" size={13} />
          </a>
        </span>
      </footer>
    </>
  );
}
