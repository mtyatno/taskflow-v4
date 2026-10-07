const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const indexHtml = fs.readFileSync(path.join(__dirname, '../../static/index.html'), 'utf8');

describe('Workspace Files and Chat Attachments UI', () => {
  test('AttachPopup includes File tab and file upload triggers', () => {
    assert.match(indexHtml, /tabBtn\("file",\s*["']📁 File["']\)/);
    assert.match(indexHtml, /Unggah Berkas Baru/);
  });

  test('ChatInputBar supports attachedFile preview and payload file_id', () => {
    assert.match(indexHtml, /attachedFile/);
    assert.match(indexHtml, /msg_type:\s*attachedFile\s*\?\s*["']file_attach["']/);
  });

  test('FileMiniCard component exists and handles active and deleted states', () => {
    assert.match(indexHtml, /function FileMiniCard\(/);
    assert.match(indexHtml, /BERKAS TELAH DIHAPUS/);
    assert.match(indexHtml, /Berkas ini sudah tidak lagi tersedia di workspace/);
  });

  test('FileMiniCard supports preview and download actions', () => {
    assert.match(indexHtml, /Pratinjau/);
    assert.match(indexHtml, /Unduh/);
    assert.match(indexHtml, /target:\s*["']_blank["']/);
    assert.match(indexHtml, /download:\s*msg\.file_original_name/);
  });

  test('ChatRoom renders FileMiniCard when msg.file_id or msg_type === "file_attach"', () => {
    assert.match(indexHtml, /\(msg\.file_id\s*\|\|\s*msg\.msg_type\s*===\s*["']file_attach["']\)\s*&&\s*(?:React\.)?createElement\(FileMiniCard/);
  });

  test('Workspace page renders Tasks and Files tabs and WorkspaceFilesView', () => {
    assert.match(indexHtml, /workspaceTab/);
    assert.match(indexHtml, /function WorkspaceFilesView\(/);
    assert.match(indexHtml, /Bagikan ke Chat/);
    assert.match(indexHtml, /Hapus berkas ini dari workspace/);
  });

  test('WorkspaceFilesView handles direct upload, search, categories, and file actions', () => {
    assert.match(indexHtml, /Unggah Berkas/);
    assert.match(indexHtml, /POST/);
    assert.match(indexHtml, /DELETE/);
    assert.match(indexHtml, /Cari nama berkas/);
    assert.match(indexHtml, /dari Diskusi/);
    assert.match(indexHtml, /dari Task/);
    assert.match(indexHtml, /Unggahan Langsung/);
  });

  test('handleShareToChat includes non-empty default content with filename and file metadata', () => {
    assert.match(indexHtml, /handleShareToChat\s*=\s*async/);
    assert.match(indexHtml, /content:\s*["']📎\s*["']\s*\+\s*\(f\.original_name\s*\|\|\s*["']Berkas["']\)/);
    assert.match(indexHtml, /file_original_name:\s*f\.original_name/);
    assert.match(indexHtml, /file_size:\s*f\.file_size/);
    assert.match(indexHtml, /file_mime_type:\s*f\.mime_type/);
    assert.match(indexHtml, /client_id:\s*clientId/);
  });

  test('ChatInputBar renders attachment preview banner above input text and supports multiline auto-resize', () => {
    assert.match(indexHtml, /chat-attach-preview-banner/);
    assert.match(indexHtml, /autoResizeTextarea/);
    assert.match(indexHtml, /hasNewline/);
  });

  test('Service Worker cache version is bumped to taskflow-v379-notes-trash-self-heal', () => {
    const swJs = fs.readFileSync(path.join(__dirname, '../../static/sw.js'), 'utf8');
    assert.match(swJs, /^const CACHE = "taskflow-v379-notes-trash-self-heal";/m);
  });
});

