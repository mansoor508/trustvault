import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  CATEGORY_LABELS,
  canManageDocument,
  formatBytes,
  isSharedWithMe,
  type DocumentItem,
} from '../../lib/documents';
import { formatDateTime } from '../../lib/format';
import { IconDownload, IconEdit } from '../ui/Icons';

export interface DocumentTableProps {
  documents: DocumentItem[];
  downloadingId: string | null;
  onDownload: (document: DocumentItem) => void;
  onEdit?: (document: DocumentItem) => void;
}

function accessLabel(document: DocumentItem): string {
  switch (document.access.mode) {
    case 'admin':
      return 'Admin';
    case 'owner':
      return 'Owner';
    case 'co-owner':
      return 'Co-owner';
    default:
      return 'Shared';
  }
}

export function DocumentTable({
  documents,
  downloadingId,
  onDownload,
  onEdit,
}: DocumentTableProps): JSX.Element {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Document</th>
            <th scope="col">Owner</th>
            <th scope="col">Category</th>
            <th scope="col">Size</th>
            <th scope="col">Created</th>
            <th scope="col">Access</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.id}>
              <td>
                <div className="cell-document">
                  <Link className="cell-title" to={`/documents/${document.id}`}>
                    {document.title}
                  </Link>
                  <span className="cell-file mono">{document.fileName}</span>
                  {isSharedWithMe(document) ? (
                    <span className="tag tag-shared">
                      {document.access.mode === 'co-owner' ? 'co-owner access' : 'shared with you'}
                    </span>
                  ) : null}
                </div>
              </td>
              <td>
                <div className="cell-owner">
                  <span>{document.owner.displayName ?? document.owner.email}</span>
                  {document.owner.displayName !== null ? (
                    <span className="muted small">{document.owner.email}</span>
                  ) : null}
                </div>
              </td>
              <td>
                <span className={`tag tag-${document.category}`}>
                  {CATEGORY_LABELS[document.category]}
                </span>
              </td>
              <td className="cell-number">{formatBytes(document.sizeBytes)}</td>
              <td className="cell-number">{formatDateTime(document.createdAt)}</td>
              <td>
                <span className={`access-badge access-${document.access.mode}`}>
                  {accessLabel(document)}
                </span>
              </td>
              <td>
                <div className="row-actions">
                  <button
                    className="button button-ghost button-sm"
                    type="button"
                    onClick={() => onDownload(document)}
                    disabled={downloadingId === document.id}
                  >
                    <IconDownload width={15} height={15} />
                    {downloadingId === document.id ? 'Preparing…' : 'Download'}
                  </button>
                  {onEdit !== undefined && canManageDocument(document) ? (
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => onEdit(document)}
                      aria-label={`Edit ${document.title}`}
                    >
                      <IconEdit width={16} height={16} />
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
