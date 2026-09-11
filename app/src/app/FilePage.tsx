import MarkdownBody from '../panels/shared/MarkdownBody';
import type { FileRef, Location } from '../location';
import FilePreviewPage from '../panels/file/FilePreviewPage';

export default function FilePage({
  file,
  navigate,
}: {
  readonly file: FileRef;
  readonly navigate: (location: Location, mode: 'push' | 'replace') => void;
}) {
  return (
    <FilePreviewPage
      fileRef={file}
      onOpenFile={(next) =>
        navigate(
          {
            view: 'file',
            file: next,
          },
          'push',
        )
      }
      renderMarkdown={(text, workspaceId) => (
        <MarkdownBody
          text={text}
          citations={[]}
          workspaceId={workspaceId}
          onOpenFile={(nextWorkspace, path, line) =>
            navigate({ view: 'file', file: { workspace: nextWorkspace, path, line } }, 'push')
          }
        />
      )}
    />
  );
}
