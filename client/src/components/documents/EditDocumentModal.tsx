import { useState, type FormEvent, type JSX } from 'react';
import { extractErrorMessage } from '../../lib/auth';
import {
  CATEGORY_LABELS,
  DOCUMENT_CATEGORIES,
  updateDocument,
  type DocumentCategory,
  type DocumentItem,
} from '../../lib/documents';
import { Modal } from '../ui/Modal';

export interface EditDocumentModalProps {
  document: DocumentItem;
  csrfToken: string;
  onClose: () => void;
  onSaved: (document: DocumentItem) => void;
}

export function EditDocumentModal({
  document,
  csrfToken,
  onClose,
  onSaved,
}: EditDocumentModalProps): JSX.Element {
  const [title, setTitle] = useState(document.title);
  const [description, setDescription] = useState(document.description ?? '');
  const [category, setCategory] = useState<DocumentCategory>(document.category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result = await updateDocument(
        document.id,
        {
          title: title.trim(),
          description: description.trim().length === 0 ? null : description.trim(),
          category,
        },
        csrfToken,
      );

      if (result.ok) {
        onSaved(result.data.document);
        onClose();
      } else {
        setError(extractErrorMessage(result.data) ?? `Save failed (HTTP ${result.status}).`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Edit metadata"
      description={document.fileName}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" form="edit-document-form" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      }
    >
      <form id="edit-document-form" className="form-grid" onSubmit={(event) => void handleSubmit(event)}>
        <div className="field">
          <label htmlFor="edit-title">Title</label>
          <input
            id="edit-title"
            value={title}
            maxLength={200}
            required
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="edit-category">Category</label>
          <select
            id="edit-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as DocumentCategory)}
            disabled={busy}
          >
            {DOCUMENT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="field field-full">
          <label htmlFor="edit-description">Description</label>
          <textarea
            id="edit-description"
            value={description}
            maxLength={2000}
            rows={4}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
          />
        </div>

        {error !== null ? (
          <p className="alert alert-error field-full" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
