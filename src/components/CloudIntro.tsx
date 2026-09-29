export function CloudIntro({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`cloud-intro ${compact ? 'compact' : ''}`}>
      <span className="eyebrow">
        {compact ? 'YOUR WORK, TOGETHER.' : 'ROVTY CLOUD · HERE WHEN YOU NEED IT.'}
      </span>
      <h1>
        {compact ? (
          'Your Rovty Cloud workspace.'
        ) : (
          <>
            Your PDFs.
            <br />
            Together, by choice.
          </>
        )}
      </h1>
      <p className="lead">
        {compact
          ? 'Pick up a saved PDF, collect feedback or share your next draft. Editing stays on your device; you choose when to save a cloud copy.'
          : 'Save a copy, share a link, gather comments or request a signature. Local editing stays on your device. Cloud actions upload only the files you choose.'}
      </p>
      {!compact && (
        <div className="cloud-benefits">
          {[
            ['Files & templates', 'Reopen documents and reusable blank PDFs across devices.'],
            [
              'Links & reviews',
              'Set an expiry and optional password. Revoke access whenever you need.',
            ],
            ['Signature requests', 'Collect a signed copy and a record of its completion.'],
          ].map(([title, detail]) => (
            <div key={title}>
              <h3>{title}</h3>
              <p>{detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
