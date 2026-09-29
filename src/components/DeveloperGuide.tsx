export default function DeveloperGuide() {
  return (
    <article className="privacy-page">
      <span className="eyebrow">CONNECT YOUR WORKFLOW</span>
      <h1>Rovty PDF API</h1>
      <p className="lead">
        Manage cloud documents, sharing and reviews from your own server. PDF editing and conversion
        continue to run in the browser.
      </p>
      <h2>Start with a token</h2>
      <p>
        Sign in to <a href="/cloud">Rovty Cloud → Integrations</a> and create a read-only or
        read-and-write token. Tokens expire in 30 days, can be revoked immediately, and depend on
        the Rovty session that created them. Never embed a token in public browser code.
      </p>
      <pre>{`curl https://pdf.rovty.com/api/v1/workspace \\\n  -H "Authorization: Bearer YOUR_TOKEN"`}</pre>
      <h2>Upload a PDF</h2>
      <p>
        Upload only documents you have permission to store. This saves a private copy in Rovty
        Cloud. Encode the file name as a URL component.
      </p>
      <pre>{`curl https://pdf.rovty.com/api/v1/files \\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\n  -H "Content-Type: application/pdf" \\\n  -H "X-File-Name: document.pdf" \\\n  --data-binary @document.pdf`}</pre>
      <h2>Endpoints</h2>
      <div className="cloud-table-wrap">
        <table className="cloud-api-table">
          <thead>
            <tr>
              <th>Method</th>
              <th>Path after /api/v1</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['GET', '/workspace', 'Files, links, comments, preferences and usage'],
              ['POST', '/files', 'Upload a PDF; X-Template: true marks a template'],
              ['GET', '/files/:id', 'Download a PDF'],
              ['PATCH', '/files/:id', 'Rename or change template status'],
              ['DELETE', '/files/:id', 'Delete a file, its links and collected signed copies'],
              ['POST', '/shares', 'Create an expiring view, review or sign link'],
              ['PATCH', '/shares/:id', 'Revoke a link'],
              ['DELETE', '/shares/:id', 'Delete a link and its completion record'],
              ['POST', '/comments', 'Add an owner comment'],
              ['PATCH', '/comments/:id', 'Set resolved: true or false'],
              ['DELETE', '/comments/:id', 'Delete a comment'],
              ['PUT', '/preferences', 'Update defaultTool and defaultExpiryDays'],
            ].map((row) => (
              <tr key={row.join('')}>
                {row.map((value) => (
                  <td key={value}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Create a share link</h2>
      <pre>
        {JSON.stringify(
          {
            fileId: 'UUID_FROM_UPLOAD',
            label: 'Please review',
            mode: 'review',
            days: 7,
            password: 'optional-long-password',
          },
          null,
          2,
        )}
      </pre>
      <p>
        Send this JSON to POST /api/v1/shares. Modes are view, review and sign. The response returns
        a vault and token once. Build the recipient URL as{' '}
        <code>https://pdf.rovty.com/shared#v=VAULT&amp;t=TOKEN</code>. Link secrets belong in the
        fragment, never in analytics or logs.
      </p>
      <h2>Limits and errors</h2>
      <p>
        Free cloud limits are 20 MB per PDF, 100 MB and 50 files per account, 20 templates, 50
        links, 200 comments and 5 API tokens. Links expire in 1–30 days. Requests are limited to 60
        per minute per client IP across cloud endpoints. A 429 response includes Retry-After. Errors
        return JSON with an error string: 401 for authentication, 403 for permission, 404 for
        missing resources, 409 for limits or conflicts, 413 for large uploads and 503 for temporary
        unavailability. Retry failed uploads carefully: a lost response may follow a completed
        upload; inspect the workspace before retrying.
      </p>
      <h2>Privacy boundaries</h2>
      <p>
        Document APIs require a token and return no-store responses. Stored documents are private;
        sharing requires a link you create. There is no automatic document upload, server conversion
        API or document training service. Comments and signing names are self-declared. Signature
        requests do not provide identity verification or certificate-based signing.
      </p>
      <a href="/privacy">Read the full privacy details</a>
    </article>
  );
}
