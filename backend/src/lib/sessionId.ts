// Session-id validator for routes that read or stream a gc session.
//
// Supervisor session ids seen by this dashboard include gc-/td-/th-prefixed
// handles and city-scoped short prefixes such as fddc-*. Keep this shared
// between peek and stream routes so both session surfaces accept the same id
// alphabet before any supervisor call.

export const SESSION_ID_RE = /^(gc|td|th|[a-z]{4})-[a-z0-9-]{1,32}$/i;
