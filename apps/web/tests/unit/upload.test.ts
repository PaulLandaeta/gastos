import { describe, expect, it } from 'vitest';
import { pdfPageCountFromText, sha256Hex } from '../../src/features/attachments/files';

describe('attachment upload helpers', () => {
  it('counts PDF page objects but not the page tree node', () => {
    const pdf = '1 0 obj <</Type /Pages /Kids [2 0 R 3 0 R] /Count 2>> 2 0 obj <</Type /Page>> 3 0 obj <</Type/Page /Parent 1 0 R>>';
    expect(pdfPageCountFromText(pdf)).toBe(2);
  });

  it('falls back to /Count for compressed object streams, then to 1', () => {
    expect(pdfPageCountFromText('<</Type /Pages /Count 12>> stream...')).toBe(12);
    expect(pdfPageCountFromText('garbage')).toBe(1);
  });

  it('hashes content with SHA-256 (hex)', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
