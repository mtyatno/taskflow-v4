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
});
