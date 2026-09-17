'use strict';
// Anonymisert EVTC-fixture, samme format for worker-test og den manuelle ytelsesmålingen.
function logBuffer(hits = 1) {
  const b = Buffer.alloc(16 + 4 + 2 * 96 + 4 + (hits + 2) * 64);
  b.write('EVTC20260917', 0); b[12] = 1; b.writeUInt16LE(15438, 13); b.writeUInt32LE(2, 16);
  b.writeBigUInt64LE(1n, 20); b.writeUInt32LE(1, 28); b.write('Alfa\0:Test.1234\x001\0', 48);
  b.writeBigUInt64LE(2n, 116); b.writeUInt32LE(15438, 124); b.writeUInt32LE(0xffffffff, 128); b.write('Golem', 144);
  const start = 216;
  b.writeBigUInt64LE(1000n, start); b[start + 56] = 9;
  for (let i = 0; i < hits; i++) {
    const off = start + (i + 1) * 64;
    b.writeBigUInt64LE(BigInt(1001 + i), off); b.writeBigUInt64LE(1n, off + 8); b.writeBigUInt64LE(2n, off + 16);
    b.writeInt32LE(100, off + 24); b.writeUInt16LE(1, off + 40); b.writeUInt16LE(2, off + 42); b[off + 48] = 1;
  }
  const end = start + (hits + 1) * 64;
  b.writeBigUInt64LE(BigInt(1001 + hits), end); b[end + 56] = 10;
  return b;
}
module.exports = { logBuffer };
