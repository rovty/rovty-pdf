import { useState } from 'react';
import { tools, categories, popularIds } from '../lib/catalog';
import type { Category } from '../lib/types';
import { Icon } from './Icon';

export default function Home({ navigate }: { navigate: (path: string) => void }) {
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState<Category>('All tools');
  const filtered = tools.filter(
    (tool) =>
      (category === 'All tools' || tool.category === category) &&
      `${tool.name} ${tool.description}`.toLowerCase().includes(query.trim().toLowerCase()),
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
              <Icon name="Check" size={14} /> No sign-up
            </span>
            <span>
              <Icon name="Check" size={14} /> No watermarks
            </span>
          </div>
        </div>
        <a
          className="featured-tool"
          href="/edit"
          onClick={(event) => {
            event.preventDefault();
            navigate('/edit');
          }}
        >
          <div className="featured-heading">
            <span className="eyebrow">THE EVERYDAY ESSENTIAL</span>
            <Icon name="ArrowUpRight" size={22} />
          </div>
          <div className="paper-art" aria-hidden="true">
            <div className="paper-shadow" />
            <div className="mini-paper">
              <div className="mini-logo">
                ROVTY <span>/ NOTES</span>
              </div>
              <div className="mini-paper-title">
                A small idea.
                <br />
                Big possibilities.
              </div>
              <div className="mini-lines">
                <i />
                <i />
                <i />
              </div>
              <div className="mini-highlight">Make it your own.</div>
              <div className="mini-signature">Alex</div>
              <div className="mini-page-footer">
                A WORK IN PROGRESS.<span>01</span>
              </div>
            </div>
            <div className="floating-pencil">
              <Icon name="Pencil" size={21} />
            </div>
            <div className="floating-text">
              T<span />
            </div>
          </div>
          <div className="featured-bottom">
            <div>
              <h2>Edit a PDF</h2>
              <p>A quick fix or a fresh start.</p>
            </div>
            <span className="round-arrow">
              <Icon name="ArrowUpRight" size={22} />
            </span>
          </div>
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
        <div className="category-tabs" aria-label="Filter tools">
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
        <div className="tool-grid">
          {filtered.map((tool) => (
            <a
              className="tool-card"
              href={`/${tool.id}`}
              key={tool.id}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/${tool.id}`);
              }}
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
          <h2>On your device. Off our servers.</h2>
          <p>
            Every edit happens in your browser. We don’t upload your PDFs, store your documents, or
            ask you to make an account.
          </p>
        </div>
        <a
          href="/privacy"
          onClick={(e) => {
            e.preventDefault();
            navigate('/privacy');
          }}
        >
          How privacy works <Icon name="ArrowUpRight" size={17} />
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
