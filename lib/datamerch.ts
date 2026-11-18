// DataMerch: funder-reported database of merchants that defaulted, stacked or committed fraud.
// Pure helpers (tested in datamerch.test.ts); the network call lives in app/api/deals/[id]/datamerch/route.ts.

export type DmNote = { category: string | null; note: string | null; created_at: string | null; added_by: string | null };
export type DmMerchant = {
  legal_name: string | null; dba: string | null; ein: string | null;
  city: string | null; state: string | null; notes: DmNote[];
};
export type DmResult = { ein: string; checked_by: string | null; merchants: DmMerchant[]; error?: string };

/** Digits of a 9-digit EIN, or null. Accepts "12-3456789", "123456789", " 12 3456789 ". */
export function normEin(v: string | null | undefined): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 9 ? d : null;
}
export const showEin = (d: string) => `${d.slice(0, 2)}-${d.slice(2)}`;

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

/** Reads a DataMerch merchant lookup response. Accepts a bare list, {data: [...]}, {merchants: [...]},
 *  and items wrapped as {merchant: {...}}, so small changes on their side don't break the check. */
export function parseMerchants(body: unknown): DmMerchant[] {
  const b = body as Record<string, unknown> | unknown[] | null;
  const list: unknown[] = Array.isArray(b) ? b
    : b && Array.isArray((b as Record<string, unknown>).data) ? (b as { data: unknown[] }).data
    : b && Array.isArray((b as Record<string, unknown>).merchants) ? (b as { merchants: unknown[] }).merchants
    : b && typeof b === 'object' && ((b as Record<string, unknown>).merchant || (b as Record<string, unknown>).fein) ? [b]
    : [];
  return list.map(item => {
    const m = ((item as Record<string, unknown>)?.merchant ?? item) as Record<string, unknown>;
    const notesRaw = Array.isArray(m.notes) ? m.notes : Array.isArray(m.records) ? m.records : [];
    return {
      legal_name: s(m.legal_name) ?? s(m.name), dba: s(m.dba), ein: s(m.fein) ?? s(m.ein),
      city: s(m.city), state: s(m.state),
      notes: notesRaw.map(n => {
        const x = ((n as Record<string, unknown>)?.note && typeof (n as Record<string, unknown>).note === 'object'
          ? (n as { note: Record<string, unknown> }).note : n) as Record<string, unknown>;
        return { category: s(x.category), note: s(x.note) ?? s(x.notes) ?? s(x.description), created_at: s(x.created_at), added_by: s(x.added_by) ?? s(x.added_by_name) };
      }),
    };
  }).filter(m => m.legal_name || m.ein || m.notes.length);
}

/** Every distinct note category across the matches, e.g. ["Default", "Stacking"]. */
export const categories = (ms: DmMerchant[]) =>
  [...new Set(ms.flatMap(m => m.notes.map(n => n.category).filter((c): c is string => !!c)))];
