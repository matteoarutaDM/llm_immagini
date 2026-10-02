import "server-only";

/**
 * Builds a parametrised WHERE clause from optional conditions. Each condition
 * is `[fragment, ...values]` where `?` marks a value; falsy entries are
 * skipped. Values are always sent as bind parameters, never interpolated.
 *
 *   where([["u.status = ?", status], q && ["u.email ILIKE ?", like(q)]], 0)
 *
 * @param {Array<[string, ...unknown[]] | null | undefined | false | "">} conditions
 * @param {number} [offset] number of parameters already used by the query
 */
export function where(conditions, offset = 0) {
  const params = [];
  const parts = [];
  for (const condition of conditions) {
    if (!condition) continue;
    const [fragment, ...values] = condition;
    let index = 0;
    parts.push(
      fragment.replace(/\?/g, () => {
        params.push(values[index++]);
        return `$${offset + params.length}`;
      }),
    );
  }
  return { clause: parts.length ? `WHERE ${parts.map((part) => `(${part})`).join(" AND ")}` : "", params };
}

/** ILIKE pattern for a free-text term, with %, _ and \ escaped. */
export function like(term) {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Page envelope from rows that carry `total` (count(*) OVER ()). */
export function toPage(rows, { page, pageSize }) {
  const total = rows[0]?.total ?? 0;
  return {
    items: rows.map(({ total: _total, ...row }) => row),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export const limitOffset = ({ page, pageSize }) => [pageSize, (page - 1) * pageSize];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === "string" && UUID_PATTERN.test(value);
export const isNumericId = (value) => typeof value === "string" && /^\d{1,18}$/.test(value);
