import { Icon } from './Icon';
import type { Tool } from '../lib/types';
// Static first paint for direct links and crawlers; the working workspace takes
// over when the client loads, without importing browser PDF engines during SSR.
export default function ToolLanding({ tool }: { tool: Tool }) {
  return (
    <div className="workspace">
      <div className="workspace-heading">
        <div>
          <span className={`tool-icon small ${tool.accent}`}>
            <Icon name={tool.icon} size={22} />
          </span>
          <div>
            <h1>{tool.name}</h1>
            <p>{tool.description}</p>
          </div>
        </div>
      </div>
      <div className="upload-zone">
        <div className={`upload-art ${tool.accent}`}>
          <Icon name="FileUp" size={41} />
        </div>
        <h2>
          {tool.id === 'images-to-pdf'
            ? 'A PDF starts with your images.'
            : 'Let’s start with your PDF.'}
        </h2>
        <p>Choose a file to get started. Your documents stay on your device.</p>
        <button className="button upload-button" disabled>
          Opening your tool…
        </button>
        <noscript>
          Enable JavaScript to use the editor. Files are processed in your browser.
        </noscript>
        <span className="upload-limit">Free for everyone · No account needed</span>
      </div>
      <div className="tool-explainer">
        <div>
          <h3>{tool.name}, made simple.</h3>
          <p>{tool.detail}</p>
        </div>
        <div>
          <h3>Private on your device.</h3>
          <p>
            Edit without uploading documents. You choose whether to save a finished copy to the
            cloud.
          </p>
        </div>
        <div>
          <h3>Download your finished PDF.</h3>
          <p>Keep your original and download the result. No added watermark.</p>
        </div>
      </div>
      <a className="workspace-back" href="/">
        Explore all PDF tools
      </a>
    </div>
  );
}
