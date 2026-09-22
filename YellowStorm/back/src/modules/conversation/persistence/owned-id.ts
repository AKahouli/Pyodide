// Conversation v1 accepts only canonical (lowercase) ids, so it uses the strict check.
export { isCanonicalObjectId as isOwnedId, newObjectId as newOwnedId } from '@common/postgres/object-id';
