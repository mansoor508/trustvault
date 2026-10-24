import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type JSX } from 'react';
import { extractErrorMessage } from '../../lib/auth';
import {
  ACCEPTED_EXTENSIONS,
  CATEGORY_LABELS,
  DOCUMENT_CATEGORIES,
  MAX_UPLOAD_BYTES,
  formatBytes,
  uploadDocument,
  type DocumentCategory,
  type DocumentItem,
} from '../../lib/documents';
import { IconFile, IconUpload } from '../ui/Icons';

export interface UploadFormProps {
  csrfToken: string;
  onUploaded: (document: DocumentItem) => void;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/**
 * Upload form with drag-and-drop. The server remains the authority on type,
 * size and content; these checks only shorten the feedback loop.
 */
export function UploadForm({ csrfToken, onUploaded }: UploadFormProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('general');
  const [description, setDescription] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function acceptFile(selected: File | null): void {
    setError(null);
    if (selected === null) {
      setFile(null);
      return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setError(`That file is larger than ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      setFile(null);
      return;
    }
    if (!ACCEPTED_EXTENSIONS.split(',').includes(extensionOf(selected.name))) {
      setError('Unsupported type. Use PDF, PNG, JPG, DOCX, XLSX, PPTX, TXT, MD or CSV.');
      setFile(null);
      return;
    }
    setFile(selected);
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>): void {
    acceptFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (file === null) {
      setError('Choose a file first.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await uploadDocument(
        { file, title: title || undefined, description: description || undefined, category },
        csrfToken,
      );

      if (result.ok) {
        onUploaded(result.data.document);
      } else {
        setError(extractErrorMessage(result.data) ?? `Upload failed (HTTP ${result.status}).`);
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="upload-form" onSubmit={(event) => void handleSubmit(event)}>
      <div
        className={`dropzone ${dragging ? 'is-dragging' : ''} ${file !== null ? 'has-file' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          id="upload-file"
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          onChange={handleFileInput}
          disabled={busy}
          className="sr-only"
        />

        {file === null ? (
          <>
            <span className="dropzone-icon">
              <IconUpload width={26} height={26} />
            </span>
            <p className="dropzone-title">Drop a file here, or choose one</p>
            <p className="muted small">
              PDF, PNG, JPG, DOCX, XLSX, PPTX, TXT, MD, CSV · up to {formatBytes(MAX_UPLOAD_BYTES)}
            </p>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              Choose file
            </button>
          </>
        ) : (
          <>
            <span className="dropzone-icon">
              <IconFile width={26} height={26} />
            </span>
            <p className="dropzone-title">{file.name}</p>
            <p className="muted small">{formatBytes(file.size)}</p>
            <div className="dropzone-actions">
              <button
                className="button button-secondary button-sm"
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                Replace
              </button>
              <button
                className="button button-ghost button-sm"
                type="button"
                onClick={() => {
                  setFile(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
                disabled={busy}
              >
                Remove
              </button>
            </div>
          </>
        )}
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="upload-title">Title (optional)</label>
          <input
            id="upload-title"
            value={title}
            maxLength={200}
            placeholder="Defaults to the file name"
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="upload-category">Category</label>
          <select
            id="upload-category"
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
          <label htmlFor="upload-description">Description (optional)</label>
          <textarea
            id="upload-description"
            value={description}
            maxLength={2000}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      {error !== null ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}

      {busy ? (
        <div className="upload-progress-wrap" role="progressbar" aria-valuetext="Uploading document…">
          <div className="upload-progress-bar" />
          <span className="muted small" style={{ textAlign: 'center' }}>
            Encrypting and streaming document to private vault…
          </span>
        </div>
      ) : null}

      <div className="form-actions">
        <button className="button button-primary" type="submit" disabled={busy || file === null}>
          <IconUpload width={16} height={16} />
          {busy ? 'Uploading…' : 'Upload document'}
        </button>
        <p className="muted small">
          Files are validated by content on the server and stored outside the web root.
        </p>
      </div>
    </form>
  );
}
