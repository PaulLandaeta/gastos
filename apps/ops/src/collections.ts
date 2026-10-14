/**
 * Every collection id the API writes (data-model of features 001–006). A collection-group query per
 * id exports all documents at any depth. The restore drill test walks `listCollectionIds` and fails
 * if a new collection is not listed here.
 */
export const COLLECTION_IDS = [
  // top level
  'trips',
  'users',
  'invitations',
  'accountDeletions',
  'aiUsage',
  'idempotencyKeys',
  'config',
  // nested
  'members',
  'expenses',
  'refunds',
  'attachments',
  'settlements',
  'uploads',
  'scans',
  'categories',
  'auditEvents',
  'projections',
  'memberStats',
  'notifications',
] as const;
