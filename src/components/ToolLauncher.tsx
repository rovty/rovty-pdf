import { useEffect, useRef, useState, type ComponentProps } from 'react';
import ToolLanding from './ToolLanding';
import type Workspace from './Workspace';

type Props = ComponentProps<typeof Workspace>;
export default function ToolLauncher(props: Props) {
  const [ready, setReady] = useState<{ Component: typeof Workspace; files: File[] }>();
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function open(files: File[]) {
    setError('');
    setOpening(true);
    try {
      const module = await import('./Workspace');
      if (alive.current) setReady({ Component: module.default, files });
    } catch {
      if (alive.current)
        setError(
          'The tool could not finish loading. Check your connection, reload the tool and choose your file again.',
        );
    } finally {
      if (alive.current) setOpening(false);
    }
  }
  useEffect(() => {
    if (props.initialFile) void open([props.initialFile]);
  }, [props.initialFile]);
  if (ready)
    return (
      <ready.Component
        {...props}
        initialFile={undefined}
        initialFiles={ready.files}
        onInitialFilesConsumed={() => {
          if (!alive.current) return;
          // The workspace owns its parsed bytes now; release the original File handles.
          setReady((current) =>
            current && current.files.length ? { ...current, files: [] } : current,
          );
          props.onInitialFilesConsumed?.();
        }}
      />
    );
  return (
    <>
      {error && (
        <p role="alert" className="error-banner">
          {error}
          <button className="button secondary" onClick={() => location.reload()}>
            Reload tool
          </button>
        </p>
      )}
      <ToolLanding tool={props.tool} navigate={props.navigate} onFiles={open} loading={opening} />
    </>
  );
}
